import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { linkCoOrganizerRoles } from "./coOrganizers";
import { sha256Hex } from "./lib/crypto";
import { roleIn } from "./lib/organizerAuth";
import { blockMember } from "./organizer";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2027-01-15 11:00 in Asia/Dubai (a Friday).
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
  const token = `co-token-${seq}`;
  const phone = `+97158100${String(seq).padStart(4, "0")}`;
  const tokenHash = await sha256Hex(token);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", {
      phone,
      displayName,
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
      rotaAllowed: true,
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

async function poolSetup(t: T) {
  const org = await signedIn(t, "المنظم");
  const at = Date.now();
  const { inviteCode } = await t.action(api.khatmas.create, {
    sessionToken: org.token,
    name: "ختمة الأسرة",
    schedule: "daily",
  });
  vi.setSystemTime(at);
  return { org, code: inviteCode, khatma: await khatmaOf(t, inviteCode) };
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
  return { org, code: inviteCode, khatma: await khatmaOf(t, inviteCode) };
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

const list = (t: T, code: string, who: Who | null) =>
  t.query(api.coOrganizers.list, {
    ...(who ? { sessionToken: who.token } : {}),
    inviteCode: code,
  });

type Listed = Exclude<Awaited<ReturnType<typeof list>>, { forbidden: true }>;
async function listed(t: T, code: string, who: Who): Promise<Listed> {
  const r = await list(t, code, who);
  if ("forbidden" in r) throw new Error("forbidden");
  return r;
}

const ALL = { readings: true, people: true, settings: true };

function name(
  t: T,
  code: string,
  by: Who,
  candidateId: string,
  switches = ALL,
) {
  return t.mutation(api.coOrganizers.set, {
    sessionToken: by.token,
    inviteCode: code,
    candidateId,
    ...switches,
  });
}

async function candidateFor(
  t: T,
  code: string,
  owner: Who,
  displayName: string,
): Promise<string> {
  const found = (await listed(t, code, owner)).candidates.find(
    (c) => c.name === displayName,
  );
  if (!found) throw new Error(`no candidate ${displayName}`);
  return found.candidateId;
}

async function coOrganizerIdOf(
  t: T,
  code: string,
  owner: Who,
  displayName: string,
): Promise<Id<"coOrganizers">> {
  const found = (await listed(t, code, owner)).coOrganizers.find(
    (c) => c.name === displayName,
  );
  if (!found) throw new Error(`no co-organizer ${displayName}`);
  return found.coOrganizerId;
}

async function coOrganizerRows(t: T, khatmaId: Id<"khatmas">) {
  return await t.run((ctx) =>
    ctx.db
      .query("coOrganizers")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .collect(),
  );
}

async function roleOf(t: T, khatmaId: Id<"khatmas">, personId: Id<"people">) {
  return await t.run(async (ctx) => {
    const khatma = (await ctx.db.get(khatmaId))!;
    return roleIn(ctx, khatma, await ctx.db.get(personId));
  });
}

test("the owner names a member with the admin's default switches", async () => {
  const t = convexTest(schema, modules);
  await setSetting(t, "coOrganizerDefaultReadings", true);
  await setSetting(t, "coOrganizerDefaultPeople", false);
  await setSetting(t, "coOrganizerDefaultSettings", true);
  const { org, code, khatma } = await poolSetup(t);
  const ali = await signedIn(t, "علي");
  await join(t, khatma._id, ali);

  const before = await listed(t, code, org);
  expect(before).toMatchObject({
    max: 5,
    enabled: true,
    defaults: { readings: true, people: false, settings: true },
    coOrganizers: [],
  });
  // the owner is never a candidate
  expect(before.candidates.map((c) => c.name)).toEqual(["علي"]);
  expect(before.candidates[0]!.candidateId).toMatch(/^m:/);

  const candidateId = await candidateFor(t, code, org, "علي");
  expect(await name(t, code, org, candidateId, before.defaults)).toEqual({
    ok: true,
  });

  const after = await listed(t, code, org);
  expect(after.coOrganizers).toEqual([
    {
      coOrganizerId: expect.any(String),
      name: "علي",
      readings: true,
      people: false,
      settings: true,
      pending: false,
    },
  ]);
  expect(after.candidates).toEqual([]);
  // no phone ever leaves the list
  expect(JSON.stringify(after)).not.toContain(ali.phone);
  expect(JSON.stringify(after)).not.toContain(ali.phone.slice(1));
  expect(await roleOf(t, khatma._id, ali.personId)).toEqual({
    owner: false,
    readings: true,
    people: false,
    settings: true,
  });
});

test("a co-organizer and a stranger cannot list, set, or remove", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await poolSetup(t);
  const ali = await signedIn(t, "علي");
  const sara = await signedIn(t, "سارة");
  const stranger = await signedIn(t, "غريب");
  await join(t, khatma._id, ali);
  await join(t, khatma._id, sara);
  await name(t, code, org, await candidateFor(t, code, org, "علي"));
  const aliId = await coOrganizerIdOf(t, code, org, "علي");
  const saraCandidate = await candidateFor(t, code, org, "سارة");

  for (const who of [ali, stranger]) {
    expect(await list(t, code, who)).toEqual({ forbidden: true });
    await expect(name(t, code, who, saraCandidate)).rejects.toThrow(
      /forbidden/,
    );
    await expect(
      t.mutation(api.coOrganizers.set, {
        sessionToken: who.token,
        inviteCode: code,
        coOrganizerId: aliId,
        readings: false,
        people: false,
        settings: false,
      }),
    ).rejects.toThrow(/forbidden/);
    await expect(
      t.mutation(api.coOrganizers.remove, {
        sessionToken: who.token,
        inviteCode: code,
        coOrganizerId: aliId,
      }),
    ).rejects.toThrow(/forbidden/);
  }
  expect(await list(t, code, null)).toEqual({ forbidden: true });
  expect(await coOrganizerRows(t, khatma._id)).toHaveLength(1);
});

test("naming stops at maxCoOrganizers and while coOrganizersOn is off, but editing still works", async () => {
  const t = convexTest(schema, modules);
  await setSetting(t, "maxCoOrganizers", 1);
  const { org, code, khatma } = await poolSetup(t);
  const ali = await signedIn(t, "علي");
  const sara = await signedIn(t, "سارة");
  await join(t, khatma._id, ali);
  await join(t, khatma._id, sara);
  const orgMember = await t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatma._id).eq("personId", org.personId),
      )
      .unique(),
  );

  // the owner can't name themselves, and a made-up candidate is no one
  expect(await name(t, code, org, `m:${orgMember!._id}`)).toEqual({
    error: "self",
  });
  expect(await name(t, code, org, "m:nonsense")).toEqual({
    error: "not_member",
  });
  expect(await name(t, code, org, "x:whatever")).toEqual({
    error: "not_member",
  });

  const saraCandidate = await candidateFor(t, code, org, "سارة");
  expect(
    await name(t, code, org, await candidateFor(t, code, org, "علي")),
  ).toEqual({ ok: true });
  expect(await name(t, code, org, saraCandidate)).toEqual({ error: "full" });

  await setSetting(t, "maxCoOrganizers", 5);
  await setSetting(t, "coOrganizersOn", false);
  expect(await name(t, code, org, saraCandidate)).toEqual({
    error: "disabled",
  });
  const off = await listed(t, code, org);
  expect(off.enabled).toBe(false);
  expect(off.max).toBe(5);

  const aliId = await coOrganizerIdOf(t, code, org, "علي");
  expect(
    await t.mutation(api.coOrganizers.set, {
      sessionToken: org.token,
      inviteCode: code,
      coOrganizerId: aliId,
      readings: false,
      people: true,
      settings: false,
    }),
  ).toEqual({ ok: true });
  expect((await listed(t, code, org)).coOrganizers).toMatchObject([
    { name: "علي", readings: false, people: true, settings: false },
  ]);
  expect(await coOrganizerRows(t, khatma._id)).toHaveLength(1);

  // the owner removes the role: once, then it's gone
  const removeAli = () =>
    t.mutation(api.coOrganizers.remove, {
      sessionToken: org.token,
      inviteCode: code,
      coOrganizerId: aliId,
    });
  expect(await removeAli()).toEqual({ ok: true });
  expect(await removeAli()).toEqual({ error: "not_found" });
  expect(await roleOf(t, khatma._id, ali.personId)).toBeNull();
});

test("a rota participant with no account is pending, and signing in with that number links the role", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await rotaSetup(t);
  const phone = "+971505550001";
  const participantId = await addParticipant(t, code, org, "خالد", phone);

  const before = await listed(t, code, org);
  expect(before.candidates).toEqual([
    { candidateId: `p:${participantId}`, name: "خالد" },
  ]);
  expect(await name(t, code, org, `p:${participantId}`)).toEqual({ ok: true });
  const after = await listed(t, code, org);
  expect(after.coOrganizers).toMatchObject([{ name: "خالد", pending: true }]);
  expect(JSON.stringify(after)).not.toContain(phone);
  expect(await coOrganizerRows(t, khatma._id)).toMatchObject([{ phone }]);

  const { personId, role, member } = await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone,
      displayName: "خالد",
      verifiedAt: NOW,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
    });
    const person = (await ctx.db.get(personId))!;
    await linkCoOrganizerRoles(ctx, person);
    const k = (await ctx.db.get(khatma._id))!;
    const member = await ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatma._id).eq("personId", personId),
      )
      .unique();
    return { personId, role: await roleIn(ctx, k, person), member };
  });
  expect(personId).toBeDefined();
  expect(role).toEqual({ owner: false, ...ALL });
  expect(member).toMatchObject({ status: "active", notificationsOn: true });
  expect((await listed(t, code, org)).coOrganizers).toMatchObject([
    { name: "خالد", pending: false },
  ]);
});

test("naming a rota participant who has an account puts the khatma on their home list, and removing the role takes it off", async () => {
  const t = convexTest(schema, modules);
  const { org, code } = await rotaSetup(t);
  const ali = await signedIn(t, "علي");
  const participantId = await addParticipant(t, code, org, "علي", ali.phone);
  const mine = () => t.query(api.khatmas.mine, { sessionToken: ali.token });
  expect(await mine()).toEqual([]);

  expect(await name(t, code, org, `p:${participantId}`)).toEqual({ ok: true });
  expect((await mine()).map((k) => k.inviteCode)).toEqual([code]);
  // that membership is no handle for the pool's removeMember
  const aliMember = await t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_person", (q) => q.eq("personId", ali.personId))
      .unique(),
  );
  await expect(
    t.mutation(api.organizer.removeMember, {
      sessionToken: org.token,
      inviteCode: code,
      memberId: aliMember!._id,
    }),
  ).rejects.toThrow(/forbidden/);

  expect(
    await t.mutation(api.coOrganizers.remove, {
      sessionToken: org.token,
      inviteCode: code,
      coOrganizerId: await coOrganizerIdOf(t, code, org, "علي"),
    }),
  ).toEqual({ ok: true });
  expect(await mine()).toEqual([]);
});

test("removing or blocking a member ends their co-organizer role", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await poolSetup(t);
  const ali = await signedIn(t, "علي");
  const sara = await signedIn(t, "سارة");
  const aliMember = await join(t, khatma._id, ali);
  const saraMember = await join(t, khatma._id, sara);
  await name(t, code, org, await candidateFor(t, code, org, "علي"));
  await name(t, code, org, await candidateFor(t, code, org, "سارة"));
  expect(await coOrganizerRows(t, khatma._id)).toHaveLength(2);

  expect(
    await t.mutation(api.organizer.removeMember, {
      sessionToken: org.token,
      inviteCode: code,
      memberId: aliMember,
    }),
  ).toEqual({ ok: true });
  // the admin's removal goes through the same helper
  await t.run(async (ctx) => {
    const k = (await ctx.db.get(khatma._id))!;
    await blockMember(ctx, k, (await ctx.db.get(saraMember))!);
  });
  expect(await coOrganizerRows(t, khatma._id)).toEqual([]);

  // coming back doesn't restore the role
  await t.mutation(api.organizer.unblock, {
    sessionToken: org.token,
    inviteCode: code,
    memberId: aliMember,
  });
  await t.run((ctx) => ctx.db.patch(aliMember, { status: "active" }));
  expect(await roleOf(t, khatma._id, ali.personId)).toBeNull();
});

test("removing a rota participant ends their co-organizer role, and adding them back doesn't restore it", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await rotaSetup(t);
  const ali = await signedIn(t, "علي");
  const participantId = await addParticipant(t, code, org, "علي", ali.phone);
  await name(t, code, org, `p:${participantId}`);
  expect(await roleOf(t, khatma._id, ali.personId)).not.toBeNull();

  expect(
    await t.mutation(api.rota.removeParticipant, {
      sessionToken: org.token,
      inviteCode: code,
      participantId,
    }),
  ).toEqual({ ok: true });
  expect(await coOrganizerRows(t, khatma._id)).toEqual([]);
  expect(await t.query(api.khatmas.mine, { sessionToken: ali.token })).toEqual(
    [],
  );

  await addParticipant(t, code, org, "علي", ali.phone);
  expect(await roleOf(t, khatma._id, ali.personId)).toBeNull();
});

test("a co-organizer with People cannot remove the owner or another co-organizer", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await poolSetup(t);
  const ali = await signedIn(t, "علي");
  const sara = await signedIn(t, "سارة");
  const omar = await signedIn(t, "عمر");
  const huda = await signedIn(t, "هدى");
  await join(t, khatma._id, ali);
  const saraMember = await join(t, khatma._id, sara);
  const omarMember = await join(t, khatma._id, omar);
  await join(t, khatma._id, huda);
  const orgMember = (await t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_khatma_person", (q) =>
        q.eq("khatmaId", khatma._id).eq("personId", org.personId),
      )
      .unique(),
  ))!._id;
  await name(t, code, org, await candidateFor(t, code, org, "علي"));
  await name(t, code, org, await candidateFor(t, code, org, "سارة"));
  await name(t, code, org, await candidateFor(t, code, org, "هدى"), {
    readings: true,
    people: false,
    settings: true,
  });

  const removeBy = (by: Who, memberId: Id<"members">) =>
    t.mutation(api.organizer.removeMember, {
      sessionToken: by.token,
      inviteCode: code,
      memberId,
    });
  expect(await removeBy(ali, orgMember)).toEqual({
    ok: false,
    reason: "is_organizer",
  });
  expect(await removeBy(ali, saraMember)).toEqual({
    ok: false,
    reason: "is_organizer",
  });
  // without People, a co-organizer can't remove anyone
  await expect(removeBy(huda, omarMember)).rejects.toThrow(/forbidden/);
  // with it, an ordinary member goes
  expect(await removeBy(ali, omarMember)).toEqual({ ok: true });
  // the owner can remove a co-organizer, which ends the role
  expect(await removeBy(org, saraMember)).toEqual({ ok: true });
  expect(await roleOf(t, khatma._id, sara.personId)).toBeNull();
  expect((await coOrganizerRows(t, khatma._id)).length).toBe(2);
});

test("a rota co-organizer with People cannot remove, free, or move the owner or another co-organizer", async () => {
  const t = convexTest(schema, modules);
  const { org, code, khatma } = await rotaSetup(t);
  const ali = await signedIn(t, "علي");
  const aliP = await addParticipant(t, code, org, "علي", ali.phone);
  const saraP = await addParticipant(t, code, org, "سارة", "+971505550002");
  const omarP = await addParticipant(t, code, org, "عمر", "+971505550003");
  const ownerP = await ownerParticipant(t, khatma);
  await name(t, code, org, `p:${aliP}`);
  await name(t, code, org, `p:${saraP}`);

  const removeBy = (by: Who, participantId: Id<"rotaParticipants">) =>
    t.mutation(api.rota.removeParticipant, {
      sessionToken: by.token,
      inviteCode: code,
      participantId,
    });
  // Nor free or move their slots, or swap someone else's juz' into theirs.
  const people = await t.query(api.rota.people, {
    sessionToken: org.token,
    inviteCode: code,
  });
  const juzOf = (id: Id<"rotaParticipants">) =>
    people!.participants.find((p) => p.id === id)!.juz[0]!;
  const free = people!.freeJuz[0]!;
  const freeBy = (by: Who, participantId: Id<"rotaParticipants">) =>
    t.mutation(api.rota.freeJuz, {
      sessionToken: by.token,
      inviteCode: code,
      participantId,
      juz: juzOf(participantId),
    });
  const moveBy = (
    by: Who,
    participantId: Id<"rotaParticipants">,
    toJuz: number,
  ) =>
    t.mutation(api.rota.moveJuz, {
      sessionToken: by.token,
      inviteCode: code,
      participantId,
      fromJuz: juzOf(participantId),
      toJuz,
    });
  expect(await freeBy(ali, ownerP)).toEqual({ error: "is_organizer" });
  expect(await freeBy(ali, saraP)).toEqual({ error: "is_organizer" });
  expect(await moveBy(ali, ownerP, free)).toEqual({ error: "is_organizer" });
  expect(await moveBy(ali, saraP, free)).toEqual({ error: "is_organizer" });
  expect(await moveBy(ali, omarP, juzOf(saraP))).toEqual({
    error: "is_organizer",
  });
  // A plain participant's slot is theirs to move and free.
  expect(await moveBy(ali, omarP, free)).toEqual({ ok: true });
  expect(
    await t.mutation(api.rota.freeJuz, {
      sessionToken: ali.token,
      inviteCode: code,
      participantId: omarP,
      juz: free,
    }),
  ).toEqual({ ok: true });
  // The owner can still free a co-organizer's slot.
  expect(await freeBy(org, saraP)).toEqual({ ok: true });

  expect(await removeBy(ali, ownerP)).toEqual({ error: "is_organizer" });
  expect(await removeBy(ali, saraP)).toEqual({ error: "is_organizer" });
  expect(await removeBy(ali, omarP)).toEqual({ ok: true });
  // the owner still can't remove themselves, and can remove a co-organizer
  expect(await removeBy(org, ownerP)).toEqual({ error: "is_me" });
  expect(await removeBy(org, saraP)).toEqual({ ok: true });
  expect(await coOrganizerRows(t, khatma._id)).toMatchObject([
    { phone: ali.phone },
  ]);
});
