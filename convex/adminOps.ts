import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { normalizeAdminPhone } from "./admins";
import { adminMutation, resolveAdminSession } from "./lib/adminSession";
import { writeAudit } from "./lib/audit";
import { randomToken } from "./lib/crypto";
import { isArchived } from "./lib/khatma";
import { notify } from "./notes";
import { handOverTo, otherMember, resetInviteCode } from "./organizer";
import { deleteSession } from "./sessions";

const MAX_NOTE = 500;
const INVITE_CODE_ATTEMPTS = 3;

export function cleanNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim().slice(0, MAX_NOTE);
  return trimmed ? trimmed : undefined;
}

/** Ends every session of a person: push subscriptions and hand-off tokens go with them. */
async function endSessions(
  ctx: MutationCtx,
  personId: Id<"people">,
): Promise<number> {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_person", (q) => q.eq("personId", personId))
    .collect();
  for (const s of sessions) await deleteSession(ctx, s._id);
  return sessions.length;
}

export const signOutEverywhere = adminMutation({
  args: { personId: v.id("people"), note: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ ended: number } | { error: "not_found" }> => {
    const person = await ctx.db.get(args.personId);
    if (!person) return { error: "not_found" };
    const ended = await endSessions(ctx, person._id);
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "person.signOutAll",
      targetKind: "person",
      targetId: person._id,
      before: { sessions: ended },
      after: { sessions: 0 },
      note: cleanNote(args.note),
    });
    return { ended };
  },
});

/**
 * The khatma a person organizes that they joined last and that is still
 * running, or null. A note needs a khatma to sit in.
 */
async function newestOrganized(
  ctx: MutationCtx,
  personId: Id<"people">,
): Promise<Id<"khatmas"> | null> {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_person", (q) => q.eq("personId", personId))
    .collect();
  let newest: { id: Id<"khatmas">; createdAt: number } | null = null;
  for (const m of memberships) {
    if (m.status !== "active") continue;
    const khatma = await ctx.db.get(m.khatmaId);
    if (!khatma || khatma.creatorPersonId !== personId || isArchived(khatma)) {
      continue;
    }
    if (newest === null || khatma.createdAt > newest.createdAt) {
      newest = { id: khatma._id, createdAt: khatma.createdAt };
    }
  }
  return newest?.id ?? null;
}

/**
 * Lets a person create rotating khatmas, or takes that away (existing ones keep running).
 * Turning it on tells them, on their newest khatma; someone who organizes none
 * has nowhere to see the note and gets none.
 */
export const setRotaAllowed = adminMutation({
  args: {
    personId: v.id("people"),
    allowed: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "not_found" }> => {
    const person = await ctx.db.get(args.personId);
    if (!person) return { error: "not_found" };
    await ctx.db.patch(person._id, { rotaAllowed: args.allowed });
    if (args.allowed && person.rotaAllowed !== true) {
      const khatmaId = await newestOrganized(ctx, person._id);
      if (khatmaId !== null) {
        await notify(ctx, {
          personId: person._id,
          khatmaId,
          kind: "rotaEnabled",
        });
      }
    }
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "person.rotaAllowed",
      targetKind: "person",
      targetId: person._id,
      before: { rotaAllowed: person.rotaAllowed === true },
      after: { rotaAllowed: args.allowed },
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});

/** Blocks a number app-wide and signs it out everywhere. Khatmas and roles stay. */
export const blockPhone = adminMutation({
  args: { phone: v.string(), note: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true } | { error: "invalid_phone" | "already_blocked" | "is_admin" }
  > => {
    const phone = normalizeAdminPhone(args.phone);
    if (phone === null) return { error: "invalid_phone" };
    // A blocked admin couldn't sign in to undo it: remove them from admins first.
    const admin = await ctx.db
      .query("admins")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (admin) return { error: "is_admin" };
    const existing = await ctx.db
      .query("blockedPhones")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (existing) return { error: "already_blocked" };
    const note = cleanNote(args.note);
    await ctx.db.insert("blockedPhones", {
      phone,
      blockedBy: ctx.admin._id,
      at: Date.now(),
      note: note ?? null,
    });
    const person = await ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    const ended = person ? await endSessions(ctx, person._id) : 0;
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "phone.block",
      targetKind: "phone",
      targetId: phone,
      before: { blocked: false },
      after: { blocked: true, sessionsEnded: ended },
      note,
    });
    return { ok: true };
  },
});

export const unblockPhone = adminMutation({
  args: { phone: v.string(), note: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "invalid_phone" | "not_blocked" }> => {
    const phone = normalizeAdminPhone(args.phone);
    if (phone === null) return { error: "invalid_phone" };
    const existing = await ctx.db
      .query("blockedPhones")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (!existing) return { error: "not_blocked" };
    await ctx.db.delete(existing._id);
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "phone.unblock",
      targetKind: "phone",
      targetId: phone,
      before: { blocked: true },
      after: { blocked: false },
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});

export const activeMemberCount = internalQuery({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args): Promise<number | null> => {
    if (!(await ctx.db.get(args.khatmaId))) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", args.khatmaId))
      .collect();
    return members.filter((m) => m.status === "active").length;
  },
});

/** The organizer's reset, run by an admin; it checks the admin itself. */
export const applyInviteReset = internalMutation({
  args: {
    adminToken: v.string(),
    khatmaId: v.id("khatmas"),
    newInviteCode: v.string(),
    shareTokens: v.array(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ inviteCode: string } | { error: "not_found" } | null> => {
    const resolved = await resolveAdminSession(ctx, args.adminToken);
    if (!resolved) throw new ConvexError({ code: "not_admin" });
    const khatma = await ctx.db.get(args.khatmaId);
    if (!khatma) return { error: "not_found" };
    if (
      !(await resetInviteCode(
        ctx,
        khatma,
        args.newInviteCode,
        args.shareTokens,
      ))
    ) {
      return null;
    }
    await writeAudit(ctx, {
      actor: resolved.admin,
      action: "khatma.resetInvite",
      targetKind: "khatma",
      targetId: khatma._id,
      before: khatma.inviteCode,
      after: args.newInviteCode,
      note: cleanNote(args.note),
    });
    return { inviteCode: args.newInviteCode };
  },
});

/** A new invite link for a khatma whose link leaked (spec 8). */
export const resetInvite = action({
  args: {
    adminToken: v.string(),
    khatmaId: v.id("khatmas"),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ inviteCode: string } | { error: "not_found" }> => {
    if (
      !(await ctx.runQuery(api.adminAuth.me, { adminToken: args.adminToken }))
    ) {
      throw new ConvexError({ code: "not_admin" });
    }
    const count = await ctx.runQuery(internal.adminOps.activeMemberCount, {
      khatmaId: args.khatmaId,
    });
    if (count === null) return { error: "not_found" };
    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
      const res = await ctx.runMutation(internal.adminOps.applyInviteReset, {
        adminToken: args.adminToken,
        khatmaId: args.khatmaId,
        newInviteCode: randomToken(9),
        shareTokens: Array.from({ length: count }, () => randomToken(8)),
        note: args.note,
      });
      if (res) return res;
    }
    throw new Error("could not allocate an invite code");
  },
});

/** Hands the organizer role to another active member, telling both (spec 8). */
export const handOver = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    memberId: v.id("members"),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "not_found" | "not_member" | "self" }> => {
    const khatma = await ctx.db.get(args.khatmaId);
    if (!khatma) return { error: "not_found" };
    const member = await otherMember(ctx, khatma, args.memberId, "active");
    if (typeof member === "string") return { error: member };
    const previous = await ctx.db.get(khatma.creatorPersonId);
    await handOverTo(ctx, khatma, member, previous);
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "khatma.handOver",
      targetKind: "khatma",
      targetId: khatma._id,
      before: khatma.creatorPersonId,
      after: member.personId,
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});
