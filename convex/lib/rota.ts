import { v } from "convex/values";

/** Which days a rota khatma is read on. Weekday 0 is Sunday, days are 1 to 31. */
export type ReadingDays =
  | { kind: "daily" }
  | { kind: "weekly"; weekdays: number[]; everyWeeks: 1 | 2 }
  | { kind: "monthly"; days: number[] };

/** How often a khatma is read, as one word: weekly every two weeks is `biweekly`. */
export type ReadingDaysKind = "daily" | "weekly" | "biweekly" | "monthly";

export function readingDaysKind(days: ReadingDays): ReadingDaysKind {
  if (days.kind === "weekly" && days.everyWeeks === 2) return "biweekly";
  return days.kind;
}

export const readingDaysValidator = v.union(
  v.object({ kind: v.literal("daily") }),
  v.object({
    kind: v.literal("weekly"),
    weekdays: v.array(v.number()),
    everyWeeks: v.union(v.literal(1), v.literal(2)),
  }),
  v.object({ kind: v.literal("monthly"), days: v.array(v.number()) }),
);

/** Minutes after local midnight at which each rota message goes out. */
export type RotaMessages = {
  dayAt: number;
  reminder: { at: number; on: boolean };
  unread: { at: number; on: boolean };
  summary: { at: number; on: boolean };
};

const timedMessage = v.object({ at: v.number(), on: v.boolean() });

export const rotaMessagesValidator = v.object({
  dayAt: v.number(),
  reminder: timedMessage,
  unread: timedMessage,
  summary: timedMessage,
});

/** A rota khatma's settings, stored on its `khatmas` row. Dates are `YYYY-MM-DD` in `timeZone`. */
export const rotaConfigValidator = v.object({
  days: readingDaysValidator,
  firstDate: v.string(),
  /** The last reading date, or null to go on without end. */
  endDate: v.union(v.string(), v.null()),
  timeZone: v.string(),
  messages: rotaMessagesValidator,
  pausedAt: v.union(v.number(), v.null()),
  /** Reading dates skipped while paused. */
  pauseDates: v.array(v.string()),
  archivedAt: v.union(v.number(), v.null()),
  /**
   * When the organizer finished setting the khatma up; no day starts before
   * then. Null while setting up; missing on khatmas made before this field.
   */
  setupDoneAt: v.optional(v.union(v.number(), v.null())),
  /**
   * An admin set the khatma up on someone's behalf, and they haven't joined it
   * yet: their own join message makes them its organizer. Missing means no.
   */
  pendingOrganizer: v.optional(v.boolean()),
  /** How long after midnight a late «أتممت» counts; missing means the admin's default. */
  lateTapMs: v.optional(v.number()),
});

export const ROTA_SIZE = 30;

const DAY_MS = 86_400_000;
const SCAN_LIMIT_DAYS = 800;
const TIME_STEP_MINUTES = 15;

/** The juz' message time that means "when the day starts", as quiet hours otherwise forbid. */
export const DAY_START = 0;

/** The longest late-tap window, for the admin's default and a khatma's own. */
export const MAX_LATE_TAP_MS = 12 * 3_600_000;

/** The khatma number within its cycle of 30, 1 to 30. */
export function khatmaNumber(n: number): number {
  return ((n - 1) % ROTA_SIZE) + 1;
}

/** The cycle (round of 30 khatmas) that khatma `n` belongs to, from 1. */
export function cycleOf(n: number): number {
  return Math.floor((n - 1) / ROTA_SIZE) + 1;
}

/** The juz' a slot reads in khatma `number`: each slot moves up one juz' per khatma. */
export function juzFor(slot: number, number: number): number {
  return ((slot - 1 + number - 1) % ROTA_SIZE) + 1;
}

/** The slot that reads `juz` in khatma `number` (inverse of `juzFor`). */
export function slotFor(juz: number, number: number): number {
  return ((((juz - number) % ROTA_SIZE) + ROTA_SIZE) % ROTA_SIZE) + 1;
}

function dayNumber(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** `date` (`YYYY-MM-DD`) moved by `n` calendar days. */
export function addDays(date: string, n: number): string {
  return fromDayNumber(dayNumber(date) + n);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date written `YYYY-MM-DD`. */
export function isDate(date: string): boolean {
  return DATE_RE.test(date) && addDays(date, 0) === date;
}

/** Whether `date` is a reading day. Never before `firstDate`, which anchors every-two-weeks. */
export function isReadingDate(
  days: ReadingDays,
  firstDate: string,
  date: string,
): boolean {
  const day = dayNumber(date);
  const first = dayNumber(firstDate);
  if (day < first) return false;
  switch (days.kind) {
    case "daily":
      return true;
    case "weekly": {
      // 1970-01-01 was a Thursday (4).
      const weekday = (((day + 4) % 7) + 7) % 7;
      if (!days.weekdays.includes(weekday)) return false;
      return days.everyWeeks === 1 || Math.floor((day - first) / 7) % 2 === 0;
    }
    case "monthly":
      return days.days.includes(Number(date.slice(8, 10)));
  }
}

/**
 * The next `count` reading dates from `from` (inclusive), leaving out `skip`.
 * Scans at most 800 days, so it may return fewer.
 */
export function nextReadingDates(
  days: ReadingDays,
  firstDate: string,
  from: string,
  count: number,
  skip: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < SCAN_LIMIT_DAYS && out.length < count; i++) {
    const date = addDays(from, i);
    if (isReadingDate(days, firstDate, date) && !skip.has(date)) {
      out.push(date);
    }
  }
  return out;
}

function distinctInRange(values: number[], min: number, max: number): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((x) => Number.isInteger(x) && x >= min && x <= max)
  );
}

/** Weekly: 1 to 7 distinct weekdays. Monthly: 1 to 31 distinct days of the month. */
export function isValidReadingDays(days: ReadingDays): boolean {
  switch (days.kind) {
    case "daily":
      return true;
    case "weekly":
      return (
        days.weekdays.length >= 1 &&
        distinctInRange(days.weekdays, 0, 6) &&
        (days.everyWeeks === 1 || days.everyWeeks === 2)
      );
    case "monthly":
      return days.days.length >= 1 && distinctInRange(days.days, 1, 31);
  }
}

/**
 * What is wrong with the message times, if anything: not on a 15-minute step,
 * outside waking hours (`dayAt` may also be `DAY_START`), or out of order
 * (`dayAt` < reminder < unread < summary, counting only the messages that are on).
 */
export function messageTimesError(
  m: RotaMessages,
  quietStartHour: number,
  quietEndHour: number,
): "step" | "quiet" | "order" | null {
  const times = [
    m.dayAt,
    ...[m.reminder, m.unread, m.summary].filter((x) => x.on).map((x) => x.at),
  ];
  if (times.some((t) => !Number.isInteger(t) || t % TIME_STEP_MINUTES !== 0)) {
    return "step";
  }
  const inQuiet = (t: number) =>
    t < quietEndHour * 60 || t >= quietStartHour * 60;
  if (times.some((t) => t !== m.dayAt && inQuiet(t))) return "quiet";
  if (m.dayAt !== DAY_START && inQuiet(m.dayAt)) return "quiet";
  for (let i = 1; i < times.length; i++) {
    if ((times[i] ?? 0) <= (times[i - 1] ?? 0)) return "order";
  }
  return null;
}
