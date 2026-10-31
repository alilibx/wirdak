import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { juzFor } from "./lib/rota";
import { lastRotaDay, targetDay, type RotaConfig } from "./lib/rotaPlace";
import { encodePayload } from "./lib/rotaPayload";
import {
  ROTA_BUTTONS,
  assignedText,
  assignedTemplate,
  cheerText,
  clockText,
  completeTemplate,
  completeText,
  coveredTemplate,
  coveredText,
  cycleTemplate,
  cycleText,
  duaText,
  juzTemplate,
  juzText,
  reminderTemplate,
  reminderText,
  weekdayText,
  welcomeText,
} from "./lib/rotaTemplates";
import { quietHours } from "./lib/settings";
import { localDate, nextAwake } from "./lib/wakingTime";
import { khatmaTitle, type TemplateMessage } from "./lib/whatsappTemplates";
import {
  isDev,
  isStaging,
  sendWhatsAppButtons,
  sendWhatsAppTemplate,
  sendWhatsAppText,
} from "./whatsapp";

type Kind = Doc<"rotaOutbox">["kind"];
type Participant = Doc<"rotaParticipants">;

/** A free-form message, with reply buttons where the template has quick replies. */
type FreeForm = { text: string; buttons?: { id: string; title: string }[] };

const WINDOW_MS = 24 * 3_600_000;

/** Whether a participant may be sent messages Wirdak starts: on the list, joined, not stopped or silenced. */
export function reachable(p: Participant | null): p is Participant {
  return (
    p !== null &&
    p.removedAt == null &&
    p.joinedAt != null &&
    p.stoppedAt == null &&
    p.silencedAt == null
  );
}

/** Whether a phone wrote to us in the last 24 hours, so free-form messages reach it. */
export async function windowOpen(
  ctx: QueryCtx,
  phone: string,
  now: number,
): Promise<boolean> {
  const contact = await ctx.db
    .query("waContacts")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .unique();
  return contact !== null && contact.lastInboundAt >= now - WINDOW_MS;
}

/** Kinds that name the ajza' of a reassignment: several on one day make one message. */
const MERGED_KINDS: ReadonlySet<Kind> = new Set(["assigned", "covered"]);

/**
 * Queues one message to one participant and schedules its delivery for when
 * quiet hours end. Nothing is queued for someone who hasn't joined, has
 * stopped or was silenced, or for a message already queued for the same
 * day, kind and participant (rows without a day are never duplicates). The
 * exception is `assigned` and `covered`: ajza' added while the message waits
 * join it, and once it was sent or skipped they get a new one. A juz' covered
 * before the message that assigned it went out leaves that message instead
 * (which goes when it names nothing more): the reader never heard of it.
 */
export async function enqueue(
  ctx: MutationCtx,
  row: {
    khatmaId: Id<"khatmas">;
    participantId: Id<"rotaParticipants">;
    dayId: Id<"rotaDays"> | null;
    kind: Kind;
    juz: number[];
    number: number | null;
    name?: string | null;
  },
): Promise<Id<"rotaOutbox"> | null> {
  const participant = await ctx.db.get(row.participantId);
  if (!reachable(participant)) return null;
  const khatma = await ctx.db.get(row.khatmaId);
  if (!khatma?.rota) return null;
  if (row.dayId !== null) {
    const dayId = row.dayId;
    const existing = await ctx.db
      .query("rotaOutbox")
      .withIndex("by_day_kind_participant", (q) =>
        q
          .eq("dayId", dayId)
          .eq("kind", row.kind)
          .eq("participantId", row.participantId),
      )
      .collect();
    if (row.kind === "covered") {
      const juz = await unassignUnsent(ctx, row.participantId, dayId, row.juz);
      if (juz.length === 0) return null;
      row = { ...row, juz };
    }
    if (MERGED_KINDS.has(row.kind)) {
      // More ajza' for a message not yet sent join it; once it went out, the
      // new ones are a message of their own.
      const unsent = existing.find(
        (r) => r.sentAt === null && r.skippedAt === null,
      );
      if (unsent) {
        const juz = [...new Set([...unsent.juz, ...row.juz])].sort(
          (a, b) => a - b,
        );
        await ctx.db.patch(unsent._id, { juz });
        return unsent._id;
      }
    } else if (existing.length > 0) {
      return null;
    }
  }
  const now = Date.now();
  const outboxId = await ctx.db.insert("rotaOutbox", {
    ...row,
    createdAt: now,
    sentAt: null,
    skippedAt: null,
  });
  const at = nextAwake(now, khatma.rota.timeZone, await quietHours(ctx));
  await ctx.scheduler.runAt(at, internal.rotaOutbox.deliver, { outboxId });
  return outboxId;
}

/**
 * Takes `juz` out of the participant's unsent `assigned` messages of the day,
 * deleting one left with nothing, and returns the ajza' none of them named.
 */
async function unassignUnsent(
  ctx: MutationCtx,
  participantId: Id<"rotaParticipants">,
  dayId: Id<"rotaDays">,
  juz: number[],
): Promise<number[]> {
  const unsent = (
    await ctx.db
      .query("rotaOutbox")
      .withIndex("by_day_kind_participant", (q) =>
        q
          .eq("dayId", dayId)
          .eq("kind", "assigned")
          .eq("participantId", participantId),
      )
      .collect()
  ).filter((r) => r.sentAt === null && r.skippedAt === null);
  let left = juz;
  for (const r of unsent) {
    const kept = r.juz.filter((j) => !juz.includes(j));
    if (kept.length === r.juz.length) continue;
    left = left.filter((j) => !r.juz.includes(j));
    if (kept.length === 0) await ctx.db.delete(r._id);
    else await ctx.db.patch(r._id, { juz: kept });
  }
  return left;
}

/** The payloads of a day's «أتممت» and «ليس بعد» buttons. */
function donePayloads(
  row: { dayId: string | null; participantId: Id<"rotaParticipants"> },
  staging: boolean,
) {
  const ids = { dayId: row.dayId as string, participantId: row.participantId };
  return {
    done: encodePayload({ action: "done", ...ids }, staging),
    notYet: encodePayload({ action: "notYet", ...ids }, staging),
  };
}

/** A free-form message under the khatma's title in bold, as a template has it in its header. */
export function titled(
  khatma: { name: string | null; createdAt: number },
  text: string,
): string {
  return `*${khatmaTitle(khatma)}*\n${text}`;
}

/** The khatma's last day, if it's dated today and still open. */
async function openDayToday(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  timeZone: string,
  now: number,
): Promise<Doc<"rotaDays"> | null> {
  const last = await lastRotaDay(ctx, khatmaId);
  return last &&
    last.closedAt === null &&
    last.date === localDate(now, timeZone)
    ? last
    : null;
}

/**
 * Gives a member joining for the first time during a day the ajza' their slots have that day,
 * where nobody has them: a day's assignments are fixed when its juz' message
 * goes out, so someone added since would otherwise wait for the next one. A
 * juz' given to someone else or already marked read stays as it is.
 */
export async function takeFreeJuzToday(
  ctx: MutationCtx,
  rota: RotaConfig,
  khatmaId: Id<"khatmas">,
  participantId: Id<"rotaParticipants">,
  now: number,
): Promise<void> {
  if (rota.pausedAt !== null) return;
  const day = await openDayToday(ctx, khatmaId, rota.timeZone, now);
  if (!day) return;
  const slots = await ctx.db
    .query("rotaSlots")
    .withIndex("by_participant", (q) => q.eq("participantId", participantId))
    .collect();
  for (const { slot } of slots) {
    const juz = juzFor(slot, day.number);
    const read = await ctx.db
      .query("rotaReads")
      .withIndex("by_day_juz", (q) => q.eq("dayId", day._id).eq("juz", juz))
      .first();
    if (read && read.readerId === null && read.doneAt === null) {
      await ctx.db.patch(read._id, {
        holderId: participantId,
        readerId: participantId,
      });
    }
  }
}

/** Whether a welcome queued now would go at once: `plan` holds it in quiet hours, and drops it outside the window. */
export async function welcomeGoesNow(
  ctx: QueryCtx,
  rota: RotaConfig,
  phone: string,
  now: number,
): Promise<boolean> {
  const awake = nextAwake(now, rota.timeZone, await quietHours(ctx));
  return awake <= now && (await windowOpen(ctx, phone, now));
}

/** Whether the phone wrote to Wirdak in the last 24 hours. */
async function windowOpen(
  ctx: QueryCtx,
  phone: string,
  now: number,
): Promise<boolean> {
  const contact = await ctx.db
    .query("waContacts")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .unique();
  return contact !== null && contact.lastInboundAt >= now - WINDOW_MS;
}

/**
 * The welcome for a member who has just joined: today's juz' with the buttons
 * when a day dated today is open and has unread reads for them, else when their
 * next reading day comes. Free-form: it needs the phone's 24-hour window.
 */
export async function welcomeMessage(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  participant: Participant,
  now: number,
): Promise<FreeForm> {
  const rota = khatma.rota;
  if (!rota) throw new Error("not a rota khatma");
  const title = khatmaTitle(khatma);
  // No day starts before the organizer finishes setting the khatma up.
  if (rota.setupDoneAt === null) {
    return {
      text: titled(khatma, welcomeText(participant.name, title, "notStarted")),
    };
  }
  const last = await openDayToday(ctx, khatma._id, rota.timeZone, now);
  if (last) {
    const juz = (
      await ctx.db
        .query("rotaReads")
        .withIndex("by_reader_day", (q) =>
          q.eq("readerId", participant._id).eq("dayId", last._id),
        )
        .collect()
    )
      .filter((r) => r.doneAt === null)
      .map((r) => r.juz)
      .sort((a, b) => a - b);
    if (juz.length > 0) {
      const text = `${welcomeText(participant.name, title, null)}\n${juzText(last.number, juz)}`;
      const payloads = donePayloads(
        { dayId: last._id, participantId: participant._id },
        isStaging(),
      );
      return {
        text: titled(khatma, text),
        buttons: [
          { id: payloads.done, title: ROTA_BUTTONS.done },
          { id: payloads.notYet, title: ROTA_BUTTONS.notYet },
        ],
      };
    }
  }
  const target = await targetDay(ctx, khatma);
  const next =
    target.date === null
      ? null
      : {
          weekday: weekdayText(target.date),
          time: clockText(rota.messages.dayAt),
        };
  return { text: titled(khatma, welcomeText(participant.name, title, next)) };
}

/** What a row says, as its template or, inside the 24-hour window, as free-form. */
function compose(
  row: Doc<"rotaOutbox">,
  khatma: { name: string | null; createdAt: number },
  inWindow: boolean,
  staging: boolean,
): TemplateMessage | FreeForm | null {
  const number = row.number ?? 0;
  switch (row.kind) {
    case "juz":
    case "reminder":
    case "assigned": {
      if (row.dayId === null || row.number === null) return null;
      const payloads = donePayloads(row, staging);
      if (!inWindow) {
        if (row.kind === "juz") {
          return juzTemplate(khatma, row.juz, number, payloads);
        }
        if (row.kind === "reminder") {
          return reminderTemplate(khatma, row.juz, payloads);
        }
        return assignedTemplate(khatma, row.juz, number, payloads);
      }
      const text =
        row.kind === "juz"
          ? juzText(number, row.juz)
          : row.kind === "reminder"
            ? reminderText(row.juz)
            : assignedText(row.juz, number);
      return {
        text: titled(khatma, text),
        buttons: [
          { id: payloads.done, title: ROTA_BUTTONS.done },
          { id: payloads.notYet, title: ROTA_BUTTONS.notYet },
        ],
      };
    }
    case "covered":
      return inWindow
        ? { text: titled(khatma, coveredText(row.juz)) }
        : coveredTemplate(khatma, row.juz);
    case "complete": {
      if (row.dayId === null || row.number === null) return null;
      if (inWindow) {
        return {
          text: titled(khatma, `${completeText(number)}\n\n${duaText()}`),
        };
      }
      const dua = encodePayload(
        {
          action: "dua",
          dayId: row.dayId,
          participantId: row.participantId,
        },
        staging,
      );
      return completeTemplate(khatma, number, dua);
    }
    case "cycle":
      return inWindow
        ? { text: titled(khatma, cycleText) }
        : cycleTemplate(khatma);
    case "cheer":
      // No template, as Meta would count it as marketing.
      return inWindow
        ? { text: titled(khatma, cheerText(number, row.name ?? null, row.juz)) }
        : null;
    case "welcome":
      // Needs the database; `plan` builds it (there is no template for it).
      return null;
  }
}

/**
 * What `deliver` sends for a row: null when it no longer calls for a message
 * (already sent or skipped, the participant isn't reachable, the khatma is gone,
 * or archived unless the row is a cycle thank-you, which is for reading already
 * finished, or a day's reading is closed or done), `retryAt` when it's quiet
 * hours in the khatma's time zone, or the phone and the message to send. Inside
 * the phone's 24-hour window the message is free-form, outside it a template.
 */
export const plan = internalQuery({
  args: { outboxId: v.id("rotaOutbox") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { phone: string; message: TemplateMessage | FreeForm }
    | { retryAt: number }
    | null
  > => {
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.sentAt !== null || row.skippedAt !== null) return null;
    const participant = await ctx.db.get(row.participantId);
    if (!reachable(participant)) return null;
    const khatma = await ctx.db.get(row.khatmaId);
    const rota = khatma?.rota;
    if (!khatma || !rota) return null;
    if (rota.archivedAt !== null && row.kind !== "cycle") return null;
    let waiting: number[] | null = null;
    if (
      row.dayId !== null &&
      (row.kind === "juz" || row.kind === "reminder" || row.kind === "assigned")
    ) {
      const day = await ctx.db.get(row.dayId);
      if (!day || day.closedAt !== null) return null;
      const dayId = day._id;
      const reads = await Promise.all(
        row.juz.map((juz) =>
          ctx.db
            .query("rotaReads")
            .withIndex("by_day_juz", (q) => q.eq("dayId", dayId).eq("juz", juz))
            .first(),
        ),
      );
      // Only reads still waiting on this participant call for the message,
      // and it names those, not the juz' as queued: one may have been
      // reassigned or read since.
      waiting = row.juz.filter((_, i) => {
        const read = reads[i];
        return read?.readerId === participant._id && read.doneAt === null;
      });
      if (waiting.length === 0) return null;
    }
    if (row.kind === "complete" && row.dayId !== null) {
      // A juz' marked not done since leaves the day incomplete.
      const day = await ctx.db.get(row.dayId);
      if (!day || day.completedAt === null) return null;
    }
    const now = Date.now();
    const awake = nextAwake(now, rota.timeZone, await quietHours(ctx));
    if (awake > now) return { retryAt: awake };
    const inWindow = await windowOpen(ctx, participant.phone, now);
    if (row.kind === "welcome") {
      // No template: outside the window the next juz' message follows anyway.
      if (!inWindow) return null;
      return {
        phone: participant.phone,
        message: await welcomeMessage(ctx, khatma, participant, now),
      };
    }
    const message = compose(
      waiting === null ? row : { ...row, juz: waiting },
      { name: khatma.name, createdAt: khatma.createdAt },
      inWindow,
      isStaging(),
    );
    return message === null ? null : { phone: participant.phone, message };
  },
});

/**
 * Claims a row for sending: marks it sent and returns true. Returns false
 * (so the caller must not send) when it was already sent or skipped, or when
 * the participant is no longer reachable since `plan` (a «إيقاف» may land in
 * between); then the row is marked skipped.
 */
export const markSent = internalMutation({
  args: { outboxId: v.id("rotaOutbox") },
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.sentAt !== null || row.skippedAt !== null) return false;
    const now = Date.now();
    if (!reachable(await ctx.db.get(row.participantId))) {
      await ctx.db.patch(args.outboxId, { skippedAt: now });
      return false;
    }
    await ctx.db.patch(args.outboxId, { sentAt: now });
    return true;
  },
});

/** Marks a row skipped, unless it was already sent or skipped. */
export const markSkipped = internalMutation({
  args: { outboxId: v.id("rotaOutbox") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.sentAt !== null || row.skippedAt !== null) return;
    await ctx.db.patch(args.outboxId, { skippedAt: Date.now() });
  },
});

/**
 * Sends one queued message, once. Marked sent before sending, so a retried
 * action never sends twice; a failed send isn't retried. During quiet hours
 * it runs again when they end.
 */
export const deliver = internalAction({
  args: { outboxId: v.id("rotaOutbox") },
  handler: async (ctx, args) => {
    const plan = await ctx.runQuery(internal.rotaOutbox.plan, args);
    if (!plan) {
      await ctx.runMutation(internal.rotaOutbox.markSkipped, args);
      return;
    }
    if ("retryAt" in plan) {
      await ctx.scheduler.runAt(
        plan.retryAt,
        internal.rotaOutbox.deliver,
        args,
      );
      return;
    }
    if (!(await ctx.runMutation(internal.rotaOutbox.markSent, args))) return;
    const { phone, message } = plan;
    if ("name" in message) {
      await sendWhatsAppTemplate(phone, message);
    } else if (message.buttons) {
      await sendWhatsAppButtons(phone, message.text, message.buttons);
    } else {
      await sendWhatsAppText(phone, message.text);
    }
  },
});

/**
 * Staging and dev only: sends each rota template to a phone with sample
 * values, so they can be checked on a handset:
 * `bun run convex run rotaOutbox:sendSample '{"phone":"+9715…"}'`.
 * No opt-in or window checks.
 */
export const sendSample = internalAction({
  args: { phone: v.string() },
  handler: async (_ctx, args): Promise<boolean[]> => {
    if (!isDev() && !isStaging()) {
      throw new Error("sendSample runs only when WIRDAK_ENV is dev or staging");
    }
    const staging = isStaging();
    const khatma = { name: "ختمة العائلة", createdAt: Date.now() };
    const ids = { dayId: "sample", participantId: "sample" };
    const payloads = {
      done: encodePayload({ action: "done", ...ids }, staging),
      notYet: encodePayload({ action: "notYet", ...ids }, staging),
    };
    const messages = [
      juzTemplate(khatma, [5, 6], 3, payloads),
      reminderTemplate(khatma, [5, 6], payloads),
      assignedTemplate(khatma, [3, 5, 6], 7, payloads),
      coveredTemplate(khatma, [26]),
      completeTemplate(
        khatma,
        30,
        encodePayload({ action: "dua", ...ids }, staging),
      ),
      cycleTemplate(khatma),
    ];
    const results: boolean[] = [];
    for (const message of messages) {
      results.push(await sendWhatsAppTemplate(args.phone, message));
    }
    return results;
  },
});
