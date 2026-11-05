import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { activeMembership } from "../khatmas";

/** The three switches an owner can give a co-organizer. */
export type Permission = "readings" | "people" | "settings";

/** What a call needs: one switch, or the owner themselves. */
export type Need = Permission | "owner";

export type OrganizerRole =
  | { owner: true }
  | { owner: false; readings: boolean; people: boolean; settings: boolean };

/**
 * `person`'s role in `khatma`, or `null`. The owner must still be an active
 * member. A co-organizer is matched by phone and must still be in the khatma:
 * an active member (pool) or a live participant (rota).
 */
export async function roleIn(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  person: Doc<"people"> | null,
): Promise<OrganizerRole | null> {
  if (!person) return null;
  const membership = await activeMembership(ctx, khatma._id, person._id);
  if (khatma.creatorPersonId === person._id) {
    return membership ? { owner: true } : null;
  }
  const row = await ctx.db
    .query("coOrganizers")
    .withIndex("by_khatma_phone", (q) =>
      q.eq("khatmaId", khatma._id).eq("phone", person.phone),
    )
    .first();
  if (!row) return null;
  if (khatma.kind === "rota") {
    const participant = await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma_phone", (q) =>
        q.eq("khatmaId", khatma._id).eq("phone", person.phone),
      )
      .collect();
    if (!participant.some((p) => p.removedAt === null)) return null;
  } else if (!membership) {
    return null;
  }
  return {
    owner: false,
    readings: row.readings,
    people: row.people,
    settings: row.settings,
  };
}

/** The owner passes every need; a co-organizer never passes `"owner"`. */
export function allows(role: OrganizerRole | null, need: Need): boolean {
  if (!role) return false;
  if (role.owner) return true;
  return need === "owner" ? false : role[need];
}
