import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvexForDataModel<DataModel>;

async function addPerson(t: T, phone: string, displayName = "علي") {
  return await t.run((ctx) =>
    ctx.db.insert("people", {
      phone,
      displayName,
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    }),
  );
}

async function addSession(
  t: T,
  personId: Id<"people">,
  token: string,
  alert: string,
  lastUsedAt = 0,
  deviceLabel = "iPhone Safari",
) {
  const tokenHash = await sha256Hex(token);
  const alertTokenHash = await sha256Hex(alert);
  return await t.run((ctx) =>
    ctx.db.insert("sessions", {
      personId,
      tokenHash,
      alertTokenHash,
      deviceLabel,
      createdAt: 0,
      lastUsedAt,
    }),
  );
}

async function sessionIds(t: T, personId: Id<"people">) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("sessions")
      .withIndex("by_person", (q) => q.eq("personId", personId))
      .collect(),
  );
  return rows.map((r) => r._id).sort();
}

test("me returns null without a session and the person with one", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.sessions.me, {})).toBeNull();
  const token = "tok_1";
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, token, "al_1");
  expect(await t.query(api.sessions.me, { sessionToken: token })).toEqual({
    displayName: "علي",
    maskedPhone: "+971 50 ••• 4567",
    whatsappNotes: false,
    rotaNewLayout: false,
  });
  expect(await t.query(api.sessions.me, { sessionToken: "wrong" })).toBeNull();
});

test("me has the new rota layout when it is on for everyone or for the person", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  const newLayout = async () =>
    (await t.query(api.sessions.me, { sessionToken: "tok_1" }))?.rotaNewLayout;
  const setGlobal = (value: boolean) =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", "rotaNewLayoutOn"))
        .first();
      if (row) await ctx.db.patch(row._id, { value });
      else
        await ctx.db.insert("settings", {
          key: "rotaNewLayoutOn",
          value,
          updatedAt: 0,
        });
    });

  expect(await newLayout()).toBe(false);
  await t.run((ctx) => ctx.db.patch(personId, { rotaNewLayout: true }));
  expect(await newLayout()).toBe(true);
  await t.run((ctx) => ctx.db.patch(personId, { rotaNewLayout: false }));
  await setGlobal(true);
  expect(await newLayout()).toBe(true);
  await t.run((ctx) => ctx.db.patch(personId, { rotaNewLayout: true }));
  expect(await newLayout()).toBe(true);
  await setGlobal(false);
  await t.run((ctx) => ctx.db.patch(personId, { rotaNewLayout: false }));
  expect(await newLayout()).toBe(false);
});

test("me is null when the session's person no longer exists", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  await t.run((ctx) => ctx.db.delete(personId));
  expect(await t.query(api.sessions.me, { sessionToken: "tok_1" })).toBeNull();
});

test("alert link keeps the owner's own session and removes the rest", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  const s1 = await addSession(t, personId, "tok_1", "al_1");
  await addSession(t, personId, "tok_2", "al_2");
  const other = await addPerson(t, "+971509999999", "سعيد");
  const otherSession = await addSession(t, other, "tok_o", "al_o");

  const res = await t.mutation(api.sessions.signOutOthersByAlertToken, {
    alertToken: "al_2",
    sessionToken: "tok_1",
  });
  expect(res).toEqual({ ok: true, keptCurrent: true, callerAffected: false });
  expect(await sessionIds(t, personId)).toEqual([s1]);
  // another person's sessions are untouched
  expect(await sessionIds(t, other)).toEqual([otherSession]);
});

test("alert link without a session removes every session of that person", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  await addSession(t, personId, "tok_2", "al_2");
  const res = await t.mutation(api.sessions.signOutOthersByAlertToken, {
    alertToken: "al_2",
  });
  expect(res).toEqual({ ok: true, keptCurrent: false, callerAffected: false });
  expect(await sessionIds(t, personId)).toEqual([]);
});

test("alert link removes everything when the caller is the alerted session", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  await addSession(t, personId, "tok_2", "al_2");
  const res = await t.mutation(api.sessions.signOutOthersByAlertToken, {
    alertToken: "al_2",
    sessionToken: "tok_2",
  });
  expect(res).toEqual({ ok: true, keptCurrent: false, callerAffected: true });
  expect(await sessionIds(t, personId)).toEqual([]);
});

test("alert link ignores a session token from another person or an unknown one", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  await addSession(t, personId, "tok_2", "al_2");
  const other = await addPerson(t, "+971509999999", "سعيد");
  const otherSession = await addSession(t, other, "tok_o", "al_o");

  expect(
    await t.mutation(api.sessions.signOutOthersByAlertToken, {
      alertToken: "al_2",
      sessionToken: "tok_o",
    }),
  ).toEqual({ ok: true, keptCurrent: false, callerAffected: false });
  expect(await sessionIds(t, personId)).toEqual([]);
  expect(await sessionIds(t, other)).toEqual([otherSession]);

  const p3 = await addPerson(t, "+971508888888", "خالد");
  await addSession(t, p3, "tok_3", "al_3");
  expect(
    await t.mutation(api.sessions.signOutOthersByAlertToken, {
      alertToken: "al_3",
      sessionToken: "nope",
    }),
  ).toEqual({ ok: true, keptCurrent: false, callerAffected: false });
  expect(await sessionIds(t, p3)).toEqual([]);
});

test("unknown alert token returns ok false and deletes nothing", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  const s1 = await addSession(t, personId, "tok_1", "al_1");
  expect(
    await t.mutation(api.sessions.signOutOthersByAlertToken, {
      alertToken: "bogus",
      sessionToken: "tok_1",
    }),
  ).toEqual({ ok: false });
  expect(await sessionIds(t, personId)).toEqual([s1]);
});

test("list marks the current session and signOutOthers keeps it", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  const s1 = await addSession(
    t,
    personId,
    "tok_1",
    "al_1",
    100,
    "iPhone Safari",
  );
  const s2 = await addSession(
    t,
    personId,
    "tok_2",
    "al_2",
    200,
    "Android Chrome",
  );
  const other = await addPerson(t, "+971509999999", "سعيد");
  await addSession(t, other, "tok_o", "al_o");

  const rows = await t.query(api.sessions.list, { sessionToken: "tok_1" });
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.sessionId === s1)).toEqual({
    sessionId: s1,
    deviceLabel: "iPhone Safari",
    lastUsedAt: 100,
    isCurrent: true,
  });
  expect(rows.find((r) => r.sessionId === s2)?.isCurrent).toBe(false);
  expect(Object.keys(rows[0]!).sort()).toEqual([
    "deviceLabel",
    "isCurrent",
    "lastUsedAt",
    "sessionId",
  ]);

  await t.mutation(api.sessions.signOutOthers, { sessionToken: "tok_1" });
  expect(await sessionIds(t, personId)).toEqual([s1]);
  expect(await t.query(api.sessions.list, {})).toEqual([]);
});

test("signOut deletes only the current session", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  const s2 = await addSession(t, personId, "tok_2", "al_2");
  await t.mutation(api.sessions.signOut, { sessionToken: "tok_1" });
  expect(await sessionIds(t, personId)).toEqual([s2]);
  expect(await t.query(api.sessions.me, { sessionToken: "tok_1" })).toBeNull();
  // signing out without a session is a no-op, not an error
  await t.mutation(api.sessions.signOut, {});
  await t.mutation(api.sessions.signOut, { sessionToken: "tok_1" });
  expect(await sessionIds(t, personId)).toEqual([s2]);
});

test("signOutOne deletes the caller's own sessions only", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  const s2 = await addSession(t, personId, "tok_2", "al_2");
  const other = await addPerson(t, "+971509999999", "سعيد");
  const otherSession = await addSession(t, other, "tok_o", "al_o");

  await expect(
    t.mutation(api.sessions.signOutOne, {
      sessionToken: "tok_1",
      sessionId: otherSession,
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  expect(await sessionIds(t, other)).toEqual([otherSession]);

  await t.mutation(api.sessions.signOutOne, {
    sessionToken: "tok_1",
    sessionId: s2,
  });
  expect((await sessionIds(t, personId)).includes(s2)).toBe(false);

  await expect(
    t.mutation(api.sessions.signOutOne, { sessionId: s2 }),
  ).rejects.toMatchObject({ data: { code: "not_signed_in" } });
});

test("signed-out callers get not_signed_in from guarded mutations", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.sessions.signOutOthers, {}),
  ).rejects.toMatchObject({ data: { code: "not_signed_in" } });
  await expect(
    t.mutation(api.people.updateDisplayName, { displayName: "علي" }),
  ).rejects.toMatchObject({ data: { code: "not_signed_in" } });
});

test("updateDisplayName rejects blank names and stores the cleaned name", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  for (const bad of ["   ", "", "\u200B\u2800\u3164", "\u0007\u0000"]) {
    await expect(
      t.mutation(api.people.updateDisplayName, {
        sessionToken: "tok_1",
        displayName: bad,
      }),
    ).rejects.toMatchObject({ data: { code: "invalid_name" } });
  }
  await t.mutation(api.people.updateDisplayName, {
    sessionToken: "tok_1",
    displayName: "  أبو\u202E   " + "ب".repeat(60),
  });
  const person = await t.run((ctx) => ctx.db.get(personId));
  expect(person?.displayName).toBe(
    ("أبو " + "ب".repeat(60)).slice(0, 40).trim(),
  );
  expect(Array.from(person!.displayName).length).toBeLessThanOrEqual(40);
  expect(person!.displayName).not.toMatch(/\u202E/);
});

test("updateDisplayName is refused during maintenance", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567", "علي");
  await addSession(t, personId, "tok_1", "al_1");
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "maintenanceMode",
      value: true,
      updatedAt: NOW,
    }),
  );
  await expect(
    t.mutation(api.people.updateDisplayName, {
      sessionToken: "tok_1",
      displayName: "سعيد",
    }),
  ).rejects.toMatchObject({ data: { code: "maintenance" } });
  const person = await t.run((ctx) => ctx.db.get(personId));
  expect(person?.displayName).toBe("علي");
});

test("updateDisplayName allows 10 changes per person per hour", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  const other = await addPerson(t, "+971501234568");
  await addSession(t, other, "tok_2", "al_2");
  const rename = (sessionToken: string, displayName: string) =>
    t.mutation(api.people.updateDisplayName, { sessionToken, displayName });

  for (let i = 0; i < 10; i++) await rename("tok_1", `اسم ${i}`);
  await expect(rename("tok_1", "اسم أخير")).rejects.toMatchObject({
    data: { code: "rate_limited" },
  });
  expect((await t.run((ctx) => ctx.db.get(personId)))?.displayName).toBe(
    "اسم 9",
  );
  // a refused name does not spend the bucket, and another person has their own
  await rename("tok_2", "سارة");
  // the window resets after an hour
  vi.setSystemTime(NOW + HOUR + 1_000);
  await rename("tok_1", "اسم أخير");
  expect((await t.run((ctx) => ctx.db.get(personId)))?.displayName).toBe(
    "اسم أخير",
  );
});

test("an invalid name does not spend a name change", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  await addSession(t, personId, "tok_1", "al_1");
  for (let i = 0; i < 10; i++) {
    await expect(
      t.mutation(api.people.updateDisplayName, {
        sessionToken: "tok_1",
        displayName: "   ",
      }),
    ).rejects.toMatchObject({ data: { code: "invalid_name" } });
  }
  await t.mutation(api.people.updateDisplayName, {
    sessionToken: "tok_1",
    displayName: "سعيد",
  });
  expect((await t.run((ctx) => ctx.db.get(personId)))?.displayName).toBe(
    "سعيد",
  );
});

test("sessionMutation touches lastUsedAt at most once per hour; sessionQuery never writes", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  const sid = await addSession(t, personId, "tok_1", "al_1", NOW - 10 * 60_000);
  const lastUsed = () =>
    t.run(async (ctx) => (await ctx.db.get(sid))!.lastUsedAt);

  await t.query(api.sessions.me, { sessionToken: "tok_1" });
  await t.query(api.sessions.list, { sessionToken: "tok_1" });
  expect(await lastUsed()).toBe(NOW - 10 * 60_000);

  // used 10 minutes ago: skipped
  await t.mutation(api.sessions.signOutOthers, { sessionToken: "tok_1" });
  expect(await lastUsed()).toBe(NOW - 10 * 60_000);

  // exactly one hour ago: written
  vi.setSystemTime(NOW - 10 * 60_000 + HOUR);
  await t.mutation(api.sessions.signOutOthers, { sessionToken: "tok_1" });
  expect(await lastUsed()).toBe(NOW - 10 * 60_000 + HOUR);

  // a minute later: skipped again
  vi.setSystemTime(NOW - 10 * 60_000 + HOUR + 60_000);
  await t.mutation(api.sessions.signOutOthers, { sessionToken: "tok_1" });
  expect(await lastUsed()).toBe(NOW - 10 * 60_000 + HOUR);
});

test("internal.sessions.create inserts a session", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t, "+971501234567");
  const id = await t.mutation(internal.sessions.create, {
    personId,
    tokenHash: await sha256Hex("tok_new"),
    alertTokenHash: await sha256Hex("al_new"),
    deviceLabel: "Chrome Mac",
  });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row).toMatchObject({
    personId,
    deviceLabel: "Chrome Mac",
    createdAt: NOW,
    lastUsedAt: NOW,
  });
  expect(
    await t.query(api.sessions.me, { sessionToken: "tok_new" }),
  ).not.toBeNull();
});
