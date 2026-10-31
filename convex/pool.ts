import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { scheduleCheer } from "./cheers";
import { alertOrganizer, isHeld, scheduleGrace } from "./grace";
import { graceTimes, graceWakingMs } from "./lib/grace";
import { JUZ_COUNT } from "./lib/juz";
import { personPace } from "./lib/pace";
import { isArchived, khatmaByInviteCode } from "./lib/khatma";
import { checkRateLimit } from "./lib/rateLimit";
import { getSetting, quietHours } from "./lib/settings";
import { addWakingMs, nextAwake, safeTimeZone } from "./lib/wakingTime";
import { clearNotes, notify } from "./notes";
import {
  requirePerson,
  sessionMutation,
  type SessionContext,
} from "./lib/session";
import {
  doneCount,
  heldAssignment,
  juzStates,
  roundAssignments,
} from "./rounds";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export type TakeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "taken"
        | "already_holding"
        | "khatma_full"
        | "blocked"
        | "maintenance"
        | "rate_limited";
    };

/**
 * The juz' to suggest to `personId` (or to a signed-out viewer when `null`):
 * the lowest-numbered open juz' they did not finish in their own last
 * `rotationLookbackRounds` rounds of this khatma, i.e. the most recent earlier
 * rounds in which they finished at least one juz' (spec 3.5). Falls back to the
 * lowest open juz'; `null` when none is open.
 */
export async function suggestJuz(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  personId: Id<"people"> | null,
): Promise<number | null> {
  const khatma = await ctx.db.get(khatmaId);
  if (!khatma?.currentRoundId) return null;
  const round = await ctx.db.get(khatma.currentRoundId);
  if (!round) return null;
  return suggestJuzInRound(
    ctx,
    round,
    await roundAssignments(ctx, round._id),
    personId,
  );
}

/**
 * `suggestJuz` for callers that already loaded the current round and its
 * assignment rows, so they are not read twice.
 */
export async function suggestJuzInRound(
  ctx: QueryCtx,
  round: Doc<"rounds">,
  assignments: readonly Doc<"assignments">[],
  personId: Id<"people"> | null,
): Promise<number | null> {
  const open = openJuz(assignments);
  const lowestOpen = open[0] ?? null;
  if (lowestOpen === null || personId === null) return lowestOpen;

  const lookback = await getSetting(ctx, "rotationLookbackRounds");
  const recentlyRead = await juzFinishedInRecentRounds(
    ctx,
    round.khatmaId,
    personId,
    round.number,
    lookback,
  );
  return open.find((juz) => !recentlyRead.has(juz)) ?? lowestOpen;
}

/** The ajza' of a round that are neither held nor finished, lowest first. Pure. */
function openJuz(assignments: readonly Doc<"assignments">[]): number[] {
  const taken = juzStates(assignments);
  const open: number[] = [];
  for (let juz = 1; juz <= JUZ_COUNT; juz++) {
    if (!taken.has(juz)) open.push(juz);
  }
  return open;
}

/**
 * The ajza' `personId` finished in their last `lookback` rounds (before round
 * `beforeRound`) in which they finished anything. Reads newest-first and stops
 * as soon as an older round than the window shows up, so the cost is bounded
 * by the window, not by the khatma's age.
 */
async function juzFinishedInRecentRounds(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  personId: Id<"people">,
  beforeRound: number,
  lookback: number,
): Promise<Set<number>> {
  const juzByRound = new Map<number, Set<number>>();
  if (lookback <= 0) return new Set();
  const finished = ctx.db
    .query("assignments")
    .withIndex("by_khatma_person", (q) =>
      q.eq("khatmaId", khatmaId).eq("personId", personId),
    )
    .order("desc")
    .filter((q) => q.neq(q.field("finishedAt"), null));
  for await (const a of finished) {
    if (a.roundNumber >= beforeRound) continue;
    let juzSet = juzByRound.get(a.roundNumber);
    if (!juzSet) {
      if (juzByRound.size >= lookback) break;
      juzSet = new Set();
      juzByRound.set(a.roundNumber, juzSet);
    }
    juzSet.add(a.juz);
  }
  return new Set([...juzByRound.values()].flatMap((s) => [...s]));
}

/**
 * Whether a juz' of the round is finished or held. A released row doesn't
 * count, and neither does a hold opened for help: anyone may take that one.
 */
function isTaken(rows: readonly Doc<"assignments">[]): boolean {
  return rows.some(
    (a) =>
      a.finishedAt !== null ||
      (a.releasedAt === null && a.openedForHelpAt === null),
  );
}

const soft = (
  reason: Extract<TakeResult, { ok: false }>["reason"],
): TakeResult => ({ ok: false, reason });

export const take = sessionMutation({
  args: { inviteCode: v.string(), juz: v.number() },
  handler: async (ctx, args): Promise<TakeResult> => {
    // a signed-out caller hears not_signed_in before any check of the juz'
    const person = requirePerson(ctx);
    if (!Number.isInteger(args.juz) || args.juz < 1 || args.juz > JUZ_COUNT) {
      throw new ConvexError({ code: "invalid_juz" });
    }
    const actor = await poolActor(ctx, args.inviteCode);
    if (!actor.ok) return actor;
    const { khatma, round, member } = actor;

    const mine = await ctx.db
      .query("assignments")
      .withIndex("by_round", (q) => q.eq("roundId", round._id))
      .filter((q) => q.eq(q.field("personId"), person._id))
      .collect();
    if (mine.some(isHeld)) {
      return soft("already_holding");
    }

    const sameJuz = await ctx.db
      .query("assignments")
      .withIndex("by_round_juz", (q) =>
        q.eq("roundId", round._id).eq("juz", args.juz),
      )
      .collect();
    if (isTaken(sameJuz)) return soft("taken");

    // A "former" member (unblocked, not in the khatma) joins afresh below.
    let memberId = member?.status === "active" ? member._id : undefined;
    if (!memberId) {
      const members = await ctx.db
        .query("members")
        .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
        .collect();
      const activeCount = members.filter((m) => m.status === "active").length;
      if (activeCount >= (await getSetting(ctx, "maxMembers"))) {
        return soft("khatma_full");
      }
      // Only a take that really creates a membership spends a join slot.
      const joinOk = await checkRateLimit(
        ctx,
        `join:${khatma._id}`,
        await getSetting(ctx, "newMembersPerKhatmaPerHour"),
        HOUR_MS,
      );
      if (!joinOk) return soft("rate_limited");
      const fresh = {
        joinedAt: Date.now(),
        status: "active" as const,
        notificationsOn: true,
        lastNudgeAt: null,
        // a newcomer never sees a celebration for rounds they didn't join
        lastCelebratedRound: khatma.completedRounds,
      };
      if (member) {
        await ctx.db.patch(member._id, fresh);
        memberId = member._id;
      } else {
        memberId = await ctx.db.insert("members", {
          khatmaId: khatma._id,
          personId: person._id,
          ...fresh,
        });
      }
    }

    const takenAt = Date.now();
    // Someone else's hold that opened for help ends quietly, with thanks.
    const helped = sameJuz.find((a) => isHeld(a) && a.openedForHelpAt !== null);
    if (helped) {
      await ctx.db.patch(helped._id, {
        releasedAt: takenAt,
        releasedBySystem: true,
      });
      await clearNotes(ctx, { assignmentId: helped._id });
      await notify(ctx, {
        personId: helped.personId,
        khatmaId: khatma._id,
        kind: "thanks",
        juz: [args.juz],
      });
    }
    // An organizer alert for this juz' no longer applies once it's taken.
    await clearNotes(ctx, {
      khatmaId: khatma._id,
      kind: "openForHelp",
      juz: args.juz,
    });
    // A behind invite is answered once they take a juz', so a push queued for the morning dies.
    await clearNotes(ctx, {
      khatmaId: khatma._id,
      personId: person._id,
      kind: "behind",
    });

    // The grace the hold starts with stays with it (spec 3.4).
    const quiet = await quietHours(ctx);
    const wakingMs = graceWakingMs(khatma.grace, quiet);
    const { noticeAt, endsAt } = graceTimes(
      takenAt,
      wakingMs,
      safeTimeZone(person.timeZone),
      quiet,
      await getSetting(ctx, "graceNoticeFraction"),
    );
    const assignmentId = await ctx.db.insert("assignments", {
      khatmaId: khatma._id,
      roundId: round._id,
      roundNumber: round.number,
      juz: args.juz,
      memberId,
      personId: person._id,
      takenAt,
      finishedAt: null,
      releasedAt: null,
      releasedBySystem: false,
      graceWakingMs: wakingMs,
      noticeAt,
      graceEndsAt: endsAt,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    });
    await scheduleGrace(ctx, assignmentId, noticeAt, endsAt);

    // One gentle reminder at 1.5x their pace, never in the quiet hours.
    const { paceMs } = await personPace(ctx, person._id);
    await ctx.scheduler.runAt(
      nextAwake(
        takenAt + (await getSetting(ctx, "reminderPaceMultiple")) * paceMs,
        person.timeZone,
        quiet,
      ),
      internal.nudges.reminderDue,
      { assignmentId },
    );
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Finish, undo, release

export type FinishResult =
  | { ok: true; undoUntil: number }
  | {
      ok: false;
      reason:
        | "not_holding"
        /** someone else took it after it opened for help */
        | "taken_over"
        | "blocked"
        | "rate_limited"
        | "maintenance";
    };

export type UndoResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "window_closed"
        | "holding_another"
        | "round_completed"
        | "nothing_to_undo"
        | "blocked"
        | "rate_limited"
        | "maintenance";
    };

export type ReleaseResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_holding" | "blocked" | "rate_limited" | "maintenance";
    };

export type StillReadingResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_holding"
        | "already_extended"
        | "opened"
        | "blocked"
        | "rate_limited"
        | "maintenance";
    };

/**
 * What take, finish, undo, and release share: the signed-in person, the khatma
 * behind the invite code, its current round and the person's membership (if
 * any), after the maintenance, archived and blocked checks and the per-person
 * pool rate limit, in that order.
 */
async function poolActor(
  ctx: MutationCtx & SessionContext,
  inviteCode: string,
): Promise<
  | {
      ok: true;
      person: Doc<"people">;
      khatma: Doc<"khatmas">;
      round: Doc<"rounds">;
      member: Doc<"members"> | null;
    }
  | { ok: false; reason: "blocked" | "rate_limited" | "maintenance" }
> {
  const person = requirePerson(ctx);
  // before the rate limit, so a refused call does not spend the bucket
  if (await getSetting(ctx, "maintenanceMode")) {
    return { ok: false, reason: "maintenance" };
  }
  const khatma = await khatmaByInviteCode(ctx, inviteCode);
  if (!khatma?.currentRoundId) throw new ConvexError({ code: "not_found" });
  if (isArchived(khatma)) throw new ConvexError({ code: "archived" });
  const round = await ctx.db.get(khatma.currentRoundId);
  if (!round) throw new ConvexError({ code: "not_found" });

  const member = await ctx.db
    .query("members")
    .withIndex("by_khatma_person", (q) =>
      q.eq("khatmaId", khatma._id).eq("personId", person._id),
    )
    .first();
  if (member?.status === "blocked") return { ok: false, reason: "blocked" };

  const allowed = await checkRateLimit(
    ctx,
    `pool:${person._id}`,
    await getSetting(ctx, "poolActionsPerPersonPerMinute"),
    MINUTE_MS,
  );
  if (!allowed) return { ok: false, reason: "rate_limited" };
  return { ok: true, person, khatma, round, member };
}

export const finish = sessionMutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<FinishResult> => {
    const actor = await poolActor(ctx, args.inviteCode);
    if (!actor.ok) return actor;
    const { person, round } = actor;

    const assignments = await roundAssignments(ctx, round._id);
    const held = heldAssignment(assignments, person._id);
    if (!held) {
      const latest = assignments
        .filter((a) => a.personId === person._id)
        .sort((a, b) => b._creationTime - a._creationTime)[0];
      const takenOver =
        latest?.releasedBySystem === true && latest.openedForHelpAt !== null;
      return { ok: false, reason: takenOver ? "taken_over" : "not_holding" };
    }

    const now = Date.now();
    await ctx.db.patch(held._id, { finishedAt: now });
    await clearNotes(ctx, { assignmentId: held._id });
    await clearNotes(ctx, {
      khatmaId: held.khatmaId,
      kind: "openForHelp",
      juz: held.juz,
    });
    await clearNotes(ctx, {
      khatmaId: held.khatmaId,
      personId: person._id,
      kind: "cheer",
    });
    await ctx.db.patch(round._id, { lastFinishedAt: now });
    await scheduleCheer(ctx, held._id, now);
    if (doneCount(assignments) + 1 >= JUZ_COUNT) {
      await ctx.scheduler.runAt(
        now + (await getSetting(ctx, "completionDelayMs")),
        internal.rounds.completeIfReady,
        { roundId: round._id },
      );
    }
    return {
      ok: true,
      undoUntil: now + (await getSetting(ctx, "undoWindowMs")),
    };
  },
});

export const undoFinish = sessionMutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<UndoResult> => {
    const actor = await poolActor(ctx, args.inviteCode);
    if (!actor.ok) return actor;
    const { person, khatma, round } = actor;

    const assignments = await roundAssignments(ctx, round._id);
    const lastDone = assignments
      .filter((a) => a.personId === person._id && a.finishedAt !== null)
      .sort(
        (a, b) =>
          (b.finishedAt ?? 0) - (a.finishedAt ?? 0) ||
          b._creationTime - a._creationTime,
      )[0];
    const undoWindowMs = await getSetting(ctx, "undoWindowMs");
    const now = Date.now();
    if (!lastDone) {
      // Their latest finish, if any, is in an earlier round. Newest round first.
      let latestRound: number | null = null;
      let latestFinishedAt = 0;
      const earlier = ctx.db
        .query("assignments")
        .withIndex("by_khatma_person", (q) =>
          q.eq("khatmaId", khatma._id).eq("personId", person._id),
        )
        .order("desc")
        .filter((q) => q.neq(q.field("finishedAt"), null));
      for await (const a of earlier) {
        latestRound ??= a.roundNumber;
        if (a.roundNumber !== latestRound) break;
        latestFinishedAt = Math.max(latestFinishedAt, a.finishedAt ?? 0);
      }
      if (latestRound === null) return { ok: false, reason: "nothing_to_undo" };
      // Only a finish that just lost its round to completion is "completed";
      // anything older has simply outlived the undo window.
      return {
        ok: false,
        reason:
          latestRound === round.number - 1 &&
          now - latestFinishedAt <= undoWindowMs
            ? "round_completed"
            : "window_closed",
      };
    }
    // Defensive: the current round is never completed (completion starts the next).
    if (round.completedAt !== null) {
      return { ok: false, reason: "round_completed" };
    }
    if (now - (lastDone.finishedAt ?? 0) > undoWindowMs) {
      return { ok: false, reason: "window_closed" };
    }
    if (heldAssignment(assignments, person._id)) {
      return { ok: false, reason: "holding_another" };
    }

    await ctx.db.patch(lastDone._id, { finishedAt: null });
    // The deadline for completion follows the latest finish that still stands.
    const remaining = assignments
      .filter((a) => a._id !== lastDone._id && a.finishedAt !== null)
      .map((a) => a.finishedAt as number);
    await ctx.db.patch(round._id, {
      lastFinishedAt: remaining.length > 0 ? Math.max(...remaining) : null,
    });

    // The hold is back exactly as it was (spec 3.4). Grace jobs that ran while
    // it was finished did nothing, so run what they would have done.
    if (lastDone.openedForHelpAt !== null) {
      await alertOrganizer(ctx, khatma, lastDone.juz, person._id);
    } else if (lastDone.graceEndsAt <= now) {
      await ctx.scheduler.runAfter(0, internal.grace.endDue, {
        assignmentId: lastDone._id,
        endsAt: lastDone.graceEndsAt,
      });
    } else if (
      lastDone.noticeSentAt === null &&
      !lastDone.extended &&
      lastDone.noticeAt <= now
    ) {
      await ctx.scheduler.runAfter(0, internal.grace.noticeDue, {
        assignmentId: lastDone._id,
      });
    }
    return { ok: true };
  },
});

export const release = sessionMutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<ReleaseResult> => {
    const actor = await poolActor(ctx, args.inviteCode);
    if (!actor.ok) return actor;
    const { person, khatma, round } = actor;

    const held = heldAssignment(
      await roundAssignments(ctx, round._id),
      person._id,
    );
    if (!held) return { ok: false, reason: "not_holding" };
    await ctx.db.patch(held._id, {
      releasedAt: Date.now(),
      releasedBySystem: false,
    });
    await clearNotes(ctx, { assignmentId: held._id });
    await clearNotes(ctx, {
      khatmaId: held.khatmaId,
      personId: person._id,
      kind: "cheer",
    });
    // The same alert as a timeout, even for a hold already opened for help
    // (spec 3.4); one still showing that juz' isn't repeated.
    await alertOrganizer(ctx, khatma, held.juz, person._id);
    return { ok: true };
  },
});

/**
 * "ما زلت أقرأ": adds one more grace period, in waking time, to the hold's
 * current end. Once per hold, and not once it has opened for help.
 */
export const stillReading = sessionMutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<StillReadingResult> => {
    const actor = await poolActor(ctx, args.inviteCode);
    if (!actor.ok) return actor;
    const { person, round } = actor;

    const held = heldAssignment(
      await roundAssignments(ctx, round._id),
      person._id,
    );
    if (!held) return { ok: false, reason: "not_holding" };
    if (held.openedForHelpAt !== null) return { ok: false, reason: "opened" };
    if (held.extended) return { ok: false, reason: "already_extended" };

    const endsAt = addWakingMs(
      held.graceEndsAt,
      held.graceWakingMs,
      safeTimeZone(person.timeZone),
      await quietHours(ctx),
    );
    await ctx.db.patch(held._id, { extended: true, graceEndsAt: endsAt });
    await ctx.scheduler.runAt(endsAt, internal.grace.endDue, {
      assignmentId: held._id,
      endsAt,
    });
    await clearNotes(ctx, { assignmentId: held._id, kinds: ["almostUp"] });
    return { ok: true };
  },
});
