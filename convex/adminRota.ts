import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { archiveKhatma, deleteKhatma } from "./khatmaLifecycle";
import {
  adminMutation,
  adminQuery,
  resolveAdminSession,
  type AdminContext,
} from "./lib/adminSession";
import { writeAudit } from "./lib/audit";
import { isBlocked } from "./lib/blocked";
import { cheerConfigValidator } from "./lib/cheer";
import { randomToken } from "./lib/crypto";
import { refreshPhone } from "./lib/directory";
import { isArchived } from "./lib/khatma";
import { readingDaysValidator, rotaMessagesValidator } from "./lib/rota";
import { randomJoinCode } from "./lib/rotaJoin";
import * as ops from "./lib/rotaOps";
import type { RotaConfig } from "./lib/rotaPlace";
import { cleanDisplayName, cleanKhatmaName, normalizePhone } from "./lib/text";
import { ensureJoinCode, insertRotaKhatma } from "./rota";

/**
 * An admin running a rota khatma: the organizer's operations by `khatmaId`, each
 * change recorded in the audit log. `rota.ts` is the organizer's side of the same work.
 */

/** Attempts at drawing unused codes; a collision is ~1e-20 likely. */
const CODE_ATTEMPTS = 3;
/** An admin is nobody in the khatma. */
const ADMIN: ops.Actor = { personId: null };

type AdminMutationCtx = MutationCtx & AdminContext;

/** The rota khatma, or null for a pool khatma and one that is gone. */
async function rotaKhatma(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<{ khatma: Doc<"khatmas">; rota: RotaConfig } | null> {
  const khatma = await ctx.db.get(khatmaId);
  const rota = khatma?.rota;
  if (!khatma || khatma.kind !== "rota" || !rota) return null;
  return { khatma, rota };
}

/** `rotaKhatma` for archiving and deleting: `not_found` instead of null. */
async function requireRota(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<{ khatma: Doc<"khatmas">; rota: RotaConfig }> {
  const found = await rotaKhatma(ctx, khatmaId);
  if (!found) throw new ConvexError({ code: "not_found" });
  return found;
}

/** `requireRota` for every other change: an archived khatma stays read-only. */
async function requireLiveRota(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<{ khatma: Doc<"khatmas">; rota: RotaConfig }> {
  const found = await requireRota(ctx, khatmaId);
  if (isArchived(found.khatma)) throw new ConvexError({ code: "archived" });
  return found;
}

/** Writes the audit row for one operation of an admin on the khatma. */
async function record(
  ctx: AdminMutationCtx,
  { khatmaId, ...after }: { khatmaId: Id<"khatmas"> },
  note: string,
): Promise<void> {
  await writeAudit(ctx, {
    actor: ctx.admin,
    action: "rota.adminChange",
    targetKind: "khatma",
    targetId: khatmaId,
    before: null,
    after,
    note,
  });
}

/**
 * Records one operation of an admin on the khatma and returns its result. A
 * refused one writes nothing, and neither does one that `changed` says did nothing.
 */
async function audited<Result extends object>(
  ctx: AdminMutationCtx,
  args: { khatmaId: Id<"khatmas"> },
  note: string,
  result: Result,
  changed = true,
): Promise<Result> {
  if ("error" in result || !changed) return result;
  await record(ctx, args, note);
  return result;
}

// ---------------------------------------------------------------------------
// Create

/** The person with this number, or a new one who signs in with it later. */
async function organizerFor(
  ctx: MutationCtx,
  name: string,
  phone: string,
): Promise<Doc<"people">> {
  const found = await ctx.db
    .query("people")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
  if (found) return found;
  const personId = await ctx.db.insert("people", {
    phone,
    displayName: name,
    verifiedAt: 0,
    timeZone: "Asia/Dubai",
    lastSeenAt: 0,
  });
  await refreshPhone(ctx, phone);
  return (await ctx.db.get(personId))!;
}

/**
 * The rota khatma an admin sets up: it checks the admin itself. The cap holds;
 * the `rotaAllowed` switch is for people creating their own. `null` on a code collision.
 */
export const insertForOrganizer = internalMutation({
  args: {
    adminToken: v.string(),
    organizerName: v.string(),
    organizerPhone: v.string(),
    name: v.string(),
    days: readingDaysValidator,
    firstDate: v.string(),
    endDate: v.union(v.string(), v.null()),
    inviteCode: v.string(),
    joinCode: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ khatmaId: Id<"khatmas">; inviteCode: string } | null> => {
    const resolved = await resolveAdminSession(ctx, args.adminToken);
    if (!resolved) throw new ConvexError({ code: "not_admin" });
    // A blocked number gets no khatma, and no account made for it.
    if (await isBlocked(ctx, args.organizerPhone)) {
      throw new ConvexError({ code: "blocked" });
    }
    const person = await organizerFor(
      ctx,
      args.organizerName,
      args.organizerPhone,
    );
    const khatmaId = await insertRotaKhatma(ctx, person, args, true);
    if (khatmaId === null) return null;
    await writeAudit(ctx, {
      actor: resolved.admin,
      action: "rota.adminCreate",
      targetKind: "khatma",
      targetId: khatmaId,
      before: null,
      after: {
        name: args.name,
        organizerPersonId: person._id,
        phone: person.phone,
      },
    });
    return { khatmaId, inviteCode: args.inviteCode };
  },
});

/**
 * Sets a rotating khatma up on someone's behalf. It has no organizer on the web
 * until that person sends the join message from their own number
 * (`takeUpOrganizing` in `rotaInbound.ts`).
 */
export const create = action({
  args: {
    adminToken: v.string(),
    organizerName: v.string(),
    organizerPhone: v.string(),
    name: v.string(),
    days: readingDaysValidator,
    firstDate: v.string(),
    endDate: v.union(v.string(), v.null()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ khatmaId: Id<"khatmas">; inviteCode: string }> => {
    if (
      !(await ctx.runQuery(api.adminAuth.me, { adminToken: args.adminToken }))
    ) {
      throw new ConvexError({ code: "not_admin" });
    }
    const name = cleanKhatmaName(args.name);
    if (name === null) throw new ConvexError({ code: "invalid_name" });
    const organizerName = cleanDisplayName(args.organizerName);
    if (organizerName === null) throw new ConvexError({ code: "bad_name" });
    const organizerPhone = normalizePhone(args.organizerPhone);
    if (organizerPhone === null) throw new ConvexError({ code: "bad_phone" });
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const created = await ctx.runMutation(
        internal.adminRota.insertForOrganizer,
        {
          ...args,
          name,
          organizerName,
          organizerPhone,
          inviteCode: randomToken(9),
          joinCode: randomJoinCode(),
        },
      );
      if (created) return created;
    }
    throw new Error("could not allocate an invite or join code");
  },
});

// ---------------------------------------------------------------------------
// People

export const finishSetup = adminMutation({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args): ReturnType<typeof ops.finishSetup> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "finishSetup",
      await ops.finishSetup(ctx, khatma, rota),
      rota.setupDoneAt === null,
    );
  },
});

export const people = adminQuery({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args): Promise<ops.PeopleView | null> => {
    const found = await rotaKhatma(ctx, args.khatmaId);
    return found && ops.people(ctx, found.khatma, found.rota, ADMIN);
  },
});

export const addParticipant = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    name: v.string(),
    phone: v.string(),
    juz: v.optional(v.number()),
    readsToday: v.optional(v.boolean()),
  },
  handler: async (ctx, args): ReturnType<typeof ops.addParticipant> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "addParticipant",
      await ops.addParticipant(ctx, khatma, rota, args),
    );
  },
});

export const giveJuz = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    participantId: v.id("rotaParticipants"),
    juz: v.number(),
  },
  handler: async (ctx, args): ReturnType<typeof ops.giveJuz> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "giveJuz",
      await ops.giveJuz(ctx, khatma, rota, args),
    );
  },
});

export const moveJuz = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    participantId: v.id("rotaParticipants"),
    fromJuz: v.number(),
    toJuz: v.number(),
  },
  handler: async (ctx, args): ReturnType<typeof ops.moveJuz> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "moveJuz",
      await ops.moveJuz(ctx, khatma, rota, args),
    );
  },
});

export const freeJuz = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    participantId: v.id("rotaParticipants"),
    juz: v.number(),
  },
  handler: async (ctx, args): ReturnType<typeof ops.freeJuz> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "freeJuz",
      await ops.freeJuz(ctx, khatma, rota, args),
    );
  },
});

export const renameParticipant = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    participantId: v.id("rotaParticipants"),
    name: v.string(),
  },
  handler: async (ctx, args): ReturnType<typeof ops.renameParticipant> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "renameParticipant",
      await ops.renameParticipant(ctx, khatma, rota, args),
    );
  },
});

export const removeParticipant = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    participantId: v.id("rotaParticipants"),
  },
  handler: async (ctx, args): ReturnType<typeof ops.removeParticipant> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "removeParticipant",
      await ops.removeParticipant(ctx, khatma, rota, args),
    );
  },
});

// ---------------------------------------------------------------------------
// Saved participants: the organizer's list

export const saved = adminQuery({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args): Promise<ops.SavedContact[] | null> => {
    const found = await rotaKhatma(ctx, args.khatmaId);
    return found && ops.saved(ctx, found.khatma);
  },
});

export const addSaved = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    contactId: v.id("rotaContacts"),
    juz: v.optional(v.number()),
    readsToday: v.optional(v.boolean()),
  },
  handler: async (ctx, args): ReturnType<typeof ops.addSaved> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "addSaved",
      await ops.addSaved(ctx, khatma, rota, args),
    );
  },
});

// ---------------------------------------------------------------------------
// Joining

/** As `rota.ensureJoinLink`; recorded only when it draws a code. */
export const ensureJoinLink = adminMutation({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { khatma } = await requireLiveRota(ctx, args.khatmaId);
    if (khatma.joinCode !== undefined) return { ok: true };
    await ensureJoinCode(ctx, khatma);
    return audited(ctx, args, "ensureJoinLink", { ok: true });
  },
});

export const acceptJoinRequest = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    requestId: v.id("rotaJoinRequests"),
    juz: v.number(),
    name: v.optional(v.string()),
    readsToday: v.optional(v.boolean()),
  },
  handler: async (ctx, args): ReturnType<typeof ops.acceptJoinRequest> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    const result = await ops.acceptJoinRequest(ctx, khatma, rota, args);
    // A number added meanwhile is an error to the caller, yet the request was
    // closed and the person welcomed: that is a change to record.
    if ("error" in result && result.error === "already_added") {
      await record(ctx, args, "acceptJoinRequest");
      return result;
    }
    return audited(ctx, args, "acceptJoinRequest", result);
  },
});

export const declineJoinRequest = adminMutation({
  args: { khatmaId: v.id("khatmas"), requestId: v.id("rotaJoinRequests") },
  handler: async (ctx, args): ReturnType<typeof ops.declineJoinRequest> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "declineJoinRequest",
      await ops.declineJoinRequest(ctx, khatma, rota, args),
    );
  },
});

// ---------------------------------------------------------------------------
// Today

export const today = adminQuery({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args): Promise<ops.TodayView | null> => {
    const found = await rotaKhatma(ctx, args.khatmaId);
    return found && ops.today(ctx, found.khatma, found.rota, ADMIN);
  },
});

export const reassign = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    readId: v.id("rotaReads"),
    participantId: v.id("rotaParticipants"),
  },
  handler: async (ctx, args): ReturnType<typeof ops.reassign> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "reassign",
      await ops.reassign(ctx, khatma, rota, args),
    );
  },
});

export const markDone = adminMutation({
  args: { khatmaId: v.id("khatmas"), readId: v.id("rotaReads") },
  handler: async (ctx, args): ReturnType<typeof ops.markDone> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    const read = await ctx.db.get(args.readId);
    return audited(
      ctx,
      args,
      "markDone",
      await ops.markDone(ctx, khatma, rota, args, ADMIN),
      read?.doneAt === null,
    );
  },
});

export const markNotDone = adminMutation({
  args: { khatmaId: v.id("khatmas"), readId: v.id("rotaReads") },
  handler: async (ctx, args): ReturnType<typeof ops.markNotDone> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    const read = await ctx.db.get(args.readId);
    return audited(
      ctx,
      args,
      "markNotDone",
      await ops.markNotDone(ctx, khatma, rota, args),
      read?.doneAt !== null,
    );
  },
});

// ---------------------------------------------------------------------------
// Settings

export const settings = adminQuery({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args): Promise<ops.SettingsView | null> => {
    const found = await rotaKhatma(ctx, args.khatmaId);
    return found && ops.settings(ctx, found.khatma, found.rota);
  },
});

export const update = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    name: v.optional(v.union(v.string(), v.null())),
    days: v.optional(readingDaysValidator),
    firstDate: v.optional(v.string()),
    endDate: v.optional(v.union(v.string(), v.null())),
    timeZone: v.optional(v.string()),
    messages: v.optional(rotaMessagesValidator),
    lateTapMs: v.optional(v.union(v.number(), v.null())),
    cheer: v.optional(v.union(cheerConfigValidator, v.null())),
  },
  handler: async (ctx, args): ReturnType<typeof ops.update> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "update",
      await ops.update(ctx, khatma, rota, args),
    );
  },
});

export const setPaused = adminMutation({
  args: { khatmaId: v.id("khatmas"), paused: v.boolean() },
  handler: async (ctx, args): ReturnType<typeof ops.setPaused> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "setPaused",
      await ops.setPaused(ctx, khatma, rota, args),
      args.paused !== (rota.pausedAt !== null),
    );
  },
});

export const addPauseDate = adminMutation({
  args: { khatmaId: v.id("khatmas"), date: v.string() },
  handler: async (ctx, args): ReturnType<typeof ops.addPauseDate> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "addPauseDate",
      await ops.addPauseDate(ctx, khatma, rota, args),
      !rota.pauseDates.includes(args.date),
    );
  },
});

export const removePauseDate = adminMutation({
  args: { khatmaId: v.id("khatmas"), date: v.string() },
  handler: async (ctx, args): ReturnType<typeof ops.removePauseDate> => {
    const { khatma, rota } = await requireLiveRota(ctx, args.khatmaId);
    return audited(
      ctx,
      args,
      "removePauseDate",
      await ops.removePauseDate(ctx, khatma, rota, args),
      rota.pauseDates.includes(args.date),
    );
  },
});

// ---------------------------------------------------------------------------
// Archive and delete

/** Stops the khatma and leaves it read-only. Recorded only the first time. */
export const archive = adminMutation({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { khatma } = await requireRota(ctx, args.khatmaId);
    if (isArchived(khatma)) return { ok: true };
    await archiveKhatma(ctx, khatma);
    return audited(ctx, args, "archive", { ok: true });
  },
});

export const remove = adminMutation({
  args: { khatmaId: v.id("khatmas") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "not_archived" }> => {
    const { khatma } = await requireRota(ctx, args.khatmaId);
    if (!isArchived(khatma)) return { error: "not_archived" };
    await deleteKhatma(ctx, khatma);
    return audited(ctx, args, "remove", { ok: true });
  },
});
