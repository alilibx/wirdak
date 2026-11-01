import { convexTest, type TestConvexForDataModel } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import * as adminRotaModule from "./adminRota";
import { ADMIN_SESSION_TTL_MS } from "./lib/adminSession";
import { sha256Hex } from "./lib/crypto";
import { DEFAULT_GRACE } from "./lib/grace";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2027-01-15 11:00 in Asia/Dubai (a Friday).
const NOW = Date.UTC(2027, 0, 15, 7, 0, 0);
const ORGANIZER_PHONE = "+971500009000";
const adminToken = "admin-token";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("WHATSAPP_PUBLIC_NUMBER", "971500000000");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type T = TestConvexForDataModel<DataModel>;

async function admin(t: T) {
  const tokenHash = await sha256Hex(adminToken);
  await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("admins", {
      phone: "+971500000099",
      addedBy: null,
      addedAt: 0,
    });
    await ctx.db.insert("adminSessions", {
      adminId,
      tokenHash,
      alertTokenHash: tokenHash,
      deviceLabel: "x",
      createdAt: NOW,
      expiresAt: NOW + ADMIN_SESSION_TTL_MS,
    });
  });
}

const details = {
  organizerName: "أم خالد",
  organizerPhone: ORGANIZER_PHONE,
  name: "ختمة العائلة",
  days: { kind: "daily" as const },
  firstDate: "2027-01-16",
  endDate: null,
};

const create = (t: T, over: Partial<typeof details> = {}) =>
  t.action(api.adminRota.create, { adminToken, ...details, ...over });

/** A rota khatma an admin set up, with its setup finished and one reader on juz' 8. */
async function running(t: T, over: Partial<typeof details> = {}) {
  await admin(t);
  const { khatmaId } = await create(t, over);
  await t.mutation(api.adminRota.finishSetup, { adminToken, khatmaId });
  const added = await t.mutation(api.adminRota.addParticipant, {
    adminToken,
    khatmaId,
    name: "قارئ",
    phone: "+971500009001",
    juz: 8,
  });
  if (!("participantId" in added)) throw new Error(JSON.stringify(added));
  return { khatmaId, readerId: added.participantId };
}

async function poolKhatma(t: T): Promise<Id<"khatmas">> {
  return t.run(async (ctx) => {
    const creatorPersonId = await ctx.db.insert("people", {
      phone: "+971500009100",
      displayName: "سارة",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    });
    return ctx.db.insert("khatmas", {
      name: "ختمة",
      schedule: "none",
      grace: DEFAULT_GRACE.none,
      creatorPersonId,
      inviteCode: "pool-code",
      completedRounds: 0,
      createdAt: 0,
    });
  });
}

const auditRows = (t: T) =>
  t.run((ctx) => ctx.db.query("auditLog").withIndex("by_at").collect());

async function codeOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ConvexError) {
      return (error.data as { code?: unknown }).code;
    }
    throw error;
  }
  return "no error";
}

test("create makes the person, and leaves the khatma waiting for them", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId, inviteCode } = await create(t);

  const state = await t.run(async (ctx) => ({
    khatma: await ctx.db.get(khatmaId),
    person: await ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", ORGANIZER_PHONE))
      .first(),
    members: await ctx.db
      .query("members")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .collect(),
    participants: await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .collect(),
    slots: await ctx.db
      .query("rotaSlots")
      .withIndex("by_khatma_slot", (q) => q.eq("khatmaId", khatmaId))
      .collect(),
  }));

  expect(state.person).toMatchObject({
    displayName: "أم خالد",
    verifiedAt: 0,
    timeZone: "Asia/Dubai",
    lastSeenAt: 0,
  });
  expect(state.person?.rotaAllowed).toBeUndefined();
  expect(state.khatma).toMatchObject({
    inviteCode,
    kind: "rota",
    name: "ختمة العائلة",
    creatorPersonId: state.person?._id,
    rota: {
      pendingOrganizer: true,
      setupDoneAt: null,
      firstDate: "2027-01-16",
    },
  });
  expect(state.khatma?.joinCode).toBeDefined();
  expect(state.members).toEqual([]);
  expect(state.participants).toHaveLength(1);
  expect(state.participants[0]).toMatchObject({
    name: "أم خالد",
    phone: ORGANIZER_PHONE,
    personId: state.person?._id,
  });
  expect(state.slots).toHaveLength(1);
  expect(state.slots[0]).toMatchObject({
    slot: 1,
    participantId: state.participants[0]?._id,
  });

  const rows = await auditRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: "rota.adminCreate",
    targetKind: "khatma",
    targetId: khatmaId,
    adminPhone: "+971500000099",
  });
});

test("create finds the person by their number, and doesn't ask for the switch", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const personId = await t.run((ctx) =>
    ctx.db.insert("people", {
      phone: ORGANIZER_PHONE,
      displayName: "اسمها في حسابها",
      verifiedAt: 5,
      timeZone: "Asia/Riyadh",
      lastSeenAt: 7,
    }),
  );
  const { khatmaId } = await create(t, { organizerPhone: "00971500009000" });

  const state = await t.run(async (ctx) => ({
    khatma: await ctx.db.get(khatmaId),
    people: await ctx.db.query("people").collect(),
    participants: await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .collect(),
  }));
  expect(state.people.map((p) => p._id)).toEqual([personId]);
  expect(state.khatma?.creatorPersonId).toBe(personId);
  expect(state.khatma?.rota?.timeZone).toBe("Asia/Riyadh");
  expect(state.participants[0]?.name).toBe("اسمها في حسابها");
});

test("create applies the cap, and khatmas still waiting for the organizer count", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  await create(t);
  await create(t);
  expect(await codeOf(create(t))).toBe("rota_cap");
  // Refused whole: nothing but the two khatmas' audit rows.
  expect(await auditRows(t)).toHaveLength(2);
});

test("khatmas waiting for someone count against the ones they create themselves", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const sessionToken = "organizer-session";
  const tokenHash = await sha256Hex(sessionToken);
  await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone: ORGANIZER_PHONE,
      displayName: "أم خالد",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
      rotaAllowed: true,
    });
    await ctx.db.insert("sessions", {
      personId,
      tokenHash,
      alertTokenHash: "alert",
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
  });
  await create(t);
  await create(t);
  expect(
    await codeOf(
      t.action(api.rota.create, {
        sessionToken,
        name: "ختمتي",
        days: { kind: "daily" },
        firstDate: "2027-01-16",
        endDate: null,
      }),
    ),
  ).toBe("rota_cap");
});

test("create doesn't count against the organizer's own daily limit", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      key: "createsPerPersonPerDay",
      value: 1,
      updatedAt: NOW,
    });
    await ctx.db.insert("settings", {
      key: "rotaMaxActivePerOrganizer",
      value: 5,
      updatedAt: NOW,
    });
  });
  await create(t);
  await create(t);
  await create(t);
  expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toEqual(
    [],
  );

  // The person's own creates are untouched: their one a day is still free.
  const sessionToken = "organizer-session";
  await t.run(async (ctx) => {
    const person = await ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", ORGANIZER_PHONE))
      .first();
    await ctx.db.patch(person!._id, { rotaAllowed: true });
    await ctx.db.insert("sessions", {
      personId: person!._id,
      tokenHash: await sha256Hex(sessionToken),
      alertTokenHash: "alert",
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
  });
  const own = () =>
    t.action(api.rota.create, {
      sessionToken,
      name: "ختمتي",
      days: { kind: "daily" },
      firstDate: "2027-01-16",
      endDate: null,
    });
  expect(await own()).toHaveProperty("inviteCode");
  expect(await codeOf(own())).toBe("rate_limited");
});

test("create refuses a blocked number, and makes nothing", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  await t.run(async (ctx) => {
    const adminRow = await ctx.db.query("admins").first();
    await ctx.db.insert("blockedPhones", {
      phone: ORGANIZER_PHONE,
      blockedBy: adminRow!._id,
      at: 0,
      note: null,
    });
  });
  expect(await codeOf(create(t))).toBe("blocked");
  expect(await t.run((ctx) => ctx.db.query("khatmas").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("people").collect())).toHaveLength(
    0,
  );
  expect(await auditRows(t)).toEqual([]);
});

test("create refuses a bad name, number or dates, and anyone but an admin", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  expect(await codeOf(create(t, { name: "  " }))).toBe("invalid_name");
  expect(await codeOf(create(t, { organizerName: "  " }))).toBe("bad_name");
  expect(await codeOf(create(t, { organizerPhone: "050" }))).toBe("bad_phone");
  expect(await codeOf(create(t, { firstDate: "2027-01-01" }))).toBe(
    "invalid_dates",
  );
  expect(
    await codeOf(
      t.action(api.adminRota.create, { ...details, adminToken: "nope" }),
    ),
  ).toBe("not_admin");
  expect(
    await t.run(async (ctx) => (await ctx.db.query("people").collect()).length),
  ).toBe(0);
});

test("a change writes one audit row naming it, and a refused one writes none", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readerId } = await running(t);
  const before = (await auditRows(t)).length;

  expect(
    await t.mutation(api.adminRota.giveJuz, {
      adminToken,
      khatmaId,
      participantId: readerId,
      juz: 9,
    }),
  ).toEqual({ ok: true });
  const view = await t.query(api.adminRota.people, { adminToken, khatmaId });
  expect(view?.rows[8]?.participant?.id).toBe(readerId);

  const rows = await auditRows(t);
  expect(rows).toHaveLength(before + 1);
  expect(rows.at(-1)).toMatchObject({
    action: "rota.adminChange",
    targetKind: "khatma",
    targetId: khatmaId,
    note: "giveJuz",
    after: { participantId: readerId, juz: 9 },
  });

  expect(
    await t.mutation(api.adminRota.giveJuz, {
      adminToken,
      khatmaId,
      participantId: readerId,
      juz: 9,
    }),
  ).toEqual({ error: "juz_taken" });
  expect(await auditRows(t)).toHaveLength(before + 1);
});

test("nobody but an admin reaches them", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const args = { adminToken: "nope", khatmaId };
  expect(await codeOf(t.query(api.adminRota.people, args))).toBe("not_admin");
  expect(
    await codeOf(
      t.mutation(api.adminRota.setPaused, {
        ...args,
        paused: true,
      }),
    ),
  ).toBe("not_admin");
});

test("a pool khatma is refused", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const khatmaId = await poolKhatma(t);
  const args = { adminToken, khatmaId };
  expect(await t.query(api.adminRota.people, args)).toBeNull();
  expect(await t.query(api.adminRota.today, args)).toBeNull();
  expect(await t.query(api.adminRota.settings, args)).toBeNull();
  expect(await t.query(api.adminRota.saved, args)).toBeNull();
  expect(
    await codeOf(
      t.mutation(api.adminRota.setPaused, { ...args, paused: true }),
    ),
  ).toBe("not_found");
  expect(await codeOf(t.mutation(api.adminRota.archive, args))).toBe(
    "not_found",
  );
  expect(await codeOf(t.mutation(api.adminRota.remove, args))).toBe(
    "not_found",
  );
  expect(await auditRows(t)).toEqual([]);
});

test("an archived khatma refuses every change but archive and remove", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const args = { adminToken, khatmaId };

  expect(await t.mutation(api.adminRota.remove, args)).toEqual({
    error: "not_archived",
  });
  expect(await t.mutation(api.adminRota.archive, args)).toEqual({ ok: true });
  const archived = (await auditRows(t)).length;

  // Archiving again changes nothing, and records nothing.
  expect(await t.mutation(api.adminRota.archive, args)).toEqual({ ok: true });
  expect(await auditRows(t)).toHaveLength(archived);

  expect(
    await codeOf(
      t.mutation(api.adminRota.setPaused, { ...args, paused: true }),
    ),
  ).toBe("archived");
  expect(await codeOf(t.mutation(api.adminRota.finishSetup, args))).toBe(
    "archived",
  );
  expect(await codeOf(t.mutation(api.adminRota.ensureJoinLink, args))).toBe(
    "archived",
  );
  expect(await t.query(api.adminRota.settings, args)).toMatchObject({
    archived: true,
  });

  expect(await t.mutation(api.adminRota.remove, args)).toEqual({ ok: true });
  expect(await t.run((ctx) => ctx.db.get(khatmaId))).toBeNull();
  const rows = await auditRows(t);
  expect(rows).toHaveLength(archived + 1);
  expect(rows.at(-1)).toMatchObject({
    action: "rota.adminChange",
    targetId: khatmaId,
    note: "remove",
  });
});

test("the organizer's row is an ordinary row to an admin, who can't remove it", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const args = { adminToken, khatmaId };
  const people = await t.query(api.adminRota.people, args);
  const organizer = people?.participants.find((p) => p.name === "أم خالد");
  expect(organizer?.isMe).toBe(false);
  expect(organizer?.isOrganizer).toBe(true);
  expect(people?.rows[0]?.participant?.isMe).toBe(false);
  expect(people?.rows[0]?.participant?.isOrganizer).toBe(true);

  const before = (await auditRows(t)).length;
  expect(
    await t.mutation(api.adminRota.removeParticipant, {
      ...args,
      participantId: organizer!.id,
    }),
  ).toEqual({ error: "is_me" });
  expect(await auditRows(t)).toHaveLength(before);
});

test("an admin's rename is audited, and a refused one isn't", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readerId } = await running(t);
  const args = { adminToken, khatmaId, participantId: readerId };
  const before = (await auditRows(t)).length;

  expect(
    await t.mutation(api.adminRota.renameParticipant, { ...args, name: "  " }),
  ).toEqual({ error: "bad_name" });
  expect(await auditRows(t)).toHaveLength(before);

  expect(
    await t.mutation(api.adminRota.renameParticipant, {
      ...args,
      name: "أبو خالد",
    }),
  ).toEqual({ ok: true });
  expect(await auditRows(t)).toHaveLength(before + 1);
  const row = await t.run((ctx) => ctx.db.get(readerId));
  expect(row?.name).toBe("أبو خالد");
});

test("an admin works from the organizer's saved list", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readerId } = await running(t);
  const args = { adminToken, khatmaId };
  await t.mutation(api.adminRota.removeParticipant, {
    ...args,
    participantId: readerId,
  });
  const saved = await t.query(api.adminRota.saved, args);
  expect(saved?.map((c) => [c.name, c.inKhatma])).toEqual([["قارئ", false]]);

  const added = await t.mutation(api.adminRota.addSaved, {
    ...args,
    contactId: saved![0]!.id,
  });
  expect(added).toMatchObject({ ok: true });
});

test("a day runs from the admin's screens: today, a reassign, a mark", async () => {
  const t = convexTest(schema, modules);
  // Today, so the day can start, which the admin's start-tomorrow rule would refuse.
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "rotaStartNextDay",
      value: false,
      updatedAt: NOW,
    }),
  );
  const { khatmaId, readerId } = await running(t, { firstDate: "2027-01-15" });
  const args = { adminToken, khatmaId };
  await t.mutation(internal.rotaDays.tick, { khatmaId });

  const today = await t.query(api.adminRota.today, args);
  const tile = today?.tiles.find((x) => x.juz === 1);
  expect(tile).toBeDefined();
  expect(
    await t.mutation(api.adminRota.reassign, {
      ...args,
      readId: tile!.readId,
      participantId: readerId,
    }),
  ).toEqual({ ok: true });
  expect(
    await t.mutation(api.adminRota.markDone, { ...args, readId: tile!.readId }),
  ).toMatchObject({ ok: true });
  expect(
    await t.mutation(api.adminRota.markNotDone, {
      ...args,
      readId: tile!.readId,
    }),
  ).toEqual({ ok: true });
  const notes = (await auditRows(t)).map((row) => row.note);
  expect(notes.slice(-3)).toEqual(["reassign", "markDone", "markNotDone"]);
});

test("the join link is drawn once, and recorded once", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const args = { adminToken, khatmaId };
  await t.run(async (ctx) => {
    await ctx.db.patch(khatmaId, { joinCode: undefined });
  });
  const before = (await auditRows(t)).length;

  await t.mutation(api.adminRota.ensureJoinLink, args);
  await t.mutation(api.adminRota.ensureJoinLink, args);

  const view = await t.query(api.adminRota.people, args);
  expect(view?.joinLink).toContain("https://wa.me/971500000000");
  expect(await auditRows(t)).toHaveLength(before + 1);
});

test("settings and pause dates go through to the khatma", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const args = { adminToken, khatmaId };
  expect(
    await t.mutation(api.adminRota.update, { ...args, name: "اسم جديد" }),
  ).toEqual({ ok: true });
  expect(
    await t.mutation(api.adminRota.addPauseDate, {
      ...args,
      date: "2027-01-20",
    }),
  ).toEqual({ ok: true });
  expect(
    await t.mutation(api.adminRota.removePauseDate, {
      ...args,
      date: "2027-01-20",
    }),
  ).toEqual({ ok: true });
  expect(
    await t.mutation(api.adminRota.setPaused, { ...args, paused: true }),
  ).toEqual({ ok: true });
  expect(await t.query(api.adminRota.settings, args)).toMatchObject({
    name: "اسم جديد",
    pauseDates: [],
  });
  // The changes keep the khatma waiting for its organizer.
  const khatma = await t.run((ctx) => ctx.db.get(khatmaId));
  expect(khatma?.rota?.pendingOrganizer).toBe(true);
});

test("the admin lookup says who a rota khatma waits for, and its join link", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const k = await t.query(api.adminLookup.khatma, { adminToken, khatmaId });
  expect(k?.rota?.pendingOrganizer).toBe(true);
  expect(k?.rota?.joinLink).toContain("https://wa.me/971500000000");
});

test("a person's view lists the khatma waiting for them", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const personId = await t.run(
    async (ctx) => (await ctx.db.get(khatmaId))!.creatorPersonId,
  );

  const view = await t.query(api.adminLookup.person, { adminToken, personId });

  expect(view?.khatmas).toMatchObject([
    { khatmaId, name: details.name, isOrganizer: true, pending: true },
  ]);
});

test("a person's view lists a khatma they organize once, and not as waiting", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const personId = await t.run(async (ctx) => {
    const khatma = (await ctx.db.get(khatmaId))!;
    await ctx.db.patch(khatmaId, {
      rota: { ...khatma.rota!, pendingOrganizer: false },
    });
    await ctx.db.insert("members", {
      khatmaId,
      personId: khatma.creatorPersonId,
      joinedAt: NOW,
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    return khatma.creatorPersonId;
  });

  const view = await t.query(api.adminLookup.person, { adminToken, personId });

  expect(view?.khatmas).toMatchObject([{ khatmaId, pending: false }]);
});

test("a person's view leaves out an archived khatma that was waiting for them", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const personId = await t.run(
    async (ctx) => (await ctx.db.get(khatmaId))!.creatorPersonId,
  );
  await t.mutation(api.adminRota.archive, { adminToken, khatmaId });

  const view = await t.query(api.adminLookup.person, { adminToken, personId });

  expect(view?.khatmas).toEqual([]);
});

test("the khatma view says whether a pool khatma is archived", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const khatmaId = await poolKhatma(t);
  const view = () => t.query(api.adminLookup.khatma, { adminToken, khatmaId });
  expect((await view())?.archived).toBe(false);
  await t.run((ctx) => ctx.db.patch(khatmaId, { archivedAt: NOW }));
  expect((await view())?.archived).toBe(true);
});

test("accepting a request from a number already added still closes it, and is recorded", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await running(t);
  const requestId = await t.run((ctx) =>
    ctx.db.insert("rotaJoinRequests", {
      khatmaId,
      phone: "+971500009001",
      profileName: "قارئ",
      createdAt: NOW,
      resolvedAt: null,
      outcome: null,
    }),
  );
  const before = (await auditRows(t)).length;

  expect(
    await t.mutation(api.adminRota.acceptJoinRequest, {
      adminToken,
      khatmaId,
      requestId,
      juz: 9,
    }),
  ).toEqual({ error: "already_added" });

  expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
    resolvedAt: expect.any(Number),
    outcome: "accepted",
  });
  const rows = await auditRows(t);
  expect(rows).toHaveLength(before + 1);
  expect(rows.at(-1)).toMatchObject({
    action: "rota.adminChange",
    note: "acceptJoinRequest",
    after: { requestId, juz: 9 },
  });

  // The request is closed now, so asking again does nothing and records nothing.
  expect(
    await t.mutation(api.adminRota.acceptJoinRequest, {
      adminToken,
      khatmaId,
      requestId,
      juz: 9,
    }),
  ).toEqual({ error: "not_found" });
  expect(await auditRows(t)).toHaveLength(before + 1);
});

test("an operation that changes nothing writes no audit row", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readerId } = await running(t);
  const dayRead = await t.run(async (ctx) => {
    const khatma = (await ctx.db.get(khatmaId))!;
    const dayId = await ctx.db.insert("rotaDays", {
      khatmaId,
      n: 1,
      number: 1,
      cycle: 1,
      date: "2027-01-15",
      startedAt: NOW,
      closesAt: NOW + 3_600_000,
      completedAt: null,
      closedAt: null,
      unreadSentAt: null,
      summarySentAt: null,
      reminderSentAt: null,
    });
    await ctx.db.patch(khatmaId, {
      rota: { ...khatma.rota!, firstDate: "2027-01-15" },
    });
    const row = {
      dayId,
      khatmaId,
      holderId: readerId,
      readerId,
      doneByOrganizer: false,
      reassignedAt: null,
    };
    const done = await ctx.db.insert("rotaReads", {
      ...row,
      juz: 8,
      slot: 8,
      doneAt: null,
    });
    const other = await ctx.db.insert("rotaReads", {
      ...row,
      juz: 9,
      slot: 9,
      doneAt: null,
    });
    return { done, other };
  });
  const args = { adminToken, khatmaId };
  const auditCount = async () => (await auditRows(t)).length;
  const date = "2027-01-22";
  const unchanged = async (call: () => Promise<unknown>) => {
    const before = await auditCount();
    await call();
    expect(await auditCount()).toBe(before);
  };
  const changed = async (call: () => Promise<unknown>) => {
    const before = await auditCount();
    await call();
    expect(await auditCount()).toBe(before + 1);
  };

  await unchanged(() => t.mutation(api.adminRota.finishSetup, args));

  await changed(() =>
    t.mutation(api.adminRota.markDone, { ...args, readId: dayRead.done }),
  );
  await unchanged(() =>
    t.mutation(api.adminRota.markDone, { ...args, readId: dayRead.done }),
  );
  await unchanged(() =>
    t.mutation(api.adminRota.markNotDone, { ...args, readId: dayRead.other }),
  );
  await changed(() =>
    t.mutation(api.adminRota.markNotDone, { ...args, readId: dayRead.done }),
  );

  await unchanged(() =>
    t.mutation(api.adminRota.removePauseDate, { ...args, date }),
  );
  await changed(() =>
    t.mutation(api.adminRota.addPauseDate, { ...args, date }),
  );
  await unchanged(() =>
    t.mutation(api.adminRota.addPauseDate, { ...args, date }),
  );
  await changed(() =>
    t.mutation(api.adminRota.removePauseDate, { ...args, date }),
  );

  await unchanged(() =>
    t.mutation(api.adminRota.setPaused, { ...args, paused: false }),
  );
  await changed(() =>
    t.mutation(api.adminRota.setPaused, { ...args, paused: true }),
  );
  await unchanged(() =>
    t.mutation(api.adminRota.setPaused, { ...args, paused: true }),
  );
});

test("every admin rota mutation refuses anyone but an admin, and is on this list", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readerId } = await running(t);
  const ids = await t.run(async (ctx) => {
    const dayId = await ctx.db.insert("rotaDays", {
      khatmaId,
      n: 1,
      number: 1,
      cycle: 1,
      date: "2027-01-16",
      startedAt: NOW,
      closesAt: NOW,
      completedAt: null,
      closedAt: null,
      unreadSentAt: null,
      summarySentAt: null,
      reminderSentAt: null,
    });
    const readId = await ctx.db.insert("rotaReads", {
      dayId,
      khatmaId,
      juz: 8,
      slot: 8,
      holderId: readerId,
      readerId,
      doneAt: null,
      doneByOrganizer: false,
      reassignedAt: null,
    });
    const owner = (await ctx.db.get(khatmaId))!.creatorPersonId;
    const contactId = await ctx.db.insert("rotaContacts", {
      ownerPersonId: owner,
      name: "محفوظ",
      phone: "+971500009002",
      personId: null,
      createdAt: NOW,
    });
    const requestId = await ctx.db.insert("rotaJoinRequests", {
      khatmaId,
      phone: "+971500009003",
      profileName: null,
      createdAt: NOW,
      resolvedAt: null,
      outcome: null,
    });
    return { readId, contactId, requestId };
  });
  const participant = { khatmaId, participantId: readerId };
  const read = { khatmaId, readId: ids.readId };
  const request = { khatmaId, requestId: ids.requestId };
  const date = { khatmaId, date: "2027-01-23" };
  const mutations = {
    finishSetup: () =>
      t.mutation(api.adminRota.finishSetup, { adminToken: "nope", khatmaId }),
    addParticipant: () =>
      t.mutation(api.adminRota.addParticipant, {
        adminToken: "nope",
        khatmaId,
        name: "س",
        phone: "+971500009004",
      }),
    giveJuz: () =>
      t.mutation(api.adminRota.giveJuz, {
        adminToken: "nope",
        ...participant,
        juz: 9,
      }),
    moveJuz: () =>
      t.mutation(api.adminRota.moveJuz, {
        adminToken: "nope",
        ...participant,
        fromJuz: 8,
        toJuz: 9,
      }),
    freeJuz: () =>
      t.mutation(api.adminRota.freeJuz, {
        adminToken: "nope",
        ...participant,
        juz: 8,
      }),
    renameParticipant: () =>
      t.mutation(api.adminRota.renameParticipant, {
        adminToken: "nope",
        ...participant,
        name: "اسم",
      }),
    removeParticipant: () =>
      t.mutation(api.adminRota.removeParticipant, {
        adminToken: "nope",
        ...participant,
      }),
    addSaved: () =>
      t.mutation(api.adminRota.addSaved, {
        adminToken: "nope",
        khatmaId,
        contactId: ids.contactId,
      }),
    ensureJoinLink: () =>
      t.mutation(api.adminRota.ensureJoinLink, {
        adminToken: "nope",
        khatmaId,
      }),
    acceptJoinRequest: () =>
      t.mutation(api.adminRota.acceptJoinRequest, {
        adminToken: "nope",
        ...request,
        juz: 9,
      }),
    declineJoinRequest: () =>
      t.mutation(api.adminRota.declineJoinRequest, {
        adminToken: "nope",
        ...request,
      }),
    reassign: () =>
      t.mutation(api.adminRota.reassign, {
        adminToken: "nope",
        ...read,
        participantId: readerId,
      }),
    markDone: () =>
      t.mutation(api.adminRota.markDone, { adminToken: "nope", ...read }),
    markNotDone: () =>
      t.mutation(api.adminRota.markNotDone, { adminToken: "nope", ...read }),
    update: () =>
      t.mutation(api.adminRota.update, {
        adminToken: "nope",
        khatmaId,
        name: "اسم",
      }),
    setPaused: () =>
      t.mutation(api.adminRota.setPaused, {
        adminToken: "nope",
        khatmaId,
        paused: true,
      }),
    addPauseDate: () =>
      t.mutation(api.adminRota.addPauseDate, { adminToken: "nope", ...date }),
    removePauseDate: () =>
      t.mutation(api.adminRota.removePauseDate, {
        adminToken: "nope",
        ...date,
      }),
    archive: () =>
      t.mutation(api.adminRota.archive, { adminToken: "nope", khatmaId }),
    remove: () =>
      t.mutation(api.adminRota.remove, { adminToken: "nope", khatmaId }),
  };

  // A new public mutation fails here until it joins the table.
  const exported = Object.entries(adminRotaModule)
    .filter(
      ([, fn]) =>
        (fn as { isMutation?: boolean; isPublic?: boolean }).isMutation ===
          true && (fn as { isPublic?: boolean }).isPublic === true,
    )
    .map(([name]) => name)
    .sort();
  expect(Object.keys(mutations).sort()).toEqual(exported);

  const before = await auditRows(t);
  for (const [name, call] of Object.entries(mutations)) {
    expect(await codeOf(call()), name).toBe("not_admin");
  }
  expect(await auditRows(t)).toEqual(before);
});
