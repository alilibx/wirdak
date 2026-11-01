import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Every kind of change the audit log records (spec 4.5). */
export const auditActionValidator = v.union(
  v.literal("admin.bootstrap"),
  v.literal("admin.add"),
  v.literal("admin.remove"),
  v.literal("setting.set"),
  v.literal("setting.reset"),
  v.literal("help.close"),
  v.literal("help.reopen"),
  v.literal("person.signOutAll"),
  v.literal("phone.block"),
  v.literal("phone.unblock"),
  v.literal("khatma.resetInvite"),
  v.literal("khatma.handOver"),
  v.literal("khatma.update"),
  v.literal("khatma.archive"),
  v.literal("khatma.restore"),
  v.literal("khatma.delete"),
  v.literal("khatma.removeMember"),
  v.literal("khatma.unblockMember"),
  v.literal("person.update"),
  v.literal("person.rotaAllowed"),
  v.literal("rota.adminCreate"),
  v.literal("rota.adminChange"),
);

export type AuditAction = Infer<typeof auditActionValidator>;

export const auditTargetKindValidator = v.union(
  v.literal("admin"),
  v.literal("setting"),
  v.literal("help"),
  v.literal("person"),
  v.literal("khatma"),
  v.literal("phone"),
);

export type AuditTargetKind = Infer<typeof auditTargetKindValidator>;

/**
 * Records one admin change. Call it in the same mutation as the change, so the
 * change and its record commit together.
 */
export async function writeAudit(
  ctx: MutationCtx,
  entry: {
    /** The admin who made the change; null for the command line. */
    actor: Doc<"admins"> | null;
    action: AuditAction;
    targetKind: AuditTargetKind;
    targetId: string;
    before: unknown;
    after: unknown;
    note?: string;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", {
    adminId: entry.actor?._id ?? null,
    adminPhone: entry.actor?.phone ?? null,
    action: entry.action,
    targetKind: entry.targetKind,
    targetId: entry.targetId,
    before: entry.before,
    after: entry.after,
    note: entry.note ?? null,
    at: Date.now(),
  });
}
