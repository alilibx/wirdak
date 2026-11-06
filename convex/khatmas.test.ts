import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
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

let seq = 0;

/** A person with a live session; returns the raw session token. */
async function signedIn(t: T, displayName: string) {
  seq += 1;
  const token = `token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone: `+9715000000${String(seq).padStart(2, "0")}`,
      displayName,
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
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

async function createKhatma(
  t: T,
  who: Who,
  schedule: "weekly" | "none" | "daily" = "weekly",
  name: string | null = null,
  grace?: { value: number; unit: "minutes" | "hours" | "days" },
) {
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: who.token,
    name,
    schedule,
    grace,
  });
  return inviteCode;
}

async function khatmaByCode(t: T, inviteCode: string) {
  return await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    if (!khatma) throw new Error("no khatma");
    return khatma;
  });
}

async function join(
  t: T,
  khatmaId: Id<"khatmas">,
  who: Who,
  opts: { status?: "active" | "blocked"; shareToken?: string } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("members", {
      khatmaId,
      personId: who.personId,
      joinedAt: Date.now(),
      status: opts.status ?? "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
      shareToken: opts.shareToken,
    }),
  );
}

async function memberOf(t: T, khatmaId: Id<"khatmas">, who: Who) {
  return await t.run(async (ctx) => {
    const m = await ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatmaId).eq("personId", who.personId),
      )
      .unique();
    if (!m) throw new Error("no member");
    return m;
  });
}

/** Inserts an assignment directly: finished, released, or still being read. */
async function assign(
  t: T,
  khatmaId: Id<"khatmas">,
  who: Who,
  juz: number,
  state: "reading" | "done" | "released",
  roundNumber = 1,
) {
  const member = await memberOf(t, khatmaId, who);
  await t.run(async (ctx) => {
    const round = await ctx.db
      .query("rounds")
      .withIndex("by_khatma_number", (q) =>
        q.eq("khatmaId", khatmaId).eq("number", roundNumber),
      )
      .unique();
    if (!round) throw new Error("no round");
    await ctx.db.insert("assignments", {
      khatmaId,
      roundId: round._id,
      roundNumber,
      juz,
      memberId: member._id,
      personId: who.personId,
      takenAt: NOW,
      finishedAt: state === "done" ? NOW : null,
      releasedAt: state === "released" ? NOW : null,
      releasedBySystem: false,
      graceWakingMs: 0,
      noticeAt: NOW,
      graceEndsAt: NOW,
      extended: false,
      noticeSentAt: null,
      openedForHelpAt: null,
      remindedAt: null,
    });
  });
}

async function viewAs(
  t: T,
  inviteCode: string,
  who: Who | null,
  from?: string,
) {
  const res = await t.query(api.khatmas.view, {
    inviteCode,
    sessionToken: who?.token,
    from,
  });
  if ("notFound" in res || "rota" in res) throw new Error("unexpected view");
  return res;
}

test("create returns an invite code and makes the creator a member", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  const code = await createKhatma(t, ali, "weekly", "  ختمة   العائلة ");
  expect(code).toMatch(/^[A-Za-z0-9_-]{12}$/);

  const view = await viewAs(t, code, ali);
  expect(view.name).toBe("ختمة العائلة");
  expect(view.schedule).toBe("weekly");
  // convex-test nudges the fake clock by a millisecond now and then
  expect(view.createdAt).toBeGreaterThanOrEqual(NOW);
  expect(view.createdAt).toBeLessThan(NOW + 1000);
  expect(view.roundNumber).toBe(1);
  const round = await t.run(async (ctx) =>
    (await ctx.db.query("rounds").collect()).at(0),
  );
  expect(round?.startedAt).toBe(view.createdAt);
  expect(view.targetEndAt).toBe(view.createdAt + 7 * DAY);
  expect(view.completedRounds).toBe(0);
  expect(view.memberCount).toBe(1);
  expect(view.lastCompleted).toBeNull();
  expect(view.me).toEqual({
    signedIn: true,
    displayName: "علي",
    isMember: true,
    notificationsOn: true,
    holding: null,
    hold: null,
    suggestion: 1,
    celebrateRound: null,
  });
  expect(view.grace).toEqual({ value: 2, unit: "days" });
  expect(view.isOrganizer).toBe(true);
  expect(view.tiles).toHaveLength(30);
  expect(view.tiles.map((x) => x.juz)).toEqual(
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  expect(view.tiles.every((x) => x.state === "open")).toBe(true);

  const khatma = await khatmaByCode(t, code);
  const member = await memberOf(t, khatma._id, ali);
  expect(member).toMatchObject({
    status: "active",
    notificationsOn: true,
    lastNudgeAt: null,
    lastCelebratedRound: 0,
    joinedAt: khatma.createdAt,
  });
  expect(member.shareToken).toMatch(/^[A-Za-z0-9_-]{11}$/);
  expect(khatma.creatorPersonId).toBe(ali.personId);
  expect(khatma.currentRoundId).toBeDefined();
});

test("create requires a session", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.khatmas.create, { name: null, schedule: "weekly" }),
  ).rejects.toThrow(/not_signed_in/);
  await expect(
    t.action(api.khatmas.create, {
      sessionToken: "bogus",
      name: null,
      schedule: "weekly",
    }),
  ).rejects.toThrow(/not_signed_in/);
  expect(await t.run((ctx) => ctx.db.query("khatmas").collect())).toHaveLength(
    0,
  );
});

test("create rejects an unknown schedule", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  await expect(
    t.action(api.khatmas.create, {
      sessionToken: ali.token,
      name: null,
      schedule: "yearly" as "weekly",
    }),
  ).rejects.toThrow();
});

test("create is rate limited per person per day", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "بكر");
  for (let i = 0; i < 5; i++) await createKhatma(t, ali);
  await expect(createKhatma(t, ali)).rejects.toThrow(/rate_limited/);
  // another person is unaffected
  await createKhatma(t, bob);
  // and the window resets after 24 hours
  vi.setSystemTime(NOW + DAY + 1000);
  await createKhatma(t, ali);
});

test("create refuses in maintenance mode", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "maintenanceMode",
      value: true,
      updatedAt: NOW,
    }),
  );
  await expect(createKhatma(t, ali)).rejects.toThrow(/maintenance/);
});

test("viewers see states but no names", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  await assign(t, khatma._id, ali, 15, "reading");
  await assign(t, khatma._id, ali, 3, "done");

  const outsider = await signedIn(t, "غريب");
  for (const viewer of [null, outsider]) {
    const view = await viewAs(t, code, viewer);
    expect(view.tiles[14]).toEqual({
      juz: 15,
      name: "سبحان",
      state: "reading",
      readerName: null,
      isMine: false,
    });
    expect(view.tiles[2]).toMatchObject({ state: "done", readerName: null });
    expect(view.tiles.every((x) => x.readerName === null)).toBe(true);
    expect(view.me.isMember).toBe(false);
    expect(view.me.holding).toBeNull();
    expect(view.me.celebrateRound).toBeNull();
  }
  expect((await viewAs(t, code, null)).me.signedIn).toBe(false);
  expect((await viewAs(t, code, outsider)).me.signedIn).toBe(true);
  // signed-in viewers see their own name (so a shared phone shows whose
  // account takes the juz'); signed-out viewers see none
  expect((await viewAs(t, code, null)).me.displayName).toBeNull();
  expect((await viewAs(t, code, outsider)).me.displayName).toBe("غريب");
});

test("members see reader names on reading tiles only", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  const bob = await signedIn(t, "B");
  await join(t, khatma._id, bob);
  await assign(t, khatma._id, ali, 15, "reading");
  await assign(t, khatma._id, ali, 3, "done");
  await assign(t, khatma._id, bob, 9, "released");
  await assign(t, khatma._id, bob, 10, "reading");

  const view = await viewAs(t, code, bob);
  expect(view.me.isMember).toBe(true);
  expect(view.memberCount).toBe(2);
  expect(view.tiles[14]).toMatchObject({
    state: "reading",
    readerName: "A",
    isMine: false,
  });
  expect(view.tiles[2]).toMatchObject({ state: "done", readerName: null });
  expect(view.tiles[8]).toMatchObject({ state: "open", readerName: null });
  expect(view.tiles[9]).toMatchObject({
    state: "reading",
    readerName: "B",
    isMine: true,
  });
  expect(view.tiles.filter((x) => x.isMine)).toHaveLength(1);
  expect(view.me.holding).toBe(10);
  expect(view.me.suggestion).toBeNull();
});

test("a juz' retaken after a release is shown as reading", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  const bob = await signedIn(t, "B");
  await join(t, khatma._id, bob);
  await assign(t, khatma._id, ali, 5, "released");
  await assign(t, khatma._id, bob, 5, "reading");
  const view = await viewAs(t, code, ali);
  expect(view.tiles[4]).toMatchObject({ state: "reading", readerName: "B" });
  expect(view.me.suggestion).toBe(1);
});

test("a blocked member is treated as a viewer", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  const bob = await signedIn(t, "B");
  await join(t, khatma._id, bob, { status: "blocked" });
  await assign(t, khatma._id, ali, 15, "reading");
  await assign(t, khatma._id, bob, 7, "reading");

  const view = await viewAs(t, code, bob);
  expect(view.me.signedIn).toBe(true);
  expect(view.me.isMember).toBe(false);
  expect(view.me.holding).toBeNull();
  expect(view.memberCount).toBe(1);
  expect(view.tiles[14]).toMatchObject({ state: "reading", readerName: null });
  expect(view.tiles[6]).toMatchObject({
    state: "reading",
    readerName: null,
    isMine: false,
  });
  expect(await t.query(api.khatmas.mine, { sessionToken: bob.token })).toEqual(
    [],
  );
});

test("inviterName requires a valid share token", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  const token = (await memberOf(t, khatma._id, ali)).shareToken!;

  expect((await viewAs(t, code, null, token)).inviterName).toBe("A");
  expect((await viewAs(t, code, null, "nope")).inviterName).toBeNull();
  expect((await viewAs(t, code, null)).inviterName).toBeNull();
});

test("inviterName is null for a share token from another khatma or a blocked member", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const bob = await signedIn(t, "B");
  const codeA = await createKhatma(t, ali);
  const codeB = await createKhatma(t, bob);
  const khatmaA = await khatmaByCode(t, codeA);
  const khatmaB = await khatmaByCode(t, codeB);
  const tokenA = (await memberOf(t, khatmaA._id, ali)).shareToken!;
  const tokenB = (await memberOf(t, khatmaB._id, bob)).shareToken!;

  expect((await viewAs(t, codeA, null, tokenB)).inviterName).toBeNull();
  expect((await viewAs(t, codeB, null, tokenA)).inviterName).toBeNull();
  expect((await viewAs(t, codeB, null, tokenB)).inviterName).toBe("B");

  const cara = await signedIn(t, "C");
  await join(t, khatmaA._id, cara, {
    status: "blocked",
    shareToken: "blockedTok1",
  });
  expect((await viewAs(t, codeA, null, "blockedTok1")).inviterName).toBeNull();
});

test("unknown or malformed invite codes return notFound", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  await createKhatma(t, ali);
  for (const inviteCode of [
    "zzz",
    "",
    "AAAAAAAAAAAA", // well-formed but unknown
    "AAAAAAAAAAA!",
    "AAAAAAAAAAAAA",
    "ا".repeat(12),
  ]) {
    expect(
      await t.query(api.khatmas.view, { inviteCode, sessionToken: ali.token }),
    ).toEqual({ notFound: true });
  }
});

test("schedule none has no target end", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const code = await createKhatma(t, ali, "none");
  const view = await viewAs(t, code, ali);
  expect(view.schedule).toBe("none");
  expect(view.targetEndAt).toBeNull();
});

test("lastCompleted counts distinct participants", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  const bob = await signedIn(t, "B");
  const cara = await signedIn(t, "C");
  await join(t, khatma._id, bob);
  await join(t, khatma._id, cara);
  for (let juz = 1; juz <= 20; juz++)
    await assign(t, khatma._id, ali, juz, "done");
  for (let juz = 21; juz <= 25; juz++)
    await assign(t, khatma._id, bob, juz, "done");
  for (let juz = 26; juz <= 30; juz++)
    await assign(t, khatma._id, cara, juz, "done");
  // a released-but-never-finished attempt does not count as participating
  const dan = await signedIn(t, "D");
  await join(t, khatma._id, dan);
  await assign(t, khatma._id, dan, 1, "released");

  await t.run(async (ctx) => {
    const round1 = await ctx.db.get(khatma.currentRoundId!);
    await ctx.db.patch(round1!._id, { completedAt: NOW, lastFinishedAt: NOW });
    const round2 = await ctx.db.insert("rounds", {
      khatmaId: khatma._id,
      number: 2,
      startedAt: NOW,
      targetEndAt: null,
      completedAt: null,
      lastFinishedAt: null,
      behindInvitedAt: null,
    });
    await ctx.db.patch(khatma._id, {
      currentRoundId: round2,
      completedRounds: 1,
    });
  });

  const view = await viewAs(t, code, ali);
  expect(view.roundNumber).toBe(2);
  expect(view.completedRounds).toBe(1);
  expect(view.lastCompleted).toEqual({ roundNumber: 1, participants: 3 });
  expect(view.tiles.every((x) => x.state === "open")).toBe(true);
  // creator has not celebrated round 1 yet; bob neither; both are members
  expect(view.me.celebrateRound).toBe(1);

  const member = await memberOf(t, khatma._id, ali);
  await t.run((ctx) => ctx.db.patch(member._id, { lastCelebratedRound: 1 }));
  expect((await viewAs(t, code, ali)).me.celebrateRound).toBeNull();
  // viewers never get a celebration
  expect((await viewAs(t, code, null)).me.celebrateRound).toBeNull();
});

test("mine lists active memberships newest first with progress", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const bob = await signedIn(t, "B");
  expect(await t.query(api.khatmas.mine, {})).toEqual([]);
  expect(await t.query(api.khatmas.mine, { sessionToken: ali.token })).toEqual(
    [],
  );

  const first = await createKhatma(t, ali, "weekly", "الأولى");
  vi.setSystemTime(NOW + 1000);
  const second = await createKhatma(t, ali, "none");
  const khatma1 = await khatmaByCode(t, first);
  const khatma2 = await khatmaByCode(t, second);
  await createKhatma(t, bob); // someone else's khatma
  await assign(t, khatma1._id, ali, 4, "done");
  await assign(t, khatma1._id, ali, 5, "done");
  await assign(t, khatma1._id, ali, 6, "reading");

  const mine = await t.query(api.khatmas.mine, { sessionToken: ali.token });
  expect(mine).toEqual([
    {
      kind: "pool",
      inviteCode: second,
      name: null,
      createdAt: khatma2.createdAt,
      schedule: "none",
      done: 0,
      holding: null,
      hasNote: false,
      archived: false,
    },
    {
      kind: "pool",
      inviteCode: first,
      name: "الأولى",
      createdAt: khatma1.createdAt,
      schedule: "weekly",
      done: 2,
      holding: 6,
      hasNote: false,
      archived: false,
    },
  ]);
});

/** A rota khatma row with `who` as its organizer and an active member. */
async function createRotaKhatma(t: T, who: Who, inviteCode: string) {
  const khatmaId = await t.run((ctx) =>
    ctx.db.insert("khatmas", {
      name: "ختمة التناوب",
      schedule: "none",
      grace: { value: 7, unit: "days" },
      creatorPersonId: who.personId,
      inviteCode,
      completedRounds: 0,
      createdAt: NOW,
      kind: "rota",
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
    }),
  );
  await join(t, khatmaId, who);
  return khatmaId;
}

test("view of a rota khatma says so, before looking for a round", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  await createRotaKhatma(t, ali, "rotaKhatma01");
  expect(
    await t.query(api.khatmas.view, { inviteCode: "rotaKhatma01" }),
  ).toEqual({
    rota: true,
    name: "ختمة التناوب",
    joinLink: null,
    archived: false,
    organizerAccess: null,
  });
  expect(
    await t.query(api.khatmas.view, {
      inviteCode: "rotaKhatma01",
      sessionToken: ali.token,
    }),
  ).toEqual({
    rota: true,
    name: "ختمة التناوب",
    joinLink: null,
    archived: false,
    // the owner runs it all
    organizerAccess: {
      owner: true,
      readings: true,
      people: true,
      settings: true,
    },
  });
});

test("view of a rota khatma has its join link for anyone, once it has a code and the public number is set", async () => {
  vi.stubEnv("WHATSAPP_PUBLIC_NUMBER", "971500000000");
  try {
    const t = convexTest(schema, modules);
    const ali = await signedIn(t, "A");
    const khatmaId = await createRotaKhatma(t, ali, "rotaKhatma01");
    // Created before join codes: nothing to link to yet.
    expect(
      await t.query(api.khatmas.view, { inviteCode: "rotaKhatma01" }),
    ).toMatchObject({ joinLink: null });
    await t.run((ctx) => ctx.db.patch(khatmaId, { joinCode: "ABC234" }));
    expect(
      await t.query(api.khatmas.view, { inviteCode: "rotaKhatma01" }),
    ).toEqual({
      rota: true,
      name: "ختمة التناوب",
      joinLink: `https://wa.me/971500000000?text=${encodeURIComponent("انضمام إلى ختمة التناوب · ABC234")}`,
      archived: false,
      organizerAccess: null,
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

test("view of an archived rota khatma has no join link, so nothing offers it", async () => {
  vi.stubEnv("WHATSAPP_PUBLIC_NUMBER", "971500000000");
  try {
    const t = convexTest(schema, modules);
    const ali = await signedIn(t, "A");
    const khatmaId = await createRotaKhatma(t, ali, "rotaKhatma01");
    await t.run(async (ctx) => {
      const khatma = await ctx.db.get(khatmaId);
      if (!khatma?.rota) throw new Error("not a rota khatma");
      await ctx.db.patch(khatmaId, {
        joinCode: "ABC234",
        rota: { ...khatma.rota, archivedAt: 5 },
      });
    });
    expect(
      await t.query(api.khatmas.view, { inviteCode: "rotaKhatma01" }),
    ).toEqual({
      rota: true,
      name: "ختمة التناوب",
      joinLink: null,
      archived: true,
      organizerAccess: null,
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

test("mine lists a rota khatma with the open day's done count and no holding", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const khatmaId = await createRotaKhatma(t, ali, "rotaKhatma02");

  const card = async () =>
    (await t.query(api.khatmas.mine, { sessionToken: ali.token }))[0];
  expect(await card()).toMatchObject({
    kind: "rota",
    inviteCode: "rotaKhatma02",
    done: 0,
    holding: null,
  });

  // an open day with two ajza' done counts them; once closed it counts nothing
  const dayId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("rotaDays", {
      khatmaId,
      n: 1,
      number: 1,
      cycle: 1,
      date: "2027-01-15",
      startedAt: NOW,
      closesAt: NOW + DAY,
      completedAt: null,
      closedAt: null,
      unreadSentAt: null,
      summarySentAt: null,
    });
    for (const [juz, doneAt] of [
      [1, NOW],
      [2, NOW],
      [3, null],
    ] as const) {
      await ctx.db.insert("rotaReads", {
        dayId: id,
        khatmaId,
        juz,
        slot: juz,
        holderId: null,
        readerId: null,
        doneAt,
        doneByOrganizer: false,
        reassignedAt: null,
      });
    }
    return id;
  });
  expect(await card()).toMatchObject({ done: 2, holding: null });
  await t.run((ctx) => ctx.db.patch(dayId, { closedAt: NOW + DAY }));
  expect(await card()).toMatchObject({ done: 0 });
});

test("mine shows hasNote while an uncleared note waits in that khatma", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const first = await createKhatma(t, ali);
  vi.setSystemTime(NOW + 1000);
  const second = await createKhatma(t, ali);
  const khatma1 = await khatmaByCode(t, first);
  const khatma2 = await khatmaByCode(t, second);

  const noteId = await t.run((ctx) =>
    ctx.db.insert("notes", {
      personId: ali.personId,
      khatmaId: khatma1._id,
      kind: "completed",
      juz: [],
      count: null,
      until: null,
      assignmentId: null,
      roundNumber: null,
      createdAt: NOW,
      pushedAt: null,
      clearedAt: null,
    }),
  );
  const flags = async () =>
    Object.fromEntries(
      (await t.query(api.khatmas.mine, { sessionToken: ali.token })).map(
        (m) => [m.inviteCode, m.hasNote],
      ),
    );
  expect(await flags()).toEqual({ [first]: true, [second]: false });

  await t.run((ctx) => ctx.db.patch(noteId, { clearedAt: NOW }));
  expect(await flags()).toEqual({ [first]: false, [second]: false });
  expect(khatma2._id).toBeDefined();
});

test("ensureShareToken returns the existing token or creates one for members", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  const existing = (await memberOf(t, khatma._id, ali)).shareToken!;
  expect(
    await t.action(api.khatmas.ensureShareToken, {
      sessionToken: ali.token,
      inviteCode: code,
    }),
  ).toEqual({ shareToken: existing });

  const bob = await signedIn(t, "B");
  const memberId = await join(t, khatma._id, bob);
  const { shareToken } = await t.action(api.khatmas.ensureShareToken, {
    sessionToken: bob.token,
    inviteCode: code,
  });
  expect(shareToken).toMatch(/^[A-Za-z0-9_-]{11}$/);
  expect((await t.run((ctx) => ctx.db.get(memberId)))!.shareToken).toBe(
    shareToken,
  );
  expect(
    await t.action(api.khatmas.ensureShareToken, {
      sessionToken: bob.token,
      inviteCode: code,
    }),
  ).toEqual({ shareToken });
});

test("ensureShareToken rejects signed-out callers, non-members, and blocked members", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "A");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  const outsider = await signedIn(t, "O");
  const blocked = await signedIn(t, "X");
  await join(t, khatma._id, blocked, { status: "blocked" });

  await expect(
    t.action(api.khatmas.ensureShareToken, { inviteCode: code }),
  ).rejects.toThrow(/not_signed_in/);
  for (const who of [outsider, blocked]) {
    await expect(
      t.action(api.khatmas.ensureShareToken, {
        sessionToken: who.token,
        inviteCode: code,
      }),
    ).rejects.toThrow(/not_member/);
  }
  await expect(
    t.action(api.khatmas.ensureShareToken, {
      sessionToken: ali.token,
      inviteCode: "zzz",
    }),
  ).rejects.toThrow(/not_found/);
  const blockedRow = await memberOf(t, khatma._id, blocked);
  expect(blockedRow.shareToken).toBeUndefined();
});

test("create stores the schedule's default grace", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  const daily = await createKhatma(t, ali, "daily");
  expect((await viewAs(t, daily, ali)).grace).toEqual({
    value: 6,
    unit: "hours",
  });
  const none = await createKhatma(t, ali, "none");
  expect((await viewAs(t, none, ali)).grace).toEqual({
    value: 7,
    unit: "days",
  });
  expect((await khatmaByCode(t, none)).grace).toEqual({
    value: 7,
    unit: "days",
  });
});

test("create accepts a custom grace and rejects an invalid one", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  const code = await createKhatma(t, ali, "weekly", null, {
    value: 45,
    unit: "minutes",
  });
  expect((await viewAs(t, code, ali)).grace).toEqual({
    value: 45,
    unit: "minutes",
  });
  await expect(
    createKhatma(t, ali, "weekly", null, { value: 10, unit: "minutes" }),
  ).rejects.toThrow(/invalid_grace/);
  expect(await t.run((ctx) => ctx.db.query("khatmas").collect())).toHaveLength(
    1,
  );
});

test("isOrganizer is true only for the creator", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "بكر");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  await join(t, khatma._id, bob);
  expect((await viewAs(t, code, ali)).isOrganizer).toBe(true);
  expect((await viewAs(t, code, bob)).isOrganizer).toBe(false);
  expect((await viewAs(t, code, null)).isOrganizer).toBe(false);
});

test("a held juz' carries a placeholder hold, others have none", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  await assign(t, khatma._id, ali, 4, "reading");
  const view = await viewAs(t, code, ali);
  expect(view.me.holding).toBe(4);
  expect(view.me.hold).toEqual({
    openForHelp: false,
    canExtend: false,
    paceDays: null,
  });
});

test("setNotifications flips notificationsOn for a member only", async () => {
  const t = convexTest(schema, modules);
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "بكر");
  const viewer = await signedIn(t, "زائر");
  const code = await createKhatma(t, ali);
  const khatma = await khatmaByCode(t, code);
  await join(t, khatma._id, bob);

  expect(
    await t.mutation(api.khatmas.setNotifications, {
      sessionToken: bob.token,
      inviteCode: code,
      on: false,
    }),
  ).toEqual({ ok: true });
  expect((await memberOf(t, khatma._id, bob)).notificationsOn).toBe(false);
  expect((await viewAs(t, code, bob)).me.notificationsOn).toBe(false);
  expect((await viewAs(t, code, ali)).me.notificationsOn).toBe(true);

  expect(
    await t.mutation(api.khatmas.setNotifications, {
      sessionToken: viewer.token,
      inviteCode: code,
      on: false,
    }),
  ).toEqual({ ok: false });
  expect(
    await t.mutation(api.khatmas.setNotifications, {
      inviteCode: code,
      on: true,
    }),
  ).toEqual({ ok: false });
  expect((await viewAs(t, code, viewer)).me.notificationsOn).toBeNull();
});
