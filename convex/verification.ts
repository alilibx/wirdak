import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  formatCode,
  normalizeCode,
  randomCode,
  randomPin,
  randomToken,
  sha256Hex,
  timingSafeEqual,
} from "./lib/crypto";
import {
  checkRateLimit,
  checkRateLimits,
  shardedBucket,
  type RateLimitBucket,
} from "./lib/rateLimit";
import { isBlocked } from "./lib/blocked";
import { refreshPhone } from "./lib/directory";
import { getSetting } from "./lib/settings";
import { bumpCounter, dubaiDay, signInKey } from "./lib/stats";
import { insertSession } from "./sessions";
import { cleanDisplayName, maskPhone, normalizeDigits } from "./lib/text";
import {
  env,
  isDev,
  MAX_SCANNED_TEXT,
  sendPin,
  sendSignInAlert,
  verificationMessage,
  whatsappConfigured,
} from "./whatsapp";

const CODE_LENGTH = 10;
const CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;
/** Candidate codes per start; a collision among pending codes is ~1e-13 likely. */
const CODE_CANDIDATES = 3;
const MINUTE_MS = 60_000;
const TEN_MIN_MS = 10 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_CLIENT_KEY = 200;
const MAX_DEVICE_LABEL = 40;
const MAX_RETURN_PATH = 200;
const UNKNOWN_DEVICE = "جهاز غير معروف";

type Status = Doc<"verifications">["status"];
const OPEN: ReadonlySet<Status> = new Set(["pending", "matched", "needs_pin"]);

// ---------------------------------------------------------------------------
// Input cleaning (pure)

/**
 * Device labels end up inside a WhatsApp message to the account owner, so keep
 * only letters, marks, digits, spaces, and `()·_-`: no URLs, no bidi controls.
 */
export function cleanDeviceLabel(raw: string): string {
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{M}\p{N} ()·_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const capped = Array.from(cleaned).slice(0, MAX_DEVICE_LABEL).join("").trim();
  return /[\p{L}\p{N}]/u.test(capped) ? capped : UNKNOWN_DEVICE;
}

/**
 * The page to link back to from the WhatsApp reply: a plain path on this site
 * (letters, digits, `-._~/`), else `/`. No query or fragment, so nothing like a
 * sign-out token ever lands in a message, and no `//` or `\`, so the link
 * can't leave the site.
 */
export function cleanReturnPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > MAX_RETURN_PATH) return "/";
  return /^\/(?![/\\])[A-Za-z0-9\-._~/]*$/.test(raw) ? raw : "/";
}

/** A valid IANA time zone, canonicalized, or `UTC`. */
export function cleanTimeZone(raw: string): string {
  if (raw.length === 0 || raw.length > 64) return "UTC";
  try {
    return new Intl.DateTimeFormat("en", { timeZone: raw }).resolvedOptions()
      .timeZone;
  } catch {
    return "UTC";
  }
}

// ---------------------------------------------------------------------------
// Shared helpers

async function loadWithSecretHash(
  ctx: QueryCtx,
  verificationId: Id<"verifications">,
  secretHash: string,
): Promise<Doc<"verifications"> | null> {
  const doc = await ctx.db.get(verificationId);
  if (!doc || !timingSafeEqual(secretHash, doc.secretHash)) return null;
  return doc;
}

async function personByPhone(ctx: QueryCtx, phone: string) {
  return await ctx.db
    .query("people")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
}

/**
 * A fresh `now + verificationTtlMs` window with its own expiry timer. Earlier
 * timers stay scheduled but `expire` ignores them (it checks `expiresAt`).
 */
async function freshExpiry(
  ctx: MutationCtx,
  verificationId: Id<"verifications">,
): Promise<number> {
  const expiresAt = Date.now() + (await getSetting(ctx, "verificationTtlMs"));
  await ctx.scheduler.runAt(expiresAt, internal.verification.expire, {
    verificationId,
  });
  return expiresAt;
}

/** Moves a verification to `needs_pin` with a fresh expiry and timer. */
async function toNeedsPin(
  ctx: MutationCtx,
  doc: Doc<"verifications">,
  fields: { phone: string; pinHash: string; existingPersonId: Id<"people"> },
) {
  await ctx.db.patch(doc._id, {
    ...fields,
    status: "needs_pin",
    pinAttempts: 0,
    expiresAt: await freshExpiry(ctx, doc._id),
  });
}

/**
 * Moves an admin panel verification to `needs_pin`. Every phone gets here, on
 * the allowlist or not, so the reply never tells anyone whether a number is an
 * admin; only an allowlisted one carries `adminId`. Never touches `people`.
 */
async function toAdminNeedsPin(
  ctx: MutationCtx,
  doc: Doc<"verifications">,
  fields: { phone: string; pinHash: string },
) {
  const admin = await ctx.db
    .query("admins")
    .withIndex("by_phone", (q) => q.eq("phone", fields.phone))
    .first();
  await ctx.db.patch(doc._id, {
    ...fields,
    ...(admin ? { adminId: admin._id } : {}),
    status: "needs_pin",
    pinAttempts: 0,
    expiresAt: await freshExpiry(ctx, doc._id),
  });
}

async function insertPerson(
  ctx: MutationCtx,
  doc: Doc<"verifications">,
  phone: string,
  timeZone: string,
): Promise<Id<"people">> {
  const personId = await ctx.db.insert("people", {
    phone,
    displayName: doc.displayName,
    verifiedAt: Date.now(),
    timeZone,
    lastSeenAt: Date.now(),
  });
  await refreshPhone(ctx, phone);
  return personId;
}

/** Opens a session for `personId` and marks the verification claimed. */
async function completeSignIn(
  ctx: MutationCtx,
  doc: Doc<"verifications">,
  personId: Id<"people">,
  args: { tokenHash: string; alertTokenHash: string; deviceLabel: string },
): Promise<Id<"sessions">> {
  const sessionId = await insertSession(ctx, {
    personId,
    tokenHash: args.tokenHash,
    alertTokenHash: args.alertTokenHash,
    deviceLabel: args.deviceLabel,
  });
  await ctx.db.patch(doc._id, { status: "claimed", pinHash: undefined });
  return sessionId;
}

/** Fresh session + alert tokens; raw values stay in the action. */
async function newSessionTokens() {
  const sessionToken = randomToken(32);
  const alertToken = randomToken(32);
  return {
    sessionToken,
    alertToken,
    tokenHash: await sha256Hex(sessionToken),
    alertTokenHash: await sha256Hex(alertToken),
  };
}

// ---------------------------------------------------------------------------
// Start

type StartError =
  "invalid_name" | "rate_limited" | "maintenance" | "whatsapp_not_configured";

export type StartResult =
  | {
      verificationId: Id<"verifications">;
      secret: string;
      code: string;
      waNumber: string;
      message: string;
    }
  | { error: StartError };

export const startInternal = internalAction({
  args: {
    displayName: v.string(),
    clientKey: v.string(),
    ip: v.union(v.string(), v.null()),
    returnPath: v.optional(v.string()),
    surface: v.optional(v.literal("admin")),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    if (!isDev() && !whatsappConfigured()) {
      return { error: "whatsapp_not_configured" };
    }
    // An admin sign-in has no display name: it never creates a person.
    const displayName =
      args.surface === "admin" ? "" : cleanDisplayName(args.displayName);
    if (displayName === null) return { error: "invalid_name" };

    const candidates = Array.from({ length: CODE_CANDIDATES }, () =>
      randomCode(CODE_LENGTH),
    );
    const secret = randomToken(32);
    const res = await ctx.runMutation(internal.verification.createPending, {
      candidates,
      secretHash: await sha256Hex(secret),
      displayName,
      clientKey: args.clientKey,
      ip: args.ip,
      returnPath: cleanReturnPath(args.returnPath),
      ...(args.surface === "admin" ? { surface: "admin" as const } : {}),
    });
    if ("error" in res) return res;
    const code = formatCode(res.code);
    return {
      verificationId: res.verificationId,
      secret,
      code,
      waNumber: env("WHATSAPP_PUBLIC_NUMBER") ?? "",
      message: verificationMessage(code),
    };
  },
});

async function siteStartBuckets(
  ctx: MutationCtx,
  clientKey: string,
  ip: string | null,
): Promise<RateLimitBucket[]> {
  const buckets: RateLimitBucket[] = [
    {
      key: `verifyStart:client:${clientKey}`,
      limit: await getSetting(ctx, "verifyStartPerClientPer10Min"),
      windowMs: TEN_MIN_MS,
    },
    shardedBucket(
      "verifyStart:global",
      await getSetting(ctx, "verifyGlobalPerMinute"),
      MINUTE_MS,
    ),
  ];
  if (ip !== null) {
    buckets.push({
      key: `verifyStart:ip:${ip}`,
      limit: await getSetting(ctx, "verifyStartPerIpPer10Min"),
      windowMs: TEN_MIN_MS,
    });
  }
  return buckets;
}

/**
 * Admin starts have buckets of their own, so a flood on the website can't
 * lock admins out. Fixed numbers, not settings: an admin could otherwise
 * loosen the limit that guards the admin panel itself.
 */
function adminStartBuckets(
  clientKey: string,
  ip: string | null,
): RateLimitBucket[] {
  // The global bucket isn't sharded: admin traffic is too small for write
  // contention, and 20 split over 10 shards would refuse a third start that
  // happened to land on a busy shard.
  const buckets: RateLimitBucket[] = [
    { key: `adminStart:client:${clientKey}`, limit: 5, windowMs: TEN_MIN_MS },
    { key: "adminStart:global", limit: 20, windowMs: MINUTE_MS },
  ];
  if (ip !== null) {
    buckets.push({
      key: `adminStart:ip:${ip}`,
      limit: 10,
      windowMs: TEN_MIN_MS,
    });
  }
  return buckets;
}

export const createPending = internalMutation({
  args: {
    candidates: v.array(v.string()),
    secretHash: v.string(),
    displayName: v.string(),
    clientKey: v.string(),
    ip: v.union(v.string(), v.null()),
    returnPath: v.string(),
    surface: v.optional(v.literal("admin")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { verificationId: Id<"verifications">; code: string }
    | { error: "maintenance" | "rate_limited" }
  > => {
    const admin = args.surface === "admin";
    // Admins must be able to sign in to turn maintenance off (spec 4.2).
    if (!admin && (await getSetting(ctx, "maintenanceMode"))) {
      return { error: "maintenance" };
    }
    const clientKey = (
      await sha256Hex(args.clientKey.slice(0, MAX_CLIENT_KEY))
    ).slice(0, 32);
    const buckets: RateLimitBucket[] = admin
      ? adminStartBuckets(clientKey, args.ip)
      : await siteStartBuckets(ctx, clientKey, args.ip);
    // All or nothing: a start refused by one limit spends none of the others.
    const allowed = await checkRateLimits(ctx, buckets);
    if (!allowed) return { error: "rate_limited" };

    let code: string | null = null;
    for (const candidate of args.candidates) {
      if (!CODE_RE.test(candidate)) continue;
      const clash = await ctx.db
        .query("verifications")
        .withIndex("by_code_status", (q) =>
          q.eq("codeNormalized", candidate).eq("status", "pending"),
        )
        .first();
      if (!clash) {
        code = candidate;
        break;
      }
    }
    if (code === null) throw new Error("no unique verification code");

    const now = Date.now();
    const expiresAt = now + (await getSetting(ctx, "verificationTtlMs"));
    const verificationId = await ctx.db.insert("verifications", {
      codeNormalized: code,
      secretHash: args.secretHash,
      displayName: args.displayName,
      status: "pending",
      pinAttempts: 0,
      returnPath: args.returnPath,
      ...(admin ? { surface: "admin" as const } : {}),
      createdAt: now,
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.verification.expire, {
      verificationId,
    });
    // Member sign-ins only: spec 6.1's success rate is about members.
    if (!admin) await bumpCounter(ctx, signInKey(dubaiDay(now), "started"));
    return { verificationId, code };
  },
});

// ---------------------------------------------------------------------------
// Status, reject, expire

export const status = query({
  args: { verificationId: v.id("verifications"), secret: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: Status; maskedPhone: string | null }> => {
    const doc = await loadWithSecretHash(
      ctx,
      args.verificationId,
      await sha256Hex(args.secret),
    );
    if (!doc) return { status: "expired", maskedPhone: null };
    const current: Status =
      OPEN.has(doc.status) && Date.now() >= doc.expiresAt
        ? "expired"
        : doc.status;
    const showPhone =
      current === "matched" || current === "needs_pin" || current === "claimed";
    return {
      status: current,
      maskedPhone: showPhone && doc.phone ? maskPhone(doc.phone) : null,
    };
  },
});

/** "Not my number." */
export const reject = mutation({
  args: { verificationId: v.id("verifications"), secret: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const doc = await loadWithSecretHash(
      ctx,
      args.verificationId,
      await sha256Hex(args.secret),
    );
    if (doc && OPEN.has(doc.status)) {
      await ctx.db.patch(doc._id, { status: "rejected", pinHash: undefined });
    }
    return null;
  },
});

/** Scheduled at `expiresAt`; a timer left over from before a `needs_pin` reset is a no-op. */
export const expire = internalMutation({
  args: { verificationId: v.id("verifications") },
  handler: async (ctx, { verificationId }) => {
    const doc = await ctx.db.get(verificationId);
    if (!doc || !OPEN.has(doc.status) || Date.now() < doc.expiresAt) return;
    await ctx.db.patch(doc._id, { status: "expired", pinHash: undefined });
  },
});

// ---------------------------------------------------------------------------
// Incoming WhatsApp message

/**
 * Every distinct code-length run of code-alphabet characters in `text`.
 * Digits are normalized first (normalizeCode drops Arabic-Indic digits), then a
 * 10-character window slides across the code-alphabet characters.
 */
function codeWindows(text: string): string[] {
  const normalized = normalizeCode(
    normalizeDigits(text.slice(0, MAX_SCANNED_TEXT)),
  );
  const windows = new Set<string>();
  for (let i = 0; i + CODE_LENGTH <= normalized.length; i++) {
    windows.add(normalized.slice(i, i + CODE_LENGTH));
  }
  return [...windows];
}

/** Finds the pending, unexpired verification whose code appears in `windows`. */
async function findPendingByText(
  ctx: QueryCtx,
  windows: string[],
): Promise<Doc<"verifications"> | null> {
  const now = Date.now();
  for (const window of windows) {
    const doc = await ctx.db
      .query("verifications")
      .withIndex("by_code_status", (q) =>
        q.eq("codeNormalized", window).eq("status", "pending"),
      )
      .first();
    if (doc && now < doc.expiresAt) return doc;
  }
  return null;
}

/**
 * One transaction per incoming message: per-phone rate limit, code lookup,
 * and the pending → matched / needs_pin transition. Because the lookup only
 * sees `pending` rows, a code can move out of `pending` once.
 */
export const matchIncoming = internalMutation({
  args: { phone: v.string(), text: v.string(), pinHash: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    /** `codeShaped`: the text could hold a sign-in code. */
    | { kind: "rate_limited"; codeShaped: boolean }
    /** `admin`: an admin panel sign-in, which gets the admin code text. */
    | { kind: "needs_pin"; admin: boolean }
    | { kind: "matched"; returnPath: string }
    /** `codeShaped`: the text could hold a code from another deployment. */
    | { kind: "no_match"; codeShaped: boolean }
  > => {
    const allowed = await checkRateLimit(
      ctx,
      `verifyPhone:${args.phone}`,
      await getSetting(ctx, "verifyPerPhonePerHour"),
      HOUR_MS,
    );
    const windows = codeWindows(args.text);
    if (!allowed)
      return { kind: "rate_limited", codeShaped: windows.length > 0 };
    // A blocked number gets "no code found" and never touches a pending code (spec 8).
    if (await isBlocked(ctx, args.phone)) {
      return { kind: "no_match", codeShaped: false };
    }

    const doc = await findPendingByText(ctx, windows);
    if (!doc) return { kind: "no_match", codeShaped: windows.length > 0 };

    if (doc.surface === "admin") {
      await toAdminNeedsPin(ctx, doc, {
        phone: args.phone,
        pinHash: args.pinHash,
      });
      return { kind: "needs_pin", admin: true };
    }
    const person = await personByPhone(ctx, args.phone);
    if (person) {
      await toNeedsPin(ctx, doc, {
        phone: args.phone,
        pinHash: args.pinHash,
        existingPersonId: person._id,
      });
      return { kind: "needs_pin", admin: false };
    }
    // A fresh window to claim in, even if the message arrived at 9m59s.
    await ctx.db.patch(doc._id, {
      status: "matched",
      phone: args.phone,
      expiresAt: await freshExpiry(ctx, doc._id),
    });
    return { kind: "matched", returnPath: doc.returnPath ?? "/" };
  },
});

// ---------------------------------------------------------------------------
// Claim (new number) and PIN confirmation (existing number)

type SignInResult =
  | {
      kind: "ok";
      phone: string;
      /** A person row was created for this phone by this sign-in. */
      created: boolean;
      /** The person's sessions other than the one just opened. */
      otherSessions: number;
      /** Send the sign-in alert (`signInAlertOn`). */
      alertOn: boolean;
    }
  | { kind: "needs_pin"; phone: string | null }
  | { kind: "expired" | "wrong_pin" | "too_many_attempts" };

async function alertSignIn(
  res: Extract<SignInResult, { kind: "ok" }>,
  deviceLabel: string,
  alertToken: string,
): Promise<void> {
  if (!res.alertOn) return;
  await sendSignInAlert(res.phone, res.created, deviceLabel, alertToken);
}

const signInArgs = {
  verificationId: v.id("verifications"),
  secretHash: v.string(),
  tokenHash: v.string(),
  alertTokenHash: v.string(),
  deviceLabel: v.string(),
  timeZone: v.string(),
};

export const claimInternal = internalMutation({
  args: { ...signInArgs, pinHash: v.string() },
  handler: async (ctx, args): Promise<SignInResult> => {
    const doc = await loadWithSecretHash(
      ctx,
      args.verificationId,
      args.secretHash,
    );
    if (!doc || Date.now() >= doc.expiresAt) return { kind: "expired" };
    // Already waiting for a PIN: don't send another one.
    if (doc.status === "needs_pin") return { kind: "needs_pin", phone: null };
    if (doc.status !== "matched" || !doc.phone) return { kind: "expired" };

    // The number may have gained an account since the message arrived (or a
    // concurrent claim just created one): never attach without the PIN.
    const existing = await personByPhone(ctx, doc.phone);
    if (existing) {
      await toNeedsPin(ctx, doc, {
        phone: doc.phone,
        pinHash: args.pinHash,
        existingPersonId: existing._id,
      });
      return { kind: "needs_pin", phone: doc.phone };
    }
    const personId = await insertPerson(ctx, doc, doc.phone, args.timeZone);
    await completeSignIn(ctx, doc, personId, args);
    await bumpCounter(ctx, signInKey(dubaiDay(Date.now()), "completed"));
    return {
      kind: "ok",
      phone: doc.phone,
      created: true,
      otherSessions: 0,
      alertOn: await getSetting(ctx, "signInAlertOn"),
    };
  },
});

export const confirmPinInternal = internalMutation({
  args: { ...signInArgs, pinHash: v.string() },
  handler: async (ctx, args): Promise<SignInResult> => {
    const doc = await loadWithSecretHash(
      ctx,
      args.verificationId,
      args.secretHash,
    );
    if (!doc || Date.now() >= doc.expiresAt) return { kind: "expired" };
    // An admin panel code never opens a member session.
    if (doc.surface === "admin") return { kind: "expired" };
    if (doc.status !== "needs_pin" || !doc.pinHash || !doc.phone) {
      return { kind: "expired" };
    }
    if (doc.pinAttempts >= (await getSetting(ctx, "pinMaxAttempts"))) {
      return { kind: "too_many_attempts" };
    }
    if (!timingSafeEqual(args.pinHash, doc.pinHash)) {
      await ctx.db.patch(doc._id, { pinAttempts: doc.pinAttempts + 1 });
      return { kind: "wrong_pin" };
    }
    // The PIN went to this phone, so its holder owns whichever account has
    // the number now.
    const existing = await personByPhone(ctx, doc.phone);
    // An organizer an admin set up has only now signed in.
    if (existing?.verifiedAt === 0) {
      const now = Date.now();
      await ctx.db.patch(existing._id, { verifiedAt: now, lastSeenAt: now });
    }
    const personId =
      existing?._id ?? (await insertPerson(ctx, doc, doc.phone, args.timeZone));
    const sessionId = await completeSignIn(ctx, doc, personId, args);
    await bumpCounter(ctx, signInKey(dubaiDay(Date.now()), "completed"));
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_person", (q) => q.eq("personId", personId))
      .collect();
    return {
      kind: "ok",
      phone: doc.phone,
      created: existing === null,
      otherSessions: sessions.filter((s) => s._id !== sessionId).length,
      alertOn: await getSetting(ctx, "signInAlertOn"),
    };
  },
});

export const claim = action({
  args: {
    verificationId: v.id("verifications"),
    secret: v.string(),
    deviceLabel: v.string(),
    timeZone: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ sessionToken: string } | { error: "expired" | "needs_pin" }> => {
    const tokens = await newSessionTokens();
    const pin = randomPin();
    const deviceLabel = cleanDeviceLabel(args.deviceLabel);
    const res = await ctx.runMutation(internal.verification.claimInternal, {
      verificationId: args.verificationId,
      secretHash: await sha256Hex(args.secret),
      tokenHash: tokens.tokenHash,
      alertTokenHash: tokens.alertTokenHash,
      pinHash: await sha256Hex(pin),
      deviceLabel,
      timeZone: cleanTimeZone(args.timeZone),
    });
    switch (res.kind) {
      case "ok":
        await alertSignIn(res, deviceLabel, tokens.alertToken);
        return { sessionToken: tokens.sessionToken };
      case "needs_pin":
        if (res.phone) await sendPin(res.phone, pin);
        return { error: "needs_pin" };
      default:
        return { error: "expired" };
    }
  },
});

export const confirmPin = action({
  args: {
    verificationId: v.id("verifications"),
    secret: v.string(),
    pin: v.string(),
    deviceLabel: v.string(),
    timeZone: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { sessionToken: string; otherSessions: number }
    | { error: "wrong_pin" | "too_many_attempts" | "expired" }
  > => {
    const tokens = await newSessionTokens();
    const deviceLabel = cleanDeviceLabel(args.deviceLabel);
    // "123 456", " ١٢٣٤٥٦ " and "123456" are the same PIN.
    const pin = normalizeDigits(args.pin.slice(0, 64)).replace(/\s+/gu, "");
    const res = await ctx.runMutation(
      internal.verification.confirmPinInternal,
      {
        verificationId: args.verificationId,
        secretHash: await sha256Hex(args.secret),
        tokenHash: tokens.tokenHash,
        alertTokenHash: tokens.alertTokenHash,
        pinHash: await sha256Hex(pin),
        deviceLabel,
        timeZone: cleanTimeZone(args.timeZone),
      },
    );
    switch (res.kind) {
      case "ok":
        await alertSignIn(res, deviceLabel, tokens.alertToken);
        return {
          sessionToken: tokens.sessionToken,
          otherSessions: res.otherSessions,
        };
      case "wrong_pin":
      case "too_many_attempts":
        return { error: res.kind };
      default:
        return { error: "expired" };
    }
  },
});
