import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { linkCoOrganizerRoles } from "./coOrganizers";
import { alertOrganizer } from "./grace";
import { sha256Hex } from "./lib/crypto";
import { organizerRecipients } from "./lib/organizerRecipients";
import type { Permission } from "./lib/organizerAuth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2027-01-15 in Asia/Dubai (a Friday). Each test starts in the morning, when
// the day starts, and moves to the evening, when the unread list is due.
const MORNING = Date.parse("2027-01-15T08:30:00+04:00");
const NOW = Date.parse("2027-01-15T21:30:00+04:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MORNING);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type T = TestConvexForDataModel<DataModel>;

let seq = 0;

async function signedIn(t: T, displayName: string) {
  seq += 1;
  const token = `cn-token-${seq}`;
  const phone = `+97158300${String(seq).padStart(4, "0")}`;
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
      alertTokenHash: `cn-alert-${seq}`,
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

type Switches = { readings: boolean; people: boolean; settings: boolean };
const ONLY = (p: Permission): Switches => ({
  readings: p === "readings",
  people: p === "people",
  settings: p === "settings",
});

async function rotaSetup(t: T) {
  await setSetting(t, "rotaStartNextDay", false);
  const org = await signedIn(t, "المنظم");
  const { inviteCode } = await t.action(api.rota.create, {
    sessionToken: org.token,
    name: "ختمة",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate: "2027-01-15",
    endDate: null,
  });
  // the day starts once setup is done
  const k = await khatmaOf(t, inviteCode);
  await t.run(async (ctx) => {
    await ctx.db.patch(k._id, {
      rota: { ...k.rota!, setupDoneAt: MORNING - 86_400_000 },
    });
  });
  return { org, code: inviteCode, khatma: await khatmaOf(t, inviteCode) };
}

/** A participant with an account, named co-organizer with `switches` (or not named). */
async function participant(
  t: T,
  code: string,
  org: Who,
  displayName: string,
  switches: Switches | null,
): Promise<Who> {
  const who = await signedIn(t, displayName);
  const r = await t.mutation(api.rota.addParticipant, {
    sessionToken: org.token,
    inviteCode: code,
    name: displayName,
    phone: who.phone,
  });
  if (!("participantId" in r)) throw new Error(JSON.stringify(r));
  if (switches) {
    const named = await t.mutation(api.coOrganizers.set, {
      sessionToken: org.token,
      inviteCode: code,
      candidateId: `p:${r.participantId}`,
      ...switches,
    });
    if (!("ok" in named)) throw new Error(JSON.stringify(named));
  }
  return who;
}

function notesOf(t: T, who: Who, khatmaId: Id<"khatmas">) {
  return t.run((ctx) =>
    ctx.db
      .query("notes")
      .withIndex("by_person_khatma", (q) =>
        q.eq("personId", who.personId).eq("khatmaId", khatmaId),
      )
      .collect(),
  );
}

/** Starts the day in the morning, then ticks again in the evening. */
async function tick(t: T, khatmaId: Id<"khatmas">) {
  vi.setSystemTime(MORNING);
  await t.mutation(internal.rotaDays.tick, { khatmaId });
  vi.setSystemTime(NOW);
  await t.mutation(internal.rotaDays.tick, { khatmaId });
}

test("the unread list reaches the owner and co-organizers with Readings, not those without", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await rotaSetup(t);
  const withReadings = await participant(t, code, org, "علي", ONLY("readings"));
  const withPeople = await participant(t, code, org, "سارة", ONLY("people"));
  const plain = await participant(t, code, org, "خالد", null);

  await tick(t, khatma._id);

  const kinds = async (who: Who) =>
    (await notesOf(t, who, khatma._id))
      .map((n) => n.kind)
      .filter((k) => k === "rotaUnread" || k === "rotaSummary");
  expect(await kinds(org)).toContain("rotaUnread");
  expect(await kinds(withReadings)).toContain("rotaUnread");
  expect(await kinds(withPeople)).toEqual([]);
  expect(await kinds(plain)).toEqual([]);
});

test("a co-organizer's note never goes on WhatsApp unless coOrganizerWhatsAppOn", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await rotaSetup(t);
  const co = await participant(t, code, org, "علي", ONLY("readings"));
  await t.run(async (ctx) => {
    for (const who of [org, co]) {
      await ctx.db.patch(who.personId, { whatsappNotes: true });
    }
  });
  await tick(t, khatma._id);

  const unreadOf = async (who: Who) =>
    (await notesOf(t, who, khatma._id)).find((n) => n.kind === "rotaUnread")!;
  const plan = async (who: Who) =>
    t.query(internal.whatsappNotes.plan, {
      noteId: (await unreadOf(who))._id,
    });

  expect(await plan(org)).not.toBeNull();
  expect(await plan(co)).toBeNull();

  // the switch is read when the note is made
  await setSetting(t, "coOrganizerWhatsAppOn", true);
  await t.run(async (ctx) => {
    const day = (await ctx.db.query("rotaDays").first())!;
    await ctx.db.patch(day._id, { unreadSentAt: null });
    for (const n of await ctx.db.query("notes").collect()) {
      await ctx.db.patch(n._id, { clearedAt: Date.now() });
    }
  });
  await tick(t, khatma._id);
  expect(await plan(co)).not.toBeNull();
});

test("coOrganizerNotesOn off sends organizer notes to the owner only", async () => {
  const t = convexTest(schema, modules);
  await setSetting(t, "coOrganizerNotesOn", false);
  const { org, code, khatma } = await rotaSetup(t);
  const co = await participant(t, code, org, "علي", ONLY("readings"));

  await tick(t, khatma._id);

  expect((await notesOf(t, org, khatma._id)).map((n) => n.kind)).toContain(
    "rotaUnread",
  );
  expect(
    (await notesOf(t, co, khatma._id)).filter((n) => n.kind === "rotaUnread"),
  ).toEqual([]);
  const recipients = await t.run(async (ctx) =>
    organizerRecipients(ctx, khatma, "readings"),
  );
  expect(recipients).toEqual([{ personId: org.personId, whatsappOff: false }]);
});

test("a co-organizer without the permission, or no longer in the khatma, is not a recipient", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await rotaSetup(t);
  const co = await participant(t, code, org, "علي", ONLY("people"));
  const gone = await participant(t, code, org, "سارة", ONLY("people"));
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma_phone", (q) =>
        q.eq("khatmaId", khatma._id).eq("phone", gone.phone),
      )
      .first();
    await ctx.db.patch(row!._id, { removedAt: Date.now() });
  });
  const recipients = (p: Permission) =>
    t.run((ctx) => organizerRecipients(ctx, khatma, p));
  expect(await recipients("people")).toEqual([
    { personId: org.personId, whatsappOff: false },
    { personId: co.personId, whatsappOff: true },
  ]);
  expect(await recipients("readings")).toEqual([
    { personId: org.personId, whatsappOff: false },
  ]);
});

test("naming someone sends coOrganizerNow in the app, and removal sends nothing", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await rotaSetup(t);
  const co = await participant(t, code, org, "علي", ONLY("readings"));

  const got = await notesOf(t, co, khatma._id);
  expect(got.filter((n) => n.kind === "coOrganizerNow")).toHaveLength(1);

  // editing a switch does not send it again
  const row = await t.run((ctx) =>
    ctx.db
      .query("coOrganizers")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .first(),
  );
  await t.mutation(api.coOrganizers.set, {
    sessionToken: org.token,
    inviteCode: code,
    coOrganizerId: row!._id,
    ...ONLY("people"),
  });
  expect(
    (await notesOf(t, co, khatma._id)).filter(
      (n) => n.kind === "coOrganizerNow",
    ),
  ).toHaveLength(1);

  await t.mutation(api.coOrganizers.remove, {
    sessionToken: org.token,
    inviteCode: code,
    coOrganizerId: row!._id,
  });
  expect(
    (await notesOf(t, co, khatma._id)).filter(
      (n) => n.kind === "coOrganizerNow",
    ),
  ).toHaveLength(1);
});

test("alertOrganizer batches per recipient", async () => {
  const t = convexTest(schema, modules);
  const org = await signedIn(t, "المنظم");
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: org.token,
    name: "ختمة الأسرة",
    schedule: "daily",
  });
  vi.setSystemTime(NOW);
  const khatma = await khatmaOf(t, inviteCode);
  const co = await signedIn(t, "علي");
  const reader = await signedIn(t, "سارة");
  for (const who of [co, reader]) {
    await t.run((ctx) =>
      ctx.db.insert("members", {
        khatmaId: khatma._id,
        personId: who.personId,
        joinedAt: NOW,
        status: "active",
        notificationsOn: true,
        lastNudgeAt: null,
        lastCelebratedRound: 0,
      }),
    );
  }
  const member = await t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatma._id).eq("personId", co.personId),
      )
      .unique(),
  );
  const named = await t.mutation(api.coOrganizers.set, {
    sessionToken: org.token,
    inviteCode,
    candidateId: `m:${member!._id}`,
    ...ONLY("readings"),
  });
  expect("ok" in named).toBe(true);

  await t.run(async (ctx) => {
    await alertOrganizer(ctx, khatma, 3, reader.personId);
    await alertOrganizer(ctx, khatma, 5, reader.personId);
  });

  for (const who of [org, co]) {
    const alerts = (await notesOf(t, who, khatma._id)).filter(
      (n) => n.kind === "openForHelp",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.juz).toEqual([3, 5]);
  }
  expect(
    (await notesOf(t, reader, khatma._id)).filter(
      (n) => n.kind === "openForHelp",
    ),
  ).toEqual([]);
});

test("signing in on a named number sends coOrganizerNow once the account exists", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await rotaSetup(t);
  const phone = "+971505550123";
  const added = await t.mutation(api.rota.addParticipant, {
    sessionToken: org.token,
    inviteCode: code,
    name: "خالد",
    phone,
  });
  if (!("participantId" in added)) throw new Error(JSON.stringify(added));
  await t.mutation(api.coOrganizers.set, {
    sessionToken: org.token,
    inviteCode: code,
    candidateId: `p:${added.participantId}`,
    ...ONLY("readings"),
  });
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone,
      displayName: "خالد",
      verifiedAt: NOW,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
    });
    await linkCoOrganizerRoles(ctx, (await ctx.db.get(id))!);
    return id;
  });
  const got = await notesOf(t, { personId } as Who, khatma._id);
  expect(got.map((n) => n.kind)).toEqual(["coOrganizerNow"]);
});
