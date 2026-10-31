import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { refreshPhone } from "./lib/directory";
import { foldText } from "./lib/searchFold";

/** Rows one `repair` run handles: each costs a few index reads. */
const REPAIR_PAGE = 100;
/** A khatma reads a row per reading day, so a run takes fewer of them. */
const KHATMA_REPAIR_PAGE = 20;

type Page = { continueCursor: string; isDone: boolean };

/** Repairs the phone on each row of a page of one table. */
const phones =
  (table: "people" | "rotaParticipants" | "readerDirectory") =>
  async (ctx: MutationCtx, cursor: string | null): Promise<Page> => {
    const page = await ctx.db
      .query(table)
      .paginate({ numItems: REPAIR_PAGE, cursor });
    for (const row of page.page) await refreshPhone(ctx, row.phone);
    return page;
  };

/** Each stage repairs a page of one table. */
const STAGES: ((ctx: MutationCtx, cursor: string | null) => Promise<Page>)[] = [
  phones("people"),
  // Readers with no account.
  phones("rotaParticipants"),
  // Rows whose phone has no reader left.
  phones("readerDirectory"),
  async (ctx, cursor) => {
    const page = await ctx.db
      .query("khatmas")
      .paginate({ numItems: KHATMA_REPAIR_PAGE, cursor });
    for (const k of page.page) {
      const searchName = foldText(k.name ?? "");
      if (k.searchName !== searchName) {
        await ctx.db.patch(k._id, { searchName });
      }
      if (k.kind !== "rota") continue;
      const days = await ctx.db
        .query("rotaDays")
        .withIndex("by_khatma_n", (q) => q.eq("khatmaId", k._id))
        .filter((q) => q.neq(q.field("completedAt"), null))
        .collect();
      if (k.completedDays !== days.length) {
        await ctx.db.patch(k._id, { completedDays: days.length });
      }
    }
    return page;
  },
];

/**
 * Walks everything the admin lists are built from and recomputes it. It's the
 * backfill for rows from before the counts, and the nightly repair after it:
 * `refreshPhone` writes only what changed, so it's safe to run at any time.
 */
export const repair = internalMutation({
  args: {
    stage: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const stage = args.stage ?? 0;
    const run = STAGES[stage];
    if (!run) return;
    const { continueCursor, isDone } = await run(ctx, args.cursor ?? null);
    await ctx.scheduler.runAfter(
      0,
      internal.directory.repair,
      isDone
        ? { stage: stage + 1, cursor: null }
        : { stage, cursor: continueCursor },
    );
  },
});
