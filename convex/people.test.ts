import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { touchPerson } from "./people";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2027-01-15 12:00 in Asia/Dubai, a Friday: this week is Saturday 9 to Friday 15 January. */
const NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

async function setup() {
  const t = convexTest(schema, modules);
  const token = "stats-token";
  const ids = await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone: "+971570000001",
      displayName: "علي",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    });
    await ctx.db.insert("sessions", {
      personId,
      tokenHash: await sha256Hex(token),
      alertTokenHash: "alert",
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    const creator = await ctx.db.insert("people", {
      phone: "+971570000002",
      displayName: "المنظم",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    });
    const khatmaId = await ctx.db.insert("khatmas", {
      name: null,
      schedule: "none",
      grace: { value: 7, unit: "days" },
      creatorPersonId: creator,
      inviteCode: "STATSCODE012",
      completedRounds: 0,
      createdAt: NOW,
    });
    const roundId = await ctx.db.insert("rounds", {
      khatmaId,
      number: 1,
      startedAt: NOW,
      targetEndAt: null,
      completedAt: null,
      lastFinishedAt: null,
      behindInvitedAt: null,
    });
    await ctx.db.patch(khatmaId, { currentRoundId: roundId });
    const memberId = await ctx.db.insert("members", {
      khatmaId,
      personId,
      joinedAt: NOW,
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    return { personId, khatmaId, roundId, memberId };
  });
  return { t, token, ...ids };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

let juzSeq = 0;
/** A finished row taken `durationMs` before `finishedAt`. */
async function finish(t: T, c: Ctx, finishedAt: number, durationMs: number) {
  juzSeq += 1;
  await t.run((ctx) =>
    ctx.db.insert("assignments", {
      khatmaId: c.khatmaId,
      roundId: c.roundId,
      roundNumber: 1,
      juz: (juzSeq % 30) + 1,
      memberId: c.memberId,
      personId: c.personId,
      takenAt: finishedAt - durationMs,
      finishedAt,
      releasedAt: null,
      releasedBySystem: false,
      graceWakingMs: HOUR,
      noticeAt: finishedAt,
      graceEndsAt: finishedAt,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    }),
  );
}

const stats = (t: T, token?: string) =>
  t.query(api.people.myStats, { sessionToken: token });

test("myStats: pace hidden under 3 finishes; streak null under 2 weeks; juzRead counts finishes", async () => {
  const c = await setup();
  const { t, token } = c;
  expect(await stats(t, token)).toEqual({
    paceDays: null,
    juzRead: 0,
    weekStreak: null,
  });
  expect(await stats(t)).toBeNull();

  // two finishes this week: pace still hidden, one week is no streak
  await finish(t, c, NOW - DAY, 2 * DAY);
  await finish(t, c, NOW - 2 * DAY, 2 * DAY);
  expect(await stats(t, token)).toEqual({
    paceDays: null,
    juzRead: 2,
    weekStreak: null,
  });

  // an unfinished and a released row are not finishes
  await t.run((ctx) =>
    ctx.db.insert("assignments", {
      khatmaId: c.khatmaId,
      roundId: c.roundId,
      roundNumber: 1,
      juz: 30,
      memberId: c.memberId,
      personId: c.personId,
      takenAt: NOW,
      finishedAt: null,
      releasedAt: null,
      releasedBySystem: false,
      graceWakingMs: HOUR,
      noticeAt: NOW,
      graceEndsAt: NOW,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    }),
  );
  // a finish under 20 minutes counts as read but says nothing about pace
  await finish(t, c, NOW - 3 * DAY, 5 * 60_000);
  expect(await stats(t, token)).toMatchObject({ paceDays: null, juzRead: 3 });

  // a third counted finish in last week: pace is known and the streak is 2
  await finish(t, c, NOW - 8 * DAY, 2 * DAY);
  expect(await stats(t, token)).toEqual({
    paceDays: 2,
    juzRead: 4,
    weekStreak: 2,
  });
});

test("myStats: the streak may end last week, and a gap hides it", async () => {
  const c = await setup();
  const { t, token } = c;
  // last week and three weeks ago, none this week and none two weeks ago
  await finish(t, c, NOW - 8 * DAY, DAY);
  await finish(t, c, NOW - 22 * DAY, DAY);
  expect(await stats(t, token)).toMatchObject({ weekStreak: null });
  // filling the gap joins them into a streak that ends last week
  await finish(t, c, NOW - 15 * DAY, DAY);
  expect(await stats(t, token)).toMatchObject({ weekStreak: 3 });
});

test("a held juz' shows its reader their pace in days, and others nothing", async () => {
  const c = await setup();
  const { t, token } = c;
  for (const days of [1, 2, 3]) {
    await finish(t, c, NOW - days * DAY, 2 * DAY);
  }
  const view = await t.query(api.khatmas.view, {
    inviteCode: "STATSCODE012",
    sessionToken: token,
  });
  if ("notFound" in view || "rota" in view) throw new Error("not found");
  expect(view.me.hold).toBeNull();
  // taking a juz' puts the pace on the held card
  expect(
    await t.mutation(api.pool.take, {
      sessionToken: token,
      inviteCode: "STATSCODE012",
      juz: 17,
    }),
  ).toEqual({ ok: true });
  const held = await t.query(api.khatmas.view, {
    inviteCode: "STATSCODE012",
    sessionToken: token,
  });
  if ("notFound" in held || "rota" in held) throw new Error("not found");
  expect(held.me.hold?.paceDays).toBe(2);
});

test("touch writes only what changed: nothing at all when the person was seen within the hour in the same zone", async () => {
  const person = {
    _id: "p1",
    lastSeenAt: NOW - 1000,
    timeZone: "Asia/Dubai",
  } as unknown as Doc<"people">;
  const patch = vi.fn();
  const ctx = { db: { patch } } as unknown as MutationCtx;

  await touchPerson(ctx, person, NOW, "Asia/Dubai");
  expect(patch).not.toHaveBeenCalled();

  await touchPerson(ctx, person, NOW, "Europe/London");
  expect(patch).toHaveBeenLastCalledWith("p1", { timeZone: "Europe/London" });

  await touchPerson(ctx, person, NOW + HOUR, "Asia/Dubai");
  expect(patch).toHaveBeenLastCalledWith("p1", { lastSeenAt: NOW + HOUR });
  expect(patch).toHaveBeenCalledTimes(2);
});

test("me: says whether the caller may create a rota khatma; missing means no; signed out is null", async () => {
  const c = await setup();
  const { t, token, personId } = c;
  const rotaAllowed = async () =>
    (await t.query(api.people.me, { sessionToken: token }))?.rotaAllowed;
  expect(await rotaAllowed()).toBe(false);
  await t.run((ctx) => ctx.db.patch(personId, { rotaAllowed: true }));
  expect(await rotaAllowed()).toBe(true);
  await t.run((ctx) => ctx.db.patch(personId, { rotaAllowed: false }));
  expect(await rotaAllowed()).toBe(false);
  expect(await t.query(api.people.me, {})).toBeNull();
});

test("me: gives each person a stable analytics id that is not their Convex id", async () => {
  const c = await setup();
  const { t, token, personId } = c;
  const first = await t.query(api.people.me, { sessionToken: token });
  const again = await t.query(api.people.me, { sessionToken: token });
  expect(first?.analyticsId).toMatch(/^[0-9a-f]{64}$/);
  expect(first?.analyticsId).not.toContain(personId);
  expect(again?.analyticsId).toBe(first?.analyticsId);

  const otherToken = "other-token";
  await t.run(async (ctx) => {
    const otherId = await ctx.db.insert("people", {
      phone: "+971570000003",
      displayName: "سارة",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    });
    await ctx.db.insert("sessions", {
      personId: otherId,
      tokenHash: await sha256Hex(otherToken),
      alertTokenHash: "alert-other",
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
  });
  const other = await t.query(api.people.me, { sessionToken: otherToken });
  expect(other?.analyticsId).toMatch(/^[0-9a-f]{64}$/);
  expect(other?.analyticsId).not.toBe(first?.analyticsId);
});
