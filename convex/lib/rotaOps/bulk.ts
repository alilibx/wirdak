import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { ROTA_SIZE, slotFor } from "../rota";
import { slotRowsByJuz, targetDay, type RotaConfig } from "../rotaPlace";
import {
  activeIdentities,
  lateInTheDay,
  placeNewParticipant,
  resolveContact,
  savedOwner,
  type Actor,
} from "./people";

export type AddSavedManyResult =
  | {
      ok: true;
      added: number;
      /** Already reading in this khatma, or listed twice under one number. */
      alreadyIn: number;
      /** No juz' was left for them, free or to share. */
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
 * free juz' of the next day to start, as `addSaved` does for one. Once every
 * juz' has a reader, the rest share ajza' in order, from the lowest juz' with
 * no second reader, while sharing is open. Nobody joins here: each still sends
 * the khatma's join message. Late in the day the organizer's answer is asked
 * for once, before anyone is added, and applies to everyone in the batch.
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
  const identities = await activeIdentities(ctx, khatma._id);
  let alreadyIn = 0;
  let notFound = 0;
  const batch: Who[] = [];
  for (const contactId of new Set(args.contactIds)) {
    // The identities grow as the batch does, so one number listed twice goes in once.
    const who = await resolveContact(ctx, contactId, owner, identities);
    if ("error" in who) {
      if (who.error === "not_found") notFound += 1;
      else alreadyIn += 1;
      continue;
    }
    identities.phones.add(who.phone);
    if (who.personId !== null) identities.personIds.add(who.personId);
    batch.push(who);
  }

  const target = await targetDay(ctx, khatma);
  const byJuz = await slotRowsByJuz(ctx, khatma._id, target.number);
  const free = Array.from({ length: ROTA_SIZE }, (_, i) => i + 1).filter(
    (juz) => !byJuz.has(juz),
  );

  // Ask before writing anything, so a question never leaves half a batch in.
  // Only the people on a free juz' could take today's: a second reader never does.
  if (args.readsToday === undefined && target.date !== null) {
    for (const [i, who] of batch.slice(0, free.length).entries()) {
      const slot = slotFor(free[i]!, target.number);
      if (await lateInTheDay(ctx, khatma, who.phone, slot, false)) {
        return { error: "ask_today" };
      }
    }
  }

  let added = 0;
  for (const who of batch) {
    const placed = await placeNewParticipant(
      ctx,
      khatma,
      who,
      undefined,
      undefined,
      { readsToday: args.readsToday },
      "fill",
    );
    if ("error" in placed && placed.error === "no_free_juz") break;
    // The question was asked above, so nothing else can refuse them.
    if ("error" in placed) throw new ConvexError({ code: placed.error });
    added += 1;
  }
  return {
    ok: true,
    added,
    alreadyIn,
    noRoom: batch.length - added,
    notFound,
  };
}
