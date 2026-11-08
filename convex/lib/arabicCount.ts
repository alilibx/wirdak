import { toWesternDigits } from "./digits";

/** A noun's forms after a number: 3–10 plural, 11–99 accusative singular, the rest singular. */
export type CountForms = { few: string; many: string; other: string };

/** `n` (in Western digits, or as `shown`) followed by the noun form its number takes. */
export function counted(
  n: number,
  forms: CountForms,
  shown: string = toWesternDigits(n),
): string {
  const rest = n % 100;
  const form = !Number.isInteger(n)
    ? forms.other
    : rest >= 3 && rest <= 10
      ? forms.few
      : rest >= 11
        ? forms.many
        : forms.other;
  return `${shown} ${form}`;
}
