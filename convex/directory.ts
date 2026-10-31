import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { refreshPhone } from "./lib/directory";
import { foldText } from "./lib/searchFold";

/** Rows one `repair` run handles: each costs a few index reads. */
const REPAIR_PAGE = 100;

type Page = { continueCursor: string; isDone: boolean };

/** Each stage repairs a page of one table. */
const STAGES: ((ctx: MutationCtx, cursor: string | null) => Promise<Page>)[] = [
  async (ctx, cursor) => {
    const page = await ctx.db
      .query("people")
      .paginate({ numItems: REPAIR_PAGE, cursor });
    for (const p of page.page) await refreshPhone(ctx, p.phone);
    return page;
  },
  // Readers with no account.
  async (ctx, cursor) => {
    const page = await ctx.db
      .query("rotaParticipants")
      .paginate({ numItems: REPAIR_PAGE, cursor });
    for (const p of page.page) await refreshPhone(ctx, p.phone);
    return page;
  },
  // Rows whose phone has no reader left.
  async (ctx, cursor) => {
    const page = await ctx.db
      .query("readerDirectory")
      .paginate({ numItems: REPAIR_PAGE, cursor });
    for (const r of page.page) await refreshPhone(ctx, r.phone);
    return page;
  },
  async (ctx, cursor) => {
    const page = await ctx.db
      .query("khatmas")
      .paginate({ numItems: REPAIR_PAGE, cursor });
    for (const k of page.page) {
      const searchName = foldText(k.name ?? "");
      if (k.searchName !== searchName) {
        await ctx.db.patch(k._id, { searchName });
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
