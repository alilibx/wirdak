import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  cheerSetting,
  isValidCheer,
  type CheerConfig,
  type CheerSetting,
} from "../cheer";
import { nameFields } from "../directory";
import { isArchived } from "../khatma";
import {
  addDays,
  isDate,
  isReadingDate,
  isValidReadingDays,
  messageTimesError,
  nextReadingDates,
  type ReadingDays,
  type RotaMessages,
} from "../rota";
import { earliestOpenDate, lastRotaDay, type RotaConfig } from "../rotaPlace";
import { quietHours } from "../settings";
import { cleanKhatmaName } from "../text";
import { instantAt, localDate, safeTimeZone } from "../wakingTime";

/** How many reading dates the pause-date picker offers. */
const UPCOMING_DATES = 8;

export type SettingsView = {
  name: string;
  days: ReadingDays;
  firstDate: string;
  firstDatePassed: boolean;
  endDate: string | null;
  timeZone: string;
  messages: RotaMessages;
  pausedAt: number | null;
  pauseDates: string[];
  /** The next reading dates that can still be paused or un-paused. */
  upcoming: string[];
  quiet: { startHour: number; endHour: number };
  cheer: CheerSetting;
  /** An archived khatma can no longer be changed. */
  archived: boolean;
};

/** The first date has passed, or its day has started: it can't move any more. */
async function firstDatePassed(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  today: string,
): Promise<boolean> {
  return (
    rota.firstDate < today || (await lastRotaDay(ctx, khatma._id)) !== null
  );
}

/** The rota settings behind the settings sheet. */
export async function settings(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
): Promise<SettingsView> {
  const today = localDate(Date.now(), rota.timeZone);
  const from = earliestOpenDate(
    rota,
    await lastRotaDay(ctx, khatma._id),
    today,
  );
  const quiet = await quietHours(ctx);
  return {
    name: khatma.name ?? "",
    days: rota.days,
    firstDate: rota.firstDate,
    firstDatePassed: await firstDatePassed(ctx, khatma, rota, today),
    endDate: rota.endDate,
    timeZone: rota.timeZone,
    messages: rota.messages,
    pausedAt: rota.pausedAt,
    pauseDates: rota.pauseDates,
    upcoming: nextReadingDates(
      rota.days,
      rota.firstDate,
      from,
      UPCOMING_DATES,
      new Set(),
    ).filter((date) => rota.endDate === null || date <= rota.endDate),
    quiet: { startHour: quiet.startHour, endHour: quiet.endHour },
    cheer: await cheerSetting(ctx, khatma),
    archived: isArchived(khatma),
  };
}

export async function update(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  args: {
    name?: string | null;
    days?: ReadingDays;
    firstDate?: string;
    endDate?: string | null;
    timeZone?: string;
    messages?: RotaMessages;
    /** The khatma's own cheer settings; null goes back to the admin's defaults. */
    cheer?: CheerConfig | null;
  },
): Promise<
  | { ok: true }
  | {
      error:
        | "invalid_days"
        | "invalid_dates"
        | "first_date_passed"
        | "invalid_times"
        | "invalid_zone"
        | "invalid_name"
        | "invalid_cheer";
    }
> {
  // A rota khatma always has a name, as at creation.
  const name = args.name === undefined ? undefined : cleanKhatmaName(args.name);
  if (name === null) return { error: "invalid_name" };
  if (args.cheer && !isValidCheer(args.cheer)) {
    return { error: "invalid_cheer" };
  }
  if (args.days !== undefined && !isValidReadingDays(args.days)) {
    return { error: "invalid_days" };
  }
  if (
    args.timeZone !== undefined &&
    safeTimeZone(args.timeZone) !== args.timeZone
  ) {
    return { error: "invalid_zone" };
  }

  const days = args.days ?? rota.days;
  const timeZone = args.timeZone ?? rota.timeZone;
  const firstDate = args.firstDate ?? rota.firstDate;
  const endDate = args.endDate === undefined ? rota.endDate : args.endDate;
  const today = localDate(Date.now(), timeZone);
  if (
    !isDate(firstDate) ||
    (endDate !== null && (!isDate(endDate) || endDate < firstDate))
  ) {
    return { error: "invalid_dates" };
  }
  // An end date behind today or the last started day would archive the
  // khatma for good, and so would one that no reading date reaches. Days and
  // the time zone move both, so they are checked together with the end date.
  if (
    endDate !== null &&
    (args.days !== undefined ||
      args.timeZone !== undefined ||
      args.endDate !== undefined)
  ) {
    const last = await lastRotaDay(ctx, khatma._id);
    if (endDate < today || (last && endDate < last.date)) {
      return { error: "invalid_dates" };
    }
    // From the first open date, a reading date must remain on or before the
    // end date. (None is left only when the end date is the last started day.)
    const from = earliestOpenDate({ ...rota, firstDate }, last, today);
    if (from <= endDate) {
      const [next] = nextReadingDates(days, firstDate, from, 1, new Set());
      if (next === undefined || next > endDate) {
        return { error: "invalid_dates" };
      }
    }
  }
  const passed = await firstDatePassed(ctx, khatma, rota, today);
  if (passed && firstDate !== rota.firstDate) {
    return { error: "first_date_passed" };
  }
  // A first date still ahead must be a reading date; one behind us is what it is.
  if (
    !passed &&
    (firstDate < today || !isReadingDate(days, firstDate, firstDate))
  ) {
    return { error: "invalid_dates" };
  }

  if (args.messages !== undefined) {
    const quiet = await quietHours(ctx);
    if (messageTimesError(args.messages, quiet.startHour, quiet.endHour)) {
      return { error: "invalid_times" };
    }
  }

  await ctx.db.patch(khatma._id, {
    ...(name !== undefined ? nameFields(name) : {}),
    ...(args.cheer !== undefined ? { cheer: args.cheer ?? undefined } : {}),
    rota: {
      ...rota,
      days,
      firstDate,
      endDate,
      timeZone,
      messages: args.messages ?? rota.messages,
    },
  });

  // The open day closes at the next day's start time, which may just have moved.
  if (args.messages !== undefined || args.timeZone !== undefined) {
    const last = await lastRotaDay(ctx, khatma._id);
    if (last && last.closedAt === null) {
      await ctx.db.patch(last._id, {
        closesAt: instantAt(
          addDays(last.date, 1),
          (args.messages ?? rota.messages).dayAt,
          timeZone,
        ),
      });
    }
  }
  return { ok: true };
}

export async function setPaused(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  args: { paused: boolean },
): Promise<{ ok: true }> {
  const pausedAt = args.paused ? (rota.pausedAt ?? Date.now()) : null;
  await ctx.db.patch(khatma._id, { rota: { ...rota, pausedAt } });
  return { ok: true };
}

export async function addPauseDate(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  args: { date: string },
): Promise<{ ok: true } | { error: "not_reading_date" | "past" }> {
  if (
    !isDate(args.date) ||
    !isReadingDate(rota.days, rota.firstDate, args.date) ||
    (rota.endDate !== null && args.date > rota.endDate)
  ) {
    return { error: "not_reading_date" };
  }
  const started = await ctx.db
    .query("rotaDays")
    .withIndex("by_khatma_date", (q) =>
      q.eq("khatmaId", khatma._id).eq("date", args.date),
    )
    .first();
  if (started || args.date < localDate(Date.now(), rota.timeZone)) {
    return { error: "past" };
  }
  if (!rota.pauseDates.includes(args.date)) {
    await ctx.db.patch(khatma._id, {
      rota: { ...rota, pauseDates: [...rota.pauseDates, args.date].sort() },
    });
  }
  return { ok: true };
}

export async function removePauseDate(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  args: { date: string },
): Promise<{ ok: true } | { error: "not_reading_date" | "past" }> {
  if (!isDate(args.date)) return { error: "not_reading_date" };
  if (args.date < localDate(Date.now(), rota.timeZone)) {
    return { error: "past" };
  }
  if (rota.pauseDates.includes(args.date)) {
    await ctx.db.patch(khatma._id, {
      rota: {
        ...rota,
        pauseDates: rota.pauseDates.filter((d) => d !== args.date),
      },
    });
  }
  return { ok: true };
}
