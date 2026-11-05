import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { roleIn } from "./lib/organizerAuth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2027-01-15 12:00 in Asia/Dubai (UTC+4). */
const NOW = 1_800_000_000_000;
const TZ = "Asia/Dubai";

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
async function signedIn(t: T, displayName: string, lastSeenAt = NOW) {
  seq += 1;
  const token = `organizer-token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const ids = await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone: `+97157000${String(seq).padStart(4, "0")}`,
      displayName,
      verifiedAt: 0,
      timeZone: TZ,
      lastSeenAt,
    });
    const sessionId = await ctx.db.insert("sessions", {
      personId,
      tokenHash,
      alertTokenHash: `alert-${seq}`,
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    return { personId, sessionId };
  });
  return { ...ids, token, displayName };
}
type Who = Awaited<ReturnType<typeof signedIn>>;

async function setup() {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const at = Date.now();
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: org.token,
    name: "ختمة الأسرة",
    schedule: "daily",
  });
  // an action nudges the fake clock; nothing is scheduled yet, so reset it
  vi.setSystemTime(at);
  const khatma = await khatmaOf(t, inviteCode);
  return { t, org, code: inviteCode, khatma };
}

async function khatmaOf(t: T, code: string): Promise<Doc<"khatmas">> {
  const khatma = await t.run((ctx) =>
    ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", code))
      .unique(),
  );
  if (!khatma) throw new Error("no khatma");
  return khatma;
}

async function khatmaById(t: T, id: Id<"khatmas">): Promise<Doc<"khatmas">> {
  const khatma = await t.run((ctx) => ctx.db.get(id));
  if (!khatma) throw new Error("no khatma");
  return khatma;
}

async function join(
  t: T,
  khatmaId: Id<"khatmas">,
  who: Who,
  opts: {
    joinedAt?: number;
    status?: Doc<"members">["status"];
    shareToken?: string;
  } = {},
) {
  await t.run((ctx) =>
    ctx.db.insert("members", {
      khatmaId,
      personId: who.personId,
      joinedAt: opts.joinedAt ?? NOW,
      status: opts.status ?? "active",
      shareToken: opts.shareToken,
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    }),
  );
}

async function memberOf(t: T, khatmaId: Id<"khatmas">, who: Who) {
  const member = await t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatmaId).eq("personId", who.personId),
      )
      .unique(),
  );
  if (!member) throw new Error("no member");
  return member;
}

async function notesOf(t: T, who: Who, kind?: Doc<"notes">["kind"]) {
  const notes = await t.run((ctx) => ctx.db.query("notes").collect());
  return notes.filter(
    (n) => n.personId === who.personId && (!kind || n.kind === kind),
  );
}

const settingsOf = (t: T, code: string, who: Who) =>
  t.query(api.organizer.settings, {
    sessionToken: who.token,
    inviteCode: code,
  });
const take = (t: T, code: string, who: Who, juz: number) =>
  t.mutation(api.pool.take, { sessionToken: who.token, inviteCode: code, juz });
const remove = (t: T, code: string, by: Who, memberId: Id<"members">) =>
  t.mutation(api.organizer.removeMember, {
    sessionToken: by.token,
    inviteCode: code,
    memberId,
  });

test("only the organizer can read settings or act", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await join(t, khatma._id, ali);
  const aliMember = await memberOf(t, khatma._id, ali);

  expect(await settingsOf(t, code, ali)).toEqual({ forbidden: true });
  expect(await t.query(api.organizer.settings, { inviteCode: code })).toEqual({
    forbidden: true,
  });
  await expect(
    t.mutation(api.organizer.update, {
      sessionToken: ali.token,
      inviteCode: code,
      name: "س",
    }),
  ).rejects.toThrow(/forbidden/);
  await expect(remove(t, code, ali, aliMember._id)).rejects.toThrow(
    /forbidden/,
  );
  await expect(
    t.mutation(api.organizer.unblock, {
      sessionToken: ali.token,
      inviteCode: code,
      memberId: aliMember._id,
    }),
  ).rejects.toThrow(/forbidden/);
  await expect(
    t.mutation(api.organizer.handOver, {
      sessionToken: ali.token,
      inviteCode: code,
      memberId: aliMember._id,
    }),
  ).rejects.toThrow(/forbidden/);
  await expect(
    t.action(api.organizer.resetInvite, {
      sessionToken: ali.token,
      inviteCode: code,
    }),
  ).rejects.toThrow(/forbidden/);

  // the organizer's own row is no longer active: still the creator, still refused
  const orgMember = await memberOf(t, khatma._id, org);
  await t.run((ctx) => ctx.db.patch(orgMember._id, { status: "blocked" }));
  expect(await settingsOf(t, code, org)).toEqual({ forbidden: true });
  await expect(
    t.mutation(api.organizer.update, {
      sessionToken: org.token,
      inviteCode: code,
      name: "س",
    }),
  ).rejects.toThrow(/forbidden/);
  await t.run((ctx) => ctx.db.patch(orgMember._id, { status: "former" }));
  expect(await settingsOf(t, code, org)).toEqual({ forbidden: true });
});

test("settings lists names only, by join date", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const sara = await signedIn(t, "سارة");
  const omar = await signedIn(t, "عمر");
  await join(t, khatma._id, sara, { joinedAt: NOW + 2 * HOUR });
  await join(t, khatma._id, ali, { joinedAt: NOW + HOUR });
  await join(t, khatma._id, omar, { status: "blocked", joinedAt: NOW });
  expect(await take(t, code, ali, 4)).toEqual({ ok: true });

  const s = await settingsOf(t, code, org);
  if ("forbidden" in s) throw new Error("forbidden");
  expect(s.name).toBe("ختمة الأسرة");
  expect(s.schedule).toBe("daily");
  expect(s.grace).toEqual({ value: 6, unit: "hours" });
  expect(s.suggestedGrace).toEqual({ value: 6, unit: "hours" });
  expect(s.members.map((m) => m.displayName)).toEqual([
    "المنظم",
    "علي",
    "سارة",
  ]);
  expect(s.members.map((m) => m.isOrganizer)).toEqual([true, false, false]);
  expect(s.blocked.map((m) => m.displayName)).toEqual(["عمر"]);
  expect(s.archived).toBe(false);
  expect(Object.keys(s.members[0] ?? {}).sort()).toEqual([
    "displayName",
    "isCoOrganizer",
    "isOrganizer",
    "memberId",
  ]);
  expect(JSON.stringify(s)).not.toMatch(/phone|pace|finished|taken/i);
});

test("update: rename, schedule from next round, grace validation", async () => {
  const { t, org, code, khatma } = await setup();
  const update = (args: {
    name?: string | null;
    schedule?: Doc<"khatmas">["schedule"];
    grace?: Doc<"khatmas">["grace"];
  }) =>
    t.mutation(api.organizer.update, {
      sessionToken: org.token,
      inviteCode: code,
      ...args,
    });

  expect(await update({ name: "  ختمة   الجمعة " })).toEqual({ ok: true });
  expect((await khatmaById(t, khatma._id)).name).toBe("ختمة الجمعة");
  expect(await update({ name: null })).toEqual({ ok: true });
  expect((await khatmaById(t, khatma._id)).name).toBeNull();

  const roundBefore = await t.run((ctx) => ctx.db.get(khatma.currentRoundId!));
  expect(await update({ schedule: "weekly" })).toEqual({ ok: true });
  const changed = await khatmaById(t, khatma._id);
  expect(changed.schedule).toBe("weekly");
  // the running round keeps its target end; a name change leaves the schedule alone
  const roundAfter = await t.run((ctx) => ctx.db.get(khatma.currentRoundId!));
  expect(roundAfter?.targetEndAt).toBe(roundBefore?.targetEndAt);
  expect(changed.name).toBeNull();

  expect(await update({ grace: { value: 2, unit: "days" } })).toEqual({
    ok: true,
  });
  expect((await khatmaById(t, khatma._id)).grace).toEqual({
    value: 2,
    unit: "days",
  });

  // invalid grace is refused as a whole: nothing else in the call applies
  for (const grace of [
    { value: 29, unit: "minutes" as const },
    { value: 31, unit: "days" as const },
    { value: 0, unit: "hours" as const },
    { value: 1.5, unit: "hours" as const },
  ]) {
    expect(await update({ name: "جديد", grace })).toEqual({
      ok: false,
      reason: "invalid_grace",
    });
  }
  const unchanged = await khatmaById(t, khatma._id);
  expect(unchanged.name).toBeNull();
  expect(unchanged.grace).toEqual({ value: 2, unit: "days" });

  // a blank name is how create reads it: untitled
  expect(await update({ name: "   " })).toEqual({ ok: true });
  expect((await khatmaById(t, khatma._id)).name).toBeNull();
});

test("resetInvite: old code notFound, old share tokens give no inviterName, new code works", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const sara = await signedIn(t, "سارة");
  await join(t, khatma._id, ali, { shareToken: "AAAAAAAAAAA" });
  await join(t, khatma._id, sara, {
    status: "blocked",
    shareToken: "BBBBBBBBBBB",
  });
  const orgToken = (await memberOf(t, khatma._id, org)).shareToken;
  expect(orgToken).toMatch(/^[A-Za-z0-9_-]{11}$/);

  const { inviteCode } = await t.action(api.organizer.resetInvite, {
    sessionToken: org.token,
    inviteCode: code,
  });
  expect(inviteCode).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(inviteCode).not.toBe(code);

  const view = (c: string, from?: string, who?: Who) =>
    t.query(api.khatmas.view, {
      sessionToken: who?.token,
      inviteCode: c,
      from,
    });
  expect(await view(code)).toEqual({ notFound: true });
  const fresh = await view(inviteCode);
  if ("notFound" in fresh || "rota" in fresh) throw new Error("notFound");
  expect(fresh.khatmaId).toBe(khatma._id);
  expect(fresh.me.isMember).toBe(false);
  expect(
    (await view(inviteCode, "AAAAAAAAAAA")) as { inviterName: unknown },
  ).toMatchObject({ inviterName: null });
  expect(
    (await view(inviteCode, orgToken)) as { inviterName: unknown },
  ).toMatchObject({ inviterName: null });

  // new tokens for the active members; the non-active row has none
  const aliToken = (await memberOf(t, khatma._id, ali)).shareToken;
  expect(aliToken).toMatch(/^[A-Za-z0-9_-]{11}$/);
  expect(aliToken).not.toBe("AAAAAAAAAAA");
  expect((await memberOf(t, khatma._id, sara)).shareToken).toBeUndefined();
  expect(
    (await view(inviteCode, aliToken)) as { inviterName: unknown },
  ).toMatchObject({ inviterName: "علي" });

  // the khatma itself is untouched, and members still see it as theirs
  const mine = await view(inviteCode, undefined, ali);
  if ("notFound" in mine || "rota" in mine) throw new Error("notFound");
  expect(mine.me.isMember).toBe(true);
  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(org.personId);
});

test("removeMember frees their juz without an organizer alert and blocks rejoining", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const sara = await signedIn(t, "سارة");
  await join(t, khatma._id, ali, { shareToken: "AAAAAAAAAAA" });
  await join(t, khatma._id, sara);
  expect(await take(t, code, ali, 7)).toEqual({ ok: true });
  expect(await take(t, code, sara, 8)).toEqual({ ok: true });
  const aliMember = await memberOf(t, khatma._id, ali);

  // notes that die with the member, and an organizer alert for their juz'
  const aliRow = await t.run(async (ctx) =>
    (await ctx.db.query("assignments").collect()).find((a) => a.juz === 7),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("notes", {
      personId: ali.personId,
      khatmaId: khatma._id,
      kind: "almostUp",
      juz: [7],
      count: null,
      until: null,
      assignmentId: aliRow?._id ?? null,
      roundNumber: null,
      createdAt: NOW,
      pushedAt: null,
      clearedAt: null,
    });
    await ctx.db.insert("notes", {
      personId: org.personId,
      khatmaId: khatma._id,
      kind: "openForHelp",
      juz: [7, 8],
      count: null,
      until: null,
      assignmentId: null,
      roundNumber: null,
      createdAt: NOW,
      pushedAt: null,
      clearedAt: null,
    });
  });

  expect(await remove(t, code, org, aliMember._id)).toEqual({ ok: true });

  const gone = await memberOf(t, khatma._id, ali);
  expect(gone.status).toBe("blocked");
  expect(gone.shareToken).toBeUndefined();
  const row = await t.run((ctx) => ctx.db.get(aliRow!._id));
  expect(row?.releasedAt).not.toBeNull();
  expect(row?.releasedBySystem).toBe(true);
  expect(row?.finishedAt).toBeNull();
  expect((await notesOf(t, ali)).every((n) => n.clearedAt !== null)).toBe(true);
  // no alert for a removal: only the old one is left, and juz' 7 is out of it
  const alerts = await notesOf(t, org, "openForHelp");
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.juz).toEqual([8]);

  // sara's hold is untouched; juz' 7 is open again and rejoining is refused
  const states = await t.query(api.khatmas.view, {
    sessionToken: sara.token,
    inviteCode: code,
  });
  if ("notFound" in states || "rota" in states) throw new Error("notFound");
  expect(states.tiles[6]?.state).toBe("open");
  expect(states.tiles[7]?.state).toBe("reading");
  expect(await take(t, code, ali, 7)).toEqual({ ok: false, reason: "blocked" });

  // a removed member who is blocked can't be removed twice
  expect(await remove(t, code, org, aliMember._id)).toEqual({
    ok: false,
    reason: "not_member",
  });

  // unblock makes them a former member; taking again joins them afresh
  expect(
    await t.mutation(api.organizer.unblock, {
      sessionToken: org.token,
      inviteCode: code,
      memberId: aliMember._id,
    }),
  ).toEqual({ ok: true });
  expect((await memberOf(t, khatma._id, ali)).status).toBe("former");
  const listed = await settingsOf(t, code, org);
  if ("forbidden" in listed) throw new Error("forbidden");
  expect(listed.blocked).toEqual([]);
  expect(listed.members.map((m) => m.displayName)).not.toContain("علي");
  expect(await take(t, code, ali, 7)).toEqual({ ok: true });
  expect((await memberOf(t, khatma._id, ali)).status).toBe("active");
});

test("removeMember never alerts the organizer, even for a hold opened for help", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await join(t, khatma._id, ali);
  expect(await take(t, code, ali, 3)).toEqual({ ok: true });
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("assignments").collect())[0];
    await ctx.db.patch(row!._id, { openedForHelpAt: NOW });
  });
  await remove(t, code, org, (await memberOf(t, khatma._id, ali))._id);
  expect(await notesOf(t, org, "openForHelp")).toEqual([]);
});

test("organizer cannot remove themselves, or someone outside the khatma", async () => {
  const { t, org, code, khatma } = await setup();
  const orgMember = await memberOf(t, khatma._id, org);
  expect(await remove(t, code, org, orgMember._id)).toEqual({
    ok: false,
    reason: "self",
  });
  expect((await memberOf(t, khatma._id, org)).status).toBe("active");

  // a member of another khatma
  const other = await signedIn(t, "غريب");
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: other.token,
    name: null,
    schedule: "daily",
  });
  const otherKhatma = await khatmaOf(t, inviteCode);
  const stranger = await memberOf(t, otherKhatma._id, other);
  expect(await remove(t, code, org, stranger._id)).toEqual({
    ok: false,
    reason: "not_member",
  });
  expect((await memberOf(t, otherKhatma._id, other)).status).toBe("active");
});

test("handOver moves the role and notifies the new organizer", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  await join(t, khatma._id, ali);
  const aliMember = await memberOf(t, khatma._id, ali);
  const orgMember = await memberOf(t, khatma._id, org);
  const handOver = (who: Who, memberId: Id<"members">) =>
    t.mutation(api.organizer.handOver, {
      sessionToken: who.token,
      inviteCode: code,
      memberId,
    });

  expect(await handOver(org, orgMember._id)).toEqual({
    ok: false,
    reason: "self",
  });
  expect(await handOver(org, aliMember._id)).toEqual({ ok: true });
  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(ali.personId);
  expect(await notesOf(t, ali, "nowOrganizer")).toHaveLength(1);
  expect(await notesOf(t, org, "nowOrganizer")).toHaveLength(0);

  // the old organizer helps as a co-organizer now; the new one owns it
  const old = await settingsOf(t, code, org);
  if ("forbidden" in old) throw new Error("forbidden");
  expect(old.access.owner).toBe(false);
  const s = await settingsOf(t, code, ali);
  if ("forbidden" in s) throw new Error("forbidden");
  expect(s.members.map((m) => m.isOrganizer)).toEqual([false, true]);

  // only active members can take the role
  await t.run((ctx) => ctx.db.patch(orgMember._id, { status: "blocked" }));
  expect(await handOver(ali, orgMember._id)).toEqual({
    ok: false,
    reason: "not_member",
  });
});

test("autoHandover after 30 days picks the earliest active joiner; no candidate → no change", async () => {
  const { t, org, khatma } = await setup();
  const stale = await signedIn(t, "قديم", NOW - 8 * DAY); // earliest, but not seen for 8 days
  const blocked = await signedIn(t, "محظور", NOW - DAY);
  const second = await signedIn(t, "ثاني", NOW - 2 * DAY);
  const third = await signedIn(t, "ثالث", NOW);
  await join(t, khatma._id, third, { joinedAt: NOW + 3 * HOUR });
  await join(t, khatma._id, second, { joinedAt: NOW + 2 * HOUR });
  await join(t, khatma._id, blocked, {
    joinedAt: NOW + HOUR,
    status: "blocked",
  });
  await join(t, khatma._id, stale, { joinedAt: NOW + 1000 });
  const sweep = async () => {
    await t.mutation(internal.organizer.autoHandoverSweep, {});
    vi.advanceTimersByTime(10);
    await t.finishInProgressScheduledFunctions();
  };

  // the organizer was here 29 days ago: nothing happens
  await t.run((ctx) =>
    ctx.db.patch(org.personId, { lastSeenAt: NOW - 29 * DAY }),
  );
  await sweep();
  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(org.personId);

  // 31 days away: the earliest joiner seen within a week takes over
  await t.run((ctx) =>
    ctx.db.patch(org.personId, { lastSeenAt: NOW - 31 * DAY }),
  );
  await sweep();
  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(
    second.personId,
  );
  expect(await notesOf(t, second, "nowOrganizer")).toHaveLength(1);
  expect(await notesOf(t, org, "organizerMoved")).toHaveLength(1);
  expect(await notesOf(t, stale, "nowOrganizer")).toHaveLength(0);
  // the old organizer is still a member
  expect((await memberOf(t, khatma._id, org)).status).toBe("active");

  // a second sweep changes nothing: the new organizer was seen two days ago
  await sweep();
  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(
    second.personId,
  );
  expect(await notesOf(t, org, "organizerMoved")).toHaveLength(1);

  // nobody else seen in the last week: no change
  const { t: t2, org: org2, khatma: khatma2 } = await setup();
  const away = await signedIn(t2, "بعيد", NOW - 20 * DAY);
  await join(t2, khatma2._id, away);
  await t2.run((ctx) =>
    ctx.db.patch(org2.personId, { lastSeenAt: NOW - 40 * DAY }),
  );
  await t2.mutation(internal.organizer.autoHandoverSweep, {});
  vi.advanceTimersByTime(10);
  await t2.finishInProgressScheduledFunctions();
  expect((await khatmaById(t2, khatma2._id)).creatorPersonId).toBe(
    org2.personId,
  );
  expect(await notesOf(t2, org2, "organizerMoved")).toHaveLength(0);
});

test("autoHandoverSweep leaves a rota khatma with its away organizer", async () => {
  const { t, org } = await setup();
  const member = await signedIn(t, "عضو", NOW);
  const rotaId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("khatmas", {
      name: "ختمة التناوب",
      schedule: "none",
      grace: { value: 7, unit: "days" },
      creatorPersonId: org.personId,
      inviteCode: "rotaorg",
      completedRounds: 0,
      createdAt: NOW,
      kind: "rota",
    });
    return id;
  });
  await join(t, rotaId, member);
  await t.run((ctx) =>
    ctx.db.patch(org.personId, { lastSeenAt: NOW - 60 * DAY }),
  );
  await t.mutation(internal.organizer.autoHandoverSweep, {});
  vi.advanceTimersByTime(10);
  await t.finishInProgressScheduledFunctions();
  expect((await khatmaOf(t, "rotaorg")).creatorPersonId).toBe(org.personId);
  expect(await notesOf(t, member, "nowOrganizer")).toHaveLength(0);
});

test("the pool organizer controls refuse a rota khatma", async () => {
  const { t, org } = await setup();
  const member = await signedIn(t, "عضو", NOW);
  const rotaId = await t.run((ctx) =>
    ctx.db.insert("khatmas", {
      name: "ختمة التناوب",
      schedule: "none",
      grace: { value: 7, unit: "days" },
      creatorPersonId: org.personId,
      inviteCode: "rotaorg12345",
      completedRounds: 0,
      createdAt: NOW,
      kind: "rota",
    }),
  );
  await join(t, rotaId, org);
  await join(t, rotaId, member);
  const base = { sessionToken: org.token, inviteCode: "rotaorg12345" };

  await expect(
    t.mutation(api.organizer.update, { ...base, name: "جديد" }),
  ).rejects.toThrow(/forbidden/);
  expect((await khatmaOf(t, "rotaorg12345")).name).toBe("ختمة التناوب");
  await expect(t.action(api.organizer.resetInvite, base)).rejects.toThrow(
    /forbidden/,
  );
  // a rota khatma is transferred too, but only to one of its participants
  const memberId = (await memberOf(t, rotaId, member))._id;
  expect(
    await t.mutation(api.organizer.handOver, { ...base, memberId }),
  ).toEqual({ ok: false, reason: "not_member" });
  expect((await khatmaOf(t, "rotaorg12345")).creatorPersonId).toBe(
    org.personId,
  );
});

/** An archived khatma with an active member and a blocked one. */
async function archivedSetup() {
  const { t, org, code, khatma } = await setup();
  const member = await signedIn(t, "عضو");
  const blocked = await signedIn(t, "محظور");
  await join(t, khatma._id, member, { shareToken: "memberShare" });
  await join(t, khatma._id, blocked, { status: "blocked" });
  const base = { sessionToken: org.token, inviteCode: code };
  await t.mutation(api.khatmaLifecycle.archive, base);
  return {
    t,
    org,
    code,
    khatma,
    base,
    memberId: (await memberOf(t, khatma._id, member))._id,
    blockedId: (await memberOf(t, khatma._id, blocked))._id,
  };
}

test("settings say the khatma is archived", async () => {
  const { t, org, code } = await archivedSetup();
  const s = await settingsOf(t, code, org);
  if ("forbidden" in s) throw new Error("forbidden");
  expect(s.archived).toBe(true);
});

test("update refuses an archived khatma", async () => {
  const { t, code, base } = await archivedSetup();
  await expect(
    t.mutation(api.organizer.update, { ...base, name: "جديد" }),
  ).rejects.toMatchObject({ data: { code: "archived" } });
  expect((await khatmaOf(t, code)).name).toBe("ختمة الأسرة");
});

test("resetInvite refuses an archived khatma before drawing a code", async () => {
  const { t, org, code, base } = await archivedSetup();
  await expect(t.action(api.organizer.resetInvite, base)).rejects.toThrow(
    /archived/,
  );
  await expect(
    t.query(internal.organizer.activeMemberCount, {
      personId: org.personId,
      inviteCode: code,
    }),
  ).rejects.toMatchObject({ data: { code: "archived" } });
  expect((await khatmaOf(t, code)).inviteCode).toBe(code);
});

test("applyInviteReset refuses an archived khatma", async () => {
  const { t, org, code } = await archivedSetup();
  await expect(
    t.mutation(internal.organizer.applyInviteReset, {
      personId: org.personId,
      inviteCode: code,
      newInviteCode: "newInvite123",
      shareTokens: [],
    }),
  ).rejects.toMatchObject({ data: { code: "archived" } });
  expect((await khatmaOf(t, code)).inviteCode).toBe(code);
});

test("removeMember refuses an archived khatma", async () => {
  const { t, base, memberId } = await archivedSetup();
  await expect(
    t.mutation(api.organizer.removeMember, { ...base, memberId }),
  ).rejects.toMatchObject({ data: { code: "archived" } });
  expect((await t.run((ctx) => ctx.db.get(memberId)))?.status).toBe("active");
});

test("unblock refuses an archived khatma", async () => {
  const { t, base, blockedId } = await archivedSetup();
  await expect(
    t.mutation(api.organizer.unblock, { ...base, memberId: blockedId }),
  ).rejects.toMatchObject({ data: { code: "archived" } });
  expect((await t.run((ctx) => ctx.db.get(blockedId)))?.status).toBe("blocked");
});

test("handOver refuses an archived khatma", async () => {
  const { t, org, code, base, memberId } = await archivedSetup();
  await expect(
    t.mutation(api.organizer.handOver, { ...base, memberId }),
  ).rejects.toMatchObject({ data: { code: "archived" } });
  expect((await khatmaOf(t, code)).creatorPersonId).toBe(org.personId);
  expect(await notesOf(t, org)).toEqual([]);
});

test("an archived khatma's organizer can still read its settings and delete it", async () => {
  const { t, org, code, base, khatma } = await archivedSetup();
  expect(await settingsOf(t, code, org)).toMatchObject({
    name: "ختمة الأسرة",
  });
  expect(await t.mutation(api.khatmaLifecycle.archive, base)).toEqual({
    ok: true,
  });
  expect(await t.mutation(api.khatmaLifecycle.remove, base)).toEqual({
    ok: true,
  });
  expect(await t.run((ctx) => ctx.db.get(khatma._id))).toBeNull();
});

test("touch updates lastSeenAt and timeZone", async () => {
  const { t, org } = await setup();
  const person = () => t.run((ctx) => ctx.db.get(org.personId));
  const touch = (timeZone: string, who: Who | null = org) =>
    t.mutation(api.people.touch, { sessionToken: who?.token, timeZone });

  // seen a moment ago: left alone, but a new zone is saved
  expect(await touch("Asia/Dubai")).toEqual({ ok: true });
  expect((await person())?.lastSeenAt).toBe(NOW);
  expect(await touch("Europe/London")).toEqual({ ok: true });
  expect((await person())?.timeZone).toBe("Europe/London");
  expect((await person())?.lastSeenAt).toBe(NOW);

  // an hour later it moves
  vi.setSystemTime(NOW + HOUR + 1);
  expect(await touch("Europe/London")).toEqual({ ok: true });
  expect((await person())?.lastSeenAt).toBe(NOW + HOUR + 1);

  // a zone Intl rejects is stored as one it accepts
  expect(await touch("Not/AZone")).toEqual({ ok: true });
  expect((await person())?.timeZone).toBe("UTC");

  expect(await touch("Asia/Dubai", null)).toEqual({ ok: false });
});

// ---------------------------------------------------------------------------
// Transferring ownership (co-organizers spec 4.5)

const ALL = { readings: true, people: true, settings: true };

const setSetting = (t: T, key: string, value: unknown) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key, value, updatedAt: 0 });
  });

/** Names someone a co-organizer as the owner would, by candidate id. */
async function nameCo(
  t: T,
  code: string,
  owner: Who,
  candidateId: string,
  switches = ALL,
) {
  const r = await t.mutation(api.coOrganizers.set, {
    sessionToken: owner.token,
    inviteCode: code,
    candidateId,
    ...switches,
  });
  if (!("ok" in r)) throw new Error(JSON.stringify(r));
}

async function coRows(t: T, khatmaId: Id<"khatmas">) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("coOrganizers")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .collect(),
  );
  return rows.sort((a, b) => a.addedAt - b.addedAt);
}

async function phoneOf(t: T, who: Who): Promise<string> {
  return (await t.run((ctx) => ctx.db.get(who.personId)))!.phone;
}

async function roleOf(t: T, khatmaId: Id<"khatmas">, who: Who) {
  return await t.run(async (ctx) =>
    roleIn(ctx, (await ctx.db.get(khatmaId))!, await ctx.db.get(who.personId)),
  );
}

async function sweep(t: T) {
  await t.mutation(internal.organizer.autoHandoverSweep, {});
  vi.advanceTimersByTime(10);
  await t.finishInProgressScheduledFunctions();
}

/** A rota khatma the organizer made; they are participant 1 and a member. */
async function rotaSetup() {
  const t = convexTest(schema, modules);
  await setSetting(t, "rotaStartNextDay", false);
  const org = await signedIn(t, "المنظم");
  await t.run((ctx) => ctx.db.patch(org.personId, { rotaAllowed: true }));
  const at = Date.now();
  const { inviteCode } = await t.action(api.rota.create, {
    sessionToken: org.token,
    name: "ختمة التناوب",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
    endDate: null,
  });
  vi.setSystemTime(at);
  return { t, org, code: inviteCode, khatma: await khatmaOf(t, inviteCode) };
}

/** A signed-in person on a mobile number a rota khatma accepts. */
async function rotaPerson(t: T, displayName: string, phone: string) {
  const who = await signedIn(t, displayName);
  await t.run((ctx) => ctx.db.patch(who.personId, { phone }));
  return who;
}

async function addParticipant(
  t: T,
  code: string,
  by: Who,
  name: string,
  phone: string,
): Promise<Id<"rotaParticipants">> {
  const r = await t.mutation(api.rota.addParticipant, {
    sessionToken: by.token,
    inviteCode: code,
    name,
    phone,
  });
  if (!("participantId" in r)) throw new Error(JSON.stringify(r));
  return r.participantId;
}

test("transfer makes the old owner a co-organizer with every switch, and ends the new owner's co-organizer role", async () => {
  const { t, org, code, khatma } = await setup();
  const ali = await signedIn(t, "علي");
  const bob = await signedIn(t, "بلال");
  await join(t, khatma._id, ali);
  await join(t, khatma._id, bob);
  const aliMember = await memberOf(t, khatma._id, ali);
  const bobMember = await memberOf(t, khatma._id, bob);
  await nameCo(t, code, org, `m:${aliMember._id}`, {
    readings: true,
    people: false,
    settings: false,
  });
  vi.advanceTimersByTime(1000);
  await nameCo(t, code, org, `m:${bobMember._id}`);
  // already over the limit: the old owner's row is added anyway
  await setSetting(t, "maxCoOrganizers", 1);

  expect(
    await t.mutation(api.organizer.handOver, {
      sessionToken: org.token,
      inviteCode: code,
      memberId: aliMember._id,
    }),
  ).toEqual({ ok: true });

  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(ali.personId);
  const rows = await coRows(t, khatma._id);
  expect(rows.map((r) => r.phone)).toEqual([
    await phoneOf(t, bob),
    await phoneOf(t, org),
  ]);
  expect(rows[1]).toMatchObject(ALL);
  expect(await roleOf(t, khatma._id, org)).toEqual({ owner: false, ...ALL });
  expect(await roleOf(t, khatma._id, ali)).toEqual({ owner: true });
  expect((await memberOf(t, khatma._id, org)).status).toBe("active");
  // the transfer's own notes, and no "you're a co-organizer now" on top
  expect(await notesOf(t, ali, "nowOrganizer")).toHaveLength(1);
  expect(await notesOf(t, org, "coOrganizerNow")).toHaveLength(0);
  expect(await notesOf(t, org, "organizerMoved")).toHaveLength(0);
});

test("oldOwnerStaysOn off leaves the old owner a plain member", async () => {
  const { t, org, code, khatma } = await setup();
  await setSetting(t, "oldOwnerStaysOn", false);
  const ali = await signedIn(t, "علي");
  await join(t, khatma._id, ali);
  const aliMember = await memberOf(t, khatma._id, ali);
  await nameCo(t, code, org, `m:${aliMember._id}`);

  expect(
    await t.mutation(api.organizer.handOver, {
      sessionToken: org.token,
      inviteCode: code,
      memberId: aliMember._id,
    }),
  ).toEqual({ ok: true });

  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(ali.personId);
  expect(await coRows(t, khatma._id)).toEqual([]);
  expect(await roleOf(t, khatma._id, org)).toBeNull();
  expect(await settingsOf(t, code, org)).toEqual({ forbidden: true });
  expect((await memberOf(t, khatma._id, org)).status).toBe("active");
});

test("a rota khatma can be transferred to a participant with an account, not to a pending one", async () => {
  const { t, org, code, khatma } = await rotaSetup();
  const ali = await rotaPerson(t, "علي", "+971505550011");
  const aliId = await addParticipant(
    t,
    code,
    org,
    "علي",
    await phoneOf(t, ali),
  );
  // a co-organizer who hasn't signed in yet (Review Focus 5)
  const pendingId = await addParticipant(t, code, org, "خالد", "+971505550001");
  await nameCo(t, code, org, `p:${pendingId}`);
  const ownerRow = (
    await t.run((ctx) =>
      ctx.db
        .query("rotaParticipants")
        .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
        .collect(),
    )
  ).find((p) => p.personId === org.personId)!;
  const handOver = (
    who: Who,
    target: {
      memberId?: Id<"members">;
      participantId?: Id<"rotaParticipants">;
    },
  ) =>
    t.mutation(api.organizer.handOver, {
      sessionToken: who.token,
      inviteCode: code,
      ...target,
    });
  const snapshot = async () => ({
    khatma: await khatmaById(t, khatma._id),
    rows: await coRows(t, khatma._id),
    members: await t.run((ctx) => ctx.db.query("members").collect()),
    notes: await t.run((ctx) => ctx.db.query("notes").collect()),
  });

  const before = await snapshot();
  expect(await handOver(org, { participantId: pendingId })).toEqual({
    ok: false,
    reason: "no_account",
  });
  expect(await handOver(org, { participantId: ownerRow._id })).toEqual({
    ok: false,
    reason: "self",
  });
  expect(await handOver(org, {})).toEqual({ ok: false, reason: "not_member" });
  expect(await snapshot()).toEqual(before);

  // a participant with an account, who isn't a co-organizer
  expect(await handOver(org, { participantId: aliId })).toEqual({ ok: true });
  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(ali.personId);
  expect(await roleOf(t, khatma._id, ali)).toEqual({ owner: true });
  expect(await roleOf(t, khatma._id, org)).toEqual({ owner: false, ...ALL });
  expect((await memberOf(t, khatma._id, ali)).status).toBe("active");
  expect(await notesOf(t, ali, "nowOrganizer")).toHaveLength(1);
  expect(
    (await t.query(api.khatmas.mine, { sessionToken: ali.token })).map(
      (k) => k.inviteCode,
    ),
  ).toEqual([code]);

  // and back to the old owner by their co-organizer membership: each keeps
  // the membership they need
  const orgMember = await memberOf(t, khatma._id, org);
  expect(await handOver(ali, { memberId: orgMember._id })).toEqual({
    ok: true,
  });
  expect(await roleOf(t, khatma._id, org)).toEqual({ owner: true });
  expect(await roleOf(t, khatma._id, ali)).toEqual({ owner: false, ...ALL });
  expect((await memberOf(t, khatma._id, org)).status).toBe("active");
  expect((await memberOf(t, khatma._id, ali)).status).toBe("active");
  expect((await coRows(t, khatma._id)).map((r) => r.phone)).toEqual([
    "+971505550001",
    await phoneOf(t, ali),
  ]);
});

test("after a rota transfer to a participant added by phone, the owner checks find the new owner", async () => {
  const { t, org, code, khatma } = await rotaSetup();
  const ali = await rotaPerson(t, "علي", "+971505550011");
  // added by phone: the row names no account
  const aliId = await addParticipant(
    t,
    code,
    org,
    "علي",
    await phoneOf(t, ali),
  );
  expect((await t.run((ctx) => ctx.db.get(aliId)))?.personId).toBeNull();
  expect(
    await t.mutation(api.organizer.handOver, {
      sessionToken: org.token,
      inviteCode: code,
      participantId: aliId,
    }),
  ).toEqual({ ok: true });
  // the old owner stays on with every switch, People included
  expect(await roleOf(t, khatma._id, org)).toEqual({ owner: false, ...ALL });

  const aliRow = async () => {
    const view = await t.query(api.rota.people, {
      sessionToken: ali.token,
      inviteCode: code,
    });
    return view!.participants.find((p) => p.id === aliId)!;
  };
  const guarded = async () => {
    const row = await aliRow();
    expect(row.isOrganizer).toBe(true);
    expect(row.juz.length).toBeGreaterThan(0);
    expect(
      await t.mutation(api.rota.removeParticipant, {
        sessionToken: org.token,
        inviteCode: code,
        participantId: aliId,
      }),
    ).toEqual({ error: "is_organizer" });
    expect(
      await t.mutation(api.rota.freeJuz, {
        sessionToken: org.token,
        inviteCode: code,
        participantId: aliId,
        juz: row.juz[0]!,
      }),
    ).toEqual({ error: "is_organizer" });
    expect(
      await t.mutation(api.rota.removeParticipant, {
        sessionToken: ali.token,
        inviteCode: code,
        participantId: aliId,
      }),
    ).toEqual({ error: "is_me" });
  };

  // the transfer names the new owner on their row
  expect((await t.run((ctx) => ctx.db.get(aliId)))?.personId).toBe(
    ali.personId,
  );
  await guarded();
  // and the checks match the owner's number even on a row without an account
  await t.run((ctx) => ctx.db.patch(aliId, { personId: null }));
  await guarded();
});

test("a rota old owner who doesn't stay on loses the membership the role gave", async () => {
  const { t, org, code, khatma } = await rotaSetup();
  await setSetting(t, "oldOwnerStaysOn", false);
  const ali = await rotaPerson(t, "علي", "+971505550011");
  const aliId = await addParticipant(
    t,
    code,
    org,
    "علي",
    await phoneOf(t, ali),
  );
  const mine = (who: Who) =>
    t.query(api.khatmas.mine, { sessionToken: who.token });
  expect((await mine(org)).map((k) => k.inviteCode)).toEqual([code]);

  expect(
    await t.mutation(api.organizer.handOver, {
      sessionToken: org.token,
      inviteCode: code,
      participantId: aliId,
    }),
  ).toEqual({ ok: true });

  expect(await coRows(t, khatma._id)).toEqual([]);
  expect(await roleOf(t, khatma._id, org)).toBeNull();
  const orgMembership = await t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatma._id).eq("personId", org.personId),
      )
      .first(),
  );
  expect(orgMembership).toBeNull();
  expect(await mine(org)).toEqual([]);
  expect((await mine(ali)).map((k) => k.inviteCode)).toEqual([code]);
});

test("auto handover picks the longest-serving active co-organizer before the longest-standing member", async () => {
  const { t, org, code, khatma } = await setup();
  const early = await signedIn(t, "قديم");
  const staleCo = await signedIn(t, "غائب", NOW - 8 * DAY);
  const firstCo = await signedIn(t, "أول");
  const laterCo = await signedIn(t, "ثان");
  await join(t, khatma._id, early, { joinedAt: NOW + 1 });
  await join(t, khatma._id, laterCo, { joinedAt: NOW + 2 });
  await join(t, khatma._id, firstCo, { joinedAt: NOW + 3 });
  await join(t, khatma._id, staleCo, { joinedAt: NOW + 4 });
  for (const who of [staleCo, firstCo, laterCo]) {
    await nameCo(t, code, org, `m:${(await memberOf(t, khatma._id, who))._id}`);
    vi.advanceTimersByTime(1000);
  }
  await t.run((ctx) =>
    ctx.db.patch(org.personId, { lastSeenAt: NOW - 31 * DAY }),
  );

  await sweep(t);

  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(
    firstCo.personId,
  );
  expect(await notesOf(t, firstCo, "nowOrganizer")).toHaveLength(1);
  expect(await notesOf(t, org, "organizerMoved")).toHaveLength(1);
  const rows = await coRows(t, khatma._id);
  expect(rows.map((r) => r.phone)).toEqual([
    await phoneOf(t, staleCo),
    await phoneOf(t, laterCo),
    await phoneOf(t, org),
  ]);
  expect(await roleOf(t, khatma._id, org)).toEqual({ owner: false, ...ALL });
});

test("auto handover hands a rota khatma only to a co-organizer, and does nothing without one", async () => {
  const { t, org, code, khatma } = await rotaSetup();
  const ali = await rotaPerson(t, "علي", "+971505550011");
  const bob = await rotaPerson(t, "بلال", "+971505550012");
  await addParticipant(t, code, org, "علي", await phoneOf(t, ali));
  const bobId = await addParticipant(
    t,
    code,
    org,
    "بلال",
    await phoneOf(t, bob),
  );
  const away = () =>
    t.run((ctx) => ctx.db.patch(org.personId, { lastSeenAt: NOW - 31 * DAY }));

  // a participant with an account isn't enough
  await away();
  await sweep(t);
  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(org.personId);
  expect(await notesOf(t, org, "organizerMoved")).toHaveLength(0);

  await nameCo(t, code, org, `p:${bobId}`);
  await away();
  await sweep(t);
  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(bob.personId);
  expect(await notesOf(t, bob, "nowOrganizer")).toHaveLength(1);
  expect(await notesOf(t, org, "organizerMoved")).toHaveLength(1);
  expect(await roleOf(t, khatma._id, bob)).toEqual({ owner: true });
  expect(await roleOf(t, khatma._id, org)).toEqual({ owner: false, ...ALL });
  expect((await memberOf(t, khatma._id, bob)).status).toBe("active");
});

/** The rota owner's own participant row, found by their phone. */
async function ownerRow(t: T, khatmaId: Id<"khatmas">, owner: Who) {
  const phone = await phoneOf(t, owner);
  const row = await t.run((ctx) =>
    ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma_phone", (q) =>
        q.eq("khatmaId", khatmaId).eq("phone", phone),
      )
      .first(),
  );
  if (!row) throw new Error("no owner row");
  return row;
}

test("a rota owner who replies on WhatsApp keeps the khatma though the website hasn't seen them", async () => {
  const { t, org, code, khatma } = await rotaSetup();
  const bob = await rotaPerson(t, "بلال", "+971505550012");
  const bobId = await addParticipant(
    t,
    code,
    org,
    "بلال",
    await phoneOf(t, bob),
  );
  await nameCo(t, code, org, `p:${bobId}`);
  const row = await ownerRow(t, khatma._id, org);
  await t.run(async (ctx) => {
    await ctx.db.patch(org.personId, { lastSeenAt: NOW - 31 * DAY });
    await ctx.db.patch(row._id, { lastReplyAt: NOW - DAY });
  });

  await sweep(t);

  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(org.personId);
  expect(await notesOf(t, bob, "nowOrganizer")).toHaveLength(0);
});

test("a rota owner an admin set up who never signed in or replied keeps the khatma", async () => {
  const { t, org, code, khatma } = await rotaSetup();
  const bob = await rotaPerson(t, "بلال", "+971505550012");
  const bobId = await addParticipant(
    t,
    code,
    org,
    "بلال",
    await phoneOf(t, bob),
  );
  await nameCo(t, code, org, `p:${bobId}`);
  await t.run((ctx) =>
    ctx.db.patch(org.personId, { lastSeenAt: 0, verifiedAt: 0 }),
  );

  await sweep(t);

  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(org.personId);
  expect(await notesOf(t, bob, "nowOrganizer")).toHaveLength(0);
});

test("a rota owner away from the website and silent on WhatsApp goes to an active co-organizer", async () => {
  const { t, org, code, khatma } = await rotaSetup();
  const bob = await rotaPerson(t, "بلال", "+971505550012");
  const bobId = await addParticipant(
    t,
    code,
    org,
    "بلال",
    await phoneOf(t, bob),
  );
  await nameCo(t, code, org, `p:${bobId}`);
  const row = await ownerRow(t, khatma._id, org);
  await t.run(async (ctx) => {
    await ctx.db.patch(org.personId, { lastSeenAt: NOW - 31 * DAY });
    await ctx.db.patch(row._id, { lastReplyAt: NOW - 31 * DAY });
  });

  await sweep(t);

  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(bob.personId);
  expect(await notesOf(t, bob, "nowOrganizer")).toHaveLength(1);
});

test("handoverToCoOrganizerOn off keeps today's rule and still skips rota", async () => {
  const { t, org, code, khatma } = await setup();
  await setSetting(t, "handoverToCoOrganizerOn", false);
  const early = await signedIn(t, "قديم");
  const co = await signedIn(t, "منظم مساعد");
  await join(t, khatma._id, early, { joinedAt: NOW + 1 });
  await join(t, khatma._id, co, { joinedAt: NOW + 2 });
  await nameCo(t, code, org, `m:${(await memberOf(t, khatma._id, co))._id}`);
  await t.run((ctx) =>
    ctx.db.patch(org.personId, { lastSeenAt: NOW - 31 * DAY }),
  );
  await sweep(t);
  expect((await khatmaById(t, khatma._id)).creatorPersonId).toBe(
    early.personId,
  );

  const rota = await rotaSetup();
  await setSetting(rota.t, "handoverToCoOrganizerOn", false);
  const bob = await rotaPerson(rota.t, "بلال", "+971505550012");
  const bobId = await addParticipant(
    rota.t,
    rota.code,
    rota.org,
    "بلال",
    await phoneOf(rota.t, bob),
  );
  await nameCo(rota.t, rota.code, rota.org, `p:${bobId}`);
  await rota.t.run((ctx) =>
    ctx.db.patch(rota.org.personId, { lastSeenAt: NOW - 31 * DAY }),
  );
  await sweep(rota.t);
  expect((await khatmaById(rota.t, rota.khatma._id)).creatorPersonId).toBe(
    rota.org.personId,
  );
  expect(await notesOf(rota.t, bob, "nowOrganizer")).toHaveLength(0);
});
