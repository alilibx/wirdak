import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { slotFor } from "./lib/rota";
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
  over: Partial<{ name: string; phone: string; juz: number }> = {},
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
  expect(await add(t, s, { phone: "0505550002" })).toEqual({
    error: "bad_phone",
  });
  expect(await add(t, s, { name: "  " })).toEqual({ error: "bad_name" });
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

test("someone accepted in quiet hours takes nothing today: the welcome waits for morning", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
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
