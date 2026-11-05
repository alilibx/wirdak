import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { allows, roleIn, type Permission } from "./organizerAuth";
import { getSetting } from "./settings";

/**
 * Who gets an organizer note that needs `permission` (spec 4.6): the owner,
 * as always, and with `coOrganizerNotesOn` each co-organizer who has an
 * account, is still in the khatma and holds the permission. A co-organizer's
 * copy stays off WhatsApp unless `coOrganizerWhatsAppOn` is on; the owner's
 * never does.
 */
export async function organizerRecipients(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  permission: Permission,
): Promise<{ personId: Id<"people">; whatsappOff: boolean }[]> {
  const recipients = [{ personId: khatma.creatorPersonId, whatsappOff: false }];
  if (!(await getSetting(ctx, "coOrganizerNotesOn"))) return recipients;
  const whatsappOff = !(await getSetting(ctx, "coOrganizerWhatsAppOn"));
  const rows = (
    await ctx.db
      .query("coOrganizers")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect()
  ).sort((a, b) => a.addedAt - b.addedAt || a._creationTime - b._creationTime);
  for (const row of rows) {
    const person = await ctx.db
      .query("people")
      .withIndex("by_phone", (q) => q.eq("phone", row.phone))
      .first();
    if (!person || person._id === khatma.creatorPersonId) continue;
    if (!allows(await roleIn(ctx, khatma, person), permission)) continue;
    recipients.push({ personId: person._id, whatsappOff });
  }
  return recipients;
}
