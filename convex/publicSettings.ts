import { query } from "./_generated/server";
import { getSetting } from "./lib/settings";

/** The settings the website reads (spec 9.5). No other setting is public. */
export const get = query({
  args: {},
  handler: async (ctx) => ({
    announcement: await getSetting(ctx, "announcement"),
    maintenanceMode: await getSetting(ctx, "maintenanceMode"),
    maintenanceMessage: await getSetting(ctx, "maintenanceMessage"),
    minClientVersion: await getSetting(ctx, "minClientVersion"),
    rotaStartNextDay: await getSetting(ctx, "rotaStartNextDay"),
  }),
});
