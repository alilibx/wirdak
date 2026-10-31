import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { archiveKhatma } from "./khatmaLifecycle";
import { changeCompletedDays } from "./lib/directory";
import { isArchived } from "./lib/khatma";
import { clearNotes, notify } from "./notes";
import { enqueue } from "./rotaOutbox";
import {
  addDays,
  cycleOf,
  isReadingDate,
  khatmaNumber,
  ROTA_SIZE,
  slotFor,
} from "./lib/rota";
import { lastRotaDay, slotRowsByJuz } from "./lib/rotaPlace";
import { getSetting } from "./lib/settings";
import { instantAt, localDate, localMinutes } from "./lib/wakingTime";

type RotaConfig = NonNullable<Doc<"khatmas">["rota"]>;

/** Sets `completedAt` when all 30 reads are done. Returns whether it just completed. */
export async function completeIfDone(
  ctx: MutationCtx,
  dayId: Id<"rotaDays">,
): Promise<boolean> {
  const day = await ctx.db.get(dayId);
  if (!day || day.completedAt !== null) return false;
  const reads = await ctx.db
    .query("rotaReads")
    .withIndex("by_day_juz", (q) => q.eq("dayId", dayId))
    .collect();
  if (reads.length < ROTA_SIZE || reads.some((r) => r.doneAt === null)) {
    return false;
  }
  await ctx.db.patch(dayId, { completedAt: Date.now() });
  await changeCompletedDays(ctx, day.khatmaId, 1);
  return true;
}

/**
 * Queues the completion message to every joined participant (except one who
 * gets it in a reply), once per day: `celebratedAt` stays set even if the
 * day is un-done and done again.
 */
export async function celebrateIfComplete(
  ctx: MutationCtx,
  dayId: Id<"rotaDays">,
  exceptParticipantId?: Id<"rotaParticipants">,
): Promise<void> {
  const day = await ctx.db.get(dayId);
  if (!day || day.completedAt === null || day.celebratedAt != null) return;
  await ctx.db.patch(dayId, { celebratedAt: Date.now() });
  const participants = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", day.khatmaId))
    .collect();
  for (const p of participants) {
    if (p._id === exceptParticipantId) continue;
    await enqueue(ctx, {
      khatmaId: day.khatmaId,
      participantId: p._id,
      dayId,
      kind: "complete",
      juz: [],
      number: day.number,
    });
  }
}

/**
 * Whether a day should start now: setup is done, and today is a reading date
 * after the last started day (days only go forward, even if the time zone
 * moved west), so no started day can have today's date. A khatma from before setup was tracked counts as set up.
 */
function shouldStart(
  rota: RotaConfig,
  last: Doc<"rotaDays"> | null,
  today: string,
  now: number,
): boolean {
  if (rota.setupDoneAt === null) return false;
  if (rota.pausedAt !== null) return false;
  if (last && today <= last.date) return false;
  if (rota.endDate !== null && today > rota.endDate) return false;
  if (!isReadingDate(rota.days, rota.firstDate, today)) return false;
  if (rota.pauseDates.includes(today)) return false;
  return localMinutes(now, rota.timeZone) >= rota.messages.dayAt;
}

async function startDay(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  last: Doc<"rotaDays"> | null,
  today: string,
  now: number,
): Promise<Doc<"rotaDays">> {
  const n = (last?.n ?? 0) + 1;
  const number = khatmaNumber(n);
  // A day that starts after a message's time has none of it that day.
  const minutes = localMinutes(now, rota.timeZone);
  const skipIfPast = (at: number) => (minutes >= at ? now : null);
  const dayId = await ctx.db.insert("rotaDays", {
    khatmaId: khatma._id,
    n,
    number,
    cycle: cycleOf(n),
    date: today,
    startedAt: now,
    closesAt: instantAt(addDays(today, 1), rota.messages.dayAt, rota.timeZone),
    completedAt: null,
    closedAt: null,
    unreadSentAt: skipIfPast(rota.messages.unread.at),
    summarySentAt: skipIfPast(rota.messages.summary.at),
    reminderSentAt: skipIfPast(rota.messages.reminder.at),
  });
  const byJuz = await slotRowsByJuz(ctx, khatma._id, number);
  const juzByHolder = new Map<Id<"rotaParticipants">, number[]>();
  for (let juz = 1; juz <= ROTA_SIZE; juz++) {
    const slot = slotFor(juz, number);
    const holderId = byJuz.get(juz)?.participantId ?? null;
    await ctx.db.insert("rotaReads", {
      dayId,
      khatmaId: khatma._id,
      juz,
      slot,
      holderId,
      readerId: holderId,
      doneAt: null,
      doneByOrganizer: false,
      reassignedAt: null,
    });
    if (holderId !== null) {
      juzByHolder.set(holderId, [...(juzByHolder.get(holderId) ?? []), juz]);
    }
  }
  // One message per reader, with all their ajza' of the day.
  for (const [participantId, juz] of juzByHolder) {
    await enqueue(ctx, {
      khatmaId: khatma._id,
      participantId,
      dayId,
      kind: "juz",
      juz,
      number,
    });
  }
  const day = await ctx.db.get(dayId);
  if (!day) throw new Error("rota day vanished");
  return day;
}

/**
 * A new unread list or summary replaces the organizer's older ones in the
 * khatma, so only the latest stays on their screen.
 */
async function clearOlderOrganizerNotes(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
): Promise<void> {
  for (const kind of ["rotaUnread", "rotaSummary"] as const) {
    await clearNotes(ctx, {
      khatmaId: khatma._id,
      personId: khatma.creatorPersonId,
      kind,
    });
  }
}

/** The organizer's unread list and summary, once each, on the day dated today. */
async function sendOrganizerNotes(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  day: Doc<"rotaDays">,
  now: number,
): Promise<void> {
  const minutes = localMinutes(now, rota.timeZone);
  const { unread, summary } = rota.messages;
  const wantsUnread =
    unread.on &&
    minutes >= unread.at &&
    day.unreadSentAt === null &&
    day.completedAt === null;
  const wantsSummary =
    summary.on && minutes >= summary.at && day.summarySentAt === null;
  if (!wantsUnread && !wantsSummary) return;

  const reads = await ctx.db
    .query("rotaReads")
    .withIndex("by_day_juz", (q) => q.eq("dayId", day._id))
    .collect();
  if (wantsUnread) {
    const juz = reads.filter((r) => r.doneAt === null).map((r) => r.juz);
    if (juz.length > 0) {
      await clearOlderOrganizerNotes(ctx, khatma);
      await notify(ctx, {
        personId: khatma.creatorPersonId,
        khatmaId: khatma._id,
        kind: "rotaUnread",
        juz,
      });
    }
    await ctx.db.patch(day._id, { unreadSentAt: now });
  }
  if (wantsSummary) {
    const done = reads.filter((r) => r.doneAt !== null);
    await clearOlderOrganizerNotes(ctx, khatma);
    await notify(ctx, {
      personId: khatma.creatorPersonId,
      khatmaId: khatma._id,
      kind: "rotaSummary",
      count: done.length,
      juz: done.map((r) => r.juz),
    });
    await ctx.db.patch(day._id, { summarySentAt: now });
  }
}

/** The reminder for each reader with unread ajza', once on the day dated today. */
async function sendReminders(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  day: Doc<"rotaDays">,
  now: number,
): Promise<void> {
  const { reminder } = rota.messages;
  if (
    !reminder.on ||
    localMinutes(now, rota.timeZone) < reminder.at ||
    day.reminderSentAt != null
  ) {
    return;
  }
  const reads = await ctx.db
    .query("rotaReads")
    .withIndex("by_day_juz", (q) => q.eq("dayId", day._id))
    .collect();
  const unreadByReader = new Map<Id<"rotaParticipants">, number[]>();
  for (const r of reads) {
    if (r.doneAt !== null || r.readerId === null) continue;
    unreadByReader.set(r.readerId, [
      ...(unreadByReader.get(r.readerId) ?? []),
      r.juz,
    ]);
  }
  for (const [participantId, juz] of unreadByReader) {
    await enqueue(ctx, {
      khatmaId: khatma._id,
      participantId,
      dayId: day._id,
      kind: "reminder",
      juz,
      number: day.number,
    });
  }
  await ctx.db.patch(day._id, { reminderSentAt: now });
}

/**
 * Counts the day against each joined participant who had a read to do and
 * didn't reply since it started (a reply resets the count), tells the
 * organizer at the notice threshold and stops the participant's messages at
 * the stop threshold.
 */
async function countSilentDay(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  day: Doc<"rotaDays">,
  now: number,
): Promise<void> {
  const noticeDays = await getSetting(ctx, "rotaSilenceNoticeDays");
  const stopDays = await getSetting(ctx, "rotaSilenceStopDays");
  const reads = await ctx.db
    .query("rotaReads")
    .withIndex("by_day_juz", (q) => q.eq("dayId", day._id))
    .collect();
  const readerIds = new Set(
    reads.flatMap((r) => (r.readerId === null ? [] : [r.readerId])),
  );
  for (const participantId of readerIds) {
    const p = await ctx.db.get(participantId);
    if (
      !p ||
      p.removedAt != null ||
      p.joinedAt == null ||
      p.joinedAt >= day.startedAt ||
      p.stoppedAt != null ||
      p.silencedAt != null
    ) {
      continue;
    }
    const before = p.silentDays ?? 0;
    const silentDays = (p.lastReplyAt ?? 0) >= day.startedAt ? 0 : before + 1;
    const silence = silentDays >= stopDays;
    await ctx.db.patch(p._id, { silentDays });
    // The notice goes once, when the count first reaches the threshold, and
    // not at all when the participant is silenced at the same time.
    if (!silence && before < noticeDays && silentDays >= noticeDays) {
      await notify(ctx, {
        personId: khatma.creatorPersonId,
        khatmaId: khatma._id,
        kind: "rotaSilent",
        name: p.name,
        count: silentDays,
      });
    }
    if (silence) {
      await ctx.db.patch(p._id, { silencedAt: now });
      await notify(ctx, {
        personId: khatma.creatorPersonId,
        khatmaId: khatma._id,
        kind: "rotaSilenced",
        name: p.name,
      });
    }
  }
}

/** After the 30th day of a cycle, a thank-you for everyone who held a slot all cycle. */
async function sendCycleMessages(
  ctx: MutationCtx,
  day: Doc<"rotaDays">,
): Promise<void> {
  const first = await ctx.db
    .query("rotaDays")
    .withIndex("by_khatma_n", (q) =>
      q.eq("khatmaId", day.khatmaId).eq("n", (day.cycle - 1) * ROTA_SIZE + 1),
    )
    .first();
  if (!first) return;
  const holdsOn = async (d: Doc<"rotaDays">) => {
    const reads = await ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", d._id))
      .collect();
    return new Set(reads.flatMap((r) => (r.holderId ? [r.holderId] : [])));
  };
  const heldFirst = await holdsOn(first);
  const heldLast = await holdsOn(day);
  for (const participantId of heldLast) {
    const p = await ctx.db.get(participantId);
    if (
      !p ||
      !heldFirst.has(participantId) ||
      p.joinedAt == null ||
      p.joinedAt > first.startedAt
    ) {
      continue;
    }
    await enqueue(ctx, {
      khatmaId: day.khatmaId,
      participantId,
      dayId: day._id,
      kind: "cycle",
      juz: [],
      number: day.number,
    });
  }
}

/**
 * Closes a day and runs its silence count and cycle messages, once per day:
 * it does nothing for a closed day. (Archiving a khatma closes its open day
 * without them.) A day closing while the khatma is paused doesn't count toward
 * silence.
 */
async function closeDay(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  day: Doc<"rotaDays">,
  now: number,
): Promise<Doc<"rotaDays">> {
  if (day.closedAt !== null) return day;
  await ctx.db.patch(day._id, { closedAt: now });
  // Nobody is asked to reply while the khatma is paused.
  if (rota.pausedAt === null) await countSilentDay(ctx, khatma, day, now);
  if (day.number === ROTA_SIZE) await sendCycleMessages(ctx, day);
  return { ...day, closedAt: now };
}

/**
 * Moves one rota khatma forward: closes the open day when it is due, starts
 * today's day, sends the organizer's notes and archives a finished khatma.
 * Every step is safe to repeat.
 */
export const tick = internalMutation({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args) => {
    const khatma = await ctx.db.get(args.khatmaId);
    const rota = khatma?.rota;
    if (!khatma || khatma.kind !== "rota" || !rota) return;
    if (isArchived(khatma)) return;
    const now = Date.now();
    const today = localDate(now, rota.timeZone);

    let last = await lastRotaDay(ctx, khatma._id);
    if (last && last.closedAt === null && now >= last.closesAt) {
      last = await closeDay(ctx, khatma, rota, last, now);
    }

    if (shouldStart(rota, last, today, now)) {
      if (last) await closeDay(ctx, khatma, rota, last, now);
      last = await startDay(ctx, khatma, rota, last, today, now);
    }

    // A paused khatma sends the organizer nothing.
    if (
      last &&
      last.closedAt === null &&
      last.date === today &&
      rota.pausedAt === null
    ) {
      await sendOrganizerNotes(ctx, khatma, rota, last, now);
      await sendReminders(ctx, khatma, rota, last, now);
    }

    const open = last !== null && last.closedAt === null;
    if (rota.endDate !== null && today > rota.endDate && !open) {
      await archiveKhatma(ctx, khatma);
    }
  },
});

/** Every 15 minutes: ticks each rota khatma that is not archived. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const khatmas = await ctx.db
      .query("khatmas")
      .withIndex("by_kind", (q) => q.eq("kind", "rota"))
      .collect();
    for (const khatma of khatmas) {
      if (!isArchived(khatma)) {
        await ctx.scheduler.runAfter(0, internal.rotaDays.tick, {
          khatmaId: khatma._id,
        });
      }
    }
  },
});
