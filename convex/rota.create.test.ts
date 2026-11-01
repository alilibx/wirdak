import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import type { ReadingDays } from "./lib/rota";
import { ensureJoinCode } from "./rota";
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
});

type T = TestConvexForDataModel<DataModel>;

let seq = 0;

async function organizer(t: T, rotaAllowed = true) {
  seq += 1;
  const token = `token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone: `+9715000100${String(seq).padStart(2, "0")}`,
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

const fridays: ReadingDays = { kind: "weekly", weekdays: [5], everyWeeks: 1 };

/** These tests read from today, which needs the admin's start-tomorrow rule off. */
const allowStartToday = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "rotaStartNextDay",
      value: false,
      updatedAt: 0,
    }),
  );

async function create(
  t: T,
  who: { token: string },
  over: Partial<{
    days: ReadingDays;
    firstDate: string;
    endDate: string | null;
  }> = {},
) {
  await allowStartToday(t);
  return await t.action(api.rota.create, {
    sessionToken: who.token,
    name: "ختمة الأحباب",
    days: fridays,
    firstDate: "2027-01-15",
    endDate: null,
    ...over,
  });
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code;
  }
  return undefined;
}

test("creates a rota khatma with the organizer on slot 1", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  const { inviteCode } = await create(t, who);

  await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    expect(khatma).toMatchObject({
      kind: "rota",
      name: "ختمة الأحباب",
      schedule: "none",
      completedRounds: 0,
      creatorPersonId: who.personId,
    });
    expect(khatma?.currentRoundId).toBeUndefined();
    expect(khatma?.rota).toMatchObject({
      days: fridays,
      firstDate: "2027-01-15",
      endDate: null,
      timeZone: "Asia/Dubai",
      pausedAt: null,
      pauseDates: [],
      archivedAt: null,
      setupDoneAt: null,
      messages: {
        dayAt: 480,
        reminder: { at: 960, on: true },
        unread: { at: 1140, on: true },
        summary: { at: 1260, on: false },
      },
    });
    const members = await ctx.db
      .query("members")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma!._id))
      .collect();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      personId: who.personId,
      status: "active",
      notificationsOn: true,
    });
    expect(members[0]?.shareToken).toBeTruthy();
    const participants = await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma!._id))
      .collect();
    expect(participants).toHaveLength(1);
    expect(participants[0]).toMatchObject({
      name: "المنظم",
      phone: `+9715000100${String(seq).padStart(2, "0")}`,
      personId: who.personId,
      removedAt: null,
    });
    const slots = await ctx.db
      .query("rotaSlots")
      .withIndex("by_khatma_slot", (q) => q.eq("khatmaId", khatma!._id))
      .collect();
    expect(slots.map((s) => [s.slot, s.participantId])).toEqual([
      [1, participants[0]?._id],
    ]);
  });
});

test("stores a 6-character join code, different for each khatma", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  const first = await create(t, who);
  const second = await create(t, who);
  const codes = await t.run(async (ctx) => {
    const found = [];
    for (const { inviteCode } of [first, second]) {
      const khatma = await ctx.db
        .query("khatmas")
        .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
        .unique();
      found.push(khatma?.joinCode);
    }
    return found;
  });
  for (const joinCode of codes) {
    expect(joinCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  }
  expect(codes[0]).not.toBe(codes[1]);
});

test("insertRota returns null when the join code is taken", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  const { inviteCode } = await create(t, who);
  const joinCode = await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    return khatma!.joinCode!;
  });
  const created = await t.mutation(internal.rota.insertRota, {
    personId: who.personId,
    name: "ختمة أخرى",
    days: fridays,
    firstDate: "2027-01-15",
    endDate: null,
    inviteCode: "another-invite-code",
    joinCode,
    shareToken: "share",
  });
  expect(created).toBeNull();
});

test("ensureJoinCode gives a khatma without one a code, once", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  const { inviteCode } = await create(t, who);
  const result = await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    await ctx.db.patch(khatma!._id, { joinCode: undefined });
    const bare = (await ctx.db.get(khatma!._id))!;
    const code1 = await ensureJoinCode(ctx, bare);
    const code2 = await ensureJoinCode(ctx, (await ctx.db.get(bare._id))!);
    return { code1, code2, stored: (await ctx.db.get(bare._id))!.joinCode };
  });
  expect(result.code1).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  expect(result.code2).toBe(result.code1);
  expect(result.stored).toBe(result.code1);
});

test("refuses someone who was not allowed to create one", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t, false);
  expect(await code(create(t, who))).toBe("rota_not_allowed");
});

test("refuses without a session", async () => {
  const t = convexTest(schema, modules);
  expect(await code(create(t, { token: "nope" }))).toBe("not_signed_in");
});

test("refuses a third active rota khatma but not once one is archived", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  const first = await create(t, who);
  await create(t, who);
  expect(await code(create(t, who))).toBe("rota_cap");

  await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", first.inviteCode))
      .unique();
    await ctx.db.patch(khatma!._id, {
      rota: { ...khatma!.rota!, archivedAt: NOW },
    });
  });
  await create(t, who);
});

test("refuses bad reading days and bad dates", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  expect(
    await code(
      create(t, who, {
        days: { kind: "weekly", weekdays: [], everyWeeks: 1 },
      }),
    ),
  ).toBe("invalid_days");
  expect(await code(create(t, who, { firstDate: "2027-01-14" }))).toBe(
    "invalid_dates",
  );
  expect(
    await code(
      create(t, who, { firstDate: "2027-01-22", endDate: "2027-01-15" }),
    ),
  ).toBe("invalid_dates");
  // 2027-01-16 is a Saturday, not one of a Fridays-only khatma's days.
  expect(await code(create(t, who, { firstDate: "2027-01-16" }))).toBe(
    "invalid_dates",
  );
  expect(await code(create(t, who, { firstDate: "soon" }))).toBe(
    "invalid_dates",
  );
});

test("a daily khatma may start today and end later", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  await create(t, who, {
    days: { kind: "daily" },
    firstDate: "2027-01-15",
    endDate: "2027-01-15",
  });
});

async function daysOf(t: T, inviteCode: string) {
  return await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    return await ctx.db
      .query("rotaDays")
      .withIndex("by_khatma_n", (q) => q.eq("khatmaId", khatma!._id))
      .collect();
  });
}

function finishSetup(t: T, who: { token: string }, inviteCode: string) {
  return t.mutation(api.rota.finishSetup, {
    sessionToken: who.token,
    inviteCode,
  });
}

test("with the rule off, a khatma set up late on its first date starts that day once setup is done, with the people added", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  // 15:00 in Dubai.
  vi.setSystemTime(Date.UTC(2027, 0, 15, 11, 0, 0));
  const { inviteCode } = await create(t, who);
  for (const phone of ["+971506660001", "+971506660002"]) {
    await t.mutation(api.rota.addParticipant, {
      sessionToken: who.token,
      inviteCode,
      name: "قارئ",
      phone,
    });
  }
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await daysOf(t, inviteCode)).toEqual([]);

  expect(await finishSetup(t, who, inviteCode)).toEqual({ ok: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const days = await daysOf(t, inviteCode);
  expect(days.map((d) => [d.n, d.date])).toEqual([[1, "2027-01-15"]]);
  await t.run(async (ctx) => {
    const reads = await ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", days[0]!._id))
      .collect();
    const held = reads.filter((r) => r.holderId !== null).map((r) => r.juz);
    expect(held).toEqual([1, 2, 3]);
  });
});

test("no day starts while the khatma is still being set up", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  const { inviteCode } = await create(t, who);
  const khatmaId = await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    return khatma!._id;
  });
  // 15:00 on the first date, and the sweep ticks it.
  vi.setSystemTime(Date.UTC(2027, 0, 15, 11, 0, 0));
  await t.mutation(internal.rotaDays.tick, { khatmaId });
  await t.mutation(internal.rotaDays.sweep, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await daysOf(t, inviteCode)).toEqual([]);

  await finishSetup(t, who, inviteCode);
  await t.mutation(internal.rotaDays.tick, { khatmaId });
  expect((await daysOf(t, inviteCode)).map((d) => d.n)).toEqual([1]);
});

test("finishing setup twice keeps the first time, and only the organizer can", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  const { inviteCode } = await create(t, who);
  const doneAt = async () =>
    await t.run(async (ctx) => {
      const khatma = await ctx.db
        .query("khatmas")
        .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
        .unique();
      return khatma!.rota!.setupDoneAt;
    });
  await finishSetup(t, who, inviteCode);
  const first = await doneAt();
  // convex-test's clock may tick a millisecond or two inside a call.
  expect(first).toBeGreaterThanOrEqual(NOW);
  expect(first).toBeLessThan(NOW + 1000);
  vi.setSystemTime(NOW + 60_000);
  expect(await finishSetup(t, who, inviteCode)).toEqual({ ok: true });
  expect(await doneAt()).toBe(first);

  const stranger = await organizer(t);
  expect(await code(finishSetup(t, stranger, inviteCode))).toBe("forbidden");
});

test("a new khatma can't start today under the admin's rule", async () => {
  const t = convexTest(schema, modules);
  const who = await organizer(t);
  const start = (firstDate: string) =>
    t.action(api.rota.create, {
      sessionToken: who.token,
      name: "ختمة",
      days: { kind: "daily" },
      firstDate,
      endDate: null,
    });
  expect(await code(start("2027-01-15"))).toBe("invalid_dates");
  expect(await code(start("2027-01-16"))).toBeUndefined();
});
