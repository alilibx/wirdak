import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { activeMembership } from "./khatmas";
import { NOTE_KINDS, type NoteKind } from "./lib/noteText";
import { quietHours } from "./lib/settings";
import { nextAwake } from "./lib/wakingTime";
import { NOTE_TEMPLATES, noteTemplate } from "./lib/whatsappTemplates";
import { isDev, isStaging, sendWhatsAppTemplate, siteUrl } from "./whatsapp";

type Khatma = Pick<Doc<"khatmas">, "name" | "createdAt" | "inviteCode">;

/**
 * What `deliver` sends for a note: null when it no longer calls for a WhatsApp
 * message (cleared, already sent, the member left or turned this khatma's
 * notifications off, or the person turned WhatsApp off), or `retryAt` when
 * it's quiet hours for the person now.
 */
export const plan = internalQuery({
  args: { noteId: v.id("notes") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { phone: string; note: Doc<"notes">; khatma: Khatma }
    | { retryAt: number }
    | null
  > => {
    const note = await ctx.db.get(args.noteId);
    if (!note || note.clearedAt !== null || note.whatsappSentAt) return null;
    if (NOTE_TEMPLATES[note.kind] === null || note.whatsappOff) return null;
    const member = await activeMembership(ctx, note.khatmaId, note.personId);
    if (!member?.notificationsOn) return null;
    const person = await ctx.db.get(note.personId);
    if (!person?.whatsappNotes) return null;
    const khatma = await ctx.db.get(note.khatmaId);
    if (!khatma) return null;
    const now = Date.now();
    const awake = nextAwake(now, person.timeZone, await quietHours(ctx));
    if (awake > now) return { retryAt: awake };
    return {
      phone: person.phone,
      note,
      khatma: {
        name: khatma.name,
        createdAt: khatma.createdAt,
        inviteCode: khatma.inviteCode,
      },
    };
  },
});

export const markSent = internalMutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (note) await ctx.db.patch(note._id, { whatsappSentAt: Date.now() });
  },
});

/**
 * Sends one note as its WhatsApp template, once. Marked sent before sending,
 * so a retried action never sends twice; a failed send isn't retried.
 */
export const deliver = internalAction({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const plan = await ctx.runQuery(internal.whatsappNotes.plan, args);
    if (!plan) return;
    if ("retryAt" in plan) {
      await ctx.scheduler.runAt(
        plan.retryAt,
        internal.whatsappNotes.deliver,
        args,
      );
      return;
    }
    const message = noteTemplate(plan.note, plan.khatma, siteUrl());
    if (!message) return;
    await ctx.runMutation(internal.whatsappNotes.markSent, args);
    await sendWhatsAppTemplate(plan.phone, message);
  },
});

/** The person with this phone and the khatma they joined most recently. */
export const sampleTarget = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const person = await ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .unique();
    if (!person) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_person", (q) => q.eq("personId", person._id))
      .collect();
    const latest = members
      .filter((m) => m.status === "active")
      .sort((a, b) => b.joinedAt - a.joinedAt)[0];
    const khatma = latest ? await ctx.db.get(latest.khatmaId) : null;
    if (!khatma) return null;
    return {
      name: khatma.name,
      createdAt: khatma.createdAt,
      inviteCode: khatma.inviteCode,
    };
  },
});

/**
 * Staging and dev only: sends one note kind's template to a person on this
 * deployment, with their latest khatma's title and link, so each template can
 * be checked on a phone:
 * `bun run convex run whatsappNotes:sendSample '{"phone":"+9715…","kind":"reminder"}'`.
 * `many` sends the plural "open for help". No opt-in checks.
 */
export const sendSample = internalAction({
  args: { phone: v.string(), kind: v.string(), many: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<boolean> => {
    if (!isDev() && !isStaging()) {
      throw new Error("sendSample runs only when WIRDAK_ENV is dev or staging");
    }
    if (!(NOTE_KINDS as readonly string[]).includes(args.kind)) {
      throw new Error(`unknown note kind ${args.kind}`);
    }
    const khatma = await ctx.runQuery(internal.whatsappNotes.sampleTarget, {
      phone: args.phone,
    });
    if (!khatma)
      throw new Error("no person with an active khatma has this phone");
    const now = Date.now();
    const note = {
      kind: args.kind as NoteKind,
      juz: args.many ? [3, 12, 15] : [12],
      count: 3,
      until: now + 2 * 86_400_000,
    };
    const message = noteTemplate(note, khatma, siteUrl(), now);
    if (!message) throw new Error(`${args.kind} never goes to WhatsApp`);
    return await sendWhatsAppTemplate(args.phone, message);
  },
});
