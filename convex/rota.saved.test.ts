import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2027-01-15 11:00 in Asia/Dubai (a Friday).
const NOW = Date.UTC(2027, 0, 15, 7, 0, 0);

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

let seq = 0;

async function person(
  t: T,
  over: { rotaAllowed?: boolean; name?: string } = {},
) {
  seq += 1;
  const token = `saved-token-${seq}`;
  const tokenHash = await sha256Hex(token);
  const phone = `+97150${String(7000000 + seq)}`;
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone,
      displayName: over.name ?? "المنظم",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
      ...(over.rotaAllowed === false ? {} : { rotaAllowed: true }),
    });
    await ctx.db.insert("sessions", {
      personId: id,
      tokenHash,
      alertTokenHash: `saved-alert-${seq}`,
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    return id;
  });
  return { personId, token, phone };
}
type Who = Awaited<ReturnType<typeof person>>;

async function rota(t: T, who: Who, firstDate = "2027-01-15") {
  await allowStartToday(t);
  const { inviteCode } = await t.action(api.rota.create, {
    sessionToken: who.token,
    name: "ختمة",
    days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
    firstDate,
    endDate: null,
  });
  return inviteCode;
}

async function setup(t: T) {
  const who = await person(t);
  return { ...who, inviteCode: await rota(t, who) };
}
type Setup = Awaited<ReturnType<typeof setup>>;

let phoneSeq = 0;
function add(
  t: T,
  s: Setup,
  over: Partial<{ name: string; phone: string; juz: number }> = {},
) {
  phoneSeq += 1;
  return t.mutation(api.rota.addParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    name: `قارئ ${phoneSeq}`,
    phone: `+97150555${String(phoneSeq).padStart(4, "0")}`,
    ...over,
  });
}

const saved = (t: T, s: Setup) =>
  t.query(api.rota.saved, { sessionToken: s.token, inviteCode: s.inviteCode });
const peopleView = (t: T, s: Setup) =>
  t.query(api.rota.people, { sessionToken: s.token, inviteCode: s.inviteCode });
const todayView = (t: T, s: Setup) =>
  t.query(api.rota.today, { sessionToken: s.token, inviteCode: s.inviteCode });
const contactRows = (t: T) =>
  t.run((ctx) => ctx.db.query("rotaContacts").collect());
const participantRows = (t: T, inviteCode: string) =>
  t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    return await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma!._id))
      .collect();
  });

/** A pool khatma run by `who`, with `members` more active members (oldest first). */
async function pool(t: T, who: Who, members: Who[]) {
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: who.token,
    name: "ختمة الجماعة",
    schedule: "daily",
  });
  vi.setSystemTime(NOW);
  await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    let at = NOW + 1;
    for (const member of members) {
      await ctx.db.insert("members", {
        khatmaId: khatma!._id,
        personId: member.personId,
        joinedAt: at++,
        status: "active",
        notificationsOn: true,
        lastNudgeAt: null,
        lastCelebratedRound: 0,
      });
    }
  });
  return inviteCode;
}

async function members(t: T, count: number): Promise<Who[]> {
  const list: Who[] = [];
  for (let i = 0; i < count; i++) {
    list.push(await person(t, { rotaAllowed: false, name: `عضو ${i + 1}` }));
  }
  return list;
}

function digits(phone: string) {
  return phone.replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// Saved contacts

test("typing a participant saves a contact once; the organizer's own row isn't saved", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  expect(await contactRows(t)).toHaveLength(0);

  const first = await add(t, s, { name: "علي", phone: "+971505550001" });
  expect(first).toHaveProperty("ok", true);
  const rows = await contactRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    ownerPersonId: s.personId,
    name: "علي",
    phone: "+971505550001",
    personId: null,
  });

  // Removed and typed again with another spelling of the name: still one row.
  const id = "participantId" in first ? first.participantId : null;
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: id!,
  });
  await add(t, s, { name: "علي الجديد", phone: "+971505550001" });
  const again = await contactRows(t);
  expect(again).toHaveLength(1);
  expect(again[0]?.name).toBe("علي الجديد");
});

test("saved lists contacts by name with inKhatma, and the organizer sees phones", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const b = await add(t, s, { name: "يوسف", phone: "+971505550002" });
  await add(t, s, { name: "أحمد", phone: "+971505550003" });
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: "participantId" in b ? b.participantId : (null as never),
  });

  expect(await saved(t, s)).toEqual([
    {
      id: expect.any(String),
      name: "أحمد",
      phone: "+971505550003",
      inKhatma: true,
    },
    {
      id: expect.any(String),
      name: "يوسف",
      phone: "+971505550002",
      inKhatma: false,
    },
  ]);
});

test("saved is for the organizer only", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s);
  const other = await person(t);
  expect(
    await t.query(api.rota.saved, {
      sessionToken: other.token,
      inviteCode: s.inviteCode,
    }),
  ).toBeNull();
});

test("accepting a join request saves the contact", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const khatmaId = (await t.run(async (ctx) =>
    ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", s.inviteCode))
      .unique(),
  ))!._id;
  const requestId = await t.run((ctx) =>
    ctx.db.insert("rotaJoinRequests", {
      khatmaId,
      phone: "+971505559999",
      profileName: "سالم",
      createdAt: NOW,
      resolvedAt: null,
      outcome: null,
    }),
  );
  const accepted = await t.mutation(api.rota.acceptJoinRequest, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    requestId,
    juz: 5,
  });
  expect(accepted).toHaveProperty("ok", true);
  expect(await contactRows(t)).toMatchObject([
    { name: "سالم", phone: "+971505559999", ownerPersonId: s.personId },
  ]);
});

test("addSaved places a contact on the lowest free juz' or the chosen one, once", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const x = await add(t, s, { name: "علي", phone: "+971505550004" });
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: "participantId" in x ? x.participantId : (null as never),
  });
  const [contact] = await saved(t, s).then((list) => list ?? []);
  expect(contact?.inKhatma).toBe(false);

  const placed = await t.mutation(api.rota.addSaved, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    contactId: contact!.id,
    juz: 9,
  });
  expect(placed).toMatchObject({ ok: true, juz: 9 });
  expect((await saved(t, s))?.[0]?.inKhatma).toBe(true);

  const twice = await t.mutation(api.rota.addSaved, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    contactId: contact!.id,
  });
  expect(twice).toEqual({ error: "already_added" });

  const view = await peopleView(t, s);
  expect(view?.rows[8]?.participant?.name).toBe("علي");
  expect(view?.rows[8]?.participant?.phone).toBe("+971505550004");
});

test("removeSaved is for the owner; someone else gets not_found", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s);
  const [contact] = await contactRows(t);
  const other = await person(t);

  expect(
    await t.mutation(api.rota.removeSaved, {
      sessionToken: other.token,
      contactId: contact!._id,
    }),
  ).toEqual({ error: "not_found" });
  expect(await contactRows(t)).toHaveLength(1);

  expect(
    await t.mutation(api.rota.removeSaved, {
      sessionToken: s.token,
      contactId: contact!._id,
    }),
  ).toEqual({ ok: true });
  expect(await contactRows(t)).toHaveLength(0);
  expect(
    await t.mutation(api.rota.removeSaved, {
      sessionToken: s.token,
      contactId: contact!._id,
    }),
  ).toEqual({ error: "not_found" });
});

test("people.savedPeople lists the caller's contacts by name", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await add(t, s, { name: "يوسف", phone: "+971505550005" });
  await add(t, s, { name: "أحمد", phone: "+971505550006" });
  const other = await person(t);
  const list = await t.query(api.people.savedPeople, { sessionToken: s.token });
  expect(list?.map((c) => c.name)).toEqual(["أحمد", "يوسف"]);
  expect(list?.[0]).toMatchObject({ phone: "+971505550006" });
  expect(
    await t.query(api.people.savedPeople, { sessionToken: other.token }),
  ).toEqual([]);
  expect(await t.query(api.people.savedPeople, {})).toEqual([]);
});

// ---------------------------------------------------------------------------
// Pool import

test("importable lists the organizer's live pool khatmas that have other members", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const [a, b] = await members(t, 2);
  const withMembers = await pool(t, s, [a!, b!]);
  await pool(t, s, []); // only the organizer
  const archived = await pool(t, s, [a!]);
  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: s.token,
    inviteCode: archived,
  });
  const notMine = await person(t);
  await pool(t, notMine, [a!]);
  // A khatma where someone left (former) doesn't count them.
  await t.run(async (ctx) => {
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", withMembers))
      .unique();
    const rows = await ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatma!._id).eq("personId", b!.personId),
      )
      .collect();
    await ctx.db.patch(rows[0]!._id, { status: "former" });
  });

  const list = await t.query(api.rota.importable, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
  });
  expect(list).toEqual([
    { inviteCode: withMembers, title: "ختمة الجماعة", memberCount: 1 },
  ]);
  const other = await person(t);
  expect(
    await t.query(api.rota.importable, {
      sessionToken: other.token,
      inviteCode: s.inviteCode,
    }),
  ).toEqual([]);
});

test("importable leaves out a pool whose members are all in the khatma already", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const [a, b] = await members(t, 2);
  const source = await pool(t, s, [a!, b!]);
  const list = () =>
    t.query(api.rota.importable, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
    });
  expect(await list()).toMatchObject([{ inviteCode: source, memberCount: 2 }]);

  // One is typed in by number, which counts too: one is left to bring.
  await add(t, s, { name: "أم سالم", phone: a!.phone });
  expect(await list()).toMatchObject([{ inviteCode: source, memberCount: 1 }]);

  await t.mutation(api.rota.importMembers, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    sourceInviteCode: source,
  });
  expect(await list()).toEqual([]);
});

test("importMembers adds the pool's members in join order and never shows their phones", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const list = await members(t, 3);
  const source = await pool(t, s, list);

  const result = await t.mutation(api.rota.importMembers, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    sourceInviteCode: source,
  });
  expect(result).toEqual({ ok: true, added: 3, skipped: 0 });

  const view = await peopleView(t, s);
  expect(view?.participants.map((p) => p.name)).toEqual([
    "المنظم",
    "عضو 1",
    "عضو 2",
    "عضو 3",
  ]);
  expect(view?.participants.map((p) => p.juz)).toEqual([[1], [2], [3], [4]]);
  const rows = await participantRows(t, s.inviteCode);
  const imported = rows.filter((r) => r.personId !== s.personId);
  expect(imported).toHaveLength(3);
  for (const row of imported) {
    expect(row.phoneHidden).toBe(true);
    expect(row.joinedAt ?? null).toBeNull();
    // The number is kept for the WhatsApp sender only.
    expect(list.map((m) => m.phone)).toContain(row.phone);
  }

  // Review focus 4: no client-facing output carries their digits.
  const outputs = JSON.stringify([
    view,
    await todayView(t, s),
    await saved(t, s),
    await t.query(api.people.savedPeople, { sessionToken: s.token }),
    await t.query(api.rota.importable, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
    }),
  ]);
  for (const member of list) {
    expect(outputs).not.toContain(digits(member.phone));
  }
  expect(view?.participants[1]?.phone).toBeNull();
  expect(view?.rows[1]?.participant?.phone).toBeNull();
  expect(view?.participants[0]?.phone).toBe(s.phone);

  // They are in the saved list without a number, and linked to their person.
  const contacts = await saved(t, s);
  expect(contacts?.map((c) => [c.name, c.phone, c.inKhatma])).toEqual([
    ["عضو 1", null, true],
    ["عضو 2", null, true],
    ["عضو 3", null, true],
  ]);
  expect((await contactRows(t)).map((c) => c.personId).sort()).toEqual(
    list.map((m) => m.personId).sort(),
  );
});

test("importing again skips the people already in", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const list = await members(t, 2);
  const source = await pool(t, s, list);
  const call = () =>
    t.mutation(api.rota.importMembers, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      sourceInviteCode: source,
    });
  expect(await call()).toEqual({ ok: true, added: 2, skipped: 0 });
  expect(await call()).toEqual({ ok: true, added: 0, skipped: 2 });
  expect(await participantRows(t, s.inviteCode)).toHaveLength(3);
  expect(await contactRows(t)).toHaveLength(2);
});

test("a member already typed in by phone is skipped too", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const list = await members(t, 2);
  await add(t, s, { name: "كتبته", phone: list[0]!.phone });
  const source = await pool(t, s, list);
  expect(
    await t.mutation(api.rota.importMembers, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      sourceInviteCode: source,
    }),
  ).toEqual({ ok: true, added: 1, skipped: 1 });
});

test("the import stops when the ajza' run out and reports the rest as skipped", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const list = await members(t, 33);
  const source = await pool(t, s, list);
  const result = await t.mutation(api.rota.importMembers, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    sourceInviteCode: source,
  });
  // The organizer holds juz' 1: 29 are free.
  expect(result).toEqual({ ok: true, added: 29, skipped: 4 });
  const view = await peopleView(t, s);
  expect(view?.freeJuz).toEqual([]);
  expect(view?.participants.at(-1)?.name).toBe("عضو 29");
});

test("importMembers refuses a source that isn't the organizer's live pool khatma", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const list = await members(t, 2);
  const other = await person(t);
  const theirs = await pool(t, other, list);
  const archived = await pool(t, s, list);
  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: s.token,
    inviteCode: archived,
  });
  for (const sourceInviteCode of [theirs, archived, s.inviteCode, "nope"]) {
    expect(
      await t.mutation(api.rota.importMembers, {
        sessionToken: s.token,
        inviteCode: s.inviteCode,
        sourceInviteCode,
      }),
      sourceInviteCode,
    ).toEqual({ error: "not_found" });
  }
  expect(await participantRows(t, s.inviteCode)).toHaveLength(1);
});

test("addSaved of an imported contact keeps the phone hidden", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const [m] = await members(t, 1);
  const source = await pool(t, s, [m!]);
  await t.mutation(api.rota.importMembers, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    sourceInviteCode: source,
  });
  const [imported] = (await participantRows(t, s.inviteCode)).filter(
    (r) => r.personId === m!.personId,
  );
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: imported!._id,
  });
  const [contact] = (await saved(t, s)) ?? [];
  expect(contact).toMatchObject({ phone: null, inKhatma: false });

  const placed = await t.mutation(api.rota.addSaved, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    contactId: contact!.id,
  });
  expect(placed).toMatchObject({ ok: true });
  const back = (await participantRows(t, s.inviteCode)).find(
    (r) => r.removedAt === null && r.personId === m!.personId,
  );
  expect(back).toMatchObject({ phone: m!.phone, phoneHidden: true });
  expect(JSON.stringify(await peopleView(t, s))).not.toContain(
    digits(m!.phone),
  );
});

test("a contact typed first and imported later stays one row, with the typed number", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const [m] = await members(t, 1);
  const source = await pool(t, s, [m!]);
  const typed = await add(t, s, { name: "أم سالم", phone: m!.phone });
  if (!("ok" in typed)) throw new Error(JSON.stringify(typed));
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: typed.participantId,
  });

  await t.mutation(api.rota.importMembers, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    sourceInviteCode: source,
  });

  expect(await contactRows(t)).toMatchObject([
    { name: "عضو 1", phone: m!.phone, personId: m!.personId },
  ]);
});

// ---------------------------------------------------------------------------
// Hidden numbers and join requests

/** An open join request from `phone` on the khatma; `accept` takes it on juz' 5. */
async function requestFrom(t: T, s: Setup, phone: string) {
  const khatma = await t.run((ctx) =>
    ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", s.inviteCode))
      .unique(),
  );
  return await t.run((ctx) =>
    ctx.db.insert("rotaJoinRequests", {
      khatmaId: khatma!._id,
      phone,
      profileName: "اسم واتساب",
      createdAt: NOW,
      resolvedAt: null,
      outcome: null,
    }),
  );
}

const accept = (t: T, s: Setup, requestId: Id<"rotaJoinRequests">) =>
  t.mutation(api.rota.acceptJoinRequest, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    requestId,
    juz: 5,
  });

test("an imported member who was removed and asks back keeps their number hidden", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const [m] = await members(t, 1);
  const source = await pool(t, s, [m!]);
  await t.mutation(api.rota.importMembers, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    sourceInviteCode: source,
  });
  const [imported] = (await participantRows(t, s.inviteCode)).filter(
    (r) => r.personId === m!.personId,
  );
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: imported!._id,
  });
  // No longer in the pool either: the saved contact alone says the number is hidden.
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("members")
      .withIndex("by_person", (q) => q.eq("personId", m!.personId))
      .unique();
    await ctx.db.patch(row!._id, { status: "former" });
  });

  const accepted = await accept(t, s, await requestFrom(t, s, m!.phone));

  expect(accepted).toHaveProperty("ok", true);
  const back = (await participantRows(t, s.inviteCode)).find(
    (r) => r.removedAt === null && r.personId === m!.personId,
  );
  expect(back).toMatchObject({ phone: m!.phone, phoneHidden: true });
  const outputs = JSON.stringify([await peopleView(t, s), await saved(t, s)]);
  expect(outputs).not.toContain(digits(m!.phone));
  expect(await contactRows(t)).toMatchObject([{ phone: null }]);
});

test("a contact removed from the saved list keeps its number hidden when they ask to join later", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const [m] = await members(t, 1);
  const source = await pool(t, s, [m!]);
  await t.mutation(api.rota.importMembers, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    sourceInviteCode: source,
  });
  const [contact] = await contactRows(t);
  const removed = await t.mutation(api.rota.removeSaved, {
    sessionToken: s.token,
    contactId: contact!._id,
  });
  expect(removed).toEqual({ ok: true });

  // The row stays, only to say the number is hidden; no list shows it.
  expect(await contactRows(t)).toMatchObject([
    { phone: null, personId: m!.personId, removedAt: expect.any(Number) },
  ]);
  expect(await saved(t, s)).toEqual([]);
  expect(
    await t.query(api.people.savedPeople, { sessionToken: s.token }),
  ).toEqual([]);
  expect(
    await t.mutation(api.rota.addSaved, {
      sessionToken: s.token,
      inviteCode: s.inviteCode,
      contactId: contact!._id,
    }),
  ).toEqual({ error: "not_found" });
  expect(
    await t.mutation(api.rota.removeSaved, {
      sessionToken: s.token,
      contactId: contact!._id,
    }),
  ).toEqual({ error: "not_found" });

  // They leave the khatma and the pool, then ask to join.
  const [imported] = (await participantRows(t, s.inviteCode)).filter(
    (r) => r.personId === m!.personId,
  );
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId: imported!._id,
  });
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("members")
      .withIndex("by_person", (q) => q.eq("personId", m!.personId))
      .unique();
    await ctx.db.patch(row!._id, { status: "former" });
  });
  const accepted = await accept(t, s, await requestFrom(t, s, m!.phone));

  expect(accepted).toHaveProperty("ok", true);
  const back = (await participantRows(t, s.inviteCode)).find(
    (r) => r.removedAt === null && r.personId === m!.personId,
  );
  expect(back).toMatchObject({ phone: m!.phone, phoneHidden: true });
  const outputs = JSON.stringify([
    await peopleView(t, s),
    await saved(t, s),
    await t.query(api.people.savedPeople, { sessionToken: s.token }),
  ]);
  expect(outputs).not.toContain(digits(m!.phone));
  // Added again, they are back on the list, still without a number.
  expect(await contactRows(t)).toMatchObject([{ phone: null }]);
  expect((await saved(t, s))?.map((c) => [c.name, c.phone])).toEqual([
    ["اسم واتساب", null],
  ]);
});

test("a member of the organizer's pool khatma accepted from a request stays hidden, and is saved without a number", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const [m] = await members(t, 1);
  await pool(t, s, [m!]);

  const accepted = await accept(t, s, await requestFrom(t, s, m!.phone));

  expect(accepted).toHaveProperty("ok", true);
  const row = (await participantRows(t, s.inviteCode)).find(
    (r) => r.phone === m!.phone,
  );
  expect(row).toMatchObject({ personId: m!.personId, phoneHidden: true });
  const outputs = JSON.stringify([await peopleView(t, s), await saved(t, s)]);
  expect(outputs).not.toContain(digits(m!.phone));
  expect(await contactRows(t)).toMatchObject([
    { phone: null, personId: m!.personId },
  ]);
});

test("a member of someone else's pool khatma accepted from a request shows their number", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const other = await person(t);
  const [m] = await members(t, 1);
  await pool(t, other, [m!]);

  await accept(t, s, await requestFrom(t, s, m!.phone));

  const view = await peopleView(t, s);
  expect(view?.participants.find((p) => p.juz.includes(5))?.phone).toBe(
    m!.phone,
  );
});

// ---------------------------------------------------------------------------
// Start again

async function archive(t: T, s: Setup) {
  await t.mutation(api.khatmaLifecycle.archive, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
  });
}

function startAgain(
  t: T,
  s: Setup,
  over: Partial<{ firstDate: string; inviteCode: string; token: string }> = {},
) {
  return t.action(api.rota.startAgain, {
    sessionToken: over.token ?? s.token,
    inviteCode: over.inviteCode ?? s.inviteCode,
    firstDate: over.firstDate ?? "2027-01-22",
  });
}

async function khatmaOf(t: T, inviteCode: string): Promise<Doc<"khatmas">> {
  const khatma = await t.run((ctx) =>
    ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique(),
  );
  return khatma!;
}

test("startAgain copies the slots and settings, and nobody has joined", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  const [m] = await members(t, 1);
  const source = await pool(t, s, [m!]);
  await t.mutation(api.rota.importMembers, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    sourceInviteCode: source,
  });
  const a = await add(t, s, { name: "علي", phone: "+971505550010", juz: 7 });
  const removed = await add(t, s, { name: "غائب", phone: "+971505550011" });
  await t.mutation(api.rota.removeParticipant, {
    sessionToken: s.token,
    inviteCode: s.inviteCode,
    participantId:
      "participantId" in removed ? removed.participantId : (null as never),
  });
  // Everyone has joined and been active in the old khatma.
  await t.run(async (ctx) => {
    for (const p of await ctx.db.query("rotaParticipants").collect()) {
      await ctx.db.patch(p._id, {
        joinedAt: NOW,
        stoppedAt: NOW,
        silencedAt: NOW,
        silentDays: 3,
        lastReplyAt: NOW,
      });
    }
  });
  const old = await khatmaOf(t, s.inviteCode);
  await archive(t, s);

  const { inviteCode } = await startAgain(t, s);
  expect(inviteCode).not.toBe(s.inviteCode);
  const fresh = await khatmaOf(t, inviteCode);
  expect(fresh).toMatchObject({
    kind: "rota",
    name: "ختمة",
    creatorPersonId: s.personId,
  });
  expect(fresh.joinCode).toBeDefined();
  expect(fresh.joinCode).not.toBe(old.joinCode);
  expect(fresh.rota).toMatchObject({
    days: old.rota!.days,
    firstDate: "2027-01-22",
    endDate: null,
    timeZone: old.rota!.timeZone,
    messages: old.rota!.messages,
    pausedAt: null,
    pauseDates: [],
    archivedAt: null,
    setupDoneAt: null,
  });

  const rows = await participantRows(t, inviteCode);
  expect(rows.map((r) => r.name).sort()).toEqual(
    ["المنظم", "عضو 1", "علي"].sort(),
  );
  for (const row of rows) {
    expect(row.removedAt).toBeNull();
    expect(row.joinedAt ?? null).toBeNull();
    expect(row.stoppedAt ?? null).toBeNull();
    expect(row.silencedAt ?? null).toBeNull();
    expect(row.lastReplyAt ?? null).toBeNull();
    expect(row.silentDays ?? 0).toBe(0);
  }
  expect(rows.find((r) => r.name === "عضو 1")?.phoneHidden).toBe(true);
  expect(rows.find((r) => r.name === "علي")?.phoneHidden).toBeUndefined();

  // The same slots: slot by name.
  const slotsOf = async (code: string) =>
    t.run(async (ctx) => {
      const k = await ctx.db
        .query("khatmas")
        .withIndex("by_inviteCode", (q) => q.eq("inviteCode", code))
        .unique();
      const slots = await ctx.db
        .query("rotaSlots")
        .withIndex("by_khatma_slot", (q) => q.eq("khatmaId", k!._id))
        .collect();
      const out: [number, string][] = [];
      for (const slot of slots) {
        const p = await ctx.db.get(slot.participantId);
        out.push([slot.slot, p!.name]);
      }
      return out.sort((x, y) => x[0] - y[0]);
    });
  const newSlots = await slotsOf(inviteCode);
  expect(newSlots).toEqual([
    [1, "المنظم"],
    [2, "عضو 1"],
    [7, "علي"],
  ]);
  expect(newSlots).toEqual(
    await slotsOf(s.inviteCode).then((x) => x.filter(([, n]) => n !== "غائب")),
  );
  expect(a).toHaveProperty("ok", true);

  // The organizer is a member of the new khatma, and the old one is untouched.
  const members2 = await t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", fresh._id))
      .collect(),
  );
  expect(members2).toMatchObject([
    { personId: s.personId, status: "active", shareToken: expect.any(String) },
  ]);
  expect((await khatmaOf(t, s.inviteCode)).rota?.archivedAt).not.toBeNull();
  expect(
    (await participantRows(t, s.inviteCode)).filter((r) => r.joinedAt != null),
  ).toHaveLength(4);

  // It shows up for the organizer, and the imported phone stays hidden.
  const view = await t.query(api.rota.people, {
    sessionToken: s.token,
    inviteCode,
  });
  expect(view?.participants).toHaveLength(3);
  expect(JSON.stringify(view)).not.toContain(digits(m!.phone));
});

test("startAgain refuses a live khatma, a stranger and a pool khatma", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await expect(startAgain(t, s)).rejects.toThrow(/not_archived/);

  await archive(t, s);
  const other = await person(t);
  await expect(startAgain(t, s, { token: other.token })).rejects.toThrow(
    /forbidden/,
  );
  await expect(startAgain(t, s, { token: "nope" })).rejects.toThrow(
    /not_signed_in/,
  );
  const poolCode = await pool(t, s, []);
  await expect(startAgain(t, s, { inviteCode: poolCode })).rejects.toThrow(
    /forbidden/,
  );
});

test("startAgain applies the cap and the date checks, and rotaAllowed is not needed", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t);
  await archive(t, s);

  // Not a Friday, and in the past: invalid.
  await expect(startAgain(t, s, { firstDate: "2027-01-23" })).rejects.toThrow(
    /invalid_dates/,
  );
  await expect(startAgain(t, s, { firstDate: "2027-01-08" })).rejects.toThrow(
    /invalid_dates/,
  );

  // The cap counts the khatmas that are not archived.
  await rota(t, s);
  await rota(t, s);
  await expect(startAgain(t, s)).rejects.toThrow(/rota_cap/);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("khatmas")
        .collect()
        .then((all) => all.filter((k) => k.kind === "rota")),
    ),
  ).toHaveLength(3);

  // An admin turning rota off later doesn't stop someone from restarting what they ran.
  const s2 = await setup(t);
  await archive(t, s2);
  await t.run((ctx) => ctx.db.patch(s2.personId, { rotaAllowed: false }));
  const { inviteCode } = await startAgain(t, s2);
  expect(inviteCode).toHaveLength(12);
});
