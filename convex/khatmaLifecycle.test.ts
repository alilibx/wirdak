import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { DEFAULT_GRACE } from "./lib/grace";
import { isArchived } from "./lib/khatma";
import type { RotaMessages } from "./lib/rota";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2027-01-15 12:00 in Asia/Dubai (UTC+4). */
const NOW = 1_800_000_000_000;
const TZ = "Asia/Dubai";
const TODAY = "2027-01-15";

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

const MESSAGES: RotaMessages = {
  dayAt: 480,
  reminder: { at: 960, on: true },
  unread: { at: 1140, on: true },
  summary: { at: 1260, on: false },
};

let seq = 0;

async function signedIn(t: T, displayName: string) {
  seq += 1;
  const token = `lifecycle-token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const phone = `+97156000${String(seq).padStart(4, "0")}`;
  const ids = await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone,
      displayName,
      verifiedAt: 0,
      timeZone: TZ,
      lastSeenAt: NOW,
    });
    const sessionId = await ctx.db.insert("sessions", {
      personId,
      tokenHash,
      alertTokenHash: `lifecycle-alert-${seq}`,
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    return { personId, sessionId };
  });
  return { ...ids, token, phone };
}
type Who = Awaited<ReturnType<typeof signedIn>>;

async function byCode(t: T, inviteCode: string): Promise<Doc<"khatmas">> {
  const khatma = await t.run((ctx) =>
    ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique(),
  );
  if (!khatma) throw new Error("no khatma");
  return khatma;
}

/** A daily pool khatma (6-hour grace) run by `who`, without moving the clock. */
async function poolKhatma(t: T, who: Who) {
  const at = Date.now();
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: who.token,
    name: null,
    schedule: "daily",
  });
  vi.setSystemTime(at);
  return { code: inviteCode, khatma: await byCode(t, inviteCode) };
}

async function join(t: T, khatmaId: Id<"khatmas">, who: Who) {
  await t.run((ctx) =>
    ctx.db.insert("members", {
      khatmaId,
      personId: who.personId,
      joinedAt: NOW,
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    }),
  );
}

/** A finished row for `juz`, finished at `finishedAt`. */
async function insertDone(
  t: T,
  khatma: Doc<"khatmas">,
  who: Who,
  juz: number,
  finishedAt = NOW,
) {
  await t.run(async (ctx) => {
    const member = await ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatma._id).eq("personId", who.personId),
      )
      .unique();
    if (!member || !khatma.currentRoundId) throw new Error("bad fixture");
    await ctx.db.insert("assignments", {
      khatmaId: khatma._id,
      roundId: khatma.currentRoundId,
      roundNumber: 1,
      juz,
      memberId: member._id,
      personId: who.personId,
      takenAt: finishedAt - DAY,
      finishedAt,
      releasedAt: null,
      releasedBySystem: false,
      graceWakingMs: 6 * HOUR,
      noticeAt: finishedAt,
      graceEndsAt: finishedAt,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    });
  });
}

/** A rota khatma with an open day dated today, its organizer on slot 1, and one joined reader. */
async function rotaKhatma(t: T, org: Who) {
  seq += 1;
  const inviteCode = `rotacode${String(seq).padStart(4, "0")}`;
  const ids = await t.run(async (ctx) => {
    const khatmaId = await ctx.db.insert("khatmas", {
      name: "ختمة",
      schedule: "none",
      grace: DEFAULT_GRACE.none,
      creatorPersonId: org.personId,
      inviteCode,
      joinCode: `JC${seq}`,
      completedRounds: 0,
      createdAt: 0,
      kind: "rota",
      rota: {
        days: { kind: "daily" },
        firstDate: TODAY,
        endDate: null,
        timeZone: TZ,
        messages: MESSAGES,
        pausedAt: null,
        pauseDates: [],
        archivedAt: null,
      },
    });
    await ctx.db.insert("members", {
      khatmaId,
      personId: org.personId,
      joinedAt: 0,
      shareToken: "share",
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    const participantId = await ctx.db.insert("rotaParticipants", {
      khatmaId,
      name: "قارئ",
      phone: `+97157000${String(seq).padStart(4, "0")}`,
      personId: null,
      addedAt: 0,
      removedAt: null,
      joinedAt: 0,
    });
    await ctx.db.insert("rotaSlots", { khatmaId, slot: 1, participantId });
    const dayId = await ctx.db.insert("rotaDays", {
      khatmaId,
      n: 1,
      number: 1,
      cycle: 1,
      date: TODAY,
      startedAt: NOW - HOUR,
      closesAt: NOW + DAY,
      completedAt: null,
      closedAt: null,
      unreadSentAt: null,
      summarySentAt: null,
      reminderSentAt: null,
    });
    const readId = await ctx.db.insert("rotaReads", {
      dayId,
      khatmaId,
      juz: 1,
      slot: 1,
      holderId: participantId,
      readerId: participantId,
      doneAt: null,
      doneByOrganizer: false,
      reassignedAt: null,
    });
    const row = {
      khatmaId,
      participantId,
      dayId,
      juz: [1],
      number: 1,
      createdAt: NOW,
      skippedAt: null,
    };
    const unsentId = await ctx.db.insert("rotaOutbox", {
      ...row,
      kind: "juz",
      sentAt: null,
    });
    const sentId = await ctx.db.insert("rotaOutbox", {
      ...row,
      kind: "reminder",
      sentAt: NOW - 1,
    });
    await ctx.db.insert("rotaJoinRequests", {
      khatmaId,
      phone: "+971570009999",
      profileName: null,
      createdAt: NOW,
      resolvedAt: null,
      outcome: null,
    });
    return { khatmaId, participantId, dayId, readId, unsentId, sentId };
  });
  return { ...ids, code: inviteCode };
}

async function noteFor(
  t: T,
  who: Who,
  khatmaId: Id<"khatmas">,
  clearedAt: number | null = null,
) {
  return await t.run((ctx) =>
    ctx.db.insert("notes", {
      personId: who.personId,
      khatmaId,
      kind: "reminder",
      juz: [1],
      count: null,
      until: null,
      assignmentId: null,
      roundNumber: null,
      createdAt: NOW,
      pushedAt: null,
      clearedAt,
    }),
  );
}

const pendingNames = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect())
      .filter((f) => f.state.kind === "pending")
      .map((f) => f.name),
  );

async function holdOf(t: T, khatma: Doc<"khatmas">, who: Who) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("assignments")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatma._id).eq("personId", who.personId),
      )
      .collect(),
  );
  const hold = rows[0];
  if (!hold) throw new Error("no hold");
  return hold;
}

// ---------------------------------------------------------------------------
// isArchived

test("isArchived reads a pool khatma's field and a rota khatma's", () => {
  const pool = { archivedAt: null } as Doc<"khatmas">;
  expect(isArchived(pool)).toBe(false);
  expect(isArchived({} as Doc<"khatmas">)).toBe(false);
  expect(isArchived({ archivedAt: 5 } as Doc<"khatmas">)).toBe(true);
  const rota = (archivedAt: number | null) =>
    ({ kind: "rota", rota: { archivedAt } }) as Doc<"khatmas">;
  expect(isArchived(rota(null))).toBe(false);
  expect(isArchived(rota(5))).toBe(true);
});

// ---------------------------------------------------------------------------
// Archive

test("archive stamps a pool khatma once and clears its uncleared notes", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatma } = await poolKhatma(t, org);
  const open = await noteFor(t, org, khatma._id);
  const cleared = await noteFor(t, org, khatma._id, NOW - DAY);

  expect(
    await t.mutation(api.khatmaLifecycle.archive, {
      sessionToken: org.token,
      inviteCode: code,
    }),
  ).toEqual({ ok: true });

  const stamp = (await byCode(t, code)).archivedAt;
  expect(stamp).toBeGreaterThanOrEqual(NOW);
  const notes = await t.run(async (ctx) => [
    await ctx.db.get(open),
    await ctx.db.get(cleared),
  ]);
  expect(notes[0]?.clearedAt).toBe(stamp);
  expect(notes[1]?.clearedAt).toBe(NOW - DAY);

  vi.setSystemTime(NOW + HOUR);
  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: code,
  });
  expect((await byCode(t, code)).archivedAt).toBe(stamp);
});

test("archive stamps a rota khatma, skips its unsent rows and closes its open day", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, dayId, unsentId, sentId } = await rotaKhatma(t, org);

  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: code,
  });

  const khatma = await byCode(t, code);
  const stamp = khatma.rota?.archivedAt;
  expect(stamp).toBeGreaterThanOrEqual(NOW);
  expect(khatma.archivedAt).toBeUndefined();
  const [unsent, sent, day] = await t.run(async (ctx) => [
    await ctx.db.get(unsentId),
    await ctx.db.get(sentId),
    await ctx.db.get(dayId),
  ]);
  expect(unsent).toMatchObject({ sentAt: null, skippedAt: stamp });
  expect(sent).toMatchObject({ sentAt: NOW - 1, skippedAt: null });
  expect(day?.closedAt).toBe(stamp);
});

test("archive declines a rota khatma's open join requests", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatmaId } = await rotaKhatma(t, org);

  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: code,
  });

  const stamp = (await byCode(t, code)).rota?.archivedAt;
  const requests = await t.run((ctx) =>
    ctx.db
      .query("rotaJoinRequests")
      .withIndex("by_khatma_open", (q) => q.eq("khatmaId", khatmaId))
      .collect(),
  );
  expect(requests).toMatchObject([
    { resolvedAt: stamp, outcome: "declined", declinedBy: "organizer" },
  ]);
});

test("an archived rota khatma promises no next day, paused or not", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code } = await rotaKhatma(t, org);
  const args = { sessionToken: org.token, inviteCode: code };
  expect((await t.query(api.rota.people, args))?.target.date).not.toBeNull();

  await t.mutation(api.khatmaLifecycle.archive, args);

  expect((await t.query(api.rota.people, args))?.target.date).toBeNull();
  expect((await t.query(api.rota.today, args))?.next.date).toBeNull();
  expect((await t.query(api.rota.people, args))?.archived).toBe(true);
});

test("archive leaves a rota khatma's unsent cycle thank-you to go out", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatmaId, participantId, dayId } = await rotaKhatma(t, org);
  const cycleId = await t.run((ctx) =>
    ctx.db.insert("rotaOutbox", {
      khatmaId,
      participantId,
      dayId,
      kind: "cycle",
      juz: [],
      number: 30,
      createdAt: NOW,
      sentAt: null,
      skippedAt: null,
    }),
  );

  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: code,
  });

  expect(await t.run((ctx) => ctx.db.get(cycleId))).toMatchObject({
    sentAt: null,
    skippedAt: null,
  });
});

test("archive clears a rota organizer's notes, so none waits on quiet hours or sticks to the card", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatmaId } = await rotaKhatma(t, org);
  const noteId = await noteFor(t, org, khatmaId);
  await t.run((ctx) =>
    ctx.db.insert("pushSubscriptions", {
      personId: org.personId,
      sessionId: org.sessionId,
      endpoint: "https://push.example/org",
      p256dh: "p",
      auth: "a",
      createdAt: NOW,
    }),
  );
  const hasNote = async () =>
    (await t.query(api.khatmas.mine, { sessionToken: org.token }))[0]?.hasNote;
  expect(await hasNote()).toBe(true);
  expect(await t.query(internal.push.deliveryPlan, { noteId })).not.toBeNull();

  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: code,
  });

  expect(await hasNote()).toBe(false);
  expect(await t.query(internal.push.deliveryPlan, { noteId })).toBeNull();
});

test("only the khatma's organizer can archive or delete it", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const reader = await signedIn(t, "قارئ");
  const { code, khatma } = await poolKhatma(t, org);
  await join(t, khatma._id, reader);
  const args = { sessionToken: reader.token, inviteCode: code };

  await expect(
    t.mutation(api.khatmaLifecycle.archive, args),
  ).rejects.toMatchObject({ data: { code: "forbidden" } });
  await expect(
    t.mutation(api.khatmaLifecycle.remove, args),
  ).rejects.toMatchObject({ data: { code: "forbidden" } });
  expect((await byCode(t, code)).archivedAt).toBeUndefined();
});

test("view and mine say whether a khatma is archived", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const pool = await poolKhatma(t, org);
  const rota = await rotaKhatma(t, org);
  const view = (inviteCode: string) =>
    t.query(api.khatmas.view, { sessionToken: org.token, inviteCode });
  const archivedCards = async () =>
    Object.fromEntries(
      (await t.query(api.khatmas.mine, { sessionToken: org.token })).map(
        (card) => [card.kind, card.archived],
      ),
    );

  expect(await view(pool.code)).toMatchObject({ archived: false });
  expect(await view(rota.code)).toMatchObject({ rota: true, archived: false });
  expect(await archivedCards()).toEqual({ pool: false, rota: false });

  for (const inviteCode of [pool.code, rota.code]) {
    await t.mutation(api.khatmaLifecycle.archive, {
      sessionToken: org.token,
      inviteCode,
    });
  }

  expect(await view(pool.code)).toMatchObject({ archived: true });
  expect(await view(rota.code)).toMatchObject({ rota: true, archived: true });
  expect(await archivedCards()).toEqual({ pool: true, rota: true });
});

// ---------------------------------------------------------------------------
// What an archive stops

test("every pool action on an archived khatma throws archived", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code } = await poolKhatma(t, org);
  const args = { sessionToken: org.token, inviteCode: code };
  await t.mutation(api.pool.take, { ...args, juz: 1 });
  await t.mutation(api.khatmaLifecycle.archive, args);

  const refused = { data: { code: "archived" } };
  await expect(
    t.mutation(api.pool.take, { ...args, juz: 2 }),
  ).rejects.toMatchObject(refused);
  await expect(t.mutation(api.pool.finish, args)).rejects.toMatchObject(
    refused,
  );
  await expect(t.mutation(api.pool.undoFinish, args)).rejects.toMatchObject(
    refused,
  );
  await expect(t.mutation(api.pool.release, args)).rejects.toMatchObject(
    refused,
  );
  await expect(t.mutation(api.pool.stillReading, args)).rejects.toMatchObject(
    refused,
  );
});

test("a hold mid-grace on an archived khatma: its queued jobs do nothing", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const reader = await signedIn(t, "قارئ");
  const { code, khatma } = await poolKhatma(t, org);
  await join(t, khatma._id, reader);
  await t.mutation(api.pool.take, {
    sessionToken: reader.token,
    inviteCode: code,
    juz: 5,
  });
  const hold = await holdOf(t, khatma, reader);
  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: code,
  });
  const notesBefore = await t.run((ctx) => ctx.db.query("notes").collect());

  await t.mutation(internal.grace.noticeDue, { assignmentId: hold._id });
  await t.mutation(internal.grace.endDue, {
    assignmentId: hold._id,
    endsAt: hold.graceEndsAt,
  });
  // The almost-up note is days off, so only the archive stops this reminder.
  await t.run((ctx) => ctx.db.patch(hold._id, { noticeAt: NOW + 3 * DAY }));
  await t.mutation(internal.nudges.reminderDue, { assignmentId: hold._id });

  const after = await t.run((ctx) => ctx.db.get(hold._id));
  expect(after).toMatchObject({
    noticeSentAt: null,
    openedForHelpAt: null,
    remindedAt: null,
  });
  expect(await t.run((ctx) => ctx.db.query("notes").collect())).toEqual(
    notesBefore,
  );

  // Everything still queued runs clean, including past the end of grace.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get(hold._id))).toMatchObject({
    noticeSentAt: null,
    openedForHelpAt: null,
    remindedAt: null,
  });
  expect(await t.run((ctx) => ctx.db.query("notes").collect())).toEqual(
    notesBefore,
  );
});

test("completeIfReady does nothing on an archived khatma", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatma } = await poolKhatma(t, org);
  for (let juz = 1; juz <= 30; juz++) {
    await insertDone(t, khatma, org, juz, NOW - DAY);
  }
  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: code,
  });

  const roundId = khatma.currentRoundId as Id<"rounds">;
  expect(
    await t.mutation(internal.rounds.completeIfReady, { roundId }),
  ).toEqual({ completed: false });
  const after = await byCode(t, code);
  expect(after.completedRounds).toBe(0);
  expect(after.currentRoundId).toBe(roundId);
  expect(await pendingNames(t)).not.toContain("rounds:completeIfReady");
});

test("the nudge and handover sweeps and checks skip an archived khatma", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const reader = await signedIn(t, "قارئ");
  const { code, khatma } = await poolKhatma(t, org);
  await join(t, khatma._id, reader);
  // The round is out of time and its organizer long gone.
  await t.run(async (ctx) => {
    await ctx.db.patch(khatma.currentRoundId as Id<"rounds">, {
      targetEndAt: NOW - HOUR,
    });
    await ctx.db.patch(org.personId, { lastSeenAt: 0 });
  });
  await t.mutation(internal.nudges.behindSweep, {});
  await t.mutation(internal.organizer.autoHandoverSweep, {});
  expect(await pendingNames(t)).toEqual(
    expect.arrayContaining(["nudges:behindCheck", "organizer:autoHandover"]),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  // Back to where the sweep would pick it up, then archive.
  await t.run(async (ctx) => {
    await ctx.db.patch(khatma._id, { creatorPersonId: org.personId });
    for (const note of await ctx.db.query("notes").collect()) {
      await ctx.db.delete(note._id);
    }
    await ctx.db.patch(khatma.currentRoundId as Id<"rounds">, {
      behindInvitedAt: null,
    });
    for (const member of await ctx.db.query("members").collect()) {
      await ctx.db.patch(member._id, { lastNudgeAt: null });
    }
  });
  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: code,
  });

  await t.mutation(internal.nudges.behindSweep, {});
  await t.mutation(internal.organizer.autoHandoverSweep, {});
  expect(await pendingNames(t)).toEqual([]);

  // A check the sweep queued just before the archive stands down too.
  await t.mutation(internal.nudges.behindCheck, { khatmaId: khatma._id });
  await t.mutation(internal.organizer.autoHandover, { khatmaId: khatma._id });
  expect(await t.run((ctx) => ctx.db.query("notes").collect())).toEqual([]);
  expect((await byCode(t, code)).creatorPersonId).toBe(org.personId);
});

test("an archived rota day takes no replies, and doesn't crowd a live khatma's", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const archived = await rotaKhatma(t, org);
  const live = await rotaKhatma(t, org);
  const phone = "+971570001234";
  await t.run(async (ctx) => {
    await ctx.db.patch(archived.participantId, { phone });
    await ctx.db.patch(live.participantId, { phone });
  });
  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: archived.code,
  });

  await t.mutation(internal.rotaInbound.handle, {
    phone,
    text: "تم",
    now: NOW,
  });

  const [archivedRead, liveRead] = await t.run(async (ctx) => [
    await ctx.db.get(archived.readId),
    await ctx.db.get(live.readId),
  ]);
  expect(archivedRead?.doneAt).toBeNull();
  expect(liveRead?.doneAt).toBe(NOW);
});

test("a stop tells the organizer only about khatmas that are not archived", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const archived = await rotaKhatma(t, org);
  const live = await rotaKhatma(t, org);
  const phone = "+971570001234";
  await t.run(async (ctx) => {
    await ctx.db.patch(archived.participantId, { phone });
    await ctx.db.patch(live.participantId, { phone });
  });
  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: org.token,
    inviteCode: archived.code,
  });

  await t.mutation(internal.rotaInbound.handle, {
    phone,
    text: "إيقاف",
    now: NOW,
  });

  const stopped = await t.run(async (ctx) =>
    (await ctx.db.query("notes").collect()).filter(
      (n) => n.kind === "rotaStopped",
    ),
  );
  expect(stopped.map((n) => n.khatmaId)).toEqual([live.khatmaId]);
  expect(
    await t.run((ctx) => ctx.db.get(archived.participantId)),
  ).toMatchObject({ stoppedAt: NOW });
});

// ---------------------------------------------------------------------------
// Delete

test("remove refuses a live khatma and leaves it whole", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatma } = await poolKhatma(t, org);

  expect(
    await t.mutation(api.khatmaLifecycle.remove, {
      sessionToken: org.token,
      inviteCode: code,
    }),
  ).toEqual({ error: "not_archived" });

  expect(await t.run((ctx) => ctx.db.get(khatma._id))).not.toBeNull();
});

test("remove takes a rota khatma the end date archived", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatmaId } = await rotaKhatma(t, org);
  await t.run(async (ctx) => {
    const khatma = await ctx.db.get(khatmaId);
    if (!khatma?.rota) throw new Error("bad fixture");
    await ctx.db.patch(khatmaId, { rota: { ...khatma.rota, archivedAt: 1 } });
  });

  expect(
    await t.mutation(api.khatmaLifecycle.remove, {
      sessionToken: org.token,
      inviteCode: code,
    }),
  ).toEqual({ ok: true });
  expect(await t.run((ctx) => ctx.db.get(khatmaId))).toBeNull();
});

test("remove deletes a pool khatma at once and its rows after the purge", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const reader = await signedIn(t, "قارئ");
  const { code, khatma } = await poolKhatma(t, org);
  await join(t, khatma._id, reader);
  await insertDone(t, khatma, reader, 1);
  await t.mutation(api.pool.take, {
    sessionToken: reader.token,
    inviteCode: code,
    juz: 2,
  });
  await noteFor(t, reader, khatma._id);
  const helpId = await t.run((ctx) =>
    ctx.db.insert("helpRequests", {
      personId: reader.personId,
      reporterHash: null,
      khatmaId: khatma._id,
      status: "open",
      context: {
        path: "/",
        appVersion: "1",
        userAgent: "test",
        screen: "1x1",
        timeZone: TZ,
      },
      createdAt: NOW,
      lastMessageAt: NOW,
      answeredAt: null,
      closedAt: null,
      seenAt: null,
      attachmentsDeletedAt: null,
    }),
  );
  const other = await poolKhatma(t, org);
  await noteFor(t, org, other.khatma._id);
  const args = { sessionToken: org.token, inviteCode: code };
  await t.mutation(api.khatmaLifecycle.archive, args);

  expect(await t.mutation(api.khatmaLifecycle.remove, args)).toEqual({
    ok: true,
  });

  // At once: the khatma, its link and its members are gone.
  const members = () =>
    t.run((ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
        .collect(),
    );
  expect(await t.run((ctx) => ctx.db.get(khatma._id))).toBeNull();
  expect(await members()).toEqual([]);
  expect(await t.query(api.khatmas.view, { inviteCode: code })).toEqual({
    notFound: true,
  });

  await t.finishAllScheduledFunctions(vi.runAllTimers);

  await t.run(async (ctx) => {
    const rounds = await ctx.db.query("rounds").collect();
    expect(rounds.map((r) => r.khatmaId)).toEqual([other.khatma._id]);
    const notes = await ctx.db.query("notes").collect();
    expect(notes.map((n) => n.khatmaId)).toEqual([other.khatma._id]);
    // The finished row stays; the hold goes.
    const assignments = await ctx.db.query("assignments").collect();
    expect(assignments.map((a) => a.juz)).toEqual([1]);
    expect((await ctx.db.get(helpId))?.khatmaId).toBeNull();
  });
});

test("remove purges every row of a rota khatma, in batches", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const gone = await rotaKhatma(t, org);
  const kept = await rotaKhatma(t, org);
  // More rows than one purge run takes, in one stage.
  await t.run(async (ctx) => {
    // A co-organizer row holds a real number, even a hidden one: it goes too.
    for (const khatmaId of [gone.khatmaId, kept.khatmaId]) {
      await ctx.db.insert("coOrganizers", {
        khatmaId,
        phone: "+971570008888",
        readings: true,
        people: true,
        settings: true,
        addedAt: NOW,
      });
    }
    for (let i = 0; i < 450; i++) {
      await ctx.db.insert("rotaOutbox", {
        khatmaId: gone.khatmaId,
        participantId: gone.participantId,
        dayId: null,
        kind: "welcome",
        juz: [],
        number: null,
        createdAt: NOW,
        sentAt: NOW,
        skippedAt: null,
      });
    }
  });
  const args = { sessionToken: org.token, inviteCode: gone.code };
  await t.mutation(api.khatmaLifecycle.archive, args);
  await t.mutation(api.khatmaLifecycle.remove, args);

  await t.finishAllScheduledFunctions(vi.runAllTimers);

  await t.run(async (ctx) => {
    const khatmaIds = [
      ...(await ctx.db.query("rotaParticipants").collect()),
      ...(await ctx.db.query("rotaSlots").collect()),
      ...(await ctx.db.query("rotaDays").collect()),
      ...(await ctx.db.query("rotaReads").collect()),
      ...(await ctx.db.query("rotaOutbox").collect()),
      ...(await ctx.db.query("rotaJoinRequests").collect()),
      ...(await ctx.db.query("coOrganizers").collect()),
    ].map((row) => row.khatmaId);
    expect(new Set(khatmaIds)).toEqual(new Set([kept.khatmaId]));
    expect(await ctx.db.query("coOrganizers").collect()).toHaveLength(1);
  });
});

test("a member's own numbers stay the same after a delete", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const reader = await signedIn(t, "قارئ");
  const { code, khatma } = await poolKhatma(t, org);
  await join(t, khatma._id, reader);
  // Three finishes in each of the last two weeks: a known pace and a streak.
  const finishes = [0, 1, 2, 7, 8, 9].map((days) => NOW - days * DAY);
  for (const [i, finishedAt] of finishes.entries()) {
    await insertDone(t, khatma, reader, i + 1, finishedAt);
  }
  const stats = () =>
    t.query(api.people.myStats, { sessionToken: reader.token });
  const before = await stats();
  expect(before).toMatchObject({ juzRead: 6, weekStreak: 2 });
  expect(before?.paceDays).not.toBeNull();

  const args = { sessionToken: org.token, inviteCode: code };
  await t.mutation(api.khatmaLifecycle.archive, args);
  await t.mutation(api.khatmaLifecycle.remove, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await stats()).toEqual(before);
});

test("a deleted pool khatma's queued jobs return quietly, before and after the purge", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const reader = await signedIn(t, "قارئ");
  const { code, khatma } = await poolKhatma(t, org);
  await join(t, khatma._id, reader);
  await t.mutation(api.pool.take, {
    sessionToken: reader.token,
    inviteCode: code,
    juz: 5,
  });
  const hold = await holdOf(t, khatma, reader);
  const noteId = await noteFor(t, reader, khatma._id);
  const roundId = khatma.currentRoundId as Id<"rounds">;
  const args = { sessionToken: org.token, inviteCode: code };
  await t.mutation(api.khatmaLifecycle.archive, args);
  await t.mutation(api.khatmaLifecycle.remove, args);

  const runAll = async () => {
    await t.mutation(internal.grace.noticeDue, { assignmentId: hold._id });
    await t.mutation(internal.grace.endDue, {
      assignmentId: hold._id,
      endsAt: hold.graceEndsAt,
    });
    await t.mutation(internal.nudges.reminderDue, { assignmentId: hold._id });
    await t.mutation(internal.nudges.behindCheck, { khatmaId: khatma._id });
    await t.mutation(internal.organizer.autoHandover, { khatmaId: khatma._id });
    expect(
      await t.mutation(internal.rounds.completeIfReady, { roundId }),
    ).toEqual({ completed: false });
    expect(await t.query(internal.push.deliveryPlan, { noteId })).toBeNull();
    expect(await t.query(internal.whatsappNotes.plan, { noteId })).toBeNull();
  };

  // The rows are still there, the khatma isn't.
  const notesBefore = await t.run((ctx) => ctx.db.query("notes").collect());
  await runAll();
  expect(await t.run((ctx) => ctx.db.query("notes").collect())).toEqual(
    notesBefore,
  );

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await runAll();
});

test("a deleted rota khatma's queued jobs return quietly, before and after the purge", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatmaId, unsentId } = await rotaKhatma(t, org);
  const args = { sessionToken: org.token, inviteCode: code };
  await t.mutation(api.khatmaLifecycle.archive, args);
  await t.mutation(api.khatmaLifecycle.remove, args);

  const runAll = async () => {
    await t.mutation(internal.rotaDays.tick, { khatmaId });
    await t.action(internal.rotaOutbox.deliver, { outboxId: unsentId });
  };

  await runAll();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await runAll();
  expect(await t.run((ctx) => ctx.db.get(unsentId))).toBeNull();
});

test("marking a note that the purge took returns quietly", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { khatma } = await poolKhatma(t, org);
  const noteId = await noteFor(t, org, khatma._id);
  await t.run((ctx) => ctx.db.delete(noteId));

  await t.mutation(internal.whatsappNotes.markSent, { noteId });
  await t.mutation(internal.push.markPushed, { noteId });
});

test("a message from a deleted rota khatma's phone, before the purge, changes nothing", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, participantId, readId } = await rotaKhatma(t, org);
  const phone = "+971570001234";
  await t.run((ctx) => ctx.db.patch(participantId, { phone }));
  const args = { sessionToken: org.token, inviteCode: code };
  await t.mutation(api.khatmaLifecycle.archive, args);
  await t.mutation(api.khatmaLifecycle.remove, args);

  for (const text of ["تم", "إيقاف", "شكرا"]) {
    await t.mutation(internal.rotaInbound.handle, { phone, text, now: NOW });
  }

  expect((await t.run((ctx) => ctx.db.get(readId)))?.doneAt).toBeNull();
  expect(await t.run((ctx) => ctx.db.query("notes").collect())).toEqual([]);
});
