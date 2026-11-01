import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { ADMIN_SESSION_TTL_MS } from "./lib/adminSession";
import { sha256Hex } from "./lib/crypto";
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
  return adminId;
}

let seq = 0;
async function person(t: T, phone: string, name = "سارة", sessions = 1) {
  return await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone,
      displayName: name,
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    });
    for (let i = 0; i < sessions; i++) {
      seq++;
      const sessionId = await ctx.db.insert("sessions", {
        personId,
        tokenHash: `t${seq}`,
        alertTokenHash: `a${seq}`,
        deviceLabel: `iPhone ${i}`,
        createdAt: NOW,
        lastUsedAt: NOW,
      });
      await ctx.db.insert("pushSubscriptions", {
        personId,
        sessionId,
        endpoint: `https://push.example/${seq}`,
        p256dh: "p",
        auth: "a",
        createdAt: NOW,
      });
    }
    return personId;
  });
}

/** A khatma organized by `organizer`, with `others` as active members. */
async function khatma(
  t: T,
  organizer: Id<"people">,
  others: Id<"people">[],
  name = "ختمة العائلة",
) {
  return await t.run(async (ctx) => {
    const khatmaId = await ctx.db.insert("khatmas", {
      name,
      schedule: "weekly",
      grace: { value: 2, unit: "days" },
      creatorPersonId: organizer,
      inviteCode: "familyKhatma",
      completedRounds: 0,
      createdAt: 0,
    });
    const roundId = await ctx.db.insert("rounds", {
      khatmaId,
      number: 1,
      startedAt: 0,
      targetEndAt: null,
      completedAt: null,
      lastFinishedAt: null,
      behindInvitedAt: null,
    });
    await ctx.db.patch(khatmaId, { currentRoundId: roundId });
    const memberIds: Id<"members">[] = [];
    for (const personId of [organizer, ...others]) {
      memberIds.push(
        await ctx.db.insert("members", {
          khatmaId,
          personId,
          joinedAt: memberIds.length,
          shareToken: `share${memberIds.length}`,
          status: "active",
          notificationsOn: false,
          lastNudgeAt: null,
          lastCelebratedRound: 0,
        }),
      );
    }
    // Juz' 1 finished and juz' 2 held by the first other member; 28 free.
    for (const [juz, finishedAt] of [
      [1, NOW - 1000],
      [2, null],
    ] as const) {
      await ctx.db.insert("assignments", {
        khatmaId,
        roundId,
        roundNumber: 1,
        juz,
        memberId: memberIds[1] ?? memberIds[0]!,
        personId: others[0] ?? organizer,
        takenAt: NOW - 5000,
        finishedAt,
        releasedAt: null,
        releasedBySystem: false,
        graceWakingMs: 1000,
        noticeAt: NOW,
        graceEndsAt: NOW + 1000,
        extended: false,
        noticeSentAt: null,
        openedForHelpAt: null,
        remindedAt: null,
      });
    }
    return { khatmaId, memberIds };
  });
}

const audit = (t: T) => t.run((ctx) => ctx.db.query("auditLog").collect());

test("find khatmas by invite code or a word of the name", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const ali = await person(t, "+971500000001", "علي");
  const { khatmaId } = await khatma(t, ali, [], "ختمة العائلة الكبيرة");
  const byCode = await t.query(api.adminLookup.findKhatmas, {
    adminToken: "admin",
    query: "familyKhatma",
  });
  expect(byCode[0]).toMatchObject({
    khatmaId,
    inviteCode: "familyKhatma",
    members: 1,
  });
  const byName = await t.query(api.adminLookup.findKhatmas, {
    adminToken: "admin",
    query: "العائلة",
  });
  expect(byName.map((k) => k.khatmaId)).toContain(khatmaId);
  expect(
    await t.query(api.adminLookup.findKhatmas, {
      adminToken: "admin",
      query: "ا",
    }),
  ).toEqual([]);
});

test("a khatma's page shows its pool as counts, never who holds what", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const ali = await person(t, "+971500000001", "علي");
  const sara = await person(t, "+971500000002", "سارة");
  const { khatmaId } = await khatma(t, ali, [sara]);
  const page = await t.query(api.adminLookup.khatma, {
    adminToken: "admin",
    khatmaId,
  });
  expect(page?.round).toMatchObject({
    number: 1,
    free: 28,
    taken: 1,
    finished: 1,
  });
  expect(page?.organizer).toEqual({ personId: ali, displayName: "علي" });
  expect(page?.members.map((m) => m.displayName)).toEqual(["علي", "سارة"]);
  // Members are listed, but nothing ties a juz' to a person.
  expect(JSON.stringify(page)).not.toMatch(/juz|assignment|pace/i);
});

test("find a person by phone, and their page", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const ali = await person(t, "+971500000001", "علي", 2);
  const { khatmaId } = await khatma(t, ali, []);
  expect(
    await t.query(api.adminLookup.findPerson, {
      adminToken: "admin",
      phone: "+971 50 000 0001",
    }),
  ).toMatchObject({ personId: ali, displayName: "علي", blocked: false });
  expect(
    await t.query(api.adminLookup.findPerson, {
      adminToken: "admin",
      phone: "0500",
    }),
  ).toEqual({ error: "invalid_phone" });
  expect(
    await t.query(api.adminLookup.findPerson, {
      adminToken: "admin",
      phone: "+971509999999",
    }),
  ).toEqual({ personId: null, blocked: false });

  const page = await t.query(api.adminLookup.person, {
    adminToken: "admin",
    personId: ali,
  });
  expect(page?.sessions).toHaveLength(2);
  expect(page?.khatmas).toEqual([
    {
      khatmaId,
      name: "ختمة العائلة",
      inviteCode: "familyKhatma",
      isOrganizer: true,
      status: "active",
      pending: false,
    },
  ]);
  expect(page?.blocked).toBe(false);
});

test("sign out everywhere ends every session and its push, and is audited", async () => {
  const t = convexTest(schema, modules);
  const adminId = await admin(t);
  const sara = await person(t, "+971500000002", "سارة", 3);
  expect(
    await t.mutation(api.adminOps.signOutEverywhere, {
      adminToken: "admin",
      personId: sara,
      note: "lost phone",
    }),
  ).toEqual({ ended: 3 });
  const left = await t.run(async (ctx) => ({
    sessions: (await ctx.db.query("sessions").collect()).length,
    push: (await ctx.db.query("pushSubscriptions").collect()).length,
  }));
  expect(left).toEqual({ sessions: 0, push: 0 });
  expect(await audit(t)).toMatchObject([
    {
      adminId,
      action: "person.signOutAll",
      targetKind: "person",
      targetId: sara,
      before: { sessions: 3 },
      note: "lost phone",
    },
  ]);
});

test("blocking signs the number out but leaves its khatmas alone", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const ali = await person(t, "+971500000001", "علي", 2);
  const { khatmaId } = await khatma(t, ali, []);

  expect(
    await t.mutation(api.adminOps.blockPhone, {
      adminToken: "admin",
      phone: "+971500000001",
    }),
  ).toEqual({ ok: true });
  expect(
    await t.mutation(api.adminOps.blockPhone, {
      adminToken: "admin",
      phone: "+971500000001",
    }),
  ).toEqual({ error: "already_blocked" });
  const state = await t.run(async (ctx) => ({
    sessions: (await ctx.db.query("sessions").collect()).length,
    organizer: (await ctx.db.get(khatmaId))?.creatorPersonId,
  }));
  expect(state).toEqual({ sessions: 0, organizer: ali });
  expect(
    (
      await t.query(api.adminLookup.person, {
        adminToken: "admin",
        personId: ali,
      })
    )?.blocked,
  ).toBe(true);

  expect(
    await t.mutation(api.adminOps.unblockPhone, {
      adminToken: "admin",
      phone: "+971500000001",
    }),
  ).toEqual({ ok: true });
  expect(
    await t.mutation(api.adminOps.unblockPhone, {
      adminToken: "admin",
      phone: "+971500000001",
    }),
  ).toEqual({ error: "not_blocked" });
  expect((await audit(t)).map((r) => r.action)).toEqual([
    "phone.block",
    "phone.unblock",
  ]);
});

test("reset invite gives the khatma a new code and members new links", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const ali = await person(t, "+971500000001", "علي");
  const sara = await person(t, "+971500000002", "سارة");
  const { khatmaId } = await khatma(t, ali, [sara]);
  const res = await t.action(api.adminOps.resetInvite, {
    adminToken: "admin",
    khatmaId,
    note: "leaked",
  });
  if (!("inviteCode" in res)) throw new Error(JSON.stringify(res));
  expect(res.inviteCode).not.toBe("familyKhatma");
  const members = await t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .collect(),
  );
  expect(
    members.every((m) => m.shareToken && !m.shareToken.startsWith("share")),
  ).toBe(true);
  expect(await audit(t)).toMatchObject([
    {
      action: "khatma.resetInvite",
      before: "familyKhatma",
      after: res.inviteCode,
      note: "leaked",
    },
  ]);
});

test("hand over moves the organizer and tells both", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const ali = await person(t, "+971500000001", "علي");
  const sara = await person(t, "+971500000002", "سارة");
  const { khatmaId, memberIds } = await khatma(t, ali, [sara]);
  expect(
    await t.mutation(api.adminOps.handOver, {
      adminToken: "admin",
      khatmaId,
      memberId: memberIds[0]!,
    }),
  ).toEqual({ error: "self" });
  expect(
    await t.mutation(api.adminOps.handOver, {
      adminToken: "admin",
      khatmaId,
      memberId: memberIds[1]!,
    }),
  ).toEqual({ ok: true });
  const after = await t.run(async (ctx) => ({
    organizer: (await ctx.db.get(khatmaId))?.creatorPersonId,
    notes: (await ctx.db.query("notes").collect()).map((n) => [
      n.personId,
      n.kind,
    ]),
  }));
  expect(after.organizer).toBe(sara);
  expect(after.notes).toEqual(
    expect.arrayContaining([
      [sara, "nowOrganizer"],
      [ali, "organizerMoved"],
    ]),
  );
  expect((await audit(t)).at(-1)).toMatchObject({
    action: "khatma.handOver",
    before: ali,
    after: sara,
  });
});

test("an admin moves an archived khatma quietly, with the usual audit row", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const ali = await person(t, "+971500000001", "علي");
  const sara = await person(t, "+971500000002", "سارة");
  const { khatmaId, memberIds } = await khatma(t, ali, [sara]);
  await t.run((ctx) => ctx.db.patch(khatmaId, { archivedAt: NOW }));

  expect(
    await t.mutation(api.adminOps.handOver, {
      adminToken: "admin",
      khatmaId,
      memberId: memberIds[1]!,
    }),
  ).toEqual({ ok: true });

  const after = await t.run(async (ctx) => ({
    organizer: (await ctx.db.get(khatmaId))?.creatorPersonId,
    notes: await ctx.db.query("notes").collect(),
  }));
  expect(after.organizer).toBe(sara);
  expect(after.notes).toEqual([]);
  expect((await audit(t)).at(-1)).toMatchObject({
    action: "khatma.handOver",
    before: ali,
    after: sara,
  });
});

test("an admin can reset an archived khatma's invite", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const ali = await person(t, "+971500000001", "علي");
  const { khatmaId } = await khatma(t, ali, []);
  await t.run((ctx) => ctx.db.patch(khatmaId, { archivedAt: NOW }));

  await t.action(api.adminOps.resetInvite, { adminToken: "admin", khatmaId });

  expect((await t.run((ctx) => ctx.db.get(khatmaId)))?.inviteCode).not.toBe(
    "familyKhatma",
  );
});

test("members can't reach lookups or operations", async () => {
  const t = convexTest(schema, modules);
  const sara = await person(t, "+971500000002");
  await expect(
    t.query(api.adminLookup.person, { adminToken: "member", personId: sara }),
  ).rejects.toThrow(/not_admin/);
  await expect(
    t.mutation(api.adminOps.signOutEverywhere, {
      adminToken: "member",
      personId: sara,
    }),
  ).rejects.toThrow(/not_admin/);
  await expect(
    t.action(api.adminOps.resetInvite, {
      adminToken: "member",
      khatmaId: "x" as never,
    }),
  ).rejects.toThrow();
});

test("an admin's number can't be blocked", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  expect(
    await t.mutation(api.adminOps.blockPhone, {
      adminToken: "admin",
      phone: "+971500000099",
    }),
  ).toEqual({ error: "is_admin" });
  expect(
    await t.run((ctx) => ctx.db.query("blockedPhones").collect()),
  ).toHaveLength(0);
});

test("an admin turns rotating khatmas on and off for a person, with one audit row each", async () => {
  const t = convexTest(schema, modules);
  const adminId = await admin(t);
  const sara = await person(t, "+971500000002", "سارة");
  const flag = () =>
    t.run(async (ctx) => (await ctx.db.get(sara))?.rotaAllowed);

  expect(
    await t.query(api.adminLookup.person, {
      adminToken: "admin",
      personId: sara,
    }),
  ).toMatchObject({ rotaAllowed: false });
  expect(
    await t.mutation(api.adminOps.setRotaAllowed, {
      adminToken: "admin",
      personId: sara,
      allowed: true,
      note: "asked on WhatsApp",
    }),
  ).toEqual({ ok: true });
  expect(await flag()).toBe(true);
  expect(await audit(t)).toMatchObject([
    {
      adminId,
      action: "person.rotaAllowed",
      targetKind: "person",
      targetId: sara,
      before: { rotaAllowed: false },
      after: { rotaAllowed: true },
      note: "asked on WhatsApp",
    },
  ]);
  expect(
    await t.query(api.adminLookup.person, {
      adminToken: "admin",
      personId: sara,
    }),
  ).toMatchObject({ rotaAllowed: true });

  await t.mutation(api.adminOps.setRotaAllowed, {
    adminToken: "admin",
    personId: sara,
    allowed: false,
  });
  expect(await flag()).toBe(false);
  expect(await audit(t)).toHaveLength(2);
});

test("turning rotating khatmas on tells the person on their newest khatma, once, and not when turning off", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const sara = await person(t, "+971500000002", "سارة");
  const organized = (name: string, inviteCode: string, createdAt: number) =>
    t.run(async (ctx) => {
      const khatmaId = await ctx.db.insert("khatmas", {
        name,
        schedule: "weekly",
        grace: { value: 2, unit: "days" },
        creatorPersonId: sara,
        inviteCode,
        completedRounds: 0,
        createdAt,
      });
      await ctx.db.insert("members", {
        khatmaId,
        personId: sara,
        joinedAt: createdAt,
        status: "active",
        notificationsOn: false,
        lastNudgeAt: null,
        lastCelebratedRound: 0,
      });
      return khatmaId;
    });
  const older = await organized("القديمة", "oldKhatma001", 1);
  const newer = await organized("الجديدة", "newKhatma001", 2);
  const archived = await organized("المؤرشفة", "arcKhatma001", 3);
  await t.run((ctx) => ctx.db.patch(archived, { archivedAt: NOW }));
  const notes = () => t.run((ctx) => ctx.db.query("notes").collect());
  const set = (allowed: boolean) =>
    t.mutation(api.adminOps.setRotaAllowed, {
      adminToken: "admin",
      personId: sara,
      allowed,
    });

  await set(true);
  expect(await notes()).toMatchObject([
    { personId: sara, khatmaId: newer, kind: "rotaEnabled" },
  ]);
  expect(older).not.toBe(newer);

  // Already on: switching on again says nothing new.
  await set(true);
  expect(await notes()).toHaveLength(1);
  await set(false);
  expect(await notes()).toHaveLength(1);
});

test("turning rotating khatmas on for a person with no khatma of their own sends no note", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const sara = await person(t, "+971500000002", "سارة");
  const ali = await person(t, "+971500000001", "علي");
  // A member of someone else's khatma is not an organizer.
  await khatma(t, ali, [sara]);
  expect(
    await t.mutation(api.adminOps.setRotaAllowed, {
      adminToken: "admin",
      personId: sara,
      allowed: true,
    }),
  ).toEqual({ ok: true });
  expect(await t.run((ctx) => ctx.db.query("notes").collect())).toEqual([]);
  expect(await audit(t)).toHaveLength(1);
});

test("setting rota access for a person who is gone is not_found, and needs an admin", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const sara = await person(t, "+971500000002", "سارة");
  await t.run((ctx) => ctx.db.delete(sara));
  expect(
    await t.mutation(api.adminOps.setRotaAllowed, {
      adminToken: "admin",
      personId: sara,
      allowed: true,
    }),
  ).toEqual({ error: "not_found" });
  expect(await audit(t)).toHaveLength(0);
  await expect(
    t.mutation(api.adminOps.setRotaAllowed, {
      adminToken: "member",
      personId: sara,
      allowed: true,
    }),
  ).rejects.toThrow(/not_admin/);
});

test("a rota khatma's page shows its day as counts, a pool khatma's shows no rota", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const ali = await person(t, "+971500000001", "علي");
  const pool = await khatma(t, ali, []);
  const poolPage = await t.query(api.adminLookup.khatma, {
    adminToken: "admin",
    khatmaId: pool.khatmaId,
  });
  expect(poolPage).toMatchObject({ kind: "pool", rota: null });

  const khatmaId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("khatmas", {
      name: "ختمة التناوب",
      schedule: "weekly",
      grace: { value: 2, unit: "days" },
      creatorPersonId: ali,
      inviteCode: "rotaKhatma1",
      completedRounds: 0,
      createdAt: 0,
      kind: "rota",
      rota: {
        days: { kind: "daily" },
        firstDate: "2026-10-01",
        endDate: null,
        timeZone: "Asia/Dubai",
        messages: {
          dayAt: 480,
          reminder: { at: 960, on: true },
          unread: { at: 1140, on: true },
          summary: { at: 1260, on: false },
        },
        pausedAt: null,
        pauseDates: [],
        archivedAt: null,
      },
    });
    const day = async (n: number, closedAt: number | null) =>
      await ctx.db.insert("rotaDays", {
        khatmaId: id,
        n,
        number: n,
        cycle: 1,
        date: `2026-10-0${n}`,
        startedAt: 0,
        closesAt: 0,
        completedAt: null,
        closedAt,
        unreadSentAt: null,
        summarySentAt: null,
      });
    const closed = await day(1, 5);
    const open = await day(2, null);
    for (const [dayId, done] of [
      [closed, 30],
      [open, 27],
    ] as const) {
      for (let juz = 1; juz <= 30; juz++) {
        await ctx.db.insert("rotaReads", {
          dayId,
          khatmaId: id,
          juz,
          slot: juz,
          holderId: null,
          readerId: null,
          doneAt: juz <= done ? 1 : null,
          doneByOrganizer: false,
          reassignedAt: null,
        });
      }
    }
    return id;
  });
  const page = await t.query(api.adminLookup.khatma, {
    adminToken: "admin",
    khatmaId,
  });
  expect(page).toMatchObject({
    kind: "rota",
    rota: {
      days: { kind: "daily" },
      firstDate: "2026-10-01",
      endDate: null,
      pausedAt: null,
      archivedAt: null,
      number: 2,
      cycle: 1,
      dayOpen: true,
      doneToday: 27,
      total: 30,
    },
  });
});
