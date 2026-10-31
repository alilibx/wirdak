import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type MutationCtx } from "./_generated/server";
import { khatmaByInviteCode } from "./lib/khatma";
import type { NoteKind } from "./lib/noteText";
import { sessionMutation, sessionQuery } from "./lib/session";
import { quietHours } from "./lib/settings";
import { nextAwake } from "./lib/wakingTime";
import { NOTE_TEMPLATES } from "./lib/whatsappTemplates";

export type { NoteKind };

export type NoteView = {
  noteId: Id<"notes">;
  kind: NoteKind;
  juz: number[];
  count: number | null;
  until: number | null;
  /** A rota participant's name, in the organizer notes about them. */
  name?: string | null;
  createdAt: number;
};

export type NotifyArgs = {
  personId: Id<"people">;
  khatmaId: Id<"khatmas">;
  kind: NoteKind;
  juz?: number[];
  count?: number | null;
  until?: number | null;
  name?: string | null;
  assignmentId?: Id<"assignments"> | null;
  roundNumber?: number | null;
};

/**
 * Every message to a member goes through here. Inserts the in-app note at
 * once; when the member has notifications on, also schedules the push (with a
 * push subscription) and the WhatsApp message (opted in) for the next waking
 * moment in their time zone.
 */
export async function notify(
  ctx: MutationCtx,
  n: NotifyArgs,
): Promise<Id<"notes">> {
  const now = Date.now();
  const noteId = await ctx.db.insert("notes", {
    personId: n.personId,
    khatmaId: n.khatmaId,
    kind: n.kind,
    juz: n.juz ?? [],
    count: n.count ?? null,
    until: n.until ?? null,
    name: n.name ?? null,
    assignmentId: n.assignmentId ?? null,
    roundNumber: n.roundNumber ?? null,
    createdAt: now,
    pushedAt: null,
    clearedAt: null,
  });

  const member = await ctx.db
    .query("members")
    .withIndex("by_khatma_person", (q) =>
      q.eq("khatmaId", n.khatmaId).eq("personId", n.personId),
    )
    .first();
  const person = member?.notificationsOn ? await ctx.db.get(n.personId) : null;
  if (!person) return noteId;
  const at = nextAwake(now, person.timeZone, await quietHours(ctx));
  if (person.whatsappNotes && NOTE_TEMPLATES[n.kind] !== null) {
    await ctx.scheduler.runAt(at, internal.whatsappNotes.deliver, { noteId });
  }
  const subscription = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_person", (q) => q.eq("personId", n.personId))
    .first();
  if (!subscription) return noteId;
  await ctx.scheduler.runAt(at, internal.pushNode.deliver, { noteId });
  return noteId;
}

/**
 * Clears notes that no longer apply. By assignment (optionally only some
 * kinds), or, for a batched organizer alert, by taking one juz' out of every
 * uncleared "open for help" alert in the khatma and clearing the alerts that
 * end up empty. Or one person's notes of a kind in a khatma: a member's
 * "behind" invites or cheers, or a rota organizer's unread lists or summaries.
 */
export async function clearNotes(
  ctx: MutationCtx,
  where:
    | { assignmentId: Id<"assignments">; kinds?: NoteKind[] }
    | { khatmaId: Id<"khatmas">; kind: "openForHelp"; juz: number }
    | {
        khatmaId: Id<"khatmas">;
        personId: Id<"people">;
        kind: "behind" | "cheer" | "rotaUnread" | "rotaSummary";
      },
): Promise<void> {
  const now = Date.now();
  if ("assignmentId" in where) {
    const { assignmentId, kinds } = where;
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
      .collect();
    for (const note of notes) {
      if (note.clearedAt !== null) continue;
      if (kinds && !kinds.includes(note.kind)) continue;
      await ctx.db.patch(note._id, { clearedAt: now });
    }
    return;
  }
  if ("personId" in where) {
    // One person's notes of the kind, such as a behind invite that ends once they take a juz'.
    const invites = await ctx.db
      .query("notes")
      .withIndex("by_khatma_kind", (q) =>
        q
          .eq("khatmaId", where.khatmaId)
          .eq("kind", where.kind)
          .eq("clearedAt", null),
      )
      .collect();
    for (const invite of invites) {
      if (invite.personId === where.personId) {
        await ctx.db.patch(invite._id, { clearedAt: now });
      }
    }
    return;
  }
  const alerts = await ctx.db
    .query("notes")
    .withIndex("by_khatma_kind", (q) =>
      q
        .eq("khatmaId", where.khatmaId)
        .eq("kind", where.kind)
        .eq("clearedAt", null),
    )
    .collect();
  for (const alert of alerts) {
    if (!alert.juz.includes(where.juz)) continue;
    const juz = alert.juz.filter((j) => j !== where.juz);
    await ctx.db.patch(alert._id, {
      juz,
      ...(juz.length === 0 ? { clearedAt: now } : {}),
    });
  }
}

/** The caller's uncleared notes in a khatma, newest first. */
export const forKhatma = sessionQuery({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<NoteView[]> => {
    if (!ctx.person) return [];
    const khatma = await khatmaByInviteCode(ctx, args.inviteCode);
    if (!khatma) return [];
    const personId = ctx.person._id;
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_person_khatma", (q) =>
        q
          .eq("personId", personId)
          .eq("khatmaId", khatma._id)
          .eq("clearedAt", null),
      )
      .collect();
    return notes
      .sort(
        (a, b) =>
          b.createdAt - a.createdAt || b._creationTime - a._creationTime,
      )
      .map((n) => ({
        noteId: n._id,
        kind: n.kind,
        juz: n.juz,
        count: n.count,
        until: n.until,
        name: n.name ?? null,
        createdAt: n.createdAt,
      }));
  },
});

/** Clears one of the caller's own notes. */
export const dismiss = sessionMutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    if (!ctx.person) return { ok: false };
    const note = await ctx.db.get(args.noteId);
    if (!note || note.personId !== ctx.person._id) return { ok: false };
    if (note.clearedAt === null) {
      await ctx.db.patch(note._id, { clearedAt: Date.now() });
    }
    return { ok: true };
  },
});
