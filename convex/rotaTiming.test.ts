import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { DEFAULT_GRACE } from "./lib/grace";
import type { ReadingDays, RotaMessages } from "./lib/rota";
import { encodePayload } from "./lib/rotaPayload";
import { closedText, lateThanksText } from "./lib/rotaTemplates";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type T = TestConvexForDataModel<DataModel>;

const PHONE = "+971500000001";

/** A wall-clock time in Asia/Dubai (+04:00, no DST), written `YYYY-MM-DDTHH:MM`. */
function dubai(local: string): number {
  return Date.parse(`${local}:00+04:00`);
}

const MESSAGES: RotaMessages = {
  dayAt: 480,
  reminder: { at: 960, on: false },
  unread: { at: 1140, on: false },
  summary: { at: 1260, on: false },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(dubai("2027-01-15T12:00"));
  vi.stubEnv("WIRDAK_ENV", "prod");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type Over = Partial<{
  days: ReadingDays;
  firstDate: string;
  endDate: string | null;
  messages: RotaMessages;
  setupDoneAt: number | null;
  lateTapMs: number;
}>;

/** A daily rota khatma, first read tomorrow, with one joined reader on slot 1. */
async function setup(t: T, over: Over = {}) {
  return await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone: PHONE,
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
        pausedAt: null,
        pauseDates: [],
        archivedAt: null,
        ...(over.setupDoneAt !== undefined
          ? { setupDoneAt: over.setupDoneAt }
          : {}),
        ...(over.lateTapMs !== undefined ? { lateTapMs: over.lateTapMs } : {}),
      },
    });
    const participantId = await ctx.db.insert("rotaParticipants", {
      khatmaId,
      name: "المنظم",
      phone: PHONE,
      personId,
      addedAt: 0,
      removedAt: null,
      joinedAt: 1,
    });
    await ctx.db.insert("rotaSlots", { khatmaId, slot: 1, participantId });
    return { khatmaId, participantId };
  });
}
type Setup = Awaited<ReturnType<typeof setup>>;

const setSetting = (t: T, key: string, value: unknown) =>
  t.run((ctx) => ctx.db.insert("settings", { key, value, updatedAt: 0 }));

async function tickAt(t: T, s: Setup, local: string) {
  vi.setSystemTime(dubai(local));
  await t.mutation(internal.rotaDays.tick, { khatmaId: s.khatmaId });
}

const days = (t: T, s: Setup) =>
  t.run((ctx) =>
    ctx.db
      .query("rotaDays")
      .withIndex("by_khatma_n", (q) => q.eq("khatmaId", s.khatmaId))
      .collect(),
  );

const outbox = (t: T, kind: Doc<"rotaOutbox">["kind"]) =>
  t.run(async (ctx) =>
    (await ctx.db.query("rotaOutbox").collect()).filter((r) => r.kind === kind),
  );

const doneReads = (t: T, dayId: Id<"rotaDays">) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("rotaReads")
        .withIndex("by_day_juz", (q) => q.eq("dayId", dayId))
        .collect()
    ).filter((r) => r.doneAt !== null),
  );

function tap(
  t: T,
  s: Setup,
  dayId: Id<"rotaDays">,
  action: "done" | "notYet",
  local: string,
) {
  vi.setSystemTime(dubai(local));
  return t.mutation(internal.rotaInbound.handle, {
    phone: PHONE,
    text: "",
    payload: encodePayload(
      { action, dayId, participantId: s.participantId },
      false,
    ),
    now: Date.now(),
  });
}

function typed(t: T, local: string) {
  vi.setSystemTime(dubai(local));
  return t.mutation(internal.rotaInbound.handle, {
    phone: PHONE,
    text: "تم",
    now: Date.now(),
  });
}

test("a reading day is the calendar day, whatever time its message goes", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T00:00");
  const [first] = await days(t, s);
  expect(first).toMatchObject({
    date: "2027-01-16",
    startedAt: dubai("2027-01-16T00:00"),
    closesAt: dubai("2027-01-17T00:00"),
    closedAt: null,
  });

  await tickAt(t, s, "2027-01-16T23:45");
  expect((await days(t, s))[0]?.closedAt).toBeNull();

  await tickAt(t, s, "2027-01-17T00:00");
  const [closed, next] = await days(t, s);
  expect(closed?.closedAt).toBe(dubai("2027-01-17T00:00"));
  expect(next).toMatchObject({ date: "2027-01-17", closedAt: null });
});

test("the juz' message waits for the khatma's message time", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T00:00");
  expect(await outbox(t, "juz")).toHaveLength(0);
  await tickAt(t, s, "2027-01-16T07:45");
  expect(await outbox(t, "juz")).toHaveLength(0);

  await tickAt(t, s, "2027-01-16T08:00");
  await tickAt(t, s, "2027-01-16T08:15");
  const rows = await outbox(t, "juz");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.juz).toEqual([1]);
});

test("a juz' message at the day's start goes at midnight, through quiet hours", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, { messages: { ...MESSAGES, dayAt: 0 } });
  await tickAt(t, s, "2027-01-16T00:00");
  expect(await outbox(t, "juz")).toHaveLength(1);
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(scheduled.map((f) => f.scheduledTime)).toEqual([
    dubai("2027-01-16T00:00"),
  ]);
});

test("with assignments held, a midnight juz' message waits for quiet hours to end", async () => {
  const t = convexTest(schema, modules);
  await setSetting(t, "rotaAssignDuringQuiet", false);
  const s = await setup(t, { messages: { ...MESSAGES, dayAt: 0 } });
  await tickAt(t, s, "2027-01-16T00:00");
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(scheduled.map((f) => f.scheduledTime)).toEqual([
    dubai("2027-01-16T07:00"),
  ]);
});

test("the morning message leaves out someone who joined since midnight, and a juz' reassigned since", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T00:00");
  const [day] = await days(t, s);
  await t.run(async (ctx) => {
    await ctx.db.patch(s.participantId, {
      joinedAt: dubai("2027-01-16T03:00"),
    });
  });
  await tickAt(t, s, "2027-01-16T08:00");
  expect(await outbox(t, "juz")).toHaveLength(0);
  expect((await days(t, s))[0]?.juzSentAt).toBe(dubai("2027-01-16T08:00"));

  await t.run(async (ctx) => {
    await ctx.db.patch(s.participantId, { joinedAt: 1 });
    await ctx.db.patch(day!._id, { juzSentAt: null });
    const read = await ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", day!._id).eq("juz", 1))
      .first();
    await ctx.db.patch(read!._id, { reassignedAt: dubai("2027-01-16T03:00") });
  });
  await tickAt(t, s, "2027-01-16T08:15");
  expect(await outbox(t, "juz")).toHaveLength(0);
});

test("a late tap counts for the day just ended, says so, and leaves today alone", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T00:00");
  await tickAt(t, s, "2027-01-17T00:00");
  const [old, today] = await days(t, s);
  expect(old?.lateUntil).toBe(dubai("2027-01-17T08:00"));

  const result = await tap(t, s, old!._id, "done", "2027-01-17T01:30");
  expect(JSON.stringify(result)).toContain(lateThanksText(old!.number));
  expect(await doneReads(t, old!._id)).toHaveLength(1);
  expect(await doneReads(t, today!._id)).toHaveLength(0);
});

test("a tap after the late window hears the day closed", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T00:00");
  await tickAt(t, s, "2027-01-17T00:00");
  const [old] = await days(t, s);
  const result = await tap(t, s, old!._id, "done", "2027-01-17T08:00");
  expect(JSON.stringify(result)).toContain(closedText);
  expect(await doneReads(t, old!._id)).toHaveLength(0);
});

test("«ليس بعد» doesn't apply after midnight", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T00:00");
  await tickAt(t, s, "2027-01-17T00:00");
  const [old] = await days(t, s);
  const result = await tap(t, s, old!._id, "notYet", "2027-01-17T01:00");
  expect(JSON.stringify(result)).toContain(closedText);
});

test("a khatma's own window replaces the admin's default, and zero means none", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, { lateTapMs: 0 });
  await tickAt(t, s, "2027-01-16T00:00");
  await tickAt(t, s, "2027-01-17T00:00");
  const [old] = await days(t, s);
  const result = await tap(t, s, old!._id, "done", "2027-01-17T00:01");
  expect(JSON.stringify(result)).toContain(closedText);
});

test("a typed «تم» reaches the older unread juz' first, then today's", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, { messages: { ...MESSAGES, dayAt: 0 } });
  await tickAt(t, s, "2027-01-16T00:00");
  await tickAt(t, s, "2027-01-17T00:00");
  const [old, today] = await days(t, s);

  await typed(t, "2027-01-17T00:30");
  expect(await doneReads(t, old!._id)).toHaveLength(1);
  expect(await doneReads(t, today!._id)).toHaveLength(0);

  await typed(t, "2027-01-17T00:40");
  expect(await doneReads(t, today!._id)).toHaveLength(1);
});

test("a late tap saves a reader from a silent day: the count waits for the window", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T00:00");
  await tickAt(t, s, "2027-01-17T00:00");
  const silent = () =>
    t.run(async (ctx) => (await ctx.db.get(s.participantId))?.silentDays ?? 0);
  expect(await silent()).toBe(0);
  const [old] = await days(t, s);
  expect(old?.settledAt).toBeNull();

  await tap(t, s, old!._id, "done", "2027-01-17T01:00");
  await tickAt(t, s, "2027-01-17T08:00");
  expect(await silent()).toBe(0);
  expect((await days(t, s))[0]?.settledAt).toBe(dubai("2027-01-17T08:00"));
});

test("a reader who never answers is counted once, when the window ends", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await tickAt(t, s, "2027-01-16T00:00");
  await tickAt(t, s, "2027-01-17T00:00");
  await tickAt(t, s, "2027-01-17T08:00");
  await tickAt(t, s, "2027-01-17T08:15");
  const silent = await t.run(
    async (ctx) => (await ctx.db.get(s.participantId))?.silentDays,
  );
  expect(silent).toBe(1);
});

test("an ended khatma stays until the late window of its last day ends", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, { endDate: "2027-01-16" });
  await tickAt(t, s, "2027-01-16T00:00");
  await tickAt(t, s, "2027-01-17T00:00");
  const archivedAt = () =>
    t.run(async (ctx) => (await ctx.db.get(s.khatmaId))?.rota?.archivedAt);
  expect(await archivedAt()).toBeNull();
  await tickAt(t, s, "2027-01-17T08:00");
  expect(await archivedAt()).not.toBeNull();
});

test("a khatma started today reads from tomorrow, whatever its first date says", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, {
    firstDate: "2027-01-15",
    setupDoneAt: dubai("2027-01-15T12:00"),
  });
  await tickAt(t, s, "2027-01-15T12:15");
  await tickAt(t, s, "2027-01-15T23:45");
  expect(await days(t, s)).toHaveLength(0);

  await tickAt(t, s, "2027-01-16T00:00");
  expect((await days(t, s)).map((d) => d.date)).toEqual(["2027-01-16"]);
});

test("with the rule off, a khatma started today reads today", async () => {
  const t = convexTest(schema, modules);
  await setSetting(t, "rotaStartNextDay", false);
  const s = await setup(t, {
    firstDate: "2027-01-15",
    setupDoneAt: dubai("2027-01-15T12:00"),
  });
  await tickAt(t, s, "2027-01-15T12:15");
  expect((await days(t, s)).map((d) => d.date)).toEqual(["2027-01-15"]);
});

test("the rule binds only a first day: a running khatma carries on", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, { setupDoneAt: dubai("2027-01-15T12:00") });
  await tickAt(t, s, "2027-01-16T00:00");
  await tickAt(t, s, "2027-01-17T00:00");
  expect(await days(t, s)).toHaveLength(2);
});
