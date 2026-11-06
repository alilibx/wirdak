import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { ROTA_SIZE, slotFor } from "../rota";
import { slotRowsByJuz, targetDay, type RotaConfig } from "../rotaPlace";
import {
  activeIdentities,
  lateInTheDay,
  placeNewParticipant,
  savedOwner,
  type Actor,
} from "./people";

export type AddSavedManyResult =
  | {
      ok: true;
      added: number;
      /** Already reading in this khatma, or listed twice under one number. */
      alreadyIn: number;
      /** The free ajza' ran out before them. */
      noRoom: number;
      /** Not on the caller's saved list (removed, someone else's, or gone). */
      notFound: number;
    }
  | { error: "ask_today" };

type Who = {
  name: string;
  phone: string;
  personId: Id<"people"> | null;
  phoneHidden: boolean;
};

/**
 * Adds several saved contacts at once, in the order given, each on the lowest
 * free juz' of the next day to start, as `addSaved` does for one. Nobody joins
 * here: each still sends the khatma's join message. Late in the day the
 * organizer's answer is asked for once, before anyone is added, and applies
 * to everyone in the batch.
 */
export async function addSavedMany(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { contactIds: Id<"rotaContacts">[]; readsToday?: boolean },
  actor: Actor,
): Promise<AddSavedManyResult> {
  if (args.contactIds.length > ROTA_SIZE) {
    throw new ConvexError({ code: "too_many" });
  }
  const owner = savedOwner(khatma, actor);
  const { phones, personIds } = await activeIdentities(ctx, khatma._id);
  let alreadyIn = 0;
  let notFound = 0;
  const batch: Who[] = [];
  for (const contactId of new Set(args.contactIds)) {
    const contact = await ctx.db.get(contactId);
    if (
      !contact ||
      contact.ownerPersonId !== owner ||
      contact.removedAt !== undefined
    ) {
      notFound += 1;
      continue;
    }
    // A contact without a number is someone from a pool khatma: it stays hidden.
    const linked =
      contact.phone === null && contact.personId !== null
        ? await ctx.db.get(contact.personId)
        : null;
    const phone = contact.phone ?? linked?.phone ?? null;
    if (phone === null) {
      notFound += 1;
      continue;
    }
    if (
      phones.has(phone) ||
      (contact.personId !== null && personIds.has(contact.personId))
    ) {
      alreadyIn += 1;
      continue;
    }
    phones.add(phone);
    if (contact.personId !== null) personIds.add(contact.personId);
    batch.push({
      name: contact.name,
      phone,
      personId: contact.personId,
      phoneHidden: contact.phone === null,
    });
  }

  const target = await targetDay(ctx, khatma);
  const byJuz = await slotRowsByJuz(ctx, khatma._id, target.number);
  const free = Array.from({ length: ROTA_SIZE }, (_, i) => i + 1).filter(
    (juz) => !byJuz.has(juz),
  );
  const placing = batch.slice(0, free.length);

  // Ask before writing anything, so a question never leaves half a batch in.
  if (args.readsToday === undefined && target.date !== null) {
    for (const [i, who] of placing.entries()) {
      const slot = slotFor(free[i]!, target.number);
      if (await lateInTheDay(ctx, khatma, who.phone, slot, false)) {
        return { error: "ask_today" };
      }
    }
  }

  let added = 0;
  for (const [i, who] of placing.entries()) {
    const placed = await placeNewParticipant(
      ctx,
      khatma,
      who,
      free[i],
      undefined,
      {
        readsToday: args.readsToday,
      },
    );
    // The question was asked above and every juz' was free, so this can't fail.
    if ("error" in placed) throw new ConvexError({ code: placed.error });
    added += 1;
  }
  return {
    ok: true,
    added,
    alreadyIn,
    noRoom: batch.length - placing.length,
    notFound,
  };
}
