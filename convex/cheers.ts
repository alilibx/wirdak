import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { cheerConfig, cheerDue } from "./lib/cheer";
import { JUZ_COUNT } from "./lib/juz";
import { isArchived } from "./lib/khatma";
import { getSetting, quietHours } from "./lib/settings";
import { localDate, nextAwake } from "./lib/wakingTime";
import { notify } from "./notes";
import { offCooldown } from "./nudges";
import { doneCount, heldAssignment, roundAssignments } from "./rounds";
import { enqueue, reachable, windowOpen } from "./rotaOutbox";

/**
 * Tells other readers a juz' was finished. By default a cheer names nobody and
 * no juz' (the tile showed who held it, so the number would name them too); a
 * khatma can choose to show either. It is rarer than the finishes it follows
 * and isn't a nudge: it never delays a reminder, and a recent nudge holds it
 * back instead.
 */

/**
 * With this many ajza' or fewer left, nobody is cheered: a count that close to
 * the end tells the last readers they're the ones being waited for.
 */
const QUIET_LAST_AJZA = 2;

/** Cheers wait out the undo window, so a mistaken tap tells nobody. */
export async function scheduleCheer(
  ctx: MutationCtx,
  assignmentId: Id<"assignments">,
  finishedAt: number,
): Promise<void> {
  await ctx.scheduler.runAt(
    finishedAt + (await getSetting(ctx, "undoWindowMs")) + 1,
    internal.cheers.afterFinish,
    { assignmentId, finishedAt },
  );
}

/**
 * Cheers a pool khatma's members after a finish that still stands. Each member
 * shows one cheer at most: a new one replaces the last.
 */
export const afterFinish = internalMutation({
  args: { assignmentId: v.id("assignments"), finishedAt: v.number() },
  handler: async (ctx, args) => {
    const finished = await ctx.db.get(args.assignmentId);
    // A finish undone and made again has a job of its own.
    if (!finished || finished.finishedAt !== args.finishedAt) return;
    const khatma = await ctx.db.get(finished.khatmaId);
    if (
      !khatma ||
      isArchived(khatma) ||
      khatma.currentRoundId !== finished.roundId
    ) {
      return;
    }
    const config = await cheerConfig(ctx, khatma);
    if (!config.on) return;
    const assignments = await roundAssignments(ctx, finished.roundId);
    const done = doneCount(assignments);
    if (done >= JUZ_COUNT - QUIET_LAST_AJZA) return;

    const reader = config.showName ? await ctx.db.get(finished.personId) : null;
    const now = Date.now();
    const cooldownMs = await getSetting(ctx, "nudgeCooldownMs");
    const members = await ctx.db
      .query("members")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect();
    const showing = await ctx.db
      .query("notes")
      .withIndex("by_khatma_kind", (q) =>
        q.eq("khatmaId", khatma._id).eq("kind", "cheer").eq("clearedAt", null),
      )
      .collect();
    for (const member of members) {
      if (
        member.status !== "active" ||
        !member.notificationsOn ||
        member.personId === finished.personId
      ) {
        continue;
      }
      const held = heldAssignment(assignments, member.personId);
      // A hold opened for help is already asking someone else to step in, and
      // an "almost up" note still waiting for an answer is about the time.
      if (
        held &&
        (held.openedForHelpAt !== null ||
          (held.noticeSentAt !== null && !held.extended))
      ) {
        continue;
      }
      if (!config.everyone && !held) continue;
      if (
        !cheerDue(member.lastCheerAt, now, config.gapMs) ||
        !offCooldown(member, now, cooldownMs)
      ) {
        continue;
      }
      for (const note of showing) {
        if (note.personId === member.personId) {
          await ctx.db.patch(note._id, { clearedAt: now });
        }
      }
      await ctx.db.patch(member._id, { lastCheerAt: now });
      await notify(ctx, {
        personId: member.personId,
        khatmaId: khatma._id,
        kind: "cheer",
        count: done,
        name: reader?.displayName ?? null,
        juz: config.showJuz ? [finished.juz] : [],
        roundNumber: finished.roundNumber,
      });
    }
  },
});

/** The rota side of `scheduleCheer`: an organizer can take a mark back. */
export async function scheduleRotaCheer(
  ctx: MutationCtx,
  readId: Id<"rotaReads">,
  doneAt: number,
  /** Who answered for it, when that may not be its reader. */
  actorId: Id<"rotaParticipants"> | null,
): Promise<void> {
  await ctx.scheduler.runAt(
    doneAt + (await getSetting(ctx, "undoWindowMs")) + 1,
    internal.cheers.afterRead,
    { readId, doneAt, actorId },
  );
}

/**
 * Cheers a rota khatma's participants after a read that still stands. Most of
 * them are on WhatsApp alone, and a cheer has no template (Meta would count it
 * as marketing), so it goes only to phones inside their 24-hour window, while
 * they're awake. Nothing waits for morning: it would be stale by then. Like the
 * reminders, it stops while the khatma is paused and once the day is yesterday's.
 * Whoever answered «ليس بعد» or has had the day's reminder hears nothing more.
 */
export const afterRead = internalMutation({
  args: {
    readId: v.id("rotaReads"),
    doneAt: v.number(),
    actorId: v.union(v.id("rotaParticipants"), v.null()),
  },
  handler: async (ctx, args) => {
    const finished = await ctx.db.get(args.readId);
    if (!finished || finished.doneAt !== args.doneAt) return;
    const day = await ctx.db.get(finished.dayId);
    if (!day || day.closedAt !== null || day.completedAt !== null) return;
    const khatma = await ctx.db.get(finished.khatmaId);
    const rota = khatma?.rota;
    if (!khatma || !rota || isArchived(khatma)) return;
    const config = await cheerConfig(ctx, khatma);
    if (!config.on) return;

    const now = Date.now();
    if (rota.pausedAt !== null || day.date !== localDate(now, rota.timeZone)) {
      return;
    }
    const quiet = await quietHours(ctx);
    if (nextAwake(now, rota.timeZone, quiet) > now) return;

    const dayId = day._id;
    const reads = await ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", dayId))
      .collect();
    const done = reads.filter((r) => r.doneAt !== null).length;
    if (done >= JUZ_COUNT - QUIET_LAST_AJZA) return;
    const unread = reads.filter((r) => r.doneAt === null);
    const reading = new Set(unread.map((r) => r.readerId));
    const heldBack = new Set(
      unread
        .filter((r) => day.reminderSentAt != null || r.notYetAt != null)
        .map((r) => r.readerId),
    );
    const participants = await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect();
    const reader = participants.find(
      (p) => p._id === (args.actorId ?? finished.readerId),
    );
    // One tap can finish several ajza': they share its moment.
    const juz = reads.filter((r) => r.doneAt === args.doneAt).map((r) => r.juz);
    for (const participant of participants) {
      if (
        participant._id === finished.readerId ||
        participant._id === args.actorId ||
        !reachable(participant) ||
        heldBack.has(participant._id) ||
        (!config.everyone && !reading.has(participant._id)) ||
        !cheerDue(participant.lastCheerAt, now, config.gapMs) ||
        !(await windowOpen(ctx, participant.phone, now))
      ) {
        continue;
      }
      // Rows without a day aren't one-a-day: the gap decides how often.
      const queued = await enqueue(ctx, {
        khatmaId: khatma._id,
        participantId: participant._id,
        dayId: null,
        kind: "cheer",
        juz: config.showJuz ? juz : [],
        number: done,
        name: config.showName ? (reader?.name ?? null) : null,
      });
      if (queued) await ctx.db.patch(participant._id, { lastCheerAt: now });
    }
  },
});
