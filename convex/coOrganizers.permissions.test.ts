import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import type { Permission } from "./lib/organizerAuth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2027-01-15 11:00 in Asia/Dubai (a Friday): a weekly Friday rota reads today.
const NOW = Date.UTC(2027, 0, 15, 7, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type T = TestConvexForDataModel<DataModel>;

let seq = 0;

/** A person with a live session. */
async function signedIn(t: T, displayName: string) {
  seq += 1;
  const token = `perm-token-${seq}`;
  const phone = `+97158200${String(seq).padStart(4, "0")}`;
  const tokenHash = await sha256Hex(token);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone,
      displayName,
      verifiedAt: NOW,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
      rotaAllowed: true,
    });
    await ctx.db.insert("sessions", {
      personId: id,
      tokenHash,
      alertTokenHash: `perm-alert-${seq}`,
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    return id;
  });
  return { personId, token, phone, displayName };
}
type Who = Awaited<ReturnType<typeof signedIn>>;

const setSetting = (t: T, key: string, value: unknown) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key, value, updatedAt: 0 });
  });

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

async function createPool(t: T, owner: Who, name = "ختمة الأسرة") {
  const at = Date.now();
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: owner.token,
    name,
    schedule: "daily",
  });
  vi.setSystemTime(at);
  return { code: inviteCode, khatma: await khatmaOf(t, inviteCode) };
}

async function join(
  t: T,
  khatmaId: Id<"khatmas">,
  who: Who,
): Promise<Id<"members">> {
  return await t.run((ctx) =>
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

async function memberIdOf(
  t: T,
  khatmaId: Id<"khatmas">,
  who: Who,
): Promise<Id<"members">> {
  const row = await t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatmaId).eq("personId", who.personId),
      )
      .unique(),
  );
  if (!row) throw new Error("no member");
  return row._id;
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

async function ownerParticipant(t: T, khatma: Doc<"khatmas">) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect(),
  );
  const row = rows.find((p) => p.personId === khatma.creatorPersonId);
  if (!row) throw new Error("no owner participant");
  return row._id;
}

type Switches = { readings: boolean; people: boolean; settings: boolean };
const ALL: Switches = { readings: true, people: true, settings: true };
const ONLY = (p: Permission): Switches => ({
  readings: p === "readings",
  people: p === "people",
  settings: p === "settings",
});

async function name(
  t: T,
  code: string,
  by: Who,
  candidateId: string,
  switches: Switches,
) {
  const r = await t.mutation(api.coOrganizers.set, {
    sessionToken: by.token,
    inviteCode: code,
    candidateId,
    ...switches,
  });
  if (!("ok" in r)) throw new Error(JSON.stringify(r));
}

async function coOrganizerIdOf(t: T, code: string, owner: Who) {
  const r = await t.query(api.coOrganizers.list, {
    sessionToken: owner.token,
    inviteCode: code,
  });
  if ("forbidden" in r) throw new Error("forbidden");
  const id = r.coOrganizers[0]?.coOrganizerId;
  if (!id) throw new Error("no co-organizer");
  return id;
}

/** `refused` when the call is turned away: a `forbidden` error, or the query's empty answer. */
async function outcome(
  call: () => Promise<unknown>,
  refusedWhen?: (result: unknown) => boolean,
): Promise<"allowed" | "refused"> {
  try {
    const result = await call();
    return refusedWhen?.(result) ? "refused" : "allowed";
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    const text = `${String(error)} ${JSON.stringify(data ?? null)}`;
    if (/forbidden/.test(text)) return "refused";
    throw error;
  }
}

type Row<C> = {
  fn: string;
  need: Permission | "owner" | "any";
  call: (c: C, who: Who) => Promise<unknown>;
  refusedWhen?: (result: unknown) => boolean;
};

const isNull = (r: unknown) => r === null;
const isForbidden = (r: unknown) =>
  typeof r === "object" && r !== null && "forbidden" in r;

// ---------------------------------------------------------------------------
// Pool khatma

type PoolCtx = {
  t: T;
  org: Who;
  co: Who;
  sara: Who;
  code: string;
  khatma: Doc<"khatmas">;
  orgMember: Id<"members">;
  saraMember: Id<"members">;
};

async function poolWithCoOrganizer(switches: Switches): Promise<PoolCtx> {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { code, khatma } = await createPool(t, org);
  const co = await signedIn(t, "علي");
  const sara = await signedIn(t, "سارة");
  const coMember = await join(t, khatma._id, co);
  const saraMember = await join(t, khatma._id, sara);
  await name(t, code, org, `m:${coMember}`, switches);
  return {
    t,
    org,
    co,
    sara,
    code,
    khatma,
    orgMember: await memberIdOf(t, khatma._id, org),
    saraMember,
  };
}

/** The pool rows of the map; `resetInvite` changes the code, so it goes last. */
const POOL_ROWS: Row<PoolCtx>[] = [
  {
    fn: "organizer.settings",
    need: "any",
    call: (c, who) =>
      c.t.query(api.organizer.settings, {
        sessionToken: who.token,
        inviteCode: c.code,
      }),
    refusedWhen: isForbidden,
  },
  {
    fn: "organizer.update",
    need: "settings",
    call: (c, who) =>
      c.t.mutation(api.organizer.update, {
        sessionToken: who.token,
        inviteCode: c.code,
        name: "ختمة البيت",
      }),
  },
  {
    fn: "organizer.removeMember",
    need: "people",
    // The owner's row: a co-organizer is told `is_organizer`, nobody is removed.
    call: (c, who) =>
      c.t.mutation(api.organizer.removeMember, {
        sessionToken: who.token,
        inviteCode: c.code,
        memberId: who === c.org ? c.saraMember : c.orgMember,
      }),
  },
  {
    fn: "organizer.unblock",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.organizer.unblock, {
        sessionToken: who.token,
        inviteCode: c.code,
        memberId: c.saraMember,
      }),
  },
  {
    fn: "organizer.resetInvite",
    need: "people",
    call: (c, who) =>
      c.t.action(api.organizer.resetInvite, {
        sessionToken: who.token,
        inviteCode: c.code,
      }),
  },
];

const POOL_OWNER_ROWS: Row<PoolCtx>[] = [
  {
    fn: "organizer.handOver",
    need: "owner",
    call: (c, who) =>
      c.t.mutation(api.organizer.handOver, {
        sessionToken: who.token,
        inviteCode: c.code,
        memberId: c.saraMember,
      }),
  },
  {
    fn: "khatmaLifecycle.archive",
    need: "owner",
    call: (c, who) =>
      c.t.mutation(api.khatmaLifecycle.archive, {
        sessionToken: who.token,
        inviteCode: c.code,
      }),
  },
  {
    fn: "khatmaLifecycle.remove",
    need: "owner",
    call: (c, who) =>
      c.t.mutation(api.khatmaLifecycle.remove, {
        sessionToken: who.token,
        inviteCode: c.code,
      }),
  },
  {
    fn: "coOrganizers.list",
    need: "owner",
    call: (c, who) =>
      c.t.query(api.coOrganizers.list, {
        sessionToken: who.token,
        inviteCode: c.code,
      }),
    refusedWhen: isForbidden,
  },
];

// ---------------------------------------------------------------------------
// Rotating khatma

type RotaCtx = {
  t: T;
  org: Who;
  co: Who;
  code: string;
  khatma: Doc<"khatmas">;
  ownerP: Id<"rotaParticipants">;
  coP: Id<"rotaParticipants">;
  saraP: Id<"rotaParticipants">;
  orgContact: Id<"rotaContacts">;
  requestId: Id<"rotaJoinRequests">;
  readId: Id<"rotaReads">;
  coPoolCode: string;
  orgPool: Id<"khatmas">;
};

async function rotaWithCoOrganizer(switches: Switches): Promise<RotaCtx> {
  const t = convexTest(schema, modules);
  await setSetting(t, "rotaStartNextDay", false);
  const org = await signedIn(t, "المنظم");
  const { inviteCode: code } = await t.action(api.rota.create, {
    sessionToken: org.token,
    name: "ختمة",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
    endDate: null,
  });
  const co = await signedIn(t, "علي");
  const coP = await addParticipant(t, code, org, "علي", co.phone);
  const saraP = await addParticipant(t, code, org, "سارة", "+971505550002");
  await t.mutation(api.rota.finishSetup, {
    sessionToken: org.token,
    inviteCode: code,
  });
  let khatma = await khatmaOf(t, code);
  await t.mutation(internal.rotaDays.tick, { khatmaId: khatma._id });
  await name(t, code, org, `p:${coP}`, switches);

  const orgContact = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("rotaContacts")
      .withIndex("by_owner", (q) => q.eq("ownerPersonId", org.personId))
      .first();
    return row!._id;
  });
  const requestId = await t.run((ctx) =>
    ctx.db.insert("rotaJoinRequests", {
      khatmaId: khatma._id,
      phone: "+971505550009",
      profileName: "طالب",
      createdAt: NOW,
      resolvedAt: null,
      outcome: null,
    }),
  );
  const view = await t.query(api.rota.today, {
    sessionToken: org.token,
    inviteCode: code,
  });
  const readId = view?.tiles[0]?.readId;
  if (!readId) throw new Error("no read");

  // The co-organizer runs a pool khatma of their own, with one other member.
  const pool = await createPool(t, co, "ختمة علي");
  const omar = await signedIn(t, "عمر");
  await join(t, pool.khatma._id, omar);

  // So does the owner.
  const orgPool = await createPool(t, org, "ختمة المنظم");
  await join(t, orgPool.khatma._id, await signedIn(t, "زيد"));

  khatma = await khatmaOf(t, code);
  return {
    t,
    org,
    co,
    code,
    khatma,
    ownerP: await ownerParticipant(t, khatma),
    coP,
    saraP,
    orgContact,
    requestId,
    readId,
    coPoolCode: pool.code,
    orgPool: orgPool.khatma._id,
  };
}

const rotaArgs = (c: RotaCtx, who: Who) => ({
  sessionToken: who.token,
  inviteCode: c.code,
});

const ROTA_ROWS: Row<RotaCtx>[] = [
  // People
  {
    fn: "rota.people",
    need: "people",
    call: (c, who) => c.t.query(api.rota.people, rotaArgs(c, who)),
    refusedWhen: isNull,
  },
  {
    fn: "rota.saved",
    need: "people",
    call: (c, who) => c.t.query(api.rota.saved, rotaArgs(c, who)),
    refusedWhen: isNull,
  },
  {
    fn: "rota.importable",
    need: "people",
    // Allowed, the caller's own pool khatma is listed.
    call: (c, who) => c.t.query(api.rota.importable, rotaArgs(c, who)),
    refusedWhen: (r) => Array.isArray(r) && r.length === 0,
  },
  {
    fn: "rota.addParticipant",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.addParticipant, {
        ...rotaArgs(c, who),
        name: "جديد",
        phone: "+971505550010",
      }),
  },
  {
    fn: "rota.addSaved",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.addSaved, {
        ...rotaArgs(c, who),
        contactId: c.orgContact,
      }),
  },
  {
    fn: "rota.addSavedMany",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.addSavedMany, {
        ...rotaArgs(c, who),
        contactIds: [c.orgContact],
      }),
  },
  {
    fn: "rota.giveJuz",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.giveJuz, {
        ...rotaArgs(c, who),
        participantId: c.saraP,
        juz: 30,
      }),
  },
  {
    fn: "rota.spreadFreeJuz",
    need: "people",
    call: (c, who) => c.t.mutation(api.rota.spreadFreeJuz, rotaArgs(c, who)),
  },
  {
    fn: "rota.moveJuz",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.moveJuz, {
        ...rotaArgs(c, who),
        participantId: c.saraP,
        fromJuz: 29,
        toJuz: 28,
      }),
  },
  {
    fn: "rota.freeJuz",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.freeJuz, {
        ...rotaArgs(c, who),
        participantId: c.saraP,
        juz: 27,
      }),
  },
  {
    fn: "rota.renameParticipant",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.renameParticipant, {
        ...rotaArgs(c, who),
        participantId: c.saraP,
        name: "سارة أحمد",
      }),
  },
  {
    fn: "rota.removeParticipant",
    need: "people",
    // The owner's row: a co-organizer is told `is_organizer`, the owner `is_me`.
    call: (c, who) =>
      c.t.mutation(api.rota.removeParticipant, {
        ...rotaArgs(c, who),
        participantId: c.ownerP,
      }),
  },
  {
    fn: "rota.importMembers",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.importMembers, {
        ...rotaArgs(c, who),
        sourceInviteCode: c.coPoolCode,
      }),
  },
  {
    fn: "rota.ensureJoinLink",
    need: "people",
    call: (c, who) => c.t.mutation(api.rota.ensureJoinLink, rotaArgs(c, who)),
  },
  {
    fn: "rota.acceptJoinRequest",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.acceptJoinRequest, {
        ...rotaArgs(c, who),
        requestId: c.requestId,
        juz: 26,
        readsToday: false,
      }),
  },
  {
    fn: "rota.declineJoinRequest",
    need: "people",
    call: (c, who) =>
      c.t.mutation(api.rota.declineJoinRequest, {
        ...rotaArgs(c, who),
        requestId: c.requestId,
      }),
  },
  // Readings
  {
    fn: "rota.today",
    need: "readings",
    call: (c, who) => c.t.query(api.rota.today, rotaArgs(c, who)),
    refusedWhen: isNull,
  },
  {
    fn: "rota.reassign",
    need: "readings",
    call: (c, who) =>
      c.t.mutation(api.rota.reassign, {
        ...rotaArgs(c, who),
        readId: c.readId,
        participantId: c.saraP,
      }),
  },
  {
    fn: "rota.markDone",
    need: "readings",
    call: (c, who) =>
      c.t.mutation(api.rota.markDone, {
        ...rotaArgs(c, who),
        readId: c.readId,
      }),
  },
  {
    fn: "rota.markNotDone",
    need: "readings",
    call: (c, who) =>
      c.t.mutation(api.rota.markNotDone, {
        ...rotaArgs(c, who),
        readId: c.readId,
      }),
  },
  // Settings
  {
    fn: "rota.finishSetup",
    need: "settings",
    call: (c, who) => c.t.mutation(api.rota.finishSetup, rotaArgs(c, who)),
  },
  {
    fn: "rota.settings",
    need: "settings",
    call: (c, who) => c.t.query(api.rota.settings, rotaArgs(c, who)),
    refusedWhen: isNull,
  },
  {
    fn: "rota.update",
    need: "settings",
    call: (c, who) =>
      c.t.mutation(api.rota.update, { ...rotaArgs(c, who), name: "ختمتنا" }),
  },
  {
    fn: "rota.setPaused",
    need: "settings",
    call: (c, who) =>
      c.t.mutation(api.rota.setPaused, { ...rotaArgs(c, who), paused: false }),
  },
  {
    fn: "rota.addPauseDate",
    need: "settings",
    call: (c, who) =>
      c.t.mutation(api.rota.addPauseDate, {
        ...rotaArgs(c, who),
        date: "2027-01-29",
      }),
  },
  {
    fn: "rota.removePauseDate",
    need: "settings",
    call: (c, who) =>
      c.t.mutation(api.rota.removePauseDate, {
        ...rotaArgs(c, who),
        date: "2027-01-29",
      }),
  },
];

const ROTA_OWNER_ROWS: Row<RotaCtx>[] = [
  {
    fn: "rota.startAgain",
    need: "owner",
    call: (c, who) =>
      c.t.action(api.rota.startAgain, {
        ...rotaArgs(c, who),
        firstDate: "2027-01-22",
      }),
  },
  {
    fn: "khatmaLifecycle.archive",
    need: "owner",
    call: (c, who) =>
      c.t.mutation(api.khatmaLifecycle.archive, rotaArgs(c, who)),
  },
  {
    fn: "khatmaLifecycle.remove",
    need: "owner",
    call: (c, who) =>
      c.t.mutation(api.khatmaLifecycle.remove, rotaArgs(c, who)),
  },
  {
    fn: "coOrganizers.list",
    need: "owner",
    call: (c, who) => c.t.query(api.coOrganizers.list, rotaArgs(c, who)),
    refusedWhen: isForbidden,
  },
];

// ---------------------------------------------------------------------------

async function outcomes<C extends { co: Who }>(
  c: C,
  rows: Row<C>[],
  who: Who = c.co,
): Promise<Record<string, "allowed" | "refused">> {
  const seen: Record<string, "allowed" | "refused"> = {};
  for (const row of rows) {
    seen[row.fn] = await outcome(() => row.call(c, who), row.refusedWhen);
  }
  return seen;
}

function expected<C>(
  rows: Row<C>[],
  allowed: (need: Row<C>["need"]) => boolean,
): Record<string, "allowed" | "refused"> {
  return Object.fromEntries(
    rows.map((row) => [row.fn, allowed(row.need) ? "allowed" : "refused"]),
  );
}

const PERMISSIONS: Permission[] = ["readings", "people", "settings"];

describe("each control accepts its permission and refuses the others", () => {
  test.each(PERMISSIONS)("pool, with only %s", async (permission) => {
    const c = await poolWithCoOrganizer(ONLY(permission));
    expect(await outcomes(c, POOL_ROWS)).toEqual(
      expected(POOL_ROWS, (need) => need === "any" || need === permission),
    );
  });

  test.each(PERMISSIONS)("rota, with only %s", async (permission) => {
    const c = await rotaWithCoOrganizer(ONLY(permission));
    expect(await outcomes(c, ROTA_ROWS)).toEqual(
      expected(ROTA_ROWS, (need) => need === permission),
    );
  });

  test("a co-organizer with no switches on gets only the page shell", async () => {
    const pool = await poolWithCoOrganizer({
      readings: false,
      people: false,
      settings: false,
    });
    expect(await outcomes(pool, POOL_ROWS)).toEqual(
      expected(POOL_ROWS, (need) => need === "any"),
    );
    const rota = await rotaWithCoOrganizer({
      readings: false,
      people: false,
      settings: false,
    });
    expect(await outcomes(rota, ROTA_ROWS)).toEqual(
      expected(ROTA_ROWS, () => false),
    );
  });

  test("the owner still passes every control", async () => {
    const pool = await poolWithCoOrganizer(ONLY("readings"));
    expect(await outcomes(pool, POOL_ROWS, pool.org)).toEqual(
      expected(POOL_ROWS, () => true),
    );
    const rota = await rotaWithCoOrganizer(ONLY("readings"));
    expect(await outcomes(rota, ROTA_ROWS, rota.org)).toEqual(
      expected(ROTA_ROWS, () => true),
    );
  });

  test("a plain member and a stranger pass none of them", async () => {
    const pool = await poolWithCoOrganizer(ALL);
    const stranger = await signedIn(pool.t, "غريب");
    for (const who of [pool.sara, stranger]) {
      expect(await outcomes(pool, POOL_ROWS, who)).toEqual(
        expected(POOL_ROWS, () => false),
      );
    }
    const rota = await rotaWithCoOrganizer(ALL);
    const outsider = await signedIn(rota.t, "غريب");
    expect(await outcomes(rota, ROTA_ROWS, outsider)).toEqual(
      expected(ROTA_ROWS, () => false),
    );
  });
});

test("owner-only controls refuse a co-organizer with every switch on", async () => {
  const pool = await poolWithCoOrganizer(ALL);
  expect(await outcomes(pool, POOL_OWNER_ROWS)).toEqual(
    expected(POOL_OWNER_ROWS, () => false),
  );
  // Nothing changed hands, and the khatma is still live.
  const khatma = await khatmaOf(pool.t, pool.code);
  expect(khatma.creatorPersonId).toBe(pool.org.personId);
  expect(khatma.archivedAt ?? null).toBeNull();

  const rota = await rotaWithCoOrganizer(ALL);
  expect(await outcomes(rota, ROTA_OWNER_ROWS)).toEqual(
    expected(ROTA_OWNER_ROWS, () => false),
  );
  expect((await khatmaOf(rota.t, rota.code)).rota?.archivedAt).toBeNull();
});

test("turning a switch off refuses the next call", async () => {
  const c = await rotaWithCoOrganizer(ALL);
  const give = () =>
    c.t.mutation(api.rota.giveJuz, {
      ...rotaArgs(c, c.co),
      participantId: c.saraP,
      juz: 30,
    });
  expect(await give()).toEqual({ ok: true });

  await c.t.mutation(api.coOrganizers.set, {
    sessionToken: c.org.token,
    inviteCode: c.code,
    coOrganizerId: await coOrganizerIdOf(c.t, c.code, c.org),
    readings: true,
    people: false,
    settings: true,
  });
  await expect(give()).rejects.toThrow(/forbidden/);
  expect(await c.t.query(api.rota.people, rotaArgs(c, c.co))).toBeNull();
  // the other switches still work
  expect(await c.t.query(api.rota.today, rotaArgs(c, c.co))).not.toBeNull();

  const pool = await poolWithCoOrganizer(ALL);
  const rename = () =>
    pool.t.mutation(api.organizer.update, {
      sessionToken: pool.co.token,
      inviteCode: pool.code,
      name: "اسم",
    });
  expect(await rename()).toEqual({ ok: true });
  await pool.t.mutation(api.coOrganizers.set, {
    sessionToken: pool.org.token,
    inviteCode: pool.code,
    coOrganizerId: await coOrganizerIdOf(pool.t, pool.code, pool.org),
    readings: true,
    people: true,
    settings: false,
  });
  await expect(rename()).rejects.toThrow(/forbidden/);
});

test("a co-organizer removed from the khatma is refused on the next call", async () => {
  // Pool: removed as a member.
  const pool = await poolWithCoOrganizer(ALL);
  const update = () =>
    pool.t.mutation(api.organizer.update, {
      sessionToken: pool.co.token,
      inviteCode: pool.code,
      name: "اسم",
    });
  expect(await update()).toEqual({ ok: true });
  await pool.t.mutation(api.organizer.removeMember, {
    sessionToken: pool.org.token,
    inviteCode: pool.code,
    memberId: await memberIdOf(pool.t, pool.khatma._id, pool.co),
  });
  await expect(update()).rejects.toThrow(/forbidden/);
  expect(
    await pool.t.query(api.organizer.settings, {
      sessionToken: pool.co.token,
      inviteCode: pool.code,
    }),
  ).toEqual({ forbidden: true });

  // Pool: the role removed, the membership kept.
  const kept = await poolWithCoOrganizer(ALL);
  await kept.t.mutation(api.coOrganizers.remove, {
    sessionToken: kept.org.token,
    inviteCode: kept.code,
    coOrganizerId: await coOrganizerIdOf(kept.t, kept.code, kept.org),
  });
  await expect(
    kept.t.mutation(api.organizer.update, {
      sessionToken: kept.co.token,
      inviteCode: kept.code,
      name: "اسم",
    }),
  ).rejects.toThrow(/forbidden/);

  // Rota: removed as a participant.
  const rota = await rotaWithCoOrganizer(ALL);
  expect(await rota.t.query(api.rota.today, rotaArgs(rota, rota.co))).not.toBe(
    null,
  );
  await rota.t.mutation(api.rota.removeParticipant, {
    ...rotaArgs(rota, rota.org),
    participantId: rota.coP,
  });
  expect(await rota.t.query(api.rota.today, rotaArgs(rota, rota.co))).toBe(
    null,
  );
  await expect(
    rota.t.mutation(api.rota.markDone, {
      ...rotaArgs(rota, rota.co),
      readId: rota.readId,
    }),
  ).rejects.toThrow(/forbidden/);
});

test("view reports organizerAccess for owner, co-organizer, and member", async () => {
  const pool = await poolWithCoOrganizer(ONLY("readings"));
  const poolView = async (who: Who | null) => {
    const view = await pool.t.query(api.khatmas.view, {
      ...(who ? { sessionToken: who.token } : {}),
      inviteCode: pool.code,
    });
    if ("notFound" in view || "rota" in view) throw new Error("no view");
    return { isOrganizer: view.isOrganizer, access: view.organizerAccess };
  };
  expect(await poolView(pool.org)).toEqual({
    isOrganizer: true,
    access: { owner: true, readings: true, people: true, settings: true },
  });
  expect(await poolView(pool.co)).toEqual({
    isOrganizer: false,
    access: { owner: false, readings: true, people: false, settings: false },
  });
  expect(await poolView(pool.sara)).toEqual({
    isOrganizer: false,
    access: null,
  });
  expect(await poolView(null)).toEqual({ isOrganizer: false, access: null });

  // The settings shell says the same.
  const shell = await pool.t.query(api.organizer.settings, {
    sessionToken: pool.co.token,
    inviteCode: pool.code,
  });
  expect(shell).toMatchObject({
    access: { owner: false, readings: true, people: false, settings: false },
  });

  const rota = await rotaWithCoOrganizer({
    readings: false,
    people: true,
    settings: true,
  });
  const rotaView = async (who: Who | null) => {
    const view = await rota.t.query(api.khatmas.view, {
      ...(who ? { sessionToken: who.token } : {}),
      inviteCode: rota.code,
    });
    if (!("rota" in view)) throw new Error("not a rota view");
    return view.organizerAccess;
  };
  expect(await rotaView(rota.org)).toEqual({
    owner: true,
    readings: true,
    people: true,
    settings: true,
  });
  expect(await rotaView(rota.co)).toEqual({
    owner: false,
    readings: false,
    people: true,
    settings: true,
  });
  expect(await rotaView(await signedIn(rota.t, "غريب"))).toBeNull();
  expect(await rotaView(null)).toBeNull();
  expect(
    await rota.t.query(api.rota.settings, rotaArgs(rota, rota.co)),
  ).toMatchObject({
    access: { owner: false, readings: false, people: true, settings: true },
  });
});

test("a co-organizer saves people to their own saved list", async () => {
  const c = await rotaWithCoOrganizer(ONLY("people"));
  const hudaP = await addParticipant(c.t, c.code, c.co, "هدى", "+971505550020");

  const savedBy = async (who: Who) =>
    ((await c.t.query(api.rota.saved, rotaArgs(c, who))) ?? []).map(
      (s) => s.name,
    );
  expect(await savedBy(c.co)).toEqual(["هدى"]);
  expect(await savedBy(c.org)).not.toContain("هدى");
  // the owner's contacts never reach the co-organizer
  expect(await savedBy(c.co)).not.toContain("سارة");
  expect(
    await c.t.mutation(api.rota.addSaved, {
      ...rotaArgs(c, c.co),
      contactId: c.orgContact,
    }),
  ).toEqual({ error: "not_found" });

  // They pick from their own list.
  expect(
    await c.t.mutation(api.rota.removeParticipant, {
      ...rotaArgs(c, c.co),
      participantId: hudaP,
    }),
  ).toEqual({ ok: true });
  const own = (await c.t.query(api.rota.saved, rotaArgs(c, c.co)))!.find(
    (s) => s.name === "هدى",
  )!;
  expect(
    await c.t.mutation(api.rota.addSaved, {
      ...rotaArgs(c, c.co),
      contactId: own.id,
    }),
  ).toMatchObject({ ok: true });
});

test("a co-organizer with People sees the numbers the owner sees, and a number hidden from the owner stays hidden", async () => {
  const c = await rotaWithCoOrganizer(ONLY("people"));
  const phones = async (who: Who) =>
    Object.fromEntries(
      (
        (await c.t.query(api.rota.people, rotaArgs(c, who)))?.participants ?? []
      ).map((p) => [p.name, p.phone]),
    );
  expect(await phones(c.co)).toEqual(await phones(c.org));
  expect((await phones(c.co))["سارة"]).toBe("+971505550002");

  // Nour is in the owner's pool khatma, so the owner never sees her number.
  const nour = await signedIn(c.t, "نور");
  await join(c.t, c.orgPool, nour);
  const requestId = await c.t.run((ctx) =>
    ctx.db.insert("rotaJoinRequests", {
      khatmaId: c.khatma._id,
      phone: nour.phone,
      profileName: "نور",
      createdAt: NOW,
      resolvedAt: null,
      outcome: null,
    }),
  );
  expect(
    await c.t.mutation(api.rota.acceptJoinRequest, {
      ...rotaArgs(c, c.co),
      requestId,
      juz: 25,
      readsToday: false,
    }),
  ).toMatchObject({ ok: true });
  expect((await phones(c.org))["نور"]).toBeNull();
  expect((await phones(c.co))["نور"]).toBeNull();
});

test("the pool settings shell shows the blocked list only with People, and refuses a rota khatma", async () => {
  const shell = async (c: PoolCtx, who: Who) => {
    const r = await c.t.query(api.organizer.settings, {
      sessionToken: who.token,
      inviteCode: c.code,
    });
    if ("forbidden" in r) throw new Error("forbidden");
    return {
      members: r.members.map((m) => m.displayName),
      blocked: r.blocked.map((b) => b.displayName),
    };
  };
  const blockSara = (c: PoolCtx) =>
    c.t.mutation(api.organizer.removeMember, {
      sessionToken: c.org.token,
      inviteCode: c.code,
      memberId: c.saraMember,
    });

  const readings = await poolWithCoOrganizer(ONLY("readings"));
  await blockSara(readings);
  expect(await shell(readings, readings.co)).toEqual({
    members: ["المنظم", "علي"],
    blocked: [],
  });
  expect((await shell(readings, readings.org)).blocked).toEqual(["سارة"]);

  const people = await poolWithCoOrganizer(ONLY("people"));
  await blockSara(people);
  expect((await shell(people, people.co)).blocked).toEqual(["سارة"]);

  // A rota khatma has its own settings: no pool-shaped answer, even to its owner.
  const rota = await rotaWithCoOrganizer(ALL);
  for (const who of [rota.org, rota.co]) {
    expect(
      await rota.t.query(api.organizer.settings, rotaArgs(rota, who)),
    ).toEqual({ forbidden: true });
  }
});

test("a co-organizer's rename goes to their own saved list, not the owner's", async () => {
  const c = await rotaWithCoOrganizer(ONLY("people"));
  const savedBy = async (who: Who) =>
    ((await c.t.query(api.rota.saved, rotaArgs(c, who))) ?? []).map(
      (s) => s.name,
    );
  const rename = (participantId: Id<"rotaParticipants">, name: string) =>
    c.t.mutation(api.rota.renameParticipant, {
      ...rotaArgs(c, c.co),
      participantId,
      name,
    });

  // Sara is on the owner's list: the khatma's name changes, the owner's row doesn't.
  expect(await rename(c.saraP, "سارة أحمد")).toEqual({ ok: true });
  expect(await savedBy(c.org)).toContain("سارة");
  expect(await savedBy(c.org)).not.toContain("سارة أحمد");
  expect(await savedBy(c.co)).not.toContain("سارة أحمد");

  // Huda is on the co-organizer's own list, which follows the rename.
  const hudaP = await addParticipant(c.t, c.code, c.co, "هدى", "+971505550020");
  expect(await rename(hudaP, "هدى علي")).toEqual({ ok: true });
  expect(await savedBy(c.co)).toEqual(["هدى علي"]);

  // The owner renaming still updates the owner's list.
  expect(
    await c.t.mutation(api.rota.renameParticipant, {
      ...rotaArgs(c, c.org),
      participantId: c.saraP,
      name: "سارة محمد",
    }),
  ).toEqual({ ok: true });
  expect(await savedBy(c.org)).toContain("سارة محمد");
});

test("the organizer pages mark who is a co-organizer, and Today carries its own times", async () => {
  const pool = await poolWithCoOrganizer(ONLY("people"));
  const shell = await pool.t.query(api.organizer.settings, {
    sessionToken: pool.co.token,
    inviteCode: pool.code,
  });
  if ("forbidden" in shell) throw new Error("forbidden");
  expect(
    shell.members.map((m) => [m.displayName, m.isOrganizer, m.isCoOrganizer]),
  ).toEqual([
    ["المنظم", true, false],
    ["علي", false, true],
    ["سارة", false, false],
  ]);

  const rota = await rotaWithCoOrganizer(ONLY("readings"));
  const people = await rota.t.query(api.rota.people, rotaArgs(rota, rota.org));
  expect(
    people?.participants.map((p) => [p.name, p.isOrganizer, p.isCoOrganizer]),
  ).toEqual([
    ["المنظم", true, false],
    ["علي", false, true],
    ["سارة", false, false],
  ]);
  const held = people?.rows.find((r) => r.participant?.name === "علي");
  expect(held?.participant?.isCoOrganizer).toBe(true);

  // A co-organizer with only Readings has no settings, so Today says when the day starts.
  expect(await rota.t.query(api.rota.settings, rotaArgs(rota, rota.co))).toBe(
    null,
  );
  const today = await rota.t.query(api.rota.today, rotaArgs(rota, rota.co));
  const khatma = await khatmaOf(rota.t, rota.code);
  expect(today).toMatchObject({
    dayAt: khatma.rota!.messages.dayAt,
    timeZone: khatma.rota!.timeZone,
  });
});

test("who the co-organizers are reaches a pool co-organizer only with People", async () => {
  const c = await poolWithCoOrganizer(ONLY("readings"));
  // Sara is a second co-organizer; the viewer (Ali) has only Readings.
  await name(c.t, c.code, c.org, `m:${c.saraMember}`, ONLY("settings"));
  const marks = async (who: Who) => {
    const shell = await c.t.query(api.organizer.settings, {
      sessionToken: who.token,
      inviteCode: c.code,
    });
    if ("forbidden" in shell) throw new Error("forbidden");
    return shell.members.map((m) => [m.displayName, m.isCoOrganizer]);
  };
  expect(await marks(c.co)).toEqual([
    ["المنظم", false],
    ["علي", false],
    ["سارة", false],
  ]);
  expect(await marks(c.sara)).toEqual([
    ["المنظم", false],
    ["علي", false],
    ["سارة", false],
  ]);
  expect(await marks(c.org)).toEqual([
    ["المنظم", false],
    ["علي", true],
    ["سارة", true],
  ]);
});
