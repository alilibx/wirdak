import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { clearNotes, notify } from "./notes";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2027-01-15 12:00 in Asia/Dubai (UTC+4), so awake. */
const NOW = 1_800_000_000_000;
/** 23:00 in Asia/Dubai, so quiet. */
const NIGHT = NOW + 11 * HOUR;
/** 07:00 the next morning in Asia/Dubai. */
const MORNING = NIGHT + 8 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

let seq = 0;
async function setup(t: T) {
  seq += 1;
  const token = `tok-${seq}`;
  const tokenHash = await sha256Hex(token);
  return await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone: `+97150000${String(seq).padStart(4, "0")}`,
      displayName: `عضو ${seq}`,
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
    });
    const sessionId = await ctx.db.insert("sessions", {
      personId,
      tokenHash,
      alertTokenHash: `alert-${seq}`,
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    return { personId, sessionId, token };
  });
}
type Who = Awaited<ReturnType<typeof setup>>;

async function addKhatma(t: T, organizer: Who) {
  const inviteCode = `invite${String(seq).padStart(6, "0")}`;
  return await t.run(async (ctx) => {
    const khatmaId = await ctx.db.insert("khatmas", {
      name: null,
      schedule: "weekly",
      grace: { value: 2, unit: "days" },
      creatorPersonId: organizer.personId,
      inviteCode,
      completedRounds: 0,
      createdAt: NOW,
    });
    return { khatmaId, inviteCode };
  });
}

async function join(
  t: T,
  khatmaId: Id<"khatmas">,
  who: Who,
  notificationsOn = true,
) {
  await t.run((ctx) =>
    ctx.db.insert("members", {
      khatmaId,
      personId: who.personId,
      joinedAt: NOW,
      status: "active",
      notificationsOn,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    }),
  );
}

async function subscribe(
  t: T,
  who: Who,
  endpoint = `https://push.example/${seq}`,
) {
  await t.run((ctx) =>
    ctx.db.insert("pushSubscriptions", {
      personId: who.personId,
      sessionId: who.sessionId,
      endpoint,
      p256dh: "p",
      auth: "a",
      createdAt: NOW,
    }),
  );
}

/** convex-test's clock ticks a millisecond or so inside a call; allow a second. */
function expectNear(actual: number | null | undefined, expected: number) {
  expect(actual).toBeGreaterThanOrEqual(expected);
  expect(actual).toBeLessThan(expected + 1000);
}

async function scheduledDelivers(t: T) {
  const rows = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return rows.filter((r) => r.name.includes("pushNode:deliver"));
}

test("notify inserts a note and schedules push at the next waking moment", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const { khatmaId } = await addKhatma(t, ali);
  await join(t, khatmaId, ali);
  await subscribe(t, ali);

  vi.setSystemTime(NIGHT);
  const noteId = await t.run((ctx) =>
    notify(ctx, { personId: ali.personId, khatmaId, kind: "completed" }),
  );

  const note = await t.run((ctx) => ctx.db.get(noteId));
  expect(note).toMatchObject({
    personId: ali.personId,
    khatmaId,
    kind: "completed",
    juz: [],
    count: null,
    until: null,
    assignmentId: null,
    roundNumber: null,
    createdAt: NIGHT,
    pushedAt: null,
    clearedAt: null,
  });
  const delivers = await scheduledDelivers(t);
  expect(delivers).toHaveLength(1);
  expect(delivers[0]?.scheduledTime).toBe(MORNING);
  expect(delivers[0]?.args).toEqual([{ noteId }]);
});

test("notify schedules the push at once when awake", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const { khatmaId } = await addKhatma(t, ali);
  await join(t, khatmaId, ali);
  await subscribe(t, ali);
  await t.run((ctx) =>
    notify(ctx, {
      personId: ali.personId,
      khatmaId,
      kind: "almostUp",
      juz: [4],
    }),
  );
  const delivers = await scheduledDelivers(t);
  expect(delivers).toHaveLength(1);
  expectNear(delivers[0]?.scheduledTime, NOW);
});

test("notify schedules no push when notifications are off or there is no subscription", async () => {
  const t = convexTest(schema, modules);
  const off = await setup(t);
  const none = await setup(t);
  const { khatmaId } = await addKhatma(t, off);
  await join(t, khatmaId, off, false);
  await join(t, khatmaId, none, true);
  await subscribe(t, off);

  const offNote = await t.run((ctx) =>
    notify(ctx, { personId: off.personId, khatmaId, kind: "completed" }),
  );
  const noneNote = await t.run((ctx) =>
    notify(ctx, { personId: none.personId, khatmaId, kind: "completed" }),
  );
  expect(await scheduledDelivers(t)).toHaveLength(0);
  // The in-app notes exist regardless.
  expect(await t.run((ctx) => ctx.db.get(offNote))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get(noneNote))).not.toBeNull();
});

test("deliveryPlan builds the payload, and is null once the note is cleared", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const { khatmaId, inviteCode } = await addKhatma(t, ali);
  await join(t, khatmaId, ali);
  await subscribe(t, ali, "https://push.example/a");
  const noteId = await t.run((ctx) =>
    notify(ctx, {
      personId: ali.personId,
      khatmaId,
      kind: "reminder",
      juz: [5],
    }),
  );

  expect(await t.query(internal.push.deliveryPlan, { noteId })).toEqual({
    subscriptions: [
      { endpoint: "https://push.example/a", p256dh: "p", auth: "a" },
    ],
    payload: {
      title: "وِردك",
      body: "الجزء 5 في انتظارك، يسّر الله لك.",
      url: `/j/${inviteCode}`,
      // the note id tags the notification, so a repeat push replaces the earlier one
      tag: noteId,
    },
  });

  await t.run((ctx) => ctx.db.patch(noteId, { clearedAt: NOW }));
  expect(await t.query(internal.push.deliveryPlan, { noteId })).toBeNull();
});

test("deliveryPlan is null when notifications are turned off, the membership is gone, or there are no subscriptions", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const bob = await setup(t);
  const { khatmaId } = await addKhatma(t, ali);
  await join(t, khatmaId, ali);
  await join(t, khatmaId, bob);
  await subscribe(t, ali, "https://push.example/a");
  const aliNote = await t.run((ctx) =>
    notify(ctx, { personId: ali.personId, khatmaId, kind: "completed" }),
  );
  const bobNote = await t.run((ctx) =>
    notify(ctx, { personId: bob.personId, khatmaId, kind: "completed" }),
  );
  expect(
    await t.query(internal.push.deliveryPlan, { noteId: bobNote }),
  ).toBeNull();

  expect(
    await t.query(internal.push.deliveryPlan, { noteId: aliNote }),
  ).not.toBeNull();
  await t.run(async (ctx) => {
    const m = await ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatmaId).eq("personId", ali.personId),
      )
      .unique();
    await ctx.db.patch(m!._id, { notificationsOn: false });
  });
  expect(
    await t.query(internal.push.deliveryPlan, { noteId: aliNote }),
  ).toBeNull();
  await t.run(async (ctx) => {
    const m = await ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatmaId).eq("personId", ali.personId),
      )
      .unique();
    await ctx.db.delete(m!._id);
  });
  expect(
    await t.query(internal.push.deliveryPlan, { noteId: aliNote }),
  ).toBeNull();
});

test("forKhatma returns only the caller's uncleared notes, newest first; dismiss only works on own notes", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const bob = await setup(t);
  const { khatmaId, inviteCode } = await addKhatma(t, ali);
  const other = await addKhatma(t, bob);
  await join(t, khatmaId, ali);
  await join(t, khatmaId, bob);
  await join(t, other.khatmaId, ali);

  const first = await t.run((ctx) =>
    notify(ctx, {
      personId: ali.personId,
      khatmaId,
      kind: "almostUp",
      juz: [12],
    }),
  );
  vi.setSystemTime(NOW + HOUR);
  const second = await t.run((ctx) =>
    notify(ctx, {
      personId: ali.personId,
      khatmaId,
      kind: "behind",
      count: 3,
      until: NOW + 2 * DAY,
    }),
  );
  const cleared = await t.run((ctx) =>
    notify(ctx, { personId: ali.personId, khatmaId, kind: "thanks", juz: [1] }),
  );
  await t.run((ctx) => ctx.db.patch(cleared, { clearedAt: NOW }));
  const bobNote = await t.run((ctx) =>
    notify(ctx, { personId: bob.personId, khatmaId, kind: "completed" }),
  );
  await t.run((ctx) =>
    notify(ctx, {
      personId: ali.personId,
      khatmaId: other.khatmaId,
      kind: "completed",
    }),
  );

  const views = await t.query(api.notes.forKhatma, {
    sessionToken: ali.token,
    inviteCode,
  });
  expect(views).toEqual([
    {
      noteId: second,
      kind: "behind",
      juz: [],
      count: 3,
      until: NOW + 2 * DAY,
      name: null,
      createdAt: expect.any(Number),
    },
    {
      noteId: first,
      kind: "almostUp",
      juz: [12],
      count: null,
      until: null,
      name: null,
      createdAt: expect.any(Number),
    },
  ]);
  expectNear(views[0]?.createdAt, NOW + HOUR);
  expectNear(views[1]?.createdAt, NOW);
  expect(await t.query(api.notes.forKhatma, { inviteCode })).toEqual([]);
  expect(
    await t.query(api.notes.forKhatma, {
      sessionToken: ali.token,
      inviteCode: "nope",
    }),
  ).toEqual([]);

  // Not mine: refused, and the note stays.
  expect(
    await t.mutation(api.notes.dismiss, {
      sessionToken: ali.token,
      noteId: bobNote,
    }),
  ).toEqual({ ok: false });
  expect((await t.run((ctx) => ctx.db.get(bobNote)))?.clearedAt).toBeNull();
  expect(await t.mutation(api.notes.dismiss, { noteId: first })).toEqual({
    ok: false,
  });

  vi.setSystemTime(NOW + 2 * HOUR);
  expect(
    await t.mutation(api.notes.dismiss, {
      sessionToken: ali.token,
      noteId: first,
    }),
  ).toEqual({ ok: true });
  expect((await t.run((ctx) => ctx.db.get(first)))?.clearedAt).toBe(
    NOW + 2 * HOUR,
  );
  const after = await t.query(api.notes.forKhatma, {
    sessionToken: ali.token,
    inviteCode,
  });
  expect(after.map((n) => n.noteId)).toEqual([second]);
});

test("clearNotes by assignment clears matching notes and honours kinds", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const { khatmaId } = await addKhatma(t, ali);
  await join(t, khatmaId, ali);
  const assignmentId = await t.run(async (ctx) => {
    const roundId = await ctx.db.insert("rounds", {
      khatmaId,
      number: 1,
      startedAt: NOW,
      targetEndAt: null,
      completedAt: null,
      lastFinishedAt: null,
      behindInvitedAt: null,
    });
    const memberId = (await ctx.db.query("members").first())!._id;
    return await ctx.db.insert("assignments", {
      khatmaId,
      roundId,
      roundNumber: 1,
      juz: 12,
      memberId,
      personId: ali.personId,
      takenAt: NOW,
      finishedAt: null,
      releasedAt: null,
      releasedBySystem: false,
      graceWakingMs: 1,
      noticeAt: NOW,
      graceEndsAt: NOW,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    });
  });
  const almost = await t.run((ctx) =>
    notify(ctx, {
      personId: ali.personId,
      khatmaId,
      kind: "almostUp",
      juz: [12],
      assignmentId,
    }),
  );
  const reminder = await t.run((ctx) =>
    notify(ctx, {
      personId: ali.personId,
      khatmaId,
      kind: "reminder",
      juz: [12],
      assignmentId,
    }),
  );
  const unrelated = await t.run((ctx) =>
    notify(ctx, { personId: ali.personId, khatmaId, kind: "completed" }),
  );

  await t.run((ctx) => clearNotes(ctx, { assignmentId, kinds: ["almostUp"] }));
  const cleared = async (id: Id<"notes">) =>
    (await t.run((ctx) => ctx.db.get(id)))?.clearedAt ?? null;
  expectNear(await cleared(almost), NOW);
  expect(await cleared(reminder)).toBeNull();

  await t.run((ctx) => clearNotes(ctx, { assignmentId }));
  expectNear(await cleared(reminder), NOW);
  expect(await cleared(unrelated)).toBeNull();
});

test("clearNotes removes one juz from a batched organizer alert", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const { khatmaId } = await addKhatma(t, ali);
  await join(t, khatmaId, ali);
  const alert = await t.run((ctx) =>
    notify(ctx, {
      personId: ali.personId,
      khatmaId,
      kind: "openForHelp",
      juz: [12, 15],
    }),
  );
  const get = () => t.run((ctx) => ctx.db.get(alert));

  await t.run((ctx) =>
    clearNotes(ctx, { khatmaId, kind: "openForHelp", juz: 12 }),
  );
  expect(await get()).toMatchObject({ juz: [15], clearedAt: null });

  // A juz' that isn't in the alert changes nothing.
  await t.run((ctx) =>
    clearNotes(ctx, { khatmaId, kind: "openForHelp", juz: 3 }),
  );
  expect(await get()).toMatchObject({ juz: [15], clearedAt: null });

  await t.run((ctx) =>
    clearNotes(ctx, { khatmaId, kind: "openForHelp", juz: 15 }),
  );
  expect(await get()).toMatchObject({ juz: [] });
  expectNear((await get())?.clearedAt, NOW);
});
