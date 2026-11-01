import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { helpText } from "./lib/rotaTemplates";
import schema from "./schema";
import { describeMessage } from "./whatsapp";

const modules = import.meta.glob("./**/*.ts");

const NOW = 1_800_000_000_000;
const TEN_MIN = 600_000;
const PHONE = "971501234567";
const E164 = `+${PHONE}`;
const SITE = "https://wirdak.example";

const NO_MATCH =
  "لم نجد رمز تحقق صالحاً. ارجع إلى وِردك واضغط «تحقّق عبر واتساب» ثم أرسل الرسالة الجاهزة كما هي.";
const MATCHED = `تمّ التحقق ✅ ارجع إلى وِردك لتكمل.\n[ارجع إلى وِردك] ${SITE}`;
/** The PIN template: the body and the copy-code button both carry the PIN. */
const PIN_RE = /^\[wirdak_pin\] (\d{6}) \| \1$/;

type T = TestConvexForDataModel<DataModel>;
type Sent = { to: string; body: string };
let sent: Sent[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("WIRDAK_ENV", "dev");
  vi.stubEnv("WHATSAPP_PUBLIC_NUMBER", "971500000000");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234567890");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-access-token");
  vi.stubEnv("WHATSAPP_APP_SECRET", "test-app-secret");
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "test-verify-token");
  vi.stubEnv("WHATSAPP_GRAPH_VERSION", "v21.0");
  vi.stubEnv("SITE_URL", SITE);
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
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

let msgSeq = 0;

type Started = {
  verificationId: Id<"verifications">;
  secret: string;
  code: string;
  waNumber: string;
  message: string;
};

async function start(
  t: T,
  displayName = "علي",
  clientKey = "client-1",
): Promise<Started> {
  const res = await t.action(internal.verification.startInternal, {
    displayName,
    clientKey,
    ip: "203.0.113.7",
  });
  if ("error" in res) throw new Error(res.error);
  return res;
}

async function send(
  t: T,
  text: string,
  from = PHONE,
  waMessageId = `wamid.${++msgSeq}`,
) {
  await t.action(internal.whatsapp.handleIncoming, {
    waMessageId,
    from,
    text,
  });
}

function status(t: T, v: Started) {
  return t.query(api.verification.status, {
    verificationId: v.verificationId,
    secret: v.secret,
  });
}

function claim(t: T, v: Started, deviceLabel = "iPhone Safari") {
  return t.action(api.verification.claim, {
    verificationId: v.verificationId,
    secret: v.secret,
    deviceLabel,
    timeZone: "Asia/Dubai",
  });
}

function confirmPin(t: T, v: Started, pin: string) {
  return t.action(api.verification.confirmPin, {
    verificationId: v.verificationId,
    secret: v.secret,
    pin,
    deviceLabel: "Android Chrome",
    timeZone: "Asia/Dubai",
  });
}

async function addPerson(t: T, phone = E164, displayName = "سعيد") {
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

/** Inserts a pending verification with a known code. */
async function addPending(t: T, code: string, secret = "known-secret") {
  const secretHash = await sha256Hex(secret);
  const verificationId = await t.run((ctx) =>
    ctx.db.insert("verifications", {
      codeNormalized: code,
      secretHash,
      displayName: "علي",
      status: "pending",
      pinAttempts: 0,
      createdAt: NOW,
      expiresAt: NOW + TEN_MIN,
    }),
  );
  return {
    verificationId,
    secret,
    code,
    waNumber: "",
    message: "",
  } satisfies Started;
}

const sessionCount = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("sessions").collect()).length);

function pinsSent(to = PHONE) {
  return sent
    .filter((s) => s.to === to)
    .map((s) => PIN_RE.exec(s.body)?.[1])
    .filter((p): p is string => p !== undefined);
}

function otherPin(pin: string) {
  return String((Number(pin) + 1) % 1_000_000).padStart(6, "0");
}

test("a button tap never matches a pending sign-in code, whatever its title says", async () => {
  const t = convexTest(schema, modules);
  await addPerson(t);
  const v = await start(t);
  await t.action(internal.whatsapp.handleIncoming, {
    waMessageId: "wamid.tap",
    from: PHONE,
    text: v.message,
    payload: "r1|p|done|d1|p1",
  });
  expect((await status(t, v)).status).toBe("pending");
  // only the rota's answer to a tap it can't place, never a sign-in reply
  expect(sent.map((s) => s.body)).toEqual([helpText]);
  sent = [];

  // the same text typed is a sign-in message and matches
  await send(t, v.message);
  expect((await status(t, v)).status).not.toBe("pending");
});

test("start over HTTP returns a formatted code and the ready-made message", async () => {
  const t = convexTest(schema, modules);
  const res = await t.fetch("/api/verification/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE },
    body: JSON.stringify({ displayName: "  علي  ", clientKey: "c1" }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
  const body = (await res.json()) as Started;
  expect(body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/);
  expect(body.code).not.toMatch(/[IO01]/);
  expect(body.message).toBe(`رمز التحقق في وِردك: ${body.code}`);
  expect(body.waNumber).toBe("971500000000");
  expect(body.secret.length).toBeGreaterThanOrEqual(40);

  const row = await t.run((ctx) => ctx.db.get(body.verificationId));
  expect(row).toMatchObject({
    codeNormalized: body.code.replace(/-/g, ""),
    displayName: "علي",
    status: "pending",
    pinAttempts: 0,
    createdAt: NOW,
    expiresAt: NOW + TEN_MIN,
  });
  // only the hash of the secret is stored
  expect(row!.secretHash).toBe(await sha256Hex(body.secret));
  expect(JSON.stringify(row)).not.toContain(body.secret);
  expect(await status(t, body)).toEqual({
    status: "pending",
    maskedPhone: null,
  });
});

test("start over HTTP: CORS preflight, origins, and error codes", async () => {
  const t = convexTest(schema, modules);
  const pre = await t.fetch("/api/verification/start", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
    },
  });
  expect(pre.status).toBe(204);
  expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(
    "http://localhost:5173",
  );
  expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("POST");

  const evilPre = await t.fetch("/api/verification/start", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example" },
  });
  expect(evilPre.headers.get("Access-Control-Allow-Origin")).toBeNull();
  const evil = await t.fetch("/api/verification/start", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
    body: JSON.stringify({ displayName: "علي", clientKey: "c1" }),
  });
  expect(evil.status).toBe(403);
  expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();

  const post = (body: unknown) =>
    t.fetch("/api/verification/start", {
      method: "POST",
      headers: { Origin: SITE },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const blank = await post({ displayName: "   ", clientKey: "c1" });
  expect(blank.status).toBe(400);
  expect(await blank.json()).toEqual({ error: "invalid_name" });

  const garbage = await post("{not json");
  expect(garbage.status).toBe(400);
  const wrongTypes = await post({ displayName: 1, clientKey: "c1" });
  expect(wrongTypes.status).toBe(400);

  for (let i = 0; i < 5; i++) {
    expect((await post({ displayName: "علي", clientKey: "c2" })).status).toBe(
      200,
    );
  }
  const limited = await post({ displayName: "علي", clientKey: "c2" });
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "rate_limited" });
  expect(limited.headers.get("Access-Control-Allow-Origin")).toBe(SITE);

  await t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "maintenanceMode",
      value: true,
      updatedAt: NOW,
    }),
  );
  const maint = await post({ displayName: "علي", clientKey: "c3" });
  expect(maint.status).toBe(503);
  expect(await maint.json()).toEqual({ error: "maintenance" });
});

test("start over HTTP refuses an oversized Content-Length without reading the body", async () => {
  const t = convexTest(schema, modules);
  let pulled = false;
  // highWaterMark 0: the stream is pulled only when someone reads it
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const res = await t.fetch("/api/verification/start", {
    method: "POST",
    headers: { Origin: SITE, "Content-Length": "1000000" },
    body,
    duplex: "half",
  } as RequestInit);
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "too_large" });
  expect(pulled).toBe(false);
  expect(await t.run((ctx) => ctx.db.query("verifications").collect())).toEqual(
    [],
  );
});

test("start over HTTP stops reading a body that grows past the cap", async () => {
  const t = convexTest(schema, modules);
  const chunk = new TextEncoder().encode("x".repeat(1024));
  let chunksSent = 0;
  // Endless, with no Content-Length: only a byte cap ends the read.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksSent++;
      controller.enqueue(chunk);
    },
  });
  const res = await t.fetch("/api/verification/start", {
    method: "POST",
    headers: { Origin: SITE },
    body,
    duplex: "half",
  } as RequestInit);
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "too_large" });
  // 4 KiB cap: the fifth 1 KiB chunk crosses it (plus whatever the stream buffered ahead)
  expect(chunksSent).toBeLessThan(10);
});

test("the Vite dev origin is allowed only in dev", async () => {
  const t = convexTest(schema, modules);
  const preflight = () =>
    t.fetch("/api/verification/start", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
      },
    });
  const post = () =>
    t.fetch("/api/verification/start", {
      method: "POST",
      headers: { Origin: "http://localhost:5173" },
      body: JSON.stringify({ displayName: "علي", clientKey: "c-dev" }),
    });

  // dev (WIRDAK_ENV=dev from beforeEach)
  expect((await preflight()).headers.get("Access-Control-Allow-Origin")).toBe(
    "http://localhost:5173",
  );
  expect((await post()).status).toBe(200);

  // prod: only SITE_URL is allowed
  vi.stubEnv("WIRDAK_ENV", "prod");
  const pre = await preflight();
  expect(pre.status).toBe(403);
  expect(pre.headers.get("Access-Control-Allow-Origin")).toBeNull();
  const res = await post();
  expect(res.status).toBe(403);
  expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  const site = await t.fetch("/api/verification/start", {
    method: "OPTIONS",
    headers: { Origin: SITE, "Access-Control-Request-Method": "POST" },
  });
  expect(site.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
});

test("startInternal rate-limits per client and per IP", async () => {
  const t = convexTest(schema, modules);
  const go = (clientKey: string, ip: string | null) =>
    t.action(internal.verification.startInternal, {
      displayName: "علي",
      clientKey,
      ip,
    });
  // one client key gets 5 starts per 10 minutes, whatever the IP
  for (let i = 0; i < 5; i++) {
    expect(await go("k-same", `192.0.2.${i}`)).not.toHaveProperty("error");
  }
  expect(await go("k-same", "192.0.2.99")).toEqual({ error: "rate_limited" });
  // a family on one Wi-Fi (or carrier NAT): many people share an IP
  for (let i = 0; i < 30; i++) {
    expect(await go(`k${i}`, "198.51.100.1")).not.toHaveProperty("error");
  }
  // the 31st start from that IP is limited, even with a fresh client key
  expect(await go("k-new", "198.51.100.1")).toEqual({ error: "rate_limited" });
  // another IP is fine
  expect(await go("k-new", "198.51.100.2")).not.toHaveProperty("error");
  // no IP: only the client key counts
  expect(await go("k-other", null)).not.toHaveProperty("error");
  // the window resets after 10 minutes
  // (fake timers tick, so a few windows opened at NOW + 1ms; step past them all)
  vi.setSystemTime(NOW + TEN_MIN + 1_000);
  expect(await go("k-new2", "198.51.100.1")).not.toHaveProperty("error");
});

test("a client refused by its IP's limit keeps its own budget", async () => {
  const t = convexTest(schema, modules);
  const go = (clientKey: string, ip: string) =>
    t.action(internal.verification.startInternal, {
      displayName: "علي",
      clientKey,
      ip,
    });
  // a busy shared IP uses up its 30 starts
  for (let i = 0; i < 30; i++) {
    expect(await go(`k${i}`, "198.51.100.1")).not.toHaveProperty("error");
  }
  // five minutes later someone on that IP retries six times, refused each time
  vi.setSystemTime(NOW + 5 * 60_000);
  for (let i = 0; i < 6; i++) {
    expect(await go("k-retry", "198.51.100.1")).toEqual({
      error: "rate_limited",
    });
  }
  // once the IP window resets, their own five starts are all still there
  vi.setSystemTime(NOW + TEN_MIN + 1_000);
  for (let i = 0; i < 5; i++) {
    expect(await go("k-retry", "198.51.100.1")).not.toHaveProperty("error");
  }
  expect(await go("k-retry", "198.51.100.1")).toEqual({
    error: "rate_limited",
  });
});

test("new number: start → message → matched → claim → session", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t, "أم أحمد");
  await send(t, v.message);

  expect(await status(t, v)).toEqual({
    status: "matched",
    maskedPhone: "+971 50 ••• 4567",
  });
  expect(sent).toEqual([{ to: PHONE, body: MATCHED }]);
  const row = await t.run((ctx) => ctx.db.get(v.verificationId));
  expect(row?.phone).toBe(E164);

  const res = await claim(t, v);
  if (!("sessionToken" in res)) throw new Error(JSON.stringify(res));
  expect(
    await t.query(api.sessions.me, { sessionToken: res.sessionToken }),
  ).toEqual({
    displayName: "أم أحمد",
    maskedPhone: "+971 50 ••• 4567",
    whatsappNotes: false,
  });
  const person = await t.run((ctx) =>
    ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", E164))
      .unique(),
  );
  expect(person).toMatchObject({
    phone: E164,
    displayName: "أم أحمد",
    timeZone: "Asia/Dubai",
  });
  // convex-test advances its transaction clock by a millisecond per transaction
  expect(person!.verifiedAt - NOW).toBeLessThan(1000);
  expect((await status(t, v)).status).toBe("claimed");

  // the sign-in alert carries a working sign-out link
  const alert = sent.at(-1)!;
  expect(alert.to).toBe(PHONE);
  const m =
    /^تمّ إنشاء حساب في وِردك برقمك من iPhone Safari\. إن لم تكن أنت، اضغط «لستُ أنا» لتسجيل الخروج من كل الأجهزة\.\n\[لستُ أنا\] https:\/\/wirdak\.example\/signout\?t=([A-Za-z0-9_-]{43})$/.exec(
      alert.body,
    );
  expect(m).not.toBeNull();
  const session = await t.run((ctx) => ctx.db.query("sessions").unique());
  expect(session?.alertTokenHash).toBe(await sha256Hex(m![1]!));
  expect(session?.tokenHash).toBe(await sha256Hex(res.sessionToken));
  expect(session?.deviceLabel).toBe("iPhone Safari");

  // claiming twice yields no second session
  expect(await claim(t, v)).toEqual({ error: "expired" });
  expect(await sessionCount(t)).toBe(1);
});

test("the matched reply links back to the page the verification started on", async () => {
  const t = convexTest(schema, modules);
  let client = 0;
  const startFrom = async (returnPath: unknown) => {
    const res = await t.fetch("/api/verification/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE },
      body: JSON.stringify({
        displayName: "علي",
        clientKey: `c${++client}`,
        returnPath,
      }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Started;
  };
  const replyFor = async (returnPath: unknown, from: string) => {
    const v = await startFrom(returnPath);
    await send(t, v.message, from);
    return sent.at(-1)!.body;
  };

  expect(await replyFor("/j/AbC-12_x", "971500000001")).toBe(
    `${MATCHED}/j/AbC-12_x`,
  );
  expect(await replyFor("/new", "971500000002")).toBe(`${MATCHED}/new`);

  // Anything that is not a plain same-site path goes to the home page.
  const unsafe = [
    "//evil.example/j/x",
    "/\\evil.example",
    "https://evil.example/",
    "/signout?t=secret",
    "/j/x#frag",
    "j/x",
    "/" + "a".repeat(300),
    42,
    undefined,
  ];
  let n = 10;
  for (const path of unsafe) {
    expect(await replyFor(path, `9715000000${n++}`)).toBe(MATCHED);
  }
});

test("existing number needs the PIN from the WhatsApp reply", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t);
  const v = await start(t);
  await send(t, v.message);

  expect(await status(t, v)).toEqual({
    status: "needs_pin",
    maskedPhone: "+971 50 ••• 4567",
  });
  const pins = pinsSent();
  expect(pins).toHaveLength(1);
  const pin = pins[0]!;
  const row = await t.run((ctx) => ctx.db.get(v.verificationId));
  expect(row).toMatchObject({
    status: "needs_pin",
    phone: E164,
    existingPersonId: personId,
    pinAttempts: 0,
  });
  expect(row!.expiresAt - (NOW + TEN_MIN)).toBeLessThan(1000);
  expect(row!.pinHash).not.toContain(pin);

  // claim never attaches to an existing person without the PIN
  expect(await claim(t, v)).toEqual({ error: "needs_pin" });
  expect(await sessionCount(t)).toBe(0);

  expect(await confirmPin(t, v, otherPin(pin))).toEqual({
    error: "wrong_pin",
  });
  const res = await confirmPin(t, v, pin);
  if (!("sessionToken" in res)) throw new Error(JSON.stringify(res));
  expect(res.otherSessions).toBe(0);
  const session = await t.run((ctx) => ctx.db.query("sessions").unique());
  expect(session?.personId).toBe(personId);
  expect(
    await t.query(api.sessions.me, { sessionToken: res.sessionToken }),
  ).toEqual({
    displayName: "سعيد",
    maskedPhone: "+971 50 ••• 4567",
    whatsappNotes: false,
  });
  // no second person for the same phone
  expect(
    await t.run(async (ctx) => (await ctx.db.query("people").collect()).length),
  ).toBe(1);
  // an existing account gets the normal sign-in alert, not the new-account one
  expect(sent.at(-1)!.body).toMatch(
    /^تسجيل دخول جديد إلى وِردك من Android Chrome\. إن لم تكن أنت، اضغط «لستُ أنا» لتسجيل الخروج من الأجهزة الأخرى\.\n\[لستُ أنا\] https:\/\/wirdak\.example\/signout\?t=[A-Za-z0-9_-]{43}$/,
  );
  // the PIN is single use
  expect(await confirmPin(t, v, pin)).toEqual({ error: "expired" });
});

async function switchSignInAlertOff(t: T) {
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "signInAlertOn",
      value: false,
      updatedAt: NOW,
    }),
  );
}

const alertsSent = () => sent.filter((m) => m.body.includes("لستُ أنا"));

test("switched off in the admin settings, a new account gets no alert", async () => {
  const t = convexTest(schema, modules);
  await switchSignInAlertOff(t);
  const v = await start(t);
  await send(t, v.message);

  expect(await claim(t, v)).toHaveProperty("sessionToken");

  expect(alertsSent()).toEqual([]);
});

test("switched off in the admin settings, a PIN sign-in gets no alert", async () => {
  const t = convexTest(schema, modules);
  await switchSignInAlertOff(t);
  await addPerson(t);
  const v = await start(t);
  await send(t, v.message);

  expect(await confirmPin(t, v, pinsSent()[0]!)).toHaveProperty("sessionToken");

  expect(alertsSent()).toEqual([]);
});

test("PIN accepts Arabic-Indic digits and surrounding spaces", async () => {
  const t = convexTest(schema, modules);
  await addPerson(t);
  const v = await start(t);
  await send(t, v.message);
  const pin = pinsSent()[0]!;
  const arabic = pin.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
  const res = await confirmPin(t, v, ` ${arabic} `);
  expect(res).toHaveProperty("sessionToken");
});

test("PIN ignores whitespace inside it", async () => {
  const t = convexTest(schema, modules);
  await addPerson(t);
  const v = await start(t);
  await send(t, v.message);
  const pin = pinsSent()[0]!;
  const spaced = `${pin.slice(0, 3)} ${pin.slice(3)}`; // "123 456"
  expect(await confirmPin(t, v, spaced)).toHaveProperty("sessionToken");

  const v2 = await start(t, "سعيد", "client-2");
  await send(t, v2.message);
  const pin2 = pinsSent()[1]!;
  const messy = `\t${pin2.slice(0, 2)} ${pin2.slice(2, 4)}\u00A0${pin2.slice(4)}\n`;
  expect(await confirmPin(t, v2, messy)).toHaveProperty("sessionToken");
});

test("confirmPin reports how many other sessions the account has", async () => {
  const t = convexTest(schema, modules);
  const personId = await addPerson(t);
  for (const n of [1, 2]) {
    await t.mutation(internal.sessions.create, {
      personId,
      tokenHash: await sha256Hex(`old-${n}`),
      alertTokenHash: await sha256Hex(`old-alert-${n}`),
      deviceLabel: `old ${n}`,
    });
  }
  // another person's sessions don't count
  const other = await addPerson(t, "+971509999999", "خالد");
  await t.mutation(internal.sessions.create, {
    personId: other,
    tokenHash: await sha256Hex("other"),
    alertTokenHash: await sha256Hex("other-alert"),
    deviceLabel: "other",
  });
  const v = await start(t);
  await send(t, v.message);
  const res = await confirmPin(t, v, pinsSent()[0]!);
  expect(res).toEqual({ sessionToken: expect.any(String), otherSessions: 2 });
});

test("a forwarded link on a new number: the owner learns an account was created", async () => {
  const t = convexTest(schema, modules);
  // attacker starts, victim (no account yet) sends the forwarded message
  const attacker = await start(t, "مهاجم", "attacker");
  await send(t, attacker.message);
  expect(await claim(t, attacker)).toHaveProperty("sessionToken");
  const createdAlert = sent.at(-1)!;
  expect(createdAlert.to).toBe(PHONE);
  expect(createdAlert.body).toMatch(
    /^تمّ إنشاء حساب في وِردك برقمك من iPhone Safari\. إن لم تكن أنت، اضغط «لستُ أنا» لتسجيل الخروج من كل الأجهزة\.\n\[لستُ أنا\] https:\/\/wirdak\.example\/signout\?t=[A-Za-z0-9_-]{43}$/,
  );

  // the real owner later signs in with the PIN and is told about the other session
  const owner = await start(t, "صاحب الرقم", "owner");
  await send(t, owner.message);
  const res = await confirmPin(t, owner, pinsSent()[0]!);
  expect(res).toEqual({ sessionToken: expect.any(String), otherSessions: 1 });
});

test("five wrong PINs lock the verification", async () => {
  const t = convexTest(schema, modules);
  await addPerson(t);
  const v = await start(t);
  await send(t, v.message);
  const pin = pinsSent()[0]!;
  for (let i = 0; i < 5; i++) {
    expect(await confirmPin(t, v, otherPin(pin))).toEqual({
      error: "wrong_pin",
    });
  }
  expect(await confirmPin(t, v, otherPin(pin))).toEqual({
    error: "too_many_attempts",
  });
  // even the right PIN no longer works
  expect(await confirmPin(t, v, pin)).toEqual({ error: "too_many_attempts" });
  expect(await sessionCount(t)).toBe(0);
});

test("confirmPin checks expiry first", async () => {
  const t = convexTest(schema, modules);
  await addPerson(t);
  const v = await start(t);
  await send(t, v.message);
  const pin = pinsSent()[0]!;
  vi.setSystemTime(NOW + TEN_MIN + 1);
  expect(await confirmPin(t, v, pin)).toEqual({ error: "expired" });
  expect(await sessionCount(t)).toBe(0);
});

test("duplicate webhook delivery is ignored", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  await send(t, v.message, PHONE, "wamid.dup");
  const before = await t.run((ctx) => ctx.db.get(v.verificationId));
  await send(t, v.message, PHONE, "wamid.dup");
  const after = await t.run((ctx) => ctx.db.get(v.verificationId));
  expect(after).toEqual(before);
  expect(sent).toEqual([{ to: PHONE, body: MATCHED }]);

  // a duplicate of a no-match message gets no second reply either
  await send(t, "hello", PHONE, "wamid.dup2");
  await send(t, "hello", PHONE, "wamid.dup2");
  expect(sent.filter((s) => s.body === NO_MATCH)).toHaveLength(1);
});

test("messy text still matches", async () => {
  const t = convexTest(schema, modules);
  const v = await addPending(t, "K7Q29XMB4T");
  await send(t, "تفضل k7q2 9xmb 4t شكراً");
  expect((await status(t, v)).status).toBe("matched");
  expect(sent).toEqual([{ to: PHONE, body: MATCHED }]);
});

test("Arabic-Indic digits and extra Latin words still match", async () => {
  const t = convexTest(schema, modules);
  const v = await addPending(t, "K7Q29XMB4T");
  await send(t, "Hello salam: K٧Q٢-٩XMB-٤T thanks", "971509999999");
  expect(await status(t, v)).toEqual({
    status: "matched",
    maskedPhone: "+971 50 ••• 9999",
  });
});

test("a message with no code gets one polite reply", async () => {
  const t = convexTest(schema, modules);
  const v = await addPending(t, "K7Q29XMB4T");
  await send(t, "السلام عليكم");
  await send(t, "K7Q2-9XMB-4"); // one character short
  expect(sent).toEqual([
    { to: PHONE, body: NO_MATCH },
    { to: PHONE, body: NO_MATCH },
  ]);
  expect((await status(t, v)).status).toBe("pending");
});

test("a message matches only its own verification", async () => {
  const t = convexTest(schema, modules);
  const a = await addPending(t, "AAAA2222BB", "secret-a");
  const b = await addPending(t, "CCCC3333DD", "secret-b");
  await send(t, "رمز التحقق في وِردك: AAAA-2222-BB");
  expect((await status(t, a)).status).toBe("matched");
  expect((await status(t, b)).status).toBe("pending");
});

test("a code matches only once", async () => {
  const t = convexTest(schema, modules);
  const v = await addPending(t, "K7Q29XMB4T");
  await send(t, "K7Q2-9XMB-4T");
  await send(t, "K7Q2-9XMB-4T", "971509999999");
  const row = await t.run((ctx) => ctx.db.get(v.verificationId));
  expect(row?.phone).toBe(E164);
  expect(sent.at(-1)).toEqual({ to: "971509999999", body: NO_MATCH });
});

test("expired codes don't match", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  vi.setSystemTime(NOW + TEN_MIN + 1);
  await send(t, v.message);
  expect(sent).toEqual([{ to: PHONE, body: NO_MATCH }]);
  const row = await t.run((ctx) => ctx.db.get(v.verificationId));
  expect(row?.phone).toBeUndefined();
  expect((await status(t, v)).status).toBe("expired");
});

test("status leaks nothing for a wrong secret", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  await send(t, v.message);
  expect(
    await t.query(api.verification.status, {
      verificationId: v.verificationId,
      secret: "wrong",
    }),
  ).toEqual({ status: "expired", maskedPhone: null });
  expect(
    await t.query(api.verification.status, {
      verificationId: v.verificationId,
      secret: "",
    }),
  ).toEqual({ status: "expired", maskedPhone: null });
  // claim / reject / confirmPin with a wrong secret do nothing
  expect(
    await t.action(api.verification.claim, {
      verificationId: v.verificationId,
      secret: "wrong",
      deviceLabel: "x",
      timeZone: "Asia/Dubai",
    }),
  ).toEqual({ error: "expired" });
  await t.mutation(api.verification.reject, {
    verificationId: v.verificationId,
    secret: "wrong",
  });
  expect((await status(t, v)).status).toBe("matched");
  expect(await sessionCount(t)).toBe(0);
});

test("reject marks the verification rejected and claim then fails", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  await send(t, v.message);
  await t.mutation(api.verification.reject, {
    verificationId: v.verificationId,
    secret: v.secret,
  });
  expect(await status(t, v)).toEqual({ status: "rejected", maskedPhone: null });
  expect(await claim(t, v)).toEqual({ error: "expired" });
  expect(await sessionCount(t)).toBe(0);
  expect(await t.run((ctx) => ctx.db.query("people").collect())).toEqual([]);
});

test("a stale matched verification cannot sign in to an account created later", async () => {
  const t = convexTest(schema, modules);
  const v1 = await start(t, "مهاجم", "attacker");
  await send(t, v1.message);
  expect((await status(t, v1)).status).toBe("matched");

  const v2 = await start(t, "صاحب الرقم", "owner");
  await send(t, v2.message);
  const ok = await claim(t, v2);
  expect(ok).toHaveProperty("sessionToken");
  expect(await sessionCount(t)).toBe(1);

  const before = pinsSent().length;
  expect(await claim(t, v1)).toEqual({ error: "needs_pin" });
  expect(pinsSent()).toHaveLength(before + 1);
  expect(await sessionCount(t)).toBe(1);
  expect(
    await t.run(async (ctx) => (await ctx.db.query("people").collect()).length),
  ).toBe(1);
  expect((await status(t, v1)).status).toBe("needs_pin");
});

test("concurrent claims of one verification create at most one session", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  await send(t, v.message);
  const results = await Promise.all([claim(t, v), claim(t, v), claim(t, v)]);
  expect(results.filter((r) => "sessionToken" in r)).toHaveLength(1);
  expect(await sessionCount(t)).toBe(1);
  expect(
    await t.run(async (ctx) => (await ctx.db.query("people").collect()).length),
  ).toBe(1);
});

test("claim after expiry fails", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  await send(t, v.message);
  const { expiresAt } = (await t.run((ctx) => ctx.db.get(v.verificationId)))!;
  vi.setSystemTime(expiresAt);
  expect(await claim(t, v)).toEqual({ error: "expired" });
  expect(await sessionCount(t)).toBe(0);
});

test("a message at 9m59s still leaves about ten minutes to claim", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  vi.advanceTimersByTime(TEN_MIN - 1000);
  await send(t, v.message);
  const row = (await t.run((ctx) => ctx.db.get(v.verificationId)))!;
  expect(row.status).toBe("matched");
  expect(row.expiresAt - (NOW + TEN_MIN - 1000 + TEN_MIN)).toBeLessThan(1000);
  expect(row.expiresAt).toBeGreaterThanOrEqual(NOW + TEN_MIN - 1000 + TEN_MIN);

  // the original timer fires at +10 min and must not expire it
  vi.advanceTimersByTime(1000);
  await t.finishInProgressScheduledFunctions();
  expect((await status(t, v)).status).toBe("matched");

  // 9 minutes after the message it can still be claimed
  vi.advanceTimersByTime(9 * 60_000);
  await t.finishInProgressScheduledFunctions();
  expect(await claim(t, v)).toHaveProperty("sessionToken");
});

test("a matched verification left unclaimed expires on the fresh timer", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  vi.advanceTimersByTime(5 * 60_000);
  await send(t, v.message);
  const { expiresAt } = (await t.run((ctx) => ctx.db.get(v.verificationId)))!;
  vi.advanceTimersByTime(expiresAt - Date.now() - 1);
  await t.finishInProgressScheduledFunctions();
  expect((await t.run((ctx) => ctx.db.get(v.verificationId)))!.status).toBe(
    "matched",
  );
  vi.advanceTimersByTime(1);
  await t.finishInProgressScheduledFunctions();
  expect((await t.run((ctx) => ctx.db.get(v.verificationId)))!.status).toBe(
    "expired",
  );
});

test("an unanswered verification becomes expired on time", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  vi.advanceTimersByTime(TEN_MIN - 1);
  await t.finishInProgressScheduledFunctions();
  expect((await t.run((ctx) => ctx.db.get(v.verificationId)))?.status).toBe(
    "pending",
  );
  vi.advanceTimersByTime(1);
  await t.finishInProgressScheduledFunctions();
  expect((await t.run((ctx) => ctx.db.get(v.verificationId)))?.status).toBe(
    "expired",
  );
  expect(await status(t, v)).toEqual({ status: "expired", maskedPhone: null });
});

test("needs_pin gets a fresh expiry that the old timer doesn't cut short", async () => {
  const t = convexTest(schema, modules);
  await addPerson(t);
  const v = await start(t);
  vi.advanceTimersByTime(5 * 60_000);
  await send(t, v.message);
  const row = await t.run((ctx) => ctx.db.get(v.verificationId));
  expect(row?.expiresAt).toBe(NOW + 5 * 60_000 + TEN_MIN);
  // the original timer fires at +10 min but the PIN is still valid
  vi.advanceTimersByTime(5 * 60_000);
  await t.finishInProgressScheduledFunctions();
  expect((await status(t, v)).status).toBe("needs_pin");
  // the fresh timer fires at +15 min
  vi.advanceTimersByTime(5 * 60_000);
  await t.finishInProgressScheduledFunctions();
  expect((await t.run((ctx) => ctx.db.get(v.verificationId)))?.status).toBe(
    "expired",
  );
});

test("concurrent redelivery sends one PIN", async () => {
  const t = convexTest(schema, modules);
  await addPerson(t);
  const v = await start(t);
  await Promise.all([
    send(t, v.message, PHONE, "wamid.same"),
    send(t, v.message, PHONE, "wamid.same"),
  ]);
  expect(sent).toHaveLength(1);
  expect(pinsSent()).toHaveLength(1);
});

test("two different messages racing for one code send one reply that matters", async () => {
  const t = convexTest(schema, modules);
  await addPerson(t);
  const v = await start(t);
  await Promise.all([
    send(t, v.message, PHONE, "wamid.x"),
    send(t, v.message, PHONE, "wamid.y"),
  ]);
  // exactly one PIN; the loser sees no pending code
  expect(pinsSent()).toHaveLength(1);
  expect(sent.filter((s) => s.body === NO_MATCH)).toHaveLength(1);
  expect((await status(t, v)).status).toBe("needs_pin");
});

test("messages from one phone are rate-limited without replies", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 12; i++) await send(t, "hello");
  expect(sent).toHaveLength(10);
});

test("prod without WhatsApp config refuses to start", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WIRDAK_ENV", "prod");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
  expect(
    await t.action(internal.verification.startInternal, {
      displayName: "علي",
      clientKey: "c1",
      ip: null,
    }),
  ).toEqual({ error: "whatsapp_not_configured" });
  expect(await t.run((ctx) => ctx.db.query("verifications").collect())).toEqual(
    [],
  );

  const res = await t.fetch("/api/verification/start", {
    method: "POST",
    headers: { Origin: SITE },
    body: JSON.stringify({ displayName: "علي", clientKey: "c1" }),
  });
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "whatsapp_not_configured" });

  // fully configured prod starts fine
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-access-token");
  expect(
    await t.action(internal.verification.startInternal, {
      displayName: "علي",
      clientKey: "c1",
      ip: null,
    }),
  ).not.toHaveProperty("error");
});

test("simulateIncoming in dev runs the real handler", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  await t.action(internal.dev.simulateIncoming, {
    from: PHONE,
    text: v.message,
  });
  expect((await status(t, v)).status).toBe("matched");
});

test("device labels are sanitized before reaching the WhatsApp alert", async () => {
  const t = convexTest(schema, modules);
  const v = await start(t);
  await send(t, v.message);
  const res = await claim(
    t,
    v,
    "Chrome\u202E https://evil.example/x?y=1 " + "z".repeat(100),
  );
  expect(res).toHaveProperty("sessionToken");
  const session = await t.run((ctx) => ctx.db.query("sessions").unique());
  expect(session!.deviceLabel).not.toMatch(/[:/?=.\u202E]/);
  expect(Array.from(session!.deviceLabel).length).toBeLessThanOrEqual(40);
  expect(sent.at(-1)!.body).not.toContain("evil.example");
});

// ---------------------------------------------------------------------------
// Staging shares production's number: production relays what it can't match

const STAGING_SITE = "https://stg.wirdak.example";
const RELAY_URL = "https://staging.example.convex.site/whatsapp/relay";

/**
 * Two deployments in one test: `prod` is the one Meta calls (the env from
 * `beforeEach` plus the relay target), `stg` holds only the relay secret.
 * `process.env` is global, so staging's env is swapped in around every call
 * into `stg`. Relay calls reach `stg` unless `relayDown` is set, and every
 * Graph API send is recorded in `sentBy` with the deployment that made it.
 */
function twoDeployments(opts: { relayDown?: boolean } = {}) {
  vi.stubEnv("WHATSAPP_RELAY_URL", RELAY_URL);
  vi.stubEnv("WHATSAPP_RELAY_SECRET", "test-relay-secret-0123456789abcdef");
  const prod = convexTest(schema, modules);
  const stg = convexTest(schema, modules);
  const sentBy: { from: "prod" | "stg"; to: string; body: string }[] = [];
  let inStaging = false;
  const asStaging = async <R>(fn: () => Promise<R>): Promise<R> => {
    const saved = { ...process.env };
    vi.stubEnv("WIRDAK_ENV", "staging");
    vi.stubEnv("SITE_URL", STAGING_SITE);
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
    vi.stubEnv("WHATSAPP_RELAY_URL", "");
    inStaging = true;
    try {
      return await fn();
    } finally {
      inStaging = false;
      for (const name of [
        "WIRDAK_ENV",
        "SITE_URL",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_VERIFY_TOKEN",
        "WHATSAPP_RELAY_URL",
      ]) {
        vi.stubEnv(name, saved[name] ?? "");
      }
    }
  };
  const relayCalls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === RELAY_URL) {
        relayCalls.push(String(init.body));
        if (opts.relayDown) throw new TypeError("fetch failed");
        return await asStaging(() => stg.fetch("/whatsapp/relay", init));
      }
      const payload = JSON.parse(String(init.body)) as { to: string };
      sentBy.push({
        from: inStaging ? "stg" : "prod",
        to: payload.to,
        body: describeMessage(payload),
      });
      return new Response("{}", { status: 200 });
    }),
  );
  return { prod, stg, asStaging, sentBy, relayCalls };
}

test("a code started on staging gets exactly one reply, from staging, linking to staging", async () => {
  const { prod, stg, asStaging, sentBy } = twoDeployments();
  const v = await asStaging(async () => {
    const res = await stg.action(internal.verification.startInternal, {
      displayName: "علي",
      clientKey: "client-1",
      ip: null,
      returnPath: "/j/AbC-12_x",
    });
    if ("error" in res) throw new Error(res.error);
    return res;
  });

  // Meta delivers the message to production, which has no such code.
  await send(prod, v.message);

  expect(sentBy).toEqual([
    {
      from: "stg",
      to: PHONE,
      body: `تمّ التحقق ✅ ارجع إلى وِردك لتكمل.\n[ارجع إلى وِردك] ${STAGING_SITE}/j/AbC-12_x`,
    },
  ]);
  expect(await asStaging(() => status(stg, v))).toEqual({
    status: "matched",
    maskedPhone: "+971 50 ••• 4567",
  });
  expect(
    await prod.run((ctx) => ctx.db.query("verifications").collect()),
  ).toEqual([]);

  // The sign-in finishes on staging, and its alert links to staging too.
  const res = await asStaging(() => claim(stg, v));
  expect(res).toHaveProperty("sessionToken");
  expect(sentBy.at(-1)).toMatchObject({ from: "stg", to: PHONE });
  expect(sentBy.at(-1)!.body).toContain(`${STAGING_SITE}/signout?t=`);
});

test("a staging code for an existing staging account gets staging's PIN only", async () => {
  const { prod, stg, asStaging, sentBy } = twoDeployments();
  await asStaging(() => addPerson(stg));
  const v = await asStaging(() => addPending(stg, "K7Q29XMB4T"));
  await send(prod, "رمز التحقق في وِردك: K7Q2-9XMB-4T");
  expect(sentBy).toHaveLength(1);
  expect(sentBy[0]).toMatchObject({ from: "stg", to: PHONE });
  const pin = PIN_RE.exec(sentBy[0]!.body)?.[1];
  expect(pin).toBeDefined();
  // sent inline, so the PIN never sits in staging's scheduled-function args
  const jobs = await asStaging(() =>
    stg.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  );
  expect(JSON.stringify(jobs.map((j) => j.args))).not.toContain(pin!);
  expect(await asStaging(() => confirmPin(stg, v, pin!))).toHaveProperty(
    "sessionToken",
  );
});

test("a production code is answered by production and never relayed", async () => {
  const { prod, sentBy, relayCalls } = twoDeployments();
  const v = await start(prod);
  await send(prod, v.message);
  expect(relayCalls).toEqual([]);
  expect(sentBy).toEqual([{ from: "prod", to: PHONE, body: MATCHED }]);
});

test("a code neither deployment has gets one no-match reply, from production", async () => {
  const { prod, stg, asStaging, sentBy, relayCalls } = twoDeployments();
  await send(prod, "رمز التحقق في وِردك: ZZZZ-2222-ZZ");
  expect(relayCalls).toHaveLength(1);
  expect(sentBy).toEqual([{ from: "prod", to: PHONE, body: NO_MATCH }]);
  // staging recorded the message id, nothing else
  expect(
    await asStaging(() =>
      stg.run((ctx) => ctx.db.query("verifications").collect()),
    ),
  ).toEqual([]);
});

test("a message with no code shape is answered by production without a relay", async () => {
  const { prod, sentBy, relayCalls } = twoDeployments();
  await send(prod, "السلام عليكم");
  await send(prod, "K7Q2-9XMB-4"); // one character short
  expect(relayCalls).toEqual([]);
  expect(sentBy.map((s) => [s.from, s.body])).toEqual([
    ["prod", NO_MATCH],
    ["prod", NO_MATCH],
  ]);
});

test("with staging unreachable production still answers once", async () => {
  const { prod, stg, asStaging, sentBy, relayCalls } = twoDeployments({
    relayDown: true,
  });
  const v = await asStaging(() => addPending(stg, "K7Q29XMB4T"));
  await send(prod, "K7Q2-9XMB-4T");
  expect(relayCalls).toHaveLength(1);
  expect(sentBy).toEqual([{ from: "prod", to: PHONE, body: NO_MATCH }]);
  expect((await asStaging(() => status(stg, v))).status).toBe("pending");
});

test("a rate-limited phone is neither relayed nor answered", async () => {
  const { prod, sentBy, relayCalls } = twoDeployments();
  // Production's own per-phone limit (10 an hour) stops relaying first.
  for (let i = 0; i < 12; i++) {
    await send(prod, `رمز التحقق في وِردك: ZZZZ-2222-Z${i % 2 ? "Y" : "Z"}`);
  }
  expect(relayCalls).toHaveLength(10);
  expect(sentBy).toHaveLength(10);
  expect(sentBy.every((s) => s.from === "prod" && s.body === NO_MATCH)).toBe(
    true,
  );
});

test("sign-ins are counted per Dubai day: started, then completed", async () => {
  const t = convexTest(schema, modules);
  const { dubaiDay, readCounter } = await import("./lib/stats");
  const v = await start(t);
  await send(t, v.message);
  expect(await claim(t, v)).toHaveProperty("sessionToken");
  const day = dubaiDay(Date.now());
  await t.run(async (ctx) => {
    expect(await readCounter(ctx, `signin:${day}:started`)).toBe(1);
    expect(await readCounter(ctx, `signin:${day}:completed`)).toBe(1);
  });
});

test("admin sign-ins aren't counted with members'", async () => {
  const t = convexTest(schema, modules);
  const { dubaiDay, readCounter } = await import("./lib/stats");
  await t.mutation(internal.verification.createPending, {
    candidates: ["ABCDEFGH23"],
    secretHash: "h",
    displayName: "",
    clientKey: "c",
    ip: null,
    returnPath: "/",
    surface: "admin",
  });
  await t.run(async (ctx) => {
    expect(
      await readCounter(ctx, `signin:${dubaiDay(Date.now())}:started`),
    ).toBe(0);
  });
});

test("a blocked number gets 'no code found' and the code stays unused", async () => {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      phone: "+971500000099",
      addedBy: null,
      addedAt: 0,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("blockedPhones", {
      phone: E164,
      blockedBy: adminId,
      at: NOW,
      note: null,
    }),
  );
  const v = await start(t);
  await send(t, v.message);
  expect(sent.map((s) => s.body)).toEqual([NO_MATCH]);
  expect((await status(t, v)).status).toBe("pending");
});
