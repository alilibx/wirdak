import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { alertOrganizer, isHeld, scheduleGrace } from "./grace";
import { refreshPerson, refreshPhone } from "./lib/directory";
import { isArchived } from "./lib/khatma";
import { lastRotaDay } from "./lib/rotaPlace";
import { sessionMutation } from "./lib/session";
import { requireOrganizer } from "./organizer";
import { roundAssignments } from "./rounds";

/** Rows one `purgeRows` run handles. */
const PURGE_BATCH = 200;

/**
 * Stops a khatma and leaves it read-only: its uncleared notes go, and a rota
 * khatma's unsent messages are skipped, all but the cycle thank-you, which is
 * for reading already finished. Its open join requests are declined, since
 * nobody can answer them now. Its open day closes, so a late reply can't
 * change it. Does nothing for one already archived.
 */
export async function archiveKhatma(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
): Promise<void> {
  if (isArchived(khatma)) return;
  const now = Date.now();
  const notes = await ctx.db
    .query("notes")
    .withIndex("by_khatma_kind", (q) => q.eq("khatmaId", khatma._id))
    .filter((q) => q.eq(q.field("clearedAt"), null))
    .collect();
  for (const note of notes) await ctx.db.patch(note._id, { clearedAt: now });
  if (!khatma.rota) {
    await ctx.db.patch(khatma._id, { archivedAt: now });
    return;
  }
  await ctx.db.patch(khatma._id, {
    rota: { ...khatma.rota, archivedAt: now },
  });
  const unsent = await ctx.db
    .query("rotaOutbox")
    .withIndex("by_khatma_unsent", (q) =>
      q.eq("khatmaId", khatma._id).eq("sentAt", null).eq("skippedAt", null),
    )
    .collect();
  for (const row of unsent) {
    if (row.kind !== "cycle") await ctx.db.patch(row._id, { skippedAt: now });
  }
  const requests = await ctx.db
    .query("rotaJoinRequests")
    .withIndex("by_khatma_open", (q) =>
      q.eq("khatmaId", khatma._id).eq("resolvedAt", null),
    )
    .collect();
  for (const request of requests) {
    await ctx.db.patch(request._id, {
      resolvedAt: now,
      outcome: "declined",
      declinedBy: "organizer",
    });
  }
  const day = await lastRotaDay(ctx, khatma._id);
  if (day && day.closedAt === null) {
    await ctx.db.patch(day._id, { closedAt: now });
  }
}

/**
 * Reopens an archived pool khatma: the one exception to "an archived khatma can
 * only be read, and deleted" (admin spec 6). Nobody could finish or extend a
 * juz' while it was archived, so a hold's grace paused too: it gets the time it
 * had left, on new jobs. A round that reached 30 ajza' gets its completion back.
 * Notes the archive cleared stay cleared, apart from the alert for a juz' still
 * open for help.
 */
export async function restoreKhatma(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
): Promise<void> {
  await ctx.db.patch(khatma._id, { archivedAt: null });
  const roundId = khatma.currentRoundId;
  if (!roundId) return;
  const paused = Date.now() - (khatma.archivedAt ?? Date.now());
  for (const hold of (await roundAssignments(ctx, roundId)).filter(isHeld)) {
    if (hold.openedForHelpAt !== null) {
      await alertOrganizer(ctx, khatma, hold.juz, hold.personId);
      continue;
    }
    const noticeAt = hold.noticeAt + paused;
    const graceEndsAt = hold.graceEndsAt + paused;
    await ctx.db.patch(hold._id, { noticeAt, graceEndsAt });
    await scheduleGrace(ctx, hold._id, noticeAt, graceEndsAt);
  }
  await ctx.scheduler.runAfter(0, internal.rounds.completeIfReady, { roundId });
}

export const archive = sessionMutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { khatma } = await requireOrganizer(ctx, args.inviteCode);
    await archiveKhatma(ctx, khatma);
    return { ok: true };
  },
});

/**
 * Deletes the khatma and its members at once, so its link and its place in
 * everyone's list go now. `purgeRows` takes the rest in batches.
 */
export async function deleteKhatma(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
): Promise<void> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
    .collect();
  for (const member of members) await ctx.db.delete(member._id);
  await ctx.db.delete(khatma._id);
  for (const personId of new Set([
    khatma.creatorPersonId,
    ...members.map((m) => m.personId),
  ])) {
    await refreshPerson(ctx, personId);
  }
  await ctx.scheduler.runAfter(0, internal.khatmaLifecycle.purgeRows, {
    khatmaId: khatma._id,
    stage: 0,
  });
}

export const remove = sessionMutation({
  args: { inviteCode: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "not_archived" }> => {
    const { khatma } = await requireOrganizer(ctx, args.inviteCode);
    if (!isArchived(khatma)) return { error: "not_archived" };
    await deleteKhatma(ctx, khatma);
    return { ok: true };
  },
});

type Purge = (
  ctx: MutationCtx,
  khatmaId: Id<"khatmas">,
) => Promise<{ _id: Id<TableNames>; phone?: string }[]>;

/**
 * The next rows of a deleted khatma for each stage to delete. Finished
 * `assignments` stay: a member's juz' count, pace and streak are read from them.
 */
const PURGE_STAGES: Purge[] = [
  (ctx, khatmaId) =>
    ctx.db
      .query("rounds")
      .withIndex("by_khatma_number", (q) => q.eq("khatmaId", khatmaId))
      .take(PURGE_BATCH),
  (ctx, khatmaId) =>
    ctx.db
      .query("assignments")
      .withIndex("by_khatma_finishedAt", (q) =>
        q.eq("khatmaId", khatmaId).eq("finishedAt", null),
      )
      .take(PURGE_BATCH),
  (ctx, khatmaId) =>
    ctx.db
      .query("notes")
      .withIndex("by_khatma_kind", (q) => q.eq("khatmaId", khatmaId))
      .take(PURGE_BATCH),
  (ctx, khatmaId) =>
    ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .take(PURGE_BATCH),
  (ctx, khatmaId) =>
    ctx.db
      .query("rotaSlots")
      .withIndex("by_khatma_slot", (q) => q.eq("khatmaId", khatmaId))
      .take(PURGE_BATCH),
  (ctx, khatmaId) =>
    ctx.db
      .query("rotaDays")
      .withIndex("by_khatma_n", (q) => q.eq("khatmaId", khatmaId))
      .take(PURGE_BATCH),
  (ctx, khatmaId) =>
    ctx.db
      .query("rotaReads")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .take(PURGE_BATCH),
  (ctx, khatmaId) =>
    ctx.db
      .query("rotaOutbox")
      .withIndex("by_khatma_unsent", (q) => q.eq("khatmaId", khatmaId))
      .take(PURGE_BATCH),
  (ctx, khatmaId) =>
    ctx.db
      .query("rotaJoinRequests")
      .withIndex("by_khatma_open", (q) => q.eq("khatmaId", khatmaId))
      .take(PURGE_BATCH),
];

/**
 * Removes a deleted khatma's rows, `PURGE_BATCH` at a time, one stage after
 * another (`stage` indexes `PURGE_STAGES`), rescheduling itself until none are
 * left. Last, its help requests lose their link to it: they outlive it.
 */
export const purgeRows = internalMutation({
  args: { khatmaId: v.id("khatmas"), stage: v.number() },
  handler: async (ctx, args) => {
    const { khatmaId, stage } = args;
    const next = (nextStage: number) =>
      ctx.scheduler.runAfter(0, internal.khatmaLifecycle.purgeRows, {
        khatmaId,
        stage: nextStage,
      });

    const purge = PURGE_STAGES[stage];
    if (purge) {
      const rows = await purge(ctx, khatmaId);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        // A participant's phone reads one khatma fewer now.
        if (row.phone !== undefined) await refreshPhone(ctx, row.phone);
      }
      await next(rows.length === PURGE_BATCH ? stage : stage + 1);
      return;
    }

    const help = await ctx.db
      .query("helpRequests")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .take(PURGE_BATCH);
    for (const request of help) {
      await ctx.db.patch(request._id, { khatmaId: null });
    }
    if (help.length === PURGE_BATCH) await next(stage);
  },
});
