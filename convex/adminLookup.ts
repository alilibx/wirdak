import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { normalizeAdminPhone } from "./admins";
import { adminQuery } from "./lib/adminSession";
import { isBlocked } from "./lib/blocked";
import { isArchived } from "./lib/khatma";
import { JUZ_COUNT } from "./lib/juz";
import { ROTA_SIZE } from "./lib/rota";
import { khatmaJoinLink } from "./lib/rotaJoin";
import { lastRotaDay } from "./lib/rotaPlace";
import { membersByJoin } from "./organizer";
import { roundAssignments } from "./rounds";
import { env } from "./whatsapp";

const MAX_RESULTS = 20;
const MIN_QUERY = 2;
const MAX_HELP = 20;

async function activeCount(ctx: QueryCtx, khatmaId: Id<"khatmas">) {
  const members = await ctx.db
    .query("members")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
    .collect();
  return members.filter((m) => m.status === "active").length;
}

/** Who is in a khatma: its active members, or a rotating khatma's readers still on the list. */
export async function memberCount(ctx: QueryCtx, k: Doc<"khatmas">) {
  if (k.kind !== "rota") return await activeCount(ctx, k._id);
  const readers = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", k._id))
    .collect();
  return readers.filter((p) => p.removedAt === null).length;
}

/** How far a reading day has come, or null unless it's open. */
export async function dayProgress(ctx: QueryCtx, day: Doc<"rotaDays"> | null) {
  if (day === null || day.closedAt !== null) return null;
  const reads = await ctx.db
    .query("rotaReads")
    .withIndex("by_day_juz", (q) => q.eq("dayId", day._id))
    .collect();
  return {
    done: reads.filter((r) => r.doneAt !== null).length,
    total: ROTA_SIZE,
  };
}

/** A rota khatma's settings and where its latest reading day stands, as counts. */
async function rotaFacts(ctx: QueryCtx, k: Doc<"khatmas">) {
  if (k.kind !== "rota" || !k.rota) return null;
  const day = await lastRotaDay(ctx, k._id);
  const today = await dayProgress(ctx, day);
  return {
    days: k.rota.days,
    firstDate: k.rota.firstDate,
    endDate: k.rota.endDate,
    pausedAt: k.rota.pausedAt,
    archivedAt: k.rota.archivedAt,
    pendingOrganizer: k.rota.pendingOrganizer === true,
    joinLink: khatmaJoinLink(k, env("WHATSAPP_PUBLIC_NUMBER")),
    number: day?.number ?? null,
    cycle: day?.cycle ?? null,
    dayOpen: today !== null,
    doneToday: today?.done ?? 0,
    total: ROTA_SIZE,
  };
}

/** Khatmas by exact invite code first, then by a word of the name (spec 8). */
export const findKhatmas = adminQuery({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const query = args.query.trim().slice(0, 100);
    if (query.length < MIN_QUERY) return [];
    const exact = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", query))
      .first();
    const byName = await ctx.db
      .query("khatmas")
      .withSearchIndex("search_name", (q) => q.search("name", query))
      .take(MAX_RESULTS);
    const found: Doc<"khatmas">[] = exact ? [exact] : [];
    for (const k of byName) {
      if (found.length >= MAX_RESULTS) break;
      if (!found.some((f) => f._id === k._id)) found.push(k);
    }
    return await Promise.all(
      found.map(async (k) => ({
        khatmaId: k._id,
        name: k.name,
        inviteCode: k.inviteCode,
        members: await activeCount(ctx, k._id),
      })),
    );
  },
});

/** A person by phone: their id (or null) and whether the number is blocked. */
export const findPerson = adminQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const phone = normalizeAdminPhone(args.phone);
    if (phone === null) return { error: "invalid_phone" as const };
    const person = await ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    const blocked = await isBlocked(ctx, phone);
    if (!person) return { personId: null, blocked };
    return {
      personId: person._id,
      displayName: person.displayName,
      phone: person.phone,
      blocked,
    };
  },
});

/**
 * A khatma for an admin who's helping it: facts, members, and the round's
 * pool as counts. Never who holds which juz', and no paces (spec 8).
 */
export const khatma = adminQuery({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args) => {
    const k = await ctx.db.get(args.khatmaId);
    if (!k) return null;
    const organizer = await ctx.db.get(k.creatorPersonId);
    const members = await Promise.all(
      (await membersByJoin(ctx, k._id)).map(async (m) => ({
        memberId: m._id,
        personId: m.personId,
        displayName: (await ctx.db.get(m.personId))?.displayName ?? "",
        joinedAt: m.joinedAt,
        status: m.status,
      })),
    );
    const round = k.currentRoundId ? await ctx.db.get(k.currentRoundId) : null;
    let pool = null;
    if (round) {
      const rows = await roundAssignments(ctx, round._id);
      const finished = new Set(
        rows.filter((a) => a.finishedAt !== null).map((a) => a.juz),
      );
      const taken = new Set(
        rows
          .filter(
            (a) =>
              a.finishedAt === null &&
              a.releasedAt === null &&
              !finished.has(a.juz),
          )
          .map((a) => a.juz),
      );
      pool = {
        number: round.number,
        startedAt: round.startedAt,
        free: JUZ_COUNT - finished.size - taken.size,
        taken: taken.size,
        finished: finished.size,
      };
    }
    // Open requests are few; this reads at most the newest 200 of them.
    const help = await ctx.db
      .query("helpRequests")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(200);
    return {
      name: k.name,
      kind: k.kind === "rota" ? ("rota" as const) : ("pool" as const),
      archived: isArchived(k),
      rota: await rotaFacts(ctx, k),
      inviteCode: k.inviteCode,
      schedule: k.schedule,
      grace: k.grace,
      createdAt: k.createdAt,
      completedRounds: k.completedRounds,
      organizer: organizer
        ? { personId: organizer._id, displayName: organizer.displayName }
        : null,
      members,
      round: pool,
      openHelpRequests: help.filter((r) => r.khatmaId === k._id).length,
    };
  },
});

/**
 * The rota khatmas an admin set up that wait for this person. They have no
 * membership until the person sends the join message, only a participant row.
 */
async function waitingKhatmas(ctx: QueryCtx, p: Doc<"people">) {
  const rows = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_phone", (q) => q.eq("phone", p.phone))
    .collect();
  const waiting = [];
  for (const row of rows) {
    const k = await ctx.db.get(row.khatmaId);
    if (k?.rota?.pendingOrganizer !== true || isArchived(k)) continue;
    if (k.creatorPersonId !== p._id) continue;
    waiting.push({
      khatmaId: k._id,
      name: k.name,
      inviteCode: k.inviteCode,
      isOrganizer: true,
      status: "active" as const,
      pending: true,
    });
  }
  return waiting;
}

/** A person's account for an admin: never their reading (spec 8). */
export const person = adminQuery({
  args: { personId: v.id("people") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.personId);
    if (!p) return null;
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_person", (q) => q.eq("personId", p._id))
      .collect();
    const khatmas = (
      await Promise.all(
        memberships.map(async (m) => {
          const k = await ctx.db.get(m.khatmaId);
          return k
            ? {
                khatmaId: k._id,
                name: k.name,
                inviteCode: k.inviteCode,
                isOrganizer: k.creatorPersonId === p._id,
                status: m.status,
                pending: false,
              }
            : null;
        }),
      )
    ).filter((k) => k !== null);
    khatmas.push(...(await waitingKhatmas(ctx, p)));
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_person", (q) => q.eq("personId", p._id))
      .collect();
    const help = await ctx.db
      .query("helpRequests")
      .withIndex("by_person", (q) => q.eq("personId", p._id))
      .order("desc")
      .take(MAX_HELP);
    return {
      displayName: p.displayName,
      phone: p.phone,
      timeZone: p.timeZone,
      rotaAllowed: p.rotaAllowed === true,
      verifiedAt: p.verifiedAt,
      lastSeenAt: p.lastSeenAt,
      khatmas,
      sessions: sessions.map((s) => ({
        deviceLabel: s.deviceLabel,
        lastUsedAt: s.lastUsedAt,
      })),
      helpRequests: help.map((r) => ({
        requestId: r._id,
        status: r.status,
        lastMessageAt: r.lastMessageAt,
      })),
      blocked: await isBlocked(ctx, p.phone),
    };
  },
});
