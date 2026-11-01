import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2027-01-15 11:00 in Asia/Dubai (a Friday); the khatma's first day is today.
const NOW = Date.UTC(2027, 0, 15, 7, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

/** These tests read from today, which needs the admin's start-tomorrow rule off. */
const allowStartToday = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "rotaStartNextDay",
      value: false,
      updatedAt: 0,
    }),
  );

let seq = 0;

async function person(t: T, name = "المنظم") {
  seq += 1;
  const token = `token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone: `+9715000300${String(seq).padStart(2, "0")}`,
      displayName: name,
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
      rotaAllowed: true,
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
  return { personId, token };
}

/** A weekly (Fridays) rota khatma, set up, whose first day is today. */
async function setup(t: T, finished = true) {
  const who = await person(t);
  await allowStartToday(t);
  const { inviteCode } = await t.action(api.rota.create, {
    sessionToken: who.token,
    name: "ختمة",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
    endDate: null,
  });
  if (finished) {
    await t.mutation(api.rota.finishSetup, {
      sessionToken: who.token,
      inviteCode,
    });
  }
  const khatmaId = await t.run(async (ctx) => {
    const k = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .first();
    return k!._id;
  });
  return { ...who, inviteCode, khatmaId };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function startDay(t: T, s: Setup) {
  await t.mutation(internal.rotaDays.tick, { khatmaId: s.khatmaId });
}

let phoneSeq = 0;
async function add(t: T, s: Setup, juz?: number) {
  phoneSeq += 1;
  const r = await t.mutation(api.rota.addParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    name: `قارئ ${phoneSeq}`,
    phone: `+97150666${String(phoneSeq).padStart(4, "0")}`,
    ...(juz === undefined ? {} : { juz }),
  });
  if (!("participantId" in r)) throw new Error(JSON.stringify(r));
  return r.participantId;
}

function today(t: T, s: Setup, token = s.token) {
  return t.query(api.rota.today, {
    sessionToken: token,
    inviteCode: s.inviteCode,
  });
}

async function tile(t: T, s: Setup, juz: number) {
  const view = await today(t, s);
  const found = view?.tiles.find((x) => x.juz === juz);
  if (!found) throw new Error(`no tile for juz ${juz}`);
  return found;
}

type Outcome =
  | { ok: true; completed?: boolean }
  | { error: "not_found" | "closed" | "done" };

/** Calls one of the organizer's actions; every action's arguments are plain ids. */
function act(
  t: T,
  s: Setup,
  name: "reassign" | "markDone" | "markNotDone",
  args: { readId: Id<"rotaReads">; participantId?: Id<"rotaParticipants"> },
  token = s.token,
): Promise<Outcome> {
  return t.mutation(api.rota[name], {
    sessionToken: token,
    inviteCode: s.inviteCode,
    ...args,
  } as {
    sessionToken: string;
    inviteCode: string;
    readId: Id<"rotaReads">;
    participantId: Id<"rotaParticipants">;
  }) as Promise<Outcome>;
}

function closeDay(t: T, s: Setup) {
  return t.run(async (ctx) => {
    const day = await ctx.db
      .query("rotaDays")
      .withIndex("by_khatma_n", (q) => q.eq("khatmaId", s.khatmaId))
      .first();
    await ctx.db.patch(day!._id, { closedAt: NOW });
  });
}

test("shows 30 unread tiles, the day and the next one after a start", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s); // takes the first free juz' of the next day
  expect((await today(t, s))?.day).toBeNull();

  await startDay(t, s);
  const view = await today(t, s);
  expect(view?.day).toMatchObject({
    number: 1,
    cycle: 1,
    date: "2027-01-15",
    doneCount: 0,
    completedAt: null,
  });
  expect(view?.next).toEqual({ number: 2, date: "2027-01-22" });
  expect(view?.paused).toBe(false);
  expect(view?.archived).toBe(false);
  expect(view?.tiles).toHaveLength(30);
  expect(view?.tiles.map((x) => x.juz)).toEqual(
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  expect(view?.tiles.every((x) => x.state === "unread")).toBe(true);
  expect(view?.participants.map((p) => p.isMe)).toEqual([true, false]);
  expect(view?.participants.every((p) => !p.doneToday)).toBe(true);
});

test("reassigning juz' 8 shows it reassigned with both names", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const holder = await add(t, s, 8);
  const reader = await add(t, s, 9);
  await startDay(t, s);
  const before = await tile(t, s, 8);
  expect(before).toMatchObject({ state: "unread", readerId: holder });

  expect(
    await act(t, s, "reassign", {
      readId: before.readId,
      participantId: reader,
    }),
  ).toEqual({ ok: true });
  const after = await tile(t, s, 8);
  expect(after.state).toBe("reassigned");
  expect(after.readerId).toBe(reader);
  expect(after.holderName).toBe(before.readerName);
  expect(after.readerName).toBe((await tile(t, s, 9)).readerName);
  expect(after.holderName).not.toBe(after.readerName);
});

test("the organizer can take a juz' themselves", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const other = await add(t, s, 8);
  await startDay(t, s);
  const eight = await tile(t, s, 8);
  expect(eight.state).toBe("unread");
  expect(eight.readerId).toBe(other);

  const me = (await today(t, s))!.participants.find((p) => p.isMe)!;
  expect(
    await act(t, s, "reassign", { readId: eight.readId, participantId: me.id }),
  ).toEqual({ ok: true });
  const after = await tile(t, s, 8);
  expect(after.state).toBe("reassigned");
  expect(after.readerId).toBe(me.id);
  expect(after.readerName).toBe("المنظم");
  expect(after.holderName).toMatch(/^قارئ/);
  const row = await t.run((ctx) => ctx.db.get(eight.readId));
  expect(row?.reassignedAt).toBeGreaterThanOrEqual(NOW);
});

test("reassigning a done juz', a stranger or a missing read is refused", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const other = await add(t, s, 8);
  await startDay(t, s);
  const eight = await tile(t, s, 8);
  await act(t, s, "markDone", { readId: eight.readId });
  expect(
    await act(t, s, "reassign", { readId: eight.readId, participantId: other }),
  ).toEqual({ error: "done" });

  const nine = await tile(t, s, 9);
  const elsewhere = await t.run(async (ctx) => {
    const { _id, _creationTime, ...k } = (await ctx.db.get(s.khatmaId))!;
    void _id;
    void _creationTime;
    const id = await ctx.db.insert("khatmas", { ...k, inviteCode: "other" });
    return await ctx.db.insert("rotaParticipants", {
      khatmaId: id,
      name: "غريب",
      phone: "+971500000099",
      personId: null,
      addedAt: 0,
      removedAt: null,
    });
  });
  expect(
    await act(t, s, "reassign", {
      readId: nine.readId,
      participantId: elsewhere,
    }),
  ).toEqual({ error: "not_found" });
});

test("marking all 30 done completes the day once; marking one not done undoes it", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await startDay(t, s);
  const tiles = (await today(t, s))!.tiles;
  const results: unknown[] = [];
  for (const x of tiles) {
    results.push(await act(t, s, "markDone", { readId: x.readId }));
  }
  expect(
    results.filter((r) => (r as { completed?: boolean }).completed),
  ).toHaveLength(1);
  expect((results[29] as { completed: boolean }).completed).toBe(true);

  const done = await today(t, s);
  expect(done?.day?.doneCount).toBe(30);
  expect(done?.day?.completedAt).toBeGreaterThanOrEqual(NOW);
  expect(done?.tiles.every((x) => x.state === "done")).toBe(true);
  expect(done?.participants.every((p) => p.doneToday)).toBe(true);
  const row = await t.run((ctx) => ctx.db.get(tiles[0]!.readId));
  expect(row?.doneByOrganizer).toBe(true);

  const mine = tiles.find((x) => x.readerId !== null)!;
  expect(await act(t, s, "markNotDone", { readId: mine.readId })).toEqual({
    ok: true,
  });
  const undone = await today(t, s);
  expect(undone?.day?.doneCount).toBe(29);
  expect(undone?.day?.completedAt).toBeNull();
  expect((await tile(t, s, mine.juz)).state).toBe("unread");
  expect(undone?.participants.every((p) => p.doneToday)).toBe(false);

  expect(await act(t, s, "markDone", { readId: mine.readId })).toEqual({
    ok: true,
    completed: true,
  });
});

test("actions on a closed day return closed", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const other = await add(t, s, 8);
  await startDay(t, s);
  const eight = await tile(t, s, 8);
  await closeDay(t, s);
  expect(await act(t, s, "markDone", { readId: eight.readId })).toEqual({
    error: "closed",
  });
  expect(await act(t, s, "markNotDone", { readId: eight.readId })).toEqual({
    error: "closed",
  });
  expect(
    await act(t, s, "reassign", { readId: eight.readId, participantId: other }),
  ).toEqual({ error: "closed" });
  // Today's closed day still shows.
  expect((await today(t, s))?.day?.number).toBe(1);
});

test("a read that does not exist is not_found", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await startDay(t, s);
  const readId = (await tile(t, s, 1)).readId;
  await t.run((ctx) => ctx.db.delete(readId));
  expect(await act(t, s, "markDone", { readId })).toEqual({
    error: "not_found",
  });
  expect(await act(t, s, "markNotDone", { readId })).toEqual({
    error: "not_found",
  });
});

test("a non-organizer gets null and forbidden", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await startDay(t, s);
  const readId = (await tile(t, s, 1)).readId;
  const stranger = await person(t, "غريب");
  const participantId = (await today(t, s))!.participants[0]!.id;
  expect(await today(t, s, stranger.token)).toBeNull();
  for (const [name, args] of [
    ["markDone", { readId }],
    ["markNotDone", { readId }],
    ["reassign", { readId, participantId }],
  ] as const) {
    await expect(act(t, s, name, args, stranger.token)).rejects.toThrow(
      /forbidden/,
    );
  }
});

test("a read of another khatma is not_found for this khatma's organizer", async () => {
  const t = convexTest(schema, modules);
  const a = await setup(t);
  const b = await setup(t);
  await startDay(t, a);
  await startDay(t, b);
  const mine = await add(t, a, 8);
  const theirs = await tile(t, b, 8);
  for (const [name, args] of [
    ["reassign", { readId: theirs.readId, participantId: mine }],
    ["markDone", { readId: theirs.readId }],
    ["markNotDone", { readId: theirs.readId }],
  ] as const) {
    expect(await act(t, a, name, args)).toEqual({ error: "not_found" });
  }
  expect((await tile(t, b, 8)).state).toBe("unread");
});

test("today says whether setup is done", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, false);
  await startDay(t, s);
  expect(await today(t, s)).toMatchObject({ setupDone: false, day: null });
  await t.mutation(api.rota.finishSetup, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
  });
  await startDay(t, s);
  expect(await today(t, s)).toMatchObject({
    setupDone: true,
    day: { number: 1 },
  });
});

/** Marks participants as having sent their join message, so messages can reach them. */
async function join(t: T, ...ids: Id<"rotaParticipants">[]) {
  for (const id of ids) {
    await t.run((ctx) => ctx.db.patch(id, { joinedAt: NOW - 3_600_000 }));
  }
}

function queued(t: T, kind: string) {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query("rotaOutbox").collect();
    return rows
      .filter((r) => r.kind === kind)
      .map((r) => ({ participantId: r.participantId, juz: r.juz }));
  });
}

test("reassigning queues assigned for the new reader and covered for the holder", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const holder = await add(t, s, 8);
  const reader = await add(t, s, 9);
  await join(t, holder, reader);
  await startDay(t, s);
  const eight = await tile(t, s, 8);
  await act(t, s, "reassign", { readId: eight.readId, participantId: reader });
  expect(await queued(t, "assigned")).toEqual([
    { participantId: reader, juz: [8] },
  ]);
  expect(await queued(t, "covered")).toEqual([
    { participantId: holder, juz: [8] },
  ]);
});

test("giving a juz' back to its holder queues assigned but no covered", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const holder = await add(t, s, 8);
  await join(t, holder);
  await startDay(t, s);
  const eight = await tile(t, s, 8);
  await act(t, s, "reassign", { readId: eight.readId, participantId: holder });
  expect(await queued(t, "assigned")).toEqual([
    { participantId: holder, juz: [8] },
  ]);
  expect(await queued(t, "covered")).toEqual([]);
});

test("the organizer finishing the day queues complete once for every joined participant", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = await add(t, s, 8);
  const b = await add(t, s, 9);
  const notJoined = await add(t, s, 10);
  await join(t, a, b);
  await startDay(t, s);
  const view = await today(t, s);
  const all = view!.tiles;
  for (const x of all.slice(0, 29)) {
    await act(t, s, "markDone", { readId: x.readId });
  }
  expect(await queued(t, "complete")).toEqual([]);

  const last = all[29]!;
  expect(await act(t, s, "markDone", { readId: last.readId })).toEqual({
    ok: true,
    completed: true,
  });
  const rows = await queued(t, "complete");
  expect(rows.map((r) => r.participantId).sort()).toEqual([a, b].sort());
  expect(rows.some((r) => r.participantId === notJoined)).toBe(false);

  // Undoing and redoing the last juz' doesn't celebrate again.
  await act(t, s, "markNotDone", { readId: last.readId });
  expect(await act(t, s, "markDone", { readId: last.readId })).toEqual({
    ok: true,
    completed: true,
  });
  expect(await queued(t, "complete")).toHaveLength(2);
});

test("two reassignments to one reader before delivery make one message naming both ajza'", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const holder = await add(t, s, 8);
  const reader = await add(t, s, 9);
  await join(t, holder, reader);
  await startDay(t, s);
  const eight = await tile(t, s, 8);
  const ten = await tile(t, s, 10);
  await act(t, s, "reassign", { readId: ten.readId, participantId: holder });
  await act(t, s, "reassign", { readId: eight.readId, participantId: reader });
  const nine = await tile(t, s, 9);
  await act(t, s, "reassign", { readId: nine.readId, participantId: holder });
  expect(await queued(t, "assigned")).toEqual([
    { participantId: holder, juz: [9, 10] },
    { participantId: reader, juz: [8] },
  ]);
});

test("a reassignment after the first message went out makes a new message", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const holder = await add(t, s, 8);
  const reader = await add(t, s, 9);
  await join(t, holder, reader);
  await startDay(t, s);
  await act(t, s, "reassign", {
    readId: (await tile(t, s, 8)).readId,
    participantId: reader,
  });
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("rotaOutbox").collect();
    for (const r of rows) {
      if (r.kind === "assigned" || r.kind === "covered") {
        await ctx.db.patch(r._id, { sentAt: NOW });
      }
    }
  });
  await act(t, s, "reassign", {
    readId: (await tile(t, s, 10)).readId,
    participantId: reader,
  });
  expect(await queued(t, "assigned")).toEqual([
    { participantId: reader, juz: [8] },
    { participantId: reader, juz: [10] },
  ]);
});

test("a juz' moved on from a reader who isn't the holder covers that reader too, once told", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = await add(t, s, 8);
  const b = await add(t, s, 9);
  const c = await add(t, s, 10);
  await join(t, a, b, c);
  await startDay(t, s);
  const eight = await tile(t, s, 8);
  await act(t, s, "reassign", { readId: eight.readId, participantId: b });
  // B's message hasn't gone out: the juz' leaves it, and B is told nothing
  await act(t, s, "reassign", { readId: eight.readId, participantId: c });
  expect(await queued(t, "covered")).toEqual([{ participantId: a, juz: [8] }]);
  expect(await queued(t, "assigned")).toEqual([{ participantId: c, juz: [8] }]);

  // Once B was told, moving it on covers B.
  await act(t, s, "reassign", { readId: eight.readId, participantId: b });
  await t.run(async (ctx) => {
    for (const r of await ctx.db.query("rotaOutbox").collect()) {
      await ctx.db.patch(r._id, { sentAt: NOW });
    }
  });
  await act(t, s, "reassign", { readId: eight.readId, participantId: a });
  expect(
    (await queued(t, "covered")).filter((r) => r.participantId === b),
  ).toEqual([{ participantId: b, juz: [8] }]);
});

test("the organizer marking their own juz' done counts as their reply", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const other = await add(t, s, 8);
  await startDay(t, s);
  const me = (await today(t, s))!.participants.find((p) => p.isMe)!;
  await t.run((ctx) =>
    ctx.db.patch(me.id, { silentDays: 5, lastReplyAt: 1, silencedAt: 1 }),
  );
  await t.run((ctx) => ctx.db.patch(other, { silentDays: 5, lastReplyAt: 1 }));

  // a juz' the organizer reads (2, taken from nobody), then the one they hold
  // that went to someone else (1), then someone else's (8)
  const two = await tile(t, s, 2);
  await act(t, s, "reassign", { readId: two.readId, participantId: me.id });
  await act(t, s, "markDone", { readId: two.readId });
  expect(await t.run((ctx) => ctx.db.get(me.id))).toMatchObject({
    lastReplyAt: expect.toSatisfy((at: number) => at >= NOW),
    silentDays: 0,
    silencedAt: null,
  });
  await t.run((ctx) =>
    ctx.db.patch(me.id, { silentDays: 5, lastReplyAt: 1, silencedAt: 1 }),
  );
  const one = await tile(t, s, 1);
  await act(t, s, "reassign", { readId: one.readId, participantId: other });
  await act(t, s, "markDone", { readId: one.readId });
  expect(await t.run((ctx) => ctx.db.get(me.id))).toMatchObject({
    lastReplyAt: expect.toSatisfy((at: number) => at >= NOW),
    silentDays: 0,
    silencedAt: null,
  });

  await act(t, s, "markDone", { readId: (await tile(t, s, 8)).readId });
  expect(await t.run((ctx) => ctx.db.get(other))).toMatchObject({
    lastReplyAt: 1,
    silentDays: 5,
  });
});

async function joinAll(t: T) {
  await t.run(async (ctx) => {
    for (const p of await ctx.db.query("rotaParticipants").collect()) {
      await ctx.db.patch(p._id, { joinedAt: NOW });
    }
  });
}

test("an unread tile says whether the reader answered «ليس بعد»; a done one has no answer", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s, 4);
  await add(t, s, 5);
  await joinAll(t);
  await startDay(t, s);
  const four = await tile(t, s, 4);
  const five = await tile(t, s, 5);
  expect(four.answer).toBe("none");
  await t.run((ctx) => ctx.db.patch(four.readId, { notYetAt: NOW }));
  expect((await tile(t, s, 4)).answer).toBe("notYet");

  await act(t, s, "markDone", { readId: five.readId });
  expect((await tile(t, s, 5)).answer).toBeNull();
  // Done outranks an earlier «ليس بعد».
  await act(t, s, "markDone", { readId: four.readId });
  expect((await tile(t, s, 4)).answer).toBeNull();
});

test("«لم يردّ» is shown only for a reader who joined and can be messaged", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const notJoined = await add(t, s, 4);
  const stopped = await add(t, s, 5);
  const silenced = await add(t, s, 6);
  await add(t, s, 7);
  await joinAll(t);
  await t.run(async (ctx) => {
    await ctx.db.patch(notJoined, { joinedAt: null });
    await ctx.db.patch(stopped, { stoppedAt: NOW });
    await ctx.db.patch(silenced, { silencedAt: NOW });
  });
  await startDay(t, s);
  expect((await tile(t, s, 4)).answer).toBeNull();
  expect((await tile(t, s, 5)).answer).toBeNull();
  expect((await tile(t, s, 6)).answer).toBeNull();
  expect((await tile(t, s, 7)).answer).toBe("none");
  // «ليس بعد» is an answer whoever gave it.
  const four = await tile(t, s, 4);
  await t.run((ctx) => ctx.db.patch(four.readId, { notYetAt: NOW }));
  expect((await tile(t, s, 4)).answer).toBe("notYet");
});

test("reassigning clears the old «ليس بعد»: the new reader has not answered", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s, 8);
  const reader = await add(t, s, 9);
  await joinAll(t);
  await startDay(t, s);
  const eight = await tile(t, s, 8);
  await t.run((ctx) => ctx.db.patch(eight.readId, { notYetAt: NOW }));
  expect((await tile(t, s, 8)).answer).toBe("notYet");
  await act(t, s, "reassign", {
    readId: eight.readId,
    participantId: reader,
  });
  expect((await tile(t, s, 8)).answer).toBe("none");
});

test("a reader whose juz' moved before the day's message hears nothing of it", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const holder = await add(t, s, 8);
  const first = await add(t, s, 9);
  const second = await add(t, s, 10);
  await startDay(t, s);
  await t.run(async (ctx) => {
    const day = await ctx.db.query("rotaDays").first();
    await ctx.db.patch(day!._id, { juzSentAt: null });
    for (const row of await ctx.db.query("rotaParticipants").collect()) {
      await ctx.db.patch(row._id, { joinedAt: 1 });
    }
  });
  const covered = async () =>
    await t.run(async (ctx) =>
      (await ctx.db.query("rotaOutbox").collect())
        .filter((r) => r.kind === "covered")
        .map((r) => r.participantId),
    );
  const { readId } = await tile(t, s, 8);
  await act(t, s, "reassign", { readId, participantId: first });
  expect(await covered()).toEqual([]);

  // The first reader was told, so they hear it moved on.
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("rotaOutbox").collect()) {
      await ctx.db.patch(row._id, { sentAt: 1 });
    }
  });
  await act(t, s, "reassign", { readId, participantId: second });
  expect(await covered()).toEqual([first]);
  expect(await covered()).not.toContain(holder);
});
