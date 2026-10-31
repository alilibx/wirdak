import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { notify } from "./notes";

/**
 * Called inside the completing mutation right after a round is completed and
 * the next one has started. Tells every active member the khatma is complete
 * (a message to all, never a nudge), and clears the round's "behind" invites
 * and cheers, which no longer apply.
 */
export async function onRoundCompleted(
  ctx: MutationCtx,
  khatmaId: Id<"khatmas">,
  roundNumber: number,
): Promise<void> {
  const now = Date.now();
  const behind = await ctx.db
    .query("notes")
    .withIndex("by_khatma_kind", (q) =>
      q.eq("khatmaId", khatmaId).eq("kind", "behind").eq("clearedAt", null),
    )
    .collect();
  for (const note of behind) {
    if (note.roundNumber === roundNumber) {
      await ctx.db.patch(note._id, { clearedAt: now });
    }
  }

  const cheers = await ctx.db
    .query("notes")
    .withIndex("by_khatma_kind", (q) =>
      q.eq("khatmaId", khatmaId).eq("kind", "cheer").eq("clearedAt", null),
    )
    .collect();
  for (const note of cheers) await ctx.db.patch(note._id, { clearedAt: now });

  const members = await ctx.db
    .query("members")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
    .collect();
  for (const member of members) {
    if (member.status !== "active") continue;
    await notify(ctx, {
      personId: member.personId,
      khatmaId,
      kind: "completed",
      roundNumber,
    });
  }
}
