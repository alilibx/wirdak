/**
 * What can be done to a rota khatma, for whoever is allowed to: `convex/rota.ts` wraps these for
 * its organizer. Each takes the khatma the caller was checked against, so nothing here decides who
 * may call, and none of them refuses an archived khatma: that is the caller's job.
 */
export * from "./rotaOps/bulk";
export * from "./rotaOps/people";
export * from "./rotaOps/settings";
export * from "./rotaOps/today";
