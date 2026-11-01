import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { ADMIN_SESSION_TTL_MS } from "./lib/adminSession";
import { sha256Hex } from "./lib/crypto";
import schema from "./schema";
import { describeMessage } from "./whatsapp";

const modules = import.meta.glob("./**/*.ts");

const NOW = 1_800_000_000_000;
const ADMIN_SITE = "https://admin.wirdak.example";
const ADMIN_PHONE = "971500000001";
const SECRET = "known-secret";

/** Admin and member PINs both go out as the PIN template. */
const ADMIN_PIN_RE = /^\[wirdak_pin\] (\d{6}) \| \1$/;
const ALERT_RE = new RegExp(
  `^تسجيل دخول إلى لوحة إدارة وِردك من iPhone Safari\\. إن لم تكن أنت، اضغط «لستُ أنا» لإنهاء كل جلسات الإدارة\\.\\n\\[لستُ أنا\\] ${ADMIN_SITE.replace(/\./g, "\\.")}/signout\\?t=([A-Za-z0-9_-]+)$`,
);

type T = TestConvexForDataModel<DataModel>;
type Sent = { to: string; body: string };
let sent: Sent[];
let seq = 0;

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
  vi.stubEnv("SITE_URL", "https://wirdak.example");
  vi.stubEnv("ADMIN_SITE_URL", ADMIN_SITE);
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

async function addAdmin(t: T, phone = `+${ADMIN_PHONE}`) {
  return await t.run((ctx) =>
    ctx.db.insert("admins", { phone, addedBy: null, addedAt: NOW }),
  );
}

/**
 * An admin verification that reached the code step from `from`, through the
 * real WhatsApp path. Returns its id and the PIN that was sent.
 */
async function adminAtPin(t: T, from = ADMIN_PHONE, admin = true) {
  const code = `ABCDEFGH${"23456789"[seq % 8]}${"23456789"[Math.floor(seq / 8) % 8]}`;
  seq++;
  const secretHash = await sha256Hex(SECRET);
  const verificationId = await t.run((ctx) =>
    ctx.db.insert("verifications", {
      codeNormalized: code,
      secretHash,
      displayName: admin ? "" : "علي",
      status: "pending",
      pinAttempts: 0,
      ...(admin ? { surface: "admin" as const } : {}),
      createdAt: NOW,
      expiresAt: NOW + 600_000,
    }),
  );
  const before = sent.length;
  await t.action(internal.whatsapp.handleIncoming, {
    waMessageId: `wamid.auth.${seq}`,
    from,
    text: code,
  });
  const body = sent[before]?.body ?? "";
  const pin = ADMIN_PIN_RE.exec(body)?.[1] ?? "";
  return { verificationId, pin };
}

function confirm(t: T, verificationId: Id<"verifications">, pin: string) {
  return t.action(api.adminAuth.confirmPin, {
    verificationId,
    secret: SECRET,
    pin,
    deviceLabel: "iPhone Safari",
  });
}

test("an allowlisted admin signs in with the code and gets a 12-hour session", async () => {
  const t = convexTest(schema, modules);
  const adminId = await addAdmin(t);
  const { verificationId, pin } = await adminAtPin(t);

  const res = await confirm(t, verificationId, pin);
  if (!("adminToken" in res)) throw new Error(JSON.stringify(res));

  const [session] = await t.run((ctx) =>
    ctx.db.query("adminSessions").collect(),
  );
  expect(session?.expiresAt).toBe(
    (session?.createdAt ?? 0) + ADMIN_SESSION_TTL_MS,
  );
  expect(
    await t.query(api.adminAuth.me, { adminToken: res.adminToken }),
  ).toEqual({
    adminId,
    phone: `+${ADMIN_PHONE}`,
    expiresAt: session?.expiresAt,
  });
  expect(sent.at(-1)?.body).toMatch(ALERT_RE);
  const doc = await t.run((ctx) => ctx.db.get(verificationId));
  expect(doc?.status).toBe("claimed");
  expect(await t.run((ctx) => ctx.db.query("sessions").collect())).toHaveLength(
    0,
  );
});

test("switching off the member sign-in alert leaves the admin alert on", async () => {
  const t = convexTest(schema, modules);
  await addAdmin(t);
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      key: "signInAlertOn",
      value: false,
      updatedAt: NOW,
    }),
  );
  const { verificationId, pin } = await adminAtPin(t);

  expect(await confirm(t, verificationId, pin)).toHaveProperty("adminToken");

  expect(sent.at(-1)?.body).toMatch(ALERT_RE);
});

test("a wrong code counts attempts, then locks", async () => {
  const t = convexTest(schema, modules);
  await addAdmin(t);
  const { verificationId, pin } = await adminAtPin(t);
  const wrong = pin === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) {
    expect(await confirm(t, verificationId, wrong)).toEqual({
      error: "wrong_pin",
    });
  }
  expect(await confirm(t, verificationId, pin)).toEqual({
    error: "too_many_attempts",
  });
});

test("the right code from a number off the allowlist opens nothing", async () => {
  const t = convexTest(schema, modules);
  await addAdmin(t);
  const { verificationId, pin } = await adminAtPin(t, "971500000002");
  expect(
    await confirm(t, verificationId, "000000" === pin ? "111111" : "000000"),
  ).toEqual({ error: "wrong_pin" });
  expect(await confirm(t, verificationId, pin)).toEqual({ error: "expired" });
  expect(
    await t.run((ctx) => ctx.db.query("adminSessions").collect()),
  ).toHaveLength(0);
});

test("a website verification can't be confirmed as an admin", async () => {
  const t = convexTest(schema, modules);
  await addAdmin(t);
  await t.run((ctx) =>
    ctx.db.insert("people", {
      phone: `+${ADMIN_PHONE}`,
      displayName: "علي",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    }),
  );
  const { verificationId, pin } = await adminAtPin(t, ADMIN_PHONE, false);
  expect(pin).toMatch(/^\d{6}$/);
  expect(await confirm(t, verificationId, pin)).toEqual({ error: "expired" });
  expect(
    await t.run((ctx) => ctx.db.query("adminSessions").collect()),
  ).toHaveLength(0);
});

test("an admin removed before confirming gets expired", async () => {
  const t = convexTest(schema, modules);
  const adminId = await addAdmin(t);
  const { verificationId, pin } = await adminAtPin(t);
  await t.run((ctx) => ctx.db.delete(adminId));
  expect(await confirm(t, verificationId, pin)).toEqual({ error: "expired" });
});

test("the session ends after 12 hours", async () => {
  const t = convexTest(schema, modules);
  await addAdmin(t);
  const { verificationId, pin } = await adminAtPin(t);
  const res = await confirm(t, verificationId, pin);
  if (!("adminToken" in res)) throw new Error(JSON.stringify(res));
  const [session] = await t.run((ctx) =>
    ctx.db.query("adminSessions").collect(),
  );
  vi.setSystemTime(session?.expiresAt ?? 0);
  expect(
    await t.query(api.adminAuth.me, { adminToken: res.adminToken }),
  ).toBeNull();
  await expect(
    t.query(api.admins.list, { adminToken: res.adminToken }),
  ).rejects.toThrow(/not_admin/);
});

test("signOut ends only the caller's session", async () => {
  const t = convexTest(schema, modules);
  await addAdmin(t);
  const a = await adminAtPin(t);
  const first = await confirm(t, a.verificationId, a.pin);
  const b = await adminAtPin(t);
  const second = await confirm(t, b.verificationId, b.pin);
  if (!("adminToken" in first) || !("adminToken" in second)) throw new Error();

  await t.mutation(api.adminAuth.signOut, { adminToken: first.adminToken });
  expect(
    await t.query(api.adminAuth.me, { adminToken: first.adminToken }),
  ).toBeNull();
  expect(
    await t.query(api.adminAuth.me, { adminToken: second.adminToken }),
  ).not.toBeNull();
});

test("the alert link ends every session of that admin and no one else's", async () => {
  const t = convexTest(schema, modules);
  await addAdmin(t);
  const sara = await addAdmin(t, "+971500000003");
  const a = await adminAtPin(t);
  const first = await confirm(t, a.verificationId, a.pin);
  const alertToken = ALERT_RE.exec(sent.at(-1)?.body ?? "")?.[1] ?? "";
  const b = await adminAtPin(t);
  const second = await confirm(t, b.verificationId, b.pin);
  const s = await adminAtPin(t, "971500000003");
  const saras = await confirm(t, s.verificationId, s.pin);
  if (
    !("adminToken" in first) ||
    !("adminToken" in second) ||
    !("adminToken" in saras)
  ) {
    throw new Error();
  }

  expect(
    await t.mutation(api.adminAuth.signOutByAlertToken, { alertToken }),
  ).toEqual({ ok: true });
  expect(
    await t.query(api.adminAuth.me, { adminToken: first.adminToken }),
  ).toBeNull();
  expect(
    await t.query(api.adminAuth.me, { adminToken: second.adminToken }),
  ).toBeNull();
  expect(
    await t.query(api.adminAuth.me, { adminToken: saras.adminToken }),
  ).toMatchObject({
    adminId: sara,
  });
  expect(
    await t.mutation(api.adminAuth.signOutByAlertToken, { alertToken }),
  ).toEqual({ ok: false });
});
