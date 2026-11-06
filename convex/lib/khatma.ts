import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** `randomToken(9)` is 12 base64url characters. */
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{12}$/;

/** The khatma behind an invite code, or `null` (malformed codes never reach the index). */
export async function khatmaByInviteCode(
  ctx: QueryCtx,
  inviteCode: string,
): Promise<Doc<"khatmas"> | null> {
  if (!INVITE_CODE_RE.test(inviteCode)) return null;
  return await ctx.db
    .query("khatmas")
    .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
    .first();
}

/** Whether a khatma is archived: read-only, and nothing runs on it any more. */
export function isArchived(khatma: Doc<"khatmas">): boolean {
  return khatma.archivedAt != null || khatma.rota?.archivedAt != null;
}

/** A khatma's active members. */
export async function activeCount(ctx: QueryCtx, khatmaId: Id<"khatmas">) {
  const members = await ctx.db
    .query("members")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
    .collect();
  return members.filter((m) => m.status === "active").length;
}

/** Who is in a khatma: its active members, or a rotating khatma's readers still on the list. */
export async function memberCount(ctx: QueryCtx, k: Doc<"khatmas">) {
  if (k.kind !== "rota") return await activeCount(ctx, k._id);
  const readers = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", k._id))
    .collect();
  return readers.filter((p) => p.removedAt === null).length;
}
