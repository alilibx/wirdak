import { convexTest } from "convex-test";
import { expect, expectTypeOf, test } from "vitest";
import schema from "../schema";
import { getSetting, quietHours, SETTING_DEFAULTS } from "./settings";

const modules = import.meta.glob("../**/*.ts");

test("falls back to defaults", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    expect(await getSetting(ctx, "maxMembers")).toBe(60);
    expect(await getSetting(ctx, "rotationLookbackRounds")).toBe(3);
    expect(await getSetting(ctx, "undoWindowMs")).toBe(10_000);
    expect(await getSetting(ctx, "maintenanceMode")).toBe(false);
    expect(await getSetting(ctx, "announcement")).toBeNull();
  });
});

test("stored value wins", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      key: "maxMembers",
      value: 40,
      updatedAt: 0,
    });
    expect(await getSetting(ctx, "maxMembers")).toBe(40);
    await ctx.db.insert("settings", {
      key: "announcement",
      value: "hello",
      updatedAt: 0,
    });
    expect(await getSetting(ctx, "announcement")).toBe("hello");
    // unrelated keys still default
    expect(await getSetting(ctx, "undoWindowMs")).toBe(10_000);
  });
});

test("defaults match the spec", () => {
  expect(SETTING_DEFAULTS).toEqual({
    maxMembers: 60,
    rotationLookbackRounds: 3,
    undoWindowMs: 10_000,
    completionDelayMs: 10_000,
    verificationTtlMs: 600_000,
    pinMaxAttempts: 5,
    verifyStartPerClientPer10Min: 5,
    verifyStartPerIpPer10Min: 30,
    verifyPerPhonePerHour: 10,
    verifyGlobalPerMinute: 120,
    poolActionsPerPersonPerMinute: 10,
    createsPerPersonPerDay: 5,
    newMembersPerKhatmaPerHour: 30,
    nameChangesPerPersonPerHour: 10,
    graceDefaults: {
      daily: { value: 6, unit: "hours" },
      every3days: { value: 1, unit: "days" },
      weekly: { value: 2, unit: "days" },
      biweekly: { value: 4, unit: "days" },
      monthly: { value: 7, unit: "days" },
      none: { value: 7, unit: "days" },
    },
    graceNoticeFraction: 0.25,
    quietStartHour: 22,
    quietEndHour: 7,
    defaultPaceMs: 3 * 86_400_000,
    paceMinMs: 86_400_000,
    paceMaxMs: 7 * 86_400_000,
    paceMinCountedMs: 20 * 60_000,
    paceSampleSize: 5,
    paceMinFinishes: 3,
    reminderPaceMultiple: 1.5,
    nudgeCooldownMs: 86_400_000,
    openForHelpBatchMs: 3_600_000,
    cheerOn: true,
    cheerEveryone: false,
    cheerGapMs: 86_400_000,
    cheerShowName: false,
    cheerShowJuz: false,
    signInAlertOn: true,
    organizerInactiveMs: 30 * 86_400_000,
    successorActiveMs: 7 * 86_400_000,
    notesRetentionMs: 30 * 86_400_000,
    notesUnclearedCapMs: 180 * 86_400_000,
    handoffTtlMs: 30 * 60_000,
    previewPerIpPerMinute: 30,
    handoffRedeemGlobalPerMinute: 60,
    maintenanceMode: false,
    announcement: null,
    maintenanceMessage: null,
    minClientVersion: null,
    helpRequestsPerPersonPerDay: 5,
    helpRequestsPerVisitorPerDay: 3,
    helpRequestsPerIpPerDay: 10,
    helpMessagesPerHour: 20,
    helpAutoCloseMs: 14 * 86_400_000,
    helpAttachmentRetentionMs: 30 * 86_400_000,
    helpRetentionMs: 180 * 86_400_000,
    summaryHour: 8,
    milestonePushSpacingMs: 60_000,
    rotaDayAt: 480,
    rotaReminderAt: 960,
    rotaReminderOn: true,
    rotaUnreadAt: 1140,
    rotaUnreadOn: true,
    rotaSummaryAt: 1260,
    rotaSummaryOn: false,
    rotaLateTapMs: 28_800_000,
    rotaStartNextDay: true,
    rotaAssignDuringQuiet: true,
    rotaMaxActivePerOrganizer: 2,
    rotaMaxSlotsPerPerson: 3,
    rotaSilenceNoticeDays: 3,
    rotaSilenceStopDays: 7,
  });
});

test("quietHours reads the quiet window from settings", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    expect(await quietHours(ctx)).toEqual({ startHour: 22, endHour: 7 });
    await ctx.db.insert("settings", {
      key: "quietEndHour",
      value: 8,
      updatedAt: 0,
    });
    expect(await quietHours(ctx)).toEqual({ startHour: 22, endHour: 8 });
  });
});

test("getSetting return types are widened per key", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    expectTypeOf(await getSetting(ctx, "maxMembers")).toEqualTypeOf<number>();
    expectTypeOf(
      await getSetting(ctx, "maintenanceMode"),
    ).toEqualTypeOf<boolean>();
    expectTypeOf(await getSetting(ctx, "announcement")).toEqualTypeOf<
      string | null
    >();
  });
});

test("duplicate key rows do not break getSetting", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      key: "maxMembers",
      value: 40,
      updatedAt: 0,
    });
    await ctx.db.insert("settings", {
      key: "maxMembers",
      value: 50,
      updatedAt: 1,
    });
    expect([40, 50]).toContain(await getSetting(ctx, "maxMembers"));
  });
});
