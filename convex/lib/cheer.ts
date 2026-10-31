import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getSetting } from "./settings";

/** The longest gap between two cheers, for the admin's default and a khatma's own. */
export const CHEER_MAX_GAP_MS = 30 * 86_400_000;

/** Whether a khatma cheers, whom, and the least time between one person's cheers. */
export type CheerConfig = {
  on: boolean;
  /** Every member, not only those still reading. */
  everyone: boolean;
  /** 0 means every finish. */
  gapMs: number;
  /** Say who finished. Off by default: a finish is a private act of worship. */
  showName: boolean;
  /** Say which juz'. Off by default: its tile showed who held it. */
  showJuz: boolean;
};

export const cheerConfigValidator = v.object({
  on: v.boolean(),
  everyone: v.boolean(),
  gapMs: v.number(),
  showName: v.boolean(),
  showJuz: v.boolean(),
});

/** What a khatma's settings screen shows: its own choice, if any, and what it falls back to. */
export type CheerSetting = {
  override: CheerConfig | null;
  defaults: CheerConfig;
};

export function isValidCheer(config: CheerConfig): boolean {
  return (
    Number.isInteger(config.gapMs) &&
    config.gapMs >= 0 &&
    config.gapMs <= CHEER_MAX_GAP_MS
  );
}

async function cheerDefaults(ctx: QueryCtx): Promise<CheerConfig> {
  return {
    on: await getSetting(ctx, "cheerOn"),
    everyone: await getSetting(ctx, "cheerEveryone"),
    gapMs: await getSetting(ctx, "cheerGapMs"),
    showName: await getSetting(ctx, "cheerShowName"),
    showJuz: await getSetting(ctx, "cheerShowJuz"),
  };
}

/** The khatma's own settings, else the admin's defaults. */
export async function cheerConfig(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
): Promise<CheerConfig> {
  return khatma.cheer ?? (await cheerDefaults(ctx));
}

export async function cheerSetting(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
): Promise<CheerSetting> {
  return {
    override: khatma.cheer ?? null,
    defaults: await cheerDefaults(ctx),
  };
}

/** Whether someone last cheered at `lastCheerAt` may be cheered again. */
export function cheerDue(
  lastCheerAt: number | null | undefined,
  now: number,
  gapMs: number,
): boolean {
  return lastCheerAt == null || now - lastCheerAt >= gapMs;
}
