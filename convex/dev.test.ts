import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { DEFAULT_GRACE } from "./lib/grace";
import { getSetting } from "./lib/settings";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllEnvs();
});

const ipLimit = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => getSetting(ctx, "verifyStartPerIpPer10Min"));

test("dev:setSetting refuses outside dev and writes nothing", async () => {
  const t = convexTest(schema, modules);
  for (const env of ["prod", ""]) {
    vi.stubEnv("WIRDAK_ENV", env);
    await expect(
      t.mutation(internal.dev.setSetting, {
        key: "verifyStartPerIpPer10Min",
        value: 1000,
      }),
    ).rejects.toThrow(/only when WIRDAK_ENV is dev/);
  }
  expect(await t.run((ctx) => ctx.db.query("settings").collect())).toEqual([]);
});

test("dev:setSetting stores a number, replaces it, and removes it with null", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WIRDAK_ENV", "dev");
  const set = (value: number | null) =>
    t.mutation(internal.dev.setSetting, {
      key: "verifyStartPerIpPer10Min",
      value,
    });

  expect(await set(1000)).toBeNull();
  expect(await ipLimit(t)).toBe(1000);
  expect(await set(2000)).toBe(1000);
  expect(await ipLimit(t)).toBe(2000);
  expect(await t.run((ctx) => ctx.db.query("settings").collect())).toHaveLength(
    1,
  );
  expect(await set(null)).toBe(2000);
  expect(await ipLimit(t)).toBe(30);
  expect(await t.run((ctx) => ctx.db.query("settings").collect())).toEqual([]);
});

test("dev:setSetting refuses unknown and non-numeric settings", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WIRDAK_ENV", "dev");
  await expect(
    t.mutation(internal.dev.setSetting, { key: "noSuchSetting", value: 1 }),
  ).rejects.toThrow(/unknown setting/);
  await expect(
    t.mutation(internal.dev.setSetting, { key: "toString", value: 1 }),
  ).rejects.toThrow(/unknown setting/);
  await expect(
    t.mutation(internal.dev.setSetting, { key: "graceDefaults", value: 1 }),
  ).rejects.toThrow(/not a numeric setting/);
  await expect(
    t.mutation(internal.dev.setSetting, {
      key: "rotaStartNextDay",
      value: 1,
    }),
  ).rejects.toThrow(/not a numeric setting/);
});

test("dev:setSetting stores an on/off setting", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WIRDAK_ENV", "dev");
  const set = (value: boolean | null) =>
    t.mutation(internal.dev.setSetting, { key: "rotaStartNextDay", value });
  expect(await set(false)).toBeNull();
  expect(await set(null)).toBe(false);
});

test("dev:rotaPayload builds the participant's payload for the open day, in dev only", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WIRDAK_ENV", "dev");
  const ids = await t.run(async (ctx) => {
    const creatorPersonId = await ctx.db.insert("people", {
      phone: "+971500000001",
      displayName: "المنظم",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    });
    const khatmaId = await ctx.db.insert("khatmas", {
      name: "ختمة",
      schedule: "none",
      grace: DEFAULT_GRACE.none,
      creatorPersonId,
      inviteCode: "invite-code",
      completedRounds: 0,
      createdAt: 0,
      kind: "rota",
    });
    const participantId = await ctx.db.insert("rotaParticipants", {
      khatmaId,
      name: "قارئ",
      phone: "+971500000100",
      personId: null,
      addedAt: 0,
      removedAt: null,
    });
    const day = (n: number, closedAt: number | null) =>
      ctx.db.insert("rotaDays", {
        khatmaId,
        n,
        number: n,
        cycle: 1,
        date: `2027-01-${15 + n}`,
        startedAt: 0,
        closesAt: 0,
        completedAt: null,
        closedAt,
        unreadSentAt: null,
        summarySentAt: null,
      });
    await day(1, 1);
    const dayId = await day(2, null);
    return { participantId, dayId };
  });
  const args = {
    inviteCode: "invite-code",
    phone: "+971500000100",
    action: "done",
  } as const;

  expect(await t.query(internal.dev.rotaPayload, args)).toBe(
    `r1|p|done|${ids.dayId}|${ids.participantId}`,
  );
  await expect(
    t.query(internal.dev.rotaPayload, { ...args, phone: "+971500000999" }),
  ).rejects.toThrow(/no such participant/);

  // A removed participant isn't found, and neither is anyone while no day is open.
  await t.run((ctx) => ctx.db.patch(ids.participantId, { removedAt: 1 }));
  await expect(t.query(internal.dev.rotaPayload, args)).rejects.toThrow(
    /no such participant/,
  );
  await t.run((ctx) => ctx.db.patch(ids.participantId, { removedAt: null }));
  await t.run((ctx) => ctx.db.patch(ids.dayId, { closedAt: 2 }));
  await expect(t.query(internal.dev.rotaPayload, args)).rejects.toThrow(
    /no open day/,
  );

  vi.stubEnv("WIRDAK_ENV", "prod");
  await expect(t.query(internal.dev.rotaPayload, args)).rejects.toThrow(
    /only when WIRDAK_ENV is dev/,
  );
});

test("dev:adminSession refuses outside dev and writes nothing", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WIRDAK_ENV", "prod");
  await expect(
    t.action(internal.dev.adminSession, { phone: "+971500000123" }),
  ).rejects.toThrow(/only when WIRDAK_ENV is dev/);
  await expect(
    t.mutation(internal.dev.insertAdminSession, {
      phone: "+971500000123",
      tokenHash: "a",
      alertTokenHash: "b",
    }),
  ).rejects.toThrow(/only when WIRDAK_ENV is dev/);
  expect(await t.run((ctx) => ctx.db.query("admins").collect())).toEqual([]);
});

test("dev:adminSession signs an admin in, one row per phone", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WIRDAK_ENV", "dev");
  const phone = "+971500000123";

  const first = await t.action(internal.dev.adminSession, { phone });
  const second = await t.action(internal.dev.adminSession, { phone });

  expect(first).not.toBe(second);
  expect(await t.query(api.adminAuth.me, { adminToken: first })).toMatchObject({
    phone,
  });
  expect(await t.run((ctx) => ctx.db.query("admins").collect())).toHaveLength(
    1,
  );
});
