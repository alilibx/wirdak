import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { alertOrganizer } from "./grace";
import { sha256Hex } from "./lib/crypto";
import { notify } from "./notes";
import schema from "./schema";
import { describeMessage } from "./whatsapp";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
/** 2027-01-15 12:00 in Asia/Dubai (UTC+4), so awake. */
const NOW = 1_800_000_000_000;
/** 23:00 in Asia/Dubai, so quiet. */
const NIGHT = NOW + 11 * HOUR;
/** 07:00 the next morning in Asia/Dubai. */
const MORNING = NIGHT + 8 * HOUR;

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

let seq = 0;

/** A member of a fresh khatma named «ختمة رمضان», with WhatsApp on unless told. */
async function setup(
  t: T,
  opts: { whatsappNotes?: boolean | "missing"; notificationsOn?: boolean } = {},
) {
  seq += 1;
  const token = `tok-${seq}`;
  const tokenHash = await sha256Hex(token);
  const phone = `+97150000${String(seq).padStart(4, "0")}`;
  const inviteCode = `invite${String(seq).padStart(6, "0")}`;
  const ids = await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone,
      displayName: `عضو ${seq}`,
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
      ...(opts.whatsappNotes === "missing"
        ? {}
        : { whatsappNotes: opts.whatsappNotes ?? true }),
    });
    await ctx.db.insert("sessions", {
      personId,
      tokenHash,
      alertTokenHash: `alert-${seq}`,
      deviceLabel: "test",
      createdAt: NOW,
      lastUsedAt: NOW,
    });
    const khatmaId = await ctx.db.insert("khatmas", {
      name: "ختمة رمضان",
      schedule: "weekly",
      grace: { value: 2, unit: "days" },
      creatorPersonId: personId,
      inviteCode,
      completedRounds: 0,
      createdAt: NOW,
    });
    await ctx.db.insert("members", {
      khatmaId,
      personId,
      joinedAt: NOW,
      status: "active",
      notificationsOn: opts.notificationsOn ?? true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    return { personId, khatmaId };
  });
  return { ...ids, token, phone, inviteCode, digits: phone.slice(1) };
}

const remind = (
  t: T,
  who: { personId: Id<"people">; khatmaId: Id<"khatmas"> },
) =>
  t.run((ctx) =>
    notify(ctx, {
      personId: who.personId,
      khatmaId: who.khatmaId,
      kind: "reminder",
      juz: [12],
    }),
  );

test("notify sends an opted-in member the template, without push", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const noteId = await remind(t, ali);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sent).toEqual([
    {
      to: ali.digits,
      text: `[wirdak_reminder_v2] ختمة رمضان | 12 | j/${ali.inviteCode}`,
    },
  ]);
  const note = await t.run((ctx) => ctx.db.get(noteId));
  expect(note?.whatsappSentAt).toBeTypeOf("number");
});

test("staging links go through the /stg/ redirect", async () => {
  vi.stubEnv("SITE_URL", "https://stg.wirdak.app");
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  await remind(t, ali);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sent[0]!.text).toMatch(/ \| stg\/j\/invite\d{6}$/);
});

test("nothing goes to WhatsApp without the opt-in or with the khatma's notifications off", async () => {
  const t = convexTest(schema, modules);
  await remind(t, await setup(t, { whatsappNotes: "missing" }));
  await remind(t, await setup(t, { whatsappNotes: false }));
  await remind(t, await setup(t, { notificationsOn: false }));
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sent).toEqual([]);
});

test("a behind invite isn't sent on WhatsApp", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  await t.run((ctx) =>
    notify(ctx, {
      personId: ali.personId,
      khatmaId: ali.khatmaId,
      kind: "behind",
      count: 3,
      until: NOW + 2 * 86_400_000,
      roundNumber: 1,
    }),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sent).toEqual([]);
});

test("deliver skips when opted out after scheduling", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  await remind(t, ali);
  expect(
    await t.mutation(api.people.setWhatsappNotes, {
      sessionToken: ali.token,
      on: false,
    }),
  ).toEqual({ ok: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sent).toEqual([]);
});

test("deliver skips a cleared note and never sends a note twice", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const cleared = await t.run(async (ctx) => {
    const id = await notify(ctx, {
      personId: ali.personId,
      khatmaId: ali.khatmaId,
      kind: "almostUp",
      juz: [5],
      assignmentId: null,
    });
    await ctx.db.patch(id, { clearedAt: NOW });
    return id;
  });
  const noteId = await remind(t, ali);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.action(internal.whatsappNotes.deliver, { noteId });
  await t.action(internal.whatsappNotes.deliver, { noteId: cleared });
  expect(sent).toHaveLength(1);
});

test("deliver reschedules inside quiet hours", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t);
  const noteId = await t.run((ctx) =>
    ctx.db.insert("notes", {
      personId: ali.personId,
      khatmaId: ali.khatmaId,
      kind: "reminder",
      juz: [12],
      count: null,
      until: null,
      assignmentId: null,
      roundNumber: null,
      createdAt: NIGHT,
      pushedAt: null,
      clearedAt: null,
    }),
  );
  vi.setSystemTime(NIGHT);
  await t.action(internal.whatsappNotes.deliver, { noteId });
  expect(sent).toEqual([]);
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  const pending = jobs.filter(
    (j) => j.name.includes("whatsappNotes") && j.state.kind === "pending",
  );
  expect(pending).toHaveLength(1);
  expect(pending[0]!.scheduledTime).toBe(MORNING);
});

test("a grown openForHelp alert is not sent again on WhatsApp", async () => {
  const t = convexTest(schema, modules);
  const organizer = await setup(t);
  const helperId = await t.run((ctx) =>
    ctx.db.insert("people", {
      phone: "+971509999999",
      displayName: "قارئ",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: NOW,
    }),
  );
  const alert = async (juz: number) =>
    await t.run(async (ctx) => {
      const khatma = (await ctx.db.get(organizer.khatmaId))!;
      await alertOrganizer(ctx, khatma, juz, helperId);
    });
  await alert(3);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.setSystemTime(NOW + 60_000);
  await alert(7);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sent.map((s) => s.text)).toEqual([
    `[wirdak_open_for_help_v3] ختمة رمضان | 3 | j/${organizer.inviteCode}`,
  ]);
});

test("setWhatsappNotes round-trips through sessions.me", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t, { whatsappNotes: false });
  const me = () => t.query(api.sessions.me, { sessionToken: ali.token });
  expect((await me())?.whatsappNotes).toBe(false);
  await t.mutation(api.people.setWhatsappNotes, {
    sessionToken: ali.token,
    on: true,
  });
  expect((await me())?.whatsappNotes).toBe(true);
  expect(await t.mutation(api.people.setWhatsappNotes, { on: true })).toEqual({
    ok: false,
  });
});

test("sendSample sends a template on staging and refuses on production", async () => {
  const t = convexTest(schema, modules);
  const ali = await setup(t, { whatsappNotes: false });
  vi.stubEnv("WIRDAK_ENV", "staging");
  await t.action(internal.whatsappNotes.sendSample, {
    phone: ali.phone,
    kind: "openForHelp",
    many: true,
  });
  expect(sent.map((s) => s.text)).toEqual([
    `[wirdak_open_for_help_many_v3] ختمة رمضان | 3، 12 و15 | j/${ali.inviteCode}`,
  ]);
  vi.stubEnv("WIRDAK_ENV", "prod");
  await expect(
    t.action(internal.whatsappNotes.sendSample, {
      phone: ali.phone,
      kind: "reminder",
    }),
  ).rejects.toThrow("dev or staging");
});
