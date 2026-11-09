import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { scheduleRotaCheer } from "../../cheers";
import { celebrateIfComplete, completeIfDone } from "../../rotaDays";
import { enqueue } from "../../rotaOutbox";
import { changeCompletedDays } from "../directory";
import { isArchived } from "../khatma";
import { readsFor } from "../rota";
import { lastRotaDay, targetDay, type RotaConfig } from "../rotaPlace";
import { localDate } from "../wakingTime";
import { activeParticipant, isActor, type Actor } from "./people";

export type TodayView = {
  day: {
    number: number;
    cycle: number;
    date: string;
    doneCount: number;
    completedAt: number | null;
  } | null;
  next: { number: number; date: string | null };
  paused: boolean;
  archived: boolean;
  /** False until the organizer finishes setup; no day starts before. */
  setupDone: boolean;
  /**
   * When each day's message goes out, in minutes after local midnight, and the
   * khatma's time zone: Today says when the next day starts without the
   * settings, which a co-organizer with only Readings doesn't get.
   */
  dayAt: number;
  timeZone: string;
  tiles: {
    readId: Id<"rotaReads">;
    juz: number;
    state: "done" | "unread" | "reassigned";
    holderName: string | null;
    readerName: string | null;
    readerId: Id<"rotaParticipants"> | null;
    /** What the reader answered to an unread juz': «ليس بعد», or nothing yet; null once done. */
    answer: "notYet" | "none" | null;
    /** The day's second reader of a shared juz', fixed at the day's start. */
    partnerId: Id<"rotaParticipants"> | null;
    partnerName: string | null;
    /** What the partner answered, like `answer`; null once done or when unshared. */
    partnerAnswer: "notYet" | "none" | null;
    /**
     * Who finished the juz' by their own «أتممت» or typed «تم», shared or not.
     * Null for an organizer's mark and while unread. The view is for Readings
     * organizers (and admins) only, so it is no wider than who sees the tile.
     */
    doneByName: string | null;
  }[];
  participants: {
    id: Id<"rotaParticipants">;
    name: string;
    isMe: boolean;
    doneToday: boolean;
  }[];
};

/** The latest reading day: the one open now, or today's if it has closed already. */
async function currentDay(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  timeZone: string,
): Promise<Doc<"rotaDays"> | null> {
  const last = await lastRotaDay(ctx, khatma._id);
  if (!last) return null;
  const isToday = last.date === localDate(Date.now(), timeZone);
  return last.closedAt === null || isToday ? last : null;
}

/**
 * What the reader answered to an unread juz': «ليس بعد», or nothing. Silence is
 * only worth showing for someone who can be messaged.
 */
function answerOf(
  read: Doc<"rotaReads">,
  reader: Doc<"rotaParticipants"> | null | undefined,
  notYetAt: number | null | undefined = read.notYetAt,
): "notYet" | "none" | null {
  if (read.doneAt !== null) return null;
  if (notYetAt != null) return "notYet";
  return reader &&
    reader.removedAt === null &&
    reader.joinedAt != null &&
    reader.stoppedAt == null &&
    reader.silencedAt == null
    ? "none"
    : null;
}

/** The day's 30 reads, the next day and who has finished, for the Today screen. */
export async function today(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  actor: Actor,
): Promise<TodayView> {
  const target = await targetDay(ctx, khatma);
  const day = await currentDay(ctx, khatma, rota.timeZone);
  const reads = day
    ? await ctx.db
        .query("rotaReads")
        .withIndex("by_day_juz", (q) => q.eq("dayId", day._id))
        .collect()
    : [];
  const everyone = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
    .collect();
  const byId = new Map(everyone.map((p) => [p._id, p]));
  const nameOf = (id: Id<"rotaParticipants"> | null) =>
    (id && byId.get(id)?.name) || null;

  const tiles = reads.map((r) => ({
    readId: r._id,
    juz: r.juz,
    state:
      r.doneAt !== null
        ? ("done" as const)
        : r.readerId !== r.holderId
          ? ("reassigned" as const)
          : ("unread" as const),
    holderName: nameOf(r.holderId),
    readerName: nameOf(r.readerId),
    readerId: r.readerId,
    answer: answerOf(r, r.readerId && byId.get(r.readerId)),
    partnerId: r.partnerId ?? null,
    partnerName: nameOf(r.partnerId ?? null),
    // A partner of a reassigned juz' has been told it is read for them.
    partnerAnswer:
      r.partnerId != null && r.reassignedAt === null
        ? answerOf(r, byId.get(r.partnerId), r.partnerNotYetAt)
        : null,
    doneByName: nameOf(r.doneById ?? null),
  }));
  const participants = everyone
    .filter((p) => p.removedAt === null)
    .sort((a, b) => a.addedAt - b.addedAt || a._creationTime - b._creationTime)
    .map((p) => {
      const mine = reads.filter((r) => readsFor(r, p._id));
      return {
        id: p._id,
        name: p.name,
        isMe: isActor(p, actor),
        doneToday: mine.length > 0 && mine.every((r) => r.doneAt !== null),
      };
    });
  return {
    day: day
      ? {
          number: day.number,
          cycle: day.cycle,
          date: day.date,
          doneCount: reads.filter((r) => r.doneAt !== null).length,
          completedAt: day.completedAt,
        }
      : null,
    next: { number: target.number, date: target.date },
    paused: rota.pausedAt !== null,
    archived: isArchived(khatma),
    setupDone: rota.setupDoneAt !== null,
    dayAt: rota.messages.dayAt,
    timeZone: rota.timeZone,
    tiles,
    participants,
  };
}

/** A read of this khatma and its day, or null when it is not one of this khatma's. */
async function readOf(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  readId: Id<"rotaReads">,
): Promise<{ read: Doc<"rotaReads">; day: Doc<"rotaDays"> } | null> {
  const read = await ctx.db.get(readId);
  if (!read || read.khatmaId !== khatma._id) return null;
  const day = await ctx.db.get(read.dayId);
  return day ? { read, day } : null;
}

export async function reassign(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: {
    readId: Id<"rotaReads">;
    participantId: Id<"rotaParticipants">;
  },
): Promise<{ ok: true } | { error: "not_found" | "closed" | "done" }> {
  const found = await readOf(ctx, khatma, args.readId);
  const participant = await activeParticipant(
    ctx,
    khatma._id,
    args.participantId,
  );
  if (!found || !participant) return { error: "not_found" };
  if (found.day.closedAt !== null) return { error: "closed" };
  if (found.read.doneAt !== null) return { error: "done" };
  const previousId = found.read.readerId;
  await ctx.db.patch(found.read._id, {
    readerId: participant._id,
    reassignedAt: Date.now(),
    // The new reader hasn't answered, and the partner's answer was to the old arrangement.
    notYetAt: null,
    partnerNotYetAt: null,
  });
  const row = {
    khatmaId: khatma._id,
    dayId: found.day._id,
    juz: [found.read.juz],
    number: found.day.number,
  };
  await enqueue(ctx, {
    ...row,
    participantId: participant._id,
    kind: "assigned",
  });
  // Whoever had it until now (the holder, or a reader it was reassigned to) is
  // covered, if they ever heard of it: the day's message may not have gone yet.
  const told = found.day.juzSentAt !== null || found.read.reassignedAt !== null;
  if (previousId !== null && previousId !== participant._id && told) {
    await enqueue(ctx, {
      ...row,
      participantId: previousId,
      kind: "covered",
    });
  }
  // A shared juz's second reader is covered too, once: on its first
  // reassignment. If that went to them they are covered later, as the previous
  // reader.
  const partnerId = found.read.partnerId;
  if (
    partnerId != null &&
    found.read.reassignedAt === null &&
    found.day.juzSentAt !== null &&
    partnerId !== previousId &&
    partnerId !== participant._id
  ) {
    await enqueue(ctx, { ...row, participantId: partnerId, kind: "covered" });
  }
  return { ok: true };
}

export async function markDone(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { readId: Id<"rotaReads"> },
  actor: Actor,
): Promise<
  { ok: true; completed: boolean } | { error: "not_found" | "closed" }
> {
  const found = await readOf(ctx, khatma, args.readId);
  if (!found) return { error: "not_found" };
  if (found.day.closedAt !== null) return { error: "closed" };
  const now = Date.now();
  if (found.read.doneAt === null) {
    await ctx.db.patch(found.read._id, {
      doneAt: now,
      doneByOrganizer: true,
      doneById: null,
    });
    await scheduleRotaCheer(ctx, found.read._id, now, null);
  }
  // The organizer marking their own juz' is their reply: they never go silent.
  // That includes one they share as its second reader, while they still read it.
  const { partnerId } = found.read;
  const mine = [found.read.readerId, found.read.holderId];
  if (partnerId != null && readsFor(found.read, partnerId)) {
    mine.push(partnerId);
  }
  for (const id of new Set(mine)) {
    const own = id ? await ctx.db.get(id) : null;
    if (own && isActor(own, actor)) {
      await ctx.db.patch(own._id, {
        lastReplyAt: now,
        silentDays: 0,
        silencedAt: null,
      });
      // Their mark answers a juz' they share, so a later «تم» isn't drawn back
      // to this day for its thanks. The other reader is still owed theirs.
      const thanked = found.read.thankedIds ?? [];
      if (
        partnerId != null &&
        readsFor(found.read, own._id) &&
        !thanked.includes(own._id)
      ) {
        await ctx.db.patch(found.read._id, {
          thankedIds: [...thanked, own._id],
        });
      }
    }
  }
  const completed = await completeIfDone(ctx, found.day._id);
  if (completed) await celebrateIfComplete(ctx, found.day._id);
  return { ok: true, completed };
}

export async function markNotDone(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { readId: Id<"rotaReads"> },
): Promise<{ ok: true } | { error: "not_found" | "closed" }> {
  const found = await readOf(ctx, khatma, args.readId);
  if (!found) return { error: "not_found" };
  if (found.day.closedAt !== null) return { error: "closed" };
  await ctx.db.patch(found.read._id, {
    doneAt: null,
    doneByOrganizer: false,
    doneById: null,
    thankedIds: [],
  });
  if (found.day.completedAt !== null) {
    await ctx.db.patch(found.day._id, { completedAt: null });
    await changeCompletedDays(ctx, found.day.khatmaId, -1);
  }
  return { ok: true };
}
