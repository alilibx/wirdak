import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { scheduleRotaCheer } from "./cheers";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { DEFAULT_GRACE } from "./lib/grace";
import * as ops from "./lib/rotaOps";
import { cheerText } from "./lib/rotaTemplates";
import schema from "./schema";
import { describeMessage } from "./whatsapp";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2027-01-15 12:00 in Asia/Dubai (UTC+4), so awake. */
const NOW = 1_800_000_000_000;
/** 23:00 in Asia/Dubai, so quiet. */
const NIGHT = NOW + 11 * HOUR;
const AFTER_UNDO = 11_000;
const ADMIN: ops.Actor = { personId: null };

const FINISHER = "+971500000011";
const READING = "+971500000012";
const DONE = "+971500000013";
const NO_WINDOW = "+971500000014";

type T = TestConvexForDataModel<DataModel>;
let sent: { to: string; text: string }[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("WIRDAK_ENV", "dev");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234567890");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-access-token");
  vi.stubEnv("WHATSAPP_GRAPH_VERSION", "v21.0");
  vi.stubEnv("SITE_URL", "https://wirdak.app");
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { to: string };
      sent.push({ to: payload.to, text: describeMessage(payload) });
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * An open day with four readers: one about to finish juz' 1, one still on juz'
 * 2, one done with juz' 3, and one still on juz' 4 who hasn't written lately.
 */
async function setup(t: T, cheer?: Doc<"khatmas">["cheer"]) {
  return await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone: "+971500000001",
      displayName: "المنظم",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
      rotaAllowed: true,
    });
    const khatmaId = await ctx.db.insert("khatmas", {
      name: "ختمة العائلة",
      schedule: "none",
      grace: DEFAULT_GRACE.none,
      creatorPersonId: personId,
      inviteCode: "code",
      completedRounds: 0,
      createdAt: 0,
      kind: "rota",
      ...(cheer ? { cheer } : {}),
      rota: {
        days: { kind: "daily" },
        firstDate: "2027-01-15",
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
    const dayId = await ctx.db.insert("rotaDays", {
      khatmaId,
      n: 1,
      number: 1,
      cycle: 1,
      date: "2027-01-15",
      startedAt: NOW - HOUR,
      closesAt: NOW + DAY,
      completedAt: null,
      closedAt: null,
      unreadSentAt: null,
      summarySentAt: null,
    });
    const ids: Id<"rotaReads">[] = [];
    const phones = [FINISHER, READING, DONE, NO_WINDOW];
    for (const [i, phone] of phones.entries()) {
      const participantId = await ctx.db.insert("rotaParticipants", {
        khatmaId,
        name: `قارئ ${i}`,
        phone,
        personId: null,
        addedAt: 0,
        removedAt: null,
        joinedAt: NOW - DAY,
      });
      if (phone !== NO_WINDOW) {
        await ctx.db.insert("waContacts", { phone, lastInboundAt: NOW - HOUR });
      }
      ids.push(
        await ctx.db.insert("rotaReads", {
          dayId,
          khatmaId,
          juz: i + 1,
          slot: i + 1,
          holderId: participantId,
          readerId: participantId,
          doneAt: phone === DONE ? NOW - HOUR : null,
          doneByOrganizer: false,
          reassignedAt: null,
        }),
      );
    }
    return { khatmaId, dayId, readId: ids[0]!, otherId: ids[1]! };
  });
}

function mark(t: T, khatmaId: Id<"khatmas">, readId: Id<"rotaReads">) {
  return t.run(async (ctx) => {
    const khatma = (await ctx.db.get(khatmaId))!;
    return ops.markDone(ctx, khatma, khatma.rota!, { readId }, ADMIN);
  });
}

async function advance(t: T, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
  // the deliveries it queued
  vi.advanceTimersByTime(1);
  await t.finishInProgressScheduledFunctions();
}

test("a read cheers those still reading inside their window, free-form", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readId } = await setup(t);

  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);

  expect(sent.map((m) => m.to)).toEqual([READING.slice(1)]);
  expect(sent[0]?.text).toContain(cheerText(2, null, []));
});

test("a khatma can show the reader's name and every juz' of the tap", async () => {
  const t = convexTest(schema, modules);
  const { readId, otherId } = await setup(t, {
    on: true,
    everyone: true,
    gapMs: 0,
    showName: true,
    showJuz: true,
  });
  await t.run(async (ctx) => {
    const read = (await ctx.db.get(readId))!;
    await ctx.db.patch(otherId, { readerId: read.readerId });
    await ctx.db.patch(readId, { doneAt: NOW });
    await ctx.db.patch(otherId, { doneAt: NOW });
    await scheduleRotaCheer(ctx, readId, NOW, read.readerId);
  });

  await advance(t, AFTER_UNDO);

  // Nothing is sent to the reader of the two; the one already done hears of both.
  const [message] = sent.filter((m) => m.to === DONE.slice(1));
  expect(message?.text).toContain(cheerText(3, "قارئ 0", [1, 2]));
  expect(message?.text).toContain("تمّت قراءة الجزأين ١ و٢ على يد قارئ 0");
});

test("the everyone setting reaches those already done, and never the reader", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readId } = await setup(t, {
    on: true,
    everyone: true,
    gapMs: 0,
    showName: false,
    showJuz: false,
  });

  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);

  expect(sent.map((m) => m.to.replace(/^\+/, "")).sort()).toEqual(
    [READING, DONE].map((p) => p.slice(1)).sort(),
  );
});

test("the gap holds the next cheer", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readId, otherId } = await setup(t, {
    on: true,
    everyone: true,
    gapMs: DAY,
    showName: false,
    showJuz: false,
  });
  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);
  const first = sent.length;

  await mark(t, khatmaId, otherId);
  await advance(t, AFTER_UNDO);

  // Only the first finisher, skipped the first time, has a cheer due.
  expect(sent.slice(first).map((m) => m.to.replace(/^\+/, ""))).toEqual([
    FINISHER.slice(1),
  ]);
});

test("a gap of zero cheers more than once a reading day", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readId, otherId } = await setup(t, {
    on: true,
    everyone: true,
    gapMs: 0,
    showName: false,
    showJuz: false,
  });
  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);
  await mark(t, khatmaId, otherId);
  await advance(t, AFTER_UNDO);

  expect(sent.filter((m) => m.to.endsWith(DONE.slice(1)))).toHaveLength(2);
});

test("switched off, nobody is cheered", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readId } = await setup(t, {
    on: false,
    everyone: true,
    gapMs: 0,
    showName: false,
    showJuz: false,
  });

  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);

  expect(sent).toEqual([]);
});

test("a mark taken back cheers nobody", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readId } = await setup(t);

  await mark(t, khatmaId, readId);
  await t.run(async (ctx) => {
    const khatma = (await ctx.db.get(khatmaId))!;
    await ops.markNotDone(ctx, khatma, khatma.rota!, { readId });
  });
  await advance(t, AFTER_UNDO);

  expect(sent).toEqual([]);
});

test("quiet hours drop the cheer rather than hold it for morning", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readId } = await setup(t);
  vi.setSystemTime(NIGHT);

  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);
  await advance(t, 9 * HOUR);

  expect(sent).toEqual([]);
  const rows = await t.run((ctx) => ctx.db.query("rotaOutbox").collect());
  expect(rows.filter((r) => r.kind === "cheer")).toEqual([]);
});

test("a paused khatma cheers nobody", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readId } = await setup(t);
  await t.run(async (ctx) => {
    const khatma = (await ctx.db.get(khatmaId))!;
    await ctx.db.patch(khatmaId, { rota: { ...khatma.rota!, pausedAt: NOW } });
  });

  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);

  expect(sent).toEqual([]);
});

test("yesterday's day, still open, cheers nobody", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, dayId, readId } = await setup(t);
  await t.run((ctx) => ctx.db.patch(dayId, { date: "2027-01-14" }));

  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);

  expect(sent).toEqual([]);
});

test("after the day's reminder, only those done are cheered", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, dayId, readId } = await setup(t, {
    on: true,
    everyone: true,
    gapMs: 0,
    showName: false,
    showJuz: false,
  });
  await t.run((ctx) => ctx.db.patch(dayId, { reminderSentAt: NOW - HOUR }));

  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);

  expect(sent.map((m) => m.to)).toEqual([DONE.slice(1)]);
});

test("someone who answered «ليس بعد» isn't cheered", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readId, otherId } = await setup(t);
  await t.run((ctx) => ctx.db.patch(otherId, { notYetAt: NOW - HOUR }));

  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);

  expect(sent).toEqual([]);
});

test("the last ajza' go uncheered, so the count points at nobody", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, dayId, readId } = await setup(t);
  await t.run(async (ctx) => {
    for (let juz = 5; juz <= 30; juz++) {
      await ctx.db.insert("rotaReads", {
        dayId,
        khatmaId,
        juz,
        slot: juz,
        holderId: null,
        readerId: null,
        doneAt: NOW - HOUR,
        doneByOrganizer: false,
        reassignedAt: null,
      });
    }
  });

  await mark(t, khatmaId, readId);
  await advance(t, AFTER_UNDO);

  expect(sent).toEqual([]);
});

test("whoever tapped for a handed-on juz' isn't cheered about it", async () => {
  const t = convexTest(schema, modules);
  const { readId } = await setup(t, {
    on: true,
    everyone: true,
    gapMs: 0,
    showName: false,
    showJuz: false,
  });
  await t.run(async (ctx) => {
    const participant = await ctx.db
      .query("rotaParticipants")
      .withIndex("by_phone", (q) => q.eq("phone", READING))
      .first();
    await ctx.db.patch(readId, { doneAt: NOW });
    await scheduleRotaCheer(ctx, readId, NOW, participant!._id);
  });

  await advance(t, AFTER_UNDO);

  expect(sent.map((m) => m.to)).toEqual([DONE.slice(1)]);
});

test("a window that closes before delivery skips the row", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await setup(t);
  const outboxId = await t.run(async (ctx) => {
    const participant = await ctx.db
      .query("rotaParticipants")
      .withIndex("by_phone", (q) => q.eq("phone", NO_WINDOW))
      .first();
    return ctx.db.insert("rotaOutbox", {
      khatmaId,
      participantId: participant!._id,
      dayId: null,
      kind: "cheer",
      juz: [],
      number: 2,
      createdAt: NOW,
      sentAt: null,
      skippedAt: null,
    });
  });

  expect(await t.query(internal.rotaOutbox.plan, { outboxId })).toBeNull();
});

test("the organizer's override is stored, shown, and cleared", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await setup(t);
  const onKhatma = <R>(
    work: (
      ctx: Parameters<Parameters<typeof t.run>[0]>[0],
      khatma: Doc<"khatmas">,
      rota: NonNullable<Doc<"khatmas">["rota"]>,
    ) => Promise<R>,
  ) =>
    t.run(async (ctx) => {
      const khatma = (await ctx.db.get(khatmaId))!;
      return work(ctx, khatma, khatma.rota!);
    });
  const own = {
    on: true,
    everyone: true,
    gapMs: HOUR,
    showName: false,
    showJuz: false,
  };

  expect(
    await onKhatma((ctx, k, r) => ops.update(ctx, k, r, { cheer: own })),
  ).toEqual({ ok: true });
  expect(
    (await onKhatma((ctx, k, r) => ops.settings(ctx, k, r))).cheer.override,
  ).toEqual(own);

  await onKhatma((ctx, k, r) => ops.update(ctx, k, r, { cheer: null }));
  expect(
    (await onKhatma((ctx, k, r) => ops.settings(ctx, k, r))).cheer.override,
  ).toBeNull();

  expect(
    await onKhatma((ctx, k, r) =>
      ops.update(ctx, k, r, { cheer: { ...own, gapMs: 0.5 } }),
    ),
  ).toEqual({ error: "invalid_cheer" });
});
