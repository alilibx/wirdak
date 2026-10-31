import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { ADMIN_SESSION_TTL_MS } from "./lib/adminSession";
import { sha256Hex } from "./lib/crypto";
import { refreshPhone } from "./lib/directory";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2027-01-15 11:00 in Asia/Dubai (a Friday).
const NOW = Date.UTC(2027, 0, 15, 7, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("WIRDAK_ENV", "dev");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type T = TestConvexForDataModel<DataModel>;

let seq = 0;

async function person(t: T, displayName = "سارة", rotaAllowed = true) {
  seq += 1;
  const token = `token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const phone = `+9715000300${String(seq).padStart(2, "0")}`;
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone,
      displayName,
      verifiedAt: NOW,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
      rotaAllowed,
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
  return { personId, token, phone };
}
type Who = Awaited<ReturnType<typeof person>>;

async function admin(t: T) {
  const token = `admin-${(seq += 1)}`;
  const tokenHash = await sha256Hex(token);
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
  return token;
}

const counts = (t: T, personId: Id<"people">) =>
  t.run(async (ctx) => {
    const p = (await ctx.db.get(personId))!;
    return {
      organizes: p.organizesCount,
      memberOf: p.memberOfCount,
      tab: p.listTab,
      searchName: p.searchName,
    };
  });

const entry = (t: T, phone: string) =>
  t.run((ctx) =>
    ctx.db
      .query("readerDirectory")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first(),
  );

const poolKhatma = (t: T, who: Who) =>
  t.action(api.khatmas.create, {
    sessionToken: who.token,
    name: "ختمة العائلة",
    schedule: "daily",
  });

const rotaKhatma = (t: T, who: Who) =>
  t.action(api.rota.create, {
    sessionToken: who.token,
    name: "ختمة الرّفاق",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
    endDate: null,
  });

let phoneSeq = 0;
async function addReader(
  t: T,
  who: Who,
  inviteCode: string,
  over: Partial<{ name: string; phone: string }> = {},
) {
  phoneSeq += 1;
  const phone = over.phone ?? `+97150777${String(phoneSeq).padStart(4, "0")}`;
  const res = await t.mutation(api.rota.addParticipant, {
    sessionToken: who.token,
    inviteCode,
    name: over.name ?? `قارئ ${phoneSeq}`,
    phone,
  });
  if (!("participantId" in res)) throw new Error(JSON.stringify(res));
  return { phone, participantId: res.participantId };
}

const khatmaId = (t: T, inviteCode: string) =>
  t.run(
    async (ctx) =>
      (await ctx.db
        .query("khatmas")
        .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
        .first())!._id,
  );

test("refreshing a phone with no khatma puts its person in the no-khatma tab", async () => {
  const t = convexTest(schema, modules);
  const who = await person(t, "آمنة");
  await t.run((ctx) => refreshPhone(ctx, who.phone));
  expect(await counts(t, who.personId)).toEqual({
    organizes: 0,
    memberOf: 0,
    tab: "noKhatma",
    searchName: "امنه",
  });
});

test("creating a pool khatma makes someone an organizer and a member", async () => {
  const t = convexTest(schema, modules);
  const who = await person(t);
  await poolKhatma(t, who);
  expect(await counts(t, who.personId)).toMatchObject({
    organizes: 1,
    memberOf: 1,
    tab: "organizers",
  });
  const { searchName } = await t.run(
    async (ctx) => (await ctx.db.query("khatmas").first())!,
  );
  expect(searchName).toBe("ختمه العايله");
});

test("a rota khatma's membership and participant row count as one khatma", async () => {
  const t = convexTest(schema, modules);
  const who = await person(t);
  await rotaKhatma(t, who);
  expect(await counts(t, who.personId)).toMatchObject({
    organizes: 1,
    memberOf: 1,
  });
});

test("taking a juz' joins the members tab, and being removed leaves it", async () => {
  const t = convexTest(schema, modules);
  const owner = await person(t);
  const reader = await person(t, "ليلى");
  const { inviteCode } = await poolKhatma(t, owner);
  await t.mutation(api.pool.take, {
    sessionToken: reader.token,
    inviteCode,
    juz: 1,
  });
  expect(await counts(t, reader.personId)).toMatchObject({
    organizes: 0,
    memberOf: 1,
    tab: "members",
  });

  const memberId = await t.run(
    async (ctx) =>
      (await ctx.db
        .query("members")
        .withIndex("by_person", (q) => q.eq("personId", reader.personId))
        .first())!._id,
  );
  await t.mutation(api.organizer.removeMember, {
    sessionToken: owner.token,
    inviteCode,
    memberId,
  });
  expect(await counts(t, reader.personId)).toMatchObject({
    memberOf: 0,
    tab: "noKhatma",
  });
});

test("handing a khatma over moves the organizer count", async () => {
  const t = convexTest(schema, modules);
  const owner = await person(t);
  const next = await person(t, "ليلى");
  const { inviteCode } = await poolKhatma(t, owner);
  await t.mutation(api.pool.take, {
    sessionToken: next.token,
    inviteCode,
    juz: 1,
  });
  const memberId = await t.run(
    async (ctx) =>
      (await ctx.db
        .query("members")
        .withIndex("by_person", (q) => q.eq("personId", next.personId))
        .first())!._id,
  );
  await t.mutation(api.organizer.handOver, {
    sessionToken: owner.token,
    inviteCode,
    memberId,
  });
  expect(await counts(t, owner.personId)).toMatchObject({
    organizes: 0,
    tab: "members",
  });
  expect(await counts(t, next.personId)).toMatchObject({
    organizes: 1,
    tab: "organizers",
  });
});

test("a renamed person and a renamed khatma stay findable", async () => {
  const t = convexTest(schema, modules);
  const who = await person(t);
  const { inviteCode } = await poolKhatma(t, who);
  await t.mutation(api.people.updateDisplayName, {
    sessionToken: who.token,
    displayName: "فائزة",
  });
  expect((await counts(t, who.personId)).searchName).toBe("فايزه");

  await t.mutation(api.organizer.update, {
    sessionToken: who.token,
    inviteCode,
    name: "ختمة الأحبة",
  });
  const { searchName } = await t.run(
    async (ctx) => (await ctx.db.query("khatmas").first())!,
  );
  expect(searchName).toBe("ختمه الاحبه");
});

test("a reader with no account gets a directory row that follows their rota rows", async () => {
  const t = convexTest(schema, modules);
  const who = await person(t);
  const { inviteCode } = await rotaKhatma(t, who);
  const { phone, participantId } = await addReader(t, who, inviteCode, {
    name: "زهرة",
  });
  expect(await entry(t, phone)).toMatchObject({
    name: "زهرة",
    searchName: "زهره",
    khatmaCount: 1,
    lastReplyAt: null,
  });

  await t.mutation(api.rota.renameParticipant, {
    sessionToken: who.token,
    inviteCode,
    participantId,
    name: "زهراء",
  });
  expect(await entry(t, phone)).toMatchObject({ name: "زهراء" });

  await t.mutation(internal.rotaInbound.recordMedia, { phone, now: NOW + 1 });
  expect(await entry(t, phone)).toMatchObject({ lastReplyAt: NOW + 1 });

  await t.mutation(api.rota.removeParticipant, {
    sessionToken: who.token,
    inviteCode,
    participantId,
  });
  expect(await entry(t, phone)).toBeNull();
});

test("one phone in two rota khatmas has one directory row", async () => {
  const t = convexTest(schema, modules);
  const a = await person(t);
  const b = await person(t);
  const first = await rotaKhatma(t, a);
  const second = await rotaKhatma(t, b);
  const { phone } = await addReader(t, a, first.inviteCode);
  await addReader(t, b, second.inviteCode, { phone });
  expect(await entry(t, phone)).toMatchObject({ khatmaCount: 2 });
  const rows = await t.run((ctx) => ctx.db.query("readerDirectory").collect());
  expect(rows).toHaveLength(1);
});

test("a directory row notes a hidden number", async () => {
  const t = convexTest(schema, modules);
  const who = await person(t);
  const { inviteCode } = await rotaKhatma(t, who);
  const { phone, participantId } = await addReader(t, who, inviteCode);
  await t.run(async (ctx) => {
    await ctx.db.patch(participantId, { phoneHidden: true });
    await refreshPhone(ctx, phone);
  });
  expect(await entry(t, phone)).toMatchObject({ phoneHidden: true });
});

test("signing in moves a reader out of the directory and onto their person", async () => {
  const t = convexTest(schema, modules);
  const who = await person(t);
  const { inviteCode } = await rotaKhatma(t, who);
  const { phone } = await addReader(t, who, inviteCode);

  const secretHash = await sha256Hex("secret");
  const verificationId = await t.run((ctx) =>
    ctx.db.insert("verifications", {
      codeNormalized: "x",
      secretHash,
      displayName: "ليلى",
      status: "matched",
      phone,
      pinAttempts: 0,
      createdAt: NOW,
      expiresAt: NOW + 60_000,
    }),
  );
  await t.mutation(internal.verification.claimInternal, {
    verificationId,
    secretHash,
    pinHash: "pin",
    tokenHash: "tok",
    alertTokenHash: "alert",
    deviceLabel: "phone",
    timeZone: "Asia/Dubai",
  });

  expect(await entry(t, phone)).toBeNull();
  const created = await t.run((ctx) =>
    ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first(),
  );
  expect(created).toMatchObject({
    memberOfCount: 1,
    organizesCount: 0,
    listTab: "members",
    searchName: "ليلي",
  });
});

test("an admin's setup makes a no-show organizer a listed person", async () => {
  const t = convexTest(schema, modules);
  const adminToken = await admin(t);
  const phone = "+971501112233";
  await t.action(api.adminRota.create, {
    adminToken,
    organizerName: "خالد",
    organizerPhone: phone,
    name: "ختمة",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
    endDate: null,
  });
  const created = await t.run((ctx) =>
    ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first(),
  );
  expect(created).toMatchObject({
    verifiedAt: 0,
    organizesCount: 1,
    memberOfCount: 1,
    listTab: "organizers",
  });
  expect(await entry(t, phone)).toBeNull();
});

test("deleting a khatma takes its counts and its readers' rows with it", async () => {
  vi.useRealTimers();
  const t = convexTest(schema, modules);
  const who = await person(t);
  const adminToken = await admin(t);
  const { inviteCode } = await rotaKhatma(t, who);
  const { phone } = await addReader(t, who, inviteCode);
  const id = await khatmaId(t, inviteCode);
  await t.mutation(api.adminRota.archive, { adminToken, khatmaId: id });
  await t.mutation(api.adminRota.remove, { adminToken, khatmaId: id });
  await t.finishAllScheduledFunctions(() => undefined);
  expect(await entry(t, phone)).toBeNull();
  expect(await counts(t, who.personId)).toMatchObject({
    organizes: 0,
    memberOf: 0,
    tab: "noKhatma",
  });
});

test("the repair fills in rows from before the counts, and removes stale ones", async () => {
  const t = convexTest(schema, modules);
  const who = await person(t, "هدى");
  const { inviteCode } = await rotaKhatma(t, who);
  const { phone } = await addReader(t, who, inviteCode, { name: "زهرة" });
  const row = (await entry(t, phone))!;
  await t.run(async (ctx) => {
    await ctx.db.patch(who.personId, {
      organizesCount: undefined,
      memberOfCount: 9,
      listTab: undefined,
      searchName: undefined,
    });
    const k = (await ctx.db.query("khatmas").first())!;
    await ctx.db.patch(k._id, { searchName: undefined });
    await ctx.db.delete(row._id);
    await ctx.db.insert("readerDirectory", {
      phone: "+971509990000",
      name: "قديم",
      searchName: "قديم",
      khatmaCount: 1,
      lastReplyAt: null,
    });
  });

  await t.mutation(internal.directory.repair, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await counts(t, who.personId)).toEqual({
    organizes: 1,
    memberOf: 1,
    tab: "organizers",
    searchName: "هدي",
  });
  expect(await entry(t, phone)).toMatchObject({ name: "زهرة" });
  expect(await entry(t, "+971509990000")).toBeNull();
  const k = await t.run(
    async (ctx) => (await ctx.db.query("khatmas").first())!,
  );
  expect(k.searchName).toBe("ختمه الرفاق");
});
