import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { DEFAULT_GRACE } from "./lib/grace";
import { type RotaMessages, type ReadingDays, juzFor } from "./lib/rota";
import { completeIfDone } from "./rotaDays";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type T = TestConvexForDataModel<DataModel>;

/** A wall-clock time in Asia/Dubai (+04:00, no DST), written `YYYY-MM-DDTHH:MM`. */
function dubai(local: string): number {
  return Date.parse(`${local}:00+04:00`);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(dubai("2027-01-15T12:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

const MESSAGES: RotaMessages = {
  dayAt: 480,
  reminder: { at: 960, on: true },
  unread: { at: 1140, on: true },
  summary: { at: 1260, on: false },
};

type Over = Partial<{
  days: ReadingDays;
  firstDate: string;
  endDate: string | null;
  messages: RotaMessages;
  pausedAt: number | null;
  pauseDates: string[];
  setupDoneAt: number | null;
}>;

/** A rota khatma (default: daily, first date tomorrow) with its organizer on slot 1. */
async function setup(t: T, over: Over = {}) {
  return await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone: "+971500000001",
      displayName: "المنظم",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
      rotaAllowed: true,
    });
    const khatmaId = await ctx.db.insert("khatmas", {
      name: "ختمة",
      schedule: "none",
      grace: DEFAULT_GRACE.none,
      creatorPersonId: personId,
      inviteCode: "code",
      completedRounds: 0,
      createdAt: 0,
      kind: "rota",
      rota: {
        days: over.days ?? { kind: "daily" },
        firstDate: over.firstDate ?? "2027-01-16",
        endDate: over.endDate ?? null,
        timeZone: "Asia/Dubai",
        messages: over.messages ?? MESSAGES,
        pausedAt: over.pausedAt ?? null,
        pauseDates: over.pauseDates ?? [],
        archivedAt: null,
        // Left out unless given: khatmas made before setup was tracked count as set up.
        ...(over.setupDoneAt !== undefined
          ? { setupDoneAt: over.setupDoneAt }
          : {}),
      },
    });
    await ctx.db.insert("members", {
      khatmaId,
      personId,
      joinedAt: 0,
      shareToken: "share",
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    const participantId = await ctx.db.insert("rotaParticipants", {
      khatmaId,
      name: "المنظم",
      phone: "+971500000001",
      personId,
      addedAt: 0,
      removedAt: null,
    });
    await ctx.db.insert("rotaSlots", { khatmaId, slot: 1, participantId });
    return { personId, khatmaId, participantId };
  });
}
type Setup = Awaited<ReturnType<typeof setup>>;

function setPausedAt(t: T, s: Setup, pausedAt: number | null) {
  return t.run(async (ctx) => {
    const k = await ctx.db.get(s.khatmaId);
    await ctx.db.patch(s.khatmaId, { rota: { ...k!.rota!, pausedAt } });
  });
}

async function tickAt(t: T, s: Setup, local: string) {
  vi.setSystemTime(dubai(local));
  await t.mutation(internal.rotaDays.tick, { khatmaId: s.khatmaId });
}

function days(t: T, s: Setup) {
  return t.run((ctx) =>
    ctx.db
      .query("rotaDays")
      .withIndex("by_khatma_n", (q) => q.eq("khatmaId", s.khatmaId))
      .collect(),
  );
}

function reads(t: T, dayId: Id<"rotaDays">) {
  return t.run((ctx) =>
    ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", dayId))
      .collect(),
  );
}

function notes(t: T, s: Setup) {
  return t.run((ctx) =>
    ctx.db
      .query("notes")
      .withIndex("by_person_khatma", (q) =>
        q.eq("personId", s.personId).eq("khatmaId", s.khatmaId),
      )
      .collect(),
  );
}

test("starts nothing before midnight and day 1 at 00:00 with 30 reads", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-15T23:59");
  expect(await days(t, s)).toHaveLength(0);

  await tickAt(t, s, "2027-01-16T00:00");
  const [day, ...rest] = await days(t, s);
  expect(rest).toHaveLength(0);
  expect(day).toMatchObject({
    n: 1,
    number: 1,
    cycle: 1,
    date: "2027-01-16",
    startedAt: dubai("2027-01-16T00:00"),
    closesAt: dubai("2027-01-17T00:00"),
    completedAt: null,
    closedAt: null,
    unreadSentAt: null,
    summarySentAt: null,
  });
  const rows = await reads(t, day!._id);
  expect(rows.map((r) => r.juz)).toEqual(
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  expect(rows[0]).toMatchObject({
    slot: 1,
    holderId: s.participantId,
    readerId: s.participantId,
    doneAt: null,
    doneByOrganizer: false,
    reassignedAt: null,
  });
  const others = rows.slice(1);
  expect(others.every((r) => r.holderId === null && r.readerId === null)).toBe(
    true,
  );
});

test("two ticks start one day", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-16T08:00");
  expect(await days(t, s)).toHaveLength(1);
});

test("a first tick at 09:10 still starts that date as day 1", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T09:10");
  expect((await days(t, s)).map((d) => [d.n, d.date])).toEqual([
    [1, "2027-01-16"],
  ]);
});

test("a missed day is not backfilled", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T08:00");
  // the service is down all of the 17th
  await tickAt(t, s, "2027-01-18T08:00");
  const all = await days(t, s);
  expect(all.map((d) => [d.n, d.number, d.date])).toEqual([
    [1, 1, "2027-01-16"],
    [2, 2, "2027-01-18"],
  ]);
  expect(all[0]?.closedAt).toBe(dubai("2027-01-18T08:00"));
});

test("the next day closes the old one and moves every slot up one juz'", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-16T20:00");
  expect((await days(t, s))[0]?.closedAt).toBeNull();

  await tickAt(t, s, "2027-01-17T08:00");
  const [one, two] = await days(t, s);
  expect(one?.closedAt).toBe(dubai("2027-01-17T08:00"));
  expect(two).toMatchObject({ n: 2, number: 2, date: "2027-01-17" });
  const rows = await reads(t, two!._id);
  const held = rows.filter((r) => r.holderId !== null);
  expect(held.map((r) => [r.juz, r.slot])).toEqual([[juzFor(1, 2), 1]]);
  expect(held[0]?.juz).toBe(2);
});

test("a pause date starts nothing and the next date is the next day", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, { pauseDates: ["2027-01-17"] });
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-17T08:00");
  expect(await days(t, s)).toHaveLength(1);
  expect((await days(t, s))[0]?.closedAt).toBe(dubai("2027-01-17T08:00"));
  await tickAt(t, s, "2027-01-18T08:00");
  expect((await days(t, s)).map((d) => [d.n, d.date])).toEqual([
    [1, "2027-01-16"],
    [2, "2027-01-18"],
  ]);
});

test("a paused khatma starts nothing, and starts the next day once resumed", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, { pausedAt: dubai("2027-01-15T12:00") });
  await tickAt(t, s, "2027-01-16T08:00");
  expect(await days(t, s)).toHaveLength(0);

  await t.run(async (ctx) => {
    const k = await ctx.db.get(s.khatmaId);
    await ctx.db.patch(s.khatmaId, { rota: { ...k!.rota!, pausedAt: null } });
  });
  await tickAt(t, s, "2027-01-16T08:15");
  expect((await days(t, s)).map((d) => [d.n, d.date])).toEqual([
    [1, "2027-01-16"],
  ]);
});

test("resuming after a pause starts the next date as the next day, without backfilling", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-17T08:00");
  await setPausedAt(t, s, dubai("2027-01-17T20:00"));
  await tickAt(t, s, "2027-01-18T08:00");
  await tickAt(t, s, "2027-01-19T08:00");
  expect(await days(t, s)).toHaveLength(2);

  await setPausedAt(t, s, null);
  await tickAt(t, s, "2027-01-20T08:00");
  expect((await days(t, s)).map((d) => [d.n, d.number, d.date])).toEqual([
    [1, 1, "2027-01-16"],
    [2, 2, "2027-01-17"],
    [3, 3, "2027-01-20"],
  ]);
});

test("a time zone moved west never starts a date behind the last started day", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-17T08:00");
  await tickAt(t, s, "2027-01-19T08:00"); // the 18th is missed
  expect((await days(t, s)).map((d) => [d.n, d.date])).toEqual([
    [1, "2027-01-16"],
    [2, "2027-01-17"],
    [3, "2027-01-19"],
  ]);

  // 09:00 in Dubai on the 19th is 19:00 on the 18th in Honolulu: a reading
  // date with no row, after the day start time.
  await t.run(async (ctx) => {
    const k = await ctx.db.get(s.khatmaId);
    await ctx.db.patch(s.khatmaId, {
      rota: { ...k!.rota!, timeZone: "Pacific/Honolulu" },
    });
  });
  await tickAt(t, s, "2027-01-19T09:00");
  expect((await days(t, s)).map((d) => d.date)).toEqual([
    "2027-01-16",
    "2027-01-17",
    "2027-01-19",
  ]);
});

test("a paused khatma sends no unread list or summary", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, {
    messages: { ...MESSAGES, summary: { at: 1260, on: true } },
  });
  await tickAt(t, s, "2027-01-16T08:00");
  await setPausedAt(t, s, dubai("2027-01-16T12:00"));
  await tickAt(t, s, "2027-01-16T19:00");
  await tickAt(t, s, "2027-01-16T21:00");
  expect(await notes(t, s)).toHaveLength(0);

  await setPausedAt(t, s, null);
  await tickAt(t, s, "2027-01-16T21:15");
  expect((await notes(t, s)).map((n) => n.kind).sort()).toEqual([
    "rotaSummary",
    "rotaUnread",
  ]);
});

test("a Fridays khatma starts only on Fridays", async () => {
  const t = convexTest(schema, modules);
  // 2027-01-15 is a Friday
  vi.setSystemTime(dubai("2027-01-14T12:00"));
  const s = await setup(t, {
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
  });
  for (const date of [
    "2027-01-15",
    "2027-01-16",
    "2027-01-17",
    "2027-01-18",
    "2027-01-19",
    "2027-01-20",
    "2027-01-21",
    "2027-01-22",
  ]) {
    await tickAt(t, s, `${date}T08:00`);
  }
  expect((await days(t, s)).map((d) => [d.n, d.date])).toEqual([
    [1, "2027-01-15"],
    [2, "2027-01-22"],
  ]);
});

test("the organizer gets one unread list at the set time", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-16T18:45");
  expect(await notes(t, s)).toHaveLength(0);

  await tickAt(t, s, "2027-01-16T19:00");
  await tickAt(t, s, "2027-01-16T19:15");
  const sent = await notes(t, s);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ kind: "rotaUnread" });
  expect(sent[0]?.juz).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  expect((await days(t, s))[0]?.unreadSentAt).toBe(dubai("2027-01-16T19:00"));
});

test("a day that starts after the unread and summary times sends neither that day", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, {
    messages: { ...MESSAGES, summary: { at: 1260, on: true } },
  });
  await tickAt(t, s, "2027-01-16T21:30");
  await tickAt(t, s, "2027-01-16T21:45");
  expect(await days(t, s)).toHaveLength(1);
  expect(await notes(t, s)).toHaveLength(0);

  await tickAt(t, s, "2027-01-17T08:00");
  await tickAt(t, s, "2027-01-17T19:00");
  expect((await notes(t, s)).map((n) => n.kind)).toEqual(["rotaUnread"]);
});

test("a day that starts between the unread and summary times still sends the summary", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, {
    messages: { ...MESSAGES, summary: { at: 1260, on: true } },
  });
  await tickAt(t, s, "2027-01-16T20:00");
  expect(await notes(t, s)).toHaveLength(0);

  await tickAt(t, s, "2027-01-16T21:00");
  expect((await notes(t, s)).map((n) => n.kind)).toEqual(["rotaSummary"]);
});

test("a khatma still being set up starts no day", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, { setupDoneAt: null });
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-16T12:00");
  expect(await days(t, s)).toHaveLength(0);
});

test("a new unread list or summary clears the organizer's older ones in the khatma", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, {
    messages: { ...MESSAGES, summary: { at: 1260, on: true } },
  });
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-16T19:00");
  const uncleared = async () =>
    (await notes(t, s))
      .filter((n) => n.clearedAt === null)
      .map((n) => [n.kind, n.createdAt]);
  expect(await uncleared()).toEqual([
    ["rotaUnread", dubai("2027-01-16T19:00")],
  ]);

  await tickAt(t, s, "2027-01-16T21:00");
  expect(await uncleared()).toEqual([
    ["rotaSummary", dubai("2027-01-16T21:00")],
  ]);

  await tickAt(t, s, "2027-01-17T08:00");
  await tickAt(t, s, "2027-01-17T19:00");
  expect(await uncleared()).toEqual([
    ["rotaUnread", dubai("2027-01-17T19:00")],
  ]);
  expect(await notes(t, s)).toHaveLength(3);
});

test("no unread list when it is off", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, {
    messages: { ...MESSAGES, unread: { at: 1140, on: false } },
  });
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-16T19:00");
  expect(await notes(t, s)).toHaveLength(0);
});

test("the unread list leaves out finished ajza'", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T08:00");
  const [day] = await days(t, s);
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", day!._id))
      .collect();
    for (const r of rows.filter((r) => r.juz <= 28)) {
      await ctx.db.patch(r._id, { doneAt: 1 });
    }
  });
  await tickAt(t, s, "2027-01-16T19:00");
  expect((await notes(t, s))[0]?.juz).toEqual([29, 30]);
});

test("no unread list when every juz' is done", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T08:00");
  const [day] = await days(t, s);
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", day!._id))
      .collect();
    for (const r of rows) await ctx.db.patch(r._id, { doneAt: 1 });
    await ctx.db.patch(day!._id, { completedAt: 1 });
  });
  await tickAt(t, s, "2027-01-16T19:00");
  expect(await notes(t, s)).toHaveLength(0);
});

test("the summary goes out at 21:00 with the count, even when the day is complete", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, {
    messages: { ...MESSAGES, summary: { at: 1260, on: true } },
  });
  await tickAt(t, s, "2027-01-16T08:00");
  const [day] = await days(t, s);
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", day!._id))
      .collect();
    for (const r of rows) await ctx.db.patch(r._id, { doneAt: 1 });
    await ctx.db.patch(day!._id, { completedAt: 1 });
  });
  await tickAt(t, s, "2027-01-16T21:00");
  await tickAt(t, s, "2027-01-16T21:15");
  const sent = (await notes(t, s)).filter((n) => n.kind === "rotaSummary");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ count: 30 });
  expect((await days(t, s))[0]?.summarySentAt).toBe(dubai("2027-01-16T21:00"));
});

test("the khatma is archived the day after its end date and the sweep stops ticking it", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, { endDate: "2027-01-17" });
  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-17T08:00");
  await tickAt(t, s, "2027-01-17T20:00");
  expect((await t.run((ctx) => ctx.db.get(s.khatmaId)))?.rota?.archivedAt).toBe(
    null,
  );

  await tickAt(t, s, "2027-01-18T08:00");
  const all = await days(t, s);
  // no day after the end date, and the last one is closed
  expect(all.map((d) => d.date)).toEqual(["2027-01-16", "2027-01-17"]);
  expect(all[1]?.closedAt).toBe(dubai("2027-01-18T08:00"));
  expect((await t.run((ctx) => ctx.db.get(s.khatmaId)))?.rota?.archivedAt).toBe(
    dubai("2027-01-18T08:00"),
  );

  const scheduled = () =>
    t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const before = (await scheduled()).length;
  await t.mutation(internal.rotaDays.sweep, {});
  expect(await scheduled()).toHaveLength(before);
});

test("the sweep ticks every khatma that is not archived", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  vi.setSystemTime(dubai("2027-01-16T08:30"));
  await t.mutation(internal.rotaDays.sweep, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await days(t, s)).toHaveLength(1);
});

test("completeIfDone is true once, when the 30th read is done", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T08:00");
  const [day] = await days(t, s);
  const rows = await reads(t, day!._id);
  const outcomes = await t.run(async (ctx) => {
    const out: boolean[] = [];
    for (const r of rows) {
      await ctx.db.patch(r._id, { doneAt: 5 });
      out.push(await completeIfDone(ctx, day!._id));
    }
    out.push(await completeIfDone(ctx, day!._id));
    return out;
  });
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(outcomes.indexOf(true)).toBe(29);
  expect((await days(t, s))[0]?.completedAt).not.toBeNull();
});
