/** Maps Arabic-Indic (٠-٩) and Persian (۰-۹) digits to ASCII. */
export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => {
    const code = c.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * A number or text as Wirdak shows it, in Western digits (123). Some engines
 * format the `ar` locale with Eastern Arabic digits (١٢٣), so text from `Intl`
 * goes through here too.
 */
export function toWesternDigits(v: number | string): string {
  return normalizeDigits(String(v));
}
