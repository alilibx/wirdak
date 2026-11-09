import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { counted, type CountForms } from "./lib/arabicCount";
import { toWesternDigits } from "./lib/digits";
import { isArchived } from "./lib/khatma";
import { milestonesFor, type MilestoneMetric } from "./lib/milestones";
import { getSetting } from "./lib/settings";
import {
  BACKFILLED_AT,
  bumpCounter,
  DAY_MS,
  dayStart,
  dubaiDay,
  readCounter,
  setCounter,
  signInKey,
} from "./lib/stats";

/** The nightly run fills at most this many missed days, then continues. */
const CATCH_UP_DAYS = 31;

export type DayCounts = {
  ajzaFinished: number;
  newMembers: number;
  newKhatmas: number;
  roundsCompleted: number;
  rotaDaysCompleted: number;
  signInsStarted: number;
  signInsCompleted: number;
};

/**
 * One Dubai day's counts, from index ranges over that day only (spec 6.2):
 * nothing here reads a whole table.
 */
export async function dayCounts(
  ctx: QueryCtx,
  day: number,
): Promise<DayCounts> {
  const from = dayStart(day);
  const to = dayStart(day + 1);
  const finished = await ctx.db
    .query("assignments")
    .withIndex("by_finishedAt", (q) =>
      q.gte("finishedAt", from).lt("finishedAt", to),
    )
    .collect();
  const people = await ctx.db
    .query("people")
    .withIndex("by_creation_time", (q) =>
      q.gte("_creationTime", from).lt("_creationTime", to),
    )
    .collect();
  const khatmas = await ctx.db
    .query("khatmas")
    .withIndex("by_creation_time", (q) =>
      q.gte("_creationTime", from).lt("_creationTime", to),
    )
    .collect();
  const rounds = await ctx.db
    .query("rounds")
    .withIndex("by_completedAt", (q) =>
      q.gte("completedAt", from).lt("completedAt", to),
    )
    .collect();
  const rotaDays = await ctx.db
    .query("rotaDays")
    .withIndex("by_completedAt", (q) =>
      q.gte("completedAt", from).lt("completedAt", to),
    )
    .collect();
  return {
    ajzaFinished: finished.length,
    newMembers: people.length,
    newKhatmas: khatmas.length,
    roundsCompleted: rounds.length,
    rotaDaysCompleted: rotaDays.length,
    signInsStarted: await readCounter(ctx, signInKey(day, "started")),
    signInsCompleted: await readCounter(ctx, signInKey(day, "completed")),
  };
}

async function rowFor(
  ctx: QueryCtx,
  day: number,
): Promise<Doc<"dailyStats"> | null> {
  return await ctx.db
    .query("dailyStats")
    .withIndex("by_day", (q) => q.eq("day", day))
    .first();
}

/** The newest row before `day`, whose totals this day builds on. */
async function rowBefore(
  ctx: QueryCtx,
  day: number,
): Promise<Doc<"dailyStats"> | null> {
  return await ctx.db
    .query("dailyStats")
    .withIndex("by_day", (q) => q.lt("day", day))
    .order("desc")
    .first();
}

const ACTIVE_DAYS = 14;

/**
 * Writes (or rewrites) one day's row. Running it twice gives the same row.
 * Sign-in counters are purged a week after their day, so a rerun keeps the
 * counts already stored when the counters are gone. `live` (the nightly run
 * for yesterday) also stores the active khatma count, which only makes
 * sense at the end of the day it describes.
 */
async function writeDay(
  ctx: MutationCtx,
  day: number,
  live = false,
): Promise<void> {
  const counts = await dayCounts(ctx, day);
  const before = await rowBefore(ctx, day);
  const existing = await rowFor(ctx, day);
  // Counters only grow, so a zero under a stored count means it was purged.
  if (existing) {
    counts.signInsStarted ||= existing.signInsStarted;
    counts.signInsCompleted ||= existing.signInsCompleted;
  }
  let activeKhatmas = existing?.activeKhatmas;
  if (live) {
    const dayEnd = dayStart(day + 1);
    const rounds = await ctx.db
      .query("rounds")
      .withIndex("by_lastFinishedAt", (q) =>
        q.gt("lastFinishedAt", dayEnd - ACTIVE_DAYS * DAY_MS),
      )
      .collect();
    activeKhatmas = await countActiveKhatmas(ctx, rounds);
  }
  const row = {
    day,
    ...counts,
    totalMembers: (before?.totalMembers ?? 0) + counts.newMembers,
    totalKhatmas: (before?.totalKhatmas ?? 0) + counts.newKhatmas,
    totalRoundsCompleted:
      (before?.totalRoundsCompleted ?? 0) + counts.roundsCompleted,
    ...(activeKhatmas !== undefined ? { activeKhatmas } : {}),
    computedAt: Date.now(),
  };
  if (existing) await ctx.db.replace(existing._id, row);
  else await ctx.db.insert("dailyStats", row);
}

/** How many khatmas these rounds belong to, leaving out archived and deleted ones. */
export async function countActiveKhatmas(
  ctx: QueryCtx,
  rounds: Doc<"rounds">[],
): Promise<number> {
  let count = 0;
  for (const khatmaId of new Set(rounds.map((r) => r.khatmaId))) {
    const khatma = await ctx.db.get(khatmaId);
    if (khatma && !isArchived(khatma)) count++;
  }
  return count;
}

export const rollupDay = internalMutation({
  args: { day: v.number() },
  handler: async (ctx, args) => {
    await writeDay(ctx, args.day);
  },
});

/**
 * Nightly at 00:10 Dubai: rolls up every day after the newest row through
 * yesterday, so a missed night never leaves a hole in the totals. An empty
 * table is the backfill's job; after a backfill that found no data, rows
 * start from the day it ran.
 */
export const rollupYesterday = internalMutation({
  args: {},
  handler: async (ctx) => {
    const latest = await ctx.db
      .query("dailyStats")
      .withIndex("by_day")
      .order("desc")
      .first();
    let from: number;
    if (latest) from = latest.day + 1;
    else {
      const backfilledAt = await readCounter(ctx, BACKFILLED_AT);
      if (backfilledAt === 0) return;
      from = dubaiDay(backfilledAt);
    }
    const yesterday = dubaiDay(Date.now()) - 1;
    const last = Math.min(yesterday, from - 1 + CATCH_UP_DAYS);
    for (let day = from; day <= last; day++) {
      await writeDay(ctx, day, day === yesterday);
    }
    if (last < yesterday) {
      await ctx.scheduler.runAfter(0, internal.stats.rollupYesterday, {});
    }
  },
});

/** The Dubai day of the oldest person or khatma, or null on an empty deployment. */
export const firstDay = internalQuery({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const person = await ctx.db.query("people").order("asc").first();
    const khatma = await ctx.db.query("khatmas").order("asc").first();
    const times = [person?._creationTime, khatma?._creationTime].filter(
      (t): t is number => t !== undefined,
    );
    return times.length === 0 ? null : dubaiDay(Math.min(...times));
  },
});

/**
 * One-off, from the command line after the first deploy of plan 3c:
 * `bun run convex run stats:backfill --deployment …`. Safe to run again.
 */
export const backfill = internalAction({
  args: {},
  handler: async (ctx): Promise<{ days: number }> => {
    const first = await ctx.runQuery(internal.stats.firstDay, {});
    const yesterday = dubaiDay(Date.now()) - 1;
    let days = 0;
    for (let day = first ?? yesterday + 1; day <= yesterday; day++) {
      await ctx.runMutation(internal.stats.rollupDay, { day });
      days++;
    }
    // Launch shouldn't fire a burst of old milestones.
    await ctx.runMutation(internal.stats.markPassedMilestones, {});
    return { days };
  },
});

// ---------------------------------------------------------------------------
// Admin pushes: the morning summary and milestones (spec 7)

const HOUR_MS = 3_600_000;
const LAST_MILESTONE_PUSH = "milestone:lastPushAt";
const METRICS: MilestoneMetric[] = ["khatmas", "members", "completed"];
const NOUN: Record<MilestoneMetric, CountForms> = {
  khatmas: { few: "ختمات", many: "ختمة", other: "ختمة" },
  members: { few: "أعضاء", many: "عضواً", other: "عضو" },
  completed: {
    few: "ختمات مكتملة",
    many: "ختمة مكتملة",
    other: "ختمة مكتملة",
  },
};

const n = (value: number) => toWesternDigits(value);

/** The three totals now: the newest row's plus today's live counts. */
async function totals(ctx: QueryCtx): Promise<Record<MilestoneMetric, number>> {
  const today = dubaiDay(Date.now());
  const live = await dayCounts(ctx, today);
  const latest = await ctx.db
    .query("dailyStats")
    .withIndex("by_day")
    .order("desc")
    .first();
  return {
    khatmas: (latest?.totalKhatmas ?? 0) + live.newKhatmas,
    members: (latest?.totalMembers ?? 0) + live.newMembers,
    completed: (latest?.totalRoundsCompleted ?? 0) + live.roundsCompleted,
  };
}

/** The reached milestones of `metric` not sent yet, smallest first. */
async function unsent(
  ctx: QueryCtx,
  metric: MilestoneMetric,
  total: number,
): Promise<number[]> {
  const fresh: number[] = [];
  for (const value of milestonesFor(metric, total)) {
    const sent = await ctx.db
      .query("milestonesSent")
      .withIndex("by_metric_value", (q) =>
        q.eq("metric", metric).eq("value", value),
      )
      .first();
    if (!sent) fresh.push(value);
  }
  return fresh;
}

async function mark(
  ctx: MutationCtx,
  metric: MilestoneMetric,
  values: number[],
): Promise<void> {
  for (const value of values) {
    await ctx.db.insert("milestonesSent", {
      metric,
      value,
      sentAt: Date.now(),
    });
  }
}

/**
 * Every 10 minutes (spec 7). Each milestone fires once: the first metric with
 * unsent ones gets its highest pushed and all of them marked; other metrics,
 * and anything inside the spacing window, wait for a later run. Nothing is
 * pushed before the backfill, whose totals the milestones depend on.
 */
export const checkMilestones = internalMutation({
  args: {},
  handler: async (ctx) => {
    if ((await readCounter(ctx, BACKFILLED_AT)) === 0) return;
    const now = Date.now();
    const spacing = await getSetting(ctx, "milestonePushSpacingMs");
    if (now - (await readCounter(ctx, LAST_MILESTONE_PUSH)) < spacing) return;
    const current = await totals(ctx);
    for (const metric of METRICS) {
      const fresh = await unsent(ctx, metric, current[metric]);
      const top = fresh.at(-1);
      if (top === undefined) continue;
      await mark(ctx, metric, fresh);
      await setCounter(ctx, LAST_MILESTONE_PUSH, now);
      const others = METRICS.filter((m) => m !== metric)
        .map((m) => counted(current[m], NOUN[m]))
        .join(" · ");
      await ctx.scheduler.runAfter(0, internal.pushNode.deliverToAdmins, {
        kind: "milestone",
        body: `🎉 وصلنا ${counted(top, NOUN[metric])}\n${others}`,
        tag: `milestone-${metric}-${top}`,
      });
      return;
    }
  },
});

/**
 * Marks every milestone already reached as sent, without pushing, and lets
 * milestone pushes start. The backfill calls it.
 */
export const markPassedMilestones = internalMutation({
  args: {},
  handler: async (ctx) => {
    const current = await totals(ctx);
    for (const metric of METRICS) {
      await mark(ctx, metric, await unsent(ctx, metric, current[metric]));
    }
    await setCounter(ctx, BACKFILLED_AT, Date.now());
  },
});

/** Hourly: at `summaryHour` Dubai time, once a day, yesterday in one push (spec 7). */
export const morningSummary = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const today = dubaiDay(now);
    const hour = Math.floor((now - dayStart(today)) / HOUR_MS);
    if (hour !== (await getSetting(ctx, "summaryHour"))) return;
    const key = `summary:${today}`;
    if ((await readCounter(ctx, key)) > 0) return;
    await bumpCounter(ctx, key);
    const yesterday = await ctx.db
      .query("dailyStats")
      .withIndex("by_day", (q) => q.eq("day", today - 1))
      .first();
    if (!yesterday) return;
    const openHelp = (
      await ctx.db
        .query("helpRequests")
        .withIndex("by_status", (q) => q.eq("status", "open"))
        .take(100)
    ).length;
    await ctx.scheduler.runAfter(0, internal.pushNode.deliverToAdmins, {
      kind: "summary",
      // Label first, so no noun has to agree with its number.
      body: `أمس: ختمات جديدة ${n(yesterday.newKhatmas)} · أعضاء جدد ${n(yesterday.newMembers)} · أجزاء مقروءة ${n(yesterday.ajzaFinished)} · ختمات مكتملة ${n(yesterday.roundsCompleted)} · طلبات مساعدة مفتوحة ${n(openHelp)}`,
      tag: `summary-${today}`,
    });
  },
});
