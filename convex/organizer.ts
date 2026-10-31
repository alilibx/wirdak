import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { activeMembership } from "./khatmas";
import {
  cheerConfigValidator,
  cheerSetting,
  isValidCheer,
  type CheerSetting,
} from "./lib/cheer";
import { randomToken } from "./lib/crypto";
import { graceValidator, isValidGrace, type Grace } from "./lib/grace";
import { isArchived, khatmaByInviteCode } from "./lib/khatma";
import { scheduleValidator, type Schedule } from "./lib/schedule";
import type { SessionContext } from "./lib/session";
import { sessionMutation, sessionQuery } from "./lib/session";
import { getSetting } from "./lib/settings";
import { cleanKhatmaName } from "./lib/text";
import { clearNotes, notify } from "./notes";
import { heldAssignment, roundAssignments } from "./rounds";

/** Khatmas looked at per sweep page; each handover is decided in its own mutation. */
const SWEEP_PAGE = 50;
/** Attempts at drawing an unused invite code; a collision is ~1e-20 likely. */
const INVITE_CODE_ATTEMPTS = 3;

export type OrganizerSettings = {
  name: string | null;
  schedule: Schedule;
  grace: Grace;
  suggestedGrace: Grace;
  members: {
    memberId: Id<"members">;
    displayName: string;
    isOrganizer: boolean;
  }[];
  blocked: { memberId: Id<"members">; displayName: string }[];
  cheer: CheerSetting;
  /** An archived khatma can only be read, and deleted. */
  archived: boolean;
};

// ---------------------------------------------------------------------------
// Authority

/**
 * The khatma behind `inviteCode` when `person` is its organizer and still an
 * active member of it; otherwise `null`. A removed organizer holds no controls.
 */
export async function organizerOf(
  ctx: QueryCtx,
  inviteCode: string,
  person: Doc<"people"> | null,
): Promise<{ person: Doc<"people">; khatma: Doc<"khatmas"> } | null> {
  if (!person) return null;
  const khatma = await khatmaByInviteCode(ctx, inviteCode);
  if (!khatma || khatma.creatorPersonId !== person._id) return null;
  if (!(await activeMembership(ctx, khatma._id, person._id))) return null;
  return { person, khatma };
}

/** The caller and their khatma, or `forbidden` unless they are its active organizer. */
export async function requireOrganizer(
  ctx: QueryCtx & SessionContext,
  inviteCode: string,
): Promise<{ person: Doc<"people">; khatma: Doc<"khatmas"> }> {
  const found = await organizerOf(ctx, inviteCode, ctx.person);
  if (!found) throw new ConvexError({ code: "forbidden" });
  return found;
}

/** Refuses a change to an archived khatma, which stays read-only. */
function refuseArchived(khatma: Doc<"khatmas">): void {
  if (isArchived(khatma)) throw new ConvexError({ code: "archived" });
}

/**
 * `requireOrganizer` for a change to the khatma: `archived` once it is archived.
 * Reading it, archiving and deleting it use `requireOrganizer` instead.
 */
async function requireLiveOrganizer(
  ctx: QueryCtx & SessionContext,
  inviteCode: string,
): Promise<{ person: Doc<"people">; khatma: Doc<"khatmas"> }> {
  const found = await requireOrganizer(ctx, inviteCode);
  refuseArchived(found.khatma);
  return found;
}

/**
 * `requireLiveOrganizer` for the pool khatma's own controls (settings, invite
 * reset, handover), which a rota khatma doesn't have: `forbidden` there too.
 */
async function requirePoolOrganizer(
  ctx: QueryCtx & SessionContext,
  inviteCode: string,
): Promise<{ person: Doc<"people">; khatma: Doc<"khatmas"> }> {
  const found = await requireLiveOrganizer(ctx, inviteCode);
  if (found.khatma.kind === "rota") {
    throw new ConvexError({ code: "forbidden" });
  }
  return found;
}

export async function membersByJoin(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<Doc<"members">[]> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
    .collect();
  return members.sort(
    (a, b) => a.joinedAt - b.joinedAt || a._creationTime - b._creationTime,
  );
}

// ---------------------------------------------------------------------------
// Settings

/**
 * What the organizer's settings sheet shows: names, never numbers (spec 6.1).
 * No phone, pace, or reading data leaves this query.
 */
export const settings = sessionQuery({
  args: { inviteCode: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<OrganizerSettings | { forbidden: true }> => {
    const found = await organizerOf(ctx, args.inviteCode, ctx.person);
    if (!found) return { forbidden: true };
    const { khatma } = found;

    const members: OrganizerSettings["members"] = [];
    const blocked: OrganizerSettings["blocked"] = [];
    for (const member of await membersByJoin(ctx, khatma._id)) {
      if (member.status === "former") continue;
      const person = await ctx.db.get(member.personId);
      if (!person) continue;
      if (member.status === "blocked") {
        blocked.push({ memberId: member._id, displayName: person.displayName });
      } else {
        members.push({
          memberId: member._id,
          displayName: person.displayName,
          isOrganizer: member.personId === khatma.creatorPersonId,
        });
      }
    }
    return {
      name: khatma.name,
      schedule: khatma.schedule,
      grace: khatma.grace,
      suggestedGrace: (await getSetting(ctx, "graceDefaults"))[khatma.schedule],
      members,
      blocked,
      cheer: await cheerSetting(ctx, khatma),
      archived: isArchived(khatma),
    };
  },
});

/**
 * Renames the khatma and changes its schedule and grace. A new schedule
 * applies from the next round (`insertRound` reads it); holds in progress keep
 * the grace they started with. An invalid grace refuses the whole call.
 */
export const update = sessionMutation({
  args: {
    inviteCode: v.string(),
    name: v.optional(v.union(v.string(), v.null())),
    schedule: v.optional(scheduleValidator),
    grace: v.optional(graceValidator),
    /** The khatma's own cheer settings; null goes back to the admin's defaults. */
    cheer: v.optional(v.union(cheerConfigValidator, v.null())),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true } | { ok: false; reason: "invalid_grace" | "invalid_cheer" }
  > => {
    const { khatma } = await requirePoolOrganizer(ctx, args.inviteCode);
    if (args.grace && !isValidGrace(args.grace)) {
      return { ok: false, reason: "invalid_grace" };
    }
    if (args.cheer && !isValidCheer(args.cheer)) {
      return { ok: false, reason: "invalid_cheer" };
    }
    await ctx.db.patch(khatma._id, {
      ...(args.name !== undefined ? { name: cleanKhatmaName(args.name) } : {}),
      ...(args.schedule !== undefined ? { schedule: args.schedule } : {}),
      ...(args.grace !== undefined ? { grace: args.grace } : {}),
      ...(args.cheer !== undefined ? { cheer: args.cheer ?? undefined } : {}),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Invite reset

/** The organizer's check for `resetInvite`, run before any secret is drawn. */
export const activeMemberCount = internalQuery({
  args: { personId: v.id("people"), inviteCode: v.string() },
  handler: async (ctx, args): Promise<number> => {
    const person = await ctx.db.get(args.personId);
    const found = await organizerOf(ctx, args.inviteCode, person);
    if (!found || found.khatma.kind === "rota") {
      throw new ConvexError({ code: "forbidden" });
    }
    refuseArchived(found.khatma);
    return (await membersByJoin(ctx, found.khatma._id)).filter(
      (m) => m.status === "active",
    ).length;
  },
});

/**
 * Swaps the invite code and every share token at once, so a leaked link and
 * every link made from it stops working. `null` when `newInviteCode` is taken.
 * Active members get the fresh tokens in join order (one that joined since the
 * action counted them gets none and makes its own); non-active rows get none.
 */
export const applyInviteReset = internalMutation({
  args: {
    personId: v.id("people"),
    inviteCode: v.string(),
    newInviteCode: v.string(),
    shareTokens: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ inviteCode: string } | null> => {
    const person = await ctx.db.get(args.personId);
    const found = await organizerOf(ctx, args.inviteCode, person);
    if (!found || found.khatma.kind === "rota") {
      throw new ConvexError({ code: "forbidden" });
    }
    refuseArchived(found.khatma);
    const { khatma } = found;

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
    return { inviteCode: args.newInviteCode };
  },
});

/**
 * Gives a khatma a new invite code and each active member a new share link,
 * so every old link dies. False when the code is taken (draw another one).
 * Shared by the organizer and the admin panel.
 */
export async function resetInviteCode(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  newInviteCode: string,
  shareTokens: string[],
): Promise<boolean> {
  const taken = await ctx.db
    .query("khatmas")
    .withIndex("by_inviteCode", (q) => q.eq("inviteCode", newInviteCode))
    .first();
  if (taken) return false;
  await ctx.db.patch(khatma._id, { inviteCode: newInviteCode });
  let next = 0;
  for (const member of await membersByJoin(ctx, khatma._id)) {
    const shareToken =
      member.status === "active" ? shareTokens[next++] : undefined;
    await ctx.db.patch(member._id, { shareToken });
  }
  return true;
}

/**
 * Makes `member` the organizer and tells them; with `previous`, tells the
 * old organizer too. Shared by the organizer, the 30-day sweep and admins.
 * Only an admin reaches an archived khatma here, and that sends nothing.
 */
export async function handOverTo(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  member: Doc<"members">,
  previous: Doc<"people"> | null,
): Promise<void> {
  await ctx.db.patch(khatma._id, { creatorPersonId: member.personId });
  if (isArchived(khatma)) return;
  await notify(ctx, {
    personId: member.personId,
    khatmaId: khatma._id,
    kind: "nowOrganizer",
  });
  if (previous) {
    await notify(ctx, {
      personId: previous._id,
      khatmaId: khatma._id,
      kind: "organizerMoved",
    });
  }
}

export const resetInvite = action({
  args: { sessionToken: v.optional(v.string()), inviteCode: v.string() },
  handler: async (ctx, args): Promise<{ inviteCode: string }> => {
    const personId = await ctx.runQuery(internal.khatmas.personIdForToken, {
      sessionToken: args.sessionToken,
    });
    if (!personId) throw new ConvexError({ code: "forbidden" });
    const count = await ctx.runQuery(internal.organizer.activeMemberCount, {
      personId,
      inviteCode: args.inviteCode,
    });
    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
      const reset = await ctx.runMutation(internal.organizer.applyInviteReset, {
        personId,
        inviteCode: args.inviteCode,
        newInviteCode: randomToken(9),
        shareTokens: Array.from({ length: count }, () => randomToken(8)),
      });
      if (reset) return reset;
    }
    throw new Error("could not allocate an invite code");
  },
});

// ---------------------------------------------------------------------------
// Members

/** A member of this khatma who is not the organizer, or the reason they aren't one. */
export async function otherMember(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  memberId: Id<"members">,
  status: Doc<"members">["status"],
): Promise<Doc<"members"> | "self" | "not_member"> {
  const member = await ctx.db.get(memberId);
  if (!member || member.khatmaId !== khatma._id || member.status !== status) {
    return "not_member";
  }
  return member.personId === khatma.creatorPersonId ? "self" : member;
}

/**
 * Removes a member (a leaked link, the wrong person). They are blocked, their
 * share link dies, and the juz' they held goes back to the pool quietly: no
 * organizer alert, since the organizer did it. Their notes here are cleared,
 * and so is any open-for-help alert for that juz'.
 */
export const removeMember = sessionMutation({
  args: { inviteCode: v.string(), memberId: v.id("members") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { ok: false; reason: "self" | "not_member" }> => {
    const { khatma } = await requireLiveOrganizer(ctx, args.inviteCode);
    const member = await otherMember(ctx, khatma, args.memberId, "active");
    if (typeof member === "string") return { ok: false, reason: member };

    await ctx.db.patch(member._id, {
      status: "blocked",
      shareToken: undefined,
    });

    if (khatma.currentRoundId) {
      const held = heldAssignment(
        await roundAssignments(ctx, khatma.currentRoundId),
        member.personId,
      );
      if (held) {
        await ctx.db.patch(held._id, {
          releasedAt: Date.now(),
          releasedBySystem: true,
        });
        await clearNotes(ctx, {
          khatmaId: khatma._id,
          kind: "openForHelp",
          juz: held.juz,
        });
      }
    }
    await clearPersonNotes(ctx, member.personId, khatma._id);
    return { ok: true };
  },
});

async function clearPersonNotes(
  ctx: MutationCtx,
  personId: Id<"people">,
  khatmaId: Id<"khatmas">,
): Promise<void> {
  const now = Date.now();
  const notes = await ctx.db
    .query("notes")
    .withIndex("by_person_khatma", (q) =>
      q.eq("personId", personId).eq("khatmaId", khatmaId).eq("clearedAt", null),
    )
    .collect();
  for (const note of notes) await ctx.db.patch(note._id, { clearedAt: now });
}

/** Lets a blocked person back in: they become a former member and may join again. */
export const unblock = sessionMutation({
  args: { inviteCode: v.string(), memberId: v.id("members") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const { khatma } = await requireLiveOrganizer(ctx, args.inviteCode);
    const member = await ctx.db.get(args.memberId);
    if (
      !member ||
      member.khatmaId !== khatma._id ||
      member.status !== "blocked"
    ) {
      return { ok: false };
    }
    await ctx.db.patch(member._id, { status: "former" });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Handover

export const handOver = sessionMutation({
  args: { inviteCode: v.string(), memberId: v.id("members") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { ok: false; reason: "not_member" | "self" }> => {
    const { khatma } = await requirePoolOrganizer(ctx, args.inviteCode);
    const member = await otherMember(ctx, khatma, args.memberId, "active");
    if (typeof member === "string") return { ok: false, reason: member };
    // The organizer chose this, so they get no "moved" note.
    await handOverTo(ctx, khatma, member, null);
    return { ok: true };
  },
});

/**
 * Daily: pages through every khatma and schedules a handover check for each
 * one not archived whose organizer has been away longer than `organizerInactiveMs`.
 * Paginated, and one mutation per khatma, like the behind sweep.
 */
export const autoHandoverSweep = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("khatmas")
      .paginate({ numItems: SWEEP_PAGE, cursor: args.cursor ?? null });
    const cutoff = Date.now() - (await getSetting(ctx, "organizerInactiveMs"));
    for (const khatma of page.page) {
      // a rota khatma keeps its organizer: readers are not members to hand it to
      if (khatma.kind === "rota" || isArchived(khatma)) continue;
      const organizer = await ctx.db.get(khatma.creatorPersonId);
      if (organizer && organizer.lastSeenAt >= cutoff) continue;
      await ctx.scheduler.runAfter(0, internal.organizer.autoHandover, {
        khatmaId: khatma._id,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.organizer.autoHandoverSweep, {
        cursor: page.continueCursor,
      });
    }
  },
});

/**
 * Hands a khatma to its earliest-joined active member seen within
 * `successorActiveMs` when its organizer has been away too long. With nobody
 * to hand it to, nothing changes: the khatma waits for its organizer.
 */
export const autoHandover = internalMutation({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args) => {
    const khatma = await ctx.db.get(args.khatmaId);
    if (!khatma || khatma.kind === "rota" || isArchived(khatma)) return;
    const now = Date.now();
    const organizer = await ctx.db.get(khatma.creatorPersonId);
    if (
      organizer &&
      organizer.lastSeenAt >=
        now - (await getSetting(ctx, "organizerInactiveMs"))
    ) {
      return;
    }

    const activeSince = now - (await getSetting(ctx, "successorActiveMs"));
    for (const member of await membersByJoin(ctx, khatma._id)) {
      if (member.status !== "active") continue;
      if (member.personId === khatma.creatorPersonId) continue;
      const person = await ctx.db.get(member.personId);
      if (!person || person.lastSeenAt < activeSince) continue;

      await handOverTo(ctx, khatma, member, organizer);
      return;
    }
  },
});
