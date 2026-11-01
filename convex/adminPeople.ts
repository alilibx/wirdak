import { v } from "convex/values";
import { cleanNote } from "./adminOps";
import { adminMutation } from "./lib/adminSession";
import { writeAudit } from "./lib/audit";
import { refreshPerson } from "./lib/directory";
import { cleanDisplayName } from "./lib/text";

/**
 * An admin's edit of a person's name and WhatsApp notes. Their time zone isn't
 * here: each visit sets it from their device. The audit row holds no number.
 */
export const update = adminMutation({
  args: {
    personId: v.id("people"),
    displayName: v.optional(v.string()),
    whatsappNotes: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "not_found" | "invalid_name" }> => {
    const person = await ctx.db.get(args.personId);
    if (!person) return { error: "not_found" };
    const displayName =
      args.displayName === undefined
        ? person.displayName
        : cleanDisplayName(args.displayName);
    if (displayName === null) return { error: "invalid_name" };
    const whatsappNotes = args.whatsappNotes ?? person.whatsappNotes === true;
    await ctx.db.patch(person._id, { displayName, whatsappNotes });
    await refreshPerson(ctx, person._id);
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "person.update",
      targetKind: "person",
      targetId: person._id,
      before: {
        displayName: person.displayName,
        whatsappNotes: person.whatsappNotes === true,
      },
      after: { displayName, whatsappNotes },
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});
