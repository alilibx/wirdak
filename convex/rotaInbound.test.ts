import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { DEFAULT_GRACE } from "./lib/grace";
import type { RotaMessages } from "./lib/rota";
import { joinText } from "./lib/rotaJoin";
import { encodePayload, type RotaAction } from "./lib/rotaPayload";
import {
  alreadyText,
  askOrganizerText,
  closedText,
  duaText,
  endedText,
  helpText,
  manyKhatmasText,
  notOnListText,
  stopText,
  unknownJoinText,
  whichKhatmaText,
} from "./lib/rotaTemplates";
import schema from "./schema";
import { describeMessage, NO_MATCH_REPLY } from "./whatsapp";

const modules = import.meta.glob("./**/*.ts");

type T = TestConvexForDataModel<DataModel>;

/** A wall-clock time in Asia/Dubai (+04:00, no DST), written `YYYY-MM-DDTHH:MM`. */
function dubai(local: string): number {
  return Date.parse(`${local}:00+04:00`);
}

const RELAY_URL = "https://staging.example.convex.site/whatsapp/relay";
const ORGANIZER = "+971500000001";
const STRANGER = "971509999999";
const LATE = "971500000199";

type Sent = { to: string; body: string };
let sent: Sent[];
let relayed: Record<string, unknown>[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(dubai("2027-01-16T09:00"));
  vi.stubEnv("WIRDAK_ENV", "dev");
  vi.stubEnv("WHATSAPP_PUBLIC_NUMBER", "971500000000");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234567890");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-access-token");
  vi.stubEnv("WHATSAPP_APP_SECRET", "test-app-secret");
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "test-verify-token");
  vi.stubEnv("WHATSAPP_GRAPH_VERSION", "v21.0");
  vi.stubEnv("SITE_URL", "https://wirdak.example");
  sent = [];
  relayed = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === RELAY_URL) {
        relayed.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        // Staging took nothing, so production answers.
        return new Response(JSON.stringify({ handled: false }), {
          status: 200,
        });
      }
      const payload = JSON.parse(String(init.body)) as { to: string };
      sent.push({ to: payload.to, body: describeMessage(payload) });
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const MESSAGES: RotaMessages = {
  dayAt: 480,
  reminder: { at: 960, on: true },
  unread: { at: 1140, on: false },
  summary: { at: 1260, on: false },
};

type Reader = {
  slot: number;
  /** Default 0 (joined long ago); null for someone who never joined. */
  joinedAt?: number | null;
  phone?: string;
};

/**
 * A daily rota khatma named `name` with join code `joinCode`, first date
 * 2027-01-16, and a participant per entry of `readers` (phone
 * +97150000010<i> unless given).
 */
async function setup(
  t: T,
  readers: Reader[],
  over: { name?: string; joinCode?: string; organizerId?: Id<"people"> } = {},
) {
  return await t.run(async (ctx) => {
    const personId =
      over.organizerId ??
      (await ctx.db.insert("people", {
        phone: ORGANIZER,
        displayName: "المنظم",
        verifiedAt: 0,
        timeZone: "Asia/Dubai",
        lastSeenAt: 0,
        rotaAllowed: true,
      }));
    const khatmaId = await ctx.db.insert("khatmas", {
      name: over.name ?? "ختمة",
      schedule: "none",
      grace: DEFAULT_GRACE.none,
      creatorPersonId: personId,
      inviteCode: `invite-${over.joinCode ?? "JNC234"}`,
      joinCode: over.joinCode ?? "JNC234",
      completedRounds: 0,
      createdAt: 0,
      kind: "rota",
      rota: {
        days: { kind: "daily" },
        firstDate: "2027-01-16",
        endDate: null,
        timeZone: "Asia/Dubai",
        messages: MESSAGES,
        pausedAt: null,
        pauseDates: [],
        archivedAt: null,
      },
    });
    const participants: Id<"rotaParticipants">[] = [];
    for (const [i, r] of readers.entries()) {
      const participantId = await ctx.db.insert("rotaParticipants", {
        khatmaId,
        name: `قارئ ${i + 1}`,
        phone: r.phone ?? `+97150000010${i}`,
        personId: null,
        addedAt: 0,
        removedAt: null,
        joinedAt: r.joinedAt === undefined ? 0 : r.joinedAt,
      });
      await ctx.db.insert("rotaSlots", {
        khatmaId,
        slot: r.slot,
        participantId,
      });
      participants.push(participantId);
    }
    return { personId, khatmaId, participants };
  });
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** Starts the khatma's first day (2027-01-16, 08:00) and returns it. */
async function startDay(t: T, s: Setup) {
  await t.mutation(internal.rotaDays.tick, { khatmaId: s.khatmaId });
  const day = await t.run((ctx) =>
    ctx.db
      .query("rotaDays")
      .withIndex("by_khatma_n", (q) => q.eq("khatmaId", s.khatmaId))
      .first(),
  );
  if (!day) throw new Error("no day started");
  return day;
}

let seq = 0;

/** A message from `from` (digits, as the webhook has it) through the inbound path. */
async function send(
  t: T,
  from: string,
  text: string,
  extra: { payload?: string; profileName?: string; media?: boolean } = {},
) {
  await t.action(internal.whatsapp.handleIncoming, {
    waMessageId: `wamid.${++seq}`,
    from,
    text,
    ...extra,
  });
}

const phoneOf = (i: number) => `97150000010${i}`;

function tap(
  action: RotaAction,
  dayId: string,
  participantId: string,
  staging = false,
) {
  return encodePayload({ action, dayId, participantId }, staging);
}

const readsOf = (t: T, dayId: Id<"rotaDays">) =>
  t.run((ctx) =>
    ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", dayId))
      .collect(),
  );

const participant = (t: T, id: Id<"rotaParticipants">) =>
  t.run(async (ctx) => (await ctx.db.get(id))!);

const notes = (t: T) => t.run((ctx) => ctx.db.query("notes").collect());

// ---------------------------------------------------------------------------
// Joining

test("a join text from a listed phone joins and replies with today's juz' buttons", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1, joinedAt: null }]);
  const personId = await t.run((ctx) =>
    ctx.db.insert("people", {
      phone: "+971500000100",
      displayName: "سعيد",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    }),
  );
  const day = await startDay(t, s);
  const [pid] = s.participants as [Id<"rotaParticipants">];

  await send(t, phoneOf(0), joinText("ختمة", "JNC234"));

  const p = await participant(t, pid);
  expect(p.joinedAt).toBe(Date.now());
  expect(p.stoppedAt).toBeNull();
  expect(p.personId).toBe(personId);
  expect(sent).toEqual([
    {
      to: phoneOf(0),
      body:
        "*ختمة*\nأهلاً قارئ 1، انضممت إلى ختمة.\nتحديث على قراءتك اليوم في الختمة ١: المسجَّل لك الجزء ١ من هذه الختمة." +
        `\n[أتممت] ${tap("done", day._id, pid)}` +
        `\n[ليس بعد] ${tap("notYet", day._id, pid)}`,
    },
  ]);
  // a join never signs anyone in
  expect(await t.run((ctx) => ctx.db.query("sessions").collect())).toEqual([]);
});

/** Adds someone who hasn't joined to `slot` after the khatma's day started. */
async function addLate(t: T, s: Setup, slot: number) {
  return await t.run(async (ctx) => {
    const participantId = await ctx.db.insert("rotaParticipants", {
      khatmaId: s.khatmaId,
      name: "جديد",
      phone: `+${LATE}`,
      personId: null,
      addedAt: Date.now(),
      removedAt: null,
      joinedAt: null,
    });
    await ctx.db.insert("rotaSlots", {
      khatmaId: s.khatmaId,
      slot,
      participantId,
    });
    return participantId;
  });
}

test("someone added after the day started takes today's free juz' when they join", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  vi.setSystemTime(dubai("2027-01-16T21:00"));
  const pid = await addLate(t, s, 5);

  await send(t, LATE, joinText("ختمة", "JNC234"));

  const read = (await readsOf(t, day._id)).find((r) => r.juz === 5);
  expect(read).toMatchObject({ holderId: pid, readerId: pid, doneAt: null });
  expect(sent).toEqual([
    {
      to: LATE,
      body:
        "*ختمة*\nأهلاً جديد، انضممت إلى ختمة.\nتحديث على قراءتك اليوم في الختمة ١: المسجَّل لك الجزء ٥ من هذه الختمة." +
        `\n[أتممت] ${tap("done", day._id, pid)}` +
        `\n[ليس بعد] ${tap("notYet", day._id, pid)}`,
    },
  ]);
});

test("a late joiner leaves today's juz' with whoever was given it, and waits for the next day", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  const other = s.participants[0]!;
  const juz5 = (await readsOf(t, day._id)).find((r) => r.juz === 5)!;
  await t.run((ctx) =>
    ctx.db.patch(juz5._id, { readerId: other, reassignedAt: 1 }),
  );
  await addLate(t, s, 5);

  await send(t, LATE, joinText("ختمة", "JNC234"));

  expect((await t.run((ctx) => ctx.db.get(juz5._id)))?.readerId).toBe(other);
  expect(sent.map((m) => m.body)).toEqual([
    "*ختمة*\nأهلاً جديد، انضممت إلى ختمة. تصلك رسالة جزئك يوم الأحد الساعة ٨ صباحاً.",
  ]);
});

test("a late joiner doesn't take a juz' the organizer already marked read", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  const juz5 = (await readsOf(t, day._id)).find((r) => r.juz === 5)!;
  await t.run((ctx) =>
    ctx.db.patch(juz5._id, { doneAt: 1, doneByOrganizer: true }),
  );
  await addLate(t, s, 5);

  await send(t, LATE, joinText("ختمة", "JNC234"));

  expect((await t.run((ctx) => ctx.db.get(juz5._id)))?.readerId).toBeNull();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).not.toContain("[أتممت]");
});

test("a late joiner takes nothing from a paused khatma", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  await t.run(async (ctx) => {
    const khatma = (await ctx.db.get(s.khatmaId))!;
    await ctx.db.patch(s.khatmaId, {
      rota: { ...khatma.rota!, pausedAt: Date.now() },
    });
  });
  await addLate(t, s, 5);

  await send(t, LATE, joinText("ختمة", "JNC234"));

  const read = (await readsOf(t, day._id)).find((r) => r.juz === 5);
  expect(read?.readerId).toBeNull();
});

test("a late joiner takes nothing from a day dated yesterday, still open before the next one starts", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  vi.setSystemTime(dubai("2027-01-17T07:00"));
  await addLate(t, s, 5);

  await send(t, LATE, joinText("ختمة", "JNC234"));

  const read = (await readsOf(t, day._id)).find((r) => r.juz === 5);
  expect(read?.readerId).toBeNull();
});

// ---------------------------------------------------------------------------
// Adding someone in the day's last six hours

/** A running day with one reader, and a session for the organizer. */
async function runningKhatma(t: T, over: { endDate?: string } = {}) {
  const s = await setup(t, [{ slot: 1 }]);
  const sessionToken = "running-session";
  const inviteCode = "runningCode1";
  const tokenHash = await sha256Hex(sessionToken);
  await t.run(async (ctx) => {
    const khatma = await ctx.db.get(s.khatmaId);
    await ctx.db.patch(s.khatmaId, {
      inviteCode,
      rota: { ...khatma!.rota!, endDate: over.endDate ?? null },
    });
    await ctx.db.insert("members", {
      khatmaId: s.khatmaId,
      personId: s.personId,
      joinedAt: 0,
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
    await ctx.db.insert("sessions", {
      personId: s.personId,
      tokenHash,
      alertTokenHash: "alert",
      deviceLabel: "test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
  });
  const day = await startDay(t, s);
  const auth = { sessionToken, inviteCode };
  // Slot 5, which reads juz' 5 today and juz' 6 on the next day.
  const add = (readsToday?: boolean) =>
    t.mutation(api.rota.addParticipant, {
      ...auth,
      name: "جديد",
      phone: `+${LATE}`,
      juz: 6,
      ...(readsToday === undefined ? {} : { readsToday }),
    });
  return { ...s, day, auth, add };
}

const juzFive = async (t: T, dayId: Id<"rotaDays">) =>
  (await readsOf(t, dayId)).find((r) => r.juz === 5);

test("nobody is asked before 18:00", async () => {
  const t = convexTest(schema, modules);
  const s = await runningKhatma(t);
  vi.setSystemTime(dubai("2027-01-16T17:59"));

  expect(await s.add()).toMatchObject({ ok: true });
});

test("from 18:00 the organizer says if someone reads today, and nobody is added until they do", async () => {
  const t = convexTest(schema, modules);
  const s = await runningKhatma(t);
  vi.setSystemTime(dubai("2027-01-16T18:00"));

  expect(await s.add()).toEqual({ error: "ask_today" });

  const people = await t.query(api.rota.people, s.auth);
  expect(people?.participants).toHaveLength(1);
});

test("someone who reads today takes the free juz' when they join", async () => {
  const t = convexTest(schema, modules);
  const s = await runningKhatma(t);
  vi.setSystemTime(dubai("2027-01-16T21:00"));
  const added = await s.add(true);
  expect(added).toMatchObject({ ok: true });

  await send(t, LATE, joinText("ختمة", "JNC234"));

  expect((await juzFive(t, s.day._id))?.readerId).not.toBeNull();
});

test("someone who starts tomorrow takes nothing today, and hears when their juz' comes", async () => {
  const t = convexTest(schema, modules);
  const s = await runningKhatma(t);
  vi.setSystemTime(dubai("2027-01-16T21:00"));
  await s.add(false);

  await send(t, LATE, joinText("ختمة", "JNC234"));

  expect((await juzFive(t, s.day._id))?.readerId).toBeNull();
  expect(sent.at(-1)?.body).toContain("تصلك رسالة جزئك يوم الأحد الساعة");
});

test("nobody is asked when the slot's juz' today has a reader", async () => {
  const t = convexTest(schema, modules);
  const s = await runningKhatma(t);
  const read = await juzFive(t, s.day._id);
  await t.run((ctx) =>
    ctx.db.patch(read!._id, { readerId: s.participants[0]! }),
  );
  vi.setSystemTime(dubai("2027-01-16T21:00"));

  expect(await s.add()).toMatchObject({ ok: true });
});

test("nobody is asked on a paused khatma", async () => {
  const t = convexTest(schema, modules);
  const s = await runningKhatma(t);
  await t.run(async (ctx) => {
    const khatma = await ctx.db.get(s.khatmaId);
    await ctx.db.patch(s.khatmaId, {
      rota: { ...khatma!.rota!, pausedAt: Date.now() },
    });
  });
  vi.setSystemTime(dubai("2027-01-16T21:00"));

  expect(await s.add()).toMatchObject({ ok: true });
});

test("nobody is asked on the khatma's last day: there's no tomorrow to start on", async () => {
  const t = convexTest(schema, modules);
  const s = await runningKhatma(t, { endDate: "2027-01-16" });
  vi.setSystemTime(dubai("2027-01-16T21:00"));

  expect(await s.add()).toMatchObject({ ok: true });
});

test("accepting a request late in the day asks too, and tomorrow leaves today's juz' free", async () => {
  const t = convexTest(schema, modules);
  const s = await runningKhatma(t);
  vi.setSystemTime(dubai("2027-01-16T19:00"));
  await send(t, STRANGER, joinText("ختمة", "JNC234"));
  const [request] = (await t.query(api.rota.people, s.auth))!.requests;
  const accept = (readsToday?: boolean) =>
    t.mutation(api.rota.acceptJoinRequest, {
      ...s.auth,
      requestId: request!.id,
      juz: 6,
      ...(readsToday === undefined ? {} : { readsToday }),
    });

  expect(await accept()).toEqual({ error: "ask_today" });
  expect(await accept(false)).toMatchObject({ ok: true });

  expect((await juzFive(t, s.day._id))?.readerId).toBeNull();
});

test("a tap after midnight still counts for the day before", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1, phone: `+${LATE}` }]);
  const day = await startDay(t, s);
  vi.setSystemTime(dubai("2027-01-17T00:30"));

  await send(t, LATE, "تم");

  const read = (await readsOf(t, day._id)).find((r) => r.juz === 1);
  expect(read?.doneAt).toBe(Date.now());
});

test("a member who joined before takes nothing by sending the join text again", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  const pid = await addLate(t, s, 5);
  await t.run((ctx) => ctx.db.patch(pid, { joinedAt: 1 }));

  await send(t, LATE, joinText("ختمة", "JNC234"));

  const read = (await readsOf(t, day._id)).find((r) => r.juz === 5);
  expect(read?.readerId).toBeNull();
});

test("a late joiner's «أتممت» marks the juz' they took", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  const pid = await addLate(t, s, 5);
  await send(t, LATE, joinText("ختمة", "JNC234"));

  await send(t, LATE, "أتممت", { payload: tap("done", day._id, pid) });

  const read = (await readsOf(t, day._id)).find((r) => r.juz === 5);
  expect(read).toMatchObject({ readerId: pid, doneByOrganizer: false });
  expect(read?.doneAt).toBe(Date.now());
});

test("a join before any open day says when the first juz' comes", async () => {
  vi.setSystemTime(dubai("2027-01-15T12:00"));
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1, joinedAt: null }]);
  await send(t, phoneOf(0), joinText("ختمة", "jnc234"));
  expect((await participant(t, s.participants[0]!)).joinedAt).toBe(Date.now());
  // 2027-01-16 is a Saturday; the juz' message goes at 08:00
  expect(sent.map((m) => m.body)).toEqual([
    "*ختمة*\nأهلاً قارئ 1، انضممت إلى ختمة. تصلك رسالة جزئك يوم السبت الساعة ٨ صباحاً.",
  ]);
});

test("joining again after «إيقاف» turns the messages back on and keeps the first join time", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1, joinedAt: 5 }]);
  const pid = s.participants[0]!;
  await t.run((ctx) => ctx.db.patch(pid, { stoppedAt: 7 }));
  await send(t, phoneOf(0), joinText("ختمة", "JNC234"));
  const p = await participant(t, pid);
  expect(p.joinedAt).toBe(5);
  expect(p.stoppedAt).toBeNull();
});

test("an unlisted phone creates one request and notifies the organizer once", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  await send(t, STRANGER, joinText("ختمة", "JNC234"), { profileName: "خالد" });
  await send(t, STRANGER, joinText("ختمة", "JNC234"), { profileName: "خالد" });

  const requests = await t.run((ctx) =>
    ctx.db.query("rotaJoinRequests").collect(),
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    khatmaId: s.khatmaId,
    phone: `+${STRANGER}`,
    profileName: "خالد",
    resolvedAt: null,
    outcome: null,
  });
  const n = await notes(t);
  expect(n.map((x) => [x.personId, x.kind, x.name])).toEqual([
    [s.personId, "rotaJoinRequest", "خالد"],
  ]);
  expect(sent.map((m) => m.body)).toEqual([
    `*ختمة*\n${notOnListText}`,
    `*ختمة*\n${notOnListText}`,
  ]);
  // nobody was added
  expect(
    await t.run((ctx) => ctx.db.query("rotaParticipants").collect()),
  ).toHaveLength(1);
});

test("a join request without a profile name names the masked phone", async () => {
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }]);
  await send(t, STRANGER, joinText("ختمة", "JNC234"));
  const [note] = await notes(t);
  expect(note?.name).toBe("+971 50 ••• 9999");
  const [request] = await t.run((ctx) =>
    ctx.db.query("rotaJoinRequests").collect(),
  );
  expect(request?.profileName).toBeNull();
});

test("a removed participant's join files a request instead", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1, joinedAt: null }]);
  await t.run((ctx) => ctx.db.patch(s.participants[0]!, { removedAt: 1 }));
  await send(t, phoneOf(0), joinText("ختمة", "JNC234"));
  expect((await participant(t, s.participants[0]!)).joinedAt).toBeNull();
  expect(
    await t.run((ctx) => ctx.db.query("rotaJoinRequests").collect()),
  ).toHaveLength(1);
});

test("a sign-in code text still signs in and never joins; a join text never signs in", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1, joinedAt: null }]);
  const pending = () =>
    t.run((ctx) =>
      ctx.db.insert("verifications", {
        codeNormalized: "K7Q29XMB4T",
        secretHash: "hash",
        displayName: "علي",
        status: "pending",
        pinAttempts: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + 600_000,
      }),
    );
  const signIn = await pending();
  await send(t, phoneOf(0), "رمز التحقق في وِردك: K7Q2-9XMB-4T");
  expect((await t.run((ctx) => ctx.db.get(signIn)))?.status).toBe("matched");
  expect((await participant(t, s.participants[0]!)).joinedAt).toBeNull();
  expect(
    await t.run((ctx) => ctx.db.query("waContacts").collect()),
  ).toHaveLength(0);

  // A join text joins and leaves a pending sign-in alone.
  await t.run((ctx) => ctx.db.delete(signIn));
  const other = await pending();
  await send(t, phoneOf(0), joinText("ختمة", "JNC234"));
  expect((await participant(t, s.participants[0]!)).joinedAt).toBe(Date.now());
  expect((await t.run((ctx) => ctx.db.get(other)))?.status).toBe("pending");
  expect(await t.run((ctx) => ctx.db.query("sessions").collect())).toEqual([]);
});

test("a join text whose title holds a pending sign-in code joins and signs nobody in", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1, joinedAt: null }], {
    name: "Family K7Q29XMB4T",
  });
  const verificationId = await t.run((ctx) =>
    ctx.db.insert("verifications", {
      codeNormalized: "K7Q29XMB4T",
      secretHash: "hash",
      displayName: "علي",
      status: "pending",
      pinAttempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    }),
  );
  await send(t, phoneOf(0), joinText("Family K7Q29XMB4T", "JNC234"));
  expect((await participant(t, s.participants[0]!)).joinedAt).toBe(Date.now());
  expect((await t.run((ctx) => ctx.db.get(verificationId)))?.status).toBe(
    "pending",
  );
});

test("an archived khatma's join code says it has ended and is not relayed", async () => {
  withRelay();
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1, joinedAt: null }]);
  await t.run(async (ctx) => {
    const k = (await ctx.db.get(s.khatmaId))!;
    await ctx.db.patch(s.khatmaId, { rota: { ...k.rota!, archivedAt: 1 } });
  });
  await send(t, phoneOf(0), joinText("ختمة", "JNC234"));
  await send(t, STRANGER, joinText("ختمة", "JNC234"));
  expect(sent.map((m) => [m.to, m.body])).toEqual([
    [phoneOf(0), `*ختمة*\n${endedText}`],
    [STRANGER, `*ختمة*\n${endedText}`],
  ]);
  expect(relayed).toEqual([]);
  expect((await participant(t, s.participants[0]!)).joinedAt).toBeNull();
  expect(
    await t.run((ctx) => ctx.db.query("rotaJoinRequests").collect()),
  ).toEqual([]);
});

test("a join text for a code this deployment lacks says the khatma wasn't found", async () => {
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }]);
  await send(t, phoneOf(0), joinText("ختمة", "ZZZ999"));
  expect(sent.map((m) => m.body)).toEqual([unknownJoinText]);
  expect(
    await t.run((ctx) => ctx.db.query("rotaJoinRequests").collect()),
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// Button taps

test("«أتممت» marks the tapper's reads done once, and a closed day changes nothing", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }, { slot: 2 }]);
  const day = await startDay(t, s);
  const [a] = s.participants as [Id<"rotaParticipants">];

  await send(t, phoneOf(0), "أتممت", { payload: tap("done", day._id, a) });
  const reads = await readsOf(t, day._id);
  expect(
    reads.filter((r) => r.doneAt !== null).map((r) => [r.juz, r.readerId]),
  ).toEqual([[1, a]]);
  expect(reads.find((r) => r.juz === 1)?.doneByOrganizer).toBe(false);

  await send(t, phoneOf(0), "أتممت", { payload: tap("done", day._id, a) });
  await t.run((ctx) => ctx.db.patch(day._id, { closedAt: Date.now() }));
  await send(t, phoneOf(0), "ليس بعد", { payload: tap("notYet", day._id, a) });
  expect(sent.map((m) => m.body)).toEqual([
    "*ختمة*\nتقبّل الله منك. ١ من ٣٠ جزءاً تمّت اليوم.",
    `*ختمة*\n${alreadyText}`,
    `*ختمة*\n${closedText}`,
  ]);
  expect((await readsOf(t, day._id)).filter((r) => r.notYetAt != null)).toEqual(
    [],
  );
});

test("the holder's «أتممت» still counts after their juz' was reassigned", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }, { slot: 2 }]);
  const day = await startDay(t, s);
  const [a, b] = s.participants as [
    Id<"rotaParticipants">,
    Id<"rotaParticipants">,
  ];
  // juz' 1 went to B, then A read it anyway
  await t.run(async (ctx) => {
    const one = (await ctx.db.query("rotaReads").collect()).find(
      (r) => r.juz === 1,
    )!;
    await ctx.db.patch(one._id, { readerId: b, reassignedAt: 1 });
  });
  await send(t, phoneOf(0), "أتممت", { payload: tap("done", day._id, a) });
  const one = (await readsOf(t, day._id)).find((r) => r.juz === 1)!;
  expect(one.doneAt).toBe(Date.now());
  expect(one.doneByOrganizer).toBe(false);
  // B's own juz' is untouched
  expect((await readsOf(t, day._id)).find((r) => r.juz === 2)?.doneAt).toBe(
    null,
  );
  expect(sent.map((m) => m.body)).toEqual([
    "*ختمة*\nتقبّل الله منك. ١ من ٣٠ جزءاً تمّت اليوم.",
  ]);
});

test("a holder's typed «تم» counts for the juz' reassigned away", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }, { slot: 2 }]);
  const day = await startDay(t, s);
  const b = s.participants[1]!;
  await t.run(async (ctx) => {
    const one = (await ctx.db.query("rotaReads").collect()).find(
      (r) => r.juz === 1,
    )!;
    await ctx.db.patch(one._id, { readerId: b, reassignedAt: 1 });
  });
  await send(t, phoneOf(0), "تم");
  expect((await readsOf(t, day._id)).find((r) => r.juz === 1)?.doneAt).toBe(
    Date.now(),
  );
  expect(sent.map((m) => m.body)).toEqual([
    "*ختمة*\nتقبّل الله منك. ١ من ٣٠ جزءاً تمّت اليوم.",
  ]);
});

test("B's phone with A's payload changes nothing", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }, { slot: 2 }]);
  const day = await startDay(t, s);
  const [a] = s.participants as [Id<"rotaParticipants">];

  await send(t, phoneOf(1), "أتممت", { payload: tap("done", day._id, a) });
  await send(t, phoneOf(1), "ليس بعد", { payload: tap("notYet", day._id, a) });
  await send(t, STRANGER, "أتممت", { payload: tap("done", day._id, a) });
  // a forged id, or another table's id
  await send(t, phoneOf(0), "أتممت", { payload: tap("done", day._id, "x") });
  await send(t, phoneOf(0), "أتممت", { payload: tap("done", a, a) });

  const reads = await readsOf(t, day._id);
  expect(reads.every((r) => r.doneAt === null && r.notYetAt == null)).toBe(
    true,
  );
  expect(sent.map((m) => m.body)).toEqual(Array(5).fill(helpText));
});

test("the tap that completes the day brings the dua, and the others get the completion message", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }, { slot: 2 }]);
  const day = await startDay(t, s);
  const [a, b] = s.participants as [
    Id<"rotaParticipants">,
    Id<"rotaParticipants">,
  ];
  await t.run(async (ctx) => {
    for (const r of await ctx.db.query("rotaReads").collect()) {
      if (r.readerId !== a) await ctx.db.patch(r._id, { doneAt: 1 });
    }
  });

  await send(t, phoneOf(0), "أتممت", { payload: tap("done", day._id, a) });

  expect(sent.map((m) => m.body)).toEqual([
    "*ختمة*\nتقبّل الله منك. ٣٠ من ٣٠ جزءاً تمّت اليوم.",
    `*ختمة*\n${duaText()}`,
  ]);
  const after = await t.run((ctx) => ctx.db.get(day._id));
  expect(after?.completedAt).not.toBeNull();
  expect(after?.celebratedAt).not.toBeNull();
  const complete = await t.run(async (ctx) =>
    (await ctx.db.query("rotaOutbox").collect()).filter(
      (r) => r.kind === "complete",
    ),
  );
  expect(complete.map((r) => r.participantId)).toEqual([b]);
});

test("«ليس بعد» stamps the reads and names the reminder time while it is ahead", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  const a = s.participants[0]!;

  await send(t, phoneOf(0), "ليس بعد", { payload: tap("notYet", day._id, a) });
  const [read] = (await readsOf(t, day._id)).filter((r) => r.readerId === a);
  expect(read?.notYetAt).toBe(Date.now());
  expect(read?.doneAt).toBeNull();

  vi.setSystemTime(dubai("2027-01-16T17:00"));
  await send(t, phoneOf(0), "ليس بعد", { payload: tap("notYet", day._id, a) });
  expect(sent.map((m) => m.body)).toEqual([
    "*ختمة*\nلا بأس، نذكّرك الساعة ٤ عصراً.",
    "*ختمة*\nلا بأس.",
  ]);
});

test("«دعاء الختم» replies with the dua", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  await send(t, phoneOf(0), "دعاء الختم", {
    payload: tap("dua", day._id, s.participants[0]!),
  });
  expect(sent.map((m) => m.body)).toEqual([`*ختمة*\n${duaText()}`]);
});

test("a tap on another kind of button is neither answered nor relayed", async () => {
  vi.stubEnv("WHATSAPP_RELAY_URL", RELAY_URL);
  vi.stubEnv("WHATSAPP_RELAY_SECRET", "test-relay-secret-0123456789abcdef");
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }]);
  await send(t, phoneOf(0), "شيء", { payload: "something-else" });
  expect(sent).toEqual([]);
  expect(relayed).toEqual([]);
});

// ---------------------------------------------------------------------------
// Typed replies

test("«إيقاف» stops every khatma for the phone and tells each organizer", async () => {
  const t = convexTest(schema, modules);
  const phone = "+971500000100";
  const one = await setup(t, [{ slot: 1, phone }]);
  const two = await setup(t, [{ slot: 3, phone }], {
    name: "ختمة الجيران",
    joinCode: "JNC567",
    organizerId: one.personId,
  });
  await send(t, phoneOf(0), "إيقاف");

  for (const s of [one, two]) {
    expect((await participant(t, s.participants[0]!)).stoppedAt).toBe(
      Date.now(),
    );
  }
  const n = await notes(t);
  expect(n.map((x) => [x.khatmaId, x.kind, x.name])).toEqual([
    [one.khatmaId, "rotaStopped", "قارئ 1"],
    [two.khatmaId, "rotaStopped", "قارئ 1"],
  ]);
  expect(sent.map((m) => m.body)).toEqual([stopText]);
});

test("«إيقاف» from a phone that only asked to join declines its requests", async () => {
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }]);
  await send(t, STRANGER, joinText("ختمة", "JNC234"), { profileName: "خالد" });
  sent.length = 0;
  await send(t, STRANGER, "إيقاف");
  const requests = await t.run((ctx) =>
    ctx.db.query("rotaJoinRequests").collect(),
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    resolvedAt: Date.now(),
    outcome: "declined",
  });
  expect(sent.map((m) => m.body)).toEqual([stopText]);
  // Nothing is open any more: a second «إيقاف» is not a rota message.
  sent.length = 0;
  await send(t, STRANGER, "إيقاف");
  expect(sent.map((m) => m.body)).not.toContain(stopText);
});

test("«إيقاف» from a member also declines the phone's open join requests elsewhere", async () => {
  const t = convexTest(schema, modules);
  const one = await setup(t, [{ slot: 1 }]);
  const two = await setup(t, [{ slot: 1, phone: "+971500000200" }], {
    name: "ختمة الجيران",
    joinCode: "JNC567",
    organizerId: one.personId,
  });
  // listed in the first khatma, asking to join the second
  await send(t, phoneOf(0), joinText("ختمة الجيران", "JNC567"));
  await send(t, phoneOf(0), "إيقاف");
  const requests = await t.run((ctx) =>
    ctx.db.query("rotaJoinRequests").collect(),
  );
  expect(requests).toEqual([
    expect.objectContaining({
      khatmaId: two.khatmaId,
      resolvedAt: Date.now(),
      outcome: "declined",
    }),
  ]);
  expect((await participant(t, one.participants[0]!)).stoppedAt).toBe(
    Date.now(),
  );
});

test("«إيقاف» from a stranger with no request is not a rota message", async () => {
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }]);
  await send(t, STRANGER, "إيقاف");
  expect(sent.map((m) => m.body)).not.toContain(stopText);
});

test("typed «تم» with two open khatmas replies with two buttons and changes nothing", async () => {
  const t = convexTest(schema, modules);
  const phone = "+971500000100";
  const one = await setup(t, [{ slot: 1, phone }]);
  const two = await setup(t, [{ slot: 3, phone }], {
    name: "ختمة الجيران",
    joinCode: "JNC567",
    organizerId: one.personId,
  });
  const dayOne = await startDay(t, one);
  const dayTwo = await startDay(t, two);

  await send(t, phoneOf(0), "تم");

  expect(sent.map((m) => m.body)).toEqual([
    whichKhatmaText +
      `\n[ختمة] ${tap("done", dayOne._id, one.participants[0]!)}` +
      `\n[ختمة الجيران] ${tap("done", dayTwo._id, two.participants[0]!)}`,
  ]);
  for (const day of [dayOne, dayTwo]) {
    expect((await readsOf(t, day._id)).every((r) => r.doneAt === null)).toBe(
      true,
    );
  }

  // Tapping one of them acts on that khatma alone.
  await send(t, phoneOf(0), "ختمة الجيران", {
    payload: tap("done", dayTwo._id, two.participants[0]!),
  });
  expect(
    (await readsOf(t, dayTwo._id)).filter((r) => r.doneAt !== null),
  ).toHaveLength(1);
  expect((await readsOf(t, dayOne._id)).every((r) => r.doneAt === null)).toBe(
    true,
  );

  // Now only one khatma has unread reads, so «تم» acts on it.
  await send(t, phoneOf(0), "تم");
  expect(
    (await readsOf(t, dayOne._id)).filter((r) => r.doneAt !== null),
  ).toHaveLength(1);
  expect(sent.at(-1)?.body).toBe(
    "*ختمة*\nتقبّل الله منك. ١ من ٣٠ جزءاً تمّت اليوم.",
  );

  // And with nothing left, «تم» is already recorded.
  await send(t, phoneOf(0), "تم");
  expect(sent.at(-1)?.body).toBe(alreadyText);
});

/** The same phone joined in khatmas named `names`, each with today's day started. */
async function openKhatmas(t: T, names: string[]) {
  const phone = "+971500000100";
  const codes = ["JNC234", "JNC567", "JNC789", "JNC345"];
  const out: { s: Setup; day: Awaited<ReturnType<typeof startDay>> }[] = [];
  let organizerId: Id<"people"> | undefined;
  for (const [i, name] of names.entries()) {
    const s = await setup(t, [{ slot: i + 1, phone }], {
      name,
      joinCode: codes[i]!,
      ...(organizerId && { organizerId }),
    });
    organizerId = s.personId;
    out.push({ s, day: await startDay(t, s) });
  }
  return out;
}

test("which-khatma buttons keep titles apart after the 20-character cut", async () => {
  const t = convexTest(schema, modules);
  // the same first 20 characters
  const base = "ختمة العائلة الكبيرة";
  expect(Array.from(base)).toHaveLength(20);
  const open = await openKhatmas(t, [`${base} أ`, `${base} ب`, "ختمة"]);
  await send(t, phoneOf(0), "تم");
  const second = `${Array.from(base).slice(0, 18).join("").trimEnd()} ٢`;
  const ids = open.map(({ s, day }) =>
    tap("done", day._id, s.participants[0]!),
  );
  expect(sent.map((m) => m.body)).toEqual([
    `${whichKhatmaText}\n[${base}] ${ids[0]}\n[${second}] ${ids[1]}\n[ختمة] ${ids[2]}`,
  ]);
});

test("more open khatmas than buttons fit get their names in plain text", async () => {
  const t = convexTest(schema, modules);
  const names = ["ختمة أ", "ختمة ب", "ختمة ج", "ختمة د"];
  const open = await openKhatmas(t, names);
  await send(t, phoneOf(0), "تم");
  expect(sent.map((m) => m.body)).toEqual([manyKhatmasText(names)]);
  for (const { day } of open) {
    expect((await readsOf(t, day._id)).every((r) => r.doneAt === null)).toBe(
      true,
    );
  }
});

test("typed «ليس بعد» and «الدعاء» answer a joined member", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  await send(t, phoneOf(0), "بعدين");
  await send(t, phoneOf(0), "الدعاء");
  expect(sent.map((m) => m.body)).toEqual([
    "*ختمة*\nلا بأس، نذكّرك الساعة ٤ عصراً.",
    duaText(),
  ]);
  expect(
    (await readsOf(t, day._id)).filter((r) => r.notYetAt != null),
  ).toHaveLength(1);
});

test("other text from a joined member gets the help reply, not the sign-in reply", async () => {
  withRelay();
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }, { slot: 2, joinedAt: null }]);
  await send(t, phoneOf(0), "السلام عليكم");
  // a listed phone that never joined: production answers a rota word, and
  // other text gets the sign-in reply; a phone that isn't listed too
  await send(t, phoneOf(1), "تم");
  await send(t, phoneOf(1), "السلام عليكم");
  await send(t, STRANGER, "السلام عليكم");
  expect(sent.map((m) => [m.to, m.body])).toEqual([
    [phoneOf(0), helpText],
    [phoneOf(1), helpText],
    [phoneOf(1), NO_MATCH_REPLY],
    [STRANGER, NO_MATCH_REPLY],
  ]);
  expect(relayed).toEqual([]);
});

test("«إيقاف» works for a phone over the sign-in rate limit", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  // the sign-in limit is 10 messages an hour
  for (let i = 0; i < 11; i++) await send(t, phoneOf(0), "السلام عليكم");
  await send(t, phoneOf(0), "إيقاف");
  expect((await participant(t, s.participants[0]!)).stoppedAt).toBe(Date.now());
  // the 11th is over the limit but can't be a sign-in, so it still gets help
  expect(sent.map((m) => m.body)).toEqual([
    ...Array<string>(11).fill(helpText),
    stopText,
  ]);
});

test("a joined member's code-shaped text is left for the relay, not answered with help", async () => {
  withRelay();
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }]);
  // a sign-in started on staging, sent by a production rota member
  await send(t, phoneOf(0), "رمز التحقق في وِردك: ZZZZ-2222-ZZ");
  expect(relayed.map((r) => r.text)).toEqual([
    "رمز التحقق في وِردك: ZZZZ-2222-ZZ",
  ]);
  expect(sent.map((m) => m.body)).toEqual([NO_MATCH_REPLY]);
});

test("every message opens the window and counts as a reply", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  const a = s.participants[0]!;
  await t.run((ctx) =>
    ctx.db.patch(a, { silentDays: 6, silencedAt: 3, lastReplyAt: 2 }),
  );

  await send(t, phoneOf(0), "السلام عليكم");
  expect(await t.run((ctx) => ctx.db.query("waContacts").collect())).toEqual([
    expect.objectContaining({
      phone: "+971500000100",
      lastInboundAt: Date.now(),
    }),
  ]);
  expect(await participant(t, a)).toMatchObject({
    lastReplyAt: Date.now(),
    silentDays: 0,
    silencedAt: null,
  });

  // a button tap too, and the window moves forward
  vi.setSystemTime(dubai("2027-01-16T10:00"));
  await t.run((ctx) => ctx.db.patch(a, { silentDays: 2 }));
  await send(t, phoneOf(0), "ليس بعد", { payload: tap("notYet", day._id, a) });
  const contacts = await t.run((ctx) => ctx.db.query("waContacts").collect());
  expect(contacts.map((c) => c.lastInboundAt)).toEqual([Date.now()]);
  expect(await participant(t, a)).toMatchObject({
    lastReplyAt: Date.now(),
    silentDays: 0,
  });
});

// ---------------------------------------------------------------------------
// Join requests: blocked numbers and declined ones

test("a join from a blocked number files no request, tells nobody and gets no reply", async () => {
  withRelay();
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }]);
  await t.run(async (ctx) => {
    const admin = await ctx.db.insert("admins", {
      phone: "+971500000099",
      addedBy: null,
      addedAt: 0,
    });
    await ctx.db.insert("blockedPhones", {
      phone: `+${STRANGER}`,
      blockedBy: admin,
      at: 0,
      note: null,
    });
  });
  await send(t, STRANGER, joinText("ختمة", "JNC234"), { profileName: "خالد" });
  expect(
    await t.run((ctx) => ctx.db.query("rotaJoinRequests").collect()),
  ).toEqual([]);
  expect(await notes(t)).toEqual([]);
  expect(sent).toEqual([]);
  expect(relayed).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("waContacts").collect())).toEqual(
    [],
  );
});

test("a join within 7 days of a declined request files nothing new; after that it does", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  await send(t, STRANGER, joinText("ختمة", "JNC234"), { profileName: "خالد" });
  await t.run(async (ctx) => {
    const [r] = await ctx.db.query("rotaJoinRequests").collect();
    await ctx.db.patch(r!._id, {
      resolvedAt: Date.now(),
      outcome: "declined",
      declinedBy: "organizer",
    });
  });
  sent.length = 0;

  vi.setSystemTime(Date.now() + 6 * 86_400_000);
  await send(t, STRANGER, joinText("ختمة", "JNC234"), { profileName: "خالد" });
  expect(
    await t.run((ctx) => ctx.db.query("rotaJoinRequests").collect()),
  ).toHaveLength(1);
  expect(await notes(t)).toHaveLength(1);
  // Told to ask the organizer, not that a request was sent.
  expect(sent.map((m) => m.body)).toEqual([`*ختمة*\n${askOrganizerText}`]);

  vi.setSystemTime(Date.now() + 2 * 86_400_000);
  await send(t, STRANGER, joinText("ختمة", "JNC234"), { profileName: "خالد" });
  const requests = await t.run((ctx) =>
    ctx.db.query("rotaJoinRequests").collect(),
  );
  expect(requests.filter((r) => r.resolvedAt === null)).toHaveLength(1);
  expect((await notes(t)).map((n) => [n.khatmaId, n.kind])).toEqual([
    [s.khatmaId, "rotaJoinRequest"],
    [s.khatmaId, "rotaJoinRequest"],
  ]);
});

test("a join after the phone's own «إيقاف» withdrew its request files a new one", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  await send(t, STRANGER, joinText("ختمة", "JNC234"), { profileName: "خالد" });
  await send(t, STRANGER, "إيقاف");
  expect(
    await t.run((ctx) => ctx.db.query("rotaJoinRequests").collect()),
  ).toEqual([expect.objectContaining({ declinedBy: "member" })]);
  sent.length = 0;

  vi.setSystemTime(Date.now() + 86_400_000);
  await send(t, STRANGER, joinText("ختمة", "JNC234"), { profileName: "خالد" });
  const requests = await t.run((ctx) =>
    ctx.db.query("rotaJoinRequests").collect(),
  );
  expect(requests.filter((r) => r.resolvedAt === null)).toHaveLength(1);
  expect((await notes(t)).map((n) => [n.khatmaId, n.kind])).toEqual([
    [s.khatmaId, "rotaJoinRequest"],
    [s.khatmaId, "rotaJoinRequest"],
  ]);
  expect(sent.map((m) => m.body)).toEqual([`*ختمة*\n${notOnListText}`]);
});

// ---------------------------------------------------------------------------
// The 24-hour window

test("only a phone with a participant or a join request gets a window", async () => {
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }]);
  const contacts = () => t.run((ctx) => ctx.db.query("waContacts").collect());

  await send(t, STRANGER, "السلام عليكم");
  await send(t, STRANGER, "تم");
  await send(t, STRANGER, joinText("ختمة", "ZZZ999"));
  expect(await contacts()).toEqual([]);

  // the join request is filed, then the window opens
  await send(t, STRANGER, joinText("ختمة", "JNC234"));
  expect((await contacts()).map((c) => c.phone)).toEqual([`+${STRANGER}`]);

  await send(t, phoneOf(0), "السلام عليكم");
  expect((await contacts()).map((c) => c.phone).sort()).toEqual(
    [`+${STRANGER}`, `+${phoneOf(0)}`].sort(),
  );
});

// ---------------------------------------------------------------------------
// Media, stickers and voice notes

test("media from a rota phone counts as a reply and gets no answer", async () => {
  withRelay();
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const a = s.participants[0]!;
  await t.run((ctx) =>
    ctx.db.patch(a, { silentDays: 4, silencedAt: 3, lastReplyAt: 2 }),
  );
  await send(t, phoneOf(0), "", { media: true });
  expect(await participant(t, a)).toMatchObject({
    lastReplyAt: Date.now(),
    silentDays: 0,
    silencedAt: null,
  });
  expect(await t.run((ctx) => ctx.db.query("waContacts").collect())).toEqual([
    expect.objectContaining({
      phone: `+${phoneOf(0)}`,
      lastInboundAt: Date.now(),
    }),
  ]);
  expect(sent).toEqual([]);
  expect(relayed).toEqual([]);
});

test("media from a phone with no participant here is relayed as media, never answered, and leaves no window", async () => {
  withRelay();
  const t = convexTest(schema, modules);
  await setup(t, [{ slot: 1 }]);
  await send(t, STRANGER, "", { media: true });
  expect(sent).toEqual([]);
  expect(relayed).toEqual([
    expect.objectContaining({ from: STRANGER, text: "", media: true }),
  ]);
  expect(await t.run((ctx) => ctx.db.query("waContacts").collect())).toEqual(
    [],
  );
});

// ---------------------------------------------------------------------------
// Relay to staging (which shares production's number)

function withRelay() {
  vi.stubEnv("WHATSAPP_RELAY_URL", RELAY_URL);
  vi.stubEnv("WHATSAPP_RELAY_SECRET", "test-relay-secret-0123456789abcdef");
}

test("relay is chosen for a staging payload and for an unknown join code", async () => {
  withRelay();
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);

  await send(t, phoneOf(0), "أتممت", {
    payload: tap("done", day._id, s.participants[0]!, true),
    profileName: "سعيد",
  });
  await send(t, STRANGER, joinText("ختمة", "ZZZ999"), { profileName: "خالد" });
  // a typed reply from a phone that is no rota participant here
  await send(t, STRANGER, "تم");

  expect(
    relayed.map((r) => [r.from, r.text, r.payload, r.profileName]),
  ).toEqual([
    [
      phoneOf(0),
      "أتممت",
      tap("done", day._id, s.participants[0]!, true),
      "سعيد",
    ],
    [STRANGER, joinText("ختمة", "ZZZ999"), undefined, "خالد"],
    [STRANGER, "تم", undefined, undefined],
  ]);
  // The staging tap changed nothing here and got no reply from production;
  // a join code neither deployment has says so, and the typed reply staging
  // didn't take gets production's sign-in reply.
  expect((await readsOf(t, day._id)).every((r) => r.doneAt === null)).toBe(
    true,
  );
  expect(sent.map((m) => [m.to, m.body])).toEqual([
    [STRANGER, unknownJoinText],
    [STRANGER, NO_MATCH_REPLY],
  ]);
});

test("what production places is never relayed", async () => {
  withRelay();
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  await send(t, phoneOf(0), joinText("ختمة", "JNC234"));
  await send(t, phoneOf(0), "تم");
  await send(t, phoneOf(0), "أتممت", {
    payload: tap("done", day._id, s.participants[0]!),
  });
  await send(t, phoneOf(0), "السلام عليكم");
  await send(t, STRANGER, "السلام عليكم");
  expect(relayed).toEqual([]);
  expect(sent).toHaveLength(5);
});

// ---------------------------------------------------------------------------
// A khatma an admin set up, waiting for its organizer

/** The khatma's organizer as a participant on slot 1, and a session for them; no `members` row. */
async function pendingKhatma(t: T) {
  const s = await setup(t, [{ slot: 1, phone: ORGANIZER, joinedAt: null }]);
  const sessionToken = "organizer-session";
  const inviteCode = "pendingCode1";
  const tokenHash = await sha256Hex(sessionToken);
  await t.run(async (ctx) => {
    const khatma = await ctx.db.get(s.khatmaId);
    await ctx.db.patch(s.khatmaId, {
      inviteCode,
      rota: { ...khatma!.rota!, pendingOrganizer: true },
    });
    await ctx.db.patch(s.participants[0]!, { personId: s.personId });
    await ctx.db.insert("sessions", {
      personId: s.personId,
      tokenHash,
      alertTokenHash: "alert",
      deviceLabel: "test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
  });
  return { ...s, sessionToken, inviteCode };
}

const pendingState = (t: T, khatmaId: Id<"khatmas">) =>
  t.run(async (ctx) => ({
    pending: (await ctx.db.get(khatmaId))?.rota?.pendingOrganizer,
    members: await ctx.db
      .query("members")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .collect(),
    notes: await ctx.db.query("notes").collect(),
    requests: await ctx.db.query("rotaJoinRequests").collect(),
  }));

test("a stranger's join on a waiting khatma files a request, and makes nobody organizer", async () => {
  const t = convexTest(schema, modules);
  const s = await pendingKhatma(t);

  await send(t, STRANGER, joinText("ختمة", "JNC234"));

  const state = await pendingState(t, s.khatmaId);
  expect(state.pending).toBe(true);
  expect(state.members).toEqual([]);
  expect(state.requests.map((r) => r.phone)).toEqual([`+${STRANGER}`]);
  expect(state.notes.map((n) => n.kind)).toEqual(["rotaJoinRequest"]);
  expect(
    await t.query(api.rota.people, {
      sessionToken: s.sessionToken,
      inviteCode: s.inviteCode,
    }),
  ).toBeNull();
});

test("a blocked organizer's join on a waiting khatma doesn't make them its organizer", async () => {
  const t = convexTest(schema, modules);
  const s = await pendingKhatma(t);
  await t.run(async (ctx) => {
    const admin = await ctx.db.insert("admins", {
      phone: "+971500000099",
      addedBy: null,
      addedAt: 0,
    });
    await ctx.db.insert("blockedPhones", {
      phone: ORGANIZER,
      blockedBy: admin,
      at: 0,
      note: null,
    });
  });

  await send(t, ORGANIZER.slice(1), joinText("ختمة", "JNC234"));

  const state = await pendingState(t, s.khatmaId);
  expect(state.pending).toBe(true);
  expect(state.members).toEqual([]);
  expect(state.notes).toEqual([]);
});

test("a listed reader's join on a waiting khatma joins them, and makes them no organizer", async () => {
  const t = convexTest(schema, modules);
  const s = await pendingKhatma(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("rotaParticipants", {
      khatmaId: s.khatmaId,
      name: "قارئ",
      phone: "+971500000200",
      personId: null,
      addedAt: 0,
      removedAt: null,
    });
  });

  await send(t, "971500000200", joinText("ختمة", "JNC234"));

  const state = await pendingState(t, s.khatmaId);
  expect(state.pending).toBe(true);
  expect(state.members).toEqual([]);
});

test("the organizer's own number takes the khatma up, and only then does it answer them", async () => {
  const t = convexTest(schema, modules);
  const s = await pendingKhatma(t);
  const args = { sessionToken: s.sessionToken, inviteCode: s.inviteCode };
  expect(await t.query(api.rota.people, args)).toBeNull();

  await send(t, ORGANIZER.slice(1), joinText("ختمة", "JNC234"));

  const state = await pendingState(t, s.khatmaId);
  expect(state.pending).toBe(false);
  expect(state.members).toHaveLength(1);
  expect(state.members[0]).toMatchObject({
    personId: s.personId,
    status: "active",
  });
  expect(state.notes.map((n) => [n.kind, n.personId])).toEqual([
    ["nowOrganizer", s.personId],
  ]);
  expect(state.requests).toEqual([]);

  // On top of the usual join: they are welcomed, and joined.
  expect(sent.map((m) => m.to)).toEqual([ORGANIZER.slice(1)]);
  const view = await t.query(api.rota.people, args);
  expect(view?.participants[0]).toMatchObject({ isMe: true, joined: true });

  // A second join is an ordinary join.
  await send(t, ORGANIZER.slice(1), joinText("ختمة", "JNC234"));
  const again = await pendingState(t, s.khatmaId);
  expect(again.members).toHaveLength(1);
  expect(again.notes).toHaveLength(1);
});

test("an archived waiting khatma only says it has ended", async () => {
  const t = convexTest(schema, modules);
  const s = await pendingKhatma(t);
  await t.run(async (ctx) => {
    const khatma = await ctx.db.get(s.khatmaId);
    await ctx.db.patch(s.khatmaId, {
      rota: { ...khatma!.rota!, archivedAt: 1 },
    });
  });

  await send(t, ORGANIZER.slice(1), joinText("ختمة", "JNC234"));

  const state = await pendingState(t, s.khatmaId);
  expect(state.pending).toBe(true);
  expect(state.members).toEqual([]);
  expect(sent[0]?.body).toContain(endedText);
});

// ---------------------------------------------------------------------------
// Members of an archived khatma

/** Archives the khatma as its organizer would: it stops, and its day closes. */
async function archiveOf(t: T, s: Setup) {
  await t.run(async (ctx) => {
    const khatma = (await ctx.db.get(s.khatmaId))!;
    await ctx.db.patch(s.khatmaId, {
      rota: { ...khatma.rota!, archivedAt: Date.now() },
    });
    const days = await ctx.db
      .query("rotaDays")
      .withIndex("by_khatma_n", (q) => q.eq("khatmaId", s.khatmaId))
      .collect();
    for (const day of days) {
      await ctx.db.patch(day._id, { closedAt: Date.now() });
    }
  });
}

const windowOf = (t: T, phone: string) =>
  t.run((ctx) =>
    ctx.db
      .query("waContacts")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique(),
  );

test("someone only on archived khatmas hears that it ended, for a typed reply or any other text", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }], { name: "ختمة العائلة" });
  await startDay(t, s);
  await archiveOf(t, s);

  for (const text of ["تم", "ليس بعد", "دعاء", "كيف الحال"]) {
    await send(t, phoneOf(0), text);
  }

  const ended = `*ختمة العائلة*\n${endedText}`;
  expect(sent.map((m) => m.body)).toEqual([ended, ended, ended, ended]);
});

test("with several archived khatmas the reply names the newest", async () => {
  const t = convexTest(schema, modules);
  const phone = "+971500000100";
  const old = await setup(t, [{ slot: 1, phone }], {
    name: "القديمة",
    joinCode: "OLD234",
  });
  const newest = await setup(t, [{ slot: 1, phone }], {
    name: "الأحدث",
    joinCode: "NEW234",
    organizerId: old.personId,
  });
  await t.run((ctx) => ctx.db.patch(newest.khatmaId, { createdAt: 5 }));
  await archiveOf(t, newest);
  await archiveOf(t, old);

  await send(t, phoneOf(0), "تم");

  expect(sent.map((m) => m.body)).toEqual([`*الأحدث*\n${endedText}`]);
});

test("a live khatma alongside an archived one keeps the usual replies", async () => {
  const t = convexTest(schema, modules);
  const phone = "+971500000100";
  const archived = await setup(t, [{ slot: 1, phone }], { joinCode: "OLD234" });
  await setup(t, [{ slot: 1, phone }], {
    joinCode: "NEW234",
    organizerId: archived.personId,
  });
  await archiveOf(t, archived);

  await send(t, phoneOf(0), "كيف الحال");

  expect(sent.map((m) => m.body)).toEqual([helpText]);
});

test("«إيقاف» from someone only on archived khatmas still stops them", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  await archiveOf(t, s);

  await send(t, phoneOf(0), "إيقاف");

  expect(sent.map((m) => m.body)).toEqual([stopText]);
  expect((await participant(t, s.participants[0]!)).stoppedAt).toBe(Date.now());
});

test("a tap on an old button of an archived khatma says the day is closed", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  const day = await startDay(t, s);
  await archiveOf(t, s);

  await send(t, phoneOf(0), "", {
    payload: tap("done", day._id, s.participants[0]!),
  });

  expect(sent.map((m) => m.body)).toEqual([`*ختمة*\n${closedText}`]);
});

test("what may be a sign-in code from someone only on archived khatmas is left alone", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  await archiveOf(t, s);

  const result = await t.mutation(internal.rotaInbound.handle, {
    phone: `+${phoneOf(0)}`,
    text: "ABCD-EFGH-JK",
    mayBeSignIn: true,
    now: Date.now(),
  });

  expect(result).toEqual({ kind: "none" });
});

test("someone never joined to an archived khatma gets no ended reply", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1, joinedAt: null }]);
  await archiveOf(t, s);

  await send(t, phoneOf(0), "تم");

  expect(sent.map((m) => m.body)).toEqual([helpText]);
});

test("a message from a phone only on archived khatmas opens no window", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  await archiveOf(t, s);
  const phone = `+${phoneOf(0)}`;

  await send(t, phoneOf(0), "تم");
  await send(t, phoneOf(0), "", { media: true });

  expect(await windowOf(t, phone)).toBeNull();
});

test("a window already open isn't refreshed by a phone only on archived khatmas", async () => {
  const t = convexTest(schema, modules);
  const s = await setup(t, [{ slot: 1 }]);
  await archiveOf(t, s);
  const phone = `+${phoneOf(0)}`;
  await t.run((ctx) =>
    ctx.db.insert("waContacts", { phone, lastInboundAt: 1 }),
  );

  await send(t, phoneOf(0), "تم");

  expect((await windowOf(t, phone))?.lastInboundAt).toBe(1);
});

test("a phone with a live khatma too still opens its window", async () => {
  const t = convexTest(schema, modules);
  const phone = "+971500000100";
  const archived = await setup(t, [{ slot: 1, phone }], { joinCode: "OLD234" });
  await setup(t, [{ slot: 1, phone }], {
    joinCode: "NEW234",
    organizerId: archived.personId,
  });
  await archiveOf(t, archived);

  await send(t, phoneOf(0), "تم");

  expect((await windowOf(t, phone))?.lastInboundAt).toBe(Date.now());
});
