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
import {
  cheerConfigValidator,
  cheerSetting,
  isValidCheer,
  type CheerSetting,
} from "./lib/cheer";
import { randomToken } from "./lib/crypto";
import { nameFields, refreshPerson } from "./lib/directory";
import {
  accessOf,
  allows,
  roleIn,
  type Need,
  type OrganizerAccess,
  type OrganizerRole,
} from "./lib/organizerAuth";
import { graceValidator, isValidGrace, type Grace } from "./lib/grace";
import { isArchived, khatmaByInviteCode } from "./lib/khatma";
import { scheduleValidator, type Schedule } from "./lib/schedule";
import type { SessionContext } from "./lib/session";
import { sessionMutation, sessionQuery } from "./lib/session";
import { getSetting } from "./lib/settings";
import { cleanKhatmaName } from "./lib/text";
import {
  endCoOrganizer,
  ensureRotaMembership,
  keepOldOwner,
  liveParticipant,
  personByPhone,
} from "./coOrganizers";
import { activeMembership } from "./khatmas";
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
    /** Named by the owner to help run the khatma; always false unless the caller has People. */
    isCoOrganizer: boolean;
  }[];
  blocked: { memberId: Id<"members">; displayName: string }[];
  cheer: CheerSetting;
  /** An archived khatma can only be read, and deleted. */
  archived: boolean;
  /** What the caller may do here, so the page shows only those controls. */
  access: OrganizerAccess;
};

// ---------------------------------------------------------------------------
// Authority

/**
 * The khatma behind `inviteCode` when `person` holds a role in it that meets
 * `need`; otherwise `null`. The default `"owner"` is the owner alone, and a
 * removed owner holds no controls.
 */
export async function organizerOf(
  ctx: QueryCtx,
  inviteCode: string,
  person: Doc<"people"> | null,
  need: Need = "owner",
): Promise<{
  person: Doc<"people">;
  khatma: Doc<"khatmas">;
  role: OrganizerRole;
} | null> {
  if (!person) return null;
  const khatma = await khatmaByInviteCode(ctx, inviteCode);
  if (!khatma) return null;
  const role = await roleIn(ctx, khatma, person);
  if (!role || !allows(role, need)) return null;
  return { person, khatma, role };
}

type Organizer = {
  person: Doc<"people">;
  khatma: Doc<"khatmas">;
  role: OrganizerRole;
};

/** The caller and their khatma, or `forbidden` unless their role meets `need`. */
export async function requireOrganizer(
  ctx: QueryCtx & SessionContext,
  inviteCode: string,
  need: Need = "owner",
): Promise<Organizer> {
  const found = await organizerOf(ctx, inviteCode, ctx.person, need);
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
export async function requireLiveOrganizer(
  ctx: QueryCtx & SessionContext,
  inviteCode: string,
  need: Need = "owner",
): Promise<Organizer> {
  const found = await requireOrganizer(ctx, inviteCode, need);
  refuseArchived(found.khatma);
  return found;
}

/**
 * `requireLiveOrganizer` for the pool khatma's own controls (settings, invite
 * reset, removing members), which a rota khatma doesn't have: `forbidden` there too.
 */
async function requirePoolOrganizer(
  ctx: QueryCtx & SessionContext,
  inviteCode: string,
  need: Need = "owner",
): Promise<Organizer> {
  const found = await requireLiveOrganizer(ctx, inviteCode, need);
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
 * No phone, pace, or reading data leaves this query. The owner and every
 * co-organizer get it, with `access` saying which controls are theirs.
 */
export const settings = sessionQuery({
  args: { inviteCode: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<OrganizerSettings | { forbidden: true }> => {
    const khatma = ctx.person
      ? await khatmaByInviteCode(ctx, args.inviteCode)
      : null;
    // A rota khatma has its own settings (`rota.settings`).
    const access =
      khatma &&
      khatma.kind !== "rota" &&
      accessOf(await roleIn(ctx, khatma, ctx.person));
    if (!khatma || !access) return { forbidden: true };

    const members: OrganizerSettings["members"] = [];
    const blocked: OrganizerSettings["blocked"] = [];
    // Who the co-organizers are follows the People switch, like the blocked list (spec 4.3, 4.6).
    const coOrganizerPhones = new Set(
      access.owner || access.people
        ? (
            await ctx.db
              .query("coOrganizers")
              .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
              .collect()
          ).map((row) => row.phone)
        : [],
    );
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
          isCoOrganizer:
            member.personId !== khatma.creatorPersonId &&
            coOrganizerPhones.has(person.phone),
        });
      }
    }
    return {
      name: khatma.name,
      schedule: khatma.schedule,
      grace: khatma.grace,
      suggestedGrace: (await getSetting(ctx, "graceDefaults"))[khatma.schedule],
      members,
      // Seeing who is blocked follows the People switch (spec 4.3).
      blocked: access.people ? blocked : [],
      cheer: await cheerSetting(ctx, khatma),
      archived: isArchived(khatma),
      access,
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
    const { khatma } = await requirePoolOrganizer(
      ctx,
      args.inviteCode,
      "settings",
    );
    if (args.grace && !isValidGrace(args.grace)) {
      return { ok: false, reason: "invalid_grace" };
    }
    if (args.cheer && !isValidCheer(args.cheer)) {
      return { ok: false, reason: "invalid_cheer" };
    }
    await ctx.db.patch(khatma._id, {
      ...(args.name !== undefined
        ? nameFields(cleanKhatmaName(args.name))
        : {}),
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
    const found = await organizerOf(ctx, args.inviteCode, person, "people");
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
    const found = await organizerOf(ctx, args.inviteCode, person, "people");
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
 * Makes `member` the owner and tells them; with `previous`, tells the old
 * owner too. Shared by the owner, the 30-day sweep and admins. The new owner's
 * co-organizer role ends, and with `oldOwnerStaysOn` the old owner stays on as
 * a co-organizer with every switch (co-organizers spec 4.5). Only an admin
 * reaches an archived khatma here, and that sends nothing.
 */
export async function handOverTo(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  member: Doc<"members">,
  previous: Doc<"people"> | null,
): Promise<void> {
  const rota = khatma.rota;
  await ctx.db.patch(khatma._id, {
    creatorPersonId: member.personId,
    // The owner an admin set it up for never took it up; the new one has a
    // membership already, so no join message may make them owner again.
    ...(rota?.pendingOrganizer === true
      ? { rota: { ...rota, pendingOrganizer: false } }
      : {}),
  });
  // After the patch, so a rota owner keeps the membership the role gave them.
  const owner = await ctx.db.get(member.personId);
  if (owner) {
    await endCoOrganizer(ctx, khatma._id, owner.phone);
    if (khatma.kind === "rota") {
      // A participant added by phone has no account on their row: the owner's
      // own row must name them, or the owner checks miss them.
      const row = await liveParticipant(ctx, khatma._id, owner.phone);
      if (row && row.personId !== owner._id) {
        await ctx.db.patch(row._id, { personId: owner._id });
      }
    }
  }
  const oldOwner = await ctx.db.get(khatma.creatorPersonId);
  if (oldOwner) {
    const stays =
      (await getSetting(ctx, "oldOwnerStaysOn")) &&
      (await keepOldOwner(ctx, khatma, oldOwner));
    if (!stays && khatma.kind === "rota") {
      // A rota membership means owner or co-organizer, as `endCoOrganizer` keeps it.
      const membership = await ctx.db
        .query("members")
        .withIndex("by_khatma_person", (q) =>
          q.eq("khatmaId", khatma._id).eq("personId", oldOwner._id),
        )
        .first();
      if (membership) await ctx.db.delete(membership._id);
    }
  }
  await refreshPerson(ctx, khatma.creatorPersonId);
  await refreshPerson(ctx, member.personId);
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

/** Who a transfer names: a member, or in a rota khatma a participant. */
export const transferArgs = {
  memberId: v.optional(v.id("members")),
  participantId: v.optional(v.id("rotaParticipants")),
};
type TransferTarget = {
  memberId?: Id<"members">;
  participantId?: Id<"rotaParticipants">;
};

/**
 * The membership a transfer hands `khatma` to, or why there is none. In a pool
 * khatma, an active member (`memberId`). In a rota khatma, a live participant
 * with an account, by `participantId` or by the membership a co-organizer has
 * (`memberId`); one who hasn't signed in yet is `no_account`, because
 * ownership can't wait for a sign-in (spec 4.5). A rota participant gets their
 * membership here, and only once nothing refuses the transfer.
 */
export async function transferTarget(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  target: TransferTarget,
  caller: { owner: true } | "admin",
): Promise<Doc<"members"> | "self" | "not_member" | "no_account"> {
  if (
    (target.memberId === undefined) ===
    (target.participantId === undefined)
  ) {
    return "not_member";
  }
  if (khatma.kind !== "rota") {
    if (target.memberId === undefined) return "not_member";
    return await otherMember(ctx, khatma, target.memberId, "active", caller);
  }
  if (target.memberId !== undefined) {
    const member = await otherMember(
      ctx,
      khatma,
      target.memberId,
      "active",
      caller,
    );
    if (typeof member === "string") return member;
    const person = await ctx.db.get(member.personId);
    if (!person || !(await liveParticipant(ctx, khatma._id, person.phone))) {
      return "not_member";
    }
    return member;
  }

  const participant = await ctx.db.get(target.participantId!);
  if (
    !participant ||
    participant.khatmaId !== khatma._id ||
    participant.removedAt !== null
  ) {
    return "not_member";
  }
  const owner = await ctx.db.get(khatma.creatorPersonId);
  if (
    participant.personId === khatma.creatorPersonId ||
    participant.phone === owner?.phone
  ) {
    return "self";
  }
  const person = await personByPhone(ctx, participant.phone);
  if (!person) return "no_account";
  await ensureRotaMembership(ctx, khatma, person);
  return (await activeMembership(ctx, khatma._id, person._id)) ?? "not_member";
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

/**
 * A member of this khatma who is not the organizer, or the reason they aren't
 * one. A `caller` who isn't the owner (a co-organizer) gets `is_organizer` for
 * the owner and for every co-organizer: only the owner changes who else runs
 * the khatma (spec 4.2). An admin passes `"admin"`.
 */
export async function otherMember(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  memberId: Id<"members">,
  status: Doc<"members">["status"],
  caller: { owner: true } | "admin",
): Promise<Doc<"members"> | "self" | "not_member">;
export async function otherMember(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  memberId: Id<"members">,
  status: Doc<"members">["status"],
  caller: OrganizerRole | "admin",
): Promise<Doc<"members"> | "self" | "not_member" | "is_organizer">;
export async function otherMember(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  memberId: Id<"members">,
  status: Doc<"members">["status"],
  caller: OrganizerRole | "admin",
): Promise<Doc<"members"> | "self" | "not_member" | "is_organizer"> {
  const member = await ctx.db.get(memberId);
  if (!member || member.khatmaId !== khatma._id || member.status !== status) {
    return "not_member";
  }
  const byOwner = caller === "admin" || caller.owner;
  if (member.personId === khatma.creatorPersonId) {
    return byOwner ? "self" : "is_organizer";
  }
  if (!byOwner) {
    const person = await ctx.db.get(member.personId);
    const named =
      person &&
      (await ctx.db
        .query("coOrganizers")
        .withIndex("by_khatma_phone", (q) =>
          q.eq("khatmaId", khatma._id).eq("phone", person.phone),
        )
        .first());
    if (named) return "is_organizer";
  }
  return member;
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
  ): Promise<
    { ok: true } | { ok: false; reason: "self" | "not_member" | "is_organizer" }
  > => {
    // A rota khatma removes participants instead (`rota.removeParticipant`).
    const { khatma, role } = await requirePoolOrganizer(
      ctx,
      args.inviteCode,
      "people",
    );
    const member = await otherMember(
      ctx,
      khatma,
      args.memberId,
      "active",
      role,
    );
    if (typeof member === "string") return { ok: false, reason: member };
    await blockMember(ctx, khatma, member);
    return { ok: true };
  },
});

/**
 * What removing a member does, for `removeMember` and the admin's own. A
 * co-organizer's role ends with their place, and coming back doesn't restore it.
 */
export async function blockMember(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  member: Doc<"members">,
): Promise<void> {
  await ctx.db.patch(member._id, {
    status: "blocked",
    shareToken: undefined,
  });
  await refreshPerson(ctx, member.personId);
  const person = await ctx.db.get(member.personId);
  if (person) await endCoOrganizer(ctx, khatma._id, person.phone);

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
}

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
    const { khatma } = await requireLiveOrganizer(
      ctx,
      args.inviteCode,
      "people",
    );
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

/**
 * The owner transfers the khatma (spec 4.5): to an active member of a pool
 * khatma, or to a participant of a rota khatma who has an account.
 */
export const handOver = sessionMutation({
  args: { inviteCode: v.string(), ...transferArgs },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true } | { ok: false; reason: "not_member" | "self" | "no_account" }
  > => {
    const { khatma } = await requireLiveOrganizer(
      ctx,
      args.inviteCode,
      "owner",
    );
    // Only the owner gets here.
    const member = await transferTarget(ctx, khatma, args, { owner: true });
    if (typeof member === "string") return { ok: false, reason: member };
    // The owner chose this, so they get no "moved" note.
    await handOverTo(ctx, khatma, member, null);
    return { ok: true };
  },
});

/**
 * Daily: pages through every khatma and schedules a handover check for each
 * one not archived whose organizer has been away longer than `organizerInactiveMs`.
 * Rota khatmas are skipped while `handoverToCoOrganizerOn` is off.
 * Paginated, and one mutation per khatma, like the behind sweep.
 */
export const autoHandoverSweep = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("khatmas")
      .paginate({ numItems: SWEEP_PAGE, cursor: args.cursor ?? null });
    const cutoff = Date.now() - (await getSetting(ctx, "organizerInactiveMs"));
    const toCoOrganizers = await getSetting(ctx, "handoverToCoOrganizerOn");
    for (const khatma of page.page) {
      if (isArchived(khatma)) continue;
      // Without co-organizers to take it, a rota khatma keeps its organizer.
      if (khatma.kind === "rota" && !toCoOrganizers) continue;
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
 * Hands a khatma whose organizer has been away too long to someone seen within
 * `successorActiveMs`: with `handoverToCoOrganizerOn`, first the longest-serving
 * co-organizer with an account (spec 4.5). A pool khatma then falls back to its
 * earliest-joined active member; a rota khatma has no fallback. With nobody to
 * hand it to, nothing changes: the khatma waits for its organizer.
 */
export const autoHandover = internalMutation({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args) => {
    const khatma = await ctx.db.get(args.khatmaId);
    if (!khatma || isArchived(khatma)) return;
    const toCoOrganizers = await getSetting(ctx, "handoverToCoOrganizerOn");
    if (khatma.kind === "rota" && !toCoOrganizers) return;
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
    if (toCoOrganizers) {
      const member = await coOrganizerSuccessor(ctx, khatma, activeSince);
      if (member) {
        await handOverTo(ctx, khatma, member, organizer);
        return;
      }
    }
    if (khatma.kind === "rota") return;

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

/**
 * The membership of the longest-serving co-organizer who has an account, is
 * still in the khatma, and was seen since `activeSince`; or null. A rota one
 * gets the membership naming gives, if it is missing.
 */
async function coOrganizerSuccessor(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  activeSince: number,
): Promise<Doc<"members"> | null> {
  const rows = (
    await ctx.db
      .query("coOrganizers")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect()
  ).sort((a, b) => a.addedAt - b.addedAt || a._creationTime - b._creationTime);
  for (const row of rows) {
    const person = await personByPhone(ctx, row.phone);
    if (!person || person._id === khatma.creatorPersonId) continue;
    if (person.lastSeenAt < activeSince) continue;
    if (!(await roleIn(ctx, khatma, person))) continue;
    await ensureRotaMembership(ctx, khatma, person);
    const member = await activeMembership(ctx, khatma._id, person._id);
    if (member) return member;
  }
  return null;
}
