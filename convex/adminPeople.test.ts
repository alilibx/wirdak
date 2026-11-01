import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { ADMIN_SESSION_TTL_MS } from "./lib/adminSession";
import { sha256Hex } from "./lib/crypto";
import { foldText } from "./lib/searchFold";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

async function admin(t: T) {
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      phone: "+971500000099",
      addedBy: null,
      addedAt: 0,
    }),
  );
  const tokenHash = await sha256Hex("admin");
  await t.run((ctx) =>
    ctx.db.insert("adminSessions", {
      adminId,
      tokenHash,
      alertTokenHash: tokenHash,
      deviceLabel: "x",
      createdAt: NOW,
      expiresAt: NOW + ADMIN_SESSION_TTL_MS,
    }),
  );
}

const sara = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("people", {
      phone: "+971500000001",
      displayName: "سارة",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    }),
  );

const auth = { adminToken: "admin" };
const audit = (t: T) => t.run((ctx) => ctx.db.query("auditLog").collect());

test("update needs an admin", async () => {
  const t = convexTest(schema, modules);
  const personId = await sara(t);
  await expect(
    t.mutation(api.adminPeople.update, {
      adminToken: "nope",
      personId,
      displayName: "نورة",
    }),
  ).rejects.toThrow();
});

test("update renames a person, keeps their search name and records no number", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const personId = await sara(t);
  expect(
    await t.mutation(api.adminPeople.update, {
      ...auth,
      personId,
      displayName: "  نورة  علي ",
      note: "طلبت التعديل",
    }),
  ).toEqual({ ok: true });
  expect(await t.run((ctx) => ctx.db.get(personId))).toMatchObject({
    displayName: "نورة علي",
    searchName: foldText("نورة علي"),
  });
  const [row] = await audit(t);
  expect(row).toMatchObject({
    action: "person.update",
    targetKind: "person",
    targetId: personId,
    before: { displayName: "سارة" },
    after: { displayName: "نورة علي" },
    note: "طلبت التعديل",
  });
  expect(JSON.stringify(row)).not.toContain("+971500000001");
});

test("update turns WhatsApp notes on and off", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const personId = await sara(t);
  await t.mutation(api.adminPeople.update, {
    ...auth,
    personId,
    whatsappNotes: true,
  });
  expect((await t.run((ctx) => ctx.db.get(personId)))!.whatsappNotes).toBe(
    true,
  );
  await t.mutation(api.adminPeople.update, {
    ...auth,
    personId,
    whatsappNotes: false,
  });
  expect((await t.run((ctx) => ctx.db.get(personId)))!.whatsappNotes).toBe(
    false,
  );
});

test("update refuses a name with no letters and a missing person", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const personId = await sara(t);
  expect(
    await t.mutation(api.adminPeople.update, {
      ...auth,
      personId,
      displayName: "  ... ",
    }),
  ).toEqual({ error: "invalid_name" });
  expect((await t.run((ctx) => ctx.db.get(personId)))!.displayName).toBe(
    "سارة",
  );
  await t.run((ctx) => ctx.db.delete(personId));
  expect(
    await t.mutation(api.adminPeople.update, {
      ...auth,
      personId,
      displayName: "نورة",
    }),
  ).toEqual({ error: "not_found" });
  expect(await audit(t)).toEqual([]);
});

test("the person lookup says whether WhatsApp notes are on", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const personId = await sara(t);
  const off = await t.query(api.adminLookup.person, { ...auth, personId });
  expect(off?.whatsappNotes).toBe(false);
  await t.run((ctx) => ctx.db.patch(personId, { whatsappNotes: true }));
  const on = await t.query(api.adminLookup.person, { ...auth, personId });
  expect(on?.whatsappNotes).toBe(true);
});
