import { normalizeDigits } from "./digits";

/**
 * Folds text so the spellings of one Arabic word compare equal: marks and the
 * stretching line go, «أإآ» become «ا», «ى» «ي», «ة» «ه», «ؤ» «و», «ئ» «ي», and
 * digits become Latin. Used on what's stored and on what's typed (spec 10).
 */
export function foldText(text: string): string {
  return normalizeDigits(text)
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .trim();
}
