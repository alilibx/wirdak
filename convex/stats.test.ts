import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { bumpCounter, dayStart, dubaiDay, signInKey } from "./lib/stats";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
// A fixed Dubai day D, and noon on it.
const D = dubaiDay(Date.parse("2026-10-20T08:00:00Z"));
const noon = (day: number) => dayStart(day) + 12 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(noon(D));
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

async function person(t: T, at: number, phone: string) {
  vi.setSystemTime(at);
  return await t.run((ctx) =>
    ctx.db.insert("people", {
      phone,
      displayName: "س",
      verifiedAt: at,
      timeZone: "Asia/Dubai",
      lastSeenAt: at,
    }),
  );
}

async function khatma(t: T, at: number, creator: Id<"people">) {
  vi.setSystemTime(at);
  return await t.run((ctx) =>
    ctx.db.insert("khatmas", {
      name: null,
      schedule: "weekly",
      grace: { value: 2, unit: "days" },
      creatorPersonId: creator,
      inviteCode: `code${at}`.slice(0, 12),
      completedRounds: 0,
      createdAt: at,
    }),
  );
}

async function round(
  t: T,
  khatmaId: Id<"khatmas">,
  completedAt: number | null,
) {
  return await t.run((ctx) =>
    ctx.db.insert("rounds", {
      khatmaId,
      number: 1,
      startedAt: noon(D) - 5 * 24 * HOUR,
      targetEndAt: null,
      completedAt,
      lastFinishedAt: null,
      behindInvitedAt: null,
    }),
  );
}

async function finish(
  t: T,
  khatmaId: Id<"khatmas">,
  roundId: Id<"rounds">,
  personId: Id<"people">,
  at: number,
) {
  await t.run(async (ctx) => {
    const memberId = await ctx.db.insert("members", {
      khatmaId,
      personId,
      joinedAt: 0,
      status: "active",
      notificationsOn: false,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    await ctx.db.insert("assignments", {
      khatmaId,
      roundId,
      roundNumber: 1,
      juz: Math.floor(Math.random() * 30) + 1,
      memberId,
      personId,
      takenAt: at - HOUR,
      finishedAt: at,
      releasedAt: null,
      releasedBySystem: false,
      graceWakingMs: HOUR,
      noticeAt: at,
      graceEndsAt: at + HOUR,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    });
  });
}

function rows(t: T) {
  return t.run((ctx) =>
    ctx.db.query("dailyStats").withIndex("by_day").collect(),
  );
}

async function seed(t: T) {
  const p = await person(t, noon(D), "+971500000001");
  const k = await khatma(t, noon(D) + 1000, p);
  const r = await round(t, k, noon(D) + 2000);
  await finish(t, k, r, p, noon(D) + 3000);
  await finish(t, k, r, p, noon(D) + 4000);
  await finish(t, k, r, p, noon(D + 1));
  await t.run(async (ctx) => {
    await bumpCounter(ctx, signInKey(D, "started"), 4);
    await bumpCounter(ctx, signInKey(D, "completed"), 3);
  });
  return { p, k, r };
}

test("a day's row has its counts and the totals so far", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  await t.mutation(internal.stats.rollupDay, { day: D });
  expect(await rows(t)).toMatchObject([
    {
      day: D,
      ajzaFinished: 2,
      newMembers: 1,
      newKhatmas: 1,
      roundsCompleted: 1,
      signInsStarted: 4,
      signInsCompleted: 3,
      totalMembers: 1,
      totalKhatmas: 1,
      totalRoundsCompleted: 1,
    },
  ]);
});

test("quiet days carry the totals forward, and reruns change nothing", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  await t.mutation(internal.stats.rollupDay, { day: D });
  await t.mutation(internal.stats.rollupDay, { day: D + 1 });
  await t.mutation(internal.stats.rollupDay, { day: D + 2 });
  await t.mutation(internal.stats.rollupDay, { day: D });
  await t.mutation(internal.stats.rollupDay, { day: D + 2 });

  const all = await rows(t);
  expect(all.map((r) => r.day)).toEqual([D, D + 1, D + 2]);
  expect(all[0]).toMatchObject({ signInsStarted: 4, totalMembers: 1 });
  expect(all[1]).toMatchObject({ ajzaFinished: 1, totalKhatmas: 1 });
  expect(all[2]).toMatchObject({
    ajzaFinished: 0,
    newMembers: 0,
    totalMembers: 1,
    totalKhatmas: 1,
    totalRoundsCompleted: 1,
  });
});

test("the nightly run catches up every day missed since the last row", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  await t.mutation(internal.stats.rollupDay, { day: D - 3 });
  vi.setSystemTime(noon(D + 1));
  await t.mutation(internal.stats.rollupYesterday, {});
  const all = await rows(t);
  expect(all.map((r) => r.day)).toEqual([D - 3, D - 2, D - 1, D]);
  expect(all.at(-1)).toMatchObject({ totalMembers: 1, ajzaFinished: 2 });
});

test("the nightly run leaves an empty table to the backfill", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  vi.setSystemTime(noon(D + 1));
  await t.mutation(internal.stats.rollupYesterday, {});
  expect(await rows(t)).toEqual([]);
});

test("the backfill writes every day from the first one to yesterday", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  vi.setSystemTime(noon(D + 3));
  await t.action(internal.stats.backfill, {});
  const all = await rows(t);
  expect(all.map((r) => r.day)).toEqual([D, D + 1, D + 2]);
  expect(all.at(-1)).toMatchObject({
    totalMembers: 1,
    totalKhatmas: 1,
    totalRoundsCompleted: 1,
  });
});

test("purge drops sign-in counters a week after their day", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await bumpCounter(ctx, signInKey(D - 8, "started"));
    await bumpCounter(ctx, signInKey(D - 6, "started"));
    await bumpCounter(ctx, "summary:1");
  });
  await t.mutation(internal.maintenance.purge, {});
  const keys = await t.run(async (ctx) =>
    (await ctx.db.query("counters").collect()).map((c) => c.key),
  );
  expect(keys.sort()).toEqual(
    [signInKey(D - 6, "started"), "summary:1"].sort(),
  );
});

// ---------------------------------------------------------------------------
// Morning summary and milestones

async function adminWithPush(t: T, prefs: Record<string, boolean> = {}) {
  return await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("admins", {
      phone: "+971500000099",
      addedBy: null,
      addedAt: 0,
      ...prefs,
    });
    await ctx.db.insert("adminPushSubscriptions", {
      adminId,
      endpoint: "https://push.example/a",
      p256dh: "p",
      auth: "a",
      createdAt: 0,
    });
    return adminId;
  });
}

function scheduledPushes(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect())
      .filter((s) => s.name === "pushNode:deliverToAdmins")
      .map((s) => s.args[0] as { kind: string; body?: string }),
  );
}

test("milestone sequences", async () => {
  const { milestonesFor } = await import("./lib/milestones");
  expect(milestonesFor("khatmas", 260)).toEqual([10, 50, 100, 250]);
  expect(milestonesFor("khatmas", 3000)).toEqual([
    10, 50, 100, 250, 500, 1000, 2000, 3000,
  ]);
  expect(milestonesFor("members", 25_000).slice(-2)).toEqual([10_000, 20_000]);
  expect(milestonesFor("completed", 1)).toEqual([1]);
  expect(milestonesFor("completed", 0)).toEqual([]);
});

test("two milestones crossed at once: both marked, only the highest pushed", async () => {
  const t = convexTest(schema, modules);
  await adminWithPush(t);
  await t.mutation(internal.stats.markPassedMilestones, {});
  await day(t, D - 1, { totalKhatmas: 120, totalMembers: 10 });
  await t.mutation(internal.stats.checkMilestones, {});
  const sent = await t.run((ctx) => ctx.db.query("milestonesSent").collect());
  expect(
    sent
      .filter((s) => s.metric === "khatmas")
      .map((s) => s.value)
      .sort((a, b) => a - b),
  ).toEqual([10, 50, 100]);
  const pushes = await scheduledPushes(t);
  expect(pushes).toHaveLength(1);
  expect(pushes[0]?.body).toContain("100");

  // A later crossing inside the spacing window waits, unmarked, for the next run.
  await day(t, D - 1, { totalKhatmas: 260, totalMembers: 10 });
  await t.mutation(internal.stats.checkMilestones, {});
  expect(await scheduledPushes(t)).toHaveLength(1);
  const has250 = async () =>
    (await t.run((ctx) => ctx.db.query("milestonesSent").collect())).some(
      (s) => s.metric === "khatmas" && s.value === 250,
    );
  expect(await has250()).toBe(false);
  vi.advanceTimersByTime(2 * 60_000);
  await t.mutation(internal.stats.checkMilestones, {});
  expect(await scheduledPushes(t)).toHaveLength(2);
  expect(await has250()).toBe(true);
});

test("the backfill marks milestones already passed without pushing", async () => {
  const t = convexTest(schema, modules);
  await adminWithPush(t);
  await day(t, D - 1, {
    totalKhatmas: 60,
    totalMembers: 150,
    totalRoundsCompleted: 12,
  });
  await t.mutation(internal.stats.markPassedMilestones, {});
  expect(await scheduledPushes(t)).toHaveLength(0);
  await t.mutation(internal.stats.checkMilestones, {});
  expect(await scheduledPushes(t)).toHaveLength(0);
});

test("the morning summary goes out once, at the summary hour", async () => {
  // convex-test's clock only moves forward, so this test starts early.
  vi.setSystemTime(dayStart(D) + 7 * HOUR);
  const t = convexTest(schema, modules);
  await adminWithPush(t);
  await day(t, D - 1, {
    newKhatmas: 12,
    newMembers: 140,
    ajzaFinished: 214,
    roundsCompleted: 3,
  });

  vi.setSystemTime(dayStart(D) + 7 * HOUR + 5 * 60_000);
  await t.mutation(internal.stats.morningSummary, {});
  expect(await scheduledPushes(t)).toHaveLength(0);

  vi.setSystemTime(dayStart(D) + 8 * HOUR + 5 * 60_000);
  await t.mutation(internal.stats.morningSummary, {});
  await t.mutation(internal.stats.morningSummary, {});
  const pushes = await scheduledPushes(t);
  expect(pushes).toHaveLength(1);
  expect(pushes[0]).toMatchObject({ kind: "summary" });
  expect(pushes[0]?.body).toBe(
    "أمس: ختمات جديدة 12 · أعضاء جدد 140 · أجزاء مقروءة 214 · ختمات مكتملة 3 · طلبات مساعدة مفتوحة 0",
  );

  vi.setSystemTime(dayStart(D) + 9 * HOUR + 5 * 60_000);
  await t.mutation(internal.stats.morningSummary, {});
  expect(await scheduledPushes(t)).toHaveLength(1);
});

function day(t: T, d: number, fields: Partial<Record<string, number>>) {
  return t.run(async (ctx) => {
    const existing = await ctx.db
      .query("dailyStats")
      .withIndex("by_day", (q) => q.eq("day", d))
      .first();
    const row = {
      day: d,
      ajzaFinished: 0,
      newMembers: 0,
      newKhatmas: 0,
      roundsCompleted: 0,
      signInsStarted: 0,
      signInsCompleted: 0,
      totalMembers: 0,
      totalKhatmas: 0,
      totalRoundsCompleted: 0,
      computedAt: 0,
      ...fields,
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("dailyStats", row);
  });
}

// ---------------------------------------------------------------------------
// Review fixes

test("no milestone is pushed before the backfill has run", async () => {
  const t = convexTest(schema, modules);
  await adminWithPush(t);
  await day(t, D - 1, { totalRoundsCompleted: 5 });
  await t.mutation(internal.stats.checkMilestones, {});
  expect(await scheduledPushes(t)).toHaveLength(0);
  expect(
    await t.run((ctx) => ctx.db.query("milestonesSent").collect()),
  ).toHaveLength(0);
});

test("milestones crossed together are pushed one per run, none lost", async () => {
  const t = convexTest(schema, modules);
  await adminWithPush(t);
  await t.mutation(internal.stats.markPassedMilestones, {});
  await day(t, D - 1, { totalKhatmas: 15, totalMembers: 150 });
  await t.mutation(internal.stats.checkMilestones, {});
  expect(await scheduledPushes(t)).toHaveLength(1);
  const sent = async () =>
    (await t.run((ctx) => ctx.db.query("milestonesSent").collect()))
      .map((s) => `${s.metric}:${s.value}`)
      .sort();
  expect(await sent()).toEqual(["khatmas:10"]);
  expect((await scheduledPushes(t))[0]?.body).toBe(
    "🎉 وصلنا 10 ختمات\n150 عضواً · 0 ختمة مكتملة",
  );
  vi.setSystemTime(Date.now() + 2 * 60_000);
  await t.mutation(internal.stats.checkMilestones, {});
  expect(await scheduledPushes(t)).toHaveLength(2);
  expect(await sent()).toEqual(["khatmas:10", "members:100"]);
});

test("rerunning a day after its sign-in counters were purged keeps its sign-in counts", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  await t.mutation(internal.stats.rollupDay, { day: D });
  await t.run(async (ctx) => {
    for (const c of await ctx.db.query("counters").collect())
      await ctx.db.delete(c._id);
  });
  await t.mutation(internal.stats.rollupDay, { day: D });
  expect((await rows(t))[0]).toMatchObject({
    signInsStarted: 4,
    signInsCompleted: 3,
  });
});

test("the nightly rollup stores yesterday's active khatma count", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  await t.run(async (ctx) => {
    const round = await ctx.db.query("rounds").first();
    await ctx.db.patch(round!._id, { lastFinishedAt: noon(D) });
  });
  await t.mutation(internal.stats.rollupDay, { day: D - 1 });
  vi.setSystemTime(noon(D + 1));
  await t.mutation(internal.stats.rollupYesterday, {});
  expect((await rows(t)).find((r) => r.day === D)?.activeKhatmas).toBe(1);
});

test("the nightly active khatma count skips an archived khatma", async () => {
  const t = convexTest(schema, modules);
  const { k } = await seed(t);
  await t.run(async (ctx) => {
    const round = await ctx.db.query("rounds").first();
    await ctx.db.patch(round!._id, { lastFinishedAt: noon(D) });
    await ctx.db.patch(k, { archivedAt: noon(D) });
  });
  await t.mutation(internal.stats.rollupDay, { day: D - 1 });
  vi.setSystemTime(noon(D + 1));
  await t.mutation(internal.stats.rollupYesterday, {});
  expect((await rows(t)).find((r) => r.day === D)?.activeKhatmas).toBe(0);
});

// ---------------------------------------------------------------------------
// PR review fixes

test("an empty deployment's backfill turns milestones on, and the nightly run starts the rows", async () => {
  const t = convexTest(schema, modules);
  vi.setSystemTime(noon(D));
  await t.action(internal.stats.backfill, {});
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("counters")
        .withIndex("by_key", (q) => q.eq("key", "stats:backfilledAt"))
        .first(),
    ),
  ).not.toBeNull();
  vi.setSystemTime(noon(D + 1));
  await t.mutation(internal.stats.rollupYesterday, {});
  expect((await rows(t)).map((r) => r.day)).toEqual([D]);
});

test("a rerun keeps a stored sign-in count when only one of the day's counters was purged", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  await t.mutation(internal.stats.rollupDay, { day: D });
  await t.run(async (ctx) => {
    const c = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", `signin:${D}:completed`))
      .first();
    await ctx.db.delete(c!._id);
  });
  await t.mutation(internal.stats.rollupDay, { day: D });
  expect((await rows(t))[0]).toMatchObject({
    signInsStarted: 4,
    signInsCompleted: 3,
  });
});

test("a day's row counts the rotating khatma days completed in it", async () => {
  const t = convexTest(schema, modules);
  const p = await person(t, noon(D), "+971500000001");
  const k = await khatma(t, noon(D) + 1000, p);
  const rotaDay = (n: number, completedAt: number | null) =>
    t.run((ctx) =>
      ctx.db.insert("rotaDays", {
        khatmaId: k,
        n,
        number: n,
        cycle: 1,
        date: "2026-10-20",
        startedAt: dayStart(D),
        closesAt: dayStart(D + 1),
        completedAt,
        closedAt: null,
        unreadSentAt: null,
        summarySentAt: null,
      }),
    );
  await rotaDay(1, noon(D) + 2000);
  await rotaDay(2, noon(D) + 3000);
  await rotaDay(3, noon(D + 1));
  await rotaDay(4, null);

  await t.mutation(internal.stats.rollupDay, { day: D });
  await t.mutation(internal.stats.rollupDay, { day: D + 1 });

  expect((await rows(t)).map((r) => r.rotaDaysCompleted)).toEqual([2, 1]);
});
