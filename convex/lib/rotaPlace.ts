import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isArchived } from "./khatma";
import {
  addDays,
  khatmaNumber,
  nextReadingDates,
  ROTA_SIZE,
  slotFor,
} from "./rota";
import { getSetting } from "./settings";
import { instantAt, localDate } from "./wakingTime";

/** The next reading day that has not started: where new people and changes to the ajza' land. */
export type TargetDay = {
  /** The day's count across the whole khatma, from 1. */
  n: number;
  /** Its khatma number within the cycle, 1 to 30. */
  number: number;
  /** Its reading date, or null while the khatma is paused, archived, or has no more days. */
  date: string | null;
  started: false;
};

export type RotaConfig = NonNullable<Doc<"khatmas">["rota"]>;

/** The rota settings of a khatma that has them (a pool khatma never reaches here). */
function rotaOf(khatma: Doc<"khatmas">) {
  if (khatma.kind !== "rota" || !khatma.rota) {
    throw new Error("not a rota khatma");
  }
  return khatma.rota;
}

/** The latest started reading day of the khatma, or null before the first. */
export function lastRotaDay(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<Doc<"rotaDays"> | null> {
  return ctx.db
    .query("rotaDays")
    .withIndex("by_khatma_n", (q) => q.eq("khatmaId", khatmaId))
    .order("desc")
    .first();
}

/** When the reading day dated `date` ends: the next midnight in `timeZone`. */
export function dayEnd(date: string, timeZone: string): number {
  return instantAt(addDays(date, 1), 0, timeZone);
}

/** How long after midnight a late «أتممت» counts for this khatma. */
export async function lateTapOf(
  ctx: QueryCtx,
  rota: RotaConfig,
): Promise<number> {
  return rota.lateTapMs ?? (await getSetting(ctx, "rotaLateTapMs"));
}

/**
 * The first date a khatma's first day may start: tomorrow while it is still
 * being set up or was started today, when `startsNextDay` asks for that. A
 * khatma from before setup was tracked, or with a day behind it, has no floor.
 */
export function firstDayFloor(
  rota: RotaConfig,
  last: Doc<"rotaDays"> | null,
  today: string,
  startsNextDay: boolean,
): string {
  if (last || !startsNextDay || rota.setupDoneAt === undefined) return today;
  const startedOn =
    rota.setupDoneAt === null
      ? today
      : localDate(rota.setupDoneAt, rota.timeZone);
  return startedOn >= today ? addDays(today, 1) : today;
}

/** The first date a brand new rota khatma may have. */
export async function earliestFirstDate(
  ctx: QueryCtx,
  today: string,
): Promise<string> {
  return (await getSetting(ctx, "rotaStartNextDay"))
    ? addDays(today, 1)
    : today;
}

/**
 * The first date a day may still start on: today or the first date, whichever
 * is later, not before `firstDayFloor`, and always after the last started day.
 * Days only go forward, which a time zone moved west could otherwise break.
 */
export async function earliestOpenDate(
  ctx: QueryCtx,
  rota: RotaConfig,
  last: Doc<"rotaDays"> | null,
  today: string,
): Promise<string> {
  const floor = firstDayFloor(
    rota,
    last,
    today,
    await getSetting(ctx, "rotaStartNextDay"),
  );
  const from = floor > rota.firstDate ? floor : rota.firstDate;
  return last && from <= last.date ? addDays(last.date, 1) : from;
}

export async function targetDay(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
): Promise<TargetDay> {
  const rota = rotaOf(khatma);
  const last = await lastRotaDay(ctx, khatma._id);
  const n = (last?.n ?? 0) + 1;
  if (rota.pausedAt !== null || isArchived(khatma)) {
    return { n, number: khatmaNumber(n), date: null, started: false };
  }
  const from = await earliestOpenDate(
    ctx,
    rota,
    last,
    localDate(Date.now(), rota.timeZone),
  );
  // `from` is after the last started day, so no started day has the first
  // reading date that remains (pause dates left out).
  const [date] = nextReadingDates(
    rota.days,
    rota.firstDate,
    from,
    1,
    new Set(rota.pauseDates),
  );
  if (date === undefined || (rota.endDate !== null && date > rota.endDate)) {
    return { n, number: khatmaNumber(n), date: null, started: false };
  }
  return { n, number: khatmaNumber(n), date, started: false };
}

/** The slot rows of one khatma number by juz': its first readers' and its second readers'. */
export type SlotRows = {
  first: Map<number, Doc<"rotaSlots">>;
  second: Map<number, Doc<"rotaSlots">>;
};

/** Who reads each juz' of khatma `number`, from one read of the khatma's slots. */
export async function slotRows(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  number: number,
): Promise<SlotRows> {
  const slots = await ctx.db
    .query("rotaSlots")
    .withIndex("by_khatma_slot", (q) => q.eq("khatmaId", khatmaId))
    .collect();
  const firstBySlot = new Map<number, Doc<"rotaSlots">>();
  const secondBySlot = new Map<number, Doc<"rotaSlots">>();
  for (const s of slots) {
    (s.second === true ? secondBySlot : firstBySlot).set(s.slot, s);
  }
  const rows: SlotRows = { first: new Map(), second: new Map() };
  for (let juz = 1; juz <= ROTA_SIZE; juz++) {
    const slot = slotFor(juz, number);
    const first = firstBySlot.get(slot);
    const second = secondBySlot.get(slot);
    if (first) rows.first.set(juz, first);
    if (second) rows.second.set(juz, second);
  }
  return rows;
}

/** Who holds each juz' of khatma `number`: the slot's first reader, if any. */
export async function slotRowsByJuz(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  number: number,
): Promise<Map<number, Doc<"rotaSlots">>> {
  return (await slotRows(ctx, khatmaId, number)).first;
}

/** Whether a slot may take a second reader: sharing is on (`sharingOn`) and all 30 have a reader. */
export function sharingOpen(sharingOn: boolean, rows: SlotRows): boolean {
  return sharingOn && rows.first.size === ROTA_SIZE;
}

/**
 * Takes a reader off their slot. When the first reader of a shared slot
 * leaves, the second becomes its only reader, so the juz' never shows empty
 * while someone holds it.
 */
export async function leaveSlot(
  ctx: MutationCtx,
  row: Doc<"rotaSlots">,
): Promise<void> {
  await ctx.db.delete(row._id);
  if (row.second === true) return;
  const partner = (
    await ctx.db
      .query("rotaSlots")
      .withIndex("by_khatma_slot", (q) =>
        q.eq("khatmaId", row.khatmaId).eq("slot", row.slot),
      )
      .collect()
  ).find((s) => s.second === true);
  if (partner) await ctx.db.patch(partner._id, { second: undefined });
}

/**
 * How many of a participant's slot rows count toward `rotaMaxSlotsPerPerson`:
 * a slot they share as its second reader counts only while
 * `rotaHalfCountsAsSlot` is on (`countsSecond`).
 */
export function countHeld(
  rows: Doc<"rotaSlots">[],
  countsSecond: boolean,
): number {
  return countsSecond
    ? rows.length
    : rows.filter((r) => r.second !== true).length;
}

/** The slot rows a participant holds, in every khatma number. */
export function slotsOf(
  ctx: QueryCtx,
  participantId: Id<"rotaParticipants">,
): Promise<Doc<"rotaSlots">[]> {
  return ctx.db
    .query("rotaSlots")
    .withIndex("by_participant", (q) => q.eq("participantId", participantId))
    .collect();
}

/** How many slots a participant holds toward `rotaMaxSlotsPerPerson`, as `countHeld` counts them. */
export async function heldSlotCount(
  ctx: QueryCtx,
  participantId: Id<"rotaParticipants">,
): Promise<number> {
  return countHeld(
    await slotsOf(ctx, participantId),
    await getSetting(ctx, "rotaHalfCountsAsSlot"),
  );
}
