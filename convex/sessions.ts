import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { sha256Hex } from "./lib/crypto";
import {
  requirePerson,
  resolveSession,
  sessionMutation,
  sessionQuery,
} from "./lib/session";
import { getSetting } from "./lib/settings";
import { maskPhone } from "./lib/text";

/** Inserts a session row; callers pass hashes, never raw tokens. */
export async function insertSession(
  ctx: MutationCtx,
  args: {
    personId: Id<"people">;
    tokenHash: string;
    alertTokenHash: string;
    deviceLabel: string;
  },
): Promise<Id<"sessions">> {
  const now = Date.now();
  return await ctx.db.insert("sessions", {
    ...args,
    createdAt: now,
    lastUsedAt: now,
  });
}

/**
 * Deletes a session with everything that hangs off it: its push subscriptions
 * (a signed-out device must stop receiving notes) and its hand-off tokens.
 * Every path that ends a session goes through here.
 */
export async function deleteSession(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
): Promise<void> {
  const subscriptions = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const row of subscriptions) await ctx.db.delete(row._id);
  const handoffs = await ctx.db
    .query("handoffTokens")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const row of handoffs) await ctx.db.delete(row._id);
  await ctx.db.delete(sessionId);
}

export const create = internalMutation({
  args: {
    personId: v.id("people"),
    tokenHash: v.string(),
    alertTokenHash: v.string(),
    deviceLabel: v.string(),
  },
  handler: (ctx, args) => insertSession(ctx, args),
});

export const me = sessionQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.person) return null;
    return {
      displayName: ctx.person.displayName,
      maskedPhone: maskPhone(ctx.person.phone),
      whatsappNotes: ctx.person.whatsappNotes === true,
      /** The new rota page layout: on for everyone, or for this person by an admin. */
      rotaNewLayout:
        (await getSetting(ctx, "rotaNewLayoutOn")) ||
        ctx.person.rotaNewLayout === true,
    };
  },
});

export const signOut = sessionMutation({
  args: {},
  handler: async (ctx) => {
    if (ctx.session) await deleteSession(ctx, ctx.session._id);
  },
});

/**
 * "Not me" link from the new-sign-in WhatsApp alert. Signs out every session of
 * the alerted person, except the caller's own when that is a different session
 * of the same person (so the real owner stays signed in). Opened with no
 * session (e.g. WhatsApp's in-app browser) it signs out all of them.
 * `callerAffected` is true when the caller's own session was one of those
 * removed, so the page knows whether to forget its local token.
 */
export const signOutOthersByAlertToken = mutation({
  args: { alertToken: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const alertTokenHash = await sha256Hex(args.alertToken);
    const alerted = await ctx.db
      .query("sessions")
      .withIndex("by_alertTokenHash", (q) =>
        q.eq("alertTokenHash", alertTokenHash),
      )
      .first();
    if (!alerted) return { ok: false as const };

    const { session: caller } = await resolveSession(ctx, args.sessionToken);
    const callerIsAlertedPerson =
      caller !== null && caller.personId === alerted.personId;
    const keep =
      callerIsAlertedPerson && caller._id !== alerted._id ? caller._id : null;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_person", (q) => q.eq("personId", alerted.personId))
      .collect();
    for (const s of sessions) {
      if (s._id !== keep) await deleteSession(ctx, s._id);
    }
    return {
      ok: true as const,
      keptCurrent: keep !== null,
      callerAffected: callerIsAlertedPerson && keep === null,
    };
  },
});

export const list = sessionQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.person) return [];
    const personId = ctx.person._id;
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_person", (q) => q.eq("personId", personId))
      .collect();
    return sessions.map((s) => ({
      sessionId: s._id,
      deviceLabel: s.deviceLabel,
      lastUsedAt: s.lastUsedAt,
      isCurrent: s._id === ctx.session?._id,
    }));
  },
});

export const signOutOthers = sessionMutation({
  args: {},
  handler: async (ctx) => {
    const person = requirePerson(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_person", (q) => q.eq("personId", person._id))
      .collect();
    for (const s of sessions) {
      if (s._id !== ctx.session?._id) await deleteSession(ctx, s._id);
    }
  },
});

export const signOutOne = sessionMutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const person = requirePerson(ctx);
    const target = await ctx.db.get(args.sessionId);
    if (!target || target.personId !== person._id) {
      throw new ConvexError({ code: "not_found" });
    }
    await deleteSession(ctx, target._id);
  },
});
