import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { cleanNote } from "./adminOps";
import { archiveKhatma, deleteKhatma, restoreKhatma } from "./khatmaLifecycle";
import { adminMutation } from "./lib/adminSession";
import { writeAudit } from "./lib/audit";
import { nameFields } from "./lib/directory";
import { graceValidator, isValidGrace } from "./lib/grace";
import { isArchived } from "./lib/khatma";
import { scheduleValidator } from "./lib/schedule";
import { cleanKhatmaName } from "./lib/text";
import { blockMember, otherMember } from "./organizer";

const kindOf = (khatma: Doc<"khatmas">) =>
  khatma.kind === "rota" ? "rota" : "pool";

/** The khatma, or why an admin can't change it: `adminRota` has a rota khatma's edits. */
async function livePool(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<Doc<"khatmas"> | "not_found" | "archived" | "rota"> {
  const khatma = await ctx.db.get(khatmaId);
  if (!khatma) return "not_found";
  if (khatma.kind === "rota") return "rota";
  return isArchived(khatma) ? "archived" : khatma;
}

/**
 * An admin's edit of a pool khatma, on the organizer's rules: a new schedule
 * applies from the next round, and holds in progress keep their grace.
 */
export const update = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    name: v.optional(v.union(v.string(), v.null())),
    schedule: v.optional(scheduleValidator),
    grace: v.optional(graceValidator),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true }
    | { error: "not_found" | "archived" | "rota" | "invalid_grace" }
  > => {
    const khatma = await livePool(ctx, args.khatmaId);
    if (typeof khatma === "string") return { error: khatma };
    if (args.grace && !isValidGrace(args.grace)) {
      return { error: "invalid_grace" };
    }
    const name =
      args.name === undefined ? khatma.name : cleanKhatmaName(args.name);
    const schedule = args.schedule ?? khatma.schedule;
    const grace = args.grace ?? khatma.grace;
    await ctx.db.patch(khatma._id, { ...nameFields(name), schedule, grace });
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "khatma.update",
      targetKind: "khatma",
      targetId: khatma._id,
      before: {
        name: khatma.name,
        schedule: khatma.schedule,
        grace: khatma.grace,
      },
      after: { name, schedule, grace },
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});

/** Stops a khatma of either kind and leaves it read-only. Recorded only the first time. */
export const archive = adminMutation({
  args: { khatmaId: v.id("khatmas"), note: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "not_found" }> => {
    const khatma = await ctx.db.get(args.khatmaId);
    if (!khatma) return { error: "not_found" };
    if (isArchived(khatma)) return { ok: true };
    await archiveKhatma(ctx, khatma);
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "khatma.archive",
      targetKind: "khatma",
      targetId: khatma._id,
      before: { archived: false },
      after: { archived: true },
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});

/** Reopens an archived pool khatma. A rota khatma's archive is final (admin spec 6). */
export const restore = adminMutation({
  args: { khatmaId: v.id("khatmas"), note: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true } | { error: "not_found" | "rota" | "not_archived" }
  > => {
    const khatma = await ctx.db.get(args.khatmaId);
    if (!khatma) return { error: "not_found" };
    if (khatma.kind === "rota") return { error: "rota" };
    if (!isArchived(khatma)) return { error: "not_archived" };
    await restoreKhatma(ctx, khatma);
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "khatma.restore",
      targetKind: "khatma",
      targetId: khatma._id,
      before: { archived: true },
      after: { archived: false },
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});

/** Deletes an archived khatma of either kind for good. Its audit row keeps its name. */
export const remove = adminMutation({
  args: { khatmaId: v.id("khatmas"), note: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "not_found" | "not_archived" }> => {
    const khatma = await ctx.db.get(args.khatmaId);
    if (!khatma) return { error: "not_found" };
    if (!isArchived(khatma)) return { error: "not_archived" };
    await deleteKhatma(ctx, khatma);
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "khatma.delete",
      targetKind: "khatma",
      targetId: khatma._id,
      before: { name: khatma.name, kind: kindOf(khatma) },
      after: null,
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});

/** Removes a member of a pool khatma, as its organizer can. They end up blocked from it. */
export const removeMember = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    memberId: v.id("members"),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true }
    | { error: "not_found" | "archived" | "rota" | "self" | "not_member" }
  > => {
    const khatma = await livePool(ctx, args.khatmaId);
    if (typeof khatma === "string") return { error: khatma };
    const member = await otherMember(ctx, khatma, args.memberId, "active");
    if (typeof member === "string") return { error: member };
    await blockMember(ctx, khatma, member);
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "khatma.removeMember",
      targetKind: "khatma",
      targetId: khatma._id,
      before: { personId: member.personId, status: "active" },
      after: { personId: member.personId, status: "blocked" },
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});

/** Lets a blocked member back: they become a former member and may join again. */
export const unblockMember = adminMutation({
  args: {
    khatmaId: v.id("khatmas"),
    memberId: v.id("members"),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true }
    | { error: "not_found" | "archived" | "rota" | "self" | "not_member" }
  > => {
    const khatma = await livePool(ctx, args.khatmaId);
    if (typeof khatma === "string") return { error: khatma };
    const member = await otherMember(ctx, khatma, args.memberId, "blocked");
    if (typeof member === "string") return { error: member };
    await ctx.db.patch(member._id, { status: "former" });
    await writeAudit(ctx, {
      actor: ctx.admin,
      action: "khatma.unblockMember",
      targetKind: "khatma",
      targetId: khatma._id,
      before: { personId: member.personId, status: "blocked" },
      after: { personId: member.personId, status: "former" },
      note: cleanNote(args.note),
    });
    return { ok: true };
  },
});
