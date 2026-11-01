/**
 * Waking-time arithmetic. Grace clocks run only while the reader is awake:
 * outside the quiet window (22:00 to 07:00 by default) in the reader's own
 * time zone. Everything here is pure and uses only `Intl`.
 */

export type QuietHours = { startHour: number; endHour: number };

const FALLBACK_TZ = "Asia/Dubai";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DAY_HOURS = 24;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** `tz` if `Intl` accepts it, otherwise `Asia/Dubai`. Never throws. */
export function safeTimeZone(tz: string): string {
  try {
    formatterFor(tz);
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Local wall-clock fields of an instant in `tz` (already a safe zone). */
function wallClock(at: number, tz: string): Wall {
  const out: Wall = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
  };
  for (const p of formatterFor(tz).formatToParts(at)) {
    switch (p.type) {
      case "year":
        out.year = Number(p.value);
        break;
      case "month":
        out.month = Number(p.value);
        break;
      case "day":
        out.day = Number(p.value);
        break;
      case "hour":
        out.hour = Number(p.value) % DAY_HOURS;
        break;
      case "minute":
        out.minute = Number(p.value);
        break;
      case "second":
        out.second = Number(p.value);
        break;
    }
  }
  return out;
}

/** Zone offset in ms (local minus UTC) at an instant, at whole-second precision. */
function offsetAt(at: number, tz: string): number {
  const whole = Math.floor(at / 1000) * 1000;
  const w = wallClock(whole, tz);
  return (
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole
  );
}

/** The instant at which the wall clock in `tz` reads the given local time. */
function localToInstant(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = guess - offsetAt(guess, tz);
  // Correct once more with the offset at the result so DST changes land right.
  const second = guess - offsetAt(first, tz);
  // A time the clocks skip reads true at neither: take the moment after the gap.
  return second + offsetAt(second, tz) === guess
    ? second
    : Math.max(first, second);
}

/** The local calendar date of an instant in `tz`, as days since 1970-01-01. */
export function localDayNumber(at: number, tz: string): number {
  const w = wallClock(at, safeTimeZone(tz));
  return Math.floor(Date.UTC(w.year, w.month - 1, w.day) / DAY_MS);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The local calendar date of an instant in `tz`, as `YYYY-MM-DD`. */
export function localDate(at: number, tz: string): string {
  const w = wallClock(at, safeTimeZone(tz));
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
}

/** Minutes after local midnight of an instant in `tz`. */
export function localMinutes(at: number, tz: string): number {
  const w = wallClock(at, safeTimeZone(tz));
  return w.hour * 60 + w.minute;
}

/** The instant at which the wall clock in `tz` reads `minutes` after midnight on `date` (`YYYY-MM-DD`). */
export function instantAt(date: string, minutes: number, tz: string): number {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return localToInstant(
    safeTimeZone(tz),
    year,
    month,
    day,
    Math.floor(minutes / 60),
    minutes % 60,
  );
}

function awakeHours(q: QuietHours): number {
  const quiet =
    (((q.endHour - q.startHour) % DAY_HOURS) + DAY_HOURS) % DAY_HOURS;
  return DAY_HOURS - quiet;
}

/** Length of one waking day in ms (15 hours for 22/7). */
export function wakingDayMs(q: QuietHours): number {
  return awakeHours(q) * HOUR_MS;
}

function hasQuietHours(q: QuietHours): boolean {
  return awakeHours(q) < DAY_HOURS;
}

function quietAtHour(hour: number, q: QuietHours): boolean {
  if (!hasQuietHours(q)) return false;
  return q.startHour > q.endHour
    ? hour >= q.startHour || hour < q.endHour
    : hour >= q.startHour && hour < q.endHour;
}

/** Whether `at` falls inside quiet hours in `tz`. */
export function isQuiet(at: number, tz: string, q: QuietHours): boolean {
  return quietAtHour(wallClock(at, safeTimeZone(tz)).hour, q);
}

/** First local `hour:00` strictly after `at`. */
function nextLocalHour(at: number, tz: string, hour: number): number {
  const w = wallClock(at, tz);
  const today = localToInstant(tz, w.year, w.month, w.day, hour);
  return today > at
    ? today
    : localToInstant(tz, w.year, w.month, w.day + 1, hour);
}

/** `at` when awake, otherwise the next local `endHour:00`. */
export function nextAwake(at: number, tz: string, q: QuietHours): number {
  const zone = safeTimeZone(tz);
  return quietAtHour(wallClock(at, zone).hour, q)
    ? nextLocalHour(at, zone, q.endHour)
    : at;
}

/**
 * The instant at which `wakingMs` of waking time have passed since `start`.
 * A start inside quiet hours begins counting at the next `endHour:00`.
 */
export function addWakingMs(
  start: number,
  wakingMs: number,
  tz: string,
  q: QuietHours,
): number {
  const zone = safeTimeZone(tz);
  let remaining = Math.max(0, wakingMs);
  if (!hasQuietHours(q)) return start + remaining;
  let cursor = nextAwake(start, zone, q);
  for (;;) {
    const windowEnd = nextLocalHour(cursor, zone, q.startHour);
    const available = windowEnd - cursor;
    if (remaining <= available) return cursor + remaining;
    remaining -= available;
    cursor = nextLocalHour(windowEnd, zone, q.endHour);
  }
}
