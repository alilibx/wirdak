import {
  type CountryCode,
  getExampleNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js/min";
import examples from "libphonenumber-js/examples.mobile.json";
import { parsePhoneNumberFromString as parseMobile } from "libphonenumber-js/mobile";
import { normalizeDigits } from "./digits";

// Re-exported so existing Convex imports keep working; the web app imports ./digits directly.
export { normalizeDigits, toWesternDigits } from "./digits";

const DISPLAY_NAME_MAX = 40;
/** Raw name input longer than this is refused or cut before cleaning; the cleaned name is far shorter. */
export const DISPLAY_NAME_INPUT_MAX = 1000;
const KHATMA_NAME_MAX = 60;

// Invisible characters that render as blank but are not whitespace or \p{Cf}:
// Braille blank (U+2800), Hangul fillers (U+115F, U+1160, U+3164, U+FFA0).
const BLANK_FILLERS = "\u2800\u115F\u1160\u3164\uFFA0";
// ZWNJ and ZWJ are \p{Cf} but are meaningful in Persian, Arabic-script, and emoji text.
const CONTROL_OR_FORMAT = new RegExp(
  `[\\p{Cc}${BLANK_FILLERS}]|(?![\\u200C\\u200D])\\p{Cf}`,
  "gu",
);

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
// Trailing whitespace, ZWNJ, and ZWJ: a cut can strand a joiner at the end.
const TRAILING_SPACE_OR_JOINER = /[\s\u200C\u200D]+$/u;

/** Collapses whitespace and strips control, format, and blank-filler characters. */
function clean(raw: string): string {
  return raw
    .replace(/\s+/gu, " ") // tabs and newlines become spaces before controls are stripped
    .replace(CONTROL_OR_FORMAT, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Cuts to `max` code points, then drops trailing spaces, ZWNJ, and ZWJ. */
function cap(text: string, max: number): string {
  return Array.from(text)
    .slice(0, max)
    .join("")
    .replace(TRAILING_SPACE_OR_JOINER, "");
}

/**
 * Trims, collapses whitespace, and strips control, format (bidi marks and
 * overrides, zero-width space, ...), and blank-filler characters, keeping ZWNJ
 * and ZWJ. Cuts to 40 characters (never ending in a space or joiner), then
 * returns `null` unless a letter or digit remains.
 */
export function cleanDisplayName(raw: string): string | null {
  const capped = cap(clean(raw), DISPLAY_NAME_MAX);
  return HAS_LETTER_OR_DIGIT.test(capped) ? capped : null;
}

/**
 * Like `cleanDisplayName` with a 60-character cap: `null` input, or a name
 * with no letter or digit left (blank, punctuation, emoji, or joiners only),
 * gives `null`.
 */
export function cleanKhatmaName(raw: string | null): string | null {
  if (raw === null) return null;
  const capped = cap(clean(raw), KHATMA_NAME_MAX);
  return HAS_LETTER_OR_DIGIT.test(capped) ? capped : null;
}

/** `+971501234567` becomes `+971 50 ••• 4567`. Unparseable input is masked to its last 4 digits. */
export function maskPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (parsed) {
    const national = parsed.nationalNumber;
    const last4 = national.slice(-4);
    if (national.length >= 7) {
      return `+${parsed.countryCallingCode} ${national.slice(0, 2)} ••• ${last4}`;
    }
    return `+${parsed.countryCallingCode} ••• ${last4}`;
  }
  const digits = e164.replace(/\D/g, "");
  return digits.length >= 4 ? `••• ${digits.slice(-4)}` : "•••";
}

/** The country of a stored `+…` number, such as `EG` for `+201012345678`. */
export function phoneCountry(e164: string): CountryCode | undefined {
  return parsePhoneNumberFromString(e164)?.country;
}

/** A mobile number of `country` as people there write it, such as `010 01234567` for `EG`. */
export function localPhoneExample(
  country: CountryCode | undefined,
): string | null {
  if (country === undefined) return null;
  return getExampleNumber(country, examples)?.formatNational() ?? null;
}

const DIALABLE_RE = /^\+?\d+$/;

/**
 * A typed mobile number in E.164 form, or `null` when it is not a real one.
 * Reads Arabic and Persian digits, drops spaces, dashes, dots and brackets,
 * and turns a leading `00` into `+`. A number without a country code is read
 * as a number of `country`, so `01012345678` with `EG` gives `+201012345678`;
 * without `country` it gives `null`. A national `0` kept after the country
 * code (`+2001012345678`) is dropped.
 */
export function normalizePhone(
  raw: string,
  country?: CountryCode,
): string | null {
  const compact = normalizeDigits(raw).replace(/[\s\-.()[\]]/g, "");
  const international = compact.startsWith("00")
    ? `+${compact.slice(2)}`
    : compact;
  if (!DIALABLE_RE.test(international)) return null;
  if (!international.startsWith("+") && country === undefined) return null;
  // Mobile metadata, so a local number from elsewhere (a UAE `050…` typed
  // for `EG`) isn't saved as a landline of the organizer's country.
  const parsed = parseMobile(international, country);
  return parsed?.isValid() ? parsed.number : null;
}
