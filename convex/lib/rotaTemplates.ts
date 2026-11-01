import { DUAS } from "./duas";
import { toArabicDigits } from "./digits";
import { cheerLead, juzPhrase, juzPhraseGenitive } from "./noteText";
import { khatmaTitle, type TemplateMessage } from "./whatsappTemplates";

/**
 * What a rota member's WhatsApp sees: the approved templates for messages
 * Wirdak starts, and the free-form texts for replies inside the 24-hour
 * window. The templates are plain UTILITY status updates, because Meta read
 * every prayer, question and invitation as marketing. The dua goes out only
 * behind the «دعاء الختم» button or as free-form text, never in a template.
 */

/** The labels of the quick-reply buttons, which free-form messages repeat as reply buttons. */
export const ROTA_BUTTONS = {
  done: "أتممت",
  notYet: "ليس بعد",
  dua: "دعاء الختم",
} as const;

export const ROTA_JUZ = "wirdak_rota_juz_v2";
export const ROTA_REMINDER = "wirdak_rota_reminder";
export const ROTA_ASSIGNED = "wirdak_rota_assigned_v2";
export const ROTA_COVERED = "wirdak_rota_covered_v2";
export const ROTA_COMPLETE = "wirdak_rota_complete";
export const ROTA_CYCLE = "wirdak_rota_cycle";

type Khatma = { name: string | null; createdAt: number };
/** The payloads of the «أتممت» and «ليس بعد» buttons, in button order. */
type DonePayloads = { done: string; notYet: string };

/** The member's juz' of the day, with the done and not-yet buttons. */
export function juzTemplate(
  khatma: Khatma,
  juz: number[],
  number: number,
  payloads: DonePayloads,
): TemplateMessage {
  return {
    name: ROTA_JUZ,
    header: khatmaTitle(khatma),
    body: [toArabicDigits(number), juzPhrase(juz)],
    quickReplies: [payloads.done, payloads.notYet],
  };
}

/** The same day's reminder, when the juz' isn't recorded yet. */
export function reminderTemplate(
  khatma: Khatma,
  juz: number[],
  payloads: DonePayloads,
): TemplateMessage {
  return {
    name: ROTA_REMINDER,
    header: khatmaTitle(khatma),
    body: [juzPhraseGenitive(juz)],
    quickReplies: [payloads.done, payloads.notYet],
  };
}

/** A juz' handed to the member after the day began (someone else dropped it). */
export function assignedTemplate(
  khatma: Khatma,
  juz: number[],
  number: number,
  payloads: DonePayloads,
): TemplateMessage {
  return {
    name: ROTA_ASSIGNED,
    header: khatmaTitle(khatma),
    body: [juzPhraseGenitive(juz), toArabicDigits(number)],
    quickReplies: [payloads.done, payloads.notYet],
  };
}

/** The member's juz' was read by someone else, so it's no longer theirs. */
export function coveredTemplate(
  khatma: Khatma,
  juz: number[],
): TemplateMessage {
  return {
    name: ROTA_COVERED,
    header: khatmaTitle(khatma),
    body: [juzPhraseGenitive(juz)],
  };
}

/** All thirty ajza' of khatma `number` are read; the button asks for the dua. */
export function completeTemplate(
  khatma: Khatma,
  number: number,
  duaPayload: string,
): TemplateMessage {
  return {
    name: ROTA_COMPLETE,
    header: khatmaTitle(khatma),
    body: [toArabicDigits(number)],
    quickReplies: [duaPayload],
  };
}

/** The member read thirty ajza' in thirty khatmas, the whole Quran. */
export function cycleTemplate(khatma: Khatma): TemplateMessage {
  return {
    name: ROTA_CYCLE,
    header: khatmaTitle(khatma),
    body: [],
  };
}

/**
 * The free-form versions of the templates, for messages inside the 24-hour
 * window. Each repeats its template's body word for word, so a member reads
 * the same message in or out of the window.
 */
export function reminderText(juz: number[]): string {
  return `تذكير بقراءتك اليوم: لم تُسجَّل بعد قراءة ${juzPhraseGenitive(juz)} في هذه الختمة.`;
}

export function assignedText(juz: number[], number: number): string {
  return `تحديث على قراءتك: سُجِّلت لك قراءة ${juzPhraseGenitive(juz)} في الختمة ${toArabicDigits(number)} لهذا اليوم.`;
}

export function completeText(number: number): string {
  return `تحديث على الختمة: اكتملت قراءة الأجزاء الثلاثين في الختمة ${toArabicDigits(number)} لهذا اليوم.`;
}

export function coveredText(juz: number[]): string {
  return `تحديث على قراءتك: سُجِّلت اليوم قراءة ${juzPhraseGenitive(juz)} باسم قارئ آخر في هذه الختمة.`;
}

export const cycleText =
  "تحديث على قراءتك: أكملت ثلاثين جزءاً في ثلاثين ختمة، أي القرآن كاملاً.";

const WEEKDAYS = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

/** The weekday of a `YYYY-MM-DD` date: «الأحد». */
export function weekdayText(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

/** Minutes after local midnight as a 12-hour time with its part of the day: «٤ عصراً», «٨:٣٠ صباحاً». */
export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const part =
    h < 12 ? "صباحاً" : h < 15 ? "ظهراً" : h < 18 ? "عصراً" : "مساءً";
  const hour = toArabicDigits(h % 12 === 0 ? 12 : h % 12);
  const time =
    m === 0 ? hour : `${hour}:${toArabicDigits(String(m).padStart(2, "0"))}`;
  return `${time} ${part}`;
}

/**
 * The reply to the member's join message. `next` holds the weekday and the
 * time of their next juz' message, already formatted; `notStarted` while the
 * organizer is still setting the khatma up, so no day can be promised yet; or
 * null with no day ahead to promise.
 */
export function welcomeText(
  name: string,
  title: string,
  next: { weekday: string; time: string } | "notStarted" | null,
): string {
  const joined = `أهلاً ${name}، انضممت إلى ${title}.`;
  if (next === null) return joined;
  if (next === "notStarted") {
    return `${joined} تصلك رسالة جزئك حين يبدأ المنظّم الختمة.`;
  }
  return `${joined} تصلك رسالة جزئك يوم ${next.weekday} الساعة ${next.time}.`;
}

/** The name of a member accepted from a join request that came without a profile name. */
export const NEW_MEMBER_NAME = "مشارك جديد";

/** The juz' message as free-form text; the done and not-yet buttons go with it. */
export function juzText(number: number, juz: number[]): string {
  return `تحديث على قراءتك اليوم في الختمة ${toArabicDigits(number)}: المسجَّل لك ${juzPhrase(juz)} من هذه الختمة.`;
}

export function thanksText(doneCount: number): string {
  return `تقبّل الله منك. ${toArabicDigits(doneCount)} من ٣٠ جزءاً تمّت اليوم.`;
}

/** The answer to a «أتممت» that counted for the day that just ended, by its khatma number. */
export function lateThanksText(number: number): string {
  return `تقبّل الله منك. سُجّلت قراءتك في الختمة ${toArabicDigits(number)}.`;
}

/** A cheer to the other readers: `name` and `juz` are only what the khatma chose to show. */
export function cheerText(
  doneCount: number,
  name: string | null,
  juz: number[],
): string {
  return `${cheerLead(juz, name)}، وأصبح المقروء ${toArabicDigits(doneCount)} من ٣٠ جزءاً اليوم. بارك الله في قراءتكم.`;
}

/** `reminderTime` is the already formatted time of the day's reminder, or null with none. */
export function notYetText(reminderTime: string | null): string {
  return reminderTime === null
    ? "لا بأس."
    : `لا بأس، نذكّرك الساعة ${reminderTime}.`;
}

export const alreadyText = "سجّلنا قراءتك من قبل.";
export const closedText = "انتهى يوم هذه الختمة.";
export const notOnListText = "أرسلنا طلبك إلى منظّم الختمة، ونخبرك حين يضيفك.";
/** To a number whose join request the organizer declined lately, when it asks again. */
export const askOrganizerText = "تواصل مع منظّم الختمة ليضيفك.";
export const stopText =
  "أوقفنا رسائل الختمة لك. لتعود إليها أرسل رسالة الانضمام مرة أخرى.";
export const helpText = "اضغط «أتممت» أو «ليس بعد» في رسالة جزئك.";
export const whichKhatmaText = "لأي ختمة؟";
/** A typed reply with more open khatmas than buttons fit: their titles, already formatted. */
export function manyKhatmasText(titles: string[]): string {
  return `لك قراءة اليوم في أكثر من ختمة: ${titles.join("، ")}. اضغط «أتممت» أو «ليس بعد» في رسالة كل ختمة.`;
}
/** A join message for an archived khatma. */
export const endedText = "انتهت هذه الختمة.";
/** A join message whose code no khatma has, here or on staging. */
export const unknownJoinText =
  "لم نجد هذه الختمة. تأكّد من الرابط مع منظّم الختمة.";

/** Both duas of the khatm, each followed by its reference. */
export function duaText(): string {
  return DUAS.map((d) => `${d.text}\n(${d.ref})`).join("\n\n");
}
