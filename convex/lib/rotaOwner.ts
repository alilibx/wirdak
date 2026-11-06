import type { Doc } from "../_generated/dataModel";

/**
 * Whether this participant is the khatma's owner: by account, or by the
 * owner's number, since a participant added by phone has no `personId` (and
 * ownership can move to one). Every "is this the owner?" test goes here.
 */
export function isOwnerRow(
  p: Doc<"rotaParticipants">,
  khatma: Doc<"khatmas">,
  owner: Doc<"people"> | null,
): boolean {
  return (
    p.personId === khatma.creatorPersonId ||
    (owner !== null && p.phone === owner.phone)
  );
}
