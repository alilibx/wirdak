import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { ADMIN_SESSION_TTL_MS } from "./lib/adminSession";
import { sha256Hex } from "./lib/crypto";
import { nameFields, refreshPhone } from "./lib/directory";
import { DEFAULT_GRACE } from "./lib/grace";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const DAY = 86_400_000;
const NOW = Date.UTC(2027, 0, 15, 7, 0, 0);

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

const adminToken = "admin";
const pages = { numItems: 50, cursor: null };

async function setup() {
  const t = convexTest(schema, modules);
  const tokenHash = await sha256Hex(adminToken);
  const adminId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("admins", {
      phone: "+971500000099",
      addedBy: null,
      addedAt: 0,
    });
    await ctx.db.insert("adminSessions", {
      adminId: id,
      tokenHash,
      alertTokenHash: tokenHash,
      deviceLabel: "x",
      createdAt: NOW,
      expiresAt: NOW + ADMIN_SESSION_TTL_MS,
    });
    return id;
  });
  return { t, adminId };
}

let seq = 0;

async function person(
  t: T,
  displayName: string,
  over: Partial<Doc<"people">> = {},
) {
  seq += 1;
  const phone = `+9715040${String(seq).padStart(5, "0")}`;
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone,
      displayName,
      verifiedAt: NOW - DAY,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW - DAY,
      ...over,
    });
    await refreshPhone(ctx, phone);
    return id;
  });
}

async function khatma(
  t: T,
  creatorPersonId: Id<"people">,
  name: string | null,
  over: Partial<Doc<"khatmas">> = {},
) {
  seq += 1;
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("khatmas", {
      ...nameFields(name),
      schedule: "daily",
      grace: DEFAULT_GRACE.daily,
      creatorPersonId,
      inviteCode: `invite-${seq}`,
      completedRounds: 0,
      createdAt: NOW,
      ...over,
    });
    const organizer = (await ctx.db.get(creatorPersonId))!;
    await refreshPhone(ctx, organizer.phone);
    return id;
  });
}

const ROTA = {
  days: { kind: "daily" as const },
  firstDate: "2027-01-01",
  endDate: null,
  timeZone: "Asia/Dubai",
  messages: {
    dayAt: 480,
    reminder: { at: 960, on: true },
    unread: { at: 1140, on: false },
    summary: { at: 1260, on: false },
  },
  pausedAt: null,
  pauseDates: [],
  archivedAt: null,
  setupDoneAt: NOW,
};

async function join(t: T, khatmaId: Id<"khatmas">, personId: Id<"people">) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", {
      khatmaId,
      personId,
      joinedAt: NOW,
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    await refreshPhone(ctx, (await ctx.db.get(personId))!.phone);
  });
}

async function reader(
  t: T,
  khatmaId: Id<"khatmas">,
  name: string,
  phone: string,
  over: Partial<Doc<"rotaParticipants">> = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("rotaParticipants", {
      khatmaId,
      name,
      phone,
      personId: null,
      addedAt: NOW,
      removedAt: null,
      ...over,
    });
    await refreshPhone(ctx, phone);
  });
}

const people = (t: T, over: object = {}) =>
  t.query(api.adminLists.people, {
    adminToken,
    paginationOpts: pages,
    sort: "created",
    order: "desc",
    ...over,
  });
const names = (r: { page: { displayName: string }[] }) =>
  r.page.map((p) => p.displayName);

test("everything needs an admin", async () => {
  const { t } = await setup();
  await expect(
    t.query(api.adminLists.people, {
      adminToken: "nope",
      paginationOpts: pages,
      sort: "created",
      order: "desc",
    }),
  ).rejects.toThrow(/not_admin/);
});

test("the people list pages through everyone with masked numbers", async () => {
  const { t } = await setup();
  await person(t, "سارة");
  await person(t, "علي");
  await person(t, "ليلى");
  const first = await people(t, {
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(names(first)).toEqual(["ليلى", "علي"]);
  expect(first.page[0]!.phoneMasked).toContain("•••");
  expect(JSON.stringify(first)).not.toContain('"phone"');
  const next = await people(t, {
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(names(next)).toEqual(["سارة"]);
  expect(next.isDone).toBe(true);
});

test("a list keeps the paginator's fields", async () => {
  const { t } = await setup();
  await person(t, "سارة");
  const result = await people(t);
  expect(result).toHaveProperty("splitCursor");
  expect(result).toHaveProperty("pageStatus");
});

test("the tabs split people by organizing and belonging", async () => {
  const { t } = await setup();
  const organizer = await person(t, "المنظّم");
  const member = await person(t, "العضو");
  await person(t, "بلا ختمة");
  await join(t, await khatma(t, organizer, "ختمة"), member);

  expect(names(await people(t, { tab: "organizers" }))).toEqual(["المنظّم"]);
  expect(names(await people(t, { tab: "members" }))).toEqual(["العضو"]);
  expect(names(await people(t, { tab: "noKhatma" }))).toEqual(["بلا ختمة"]);
  expect(await people(t)).toMatchObject({ isDone: true });
  expect(names(await people(t))).toHaveLength(3);
});

test("people sort by name, last seen, joined and created, both ways, in a tab too", async () => {
  const { t } = await setup();
  const a = await person(t, "أحمد", {
    lastSeenAt: NOW - 3 * DAY,
    verifiedAt: NOW - 1 * DAY,
  });
  const b = await person(t, "بلال", {
    lastSeenAt: NOW - 1 * DAY,
    verifiedAt: NOW - 2 * DAY,
  });
  const c = await person(t, "ثامر", {
    lastSeenAt: NOW - 2 * DAY,
    verifiedAt: NOW - 3 * DAY,
  });
  for (const id of [a, b, c]) await khatma(t, id, "ختمة");

  for (const tab of [undefined, "organizers"]) {
    expect(names(await people(t, { tab, sort: "name", order: "asc" }))).toEqual(
      ["أحمد", "بلال", "ثامر"],
    );
    expect(
      names(await people(t, { tab, sort: "lastSeen", order: "desc" })),
    ).toEqual(["بلال", "ثامر", "أحمد"]);
    expect(
      names(await people(t, { tab, sort: "joined", order: "asc" })),
    ).toEqual(["ثامر", "بلال", "أحمد"]);
    expect(
      names(await people(t, { tab, sort: "created", order: "asc" })),
    ).toEqual(["أحمد", "بلال", "ثامر"]);
  }
});

test("no list sorts by a count", async () => {
  const { t } = await setup();
  for (const sort of ["organizes", "memberOf", "completed", "members"]) {
    await expect(people(t, { sort })).rejects.toThrow(/Validator|sort/);
  }
});

test("search matches a folded word of the name, within the tab", async () => {
  const { t } = await setup();
  const organizer = await person(t, "فائزة علي");
  await khatma(t, organizer, "ختمة");
  await person(t, "فايزة سعيد");
  expect(names(await people(t, { search: "فايزه" }))).toHaveLength(2);
  expect(names(await people(t, { search: "فايزه", tab: "noKhatma" }))).toEqual([
    "فايزة سعيد",
  ]);
  expect(names(await people(t, { search: "  " }))).toHaveLength(2);
});

test("a row says who never signed in and who is blocked", async () => {
  const { t, adminId } = await setup();
  await person(t, "لم ينضمّ", { verifiedAt: 0, lastSeenAt: 0 });
  const blocked = await person(t, "محظور");
  await person(t, "عادي");
  const { phone } = await t.run(async (ctx) => (await ctx.db.get(blocked))!);
  await t.run((ctx) =>
    ctx.db.insert("blockedPhones", {
      phone,
      blockedBy: adminId,
      at: NOW,
      note: null,
    }),
  );
  const { page } = await people(t, { sort: "name", order: "asc" });
  expect(
    Object.fromEntries(page.map((p) => [p.displayName, p.status])),
  ).toEqual({ عادي: "active", "لم ينضمّ": "notJoined", محظور: "blocked" });
});

test("the blocked list pages through blocked numbers, with or without an account", async () => {
  const { t, adminId } = await setup();
  const blocked = await person(t, "محظور");
  const { phone } = await t.run(async (ctx) => (await ctx.db.get(blocked))!);
  await t.run(async (ctx) => {
    await ctx.db.insert("blockedPhones", {
      phone: "+971509998877",
      blockedBy: adminId,
      at: NOW - DAY,
      note: "إزعاج",
    });
    await ctx.db.insert("blockedPhones", {
      phone,
      blockedBy: adminId,
      at: NOW,
      note: null,
    });
  });
  const { page } = await t.query(api.adminLists.blocked, {
    adminToken,
    paginationOpts: pages,
  });
  expect(page).toHaveLength(2);
  expect(page[0]).toMatchObject({
    person: { personId: blocked, displayName: "محظور" },
    at: NOW,
  });
  expect(page[1]).toMatchObject({
    person: null,
    phoneMasked: "+971 50 ••• 8877",
    note: "إزعاج",
  });
});

test("the organizers list shows their khatmas, total members and absence", async () => {
  const { t } = await setup();
  const here = await person(t, "حاضر", { lastSeenAt: NOW - DAY });
  const away = await person(t, "غائب", { lastSeenAt: NOW - 31 * DAY });
  const never = await person(t, "لم يأت", { lastSeenAt: 0, verifiedAt: 0 });
  const member = await person(t, "عضو");
  const k1 = await khatma(t, here, "الأولى");
  await khatma(t, here, null);
  await join(t, k1, here);
  await join(t, k1, member);
  await khatma(t, away, "ختمة");
  const rota = await khatma(t, never, "بالتناوب", {
    kind: "rota",
    rota: ROTA,
    schedule: "none",
  });
  await reader(t, rota, "قارئ", "+971507770001");

  const { page } = await t.query(api.adminLists.organizers, {
    adminToken,
    paginationOpts: pages,
    sort: "name",
    order: "asc",
  });
  const byName = Object.fromEntries(page.map((p) => [p.displayName, p]));
  expect(byName["حاضر"]).toMatchObject({
    away: false,
    totalMembers: 2,
    rotaAllowed: false,
    khatmas: expect.arrayContaining([
      { khatmaId: k1, name: "الأولى", memberCount: 2 },
    ]),
  });
  expect(byName["حاضر"]!.khatmas).toHaveLength(2);
  expect(byName["حاضر"]!.phoneMasked).toContain("•••");
  expect(byName["غائب"]).toMatchObject({ away: true, totalMembers: 0 });
  expect(byName["لم يأت"]).toMatchObject({
    away: false,
    status: "notJoined",
    totalMembers: 1,
  });
});

test("the readers list has one row per phone with no account, and sorts", async () => {
  const { t, adminId } = await setup();
  const organizer = await person(t, "منظّم");
  const k1 = await khatma(t, organizer, "الأولى", {
    kind: "rota",
    rota: ROTA,
    schedule: "none",
  });
  const k2 = await khatma(t, organizer, "الثانية", {
    kind: "rota",
    rota: ROTA,
    schedule: "none",
  });
  await reader(t, k1, "زهرة", "+971507770002", { lastReplyAt: NOW - DAY });
  await reader(t, k2, "زهرة", "+971507770002");
  await reader(t, k1, "أسماء", "+971507770003", { lastReplyAt: NOW });
  await t.run((ctx) =>
    ctx.db.insert("blockedPhones", {
      phone: "+971507770003",
      blockedBy: adminId,
      at: NOW,
      note: null,
    }),
  );

  const byName = await t.query(api.adminLists.readers, {
    adminToken,
    paginationOpts: pages,
    sort: "name",
    order: "asc",
  });
  expect(byName.page.map((r) => r.name)).toEqual(["أسماء", "زهرة"]);
  expect(byName.page[1]).toMatchObject({
    khatmaCount: 2,
    lastReplyAt: NOW - DAY,
    phoneMasked: "+971 50 ••• 0002",
    blocked: false,
  });
  expect(byName.page[1]!.khatmas.map((k) => k.name).sort()).toEqual([
    "الأولى",
    "الثانية",
  ]);
  expect(byName.page[0]).toMatchObject({ blocked: true });

  const byReply = await t.query(api.adminLists.readers, {
    adminToken,
    paginationOpts: pages,
    sort: "lastReply",
    order: "desc",
  });
  expect(byReply.page.map((r) => r.name)).toEqual(["أسماء", "زهرة"]);

  const found = await t.query(api.adminLists.readers, {
    adminToken,
    paginationOpts: pages,
    sort: "name",
    order: "asc",
    search: "زهره",
  });
  expect(found.page.map((r) => r.name)).toEqual(["زهرة"]);
});

test("a hidden number gives no part of itself to the readers list", async () => {
  const { t } = await setup();
  const organizer = await person(t, "منظّم");
  const k = await khatma(t, organizer, "ختمة", {
    kind: "rota",
    rota: ROTA,
    schedule: "none",
  });
  await reader(t, k, "مخفي", "+971507771234", { phoneHidden: true });
  const res = await t.query(api.adminLists.readers, {
    adminToken,
    paginationOpts: pages,
    sort: "name",
    order: "asc",
  });
  expect(res.page[0]!.phoneMasked).toBeNull();
  expect(JSON.stringify(res)).not.toContain("1234");
});

const khatmas = (t: T, over: object = {}) =>
  t.query(api.adminLists.khatmas, {
    adminToken,
    paginationOpts: pages,
    sort: "created",
    order: "desc",
    ...over,
  });
const titles = (r: { page: { name: string | null }[] }) =>
  r.page.map((k) => k.name);

test("the khatmas list shows kind, status, organizer, members and completions", async () => {
  const { t } = await setup();
  const organizer = await person(t, "سارة");
  const pool = await khatma(t, organizer, "بالحجز", { completedRounds: 3 });
  await join(t, pool, organizer);
  await khatma(t, organizer, "مؤرشفة", { archivedAt: NOW });
  const rota = await khatma(t, organizer, "بالتناوب", {
    kind: "rota",
    rota: ROTA,
    schedule: "none",
  });
  await reader(t, rota, "قارئ", "+971507770004");
  const dayId = await t.run((ctx) =>
    ctx.db.insert("rotaDays", {
      khatmaId: rota,
      n: 35,
      number: 5,
      cycle: 2,
      date: "2027-01-15",
      startedAt: NOW,
      closesAt: NOW + DAY,
      completedAt: null,
      closedAt: null,
      unreadSentAt: null,
      summarySentAt: null,
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("rotaDays", {
      khatmaId: rota,
      n: 34,
      number: 4,
      cycle: 2,
      date: "2027-01-14",
      startedAt: NOW - DAY,
      closesAt: NOW,
      completedAt: NOW - 1000,
      closedAt: NOW,
      unreadSentAt: null,
      summarySentAt: null,
    });
    for (const juz of [1, 2, 3]) {
      await ctx.db.insert("rotaReads", {
        dayId,
        khatmaId: rota,
        juz,
        slot: juz,
        holderId: null,
        readerId: null,
        doneAt: juz === 3 ? null : NOW,
        doneByOrganizer: false,
        reassignedAt: null,
      });
    }
  });

  const { page } = await khatmas(t);
  const byName = Object.fromEntries(page.map((k) => [k.name, k]));
  expect(byName["بالحجز"]).toMatchObject({
    kind: "pool",
    status: "active",
    organizer: { personId: organizer, displayName: "سارة" },
    memberCount: 1,
    today: null,
    completed: 3,
  });
  expect(byName["مؤرشفة"]).toMatchObject({ status: "archived" });
  expect(byName["بالتناوب"]).toMatchObject({
    kind: "rota",
    status: "active",
    memberCount: 1,
    today: { done: 2, total: 30 },
    completed: 1,
  });
});

test("a rota khatma's status tells paused, waiting and archived apart", async () => {
  const { t } = await setup();
  const organizer = await person(t, "سارة");
  const rota = (name: string, over: object) =>
    khatma(t, organizer, name, {
      kind: "rota",
      schedule: "none",
      rota: { ...ROTA, ...over },
    });
  await rota("متوقفة", { pausedAt: NOW });
  await rota("تنتظر", { pendingOrganizer: true });
  await rota("مؤرشفة", { archivedAt: NOW });
  const { page } = await khatmas(t);
  expect(Object.fromEntries(page.map((k) => [k.name, k.status]))).toEqual({
    متوقفة: "paused",
    تنتظر: "waiting",
    مؤرشفة: "archived",
  });
});

test("khatmas sort by name and created, and filter by kind and status", async () => {
  const { t } = await setup();
  const organizer = await person(t, "سارة");
  await khatma(t, organizer, "بدر");
  await khatma(t, organizer, "أمل", { archivedAt: NOW });
  await khatma(t, organizer, "ثبات", {
    kind: "rota",
    rota: ROTA,
    schedule: "none",
  });
  await khatma(t, organizer, "تقوى", {
    kind: "rota",
    rota: { ...ROTA, archivedAt: NOW },
    schedule: "none",
  });

  expect(titles(await khatmas(t, { sort: "name", order: "asc" }))).toEqual([
    "أمل",
    "بدر",
    "تقوى",
    "ثبات",
  ]);
  expect(titles(await khatmas(t, { sort: "created", order: "asc" }))).toEqual([
    "بدر",
    "أمل",
    "ثبات",
    "تقوى",
  ]);
  expect(
    titles(await khatmas(t, { kind: "pool", sort: "name", order: "desc" })),
  ).toEqual(["بدر", "أمل"]);
  expect(
    titles(await khatmas(t, { kind: "rota", sort: "created", order: "asc" })),
  ).toEqual(["ثبات", "تقوى"]);
  expect(
    titles(
      await khatmas(t, { status: "archived", sort: "name", order: "asc" }),
    ),
  ).toEqual(["أمل", "تقوى"]);
  expect(
    titles(await khatmas(t, { status: "active", sort: "name", order: "asc" })),
  ).toEqual(["بدر", "ثبات"]);
  expect(
    titles(
      await khatmas(t, {
        status: "active",
        kind: "rota",
        sort: "name",
        order: "asc",
      }),
    ),
  ).toEqual(["ثبات"]);
});

test("khatma search folds the name, and keeps the filters", async () => {
  const { t } = await setup();
  const organizer = await person(t, "سارة");
  await khatma(t, organizer, "ختمة الأحبة");
  await khatma(t, organizer, "ختمة الاحبه", {
    kind: "rota",
    rota: ROTA,
    schedule: "none",
  });
  await khatma(t, organizer, "أخرى");
  expect(titles(await khatmas(t, { search: "الأحبة" }))).toHaveLength(2);
  expect(titles(await khatmas(t, { search: "احبه", kind: "pool" }))).toEqual(
    [],
  );
  expect(titles(await khatmas(t, { search: "الاحبه", kind: "pool" }))).toEqual([
    "ختمة الأحبة",
  ]);
  expect(titles(await khatmas(t, { search: "الاحبه", kind: "rota" }))).toEqual([
    "ختمة الاحبه",
  ]);
});

test("the pending filter lists each khatma with an open join request once", async () => {
  const { t } = await setup();
  const organizer = await person(t, "سارة");
  const rota = (name: string) =>
    khatma(t, organizer, name, { kind: "rota", rota: ROTA, schedule: "none" });
  const waiting = await rota("تنتظر");
  const answered = await rota("أجيبت");
  await rota("بلا طلبات");
  const request = (
    khatmaId: Id<"khatmas">,
    phone: string,
    resolvedAt: number | null,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("rotaJoinRequests", {
        khatmaId,
        phone,
        profileName: null,
        createdAt: NOW,
        resolvedAt,
        outcome: resolvedAt === null ? null : "accepted",
      }),
    );
  await request(waiting, "+971507770005", null);
  await request(waiting, "+971507770006", null);
  await request(answered, "+971507770007", NOW);

  const res = await khatmas(t, { status: "pendingJoin" });
  expect(titles(res)).toEqual(["تنتظر"]);
  expect(res.isDone).toBe(true);
});
