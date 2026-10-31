import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { randomToken } from "./lib/crypto";
import { nameFields, refreshPerson } from "./lib/directory";
import { isValidGrace, graceValidator, type Grace } from "./lib/grace";
import { JUZ, JUZ_COUNT } from "./lib/juz";
import { paceDays, personPace } from "./lib/pace";
import { isArchived, khatmaByInviteCode } from "./lib/khatma";
import { checkRateLimit } from "./lib/rateLimit";
import { khatmaJoinLink } from "./lib/rotaJoin";
import { lastRotaDay } from "./lib/rotaPlace";
import { scheduleValidator, type Schedule } from "./lib/schedule";
import { getSetting } from "./lib/settings";
import { resolveSession, sessionMutation, sessionQuery } from "./lib/session";
import { cleanKhatmaName } from "./lib/text";
import { suggestJuzInRound } from "./pool";
import { env } from "./whatsapp";
import {
  heldAssignment,
  insertRound,
  juzStates,
  roundAssignments,
} from "./rounds";

const DAY_MS = 86_400_000;
/** `randomToken(8)` is 11 base64url characters. */
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{11}$/;
/** Attempts at drawing an unused invite code; a collision is ~1e-20 likely. */
const INVITE_CODE_ATTEMPTS = 3;

export type TileView = {
  juz: number;
  name: string;
  state: "open" | "reading" | "done";
  readerName: string | null;
  isMine: boolean;
};

/** What the reader of a juz' sees about their own hold; never shown to others. */
export type HoldView = {
  openForHelp: boolean;
  canExtend: boolean;
  paceDays: number | null;
};

export type KhatmaView = {
  khatmaId: Id<"khatmas">;
  name: string | null;
  createdAt: number;
  schedule: Schedule;
  grace: Grace;
  isOrganizer: boolean;
  roundNumber: number;
  targetEndAt: number | null;
  completedRounds: number;
  archived: boolean;
  memberCount: number;
  lastCompleted: { roundNumber: number; participants: number } | null;
  inviterName: string | null;
  tiles: TileView[];
  me: {
    signedIn: boolean;
    /** The signed-in viewer's own name (null when signed out). */
    displayName: string | null;
    isMember: boolean;
    /** The viewer's notification switch; null for non-members. */
    notificationsOn: boolean | null;
    holding: number | null;
    hold: HoldView | null;
    suggestion: number | null;
    celebrateRound: number | null;
  };
};

// ---------------------------------------------------------------------------
// Shared helpers

/** The person's ACTIVE membership of a khatma; blocked members count as non-members. */
export async function activeMembership(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  personId: Id<"people">,
): Promise<Doc<"members"> | null> {
  const member = await ctx.db
    .query("members")
    .withIndex("by_khatma_person", (q) =>
      q.eq("khatmaId", khatmaId).eq("personId", personId),
    )
    .first();
  return member?.status === "active" ? member : null;
}

/**
 * The 30 tiles of a round. Reader names go only to members, only on "reading"
 * tiles (looked up in `readerNames`); `isMine` marks the viewer's own reading
 * assignment. A hold opened for help is an ordinary open tile to everyone but
 * its reader, who still sees it as theirs. Pure: callers load the assignments
 * and names.
 */
export function buildTiles(
  assignments: readonly Doc<"assignments">[],
  viewerIsMember: boolean,
  viewerPersonId: Id<"people"> | null,
  readerNames: ReadonlyMap<Id<"people">, string>,
  juzNames: readonly string[],
): TileView[] {
  const states = juzStates(assignments);
  const ownHeld =
    viewerIsMember && viewerPersonId !== null
      ? heldAssignment(assignments, viewerPersonId)
      : null;
  return Array.from({ length: JUZ_COUNT }, (_, i) => {
    const juz = i + 1;
    const found = states.get(juz);
    const own = ownHeld?.juz === juz ? ownHeld : null;
    const reading = found?.state === "reading" ? found.assignment : own;
    return {
      juz,
      name: juzNames[i] ?? "",
      state: found?.state ?? (own ? "reading" : "open"),
      readerName:
        viewerIsMember && reading
          ? (readerNames.get(reading.personId) ?? null)
          : null,
      isMine:
        viewerIsMember &&
        reading !== null &&
        viewerPersonId !== null &&
        reading.personId === viewerPersonId,
    };
  });
}

async function readerNamesFor(
  ctx: QueryCtx,
  assignments: readonly Doc<"assignments">[],
): Promise<Map<Id<"people">, string>> {
  const ids = new Set<Id<"people">>();
  for (const { state, assignment } of juzStates(assignments).values()) {
    if (state === "reading") ids.add(assignment.personId);
  }
  const names = new Map<Id<"people">, string>();
  for (const id of ids) {
    const person = await ctx.db.get(id);
    if (person) names.set(id, person.displayName);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Create

/** Resolves a raw session token to a person id. The client never supplies a person id. */
export const personIdForToken = internalQuery({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Id<"people"> | null> =>
    (await resolveSession(ctx, args.sessionToken)).person?._id ?? null,
});

/** Inserts khatma, round 1, and the creator's membership atomically. `null` on invite-code collision. */
export const insertKhatma = internalMutation({
  args: {
    personId: v.id("people"),
    name: v.union(v.string(), v.null()),
    schedule: scheduleValidator,
    /** Missing means the schedule's default grace. */
    grace: v.optional(graceValidator),
    inviteCode: v.string(),
    shareToken: v.string(),
  },
  handler: async (ctx, args): Promise<{ inviteCode: string } | null> => {
    if (await getSetting(ctx, "maintenanceMode")) {
      throw new ConvexError({ code: "maintenance" });
    }
    const person = await ctx.db.get(args.personId);
    if (!person) throw new ConvexError({ code: "not_signed_in" });

    const taken = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", args.inviteCode))
      .first();
    if (taken) return null;

    const allowed = await checkRateLimit(
      ctx,
      `khatmaCreate:${args.personId}`,
      await getSetting(ctx, "createsPerPersonPerDay"),
      DAY_MS,
    );
    if (!allowed) throw new ConvexError({ code: "rate_limited" });

    const now = Date.now();
    const khatmaId = await ctx.db.insert("khatmas", {
      ...nameFields(args.name),
      schedule: args.schedule,
      grace:
        args.grace ?? (await getSetting(ctx, "graceDefaults"))[args.schedule],
      creatorPersonId: args.personId,
      inviteCode: args.inviteCode,
      completedRounds: 0,
      createdAt: now,
    });
    await insertRound(ctx, khatmaId, 1, now);
    await ctx.db.insert("members", {
      khatmaId,
      personId: args.personId,
      joinedAt: now,
      shareToken: args.shareToken,
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    await refreshPerson(ctx, args.personId);
    return { inviteCode: args.inviteCode };
  },
});

async function requirePersonId(
  ctx: ActionCtx,
  sessionToken: string | undefined,
): Promise<Id<"people">> {
  const personId = await ctx.runQuery(internal.khatmas.personIdForToken, {
    sessionToken,
  });
  if (!personId) throw new ConvexError({ code: "not_signed_in" });
  return personId;
}

export const create = action({
  args: {
    sessionToken: v.optional(v.string()),
    name: v.union(v.string(), v.null()),
    schedule: scheduleValidator,
    grace: v.optional(graceValidator),
  },
  handler: async (ctx, args): Promise<{ inviteCode: string }> => {
    const personId = await requirePersonId(ctx, args.sessionToken);
    if (args.grace && !isValidGrace(args.grace)) {
      throw new ConvexError({ code: "invalid_grace" });
    }
    const name = cleanKhatmaName(args.name);
    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
      const created = await ctx.runMutation(internal.khatmas.insertKhatma, {
        personId,
        name,
        schedule: args.schedule,
        grace: args.grace,
        inviteCode: randomToken(9),
        shareToken: randomToken(8),
      });
      if (created) return created;
    }
    throw new Error("could not allocate an invite code");
  },
});

// ---------------------------------------------------------------------------
// View

export const view = sessionQuery({
  args: { inviteCode: v.string(), from: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<
    | KhatmaView
    | { notFound: true }
    | {
        rota: true;
        name: string | null;
        joinLink: string | null;
        archived: boolean;
      }
  > => {
    const khatma = await khatmaByInviteCode(ctx, args.inviteCode);
    if (khatma?.kind === "rota") {
      return {
        rota: true,
        name: khatma.name,
        joinLink: khatmaJoinLink(khatma, env("WHATSAPP_PUBLIC_NUMBER")),
        archived: isArchived(khatma),
      };
    }
    if (!khatma || !khatma.currentRoundId) return { notFound: true };
    const round = await ctx.db.get(khatma.currentRoundId);
    if (!round) return { notFound: true };

    const members = await ctx.db
      .query("members")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect();
    const active = members.filter((m) => m.status === "active");
    const personId = ctx.person?._id ?? null;
    const me = personId
      ? (active.find((m) => m.personId === personId) ?? null)
      : null;
    const isMember = me !== null;

    const assignments = await roundAssignments(ctx, round._id);
    const readerNames = isMember
      ? await readerNamesFor(ctx, assignments)
      : new Map<Id<"people">, string>();
    // the viewer's own hold, even one opened for help, carries their name
    if (isMember && ctx.person) {
      readerNames.set(ctx.person._id, ctx.person.displayName);
    }
    const tiles = buildTiles(
      assignments,
      isMember,
      personId,
      readerNames,
      JUZ.map((j) => j.name),
    );

    const held = me && personId ? heldAssignment(assignments, personId) : null;
    const holding = held?.juz ?? null;
    // Blocked members get no suggestion; viewers and non-members do (the UI
    // leads them into verification).
    const blocked =
      personId !== null &&
      members.some((m) => m.personId === personId && m.status === "blocked");
    const suggestion =
      holding === null && !blocked
        ? await suggestJuzInRound(ctx, round, assignments, personId)
        : null;

    let inviterName: string | null = null;
    if (args.from && SHARE_TOKEN_RE.test(args.from)) {
      const inviter = active.find((m) => m.shareToken === args.from);
      if (inviter) {
        inviterName = (await ctx.db.get(inviter.personId))?.displayName ?? null;
      }
    }

    return {
      khatmaId: khatma._id,
      name: khatma.name,
      createdAt: khatma.createdAt,
      schedule: khatma.schedule,
      grace: khatma.grace,
      isOrganizer: personId !== null && khatma.creatorPersonId === personId,
      roundNumber: round.number,
      targetEndAt: round.targetEndAt,
      completedRounds: khatma.completedRounds,
      archived: isArchived(khatma),
      memberCount: active.length,
      lastCompleted: await lastCompletedRound(ctx, khatma._id),
      inviterName,
      tiles,
      me: {
        signedIn: ctx.person !== null,
        displayName: ctx.person?.displayName ?? null,
        isMember,
        notificationsOn: me?.notificationsOn ?? null,
        holding,
        hold:
          held === null
            ? null
            : {
                openForHelp: held.openedForHelpAt !== null,
                canExtend:
                  held.noticeSentAt !== null &&
                  !held.extended &&
                  held.openedForHelpAt === null,
                paceDays: await heldPaceDays(ctx, held.personId),
              },
        suggestion,
        celebrateRound:
          me && me.lastCelebratedRound < khatma.completedRounds
            ? khatma.completedRounds
            : null,
      },
    };
  },
});

/** The reader's own pace in days; `null` until three finishes count. */
async function heldPaceDays(
  ctx: QueryCtx,
  personId: Id<"people">,
): Promise<number | null> {
  const pace = await personPace(ctx, personId);
  return pace.known ? paceDays(pace.paceMs) : null;
}

async function lastCompletedRound(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<{ roundNumber: number; participants: number } | null> {
  const round = await ctx.db
    .query("rounds")
    .withIndex("by_khatma_number", (q) => q.eq("khatmaId", khatmaId))
    .order("desc")
    .filter((q) => q.neq(q.field("completedAt"), null))
    .first();
  if (!round) return null;
  const finished = new Set<Id<"people">>();
  for (const a of await roundAssignments(ctx, round._id)) {
    if (a.finishedAt !== null) finished.add(a.personId);
  }
  return { roundNumber: round.number, participants: finished.size };
}

// ---------------------------------------------------------------------------
// Celebration

/**
 * Marks the latest completed round as celebrated for the caller, so
 * `view.me.celebrateRound` goes back to null. Never throws: signed-out
 * callers, unknown codes, non-members, and blocked members get `{ ok: false }`.
 */
export const markCelebrated = sessionMutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    if (!ctx.person) return { ok: false };
    const khatma = await khatmaByInviteCode(ctx, args.inviteCode);
    if (!khatma) return { ok: false };
    const member = await activeMembership(ctx, khatma._id, ctx.person._id);
    if (!member) return { ok: false };
    await ctx.db.patch(member._id, {
      lastCelebratedRound: khatma.completedRounds,
    });
    return { ok: true };
  },
});

/**
 * Turns notifications (pushes and nudges) on or off for the caller in one
 * khatma. Never throws: signed-out callers, unknown codes, non-members, and
 * blocked members get `{ ok: false }`.
 */
export const setNotifications = sessionMutation({
  args: { inviteCode: v.string(), on: v.boolean() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    if (!ctx.person) return { ok: false };
    const khatma = await khatmaByInviteCode(ctx, args.inviteCode);
    if (!khatma) return { ok: false };
    const member = await activeMembership(ctx, khatma._id, ctx.person._id);
    if (!member) return { ok: false };
    await ctx.db.patch(member._id, { notificationsOn: args.on });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Mine

/** How many ajza' are done in a rota khatma's open day; 0 with no open day. */
async function openRotaDayDone(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<number> {
  const day = await lastRotaDay(ctx, khatmaId);
  if (!day || day.closedAt !== null) return 0;
  const reads = await ctx.db
    .query("rotaReads")
    .withIndex("by_day_juz", (q) => q.eq("dayId", day._id))
    .collect();
  return reads.filter((r) => r.doneAt !== null).length;
}

export const mine = sessionQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.person) return [];
    const personId = ctx.person._id;
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_person", (q) => q.eq("personId", personId))
      .collect();
    const active = memberships
      .filter((m) => m.status === "active")
      .sort(
        (a, b) => b.joinedAt - a.joinedAt || b._creationTime - a._creationTime,
      );
    // One khatma and one round's assignments per membership, read in parallel.
    const cards = await Promise.all(
      active.map(async (m) => {
        const khatma = await ctx.db.get(m.khatmaId);
        if (!khatma) return null;
        const rota = khatma.kind === "rota";
        const assignments = khatma.currentRoundId
          ? await roundAssignments(ctx, khatma.currentRoundId)
          : [];
        const done = rota
          ? await openRotaDayDone(ctx, khatma._id)
          : [...juzStates(assignments).values()].filter(
              (s) => s.state === "done",
            ).length;
        const note = await ctx.db
          .query("notes")
          .withIndex("by_person_khatma", (q) =>
            q
              .eq("personId", personId)
              .eq("khatmaId", khatma._id)
              .eq("clearedAt", null),
          )
          .first();
        return {
          kind: rota ? ("rota" as const) : ("pool" as const),
          inviteCode: khatma.inviteCode,
          name: khatma.name,
          createdAt: khatma.createdAt,
          schedule: khatma.schedule,
          done,
          holding: rota
            ? null
            : (heldAssignment(assignments, personId)?.juz ?? null),
          hasNote: note !== null,
          archived: isArchived(khatma),
        };
      }),
    );
    return cards.filter((card) => card !== null);
  },
});

// ---------------------------------------------------------------------------
// Share token

/** Returns the member's share token, storing `candidate` first if they have none. */
export const storeShareToken = internalMutation({
  args: {
    personId: v.id("people"),
    inviteCode: v.string(),
    candidate: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const khatma = await khatmaByInviteCode(ctx, args.inviteCode);
    if (!khatma) throw new ConvexError({ code: "not_found" });
    const member = await activeMembership(ctx, khatma._id, args.personId);
    if (!member) throw new ConvexError({ code: "not_member" });
    if (member.shareToken) return member.shareToken;
    await ctx.db.patch(member._id, { shareToken: args.candidate });
    return args.candidate;
  },
});

export const ensureShareToken = action({
  args: { sessionToken: v.optional(v.string()), inviteCode: v.string() },
  handler: async (ctx, args): Promise<{ shareToken: string }> => {
    const personId = await requirePersonId(ctx, args.sessionToken);
    const shareToken = await ctx.runMutation(internal.khatmas.storeShareToken, {
      personId,
      inviteCode: args.inviteCode,
      candidate: randomToken(8),
    });
    return { shareToken };
  },
});
