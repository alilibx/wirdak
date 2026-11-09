import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { slotFor } from "./lib/rota";
import { placeNewParticipant } from "./lib/rotaOps/people";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2027-01-15 11:00 in Asia/Dubai (a Friday).
const NOW = Date.UTC(2027, 0, 15, 7, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
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

async function person(t: T, rotaAllowed = true) {
  seq += 1;
  const token = `token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone: `+9715000200${String(seq).padStart(2, "0")}`,
      displayName: "المنظم",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
      ...(rotaAllowed ? { rotaAllowed: true } : {}),
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

async function setup(t: T) {
  const who = await person(t);
  await allowStartToday(t);
  const { inviteCode } = await t.action(api.rota.create, {
    sessionToken: who.token,
    name: "ختمة",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
    endDate: null,
  });
  return { ...who, inviteCode };
}
type Setup = Awaited<ReturnType<typeof setup>>;

let phoneSeq = 0;
function add(
  t: T,
  s: Setup,
  over: Partial<{
    name: string;
    phone: string;
    juz: number;
    share: boolean;
  }> = {},
) {
  phoneSeq += 1;
  return t.mutation(api.rota.addParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    name: `قارئ ${phoneSeq}`,
    phone: `+97150555${String(phoneSeq).padStart(4, "0")}`,
    ...over,
  });
}

function people(t: T, s: Setup) {
  return t.query(api.rota.people, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
  });
}

function participantId(r: Awaited<ReturnType<typeof add>>) {
  if (!("participantId" in r)) throw new Error(JSON.stringify(r));
  return r.participantId;
}

test("the first people added take the lowest free ajza' in order", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = await add(t, s, { name: "الأول" });
  const b = await add(t, s);
  const c = await add(t, s);
  expect([a, b, c].map((r) => ("juz" in r ? r.juz : null))).toEqual([2, 3, 4]);

  const view = await people(t, s);
  expect(view?.target).toEqual({
    number: 1,
    date: "2027-01-15",
    isFirst: true,
  });
  expect(view?.rows).toHaveLength(30);
  expect(view?.rows[0]?.participant).toMatchObject({
    name: "المنظم",
    isMe: true,
    slots: 1,
  });
  expect(view?.rows[1]?.juz).toBe(2);
  expect(view?.rows[1]?.participant?.name).toBe("الأول");
  expect(view?.rows[4]?.participant).toBeNull();
  expect(view?.freeJuz).toHaveLength(26);
  expect(view?.freeJuz[0]).toBe(5);
  expect(view?.maxSlots).toBe(3);
  expect(view?.participants.map((p) => p.juz)).toEqual([[1], [2], [3], [4]]);
});

test("people marks the organizer's row, in the juz' rows and the list alike", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s, { name: "الأول" });
  const view = await people(t, s);
  expect(view?.participants.map((p) => p.isOrganizer)).toEqual([true, false]);
  expect(view?.rows[0]?.participant?.isOrganizer).toBe(true);
  expect(view?.rows[1]?.participant?.isOrganizer).toBe(false);
});

test("refuses a held juz', a repeated phone, a bad name or phone", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s, { juz: 5, phone: "+971505550001" });
  expect(await add(t, s, { juz: 5 })).toEqual({ error: "juz_taken" });
  expect(await add(t, s, { phone: "+971 50 555 0001" })).toEqual({
    error: "already_added",
  });
  expect(await add(t, s, { phone: "050555" })).toEqual({
    error: "bad_phone",
  });
  expect(await add(t, s, { name: "  " })).toEqual({ error: "bad_name" });
});

test("reads a number without a country code as one from the organizer's country", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await t.run((ctx) => ctx.db.patch(s.personId, { phone: "+201000000001" }));
  const added = await add(t, s, { phone: "٠١٠١٢٣٤٥٦٧٨" });
  expect(added).toMatchObject({ ok: true });
  const saved = await t.run((ctx) => ctx.db.get(participantId(added)));
  expect(saved?.phone).toBe("+201012345678");
  expect(await add(t, s, { phone: "+20 010 1234 5678" })).toEqual({
    error: "already_added",
  });
  expect((await people(t, s))?.phoneExample).toBe("010 01234567");
});

test("says when no juz' is free", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  for (let i = 0; i < 29; i++) await add(t, s);
  expect(await add(t, s)).toEqual({ error: "no_free_juz" });
});

test("giveJuz gives up to the slot limit, then too_many", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const id = participantId(await add(t, s)); // juz' 2
  const give = (juz: number) =>
    t.mutation(api.rota.giveJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId: id,
      juz,
    });
  expect(await give(10)).toEqual({ ok: true });
  expect(await give(11)).toEqual({ ok: true });
  expect(await give(12)).toEqual({ error: "too_many" });
  expect(await give(1)).toEqual({ error: "juz_taken" });
  const view = await people(t, s);
  expect(view?.participants.find((p) => p.id === id)?.juz).toEqual([2, 10, 11]);
});

test("spreadFreeJuz gives the free ajza' in order, to whoever holds the fewest, up to the cap", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s)); // 2
  const b = participantId(await add(t, s)); // 3
  const spread = () =>
    t.mutation(api.rota.spreadFreeJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
    });
  // Three people, three ajza' each at most: 6 more of the 27 free.
  expect(await spread()).toEqual({ ok: true, given: 6, left: 21 });
  const view = await people(t, s);
  const juzOf = (id: Id<"rotaParticipants">) =>
    view?.participants.find((p) => p.id === id)?.juz;
  expect(view?.participants.find((p) => p.isMe)?.juz).toEqual([1, 4, 7]);
  expect(juzOf(a)).toEqual([2, 5, 8]);
  expect(juzOf(b)).toEqual([3, 6, 9]);
  expect(view?.freeJuz).toHaveLength(21);
  expect(await spread()).toEqual({ error: "no_room" });
});

test("spreadFreeJuz evens out who reads more first, and fills all 30", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s)); // 2
  await t.mutation(api.rota.giveJuz, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: a,
    juz: 30,
  });
  for (let i = 0; i < 8; i++) await add(t, s); // 3 to 10
  expect(
    await t.mutation(api.rota.spreadFreeJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
    }),
  ).toEqual({ ok: true, given: 19, left: 0 });
  const view = await people(t, s);
  expect(view?.freeJuz).toEqual([]);
  // The one who already read two gets no more until everyone else has two.
  expect(view?.participants.find((p) => p.isMe)?.juz).toEqual([1, 11, 20]);
  expect(view?.participants.find((p) => p.id === a)?.juz).toEqual([2, 21, 30]);
  expect(view?.participants.every((p) => p.juz.length <= 3)).toBe(true);
  expect(
    await t.mutation(api.rota.spreadFreeJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
    }),
  ).toEqual({ error: "no_free_juz" });
});

test("spreadFreeJuz skips whoever stopped, was silenced, or holds none", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const stopped = participantId(await add(t, s)); // 2
  const silenced = participantId(await add(t, s)); // 3
  const b = participantId(await add(t, s)); // 4
  await t.run(async (ctx) => {
    await ctx.db.patch(stopped, { stoppedAt: NOW });
    await ctx.db.patch(silenced, { silencedAt: NOW });
  });
  // The organizer stops reading: their juz' 1 goes, and they stay in the khatma.
  const me = (await people(t, s))?.participants.find((p) => p.isMe)?.id;
  if (!me) throw new Error("no organizer");
  await t.mutation(api.rota.freeJuz, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: me,
    juz: 1,
  });
  expect(
    await t.mutation(api.rota.spreadFreeJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
    }),
  ).toEqual({ ok: true, given: 2, left: 25 });
  const view = await people(t, s);
  const juzOf = (id: Id<"rotaParticipants">) =>
    view?.participants.find((p) => p.id === id)?.juz;
  expect(view?.participants.find((p) => p.isMe)?.juz).toEqual([]);
  expect(juzOf(stopped)).toEqual([2]);
  expect(juzOf(silenced)).toEqual([3]);
  expect(juzOf(b)).toEqual([1, 4, 5]);
});

test("moveJuz moves to a free juz' and swaps with a held one", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s)); // 2
  const b = participantId(await add(t, s)); // 3
  const move = (
    participant: Id<"rotaParticipants">,
    from: number,
    to: number,
  ) =>
    t.mutation(api.rota.moveJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId: participant,
      fromJuz: from,
      toJuz: to,
    });
  expect(await move(a, 2, 20)).toEqual({ ok: true });
  let view = await people(t, s);
  expect(view?.rows[19]?.participant?.id).toBe(a);
  expect(view?.rows[1]?.participant).toBeNull();

  expect(await move(a, 20, 3)).toEqual({ ok: true });
  view = await people(t, s);
  expect(view?.rows[2]?.participant?.id).toBe(a);
  expect(view?.rows[19]?.participant?.id).toBe(b);

  expect(await move(a, 20, 5)).toEqual({ error: "not_found" });
});

test("freeJuz empties a slot", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s);
  const view0 = await people(t, s);
  const holder = view0!.rows[1]!.participant!.id;
  const free = (juz: number, participantId = holder) =>
    t.mutation(api.rota.freeJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId,
      juz,
    });
  expect(await free(2)).toEqual({ ok: true });
  expect(await free(2)).toEqual({ error: "not_found" });
  const view = await people(t, s);
  expect(view?.rows[1]?.participant).toBeNull();
  expect(view?.freeJuz).toContain(2);
});

test("freeJuz frees nobody else's slot: the juz' must still be held by that person", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s);
  const other = participantId(await add(t, s, { juz: 7 }));
  const free = (juz: number, participantId: typeof other) =>
    t.mutation(api.rota.freeJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId,
      juz,
    });
  // juz' 7 is the other person's, not the organizer's
  const organizer = (await people(t, s))!.rows[0]!.participant!.id;
  expect(await free(7, organizer)).toEqual({ error: "not_found" });
  expect((await people(t, s))?.rows[6]?.participant?.id).toBe(other);
  expect(await free(7, other)).toEqual({ ok: true });
});

test("removeParticipant frees their ajza' and refuses the organizer", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s));
  await t.mutation(api.rota.giveJuz, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: a,
    juz: 9,
  });
  const remove = (id: Id<"rotaParticipants">) =>
    t.mutation(api.rota.removeParticipant, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId: id,
    });
  expect(await remove(a)).toEqual({ ok: true });
  const view = await people(t, s);
  expect(view?.participants.map((p) => p.name)).toEqual(["المنظم"]);
  expect(view?.freeJuz).toEqual(expect.arrayContaining([2, 9]));
  expect(await remove(a)).toEqual({ error: "not_found" });

  const me = view!.participants[0]!.id;
  expect(await remove(me)).toEqual({ error: "is_me" });

  // a removed person can be added again
  expect(await add(t, s, { phone: "+971505550099" })).toMatchObject({
    ok: true,
  });
});

// ---------------------------------------------------------------------------
// Shared slots

function khatmaIdOf(t: T, s: Setup) {
  return t.run(async (ctx) => {
    const k = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", s.inviteCode))
      .unique();
    return k!._id;
  });
}

/** Adds a second reader to `juz` of khatma 1 straight in the database. */
async function shareJuz(t: T, s: Setup, juz: number) {
  const khatmaId = await khatmaIdOf(t, s);
  phoneSeq += 1;
  const phone = `+97150555${String(phoneSeq).padStart(4, "0")}`;
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("rotaParticipants", {
      khatmaId,
      name: `ثانٍ ${phoneSeq}`,
      phone,
      personId: null,
      addedAt: NOW,
      removedAt: null,
    });
    await ctx.db.insert("rotaSlots", {
      khatmaId,
      slot: slotFor(juz, 1),
      participantId: id,
      second: true,
    });
    return id;
  });
}

/** The slot rows of `juz` in khatma 1, first reader first. */
async function slotRowsOf(t: T, s: Setup, juz: number) {
  const khatmaId = await khatmaIdOf(t, s);
  const rows = await t.run((ctx) =>
    ctx.db
      .query("rotaSlots")
      .withIndex("by_khatma_slot", (q) =>
        q.eq("khatmaId", khatmaId).eq("slot", slotFor(juz, 1)),
      )
      .collect(),
  );
  return rows
    .sort((a, b) => Number(a.second === true) - Number(b.second === true))
    .map((r) => ({ participantId: r.participantId, second: r.second }));
}

test("removing the first reader of a shared slot makes the second whole", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s, { juz: 7 }));
  const b = await shareJuz(t, s, 7);
  expect(
    await t.mutation(api.rota.removeParticipant, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId: a,
    }),
  ).toEqual({ ok: true });
  const view = await people(t, s);
  expect(view?.rows[6]?.participant?.id).toBe(b);
  expect(view?.freeJuz).not.toContain(7);
  expect(await slotRowsOf(t, s, 7)).toEqual([
    { participantId: b, second: undefined },
  ]);
});

test("removing the second reader of a shared slot leaves the first as it was", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s, { juz: 7 }));
  const b = await shareJuz(t, s, 7);
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: b,
  });
  expect((await people(t, s))?.rows[6]?.participant?.id).toBe(a);
  expect(await slotRowsOf(t, s, 7)).toEqual([
    { participantId: a, second: undefined },
  ]);
});

test("freeing the first reader of a shared slot makes the second whole", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s, { juz: 7 }));
  const b = await shareJuz(t, s, 7);
  const free = (participantId: Id<"rotaParticipants">) =>
    t.mutation(api.rota.freeJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId,
      juz: 7,
    });
  expect(await free(a)).toEqual({ ok: true });
  expect((await people(t, s))?.rows[6]?.participant?.id).toBe(b);
  expect(await slotRowsOf(t, s, 7)).toEqual([
    { participantId: b, second: undefined },
  ]);
  expect(await free(a)).toEqual({ error: "not_found" });

  // Freeing a second reader takes only their row.
  const c = await shareJuz(t, s, 7);
  expect(await free(c)).toEqual({ ok: true });
  expect(await slotRowsOf(t, s, 7)).toEqual([
    { participantId: b, second: undefined },
  ]);
});

test("moving the first reader of a shared slot to an empty juz' leaves the second whole", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s, { juz: 7 }));
  const b = await shareJuz(t, s, 7);
  const move = (
    participant: Id<"rotaParticipants">,
    from: number,
    to: number,
  ) =>
    t.mutation(api.rota.moveJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId: participant,
      fromJuz: from,
      toJuz: to,
    });
  expect(await move(a, 7, 20)).toEqual({ ok: true });
  let view = await people(t, s);
  expect(view?.rows[6]?.participant?.id).toBe(b);
  expect(view?.rows[19]?.participant?.id).toBe(a);
  expect(await slotRowsOf(t, s, 7)).toEqual([
    { participantId: b, second: undefined },
  ]);
  expect(await slotRowsOf(t, s, 20)).toEqual([
    { participantId: a, second: undefined },
  ]);

  // A second reader moves to an empty juz' as its only reader.
  const c = participantId(await add(t, s, { juz: 8 }));
  const d = await shareJuz(t, s, 8);
  expect(await move(d, 8, 25)).toEqual({ ok: true });
  view = await people(t, s);
  expect(view?.rows[7]?.participant?.id).toBe(c);
  expect(view?.rows[24]?.participant?.id).toBe(d);
  expect(await slotRowsOf(t, s, 8)).toEqual([
    { participantId: c, second: undefined },
  ]);

  // A swap never takes a shared slot, from either side.
  const e = await shareJuz(t, s, 8);
  expect(await move(c, 8, 20)).toEqual({ error: "shared" });
  expect(await move(e, 8, 20)).toEqual({ error: "shared" });
  expect(await move(a, 20, 8)).toEqual({ error: "shared" });
  expect(await slotRowsOf(t, s, 8)).toEqual([
    { participantId: c, second: undefined },
    { participantId: e, second: true },
  ]);
  expect(await slotRowsOf(t, s, 20)).toEqual([
    { participantId: a, second: undefined },
  ]);
});

test("today's read keeps both readers after one leaves", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s, { juz: 7 }));
  const b = await shareJuz(t, s, 7);
  const khatmaId = await khatmaIdOf(t, s);
  await t.run(async (ctx) => {
    const k = await ctx.db.get(khatmaId);
    await ctx.db.patch(khatmaId, {
      rota: { ...k!.rota!, setupDoneAt: NOW - 60_000 },
    });
  });
  await t.mutation(internal.rotaDays.tick, { khatmaId });
  const readOf7 = () =>
    t.run(async (ctx) => {
      const day = await ctx.db
        .query("rotaDays")
        .withIndex("by_khatma_n", (q) => q.eq("khatmaId", khatmaId))
        .unique();
      return ctx.db
        .query("rotaReads")
        .withIndex("by_day_juz", (q) => q.eq("dayId", day!._id).eq("juz", 7))
        .unique();
    });
  expect(await readOf7()).toMatchObject({
    holderId: a,
    readerId: a,
    partnerId: b,
  });
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: a,
  });
  expect(await readOf7()).toMatchObject({
    holderId: a,
    readerId: a,
    partnerId: b,
  });
});

test("a shared slot counts toward the cap unless rotaHalfCountsAsSlot is off", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s, { juz: 7 });
  const b = await shareJuz(t, s, 7);
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      key: "rotaMaxSlotsPerPerson",
      value: 1,
      updatedAt: 0,
    });
  });
  const give = () =>
    t.mutation(api.rota.giveJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId: b,
      juz: 20,
    });
  expect(await give()).toEqual({ error: "too_many" });
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      key: "rotaHalfCountsAsSlot",
      value: false,
      updatedAt: 0,
    });
  });
  expect(await give()).toEqual({ ok: true });
  expect((await people(t, s))?.rows[19]?.participant?.id).toBe(b);
});

test("people counts each one's ajza' toward the cap the way giveJuz does, and names the shared ones", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s, { juz: 7 }));
  const b = await shareJuz(t, s, 7);
  const counts = async () => {
    const view = await people(t, s);
    const of = (id: Id<"rotaParticipants">) =>
      view?.participants.find((p) => p.id === id);
    return {
      a: of(a)?.heldSlots,
      b: of(b)?.heldSlots,
      rowA: view?.rows[6]?.participant?.slots,
      rowB: view?.rows[6]?.partner?.slots,
    };
  };
  expect(await counts()).toEqual({ a: 1, b: 1, rowA: 1, rowB: 1 });
  const view = await people(t, s);
  expect(view?.participants.find((p) => p.id === a)?.shared).toEqual([7]);
  expect(view?.participants.find((p) => p.id === b)?.shared).toEqual([7]);
  expect(view?.participants.find((p) => p.isMe)?.shared).toEqual([]);

  await t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "rotaHalfCountsAsSlot",
      value: false,
      updatedAt: 0,
    }),
  );
  expect(await counts()).toEqual({ a: 1, b: 0, rowA: 1, rowB: 0 });
});

test("someone else sees no people and cannot change them", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const a = participantId(await add(t, s));
  const other = await person(t);
  const args = { sessionToken: other.token, inviteCode: s.inviteCode };
  expect(await t.query(api.rota.people, args)).toBeNull();
  expect(
    await t.query(api.rota.people, { inviteCode: s.inviteCode }),
  ).toBeNull();
  const forbidden = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as { data?: { code?: string } }).data?.code;
    }
  };
  expect(
    await forbidden(
      t.mutation(api.rota.addParticipant, {
        ...args,
        name: "س",
        phone: "+971505559999",
      }),
    ),
  ).toBe("forbidden");
  expect(
    await forbidden(
      t.mutation(api.rota.giveJuz, { ...args, participantId: a, juz: 8 }),
    ),
  ).toBe("forbidden");
  expect(
    await forbidden(
      t.mutation(api.rota.moveJuz, {
        ...args,
        participantId: a,
        fromJuz: 2,
        toJuz: 8,
      }),
    ),
  ).toBe("forbidden");
  expect(
    await forbidden(
      t.mutation(api.rota.freeJuz, { ...args, participantId: a, juz: 2 }),
    ),
  ).toBe("forbidden");
  expect(
    await forbidden(
      t.mutation(api.rota.removeParticipant, { ...args, participantId: a }),
    ),
  ).toBe("forbidden");
});

test("a pool khatma is not a rota khatma", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await t.run(async (ctx) => {
    const k = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", s.inviteCode))
      .unique();
    await ctx.db.patch(k!._id, { kind: undefined, rota: undefined });
  });
  expect(await people(t, s)).toBeNull();
});

test("once day 12 has started, new people join khatma 13 and day 12 keeps its readers", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const { khatmaId, readId, firstId } = await t.run(async (ctx) => {
    const k = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", s.inviteCode))
      .unique();
    const khatmaId = k!._id;
    const first = await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .first();
    const dayId = await ctx.db.insert("rotaDays", {
      khatmaId,
      n: 12,
      number: 12,
      cycle: 1,
      date: "2027-01-15",
      startedAt: NOW - 3_600_000,
      closesAt: NOW + 3_600_000,
      completedAt: null,
      closedAt: null,
      unreadSentAt: null,
      summarySentAt: null,
    });
    let readId: Id<"rotaReads"> | null = null;
    for (let juz = 1; juz <= 30; juz++) {
      const id = await ctx.db.insert("rotaReads", {
        dayId,
        khatmaId,
        juz,
        slot: slotFor(juz, 12),
        holderId: juz === 7 ? first!._id : null,
        readerId: juz === 7 ? first!._id : null,
        doneAt: null,
        doneByOrganizer: false,
        reassignedAt: null,
      });
      if (juz === 7) readId = id;
    }
    return { khatmaId, readId: readId!, firstId: first!._id };
  });

  const before = await people(t, s);
  // the next day is the 13th; the 15th is taken by day 12, so the next Friday
  expect(before?.target).toEqual({
    number: 13,
    date: "2027-01-22",
    isFirst: false,
  });

  const r = await add(t, s, { juz: 7 });
  expect(r).toMatchObject({ ok: true, juz: 7 });
  await t.run(async (ctx) => {
    const slots = await ctx.db
      .query("rotaSlots")
      .withIndex("by_khatma_slot", (q) =>
        q.eq("khatmaId", khatmaId).eq("slot", slotFor(7, 13)),
      )
      .collect();
    expect(slots).toHaveLength(1);
    expect(slots[0]?.participantId).toBe(participantId(r));
    const read = await ctx.db.get(readId);
    expect(read?.readerId).not.toBe(participantId(r));
    expect(read?.readerId).toBe(firstId);
  });
});

test("there is no next day to place people on once the end date has passed", async () => {
  const t = convexTest(schema, modules);
  const who = await person(t);
  await allowStartToday(t);
  const { inviteCode } = await t.action(api.rota.create, {
    sessionToken: who.token,
    name: "ختمة",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
    endDate: "2027-01-15",
  });
  const s = { ...who, inviteCode };
  expect((await people(t, s))?.target.date).toBe("2027-01-15");

  await t.run(async (ctx) => {
    const k = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    await ctx.db.insert("rotaDays", {
      khatmaId: k!._id,
      n: 1,
      number: 1,
      cycle: 1,
      date: "2027-01-15",
      startedAt: NOW - 3_600_000,
      closesAt: NOW + 3_600_000,
      completedAt: null,
      closedAt: null,
      unreadSentAt: null,
      summarySentAt: null,
    });
  });
  expect((await people(t, s))?.target).toEqual({
    number: 2,
    date: null,
    isFirst: false,
  });
});

// ---------------------------------------------------------------------------
// Joining

const PUBLIC_NUMBER = "971500000000";

async function khatmaOf(t: T, s: Setup) {
  return t.run(async (ctx) => {
    const k = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", s.inviteCode))
      .unique();
    return k!;
  });
}

async function request(
  t: T,
  s: Setup,
  over: Partial<{
    phone: string;
    profileName: string | null;
    createdAt: number;
  }> = {},
) {
  const khatma = await khatmaOf(t, s);
  return t.run((ctx) =>
    ctx.db.insert("rotaJoinRequests", {
      khatmaId: khatma._id,
      phone: "+971501112233",
      profileName: "خالد",
      createdAt: NOW - 1000,
      resolvedAt: null,
      outcome: null,
      ...over,
    }),
  );
}

function accept(
  t: T,
  s: Setup,
  requestId: Id<"rotaJoinRequests">,
  juz: number,
  token = s.token,
) {
  return t.mutation(api.rota.acceptJoinRequest, {
    sessionToken: token,
    inviteCode: s.inviteCode,
    requestId,
    juz,
  });
}

function participantRow(t: T, id: Id<"rotaParticipants">) {
  return t.run((ctx) => ctx.db.get(id));
}

test("people says how often the khatma is read, for the share message", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  expect((await people(t, s))?.daysKind).toBe("weekly");
  const khatma = await khatmaOf(t, s);
  const kindFor = async (days: NonNullable<typeof khatma.rota>["days"]) => {
    await t.run((ctx) =>
      ctx.db.patch(khatma._id, { rota: { ...khatma.rota!, days } }),
    );
    return (await people(t, s))?.daysKind;
  };
  expect(await kindFor({ kind: "daily" })).toBe("daily");
  expect(
    await kindFor({ kind: "weekly", weekdays: [1, 5], everyWeeks: 2 }),
  ).toBe("biweekly");
  expect(await kindFor({ kind: "monthly", days: [1] })).toBe("monthly");
});

test("people shows the leftover box unless the admin turned it off", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  expect((await people(t, s))?.leftoverBox).toBe(true);
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "rotaLeftoverBoxOn",
      value: false,
      updatedAt: 0,
    }),
  );
  expect((await people(t, s))?.leftoverBox).toBe(false);
});

test("people has the join link built from the code and the public number", async () => {
  vi.stubEnv("WHATSAPP_PUBLIC_NUMBER", PUBLIC_NUMBER);
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const khatma = await khatmaOf(t, s);
  const view = await people(t, s);
  expect(view?.title).toBe("ختمة");
  expect(view?.joinLink).toBe(
    `https://wa.me/${PUBLIC_NUMBER}?text=${encodeURIComponent(
      `انضمام إلى ختمة · ${khatma.joinCode}`,
    )}`,
  );
});

test("without the public number or a join code there is no link, and ensureJoinLink draws the code", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  expect((await people(t, s))?.joinLink).toBeNull();

  vi.stubEnv("WHATSAPP_PUBLIC_NUMBER", PUBLIC_NUMBER);
  const khatma = await khatmaOf(t, s);
  await t.run((ctx) => ctx.db.patch(khatma._id, { joinCode: undefined }));
  expect((await people(t, s))?.joinLink).toBeNull();

  expect(
    await t.mutation(api.rota.ensureJoinLink, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
    }),
  ).toEqual({ ok: true });
  const code = (await khatmaOf(t, s)).joinCode;
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  expect((await people(t, s))?.joinLink).toContain(
    encodeURIComponent(`· ${code}`),
  );
  // Safe to repeat, and keeps the code.
  await t.mutation(api.rota.ensureJoinLink, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
  });
  expect((await khatmaOf(t, s)).joinCode).toBe(code);

  const other = await person(t);
  await expect(
    t.mutation(api.rota.ensureJoinLink, {
      sessionToken: other.token,
      inviteCode: s.inviteCode,
    }),
  ).rejects.toThrow();
});

test("people shows who joined, stopped or was silenced, with the phone the organizer typed", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const joined = participantId(await add(t, s, { phone: "+971505550001" }));
  const stopped = participantId(await add(t, s, { phone: "+971505550002" }));
  const silenced = participantId(await add(t, s, { phone: "+971505550003" }));
  await add(t, s, { phone: "+971505550004" });
  await t.run(async (ctx) => {
    await ctx.db.patch(joined, { joinedAt: NOW });
    await ctx.db.patch(stopped, {
      joinedAt: NOW,
      stoppedAt: NOW,
    });
    await ctx.db.patch(silenced, {
      joinedAt: NOW,
      silencedAt: NOW,
    });
  });
  const view = await people(t, s);
  const state = (p: {
    joined: boolean;
    stopped: boolean;
    silenced: boolean;
  }) => [p.joined, p.stopped, p.silenced];
  expect(view?.participants.map((p) => state(p))).toEqual([
    [false, false, false], // the organizer
    [true, false, false],
    [true, true, false],
    [true, false, true],
    [false, false, false],
  ]);
  expect(view?.participants[1]?.phone).toBe("+971505550001");
  expect(view?.rows[2]?.participant).toMatchObject({
    phone: "+971505550002",
    joined: true,
    stopped: true,
    silenced: false,
  });
});

test("people lists the open join requests, oldest first, with the number masked", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const second = await request(t, s, {
    phone: "+971502223344",
    profileName: null,
    createdAt: NOW - 500,
  });
  const first = await request(t, s);
  const done = await request(t, s, { phone: "+971503334455" });
  await t.run((ctx) =>
    ctx.db.patch(done, { resolvedAt: NOW, outcome: "declined" }),
  );
  const view = await people(t, s);
  expect(view?.requests).toEqual([
    {
      id: first,
      name: "خالد",
      phoneMasked: "+971 50 ••• 2233",
      createdAt: NOW - 1000,
    },
    {
      id: second,
      name: null,
      phoneMasked: "+971 50 ••• 3344",
      createdAt: NOW - 500,
    },
  ]);
  expect(JSON.stringify(view?.requests)).not.toContain("1112233");
});

test("accepting a request places the person on that juz' as joined and closes the request", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const id = await request(t, s);
  const res = await accept(t, s, id, 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));

  const row = await participantRow(t, res.participantId);
  expect(row).toMatchObject({
    name: "خالد",
    phone: "+971501112233",
    personId: null,
    removedAt: null,
    joinedAt: expect.any(Number),
  });
  const slot = await t.run((ctx) =>
    ctx.db
      .query("rotaSlots")
      .withIndex("by_participant", (q) =>
        q.eq("participantId", res.participantId),
      )
      .unique(),
  );
  expect(slot?.slot).toBe(slotFor(7, 1));
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    resolvedAt: expect.any(Number),
    outcome: "accepted",
  });
  const view = await people(t, s);
  expect(view?.requests).toEqual([]);
  expect(view?.rows[6]?.participant).toMatchObject({
    name: "خالد",
    joined: true,
  });
});

test("an accepted person with no profile name is «مشارك جديد», and is linked to their Wirdak account", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const member = await t.run((ctx) =>
    ctx.db.insert("people", {
      phone: "+971502223344",
      displayName: "ضيف",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
    }),
  );
  const id = await request(t, s, { phone: "+971502223344", profileName: null });
  const res = await accept(t, s, id, 3);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));
  expect(await participantRow(t, res.participantId)).toMatchObject({
    name: "مشارك جديد",
    personId: member,
  });
});

test("accepting queues one welcome for the new member, with no day", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const id = await request(t, s);
  const res = await accept(t, s, id, 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));
  const outbox = await t.run((ctx) => ctx.db.query("rotaOutbox").collect());
  expect(outbox).toHaveLength(1);
  expect(outbox[0]).toMatchObject({
    participantId: res.participantId,
    kind: "welcome",
    dayId: null,
    juz: [],
    sentAt: null,
    skippedAt: null,
  });
});

/** A day dated today (NOW is 11:00 in Dubai), with nobody on any juz'. */
async function openDay(t: T, s: Setup) {
  const khatma = await khatmaOf(t, s);
  return await t.run(async (ctx) => {
    const dayId = await ctx.db.insert("rotaDays", {
      khatmaId: khatma._id,
      n: 1,
      number: 1,
      cycle: 1,
      date: "2027-01-15",
      startedAt: NOW - 3_600_000,
      closesAt: NOW + 3_600_000,
      completedAt: null,
      closedAt: null,
      unreadSentAt: null,
      summarySentAt: null,
    });
    for (let juz = 1; juz <= 30; juz++) {
      await ctx.db.insert("rotaReads", {
        dayId,
        khatmaId: khatma._id,
        juz,
        slot: slotFor(juz, 1),
        holderId: null,
        readerId: null,
        doneAt: null,
        doneByOrganizer: false,
        reassignedAt: null,
      });
    }
    return dayId;
  });
}

const contactedAt = (t: T, lastInboundAt: number) =>
  t.run((ctx) =>
    ctx.db.insert("waContacts", { phone: "+971501112233", lastInboundAt }),
  );

test("someone accepted during a day takes today's free juz', when the welcome can say so", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const dayId = await openDay(t, s);
  await contactedAt(t, NOW - 1000);
  const res = await accept(t, s, await request(t, s), 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));

  const reads = await t.run((ctx) =>
    ctx.db
      .query("rotaReads")
      .withIndex("by_reader_day", (q) =>
        q.eq("readerId", res.participantId).eq("dayId", dayId),
      )
      .collect(),
  );
  expect(reads).toHaveLength(1);
  expect(reads[0]?.holderId).toBe(res.participantId);
});

test("someone accepted outside their 24-hour window takes nothing today: no welcome could tell them", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const dayId = await openDay(t, s);
  await contactedAt(t, NOW - 25 * 3_600_000);
  const res = await accept(t, s, await request(t, s), 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));

  const taken = await t.run((ctx) =>
    ctx.db
      .query("rotaReads")
      .withIndex("by_reader_day", (q) =>
        q.eq("readerId", res.participantId).eq("dayId", dayId),
      )
      .collect(),
  );
  expect(taken).toEqual([]);
});

test("with assignments held for quiet hours, someone accepted at night takes nothing today: the welcome waits for morning", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "rotaAssignDuringQuiet",
      value: false,
      updatedAt: 0,
    }),
  );
  const dayId = await openDay(t, s);
  // 23:00 in Dubai
  const night = Date.UTC(2027, 0, 15, 19, 0, 0);
  vi.setSystemTime(night);
  await contactedAt(t, night - 1000);
  const res = await accept(t, s, await request(t, s), 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));

  const taken = await t.run((ctx) =>
    ctx.db
      .query("rotaReads")
      .withIndex("by_reader_day", (q) =>
        q.eq("readerId", res.participantId).eq("dayId", dayId),
      )
      .collect(),
  );
  expect(taken).toEqual([]);
});

test("a name typed on a request for a number added meanwhile still applies", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const first = await accept(t, s, await request(t, s), 7);
  if (!("participantId" in first)) throw new Error(JSON.stringify(first));
  const second = await request(t, s);

  expect(
    await t.mutation(api.rota.acceptJoinRequest, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      requestId: second,
      juz: 8,
      name: "أبو خالد",
    }),
  ).toEqual({ error: "already_added" });

  expect((await participantRow(t, first.participantId))?.name).toBe("أبو خالد");
});

test("the organizer can give an accepted person another name", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const id = await request(t, s);
  const res = await t.mutation(api.rota.acceptJoinRequest, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    requestId: id,
    juz: 7,
    name: "  خالد الأحمد ",
  });
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));
  expect((await participantRow(t, res.participantId))?.name).toBe(
    "خالد الأحمد",
  );
});

test("an accept with an empty name is refused and leaves the request open", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const id = await request(t, s);
  expect(
    await t.mutation(api.rota.acceptJoinRequest, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      requestId: id,
      juz: 7,
      name: "   ",
    }),
  ).toEqual({ error: "bad_name" });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.resolvedAt).toBeNull();
});

const rename = (t: T, s: Setup, id: Id<"rotaParticipants">, name: string) =>
  t.mutation(api.rota.renameParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: id,
    name,
  });

test("the organizer can rename anyone, and the saved list follows", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const res = await accept(t, s, await request(t, s), 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));

  expect(await rename(t, s, res.participantId, " أبو خالد ")).toEqual({
    ok: true,
  });

  expect((await participantRow(t, res.participantId))?.name).toBe("أبو خالد");
  const contacts = await t.run((ctx) => ctx.db.query("rotaContacts").collect());
  expect(contacts.map((c) => c.name)).toEqual(["أبو خالد"]);
});

test("renaming refuses an empty name and leaves a removed saved contact removed", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const res = await accept(t, s, await request(t, s), 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));
  expect(await rename(t, s, res.participantId, "   ")).toEqual({
    error: "bad_name",
  });
  expect((await participantRow(t, res.participantId))?.name).toBe("خالد");

  await t.run(async (ctx) => {
    const contact = await ctx.db.query("rotaContacts").first();
    await ctx.db.patch(contact!._id, { removedAt: 1 });
  });
  await rename(t, s, res.participantId, "أبو خالد");
  const contact = await t.run((ctx) => ctx.db.query("rotaContacts").first());
  expect(contact).toMatchObject({ name: "خالد", removedAt: 1 });
});

test("a removed row for the number doesn't stop a live row for the person following a rename", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const res = await accept(t, s, await request(t, s), 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));
  const khatma = await khatmaOf(t, s);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone: "+971501112233",
      displayName: "خالد",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    });
    await ctx.db.patch(res.participantId, { personId: id });
    const typed = await ctx.db.query("rotaContacts").first();
    await ctx.db.patch(typed!._id, { removedAt: 1 });
    await ctx.db.insert("rotaContacts", {
      ownerPersonId: khatma.creatorPersonId,
      name: "خالد",
      phone: null,
      personId: id,
      createdAt: 2,
    });
    return id;
  });

  await rename(t, s, res.participantId, "أبو خالد");

  const contacts = await t.run((ctx) => ctx.db.query("rotaContacts").collect());
  expect(contacts.find((c) => c.personId === personId)?.name).toBe("أبو خالد");
});

test("an archived khatma's people can't be renamed", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const res = await accept(t, s, await request(t, s), 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));
  const khatma = await khatmaOf(t, s);
  await t.run((ctx) =>
    ctx.db.patch(khatma._id, { rota: { ...khatma.rota!, archivedAt: 1 } }),
  );
  await expect(rename(t, s, res.participantId, "أبو خالد")).rejects.toThrow();
  expect((await participantRow(t, res.participantId))?.name).toBe("خالد");
});

test("someone removed from the khatma can't be renamed", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const res = await accept(t, s, await request(t, s), 7);
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));
  await t.run((ctx) => ctx.db.patch(res.participantId, { removedAt: 1 }));
  expect(await rename(t, s, res.participantId, "أبو خالد")).toEqual({
    error: "not_found",
  });
});

test("a refused accept queues no welcome", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const id = await request(t, s);
  await accept(t, s, id, 1);
  expect(await t.run((ctx) => ctx.db.query("rotaOutbox").collect())).toEqual(
    [],
  );
});

test("accepting refuses a held juz', keeping the request open", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const id = await request(t, s);
  expect(await accept(t, s, id, 1)).toEqual({ error: "juz_taken" });
  expect((await people(t, s))?.requests).toHaveLength(1);
  await expect(accept(t, s, id, 31)).rejects.toThrow();
});

test("accepting a request that is gone, resolved or another khatma's is not_found", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const other = await setup(t);
  const resolved = await request(t, s);
  await t.run((ctx) =>
    ctx.db.patch(resolved, { resolvedAt: NOW, outcome: "declined" }),
  );
  const foreign = await request(t, other);
  expect(await accept(t, s, resolved, 5)).toEqual({ error: "not_found" });
  expect(await accept(t, s, foreign, 5)).toEqual({ error: "not_found" });
  expect(
    await t.mutation(api.rota.declineJoinRequest, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      requestId: foreign,
    }),
  ).toEqual({ error: "not_found" });
  expect((await people(t, other))?.requests).toHaveLength(1);
});

test("accepting a number that became a participant meanwhile closes the request and counts it as joined", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const added = participantId(await add(t, s, { phone: "+971501112233" }));
  const id = await request(t, s);
  expect(await accept(t, s, id, 9)).toEqual({ error: "already_added" });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    resolvedAt: expect.any(Number),
    outcome: "accepted",
  });
  expect(await participantRow(t, added)).toMatchObject({
    joinedAt: expect.any(Number),
  });
  const view = await people(t, s);
  expect(view?.participants).toHaveLength(2);
  expect(view?.requests).toEqual([]);
  // they asked to hear from the khatma, so they get the welcome too
  const outbox = await t.run((ctx) => ctx.db.query("rotaOutbox").collect());
  expect(outbox.map((r) => [r.participantId, r.kind])).toEqual([
    [added, "welcome"],
  ]);
});

test("accepting a request from a number that sent «إيقاف» after asking is not_found and adds nobody", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const other = await setup(t);
  // listed in another khatma, where they stopped the messages after asking here
  const theirs = participantId(await add(t, other, { phone: "+971501112233" }));
  const id = await request(t, s);
  await t.run((ctx) => ctx.db.patch(theirs, { stoppedAt: NOW - 10 }));
  expect(await accept(t, s, id, 9)).toEqual({ error: "not_found" });
  expect((await people(t, s))?.participants).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("rotaOutbox").collect())).toEqual(
    [],
  );
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    outcome: "declined",
  });

  // A join request sent after the stop is a new opt-in, and can be accepted.
  const later = await request(t, s, { createdAt: NOW - 5 });
  expect(await accept(t, s, later, 9)).toMatchObject({ ok: true });
});

test("declining closes the request without adding anyone", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const id = await request(t, s);
  const decline = () =>
    t.mutation(api.rota.declineJoinRequest, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      requestId: id,
    });
  expect(await decline()).toEqual({ ok: true });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    resolvedAt: expect.any(Number),
    outcome: "declined",
    declinedBy: "organizer",
  });
  expect((await people(t, s))?.participants).toHaveLength(1);
  expect(await decline()).toEqual({ error: "not_found" });
});

test("only the organizer answers a join request", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const id = await request(t, s);
  const stranger = await person(t);
  await expect(accept(t, s, id, 5, stranger.token)).rejects.toThrow();
  await expect(
    t.mutation(api.rota.declineJoinRequest, {
      sessionToken: stranger.token,
      inviteCode: s.inviteCode,
      requestId: id,
    }),
  ).rejects.toThrow();
  expect((await people(t, s))?.requests).toHaveLength(1);
});

test("people says which participants have signed in, by account or by the number", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const byAccount = await add(t, s, { phone: "+971505550101" });
  await add(t, s, { phone: "+971505550102" });
  await add(t, s, { phone: "+971505550103" }); // a placeholder an admin made
  await add(t, s, { phone: "+971505550104" }); // no person at all
  await t.run(async (ctx) => {
    const insert = (phone: string, verifiedAt: number) =>
      ctx.db.insert("people", {
        phone,
        displayName: phone,
        verifiedAt,
        timeZone: "Asia/Dubai",
        lastSeenAt: NOW,
      });
    const account = await insert("+971505550101", NOW);
    await ctx.db.patch(participantId(byAccount), { personId: account });
    await insert("+971505550102", NOW);
    await insert("+971505550103", 0);
  });
  const view = await people(t, s);
  expect(view?.participants.map((p) => p.hasAccount)).toEqual([
    false, // the organizer's fixture person never signed in
    true,
    true,
    false,
    false,
  ]);
  expect(view?.rows[1]?.participant?.hasAccount).toBe(true);
});

// ---------------------------------------------------------------------------
// Adding a second reader

/** Gives every free juz' of khatma 1 a reader (the organizer holds juz' 1), but `except`. */
async function fillAll(t: T, s: Setup, except: number[] = []) {
  const ids = new Map<number, Id<"rotaParticipants">>();
  for (let juz = 2; juz <= 30; juz++) {
    if (except.includes(juz)) continue;
    ids.set(juz, participantId(await add(t, s, { juz })));
  }
  return ids;
}

const share = (
  t: T,
  s: Setup,
  juz: number,
  over: Partial<{ name: string; phone: string }> = {},
) => add(t, s, { juz, share: true, ...over });

const setSetting = (t: T, key: string, value: unknown) =>
  t.run((ctx) => ctx.db.insert("settings", { key, value, updatedAt: 0 }));

test("sharing is refused while any slot is empty", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await fillAll(t, s, [30]);
  expect(await share(t, s, 1)).toEqual({ error: "not_full" });
  const view = await people(t, s);
  expect(view?.participants).toHaveLength(29);
  expect(view?.sharing).toEqual({
    on: true,
    open: false,
    readers: 29,
    shared: 0,
  });
});

test("sharing works once all 30 have a reader", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await fillAll(t, s);
  const added = await share(t, s, 1, { name: "الثاني" });
  expect(added).toMatchObject({ ok: true, juz: 1 });

  const view = await people(t, s);
  expect(view?.rows[0]?.participant).toMatchObject({
    name: "المنظم",
    isMe: true,
  });
  expect(view?.rows[0]?.partner).toMatchObject({
    id: participantId(added),
    name: "الثاني",
    isMe: false,
    slots: 1,
    joined: false,
  });
  expect(view?.rows[1]?.partner).toBeNull();
  expect(view?.freeJuz).toEqual([]);
  expect(view?.participants.at(-1)).toMatchObject({
    name: "الثاني",
    juz: [1],
  });
  expect(view?.sharing).toEqual({
    on: true,
    open: true,
    readers: 31,
    shared: 1,
  });
  expect(await slotRowsOf(t, s, 1)).toEqual([
    { participantId: view?.rows[0]?.participant?.id, second: undefined },
    { participantId: participantId(added), second: true },
  ]);
});

test("a juz' takes no third reader", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await fillAll(t, s);
  expect(await share(t, s, 4)).toMatchObject({ ok: true });
  expect(await share(t, s, 4)).toEqual({ error: "already_shared" });
  expect((await people(t, s))?.participants).toHaveLength(31);
});

test("someone already in the khatma can't become a second reader", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await fillAll(t, s, [2]);
  await add(t, s, { juz: 2, phone: "+971505559001" });
  expect(await share(t, s, 5, { phone: "+971505559001" })).toEqual({
    error: "already_added",
  });
  expect(await slotRowsOf(t, s, 5)).toHaveLength(1);
});

test("rotaSharedSlotsOn off refuses sharing, and shared slots carry on", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await fillAll(t, s);
  const b = participantId(await share(t, s, 3));
  await setSetting(t, "rotaSharedSlotsOn", false);
  expect(await share(t, s, 4)).toEqual({ error: "sharing_off" });
  const view = await people(t, s);
  expect(view?.rows[2]?.partner?.id).toBe(b);
  expect(view?.sharing).toEqual({
    on: false,
    open: false,
    readers: 31,
    shared: 1,
  });
});

test("a slot that empties keeps existing shares and blocks new ones", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const ids = await fillAll(t, s);
  const b = participantId(await share(t, s, 3));
  expect(
    await t.mutation(api.rota.freeJuz, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      participantId: ids.get(30)!,
      juz: 30,
    }),
  ).toEqual({ ok: true });
  const view = await people(t, s);
  expect(view?.freeJuz).toEqual([30]);
  expect(view?.rows[2]?.partner?.id).toBe(b);
  expect(view?.sharing.open).toBe(false);
  expect(await share(t, s, 4)).toEqual({ error: "not_full" });
});

test("a khatma holds 60 readers", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await fillAll(t, s);
  for (let juz = 1; juz <= 30; juz++) {
    expect(await share(t, s, juz)).toMatchObject({ ok: true, juz });
  }
  const view = await people(t, s);
  expect(view?.participants).toHaveLength(60);
  expect(view?.sharing).toEqual({
    on: true,
    open: true,
    readers: 60,
    shared: 30,
  });
  expect(view?.rows.every((r) => r.participant && r.partner)).toBe(true);

  const khatmaId = await khatmaIdOf(t, s);
  const placed = await t.run(async (ctx) =>
    placeNewParticipant(
      ctx,
      (await ctx.db.get(khatmaId))!,
      { name: "الحادي والستون", phone: "+971505559061", personId: null },
      undefined,
      { mode: "fill" },
    ),
  );
  expect(placed).toEqual({ error: "no_free_juz" });
});

test("a join request can be accepted onto a shared slot", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const ids = await fillAll(t, s, [30]);
  const id = await request(t, s);
  const acceptShared = () =>
    t.mutation(api.rota.acceptJoinRequest, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      requestId: id,
      juz: 3,
      share: true,
    });

  expect(await acceptShared()).toEqual({ error: "not_full" });
  expect((await people(t, s))?.requests).toHaveLength(1);

  await add(t, s, { juz: 30 });
  const res = await acceptShared();
  expect(res).toMatchObject({ ok: true });
  const view = await people(t, s);
  expect(view?.requests).toEqual([]);
  expect(view?.rows[2]?.participant?.id).toBe(ids.get(3));
  expect(view?.rows[2]?.partner).toMatchObject({
    name: "خالد",
    joined: true,
  });
});

test("a co-organizer needs People to share", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const co = await person(t);
  const coPhone = (await t.run((ctx) => ctx.db.get(co.personId)))!.phone;
  const coP = participantId(await add(t, s, { juz: 2, phone: coPhone }));
  await fillAll(t, s, [2]);
  const setPeople = async (people: boolean) => {
    const list = await t.query(api.coOrganizers.list, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
    });
    const coOrganizerId =
      "coOrganizers" in list ? list.coOrganizers[0]?.coOrganizerId : undefined;
    await t.mutation(api.coOrganizers.set, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      ...(coOrganizerId ? { coOrganizerId } : { candidateId: `p:${coP}` }),
      readings: true,
      people,
      settings: true,
    });
  };
  const coShare = () =>
    t.mutation(api.rota.addParticipant, {
      sessionToken: co.token,
      inviteCode: s.inviteCode,
      name: "الثاني",
      phone: "+971505559002",
      juz: 5,
      share: true,
    });

  await setPeople(false);
  await expect(coShare()).rejects.toThrow(/forbidden/);
  await setPeople(true);
  expect(await coShare()).toMatchObject({ ok: true, juz: 5 });
  expect((await people(t, s))?.rows[4]?.partner?.name).toBe("الثاني");
});

/**
 * A co-organizer with People on juz' 2 of a khatma whose 30 ajza' all have a
 * reader; the owner reads juz' 1.
 */
async function fullWithCoOrganizer(t: T) {
  const s = await setup(t);
  const co = await person(t);
  const coPhone = (await t.run((ctx) => ctx.db.get(co.personId)))!.phone;
  const coP = participantId(await add(t, s, { juz: 2, phone: coPhone }));
  const ids = await fillAll(t, s, [2]);
  await t.mutation(api.coOrganizers.set, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    candidateId: `p:${coP}`,
    readings: true,
    people: true,
    settings: true,
  });
  const coSaved = (name: string, phone: string) =>
    t.run((ctx) =>
      ctx.db.insert("rotaContacts", {
        ownerPersonId: co.personId,
        name,
        phone,
        personId: null,
        createdAt: NOW,
      }),
    );
  return { s, co, coP, ids, coSaved };
}

test("a co-organizer can't add a second reader to the owner's juz' or a co-organizer's", async () => {
  const t = convexTest(schema, modules);
  const { s, co } = await fullWithCoOrganizer(t);
  const coShare = (juz: number, phone: string) =>
    t.mutation(api.rota.addParticipant, {
      sessionToken: co.token,
      inviteCode: s.inviteCode,
      name: "الثاني",
      phone,
      juz,
      share: true,
    });

  expect(await coShare(1, "+971505559101")).toEqual({ error: "is_organizer" });
  expect(await coShare(2, "+971505559102")).toEqual({ error: "is_organizer" });
  let view = await people(t, s);
  expect(view?.rows[0]?.partner).toBeNull();
  expect(view?.rows[1]?.partner).toBeNull();
  expect(view?.participants).toHaveLength(30);

  // Anyone else's juz' they may share, and the owner may share theirs.
  expect(await coShare(3, "+971505559103")).toMatchObject({ ok: true });
  expect(await share(t, s, 2)).toMatchObject({ ok: true, juz: 2 });
  view = await people(t, s);
  expect(view?.rows[1]?.partner).not.toBeNull();
  expect(view?.rows[2]?.partner).not.toBeNull();
});

test("a co-organizer's saved contact or join request can't share the owner's juz'", async () => {
  const t = convexTest(schema, modules);
  const { s, co, coSaved } = await fullWithCoOrganizer(t);
  const contactId = await coSaved("محفوظ", "+971505559111");
  expect(
    await t.mutation(api.rota.addSaved, {
      sessionToken: co.token,
      inviteCode: s.inviteCode,
      contactId,
      juz: 1,
      share: true,
    }),
  ).toEqual({ error: "is_organizer" });

  const requestId = await request(t, s);
  expect(
    await t.mutation(api.rota.acceptJoinRequest, {
      sessionToken: co.token,
      inviteCode: s.inviteCode,
      requestId,
      juz: 2,
      share: true,
    }),
  ).toEqual({ error: "is_organizer" });
  const view = await people(t, s);
  expect(view?.requests).toHaveLength(1);
  expect(view?.rows.every((r) => r.partner === null)).toBe(true);
});

test("a co-organizer's batch of saved people passes over the ajza' of those running the khatma", async () => {
  const t = convexTest(schema, modules);
  const { s, co, coSaved } = await fullWithCoOrganizer(t);
  const contactIds = [
    await coSaved("أول", "+971505559121"),
    await coSaved("ثانٍ", "+971505559122"),
  ];
  expect(
    await t.mutation(api.rota.addSavedMany, {
      sessionToken: co.token,
      inviteCode: s.inviteCode,
      contactIds,
    }),
  ).toMatchObject({ ok: true, added: 2, noRoom: 0 });
  const view = await people(t, s);
  expect(view?.rows.map((r) => r.partner?.name ?? null).slice(0, 5)).toEqual([
    null,
    null,
    "أول",
    "ثانٍ",
    null,
  ]);
});
