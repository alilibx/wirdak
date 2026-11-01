import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { endGraceIfDue, isHeld } from "./grace";
import { ADMIN_SESSION_TTL_MS } from "./lib/adminSession";
import { randomToken, sha256Hex } from "./lib/crypto";
import { encodePayload } from "./lib/rotaPayload";
import { SETTING_DEFAULTS } from "./lib/settings";
import { isDev, isStaging } from "./whatsapp";

/**
 * Dev-only stand-in for a WhatsApp message arriving at the webhook:
 * `bun run convex run dev:simulateIncoming '{"from":"971501234567","text":"…"}'`.
 */
export const simulateIncoming = internalAction({
  args: {
    from: v.string(),
    text: v.string(),
    /** A button tap's payload, as `rotaPayload.encodePayload` makes it. */
    payload: v.optional(v.string()),
    profileName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!isDev()) {
      throw new Error("simulateIncoming runs only when WIRDAK_ENV is dev");
    }
    await ctx.runAction(internal.whatsapp.handleIncoming, {
      waMessageId: `dev.${randomToken(12)}`,
      ...args,
    });
  },
});

/**
 * Dev-only: ends the grace of the current hold of a juz' right now, the way the
 * scheduled `grace.endDue` would at its end (same checks, same effects), so a
 * test needn't wait hours:
 * `bun run convex run dev:forceGraceEnd '{"inviteCode":"…","juz":5}'`.
 */
export const forceGraceEnd = internalMutation({
  args: { inviteCode: v.string(), juz: v.number() },
  handler: async (ctx, args): Promise<void> => {
    if (!isDev()) {
      throw new Error("forceGraceEnd runs only when WIRDAK_ENV is dev");
    }
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", args.inviteCode))
      .unique();
    if (!khatma?.currentRoundId) throw new Error("no such khatma");
    const roundId = khatma.currentRoundId;
    const rows = await ctx.db
      .query("assignments")
      .withIndex("by_round_juz", (q) =>
        q.eq("roundId", roundId).eq("juz", args.juz),
      )
      .collect();
    const hold = rows.find(isHeld);
    if (!hold) throw new Error(`juz ${args.juz} has no current hold`);
    await endGraceIfDue(ctx, hold, hold.graceEndsAt);
  },
});

/**
 * Dev-only: lets a verified person create rotating khatmas, as an admin would
 * (without the audit entry), so a test needn't sign in to the admin app:
 * `bun run convex run dev:allowRota '{"phone":"+971501234567"}'`.
 */
export const allowRota = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (!isDev()) {
      throw new Error("allowRota runs only when WIRDAK_ENV is dev");
    }
    const person = await ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .unique();
    if (!person) throw new Error("no such person");
    await ctx.db.patch(person._id, { rotaAllowed: true });
  },
});

/** Dev-only: the admin with this number, made if there is none, and a session for them. */
export const insertAdminSession = internalMutation({
  args: {
    phone: v.string(),
    tokenHash: v.string(),
    alertTokenHash: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!isDev()) {
      throw new Error("insertAdminSession runs only when WIRDAK_ENV is dev");
    }
    const { phone, tokenHash, alertTokenHash } = args;
    const now = Date.now();
    const found = await ctx.db
      .query("admins")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
    const adminId =
      found?._id ??
      (await ctx.db.insert("admins", { phone, addedBy: null, addedAt: now }));
    await ctx.db.insert("adminSessions", {
      adminId,
      tokenHash,
      alertTokenHash,
      deviceLabel: "dev",
      createdAt: now,
      expiresAt: now + ADMIN_SESSION_TTL_MS,
    });
  },
});

/**
 * Dev-only: signs in as the admin with this number (one is made if there is
 * none) and returns the session token, so a test needn't go through the admin
 * sign-in: `bun run convex run dev:adminSession '{"phone":"+971501234567"}'`.
 */
export const adminSession = internalAction({
  args: { phone: v.string() },
  handler: async (ctx, args): Promise<string> => {
    if (!isDev()) {
      throw new Error("adminSession runs only when WIRDAK_ENV is dev");
    }
    const adminToken = randomToken(32);
    await ctx.runMutation(internal.dev.insertAdminSession, {
      phone: args.phone,
      tokenHash: await sha256Hex(adminToken),
      alertTokenHash: await sha256Hex(randomToken(32)),
    });
    return adminToken;
  },
});

/**
 * Dev-only: the payload of a button on the message that a rota participant got
 * for the khatma's open day, the one `dev:simulateIncoming` takes as `payload`
 * to stand in for a tap on «أتممت» (`done`), «ليس بعد» (`notYet`) or
 * «دعاء الختم» (`dua`):
 * `bun run convex run dev:rotaPayload '{"inviteCode":"…","phone":"+971501234567","action":"done"}'`.
 */
export const rotaPayload = internalQuery({
  args: {
    inviteCode: v.string(),
    phone: v.string(),
    action: v.union(v.literal("done"), v.literal("notYet"), v.literal("dua")),
  },
  handler: async (ctx, args): Promise<string> => {
    if (!isDev()) {
      throw new Error("rotaPayload runs only when WIRDAK_ENV is dev");
    }
    const khatma = await ctx.db
      .query("khatmas")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", args.inviteCode))
      .unique();
    if (khatma?.kind !== "rota") throw new Error("no such rota khatma");
    const participant = (
      await ctx.db
        .query("rotaParticipants")
        .withIndex("by_khatma_phone", (q) =>
          q.eq("khatmaId", khatma._id).eq("phone", args.phone),
        )
        .collect()
    ).find((p) => p.removedAt == null);
    if (!participant) throw new Error("no such participant");
    const days = await ctx.db
      .query("rotaDays")
      .withIndex("by_khatma_n", (q) => q.eq("khatmaId", khatma._id))
      .order("desc")
      .take(1);
    const day = days[0];
    if (!day || day.closedAt !== null)
      throw new Error("the khatma has no open day");
    return encodePayload(
      {
        action: args.action,
        dayId: day._id,
        participantId: participant._id,
      },
      isStaging(),
    );
  },
});

/**
 * Dev-only: stores a numeric or on/off setting, or with `value: null` removes it so the
 * default applies again, and returns the stored value it replaced (null when
 * there was none). The e2e run uses it to lift the per-IP verification limit,
 * since every test verifies from the same address, and to put it back after:
 * `bun run convex run dev:setSetting '{"key":"verifyStartPerIpPer10Min","value":1000}'`.
 */
export const setSetting = internalMutation({
  args: { key: v.string(), value: v.union(v.number(), v.boolean(), v.null()) },
  handler: async (ctx, args): Promise<number | boolean | null> => {
    if (!isDev()) {
      throw new Error("setSetting runs only when WIRDAK_ENV is dev");
    }
    if (!Object.hasOwn(SETTING_DEFAULTS, args.key)) {
      throw new Error(`unknown setting ${args.key}`);
    }
    const key = args.key;
    const kind = typeof SETTING_DEFAULTS[key as keyof typeof SETTING_DEFAULTS];
    if (
      (kind !== "number" && kind !== "boolean") ||
      (args.value !== null && typeof args.value !== kind)
    ) {
      throw new Error(`${key} is not a numeric setting`);
    }
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (args.value === null) {
      if (row) await ctx.db.delete(row._id);
    } else if (row) {
      await ctx.db.patch(row._id, { value: args.value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", {
        key,
        value: args.value,
        updatedAt: Date.now(),
      });
    }
    return row ? (row.value as number | boolean) : null;
  },
});
