import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { sha256Hex } from "./lib/crypto";
import * as ops from "./lib/rotaOps";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2027-01-15 11:00 in Asia/Dubai (a Friday); the khatma's first day is today.
const NOW = Date.UTC(2027, 0, 15, 7, 0, 0);
/** An admin helping out: they are nobody in the khatma. */
const ADMIN: ops.Actor = { personId: null };

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

/** These tests read from today, which needs the admin's start-tomorrow rule off. */
const allowStartToday = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "rotaStartNextDay",
      value: false,
      updatedAt: 0,
    }),
  );

/** A weekly (Fridays) rota khatma, set up, with its first day started and one unlinked reader on juz' 8. */
async function setup(t: T) {
  const token = "ops-token";
  const tokenHash = await sha256Hex(token);
  const organizerId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone: "+971500009000",
      displayName: "المنظم",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
      rotaAllowed: true,
    });
    await ctx.db.insert("sessions", {
      personId: id,
      tokenHash,
      alertTokenHash: "ops-alert",
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    return id;
  });
  await allowStartToday(t);
  const { inviteCode } = await t.action(api.rota.create, {
    sessionToken: token,
    name: "ختمة",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
    endDate: null,
  });
  await t.mutation(api.rota.finishSetup, { sessionToken: token, inviteCode });
  const added = await t.mutation(api.rota.addParticipant, {
    sessionToken: token,
    inviteCode,
    name: "قارئ",
    phone: "+971500009001",
    juz: 8,
  });
  if (!("participantId" in added)) throw new Error(JSON.stringify(added));
  const khatmaId = await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .first();
    return khatma!._id;
  });
  await t.mutation(internal.rotaDays.tick, { khatmaId });
  return { organizerId, khatmaId, readerId: added.participantId };
}

/** Runs an operation on the khatma as it stands now. */
function onKhatma<R>(
  t: T,
  khatmaId: Id<"khatmas">,
  work: (
    ctx: MutationCtx,
    khatma: Doc<"khatmas">,
    rota: NonNullable<Doc<"khatmas">["rota"]>,
  ) => Promise<R>,
): Promise<R> {
  return t.run(async (ctx) => {
    const khatma = (await ctx.db.get(khatmaId))!;
    return work(ctx, khatma, khatma.rota!);
  });
}

test("nobody is me to an admin, not even a reader with no account", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId } = await setup(t);
  const people = await onKhatma(t, khatmaId, (ctx, khatma, rota) =>
    ops.people(ctx, khatma, rota, ADMIN),
  );
  const today = await onKhatma(t, khatmaId, (ctx, khatma, rota) =>
    ops.today(ctx, khatma, rota, ADMIN),
  );
  expect(people.participants.map((p) => p.isMe)).toEqual([false, false]);
  expect(people.rows.filter((r) => r.participant?.isMe)).toEqual([]);
  expect(today.participants.map((p) => p.isMe)).toEqual([false, false]);
});

test("an admin marking a juz' done is nobody's reply", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, readerId } = await setup(t);
  await t.run((ctx) =>
    ctx.db.patch(readerId, { silentDays: 5, lastReplyAt: 1, silencedAt: 1 }),
  );
  const { readId } = await onKhatma(t, khatmaId, async (ctx, khatma, rota) => {
    const view = await ops.today(ctx, khatma, rota, ADMIN);
    return view.tiles.find((tile) => tile.juz === 8)!;
  });

  await onKhatma(t, khatmaId, (ctx, khatma, rota) =>
    ops.markDone(ctx, khatma, rota, { readId }, ADMIN),
  );

  expect(await t.run((ctx) => ctx.db.get(readId))).toMatchObject({
    doneByOrganizer: true,
  });
  expect(await t.run((ctx) => ctx.db.get(readerId))).toMatchObject({
    silentDays: 5,
    lastReplyAt: 1,
    silencedAt: 1,
  });
});

test("someone an admin adds is saved for the organizer", async () => {
  const t = convexTest(schema, modules);
  const { khatmaId, organizerId } = await setup(t);
  await onKhatma(t, khatmaId, (ctx, khatma, rota) =>
    ops.addParticipant(ctx, khatma, rota, {
      name: "سعد",
      phone: "+971500009002",
    }),
  );
  const saved = await onKhatma(t, khatmaId, (ctx, khatma) =>
    ops.saved(ctx, khatma),
  );
  const contacts = await t.run((ctx) =>
    ctx.db
      .query("rotaContacts")
      .withIndex("by_owner", (q) => q.eq("ownerPersonId", organizerId))
      .collect(),
  );
  expect(contacts.map((c) => c.name)).toContain("سعد");
  expect(saved.find((c) => c.name === "سعد")?.inKhatma).toBe(true);
});
