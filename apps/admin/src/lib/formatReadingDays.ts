import { toWesternDigits } from "@convex/lib/digits";
import type { ReadingDays } from "@convex/lib/rota";
import { t as webT } from "@web/i18n/ar";
import { t } from "../i18n/ar";

/** A rota khatma's reading days in words: «كل أسبوع: الاثنين، الخميس». */
export function formatReadingDays(days: ReadingDays): string {
  switch (days.kind) {
    case "daily":
      return t.lookup.daily;
    case "weekly": {
      const names = days.weekdays
        .map((d) => webT.rota.weekdays[d] ?? "")
        .join(t.lookup.listSeparator);
      return days.everyWeeks === 2
        ? t.lookup.everyTwoWeeks(names)
        : t.lookup.weekly(names);
    }
    case "monthly":
      return t.lookup.monthly(
        days.days.map((d) => toWesternDigits(d)).join(t.lookup.listSeparator),
      );
  }
}
