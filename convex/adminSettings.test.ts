import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { ADMIN_SESSION_TTL_MS } from "./lib/adminSession";
import { sha256Hex } from "./lib/crypto";
import { getSetting } from "./lib/settings";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

async function signedInAdmin(t: T, token = "ali") {
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      phone: "+971500000001",
      addedBy: null,
      addedAt: NOW,
    }),
  );
  const tokenHash = await sha256Hex(token);
  await t.run((ctx) =>
    ctx.db.insert("adminSessions", {
      adminId,
      tokenHash,
      alertTokenHash: tokenHash,
      deviceLabel: "iPhone",
      createdAt: NOW,
      expiresAt: NOW + ADMIN_SESSION_TTL_MS,
    }),
  );
  return adminId;
}

function settingsRows(t: T) {
  return t.run((ctx) => ctx.db.query("settings").collect());
}

function auditRows(t: T) {
  return t.run((ctx) => ctx.db.query("auditLog").collect());
}

test("set changes the live value and records before and after", async () => {
  const t = convexTest(schema, modules);
  const adminId = await signedInAdmin(t);
  expect(
    await t.mutation(api.adminSettings.set, {
      adminToken: "ali",
      key: "maxMembers",
      value: 40,
    }),
  ).toEqual({ ok: true });
  expect(await t.run((ctx) => getSetting(ctx, "maxMembers"))).toBe(40);
  expect(await auditRows(t)).toMatchObject([
    {
      adminId,
      action: "setting.set",
      targetKind: "setting",
      targetId: "maxMembers",
      before: 60,
      after: 40,
    },
  ]);

  await t.mutation(api.adminSettings.set, {
    adminToken: "ali",
    key: "maxMembers",
    value: 45,
  });
  expect(await settingsRows(t)).toHaveLength(1);
  expect((await auditRows(t))[1]).toMatchObject({ before: 40, after: 45 });
});

test("an impossible pace order is refused and nothing is written", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  expect(
    await t.mutation(api.adminSettings.set, {
      adminToken: "ali",
      key: "paceMinMs",
      value: 5 * DAY,
    }),
  ).toEqual({ error: "pace_order" });
  expect(await settingsRows(t)).toHaveLength(0);
  expect(await auditRows(t)).toHaveLength(0);
});

test("equal quiet hours are refused", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  expect(
    await t.mutation(api.adminSettings.set, {
      adminToken: "ali",
      key: "quietEndHour",
      value: 22,
    }),
  ).toEqual({ error: "quiet_hours_equal" });
});

test("rota default times must stay in order and in waking hours together", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  const set = (key: string, value: unknown) =>
    t.mutation(api.adminSettings.set, { adminToken: "ali", key, value });
  // the reminder after the 19:00 unread list
  expect(await set("rotaReminderAt", 1200)).toEqual({ error: "out_of_range" });
  // 06:00 is in the quiet hours
  expect(await set("rotaDayAt", 360)).toEqual({ error: "out_of_range" });
  expect(await settingsRows(t)).toHaveLength(0);

  // a summary that is off may sit anywhere, until it is turned on
  expect(await set("rotaSummaryAt", 1080)).toEqual({ ok: true });
  expect(await set("rotaSummaryOn", true)).toEqual({ error: "out_of_range" });
  expect(await set("rotaSummaryAt", 1200)).toEqual({ ok: true });
  expect(await set("rotaSummaryOn", true)).toEqual({ ok: true });

  // going back to a default is checked the same way
  await set("rotaUnreadOn", false);
  await set("rotaReminderAt", 1170);
  expect(
    await t.mutation(api.adminSettings.reset, {
      adminToken: "ali",
      key: "rotaUnreadOn",
    }),
  ).toEqual({ error: "out_of_range" });
});

test("quiet hours can't move over the rota default times", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  const set = (key: string, value: unknown) =>
    t.mutation(api.adminSettings.set, { adminToken: "ali", key, value });
  const reset = (key: string) =>
    t.mutation(api.adminSettings.reset, { adminToken: "ali", key });
  // the day starts at 08:00, so waking hours can't begin at 09:00
  expect(await set("quietEndHour", 9)).toEqual({ error: "out_of_range" });
  // the unread list is at 19:00, so they can't begin at 19:00 either
  expect(await set("quietStartHour", 19)).toEqual({ error: "out_of_range" });
  expect(await settingsRows(t)).toHaveLength(0);
  // a move that still fits goes through
  expect(await set("quietEndHour", 8)).toEqual({ ok: true });
  expect(await set("quietStartHour", 20)).toEqual({ ok: true });

  // going back to a default is checked the same way
  expect(await set("quietStartHour", 23)).toEqual({ ok: true });
  expect(await set("rotaSummaryAt", 1350)).toEqual({ ok: true });
  expect(await set("rotaSummaryOn", true)).toEqual({ ok: true });
  expect(await reset("quietStartHour")).toEqual({ error: "out_of_range" });
  expect(await t.run((ctx) => getSetting(ctx, "quietStartHour"))).toBe(23);
});

test("bad values and unknown keys are refused", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  const set = (key: string, value: unknown) =>
    t.mutation(api.adminSettings.set, { adminToken: "ali", key, value });
  expect(await set("nope", 1)).toEqual({ error: "unknown_key" });
  expect(await set("maxMembers", 1)).toEqual({ error: "out_of_range" });
  expect(await set("maxMembers", "40")).toEqual({ error: "wrong_type" });
  expect(await settingsRows(t)).toHaveLength(0);
});

test("text settings are trimmed, and an empty text is stored as null", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  await t.mutation(api.adminSettings.set, {
    adminToken: "ali",
    key: "announcement",
    value: "  رمضان كريم  ",
  });
  expect(await t.run((ctx) => getSetting(ctx, "announcement"))).toBe(
    "رمضان كريم",
  );
  await t.mutation(api.adminSettings.set, {
    adminToken: "ali",
    key: "announcement",
    value: "   ",
  });
  expect(await t.run((ctx) => getSetting(ctx, "announcement"))).toBeNull();
});

test("reset goes back to the default and is recorded", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  await t.mutation(api.adminSettings.set, {
    adminToken: "ali",
    key: "maxMembers",
    value: 40,
  });
  expect(
    await t.mutation(api.adminSettings.reset, {
      adminToken: "ali",
      key: "maxMembers",
    }),
  ).toEqual({ ok: true });
  expect(await settingsRows(t)).toHaveLength(0);
  expect(await t.run((ctx) => getSetting(ctx, "maxMembers"))).toBe(60);
  expect((await auditRows(t))[1]).toMatchObject({
    action: "setting.reset",
    before: 40,
    after: 60,
  });
});

test("reset is refused when the default would break the pace order", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  const set = (key: string, value: unknown) =>
    t.mutation(api.adminSettings.set, { adminToken: "ali", key, value });
  await set("paceMaxMs", 14 * DAY);
  await set("defaultPaceMs", 10 * DAY);
  // The default paceMaxMs (7 days) is now below defaultPaceMs.
  expect(
    await t.mutation(api.adminSettings.reset, {
      adminToken: "ali",
      key: "paceMaxMs",
    }),
  ).toEqual({ error: "pace_order" });
});

test("list shows every setting with its default and spec", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  await t.mutation(api.adminSettings.set, {
    adminToken: "ali",
    key: "maxMembers",
    value: 40,
  });
  const rows = await t.query(api.adminSettings.list, { adminToken: "ali" });
  expect(rows[0]).toMatchObject({
    key: "maxMembers",
    value: 40,
    defaultValue: 60,
    isDefault: false,
    spec: { kind: "int", min: 2, max: 500, group: "limits" },
  });
  expect(rows.find((r) => r.key === "announcement")).toMatchObject({
    value: null,
    isDefault: true,
  });
});

test("a member session can't read or write settings", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.query(api.adminSettings.list, { adminToken: "member" }),
  ).rejects.toThrow(/not_admin/);
  await expect(
    t.mutation(api.adminSettings.set, {
      adminToken: "member",
      key: "maxMembers",
      value: 40,
    }),
  ).rejects.toThrow(/not_admin/);
});

test("the public query shows only the five public settings", async () => {
  const t = convexTest(schema, modules);
  await signedInAdmin(t);
  await t.mutation(api.adminSettings.set, {
    adminToken: "ali",
    key: "maintenanceMode",
    value: true,
  });
  expect(await t.query(api.publicSettings.get, {})).toEqual({
    announcement: null,
    maintenanceMode: true,
    maintenanceMessage: null,
    minClientVersion: null,
    rotaStartNextDay: true,
  });
});
