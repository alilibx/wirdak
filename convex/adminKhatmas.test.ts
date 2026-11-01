import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { ADMIN_SESSION_TTL_MS } from "./lib/adminSession";
import { sha256Hex } from "./lib/crypto";
import { isArchived } from "./lib/khatma";
import type { RotaMessages } from "./lib/rota";
import { foldText } from "./lib/searchFold";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

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

async function person(t: T, phone: string, name: string) {
  return await t.run((ctx) =>
    ctx.db.insert("people", {
      phone,
      displayName: name,
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    }),
  );
}

/** A pool khatma of an organizer and a reader, whose round has one hold of the reader's. */
async function pool(
  t: T,
  hold: Partial<Doc<"assignments">> = {},
  fields: Partial<Doc<"khatmas">> = {},
) {
  const organizer = await person(t, "+971500000001", "علي");
  const reader = await person(t, "+971500000002", "سارة");
  return await t.run(async (ctx) => {
    const khatmaId = await ctx.db.insert("khatmas", {
      name: "ختمة العائلة",
      schedule: "weekly",
      grace: { value: 2, unit: "days" },
      creatorPersonId: organizer,
      inviteCode: "familyKhatma",
      completedRounds: 0,
      createdAt: 0,
      ...fields,
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
    const member = (personId: Id<"people">, joinedAt: number) =>
      ctx.db.insert("members", {
        khatmaId,
        personId,
        joinedAt,
        shareToken: `share${joinedAt}`,
        status: "active",
        notificationsOn: false,
        lastNudgeAt: null,
        lastCelebratedRound: 0,
      });
    const organizerMember = await member(organizer, 0);
    const readerMember = await member(reader, 1);
    const assignmentId = await ctx.db.insert("assignments", {
      khatmaId,
      roundId,
      roundNumber: 1,
      juz: 2,
      memberId: readerMember,
      personId: reader,
      takenAt: NOW - HOUR,
      finishedAt: null,
      releasedAt: null,
      releasedBySystem: false,
      graceWakingMs: 1000,
      noticeAt: NOW + HOUR,
      graceEndsAt: NOW + 2 * HOUR,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
      ...hold,
    });
    return {
      khatmaId,
      roundId,
      organizer,
      reader,
      organizerMember,
      readerMember,
      assignmentId,
    };
  });
}

const MESSAGES: RotaMessages = {
  dayAt: 480,
  reminder: { at: 960, on: true },
  unread: { at: 1140, on: true },
  summary: { at: 1260, on: false },
};

const rotaConfig = (archivedAt: number | null) => ({
  days: { kind: "daily" as const },
  firstDate: "2027-01-15",
  endDate: null,
  timeZone: "Asia/Dubai",
  messages: MESSAGES,
  pausedAt: null,
  pauseDates: [],
  archivedAt,
});

const auth = { adminToken: "admin" };
const audit = (t: T) => t.run((ctx) => ctx.db.query("auditLog").collect());
const scheduled = (t: T) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const pending = async (t: T, name: string) =>
  (await scheduled(t)).filter(
    (job) => job.state.kind === "pending" && job.name.includes(name),
  );
const openNotes = (t: T, kind: Doc<"notes">["kind"]) =>
  t.run(async (ctx) =>
    (await ctx.db.query("notes").collect()).filter(
      (n) => n.kind === kind && n.clearedAt === null,
    ),
  );

test("every khatma change needs an admin", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await pool(t);
  await expect(
    t.mutation(api.adminKhatmas.archive, { adminToken: "nope", khatmaId }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.adminKhatmas.update, {
      adminToken: "nope",
      khatmaId,
      name: "x",
    }),
  ).rejects.toThrow();
  expect(isArchived((await t.run((ctx) => ctx.db.get(khatmaId)))!)).toBe(false);
});

test("update renames a pool khatma and keeps its list name, recording both", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t);
  expect(
    await t.mutation(api.adminKhatmas.update, {
      ...auth,
      khatmaId,
      name: "  ختمة  الأصدقاء ",
      schedule: "daily",
      grace: { value: 6, unit: "hours" },
      note: "طلب المنظّم",
    }),
  ).toEqual({ ok: true });
  const k = (await t.run((ctx) => ctx.db.get(khatmaId)))!;
  expect(k).toMatchObject({
    name: "ختمة الأصدقاء",
    searchName: foldText("ختمة الأصدقاء"),
    schedule: "daily",
    grace: { value: 6, unit: "hours" },
  });
  expect(await audit(t)).toMatchObject([
    {
      action: "khatma.update",
      targetKind: "khatma",
      targetId: khatmaId,
      before: { name: "ختمة العائلة", schedule: "weekly" },
      after: { name: "ختمة الأصدقاء", schedule: "daily" },
      note: "طلب المنظّم",
    },
  ]);
});

test("update refuses a bad grace and changes nothing", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t);
  expect(
    await t.mutation(api.adminKhatmas.update, {
      ...auth,
      khatmaId,
      name: "اسم جديد",
      grace: { value: 5, unit: "minutes" },
    }),
  ).toEqual({ error: "invalid_grace" });
  expect((await t.run((ctx) => ctx.db.get(khatmaId)))!.name).toBe(
    "ختمة العائلة",
  );
  expect(await audit(t)).toEqual([]);
});

test("update refuses a name with no letters and keeps the old one", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t);
  expect(
    await t.mutation(api.adminKhatmas.update, {
      ...auth,
      khatmaId,
      name: " ... ",
    }),
  ).toEqual({ error: "invalid_name" });
  expect((await t.run((ctx) => ctx.db.get(khatmaId)))!.name).toBe(
    "ختمة العائلة",
  );
  expect(await audit(t)).toEqual([]);
});

test("update clears the name when it's blank or null", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t);
  expect(
    await t.mutation(api.adminKhatmas.update, {
      ...auth,
      khatmaId,
      name: null,
    }),
  ).toEqual({ ok: true });
  expect((await t.run((ctx) => ctx.db.get(khatmaId)))!.name).toBeNull();
});

test("update leaves an archived khatma read-only and a rota khatma to its own tools", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t, {}, { archivedAt: NOW });
  expect(
    await t.mutation(api.adminKhatmas.update, {
      ...auth,
      khatmaId,
      name: "اسم",
    }),
  ).toEqual({ error: "archived" });
  await t.run((ctx) =>
    ctx.db.patch(khatmaId, {
      kind: "rota",
      archivedAt: null,
      rota: rotaConfig(null),
    }),
  );
  expect(
    await t.mutation(api.adminKhatmas.update, {
      ...auth,
      khatmaId,
      name: "اسم",
    }),
  ).toEqual({ error: "rota" });
});

test("archive stamps the khatma, clears its notes and is recorded once", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId, reader, assignmentId } = await pool(t);
  await t.run((ctx) =>
    ctx.db.insert("notes", {
      personId: reader,
      khatmaId,
      kind: "almostUp",
      juz: [2],
      count: null,
      until: null,
      assignmentId,
      roundNumber: 1,
      createdAt: NOW,
      pushedAt: null,
      clearedAt: null,
    }),
  );
  const args = { ...auth, khatmaId, note: "مهجورة" };
  expect(await t.mutation(api.adminKhatmas.archive, args)).toEqual({
    ok: true,
  });
  expect(await t.mutation(api.adminKhatmas.archive, args)).toEqual({
    ok: true,
  });
  expect(isArchived((await t.run((ctx) => ctx.db.get(khatmaId)))!)).toBe(true);
  expect(await openNotes(t, "almostUp")).toEqual([]);
  expect(await audit(t)).toMatchObject([
    { action: "khatma.archive", targetId: khatmaId, note: "مهجورة" },
  ]);
});

test("remove refuses a khatma that isn't archived", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t);
  expect(
    await t.mutation(api.adminKhatmas.remove, { ...auth, khatmaId }),
  ).toEqual({ error: "not_archived" });
  expect(await t.run((ctx) => ctx.db.get(khatmaId))).not.toBeNull();
});

test("remove deletes an archived khatma and its members, keeping the name in the audit", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t, {}, { archivedAt: NOW });
  expect(
    await t.mutation(api.adminKhatmas.remove, { ...auth, khatmaId }),
  ).toEqual({ ok: true });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(khatmaId)).toBeNull();
    expect(await ctx.db.query("members").collect()).toEqual([]);
  });
  expect(await audit(t)).toMatchObject([
    {
      action: "khatma.delete",
      targetId: khatmaId,
      before: { name: "ختمة العائلة", kind: "pool" },
    },
  ]);
});

test("archive and remove work on a rota khatma too", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t);
  await t.run(async (ctx) => {
    await ctx.db.patch(khatmaId, {
      kind: "rota",
      currentRoundId: undefined,
      rota: rotaConfig(null),
    });
  });
  await t.mutation(api.adminKhatmas.archive, { ...auth, khatmaId });
  expect(isArchived((await t.run((ctx) => ctx.db.get(khatmaId)))!)).toBe(true);
  expect(
    await t.mutation(api.adminKhatmas.remove, { ...auth, khatmaId }),
  ).toEqual({ ok: true });
});

test("restore reopens a pool khatma", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t, {}, { archivedAt: NOW - HOUR });
  expect(
    await t.mutation(api.adminKhatmas.restore, {
      ...auth,
      khatmaId,
      note: "بالخطأ",
    }),
  ).toEqual({ ok: true });
  expect(isArchived((await t.run((ctx) => ctx.db.get(khatmaId)))!)).toBe(false);
  expect(await audit(t)).toMatchObject([
    { action: "khatma.restore", targetId: khatmaId, note: "بالخطأ" },
  ]);
});

test("restore gives a hold the time it had left when the archive began", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  // Archived with 1 hour to the notice and 2 to the end; both passed since.
  const { khatmaId, assignmentId } = await pool(
    t,
    { noticeAt: NOW - 2 * HOUR, graceEndsAt: NOW - HOUR },
    { archivedAt: NOW - 3 * HOUR },
  );
  await t.mutation(api.adminKhatmas.restore, { ...auth, khatmaId });
  const a = (await t.run((ctx) => ctx.db.get(assignmentId)))!;
  expect(a.openedForHelpAt).toBeNull();
  expect(a.noticeAt).toBeGreaterThanOrEqual(NOW + HOUR);
  expect(a.graceEndsAt).toBeGreaterThanOrEqual(NOW + 2 * HOUR);
  expect(a.graceEndsAt).toBeLessThan(NOW + 2 * HOUR + 60_000);
  expect(await pending(t, "noticeDue")).toHaveLength(1);
  expect(await pending(t, "endDue")).toHaveLength(1);
});

test("a restored hold opens for help only when the time it had left runs out", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const oldEnd = NOW + HOUR;
  const { khatmaId, assignmentId } = await pool(
    t,
    { noticeAt: NOW, graceEndsAt: oldEnd },
    { archivedAt: NOW - HOUR },
  );
  await t.mutation(api.adminKhatmas.restore, { ...auth, khatmaId });
  const moved = (await t.run((ctx) => ctx.db.get(assignmentId)))!;

  // The job queued before the archive is stale now.
  await t.mutation(internal.grace.endDue, { assignmentId, endsAt: oldEnd });
  expect(
    (await t.run((ctx) => ctx.db.get(assignmentId)))!.openedForHelpAt,
  ).toBeNull();

  vi.setSystemTime(moved.graceEndsAt);
  await t.mutation(internal.grace.endDue, {
    assignmentId,
    endsAt: moved.graceEndsAt,
  });
  expect(
    (await t.run((ctx) => ctx.db.get(assignmentId)))!.openedForHelpAt,
  ).not.toBeNull();
});

test("a notice job queued before the archive waits for the hold's new time", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId, assignmentId } = await pool(
    t,
    { noticeAt: NOW + HOUR, graceEndsAt: NOW + 2 * HOUR },
    { archivedAt: NOW - HOUR },
  );
  await t.mutation(api.adminKhatmas.restore, { ...auth, khatmaId });
  await t.mutation(internal.grace.noticeDue, { assignmentId });
  const before = (await t.run((ctx) => ctx.db.get(assignmentId)))!;
  expect(before.noticeSentAt).toBeNull();

  vi.setSystemTime(before.noticeAt);
  await t.mutation(internal.grace.noticeDue, { assignmentId });
  expect(
    (await t.run((ctx) => ctx.db.get(assignmentId)))!.noticeSentAt,
  ).not.toBeNull();
});

test("restore tells the organizer again about a juz' already open for help", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(
    t,
    { openedForHelpAt: NOW - 3 * HOUR, graceEndsAt: NOW - 3 * HOUR },
    { archivedAt: NOW - 2 * HOUR },
  );
  await t.mutation(api.adminKhatmas.restore, { ...auth, khatmaId });
  expect(await openNotes(t, "openForHelp")).toHaveLength(1);
});

test("restore completes a round that reached 30 ajza' before the archive", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId, roundId, reader, readerMember } = await pool(
    t,
    { finishedAt: NOW - 100 * HOUR },
    { archivedAt: NOW - HOUR },
  );
  await t.run(async (ctx) => {
    for (let juz = 1; juz <= 30; juz++) {
      if (juz === 2) continue;
      await ctx.db.insert("assignments", {
        khatmaId,
        roundId,
        roundNumber: 1,
        juz,
        memberId: readerMember,
        personId: reader,
        takenAt: NOW - 200 * HOUR,
        finishedAt: NOW - 100 * HOUR,
        releasedAt: null,
        releasedBySystem: false,
        graceWakingMs: 1000,
        noticeAt: NOW,
        graceEndsAt: NOW,
        extended: false,
        noticeSentAt: null,
        openedForHelpAt: null,
        remindedAt: null,
      });
    }
    await ctx.db.patch(roundId, { lastFinishedAt: NOW - 100 * HOUR });
  });
  await t.mutation(api.adminKhatmas.restore, { ...auth, khatmaId });
  expect(await pending(t, "completeIfReady")).toHaveLength(1);
  const result = await t.mutation(internal.rounds.completeIfReady, { roundId });
  expect(result).toEqual({ completed: true });
});

test("restore refuses a rota khatma, a live khatma and a missing one", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId } = await pool(t);
  expect(
    await t.mutation(api.adminKhatmas.restore, { ...auth, khatmaId }),
  ).toEqual({ error: "not_archived" });
  await t.run((ctx) =>
    ctx.db.patch(khatmaId, {
      kind: "rota",
      rota: rotaConfig(NOW),
    }),
  );
  expect(
    await t.mutation(api.adminKhatmas.restore, { ...auth, khatmaId }),
  ).toEqual({ error: "rota" });
  await t.run((ctx) => ctx.db.delete(khatmaId));
  expect(
    await t.mutation(api.adminKhatmas.restore, { ...auth, khatmaId }),
  ).toEqual({ error: "not_found" });
  expect(await audit(t)).toEqual([]);
});

test("removeMember blocks the member and frees the juz' they held", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId, readerMember, assignmentId } = await pool(t);
  expect(
    await t.mutation(api.adminKhatmas.removeMember, {
      ...auth,
      khatmaId,
      memberId: readerMember,
      note: "رابط مسرّب",
    }),
  ).toEqual({ ok: true });
  await t.run(async (ctx) => {
    expect((await ctx.db.get(readerMember))!.status).toBe("blocked");
    expect((await ctx.db.get(assignmentId))!.releasedBySystem).toBe(true);
  });
  expect(await audit(t)).toMatchObject([
    { action: "khatma.removeMember", targetId: khatmaId, note: "رابط مسرّب" },
  ]);
});

test("removeMember leaves the organizer and an archived khatma alone", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId, organizerMember, readerMember } = await pool(t);
  expect(
    await t.mutation(api.adminKhatmas.removeMember, {
      ...auth,
      khatmaId,
      memberId: organizerMember,
    }),
  ).toEqual({ error: "self" });
  await t.run((ctx) => ctx.db.patch(khatmaId, { archivedAt: NOW }));
  expect(
    await t.mutation(api.adminKhatmas.removeMember, {
      ...auth,
      khatmaId,
      memberId: readerMember,
    }),
  ).toEqual({ error: "archived" });
});

test("unblockMember makes a blocked member a former one", async () => {
  const t = convexTest(schema, modules);
  await admin(t);
  const { khatmaId, readerMember } = await pool(t);
  expect(
    await t.mutation(api.adminKhatmas.unblockMember, {
      ...auth,
      khatmaId,
      memberId: readerMember,
    }),
  ).toEqual({ error: "not_member" });
  await t.run((ctx) => ctx.db.patch(readerMember, { status: "blocked" }));
  expect(
    await t.mutation(api.adminKhatmas.unblockMember, {
      ...auth,
      khatmaId,
      memberId: readerMember,
    }),
  ).toEqual({ ok: true });
  expect((await t.run((ctx) => ctx.db.get(readerMember)))!.status).toBe(
    "former",
  );
  expect(await audit(t)).toMatchObject([
    { action: "khatma.unblockMember", targetId: khatmaId },
  ]);
});
