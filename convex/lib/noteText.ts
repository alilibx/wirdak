import { counted, type CountForms } from "./arabicCount";
import { toWesternDigits } from "./digits";

/**
 * The Arabic text of every in-app note and push. The web app imports this file
 * (through `t.notes.text`), so these are the only copies of the strings.
 */

export const NOTE_KINDS = [
  "almostUp",
  "openForHelp",
  "thanks",
  "reminder",
  "behind",
  "cheer",
  "completed",
  "nowOrganizer",
  "organizerMoved",
  "rotaUnread",
  "rotaSummary",
  "rotaJoinRequest",
  "rotaSilent",
  "rotaSilenced",
  "rotaStopped",
  "rotaEnabled",
  "coOrganizerNow",
] as const;

export type NoteKind = (typeof NOTE_KINDS)[number];

export type NoteTextInput = {
  kind: NoteKind;
  juz: number[];
  count: number | null;
  until: number | null;
  /** A rota participant's name, for the organizer notes about them. */
  name?: string | null;
};

const DAY_MS = 86_400_000;
/** noteText has no reader time zone, so dates are shown in the app's default zone. */
const TEXT_TZ = "Asia/Dubai";

const weekdayFormat = new Intl.DateTimeFormat("ar", {
  timeZone: TEXT_TZ,
  weekday: "long",
});
const dayMonthFormat = new Intl.DateTimeFormat("ar", {
  timeZone: TEXT_TZ,
  day: "numeric",
  month: "long",
});

const DAYS: CountForms = { few: "أيام", many: "يوماً", other: "يوم" };

/** `12`, `12 و15`, `3، 12 و15`. */
export function juzList(juz: readonly number[]): string {
  const digits = juz.map((n) => toWesternDigits(n));
  if (digits.length <= 1) return digits.join("");
  return `${digits.slice(0, -1).join("، ")} و${digits[digits.length - 1]}`;
}

/**
 * `الجزء 26`, `الجزآن 5 و6`, `الأجزاء 3، 5 و6`: the word agreeing with the list,
 * as a subject. Empty for an empty list.
 */
export function juzPhrase(juz: readonly number[]): string {
  if (juz.length === 0) return "";
  const word =
    juz.length === 1 ? "الجزء" : juz.length === 2 ? "الجزآن" : "الأجزاء";
  return `${word} ${juzList(juz)}`;
}

/**
 * The same phrase after a noun or preposition («قراءة الجزأين 5 و6»): the dual
 * takes its genitive form. Empty for an empty list.
 */
export function juzPhraseGenitive(juz: readonly number[]): string {
  return juz.length === 2 ? `الجزأين ${juzList(juz)}` : juzPhrase(juz);
}

/**
 * How a cheer opens. It's built around «قراءة» so the verb agrees whoever read:
 * a name may be a man's or a woman's.
 */
export function cheerLead(juz: readonly number[], name: string | null): string {
  const what = juzPhraseGenitive(juz) || "جزء";
  return `تمّت قراءة ${what}${name === null ? "" : ` على يد ${name}`}`;
}

/** The count with the noun agreeing: جزءاً واحداً, جزأين, 3 أجزاء, 11 جزءاً. */
function ajzaa(n: number): string {
  if (n === 1) return "جزءاً واحداً";
  if (n === 2) return "جزأين";
  if (n >= 3 && n <= 10) return `${toWesternDigits(n)} أجزاء`;
  return `${toWesternDigits(n)} جزءاً`;
}

/** The weekday within 6 days, otherwise the day and month. */
function when(until: number, now: number): string {
  if (until - now <= 6 * DAY_MS) return weekdayFormat.format(until);
  return dayMonthFormat
    .formatToParts(until)
    .map((p) => (p.type === "day" ? toWesternDigits(p.value) : p.value))
    .join("");
}

/** `3 أجزاء قبل الخميس`, or just `3 أجزاء` with no target end ahead. */
export function behindPhrase(
  count: number,
  until: number | null,
  now: number,
): string {
  const before =
    until !== null && until > now ? ` قبل ${when(until, now)}` : "";
  return `${ajzaa(count)}${before}`;
}

export function noteText(n: NoteTextInput, now: number = Date.now()): string {
  switch (n.kind) {
    case "almostUp":
      return `مهلة الجزء ${juzList(n.juz)} أوشكت على الانتهاء. هل تحتاج وقتاً أطول؟`;
    case "openForHelp":
      return n.juz.length === 1
        ? `الجزء ${juzList(n.juz)} متاح لمن يساعد. هل تأخذه أو ترسل الدعوة؟`
        : `الأجزاء ${juzList(n.juz)} متاحة لمن يساعد. هل تأخذ أحدها أو ترسل الدعوة؟`;
    case "thanks":
      return `أحدهم يُكمل الجزء ${juzList(n.juz)} الآن. جزاكما الله خيراً.`;
    case "reminder":
      return `الجزء ${juzList(n.juz)} في انتظارك، يسّر الله لك.`;
    case "behind":
      return `الختمة تحتاج ${behindPhrase(n.count ?? 0, n.until, now)}. هل تأخذ جزءاً؟`;
    case "cheer":
      return `${cheerLead(n.juz, n.name ?? null)}، وأصبح المقروء ${toWesternDigits(n.count ?? 0)} من 30 جزءاً في ختمتكم. بارك الله في قراءتكم.`;
    case "completed":
      return "ختمنا القرآن معاً، الحمد لله";
    case "nowOrganizer":
      return "أصبحتَ منظّم هذه الختمة. جزاك الله خيراً.";
    case "organizerMoved":
      return "مرّ وقت منذ زيارتك، فنقلنا تنظيم الختمة إلى أحد أعضائها ليستمر الخير. ما زلت عضواً فيها.";
    case "rotaUnread":
      return n.juz.length === 1
        ? `لم تُسجَّل بعد قراءة الجزء ${juzList(n.juz)} في ختمة اليوم.`
        : `لم تُسجَّل بعد قراءة الأجزاء ${juzList(n.juz)} في ختمة اليوم.`;
    case "rotaSummary":
      return `ختمة اليوم: ${toWesternDigits(n.count ?? 0)} من 30 جزءاً تمّت.`;
    case "rotaJoinRequest":
      return `طلب انضمام من ${n.name ?? ""}.`;
    case "rotaSilent":
      return `لم يردّ ${n.name ?? ""} منذ ${counted(n.count ?? 0, DAYS)}.`;
    case "rotaSilenced":
      return `أوقفنا رسائل الختمة إلى ${n.name ?? ""} لأنه لم يردّ منذ مدة.`;
    case "rotaStopped":
      return `أوقف ${n.name ?? ""} رسائل الختمة.`;
    case "coOrganizerNow":
      return "أصبحت منظّماً مساعداً في هذه الختمة";
    case "rotaEnabled":
      return "جديد لك: يمكنك الآن إنشاء ختمة بالتناوب: لكل شخص جزء ثابت يتقدّم مع كل ختمة، ويصله على واتساب.";
  }
}
