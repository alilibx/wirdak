import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

let seq = 0;

/** A person with a live session; returns the raw session token. */
async function signedIn(t: T, displayName: string) {
  seq += 1;
  const token = `token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone: `+9715000000${String(seq).padStart(2, "0")}`,
      displayName,
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    });
    await ctx.db.insert("sessions", {
      personId: id,
      tokenHash,
      alertTokenHash: `alert-${seq}`,
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    return id;
  });
  return { personId, token, displayName };
}
type Who = Awaited<ReturnType<typeof signedIn>>;

async function createKhatma(
  t: T,
  who: Who,
  schedule: "weekly" | "none" | "daily" = "weekly",
  name: string | null = null,
) {
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: who.token,
    name,
    schedule,
  });
  return inviteCode;
}

async function khatmaByCode(t: T, inviteCode: string) {
  return await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    if (!khatma) throw new Error("no khatma");
    return khatma;
  });
}

async function join(
  t: T,
  khatmaId: Id<"khatmas">,
  who: Who,
  opts: { status?: "active" | "blocked"; shareToken?: string } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("members", {
      khatmaId,
      personId: who.personId,
      joinedAt: Date.now(),
      status: opts.status ?? "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
      shareToken: opts.shareToken,
    }),
  );
}

async function memberOf(t: T, khatmaId: Id<"khatmas">, who: Who) {
  return await t.run(async (ctx) => {
    const m = await ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatmaId).eq("personId", who.personId),
      )
      .unique();
    if (!m) throw new Error("no member");
    return m;
  });
}

/** Inserts an assignment directly: finished, released, or still being read. */
async function assign(
  t: T,
  khatmaId: Id<"khatmas">,
  who: Who,
  juz: number,
  state: "reading" | "done" | "released",
  roundNumber = 1,
  finishedAt: number = NOW,
) {
  const member = await memberOf(t, khatmaId, who);
  await t.run(async (ctx) => {
    const round = await ctx.db
      .query("rounds")
      .withIndex("by_khatma_number", (q) =>
        q.eq("khatmaId", khatmaId).eq("number", roundNumber),
      )
      .unique();
    if (!round) throw new Error("no round");
    await ctx.db.insert("assignments", {
      khatmaId,
      roundId: round._id,
      roundNumber,
      juz,
      memberId: member._id,
      personId: who.personId,
      takenAt: NOW,
      finishedAt: state === "done" ? finishedAt : null,
      releasedAt: state === "released" ? NOW : null,
      releasedBySystem: false,
      graceWakingMs: 0,
      noticeAt: NOW,
      graceEndsAt: NOW,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    });
  });
}

async function viewAs(t: T, inviteCode: string, who: Who | null) {
  const res = await t.query(api.khatmas.view, {
    inviteCode,
    sessionToken: who?.token,
  });
  if ("notFound" in res || "rota" in res)
    throw new Error("unexpected notFound");
  return res;
}

async function setSetting(t: T, key: string, value: unknown) {
  await t.run((ctx) =>
    ctx.db.insert("settings", { key, value, updatedAt: NOW }),
  );
}

const finish = (t: T, code: string, who: Who) =>
  t.mutation(api.pool.finish, { sessionToken: who.token, inviteCode: code });
const undo = (t: T, code: string, who: Who) =>
  t.mutation(api.pool.undoFinish, {
    sessionToken: who.token,
    inviteCode: code,
  });
const take = (t: T, code: string, who: Who, juz: number) =>
  t.mutation(api.pool.take, {
    sessionToken: who.token,
    inviteCode: code,
    juz,
  });
const celebrated = (t: T, code: string, who: Who | null) =>
  t.mutation(api.khatmas.markCelebrated, {
    sessionToken: who?.token,
    inviteCode: code,
  });

async function roundByNumber(t: T, khatmaId: Id<"khatmas">, number: number) {
  return await t.run((ctx) =>
    ctx.db
      .query("rounds")
      .withIndex("by_khatma_number", (q) =>
        q.eq("khatmaId", khatmaId).eq("number", number),
      )
      .unique(),
  );
}

/** A khatma whose round 1 has the given ajza' done (by the creator), plus a second member. */
async function almostDone(doneJuz: number[]) {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  const bob = await signedIn(t, "B");
  await join(t, khatma._id, bob);
  for (const juz of doneJuz) await assign(t, khatma._id, ali, juz, "done");
  vi.setSystemTime(NOW); // creating a khatma runs an action, which nudges the clock
  return { t, ali, bob, code, khatma };
}
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

test("30th finish completes the round 10s later and starts the next", async () => {
  const { t, bob, code, khatma } = await almostDone(range(1, 29));
  await take(t, code, bob, 30);
  expect(await finish(t, code, bob)).toMatchObject({ ok: true });

  // not yet: the delay has not passed
  vi.advanceTimersByTime(9_000);
  await t.finishInProgressScheduledFunctions();
  expect((await roundByNumber(t, khatma._id, 1))?.completedAt).toBeNull();
  expect((await viewAs(t, code, bob)).roundNumber).toBe(1);

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const r1 = await roundByNumber(t, khatma._id, 1);
  expect(r1?.completedAt).not.toBeNull();
  const after = await khatmaByCode(t, khatma.inviteCode);
  expect(after.completedRounds).toBe(1);
  const r2 = await roundByNumber(t, khatma._id, 2);
  expect(r2).toMatchObject({ completedAt: null, lastFinishedAt: null });
  expect(after.currentRoundId).toBe(r2?._id);
  // weekly schedule: the next target end is 7 days after the new round starts
  expect((r2?.targetEndAt ?? 0) - (r2?.startedAt ?? 0)).toBe(7 * 86_400_000);
  expect(r2?.startedAt).toBeGreaterThanOrEqual(r1?.completedAt ?? Infinity);

  const view = await viewAs(t, code, bob);
  expect(view.roundNumber).toBe(2);
  expect(view.completedRounds).toBe(1);
  expect(view.tiles).toHaveLength(30);
  expect(view.tiles.every((x) => x.state === "open")).toBe(true);
  expect(view.lastCompleted).toEqual({ roundNumber: 1, participants: 2 });
  expect(view.me.holding).toBeNull();
});

test("finishing a non-final juz schedules no completion", async () => {
  const { t, bob, code } = await almostDone(range(1, 28));
  await take(t, code, bob, 29);
  // taking schedules the hold's grace and reminder jobs; finishing adds only its cheer
  const before = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(before.map((j) => j.name).sort()).toEqual([
    "grace:endDue",
    "grace:noticeDue",
    "nudges:reminderDue",
  ]);
  await finish(t, code, bob);
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(scheduled.filter((j) => !j.name.startsWith("cheers:"))).toEqual(
    before,
  );
  expect(scheduled.map((j) => j.name)).toContain("cheers:afterFinish");
});

test("undo of an earlier finish cancels a pending completion", async () => {
  const { t, ali, bob, code, khatma } = await almostDone(range(1, 28));
  await take(t, code, ali, 29);
  await take(t, code, bob, 30);

  expect(await finish(t, code, ali)).toMatchObject({ ok: true }); // t0, 29 done
  vi.setSystemTime(NOW + 5_000);
  expect(await finish(t, code, bob)).toMatchObject({ ok: true }); // 30 done
  vi.setSystemTime(NOW + 8_000);
  expect(await undo(t, code, ali)).toEqual({ ok: true });

  vi.setSystemTime(NOW + 15_100);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await roundByNumber(t, khatma._id, 1))?.completedAt).toBeNull();
  expect((await khatmaByCode(t, khatma.inviteCode)).completedRounds).toBe(0);
  expect((await viewAs(t, code, ali)).roundNumber).toBe(1);
  // and once ali finishes again, completion follows ten seconds later
  expect(await finish(t, code, ali)).toMatchObject({ ok: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await viewAs(t, code, ali)).roundNumber).toBe(2);
});

test("a finish 5s after another delays completion to the later finish + 10s", async () => {
  const { t, ali, code, khatma } = await almostDone(range(1, 29));
  await take(t, code, ali, 30);
  await finish(t, code, ali); // completion armed for ~t0+10s
  vi.advanceTimersByTime(3_000);
  expect(await undo(t, code, ali)).toEqual({ ok: true });
  vi.advanceTimersByTime(2_000);
  expect(await finish(t, code, ali)).toMatchObject({ ok: true }); // t0+5s

  // the first timer fires at t0+10s but the latest finish is only 5s old
  vi.advanceTimersByTime(5_200);
  await t.finishInProgressScheduledFunctions();
  expect((await roundByNumber(t, khatma._id, 1))?.completedAt).toBeNull();

  vi.advanceTimersByTime(5_000);
  await t.finishInProgressScheduledFunctions();
  expect((await roundByNumber(t, khatma._id, 1))?.completedAt).not.toBeNull();
  expect((await viewAs(t, code, ali)).roundNumber).toBe(2);
});

test("completeIfReady reschedules itself when a later finish moved the deadline", async () => {
  const { t, code, khatma } = await almostDone(range(1, 30));
  const round = await roundByNumber(t, khatma._id, 1);
  if (!round) throw new Error("no round");
  const lastFinishedAt = NOW + 5_000;
  await t.run((ctx) => ctx.db.patch(round._id, { lastFinishedAt }));

  expect(
    await t.mutation(internal.rounds.completeIfReady, { roundId: round._id }),
  ).toEqual({ completed: false });
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0]?.scheduledTime).toBe(lastFinishedAt + 10_000);
  expect((await roundByNumber(t, khatma._id, 1))?.completedAt).toBeNull();

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await roundByNumber(t, khatma._id, 1))?.completedAt).not.toBeNull();
  expect((await viewAs(t, code, null)).roundNumber).toBe(2);
});

test("completion runs once even if scheduled twice", async () => {
  const { t, bob, code, khatma } = await almostDone(range(1, 29));
  await take(t, code, bob, 30);
  await finish(t, code, bob);
  const round = await roundByNumber(t, khatma._id, 1);
  if (!round) throw new Error("no round");
  // a second, duplicate schedule for the same round
  await t.run((ctx) =>
    ctx.scheduler.runAfter(10_000, internal.rounds.completeIfReady, {
      roundId: round._id,
    }),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect((await khatmaByCode(t, khatma.inviteCode)).completedRounds).toBe(1);
  const rounds = await t.run((ctx) => ctx.db.query("rounds").collect());
  expect(rounds.filter((r) => r.khatmaId === khatma._id)).toHaveLength(2);
  // running it directly again changes nothing
  expect(
    await t.mutation(internal.rounds.completeIfReady, { roundId: round._id }),
  ).toEqual({ completed: false });
  expect((await khatmaByCode(t, khatma.inviteCode)).completedRounds).toBe(1);
});

test("completeIfReady is a no-op unless all 30 are done", async () => {
  const { t, khatma } = await almostDone(range(1, 29));
  const round = await roundByNumber(t, khatma._id, 1);
  if (!round) throw new Error("no round");
  vi.setSystemTime(NOW + 60_000);
  expect(
    await t.mutation(internal.rounds.completeIfReady, { roundId: round._id }),
  ).toEqual({ completed: false });
  expect((await roundByNumber(t, khatma._id, 1))?.completedAt).toBeNull();
  expect((await khatmaByCode(t, khatma.inviteCode)).completedRounds).toBe(0);
});

test("members see celebrateRound until markCelebrated", async () => {
  const { t, ali, bob, code, khatma } = await almostDone(range(1, 29));
  const carol = await signedIn(t, "C"); // never joins
  await take(t, code, bob, 30);
  await finish(t, code, bob);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect((await viewAs(t, code, ali)).me.celebrateRound).toBe(1);
  expect((await viewAs(t, code, bob)).me.celebrateRound).toBe(1);
  expect((await viewAs(t, code, carol)).me.celebrateRound).toBeNull();

  expect(await celebrated(t, code, ali)).toEqual({ ok: true });
  expect((await memberOf(t, khatma._id, ali)).lastCelebratedRound).toBe(1);
  expect((await viewAs(t, code, ali)).me.celebrateRound).toBeNull();
  // bob has not celebrated yet
  expect((await viewAs(t, code, bob)).me.celebrateRound).toBe(1);
});

test("markCelebrated is a no-op for non-members, signed-out callers, blocked members, and dead links", async () => {
  const { t, code, khatma, ali } = await almostDone([]);
  const carol = await signedIn(t, "C");
  const dave = await signedIn(t, "D");
  await join(t, khatma._id, dave, { status: "blocked" });
  await t.run((ctx) => ctx.db.patch(khatma._id, { completedRounds: 3 }));

  expect(await celebrated(t, code, carol)).toEqual({ ok: false });
  expect(await celebrated(t, code, null)).toEqual({ ok: false });
  expect(await celebrated(t, code, dave)).toEqual({ ok: false });
  expect(await celebrated(t, "AAAAAAAAAAAA", ali)).toEqual({ ok: false });
  expect(await celebrated(t, "bad", ali)).toEqual({ ok: false });

  expect((await memberOf(t, khatma._id, dave)).lastCelebratedRound).toBe(0);
  const members = await t.run((ctx) => ctx.db.query("members").collect());
  // carol did not become a member
  expect(members.filter((m) => m.khatmaId === khatma._id)).toHaveLength(3);
  expect(await celebrated(t, code, ali)).toEqual({ ok: true });
  expect((await memberOf(t, khatma._id, ali)).lastCelebratedRound).toBe(3);
});

test("undo right after the round completed reports round_completed", async () => {
  const { t, bob, code } = await almostDone(range(1, 29));
  // a longer window than the completion delay, so the finish is still "recent"
  await setSetting(t, "undoWindowMs", 60_000);
  await take(t, code, bob, 30);
  await finish(t, code, bob);
  // just past the completion delay (running every timer would also run the
  // hold's grace jobs, days later, and close the undo window)
  vi.advanceTimersByTime(11_000);
  await t.finishInProgressScheduledFunctions();
  expect((await viewAs(t, code, bob)).roundNumber).toBe(2);
  expect(await undo(t, code, bob)).toEqual({
    ok: false,
    reason: "round_completed",
  });
});

test("undo in the next round, well after the window, reports window_closed", async () => {
  const { t, bob, code } = await almostDone(range(1, 29));
  await take(t, code, bob, 30);
  await finish(t, code, bob);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.advanceTimersByTime(60_000);
  expect(await undo(t, code, bob)).toEqual({
    ok: false,
    reason: "window_closed",
  });
});

test("undo is nothing_to_undo for someone who never finished in this khatma", async () => {
  const { t, bob, code } = await almostDone(range(1, 29));
  await take(t, code, bob, 30);
  await finish(t, code, bob);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  // a newcomer has no finish anywhere in this khatma
  const carol = await signedIn(t, "C");
  expect(await undo(t, code, carol)).toEqual({
    ok: false,
    reason: "nothing_to_undo",
  });
});
