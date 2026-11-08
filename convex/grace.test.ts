import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { JUZ } from "./lib/juz";
import { noteText } from "./lib/noteText";
import { addWakingMs, isQuiet } from "./lib/wakingTime";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 2027-01-15 12:00 in Asia/Dubai (UTC+4). */
const NOW = 1_800_000_000_000;
const TZ = "Asia/Dubai";
const QUIET = { startHour: 22, endHour: 7 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

let seq = 0;

/** A person with a live session. */
async function signedIn(t: T, displayName: string) {
  seq += 1;
  const token = `grace-token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const ids = await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone: `+97155000${String(seq).padStart(4, "0")}`,
      displayName,
      verifiedAt: 0,
      timeZone: TZ,
      lastSeenAt: 0,
    });
    const sessionId = await ctx.db.insert("sessions", {
      personId,
      tokenHash,
      alertTokenHash: `alert-${seq}`,
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    return { personId, sessionId };
  });
  return { ...ids, token, displayName };
}
type Who = Awaited<ReturnType<typeof signedIn>>;

/** A daily khatma (6-hour grace) created by `who`, without moving the clock. */
async function createKhatma(t: T, who: Who) {
  const at = Date.now();
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: who.token,
    name: null,
    schedule: "daily",
  });
  // an action nudges the fake clock; nothing is scheduled yet, so reset it
  vi.setSystemTime(at);
  const khatma = await t.run(async (ctx) =>
    ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique(),
  );
  if (!khatma) throw new Error("no khatma");
  return { code: inviteCode, khatma };
}

async function setup() {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatma } = await createKhatma(t, org);
  return { t, org, code, khatma };
}

async function join(t: T, khatmaId: Id<"khatmas">, who: Who) {
  await t.run((ctx) =>
    ctx.db.insert("members", {
      khatmaId,
      personId: who.personId,
      joinedAt: NOW,
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    }),
  );
}

async function subscribe(t: T, who: Who) {
  await t.run((ctx) =>
    ctx.db.insert("pushSubscriptions", {
      personId: who.personId,
      sessionId: who.sessionId,
      endpoint: `https://push.example/${who.personId}`,
      p256dh: "p",
      auth: "a",
      createdAt: NOW,
    }),
  );
}

/** A finished row for `juz`, inserted directly (the reader must be a member). */
async function insertDone(t: T, khatma: Doc<"khatmas">, who: Who, juz: number) {
  await t.run(async (ctx) => {
    const member = await ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatma._id).eq("personId", who.personId),
      )
      .unique();
    if (!member || !khatma.currentRoundId) throw new Error("bad fixture");
    await ctx.db.insert("assignments", {
      khatmaId: khatma._id,
      roundId: khatma.currentRoundId,
      roundNumber: 1,
      juz,
      memberId: member._id,
      personId: who.personId,
      takenAt: NOW,
      finishedAt: NOW,
      releasedAt: null,
      releasedBySystem: false,
      graceWakingMs: 6 * HOUR,
      noticeAt: NOW,
      graceEndsAt: NOW,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    });
  });
}

/** The newest row for a juz' in the khatma. */
async function rowOf(t: T, khatmaId: Id<"khatmas">, juz: number) {
  const rows = await t.run((ctx) => ctx.db.query("assignments").collect());
  const mine = rows
    .filter((a) => a.khatmaId === khatmaId && a.juz === juz)
    .sort((a, b) => b._creationTime - a._creationTime);
  if (!mine[0]) throw new Error(`no row for juz ${juz}`);
  return mine[0];
}

async function notesOf(t: T, who: Who, kind?: Doc<"notes">["kind"]) {
  const notes = await t.run((ctx) => ctx.db.query("notes").collect());
  return notes.filter(
    (n) => n.personId === who.personId && (!kind || n.kind === kind),
  );
}

const uncleared = (notes: Doc<"notes">[]) =>
  notes.filter((n) => n.clearedAt === null);

async function scheduled(t: T, fragment: string) {
  const rows = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return rows.filter((r) => r.name.includes(fragment));
}

/** convex-test's clock ticks a millisecond or so inside a call; allow a second. */
function expectNear(actual: number | null | undefined, expected: number) {
  expect(actual).toBeGreaterThanOrEqual(expected);
  expect(actual).toBeLessThan(expected + 1000);
}

/** Moves the clock to `at`, running every scheduled function due by then. */
async function advanceTo(t: T, at: number) {
  vi.advanceTimersByTime(Math.max(0, at - Date.now()));
  await t.finishInProgressScheduledFunctions();
}

/** Runs functions scheduled "right away" (runAfter 0). */
async function flush(t: T) {
  await advanceTo(t, Date.now() + 10);
}

/** Steps the clock through a row's almost-up note and on to its grace end. */
async function runOut(t: T, row: Doc<"assignments">) {
  await advanceTo(t, row.noticeAt);
  await advanceTo(t, row.graceEndsAt);
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

const take = (t: T, code: string, who: Who, juz: number) =>
  t.mutation(api.pool.take, { sessionToken: who.token, inviteCode: code, juz });
const finish = (t: T, code: string, who: Who) =>
  t.mutation(api.pool.finish, { sessionToken: who.token, inviteCode: code });
const undo = (t: T, code: string, who: Who) =>
  t.mutation(api.pool.undoFinish, {
    sessionToken: who.token,
    inviteCode: code,
  });
const release = (t: T, code: string, who: Who) =>
  t.mutation(api.pool.release, { sessionToken: who.token, inviteCode: code });
const stillReading = (t: T, code: string, who: Who) =>
  t.mutation(api.pool.stillReading, {
    sessionToken: who.token,
    inviteCode: code,
  });
const endDue = (t: T, row: Doc<"assignments">, endsAt = row.graceEndsAt) =>
  t.mutation(internal.grace.endDue, { assignmentId: row._id, endsAt });

test("almost-up note fires at a quarter left, and no push falls in quiet hours", async () => {
  const { t, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  vi.setSystemTime(NOW + 9.5 * HOUR); // 21:30 in Dubai
  expect(await take(t, code, ali, 12)).toEqual({ ok: true });
  await subscribe(t, ali);

  const row = await rowOf(t, khatma._id, 12);
  expect(row.graceWakingMs).toBe(6 * HOUR);
  expectNear(row.noticeAt, NOW + 23 * HOUR); // 11:00 the next day
  expectNear(row.graceEndsAt, NOW + 24.5 * HOUR); // 12:30 the next day
  expect(row).toMatchObject({
    extended: false,
    noticeSentAt: null,
    openedForHelpAt: null,
  });
  const [notice] = await scheduled(t, "noticeDue");
  const [end] = await scheduled(t, "endDue");
  expect(notice?.scheduledTime).toBe(row.noticeAt);
  expect(notice?.args).toEqual([{ assignmentId: row._id }]);
  expect(end?.scheduledTime).toBe(row.graceEndsAt);
  expect(end?.args).toEqual([
    { assignmentId: row._id, endsAt: row.graceEndsAt },
  ]);
  expect((await viewAs(t, code, ali)).me.hold).toEqual({
    openForHelp: false,
    canExtend: false,
    paceDays: null,
  });

  // all night and into the morning: nothing
  await advanceTo(t, row.noticeAt - 1);
  expect(await notesOf(t, ali)).toHaveLength(0);
  expect(await scheduled(t, "pushNode")).toHaveLength(0);

  await advanceTo(t, row.noticeAt);
  const notes = await notesOf(t, ali);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({
    kind: "almostUp",
    juz: [12],
    assignmentId: row._id,
    clearedAt: null,
  });
  if (!notes[0]) throw new Error("no note");
  expect(noteText(notes[0])).toBe(
    "مهلة الجزء 12 أوشكت على الانتهاء. هل تحتاج وقتاً أطول؟",
  );
  expect((await rowOf(t, khatma._id, 12)).noticeSentAt).not.toBeNull();
  const pushes = await scheduled(t, "pushNode");
  expect(pushes).toHaveLength(1);
  expect(isQuiet(pushes[0]?.scheduledTime ?? 0, TZ, QUIET)).toBe(false);
  expect((await viewAs(t, code, ali)).me.hold).toEqual({
    openForHelp: false,
    canExtend: true,
    paceDays: null,
  });
});

test("stillReading extends once; second tap returns already_extended", async () => {
  const { t, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "B");
  await join(t, khatma._id, bob);
  await take(t, code, ali, 4);
  const row = await rowOf(t, khatma._id, 4);
  await advanceTo(t, row.noticeAt);
  expect(uncleared(await notesOf(t, ali, "almostUp"))).toHaveLength(1);

  expect(await stillReading(t, code, ali)).toEqual({ ok: true });
  const extended = await rowOf(t, khatma._id, 4);
  expect(extended.extended).toBe(true);
  expect(extended.graceEndsAt).toBe(
    addWakingMs(row.graceEndsAt, row.graceWakingMs, TZ, QUIET),
  );
  expect(uncleared(await notesOf(t, ali, "almostUp"))).toHaveLength(0);
  const ends = await scheduled(t, "endDue");
  expect(
    ends.filter(
      (j) =>
        j.scheduledTime === extended.graceEndsAt &&
        j.args[0]?.endsAt === extended.graceEndsAt,
    ),
  ).toHaveLength(1);
  expect((await viewAs(t, code, ali)).me.hold).toEqual({
    openForHelp: false,
    canExtend: false,
    paceDays: null,
  });

  expect(await stillReading(t, code, ali)).toEqual({
    ok: false,
    reason: "already_extended",
  });
  expect((await rowOf(t, khatma._id, 4)).graceEndsAt).toBe(
    extended.graceEndsAt,
  );
  expect(await stillReading(t, code, bob)).toEqual({
    ok: false,
    reason: "not_holding",
  });
});

test("after the extension runs out the juz opens with no second almost-up note", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await take(t, code, ali, 4);
  const row = await rowOf(t, khatma._id, 4);
  await advanceTo(t, row.noticeAt);
  expect(await stillReading(t, code, ali)).toEqual({ ok: true });
  const extended = await rowOf(t, khatma._id, 4);

  // the original end passes: nothing opens
  await advanceTo(t, row.graceEndsAt + MINUTE);
  expect((await rowOf(t, khatma._id, 4)).openedForHelpAt).toBeNull();
  expect(await notesOf(t, org, "openForHelp")).toHaveLength(0);

  await advanceTo(t, extended.graceEndsAt);
  const opened = await rowOf(t, khatma._id, 4);
  expectNear(opened.openedForHelpAt, extended.graceEndsAt);
  expect(await notesOf(t, ali, "almostUp")).toHaveLength(1);
  expect(uncleared(await notesOf(t, org, "openForHelp"))).toHaveLength(1);
  expect(await stillReading(t, code, ali)).toEqual({
    ok: false,
    reason: "opened",
  });
});

test("opened juz looks open to members, viewers, and the organizer; reader still sees it as theirs", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "قارئ الجزء الخامس");
  const bob = await signedIn(t, "B");
  const carol = await signedIn(t, "C"); // signed in, never joins
  await join(t, khatma._id, bob);
  await take(t, code, ali, 5);
  // juz' 6 goes back to the pool the ordinary way, for comparison
  await take(t, code, bob, 6);
  await release(t, code, bob);
  await runOut(t, await rowOf(t, khatma._id, 5));
  expect((await rowOf(t, khatma._id, 5)).openedForHelpAt).not.toBeNull();

  const openTile = (juz: number) => ({
    juz,
    name: JUZ[juz - 1]?.name,
    state: "open",
    readerName: null,
    isMine: false,
  });
  for (const who of [bob, org, null, carol]) {
    const view = await viewAs(t, code, who);
    expect(view.tiles[4]).toEqual(openTile(5));
    expect(view.tiles[5]).toEqual(openTile(6));
    const json = JSON.stringify(view);
    expect(json).not.toContain(ali.displayName);
    expect(json).not.toContain(ali.personId);
  }

  const mine = await viewAs(t, code, ali);
  expect(mine.tiles[4]).toEqual({
    juz: 5,
    name: JUZ[4]?.name,
    state: "reading",
    readerName: ali.displayName,
    isMine: true,
  });
  expect(mine.me.holding).toBe(5);
  expect(mine.me.hold).toEqual({
    openForHelp: true,
    canExtend: false,
    paceDays: null,
  });
  // still holding, so no second juz' for now
  expect(await take(t, code, ali, 7)).toEqual({
    ok: false,
    reason: "already_holding",
  });
});

test("organizer alert on timeout and on release are identical", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const first = await createKhatma(t, org);
  const second = await createKhatma(t, org);
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "B");

  await take(t, first.code, ali, 3);
  await take(t, second.code, bob, 3);
  expect(await release(t, second.code, bob)).toEqual({ ok: true });
  await runOut(t, await rowOf(t, first.khatma._id, 3));
  expect((await rowOf(t, first.khatma._id, 3)).openedForHelpAt).not.toBeNull();

  const alerts = await notesOf(t, org, "openForHelp");
  expect(alerts).toHaveLength(2);
  const shape = (n: Doc<"notes">) => ({
    kind: n.kind,
    juz: n.juz,
    count: n.count,
    until: n.until,
    assignmentId: n.assignmentId,
    roundNumber: n.roundNumber,
    clearedAt: n.clearedAt,
    text: noteText(n),
  });
  const [timedOut, released] = [
    alerts.find((n) => n.khatmaId === first.khatma._id),
    alerts.find((n) => n.khatmaId === second.khatma._id),
  ];
  if (!timedOut || !released) throw new Error("missing alert");
  expect(shape(timedOut)).toEqual(shape(released));
  expect(noteText(timedOut)).toBe(
    "الجزء 3 متاح لمن يساعد. هل تأخذه أو ترسل الدعوة؟",
  );
  // the reader isn't told their juz' opened; the releaser gets nothing either
  expect(uncleared(await notesOf(t, ali))).toHaveLength(0);
  expect(await notesOf(t, bob)).toHaveLength(0);
});

test("releasing a juz already open for help doesn't list it twice", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await take(t, code, ali, 5);
  await runOut(t, await rowOf(t, khatma._id, 5));
  expect(await release(t, code, ali)).toEqual({ ok: true });
  const alerts = await notesOf(t, org, "openForHelp");
  expect(alerts.map((n) => [n.juz, n.clearedAt])).toEqual([[[5], null]]);
  expect(await scheduled(t, "pushNode")).toHaveLength(0);
  expect(uncleared(await notesOf(t, ali))).toHaveLength(0);
});

test("no organizer alert when the organizer is the reader or the releaser", async () => {
  const { t, org, code, khatma } = await setup();
  await take(t, code, org, 1);
  await runOut(t, await rowOf(t, khatma._id, 1));
  expect((await rowOf(t, khatma._id, 1)).openedForHelpAt).not.toBeNull();
  expect(await notesOf(t, org, "openForHelp")).toHaveLength(0);

  expect(await release(t, code, org)).toEqual({ ok: true });
  await take(t, code, org, 2);
  expect(await release(t, code, org)).toEqual({ ok: true });
  expect(await notesOf(t, org, "openForHelp")).toHaveLength(0);
});

test("two ajza opening within an hour make one alert listing both", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "B");
  const carol = await signedIn(t, "C");
  await take(t, code, bob, 15);
  await advanceTo(t, NOW + 30 * MINUTE);
  await take(t, code, ali, 12);
  await advanceTo(t, NOW + 2 * HOUR);
  await take(t, code, carol, 20);

  await runOut(t, await rowOf(t, khatma._id, 15));
  await runOut(t, await rowOf(t, khatma._id, 12));
  let alerts = await notesOf(t, org, "openForHelp");
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.juz).toEqual([12, 15]);
  if (!alerts[0]) throw new Error("no alert");
  expect(noteText(alerts[0])).toBe(
    "الأجزاء 12 و15 متاحة لمن يساعد. هل تأخذ أحدها أو ترسل الدعوة؟",
  );

  // two hours after the first alert: a new one
  await runOut(t, await rowOf(t, khatma._id, 20));
  alerts = await notesOf(t, org, "openForHelp");
  expect(alerts.map((n) => n.juz)).toEqual([[12, 15], [20]]);
});

test("a juz added after the batched alert was pushed schedules another push", async () => {
  const { t, org, code, khatma } = await setup();
  await subscribe(t, org);
  const readers = [
    await signedIn(t, "A"),
    await signedIn(t, "B"),
    await signedIn(t, "C"),
  ];
  for (const [i, who] of readers.entries()) await take(t, code, who, i + 1);
  const rows = await Promise.all(
    [1, 2, 3].map((juz) => rowOf(t, khatma._id, juz)),
  );
  // Ends are run by hand: running the push itself needs web-push.
  vi.setSystemTime(rows[0]?.graceEndsAt ?? 0);
  await endDue(t, rows[0] as Doc<"assignments">);
  let pushes = await scheduled(t, "pushNode");
  expect(pushes).toHaveLength(1);
  const [alert] = await notesOf(t, org, "openForHelp");
  if (!alert) throw new Error("no alert");

  // its push hasn't gone out: the second juz' just joins it
  vi.setSystemTime((rows[0]?.graceEndsAt ?? 0) + 10 * MINUTE);
  await endDue(t, rows[1] as Doc<"assignments">);
  expect(await scheduled(t, "pushNode")).toHaveLength(1);
  expect((await notesOf(t, org, "openForHelp"))[0]?.juz).toEqual([1, 2]);

  // once pushed, a third juz' schedules another push of the same note
  await t.run((ctx) => ctx.db.patch(alert._id, { pushedAt: Date.now() }));
  vi.setSystemTime((rows[0]?.graceEndsAt ?? 0) + 20 * MINUTE);
  await endDue(t, rows[2] as Doc<"assignments">);
  pushes = await scheduled(t, "pushNode");
  expect(pushes).toHaveLength(2);
  expect(pushes.map((p) => p.args[0])).toEqual([
    { noteId: alert._id },
    { noteId: alert._id },
  ]);
  expectNear(pushes[1]?.scheduledTime, Date.now());
  const notes = await notesOf(t, org, "openForHelp");
  expect(notes).toHaveLength(1);
  expect(notes[0]?.juz).toEqual([1, 2, 3]);
});

test("undo after noticeAt passed while finished sends the almost-up note", async () => {
  const { t, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await take(t, code, ali, 7);
  const row = await rowOf(t, khatma._id, 7);
  await advanceTo(t, row.noticeAt - 5_000);
  expect(await finish(t, code, ali)).toMatchObject({ ok: true });
  await advanceTo(t, row.noticeAt + 1_000); // the original job runs, and does nothing
  expect(await notesOf(t, ali)).toHaveLength(0);
  expect((await rowOf(t, khatma._id, 7)).noticeSentAt).toBeNull();

  expect(await undo(t, code, ali)).toEqual({ ok: true });
  await flush(t);
  const notes = await notesOf(t, ali, "almostUp");
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ juz: [7], clearedAt: null });
  const after = await rowOf(t, khatma._id, 7);
  expect(after.noticeSentAt).not.toBeNull();
  expect(after.openedForHelpAt).toBeNull();
  expect(after.graceEndsAt).toBe(row.graceEndsAt);
});

test("reader finishes after open: counts done and completion still works", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  for (let juz = 1; juz <= 29; juz++) await insertDone(t, khatma, org, juz);
  await take(t, code, ali, 30);
  await runOut(t, await rowOf(t, khatma._id, 30));
  expect((await rowOf(t, khatma._id, 30)).openedForHelpAt).not.toBeNull();
  expect(uncleared(await notesOf(t, org, "openForHelp"))).toHaveLength(1);

  expect(await finish(t, code, ali)).toMatchObject({ ok: true });
  expect((await rowOf(t, khatma._id, 30)).finishedAt).not.toBeNull();
  for (const who of [org, ali, null]) {
    expect((await viewAs(t, code, who)).tiles[29]?.state).toBe("done");
  }
  // the organizer's alert and the reader's notes no longer apply
  expect(uncleared(await notesOf(t, org, "openForHelp"))).toHaveLength(0);
  expect(uncleared(await notesOf(t, ali))).toHaveLength(0);

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const view = await viewAs(t, code, ali);
  expect(view.roundNumber).toBe(2);
  expect(view.lastCompleted).toEqual({ roundNumber: 1, participants: 2 });
});

test("someone else takes it: old row released by system, one thanks note, reader's pace unchanged", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "B");
  await take(t, code, ali, 9);
  const old = await rowOf(t, khatma._id, 9);
  await runOut(t, old);
  expect(uncleared(await notesOf(t, org, "openForHelp"))).toHaveLength(1);

  expect(await take(t, code, bob, 9)).toEqual({ ok: true });
  const ended = await t.run((ctx) => ctx.db.get(old._id));
  expect(ended).toMatchObject({
    releasedBySystem: true,
    finishedAt: null,
  });
  expectNear(ended?.releasedAt, Date.now());
  const fresh = await rowOf(t, khatma._id, 9);
  expect(fresh.personId).toBe(bob.personId);
  expect(fresh.graceEndsAt).toBeGreaterThan(Date.now());

  const thanks = await notesOf(t, ali, "thanks");
  expect(thanks).toHaveLength(1);
  expect(thanks[0]).toMatchObject({ juz: [9], clearedAt: null });
  if (!thanks[0]) throw new Error("no thanks");
  expect(noteText(thanks[0])).toBe(
    "أحدهم يُكمل الجزء 9 الآن. جزاكما الله خيراً.",
  );
  // the thanks is all that's left for the reader; the alert is gone too
  expect(uncleared(await notesOf(t, ali)).map((n) => n.kind)).toEqual([
    "thanks",
  ]);
  expect(uncleared(await notesOf(t, org, "openForHelp"))).toHaveLength(0);

  const view = await viewAs(t, code, ali);
  expect(view.me.holding).toBeNull();
  expect(view.me.hold).toBeNull();
  expect(view.tiles[8]).toMatchObject({
    state: "reading",
    readerName: "B",
    isMine: false,
  });
  // no finish recorded for the reader, so their pace has nothing new
  const finishes = await t.run((ctx) =>
    ctx.db
      .query("assignments")
      .withIndex("by_person_finishedAt", (q) =>
        q.eq("personId", ali.personId).gt("finishedAt", 0),
      )
      .collect(),
  );
  expect(finishes).toHaveLength(0);
  // and the reader is free to take another
  expect(await take(t, code, ali, 10)).toEqual({ ok: true });
});

test("reader finishing after takeover gets taken_over", async () => {
  const { t, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "B");
  const carol = await signedIn(t, "C");
  await take(t, code, ali, 9);
  await runOut(t, await rowOf(t, khatma._id, 9));
  await take(t, code, bob, 9);
  expect(await finish(t, code, ali)).toEqual({
    ok: false,
    reason: "taken_over",
  });
  expect((await rowOf(t, khatma._id, 9)).finishedAt).toBeNull();
  // an ordinary release is still not_holding
  await take(t, code, carol, 11);
  await release(t, code, carol);
  expect(await finish(t, code, carol)).toEqual({
    ok: false,
    reason: "not_holding",
  });
});

test("stale endDue after extension, finish, release, takeover, or undo changes nothing", async () => {
  const { t, org, code, khatma } = await setup();
  const [ali, bob, carol, dave, erin, frank] = await Promise.all(
    ["A", "B", "C", "D", "E", "F"].map((n) => signedIn(t, n)),
  );
  if (!ali || !bob || !carol || !dave || !erin || !frank) throw new Error();
  for (const [juz, who] of [ali, bob, carol, dave, frank].entries()) {
    await take(t, code, who, juz + 1);
  }
  const original = (await Promise.all(
    [1, 2, 3, 4, 5].map((juz) => rowOf(t, khatma._id, juz)),
  )) as Doc<"assignments">[];
  const [r1, r2, r3, r4, r5] = original as [
    Doc<"assignments">,
    Doc<"assignments">,
    Doc<"assignments">,
    Doc<"assignments">,
    Doc<"assignments">,
  ];

  // extension (every notice is due at the same moment)
  await advanceTo(t, r1.noticeAt);
  await stillReading(t, code, ali);
  // finish, release
  await finish(t, code, bob);
  await release(t, code, carol);
  // takeover: juz' 4 opens on time, then erin takes it
  await endDue(t, r4);
  await take(t, code, erin, 4);
  // undo: juz' 5 opens, its reader finishes and undoes
  await endDue(t, r5);
  await finish(t, code, frank);
  expect(await undo(t, code, frank)).toEqual({ ok: true });

  const snapshot = async () => ({
    rows: await t.run((ctx) => ctx.db.query("assignments").collect()),
    notes: await t.run((ctx) => ctx.db.query("notes").collect()),
  });
  const before = await snapshot();
  for (const row of [r1, r2, r3, r4, r5]) await endDue(t, row);
  expect(await snapshot()).toEqual(before);
  expect(before.rows.find((a) => a._id === r1._id)?.openedForHelpAt).toBeNull();
  expect(
    before.rows.find((a) => a._id === r5._id)?.openedForHelpAt,
  ).not.toBeNull();
  expect(uncleared(await notesOf(t, org, "openForHelp"))[0]?.juz).toEqual([
    3, 5,
  ]);
});

test("undo of an opened juz returns it to opened, not to a fresh grace", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "B");
  await join(t, khatma._id, bob);
  await take(t, code, ali, 11);
  await runOut(t, await rowOf(t, khatma._id, 11));
  const opened = await rowOf(t, khatma._id, 11);
  expect(opened.openedForHelpAt).not.toBeNull();

  expect(await finish(t, code, ali)).toMatchObject({ ok: true });
  expect(uncleared(await notesOf(t, org, "openForHelp"))).toHaveLength(0);
  expect(await undo(t, code, ali)).toEqual({ ok: true });
  await flush(t);

  const restored = await rowOf(t, khatma._id, 11);
  expect(restored).toEqual({ ...opened, finishedAt: null });
  expect((await viewAs(t, code, bob)).tiles[10]).toMatchObject({
    state: "open",
    readerName: null,
  });
  const mine = await viewAs(t, code, ali);
  expect(mine.tiles[10]).toMatchObject({ state: "reading", isMine: true });
  expect(mine.me.hold?.openForHelp).toBe(true);
  // the organizer's alert is back
  const alerts = uncleared(await notesOf(t, org, "openForHelp"));
  expect(alerts.map((n) => n.juz)).toEqual([[11]]);
  // nothing restarted a grace clock
  const pending = (await scheduled(t, "grace")).filter(
    (j) => j.state.kind === "pending",
  );
  expect(pending).toHaveLength(0);
});

test("undo past the grace end opens it at once", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await take(t, code, ali, 6);
  const row = await rowOf(t, khatma._id, 6);
  await advanceTo(t, row.noticeAt);
  await advanceTo(t, row.graceEndsAt - 5_000);
  expect(await finish(t, code, ali)).toMatchObject({ ok: true });
  await advanceTo(t, row.graceEndsAt + 1_000); // the original end did nothing
  expect((await rowOf(t, khatma._id, 6)).openedForHelpAt).toBeNull();
  expect(await notesOf(t, org, "openForHelp")).toHaveLength(0);

  expect(await undo(t, code, ali)).toEqual({ ok: true });
  const undoneAt = Date.now();
  await flush(t);
  const after = await rowOf(t, khatma._id, 6);
  expect(after.finishedAt).toBeNull();
  expectNear(after.openedForHelpAt, undoneAt);
  expect(uncleared(await notesOf(t, org, "openForHelp"))[0]?.juz).toEqual([6]);
});

test("grace change after take does not move a running hold", async () => {
  const { t, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await take(t, code, ali, 2);
  const row = await rowOf(t, khatma._id, 2);
  await t.run((ctx) =>
    ctx.db.patch(khatma._id, { grace: { value: 30, unit: "minutes" } }),
  );

  await advanceTo(t, NOW + HOUR);
  const later = await rowOf(t, khatma._id, 2);
  expect(later.openedForHelpAt).toBeNull();
  expect(later.graceEndsAt).toBe(row.graceEndsAt);
  expect(later.noticeAt).toBe(row.noticeAt);

  // the extension uses the grace the hold started with
  await advanceTo(t, row.noticeAt);
  expect(await stillReading(t, code, ali)).toEqual({ ok: true });
  expect((await rowOf(t, khatma._id, 2)).graceEndsAt).toBe(
    addWakingMs(row.graceEndsAt, 6 * HOUR, TZ, QUIET),
  );
});

test("notifications off: no push scheduled, note still exists, juz still opens", async () => {
  const { t, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await take(t, code, ali, 3);
  await subscribe(t, ali);
  await t.mutation(api.khatmas.setNotifications, {
    sessionToken: ali.token,
    inviteCode: code,
    on: false,
  });
  const row = await rowOf(t, khatma._id, 3);

  await advanceTo(t, row.noticeAt);
  expect(uncleared(await notesOf(t, ali, "almostUp"))).toHaveLength(1);
  await advanceTo(t, row.graceEndsAt);
  expectNear((await rowOf(t, khatma._id, 3)).openedForHelpAt, row.graceEndsAt);
  expect(await scheduled(t, "pushNode")).toHaveLength(0);
});

test("dev:forceGraceEnd refuses outside dev and leaves the hold alone", async () => {
  const { t, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await take(t, code, ali, 5);

  for (const env of ["prod", ""]) {
    vi.stubEnv("WIRDAK_ENV", env);
    await expect(
      t.mutation(internal.dev.forceGraceEnd, { inviteCode: code, juz: 5 }),
    ).rejects.toThrow(/only when WIRDAK_ENV is dev/);
  }
  vi.unstubAllEnvs();
  expect((await rowOf(t, khatma._id, 5)).openedForHelpAt).toBeNull();
});

test("dev:forceGraceEnd opens the current hold of a juz in dev, and only a held one", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "B");
  await join(t, khatma._id, bob);
  await take(t, code, bob, 6);
  await release(t, code, bob); // an old, released row for juz' 6
  await take(t, code, ali, 6);
  vi.stubEnv("WIRDAK_ENV", "dev");
  try {
    await t.mutation(internal.dev.forceGraceEnd, { inviteCode: code, juz: 6 });
    const opened = await rowOf(t, khatma._id, 6);
    expect(opened.personId).toBe(ali.personId);
    expectNear(opened.openedForHelpAt, Date.now());
    // the organizer is told, the same as at a real grace end
    expect(uncleared(await notesOf(t, org, "openForHelp"))).toHaveLength(1);
    const view = await viewAs(t, code, org);
    expect(view.tiles[5]?.state).toBe("open");

    // no hold left to end
    await expect(
      t.mutation(internal.dev.forceGraceEnd, { inviteCode: code, juz: 9 }),
    ).rejects.toThrow(/no current hold/);
  } finally {
    vi.unstubAllEnvs();
  }
});
