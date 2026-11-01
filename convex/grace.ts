import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { isArchived } from "./lib/khatma";
import { clearNotes, notify } from "./notes";
import { getSetting, quietHours } from "./lib/settings";
import { nextAwake } from "./lib/wakingTime";

/** Neither finished nor released: the reader still has it (opened for help or not). */
export function isHeld(a: Doc<"assignments">): boolean {
  return a.finishedAt === null && a.releasedAt === null;
}

/**
 * Tells the organizer a juz' went back to the pool, in words that never say
 * why (timeout and "I can't finish it" read the same, spec 3.3/3.4). Skipped
 * when the organizer is the one it happened to or the one who released it.
 * Ajza' within `openForHelpBatchMs` of an uncleared alert join that alert;
 * if its push already went out, the alert is pushed again at the next waking
 * moment so the new juz' reaches the organizer too.
 */
export async function alertOrganizer(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  juz: number,
  actorPersonId: Id<"people">,
): Promise<void> {
  const organizerId = khatma.creatorPersonId;
  if (organizerId === actorPersonId) return;

  const now = Date.now();
  const alerts = (
    await ctx.db
      .query("notes")
      .withIndex("by_khatma_kind", (q) =>
        q
          .eq("khatmaId", khatma._id)
          .eq("kind", "openForHelp")
          .eq("clearedAt", null),
      )
      .collect()
  ).filter((n) => n.personId === organizerId);
  // the organizer already has this juz' in front of them
  if (alerts.some((n) => n.juz.includes(juz))) return;

  const batchMs = await getSetting(ctx, "openForHelpBatchMs");
  const batch = alerts
    .filter((n) => now - n.createdAt < batchMs)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!batch) {
    await notify(ctx, {
      personId: organizerId,
      khatmaId: khatma._id,
      kind: "openForHelp",
      juz: [juz],
    });
    return;
  }

  await ctx.db.patch(batch._id, {
    juz: [...batch.juz, juz].sort((a, b) => a - b),
  });
  // A push still waiting reads the list when it's delivered; one already sent
  // didn't carry this juz'.
  if (batch.pushedAt === null) return;
  const organizer = await ctx.db.get(organizerId);
  if (!organizer) return;
  await ctx.scheduler.runAt(
    nextAwake(now, organizer.timeZone, await quietHours(ctx)),
    internal.pushNode.deliver,
    { noteId: batch._id },
  );
}

/**
 * Opens a held juz' for help now: everyone but its reader sees it as open,
 * the reader's "almost up", reminder and cheer notes go, and the organizer is told.
 * The reader keeps holding it until they finish or someone else takes it.
 */
export async function openForHelpNow(
  ctx: MutationCtx,
  assignment: Doc<"assignments">,
): Promise<void> {
  await ctx.db.patch(assignment._id, { openedForHelpAt: Date.now() });
  await clearNotes(ctx, {
    assignmentId: assignment._id,
    kinds: ["almostUp", "reminder"],
  });
  await clearNotes(ctx, {
    khatmaId: assignment.khatmaId,
    personId: assignment.personId,
    kind: "cheer",
  });
  const khatma = await ctx.db.get(assignment.khatmaId);
  if (khatma) {
    await alertOrganizer(ctx, khatma, assignment.juz, assignment.personId);
  }
}

/** Schedules the "almost up" note and the grace end of a fresh hold. */
export async function scheduleGrace(
  ctx: MutationCtx,
  assignmentId: Id<"assignments">,
  noticeAt: number,
  endsAt: number,
): Promise<void> {
  await ctx.scheduler.runAt(noticeAt, internal.grace.noticeDue, {
    assignmentId,
  });
  await ctx.scheduler.runAt(endsAt, internal.grace.endDue, {
    assignmentId,
    endsAt,
  });
}

/** Whether a job for a hold still has a khatma to act on: it exists and isn't archived. */
async function khatmaIsLive(
  ctx: MutationCtx,
  khatmaId: Id<"khatmas">,
): Promise<boolean> {
  const khatma = await ctx.db.get(khatmaId);
  return khatma !== null && !isArchived(khatma);
}

/** Sends the reader's private "almost up" note, once, while it still applies. */
export const noticeDue = internalMutation({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.assignmentId);
    if (
      !a ||
      !isHeld(a) ||
      a.extended ||
      a.openedForHelpAt !== null ||
      a.noticeSentAt !== null ||
      // A job from before an archive: `restoreKhatma` queued one for the new time.
      a.noticeAt > Date.now()
    ) {
      return;
    }
    if (!(await khatmaIsLive(ctx, a.khatmaId))) return;
    await ctx.db.patch(a._id, { noticeSentAt: Date.now() });
    await notify(ctx, {
      personId: a.personId,
      khatmaId: a.khatmaId,
      kind: "almostUp",
      juz: [a.juz],
      assignmentId: a._id,
    });
  },
});

/**
 * What `endDue` does for a job scheduled for `endsAt`: open the juz' unless the
 * job is stale (the end has moved), the row is no longer held or already open,
 * or its khatma is archived or deleted.
 */
export async function endGraceIfDue(
  ctx: MutationCtx,
  a: Doc<"assignments">,
  endsAt: number,
): Promise<void> {
  if (!isHeld(a) || a.openedForHelpAt !== null || a.graceEndsAt !== endsAt) {
    return;
  }
  if (!(await khatmaIsLive(ctx, a.khatmaId))) return;
  await openForHelpNow(ctx, a);
}

/**
 * Opens the juz' for help when its grace ends. `endsAt` is the end this job
 * was scheduled for; a job for an end that has since moved (an extension) is
 * stale and does nothing, as does one for a row no longer held or already
 * opened.
 */
export const endDue = internalMutation({
  args: { assignmentId: v.id("assignments"), endsAt: v.number() },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.assignmentId);
    if (a) await endGraceIfDue(ctx, a, args.endsAt);
  },
});
