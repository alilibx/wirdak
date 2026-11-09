import { toWesternDigits } from "@convex/lib/digits";
import { t } from "../../i18n/ar";

const isoDateFormat = new Intl.DateTimeFormat("ar", {
  numberingSystem: "latn",
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** The weekday, day and month in Arabic for `2026-10-30`. The date is a calendar day, so it never shifts with a time zone. */
export function formatIsoDate(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const formatted = isoDateFormat.format(Date.UTC(year, month - 1, day));
  // Some engines put a comma after the weekday.
  return toWesternDigits(formatted.replace(/\u060C\s*/, " "));
}

/** A 12-hour clock time in Arabic for 480 minutes after midnight. */
export function formatTime(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const clock = `${hour % 12 || 12}:${String(minute).padStart(2, "0")}`;
  return toWesternDigits(`${clock} ${hour < 12 ? t.rota.am : t.rota.pm}`);
}
