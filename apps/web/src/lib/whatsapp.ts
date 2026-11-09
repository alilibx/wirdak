import { toWesternDigits } from "@convex/lib/digits";
import { t } from "../i18n/ar";
import { formatDate } from "./format";

/** A wa.me link to a number, with the message prefilled. */
export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** A wa.me link that lets the user pick the recipient. */
export function waShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** The invitation a member sends; `url` is their own member link. */
export function inviteMessage(khatmaName: string, url: string): string {
  return t.messages.invite(khatmaName, url);
}

/**
 * The reminder a member sends to the group. It lists what is still open, never who holds
 * what, so it cannot name a person.
 */
export function remindMessage(
  khatmaName: string,
  openJuz: number[],
  targetEndAt: number | null,
  url: string,
): string {
  const list = openJuz
    .map((n) => toWesternDigits(n))
    .join(t.common.listSeparator);
  const remaining = t.messages.remindCount(
    openJuz.length,
    toWesternDigits(openJuz.length),
  );
  const until = targetEndAt === null ? null : formatDate(targetEndAt);
  return [
    t.messages.remind(khatmaName, remaining, until),
    t.messages.remindOpen(list),
    t.messages.remindLink(url),
  ].join("\n");
}
