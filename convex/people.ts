import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { paceDays, personPace, weekStreak } from "./lib/pace";
import { checkRateLimit } from "./lib/rateLimit";
import {
  LAST_USED_REFRESH_MS,
  requirePerson,
  sessionMutation,
  sessionQuery,
} from "./lib/session";
import { refreshPhone } from "./lib/directory";
import { getSetting } from "./lib/settings";
import { cleanDisplayName } from "./lib/text";
import { cleanTimeZone } from "./verification";

const HOUR_MS = 3_600_000;

export const updateDisplayName = sessionMutation({
  args: { displayName: v.string() },
  handler: async (ctx, args) => {
    const person = requirePerson(ctx);
    if (await getSetting(ctx, "maintenanceMode")) {
      throw new ConvexError({ code: "maintenance" });
    }
    const displayName = cleanDisplayName(args.displayName);
    if (displayName === null) throw new ConvexError({ code: "invalid_name" });
    // after validation, so a refused name does not spend a change
    const allowed = await checkRateLimit(
      ctx,
      `name:${person._id}`,
      await getSetting(ctx, "nameChangesPerPersonPerHour"),
      HOUR_MS,
    );
    if (!allowed) throw new ConvexError({ code: "rate_limited" });
    await ctx.db.patch(person._id, { displayName });
    await refreshPhone(ctx, person.phone);
  },
});

/**
 * Turns WhatsApp notifications on or off for the caller (every khatma whose
 * notifications they have on). Signed-out callers get `{ ok: false }`.
 */
export const setWhatsappNotes = sessionMutation({
  args: { on: v.boolean() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    if (!ctx.person) return { ok: false };
    await ctx.db.patch(ctx.person._id, { whatsappNotes: args.on });
    return { ok: true };
  },
});

/**
 * Records that `person` was just here (at most once an hour, the same as the
 * session's `lastUsedAt`) and keeps their time zone current. Writes only when
 * one of the two changed.
 */
export async function touchPerson(
  ctx: MutationCtx,
  person: Doc<"people">,
  now: number,
  timeZone: string,
): Promise<void> {
  const changes: Partial<Pick<Doc<"people">, "lastSeenAt" | "timeZone">> = {};
  if (now - person.lastSeenAt >= LAST_USED_REFRESH_MS) changes.lastSeenAt = now;
  if (timeZone !== person.timeZone) changes.timeZone = timeZone;
  if (Object.keys(changes).length > 0) await ctx.db.patch(person._id, changes);
}

/**
 * The app calls this when it opens or comes back to the foreground. Records
 * that the caller was just here and keeps their time zone current, which
 * waking time and quiet hours read. Signed-out callers get `{ ok: false }`.
 */
export const touch = sessionMutation({
  args: { timeZone: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const person = ctx.person;
    if (!person) return { ok: false };
    await touchPerson(ctx, person, Date.now(), cleanTimeZone(args.timeZone));
    return { ok: true };
  },
});

/** What the web needs to know about the signed-in person: `null` when signed out. */
export const me = sessionQuery({
  args: {},
  handler: async (ctx): Promise<{ rotaAllowed: boolean } | null> => {
    const person = ctx.person;
    if (!person) return null;
    return { rotaAllowed: person.rotaAllowed === true };
  },
});

export type SavedPerson = {
  id: Id<"rotaContacts">;
  name: string;
  /** Null for someone imported from a pool khatma: the organizer never sees the number. */
  phone: string | null;
};

/** The people the caller added to their rotating khatmas before, by name, for the settings section. */
export const savedPeople = sessionQuery({
  args: {},
  handler: async (ctx): Promise<SavedPerson[]> => {
    const person = ctx.person;
    if (!person) return [];
    const contacts = await ctx.db
      .query("rotaContacts")
      .withIndex("by_owner", (q) => q.eq("ownerPersonId", person._id))
      .collect();
    return contacts
      .filter((c) => c.removedAt === undefined)
      .map((c) => ({ id: c._id, name: c.name, phone: c.phone }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  },
});

export type MyStats = {
  paceDays: number | null;
  juzRead: number;
  weekStreak: number | null;
};

/**
 * The caller's own numbers (spec 4.1, 4.4): their pace once three finishes
 * count, every juz' they finished, and the weekly streak while it is two or
 * more. `null` when signed out. Never shown to anyone else.
 */
export const myStats = sessionQuery({
  args: {},
  handler: async (ctx): Promise<MyStats | null> => {
    const person = ctx.person;
    if (!person) return null;
    const personId = person._id;
    const finishedAts: number[] = [];
    const rows = ctx.db
      .query("assignments")
      .withIndex("by_person_finishedAt", (q) => q.eq("personId", personId));
    for await (const a of rows) {
      if (a.finishedAt !== null) finishedAts.push(a.finishedAt);
    }
    const pace = await personPace(ctx, personId);
    const streak = weekStreak(finishedAts, person.timeZone, Date.now());
    return {
      paceDays: pace.known ? paceDays(pace.paceMs) : null,
      juzRead: finishedAts.length,
      weekStreak: streak >= 2 ? streak : null,
    };
  },
});
