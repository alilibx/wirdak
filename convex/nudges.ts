import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { isHeld } from "./grace";
import { JUZ_COUNT } from "./lib/juz";
import { isArchived } from "./lib/khatma";
import { paceSettings, personPace } from "./lib/pace";
import { getSetting } from "./lib/settings";
import { localDayNumber, safeTimeZone } from "./lib/wakingTime";
import { notify } from "./notes";
import { heldAssignment, juzStates, roundAssignments } from "./rounds";

/** Khatmas looked at per sweep page; each one is checked in its own mutation. */
const SWEEP_PAGE = 50;

/**
 * The reader's one gentle reminder for a juz' held 1.5x their pace (spec 4.2).
 * Skipped when the row is no longer held, has opened for help, was reminded
 * already, when the "almost up" note went out or is due on this same local day,
 * when the member had a nudge in the last day, or when the khatma is archived or
 * deleted.
 */
export const reminderDue = internalMutation({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.assignmentId);
    if (
      !a ||
      !isHeld(a) ||
      a.openedForHelpAt !== null ||
      a.remindedAt !== null ||
      a.noticeSentAt !== null
    ) {
      return;
    }
    const person = await ctx.db.get(a.personId);
    const member = await ctx.db.get(a.memberId);
    if (!person || !member || member.status !== "active") return;
    const khatma = await ctx.db.get(a.khatmaId);
    if (!khatma || isArchived(khatma)) return;

    const now = Date.now();
    const tz = safeTimeZone(person.timeZone);
    if (localDayNumber(a.noticeAt, tz) <= localDayNumber(now, tz)) return;
    if (!offCooldown(member, now, await getSetting(ctx, "nudgeCooldownMs"))) {
      return;
    }

    await ctx.db.patch(a._id, { remindedAt: now });
    await ctx.db.patch(member._id, { lastNudgeAt: now });
    await notify(ctx, {
      personId: a.personId,
      khatmaId: a.khatmaId,
      kind: "reminder",
      juz: [a.juz],
      assignmentId: a._id,
    });
  },
});

export function offCooldown(
  member: Doc<"members">,
  now: number,
  cooldownMs: number,
): boolean {
  return member.lastNudgeAt === null || now - member.lastNudgeAt >= cooldownMs;
}

/**
 * Hourly: pages through every khatma and schedules a behind check for each one
 * not archived whose current round has a target end. Paginated, and one mutation per
 * khatma, so no run reads more than a page of khatmas or one khatma's members.
 */
export const behindSweep = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("khatmas")
      .paginate({ numItems: SWEEP_PAGE, cursor: args.cursor ?? null });
    for (const khatma of page.page) {
      if (!khatma.currentRoundId || isArchived(khatma)) continue;
      const round = await ctx.db.get(khatma.currentRoundId);
      if (!round || round.targetEndAt === null || round.completedAt !== null) {
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.nudges.behindCheck, {
        khatmaId: khatma._id,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.nudges.behindSweep, {
        cursor: page.continueCursor,
      });
    }
  },
});

/**
 * Invites free members to a khatma whose round can't finish by its target end
 * at everyone's pace (spec 4.3). Fastest members first, only as many as the
 * shortfall needs, nobody twice in a round, at most once a day per round.
 */
export const behindCheck = internalMutation({
  args: { khatmaId: v.id("khatmas") },
  handler: async (ctx, args) => {
    const khatma = await ctx.db.get(args.khatmaId);
    if (!khatma?.currentRoundId || isArchived(khatma)) return;
    const round = await ctx.db.get(khatma.currentRoundId);
    if (!round || round.targetEndAt === null || round.completedAt !== null) {
      return;
    }
    const now = Date.now();
    const cooldownMs = await getSetting(ctx, "nudgeCooldownMs");
    if (
      round.behindInvitedAt !== null &&
      now - round.behindInvitedAt < cooldownMs
    ) {
      return;
    }

    const assignments = await roundAssignments(ctx, round._id);
    const states = [...juzStates(assignments).values()];
    const done = states.filter((s) => s.state === "done").length;
    const reading = states.length - done;
    const open = JUZ_COUNT - done - reading;
    if (open <= 0) return;

    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
        .collect()
    ).filter((m) => m.status === "active");
    const settings = await paceSettings(ctx);
    const remainingMs = Math.max(0, round.targetEndAt - now);

    let capacity = 0;
    const free: { member: Doc<"members">; paceMs: number }[] = [];
    for (const member of members) {
      const { paceMs } = await personPace(ctx, member.personId, settings);
      capacity += Math.floor(remainingMs / paceMs);
      // A hold opened for help is already counted as an open juz' above, so
      // only a hold the reader is still working on takes one off their capacity.
      const held = heldAssignment(assignments, member.personId);
      if (held) {
        if (held.openedForHelpAt === null) capacity -= 1;
      } else free.push({ member, paceMs });
    }
    if (remainingMs > 0 && open <= capacity) return;

    const shortfall = remainingMs === 0 ? open : open - Math.max(0, capacity);
    const invited = new Set<Id<"people">>(
      (
        await ctx.db
          .query("notes")
          .withIndex("by_khatma_kind", (q) =>
            q.eq("khatmaId", khatma._id).eq("kind", "behind"),
          )
          .collect()
      )
        .filter((n) => n.roundNumber === round.number)
        .map((n) => n.personId),
    );
    const chosen = free
      .filter(
        ({ member }) =>
          !invited.has(member.personId) && offCooldown(member, now, cooldownMs),
      )
      .sort((a, b) => a.paceMs - b.paceMs)
      .slice(0, shortfall);
    if (chosen.length === 0) return;

    for (const { member } of chosen) {
      await ctx.db.patch(member._id, { lastNudgeAt: now });
      await notify(ctx, {
        personId: member.personId,
        khatmaId: khatma._id,
        kind: "behind",
        count: open,
        until: round.targetEndAt,
        roundNumber: round.number,
      });
    }
    await ctx.db.patch(round._id, { behindInvitedAt: now });
  },
});
