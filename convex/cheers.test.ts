import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { noteText } from "./lib/noteText";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 2027-01-15 12:00 in Asia/Dubai (UTC+4), a Friday. */
const NOW = 1_800_000_000_000;
const TZ = "Asia/Dubai";
const AFTER_UNDO = 11_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

let seq = 0;

/** A person with a live session. */
async function signedIn(
  t: T,
  displayName: string,
  over: Partial<Doc<"people">> = {},
) {
  seq += 1;
  const token = `cheer-token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone: `+97155000${String(seq).padStart(4, "0")}`,
      displayName,
      verifiedAt: 0,
      timeZone: TZ,
      lastSeenAt: 0,
      ...over,
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
  return { personId, token, displayName };
}
type Who = Awaited<ReturnType<typeof signedIn>>;

async function setup() {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: org.token,
    name: null,
    schedule: "monthly",
  });
  vi.setSystemTime(NOW);
  const khatma = await t.run((ctx) =>
    ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique(),
  );
  if (!khatma) throw new Error("no khatma");
  return { t, org, code: inviteCode, khatmaId: khatma._id };
}

async function join(
  t: T,
  khatmaId: Id<"khatmas">,
  who: Who,
  over: Partial<Doc<"members">> = {},
) {
  await t.run((ctx) =>
    ctx.db.insert("members", {
      khatmaId,
      personId: who.personId,
      joinedAt: NOW,
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
      ...over,
    }),
  );
}

const take = (t: T, code: string, who: Who, juz: number) =>
  t.mutation(api.pool.take, { sessionToken: who.token, inviteCode: code, juz });
const finish = (t: T, code: string, who: Who) =>
  t.mutation(api.pool.finish, { sessionToken: who.token, inviteCode: code });

async function read(t: T, code: string, who: Who, juz: number) {
  expect(await take(t, code, who, juz)).toEqual({ ok: true });
  expect(await finish(t, code, who)).toMatchObject({ ok: true });
}

async function advance(t: T, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

async function cheersOf(t: T, who: Who) {
  const notes = await t.run((ctx) => ctx.db.query("notes").collect());
  return notes.filter(
    (n) =>
      n.personId === who.personId && n.kind === "cheer" && n.clearedAt === null,
  );
}

async function setSetting(t: T, key: string, value: unknown) {
  await t.run((ctx) =>
    ctx.db.insert("settings", { key, value, updatedAt: NOW }),
  );
}

async function scheduled(t: T, fragment: string) {
  const rows = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return rows.filter((r) => r.name.includes(fragment));
}

test("a finish cheers those still reading, and only them", async () => {
  const { t, code, khatmaId } = await setup();
  const reader = await signedIn(t, "القارئ");
  const finisher = await signedIn(t, "المُتم");
  const idle = await signedIn(t, "بلا جزء");
  await join(t, khatmaId, idle);
  await take(t, code, reader, 3);

  await read(t, code, finisher, 7);
  expect(await cheersOf(t, reader)).toHaveLength(0);
  await advance(t, AFTER_UNDO);

  const [note] = await cheersOf(t, reader);
  expect(note).toMatchObject({ count: 1, juz: [], name: null });
  expect(await cheersOf(t, finisher)).toHaveLength(0);
  expect(await cheersOf(t, idle)).toHaveLength(0);
});

test("the note names nobody and no juz'", () => {
  const text = noteText({ kind: "cheer", juz: [], count: 12, until: null });
  expect(text).toContain("١٢ من ٣٠");
  expect(text).not.toMatch(/الجزء \d/);
});

test("the text says only what the note carries", () => {
  const base = { kind: "cheer" as const, count: 3, until: null };
  const named = noteText({ ...base, juz: [], name: "سارة" });
  expect(named).toContain("تمّت قراءة جزء على يد سارة");
  const numbered = noteText({ ...base, juz: [5] });
  expect(numbered).toContain("تمّت قراءة الجزء ٥،");
  const both = noteText({ ...base, juz: [5], name: "سارة" });
  expect(both).toContain("تمّت قراءة الجزء ٥ على يد سارة");
});

test("a reader who asked for more time is cheered again", async () => {
  const { t, code } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("assignments").first();
    await ctx.db.patch(row!._id, { noticeSentAt: NOW, extended: true });
  });

  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, reader)).toHaveLength(1);
});

test("a khatma can choose to show the reader's name and juz'", async () => {
  const { t, code, khatmaId } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(khatmaId, {
      cheer: {
        on: true,
        everyone: false,
        gapMs: 0,
        showName: true,
        showJuz: true,
      },
    }),
  );
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);

  await read(t, code, await signedIn(t, "سارة"), 7);
  await advance(t, AFTER_UNDO);

  const [note] = await cheersOf(t, reader);
  expect(note).toMatchObject({ name: "سارة", juz: [7] });
});

test("the admin's defaults can show the name alone", async () => {
  const { t, code } = await setup();
  await setSetting(t, "cheerShowName", true);
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);

  await read(t, code, await signedIn(t, "سارة"), 7);
  await advance(t, AFTER_UNDO);

  const [note] = await cheersOf(t, reader);
  expect(note).toMatchObject({ name: "سارة", juz: [] });
});

test("an undone finish cheers nobody", async () => {
  const { t, code, khatmaId } = await setup();
  const reader = await signedIn(t, "القارئ");
  const finisher = await signedIn(t, "المُتم");
  await join(t, khatmaId, finisher);
  await take(t, code, reader, 3);
  await read(t, code, finisher, 7);

  await t.mutation(api.pool.undoFinish, {
    sessionToken: finisher.token,
    inviteCode: code,
  });
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("finishing again after an undo cheers once", async () => {
  const { t, code } = await setup();
  await setSetting(t, "cheerGapMs", 0);
  const reader = await signedIn(t, "القارئ");
  const finisher = await signedIn(t, "المُتم");
  await take(t, code, reader, 3);
  await read(t, code, finisher, 7);
  await t.mutation(api.pool.undoFinish, {
    sessionToken: finisher.token,
    inviteCode: code,
  });
  vi.advanceTimersByTime(1_000);
  await finish(t, code, finisher);

  await advance(t, AFTER_UNDO);

  const notes = await t.run((ctx) => ctx.db.query("notes").collect());
  expect(notes.filter((n) => n.kind === "cheer")).toHaveLength(1);
});

test("the everyone setting reaches idle members and past finishers", async () => {
  const { t, code, khatmaId } = await setup();
  await setSetting(t, "cheerEveryone", true);
  const idle = await signedIn(t, "بلا جزء");
  const earlier = await signedIn(t, "أتم سابقاً");
  const finisher = await signedIn(t, "المُتم");
  await join(t, khatmaId, idle);
  await read(t, code, earlier, 1);
  await advance(t, AFTER_UNDO);

  await read(t, code, finisher, 7);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, idle)).toHaveLength(1);
  expect((await cheersOf(t, earlier))[0]?.count).toBe(2);
  expect(await cheersOf(t, finisher)).toHaveLength(0);
});

test("the gap holds a member's next cheer, and the next one replaces the last", async () => {
  const { t, code } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);

  await read(t, code, await signedIn(t, "أول"), 7);
  await advance(t, AFTER_UNDO);
  expect(await cheersOf(t, reader)).toHaveLength(1);

  await read(t, code, await signedIn(t, "ثان"), 8);
  await advance(t, AFTER_UNDO);
  expect((await cheersOf(t, reader)).map((n) => n.count)).toEqual([1]);

  await advance(t, DAY);
  await read(t, code, await signedIn(t, "ثالث"), 9);
  await advance(t, AFTER_UNDO);
  expect((await cheersOf(t, reader)).map((n) => n.count)).toEqual([3]);
});

test("switched off in the admin settings, nobody is cheered", async () => {
  const { t, code } = await setup();
  await setSetting(t, "cheerOn", false);
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);

  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("a khatma's own settings beat the admin's", async () => {
  const { t, code, khatmaId } = await setup();
  await setSetting(t, "cheerOn", false);
  await t.run((ctx) =>
    ctx.db.patch(khatmaId, {
      cheer: {
        on: true,
        everyone: true,
        gapMs: 0,
        showName: false,
        showJuz: false,
      },
    }),
  );
  const idle = await signedIn(t, "بلا جزء");
  await join(t, khatmaId, idle);

  await read(t, code, await signedIn(t, "أول"), 7);
  await advance(t, AFTER_UNDO);
  await read(t, code, await signedIn(t, "ثان"), 8);
  await advance(t, AFTER_UNDO);

  expect((await cheersOf(t, idle)).map((n) => n.count)).toEqual([2]);
});

test("nobody is cheered with this khatma's notifications off", async () => {
  const { t, code, khatmaId } = await setup();
  await setSetting(t, "cheerEveryone", true);
  const quiet = await signedIn(t, "هادئ");
  await join(t, khatmaId, quiet, { notificationsOn: false });

  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, quiet)).toHaveLength(0);
});

test("a recent nudge holds the cheer, and a cheer leaves the nudge clock alone", async () => {
  const { t, code, khatmaId } = await setup();
  await setSetting(t, "cheerEveryone", true);
  const nudged = await signedIn(t, "ذُكّر");
  const free = await signedIn(t, "حر");
  await join(t, khatmaId, nudged, { lastNudgeAt: NOW - HOUR });
  await join(t, khatmaId, free);

  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, nudged)).toHaveLength(0);
  expect(await cheersOf(t, free)).toHaveLength(1);
  const members = await t.run((ctx) => ctx.db.query("members").collect());
  expect(members.find((m) => m.personId === free.personId)?.lastNudgeAt).toBe(
    null,
  );
});

test("a hold opened for help isn't asked to keep going", async () => {
  const { t, code } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("assignments").first();
    await ctx.db.patch(row!._id, { openedForHelpAt: NOW });
  });

  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("a cheer goes to push but never to WhatsApp", async () => {
  const { t, code } = await setup();
  const reader = await signedIn(t, "القارئ", { whatsappNotes: true });
  await take(t, code, reader, 3);

  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, reader)).toHaveLength(1);
  expect(await scheduled(t, "whatsappNotes")).toHaveLength(0);
});

test("the finish that completes the round leaves the cheer to the completion note", async () => {
  const { t, code, khatmaId } = await setup();
  await setSetting(t, "cheerEveryone", true);
  const member = await signedIn(t, "عضو");
  await join(t, khatmaId, member);
  const finisher = await signedIn(t, "المُتم");
  await take(t, code, finisher, 30);
  await t.run(async (ctx) => {
    const held = (await ctx.db.query("assignments").collect())[0]!;
    for (let juz = 1; juz < 30; juz++) {
      await ctx.db.insert("assignments", {
        ...held,
        _id: undefined,
        _creationTime: undefined,
        juz,
        finishedAt: NOW,
      } as never);
    }
  });

  await finish(t, code, finisher);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, member)).toHaveLength(0);
});

test("a cheer showing on the page clears when its reader finishes", async () => {
  const { t, code } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);
  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);
  expect(await cheersOf(t, reader)).toHaveLength(1);

  await finish(t, code, reader);

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("a round's completion clears the cheers still showing", async () => {
  const { t, code, khatmaId } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);
  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);
  expect(await cheersOf(t, reader)).toHaveLength(1);

  await t.run(async (ctx) => {
    const { onRoundCompleted } = await import("./hooks");
    await onRoundCompleted(ctx, khatmaId, 1);
  });

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("a cheer for an archived khatma stays unsent", async () => {
  const { t, code, khatmaId } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);
  await read(t, code, await signedIn(t, "المُتم"), 7);
  await t.run((ctx) => ctx.db.patch(khatmaId, { archivedAt: NOW }));

  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("organizer settings show the override and the defaults, and null goes back", async () => {
  const { t, org, code } = await setup();
  await setSetting(t, "cheerGapMs", HOUR);
  const args = { sessionToken: org.token, inviteCode: code };
  const cheerOf = async () => {
    const settings = await t.query(api.organizer.settings, args);
    if ("forbidden" in settings) throw new Error("forbidden");
    return settings.cheer;
  };
  const defaults = {
    on: true,
    everyone: false,
    gapMs: HOUR,
    showName: false,
    showJuz: false,
  };
  expect(await cheerOf()).toEqual({ override: null, defaults });

  const own = {
    on: false,
    everyone: true,
    gapMs: 3 * HOUR,
    showName: false,
    showJuz: false,
  };
  expect(
    await t.mutation(api.organizer.update, { ...args, cheer: own }),
  ).toEqual({ ok: true });
  expect(await cheerOf()).toEqual({ override: own, defaults });

  await t.mutation(api.organizer.update, { ...args, cheer: null });
  expect(await cheerOf()).toEqual({ override: null, defaults });
});

test("the organizer can't store a gap out of range", async () => {
  const { t, org, code } = await setup();
  const result = await t.mutation(api.organizer.update, {
    sessionToken: org.token,
    inviteCode: code,
    cheer: {
      on: true,
      everyone: false,
      gapMs: -1,
      showName: false,
      showJuz: false,
    },
  });
  expect(result).toEqual({ ok: false, reason: "invalid_cheer" });
});

test("the last ajza' go uncheered, so the count points at nobody", async () => {
  const { t, code } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 30);
  const finisher = await signedIn(t, "المُتم");
  await take(t, code, finisher, 28);
  await t.run(async (ctx) => {
    const held = (await ctx.db.query("assignments").collect())[0]!;
    for (let juz = 1; juz < 28; juz++) {
      await ctx.db.insert("assignments", {
        ...held,
        _id: undefined,
        _creationTime: undefined,
        juz,
        finishedAt: NOW,
      } as never);
    }
  });

  await finish(t, code, finisher);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("the almost-up note holds the cheer", async () => {
  const { t, code } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("assignments").first();
    await ctx.db.patch(row!._id, { noticeSentAt: NOW });
  });

  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("stepping back from a juz' clears the cheer", async () => {
  const { t, code } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);
  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);
  expect(await cheersOf(t, reader)).toHaveLength(1);

  await t.mutation(api.pool.release, {
    sessionToken: reader.token,
    inviteCode: code,
  });

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("a hold opening for help clears the cheer", async () => {
  const { t, code } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);
  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);
  expect(await cheersOf(t, reader)).toHaveLength(1);

  await t.run(async (ctx) => {
    const { openForHelpNow } = await import("./grace");
    const rows = await ctx.db.query("assignments").collect();
    await openForHelpNow(
      ctx,
      rows.find((a) => a.juz === 3)!,
    );
  });

  expect(await cheersOf(t, reader)).toHaveLength(0);
});

test("a khatma's cheers replace each other on the device", async () => {
  const { t, code, khatmaId } = await setup();
  const reader = await signedIn(t, "القارئ");
  await take(t, code, reader, 3);
  await read(t, code, await signedIn(t, "المُتم"), 7);
  await advance(t, AFTER_UNDO);
  const [note] = await cheersOf(t, reader);
  await t.run(async (ctx) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_person", (q) => q.eq("personId", reader.personId))
      .first();
    await ctx.db.insert("pushSubscriptions", {
      personId: reader.personId,
      sessionId: session!._id,
      endpoint: "https://push.test/1",
      p256dh: "k",
      auth: "a",
      createdAt: NOW,
    });
  });

  const plan = await t.query(internal.push.deliveryPlan, {
    noteId: note!._id,
  });

  expect(plan?.payload.tag).toBe(`cheer-${khatmaId}`);
});

test("the job is internal: nothing runs for a row that's gone", async () => {
  const { t, khatmaId } = await setup();
  const id = await t.run(async (ctx) => {
    const round = (await ctx.db.get(khatmaId))!.currentRoundId!;
    const person = (await ctx.db.query("people").first())!;
    const member = await ctx.db.insert("members", {
      khatmaId,
      personId: person._id,
      joinedAt: NOW,
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    const row = await ctx.db.insert("assignments", {
      khatmaId,
      roundId: round,
      roundNumber: 1,
      juz: 1,
      memberId: member,
      personId: person._id,
      takenAt: NOW,
      finishedAt: NOW,
      releasedAt: null,
      releasedBySystem: false,
      graceWakingMs: HOUR,
      noticeAt: NOW,
      graceEndsAt: NOW,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    });
    await ctx.db.delete(row);
    return row;
  });
  await t.mutation(internal.cheers.afterFinish, {
    assignmentId: id,
    finishedAt: NOW,
  });
  expect(await t.run((ctx) => ctx.db.query("notes").collect())).toEqual([]);
});
