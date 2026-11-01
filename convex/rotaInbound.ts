import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { scheduleRotaCheer } from "./cheers";
import { isBlocked } from "./lib/blocked";
import { refreshPhone } from "./lib/directory";
import { isArchived } from "./lib/khatma";
import { notify } from "./notes";
import { celebrateIfComplete, completeIfDone } from "./rotaDays";
import { takeFreeJuzToday, titled, welcomeMessage } from "./rotaOutbox";
import { isStaging, MAX_BUTTON_TITLE, MAX_REPLY_BUTTONS } from "./whatsapp";
import { findJoinCode } from "./lib/rotaJoin";
import { decodePayload, encodePayload } from "./lib/rotaPayload";
import { classifyReply } from "./lib/rotaReplies";
import {
  alreadyText,
  askOrganizerText,
  clockText,
  closedText,
  duaText,
  endedText,
  helpText,
  manyKhatmasText,
  notOnListText,
  notYetText,
  stopText,
  lateThanksText,
  thanksText,
  whichKhatmaText,
} from "./lib/rotaTemplates";
import { maskPhone, toArabicDigits } from "./lib/text";
import { localDate, localMinutes } from "./lib/wakingTime";
import { khatmaTitle } from "./lib/whatsappTemplates";

/**
 * A rota member's WhatsApp messages to Wirdak: their join message, their taps
 * on a message's buttons, and their typed replies. The replies go out at once
 * from the inbound action, since they answer the member's own message.
 */

type Participant = Doc<"rotaParticipants">;
type Khatma = Doc<"khatmas">;
type Day = Doc<"rotaDays">;
type RotaConfig = NonNullable<Khatma["rota"]>;

export type InboundReply = {
  kind: "reply";
  text: string;
  buttons?: { id: string; title: string }[];
};
/** The replies to send, in order, or `none` when the message isn't a rota one. */
export type InboundResult = { kind: "none" } | InboundReply[];

const NONE = { kind: "none" } as const;

function reply(text: string, buttons?: InboundReply["buttons"]): InboundReply {
  return buttons ? { kind: "reply", text, buttons } : { kind: "reply", text };
}

/** A reply about one khatma, under its title in bold like every free-form rota message. */
const about = (khatma: Khatma, text: string) => reply(titled(khatma, text));

const isActive = (p: Participant) => p.removedAt == null;
const hasJoined = (p: Participant) => isActive(p) && p.joinedAt != null;

/** A declined join request holds off another from the same phone for this long. */
const DECLINED_COOLDOWN_MS = 7 * 86_400_000;

/** Whether any of these participants is on a khatma that is still running. */
async function onRunningKhatma(
  ctx: MutationCtx,
  participants: Participant[],
): Promise<boolean> {
  for (const p of participants) {
    const khatma = await ctx.db.get(p.khatmaId);
    if (khatma && !isArchived(khatma)) return true;
  }
  return false;
}

/**
 * Opens the phone's 24-hour window, but only for a phone Wirdak may write to:
 * one on the list of a rota khatma still running (`active`, the phone's
 * participants that `recordReply` loaded), or with a join request waiting.
 * Every other number's messages leave no trace here.
 */
async function openWindow(
  ctx: MutationCtx,
  phone: string,
  now: number,
  active: Participant[],
): Promise<void> {
  const listed = await onRunningKhatma(ctx, active);
  const asking =
    !listed &&
    (
      await ctx.db
        .query("rotaJoinRequests")
        .withIndex("by_phone", (q) => q.eq("phone", phone))
        .collect()
    ).some((r) => r.resolvedAt === null);
  if (!listed && !asking) return;
  const contact = await ctx.db
    .query("waContacts")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .unique();
  if (contact) {
    await ctx.db.patch(contact._id, { lastInboundAt: now });
  } else {
    await ctx.db.insert("waContacts", { phone, lastInboundAt: now });
  }
}

/**
 * Counts the message as a reply from each of the phone's participants, which
 * resets the silence count and turns messages a silence stopped back on.
 * Returns the phone's active participants.
 */
async function recordReply(
  ctx: MutationCtx,
  phone: string,
  now: number,
): Promise<Participant[]> {
  const rows = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .collect();
  const active = rows.filter(isActive);
  for (const p of active) {
    await ctx.db.patch(p._id, {
      lastReplyAt: now,
      silentDays: 0,
      silencedAt: null,
    });
  }
  if (active.length > 0) await refreshPhone(ctx, phone);
  return active;
}

/**
 * A day's reads as one participant sees them: the ones they read now, and the
 * ones they hold that went to someone else (their «أتممت» still counts for
 * those, spec 6.2), with all of the day's reads.
 */
async function readsOf(ctx: MutationCtx, participant: Participant, day: Day) {
  const all = await ctx.db
    .query("rotaReads")
    .withIndex("by_day_juz", (q) => q.eq("dayId", day._id))
    .collect();
  const reading = all.filter((r) => r.readerId === participant._id);
  const handedOn = all.filter(
    (r) => r.holderId === participant._id && r.readerId !== participant._id,
  );
  return { all, reading, handedOn };
}

/** The day's reminder time, when it is on and still ahead today. */
function reminderAhead(rota: RotaConfig, day: Day, now: number): string | null {
  const { reminder } = rota.messages;
  if (!reminder.on || day.reminderSentAt != null || rota.pausedAt !== null) {
    return null;
  }
  if (day.date !== localDate(now, rota.timeZone)) return null;
  if (localMinutes(now, rota.timeZone) >= reminder.at) return null;
  return clockText(reminder.at);
}

/** Whether a closed day still takes this answer: only «أتممت», until its late window ends. */
function lateTapOpen(
  khatma: Khatma,
  day: Day,
  action: "done" | "notYet",
  now: number,
): boolean {
  return action === "done" && now < (day.lateUntil ?? 0) && !isArchived(khatma);
}

/**
 * The days of a khatma a typed answer may be for, oldest first: the day just
 * ended, while its late window lasts, then the open day.
 */
async function answerableDays(
  ctx: MutationCtx,
  khatma: Khatma,
  action: "done" | "notYet",
  now: number,
): Promise<Day[]> {
  const recent = await ctx.db
    .query("rotaDays")
    .withIndex("by_khatma_n", (q) => q.eq("khatmaId", khatma._id))
    .order("desc")
    .take(2);
  return recent
    .filter((d) => d.closedAt === null || lateTapOpen(khatma, d, action, now))
    .reverse();
}

/**
 * «أتممت» or «ليس بعد» for one participant's reads of one day. «أتممت» marks
 * all of them done (two slots, one tap), and the ones they hold that were
 * handed to someone else too; the tap that completes the day brings the dua
 * with the thanks, and everyone else gets the completion message. «ليس بعد»
 * marks only what they read now. Changes nothing on a closed day or with
 * nothing left to read.
 */
async function answerDay(
  ctx: MutationCtx,
  khatma: Khatma,
  participant: Participant,
  day: Day,
  action: "done" | "notYet",
  now: number,
): Promise<InboundReply[]> {
  const rota = khatma.rota;
  const late = day.closedAt !== null;
  if (!rota || (late && !lateTapOpen(khatma, day, action, now))) {
    return [about(khatma, closedText)];
  }
  const { all, reading, handedOn } = await readsOf(ctx, participant, day);
  const unread = reading.filter((r) => r.doneAt === null);
  const unreadHandedOn = handedOn.filter((r) => r.doneAt === null);
  if (unread.length === 0 && unreadHandedOn.length === 0) {
    return [about(khatma, alreadyText)];
  }
  if (action === "notYet") {
    // A juz' handed to someone else is theirs to answer for now.
    for (const r of unread) await ctx.db.patch(r._id, { notYetAt: now });
    const reminder = unread.length > 0 ? reminderAhead(rota, day, now) : null;
    return [about(khatma, notYetText(reminder))];
  }
  const marked = [...unread, ...unreadHandedOn];
  for (const r of marked) {
    await ctx.db.patch(r._id, { doneAt: now, doneByOrganizer: false });
  }
  const [first] = marked;
  if (first) await scheduleRotaCheer(ctx, first._id, now, participant._id);
  const done = all.filter((r) => r.doneAt !== null).length + marked.length;
  const replies = [
    about(khatma, late ? lateThanksText(day.number) : thanksText(done)),
  ];
  if (await completeIfDone(ctx, day._id)) {
    await celebrateIfComplete(ctx, day._id, participant._id);
    replies.push(about(khatma, duaText()));
  }
  return replies;
}

/**
 * A tap on a rota message's button. The payload names a day and a
 * participant, and only that participant's own phone may act on it: from any
 * other phone nothing changes. A tap on another deployment's message is
 * left for the relay.
 */
async function answerTap(
  ctx: MutationCtx,
  phone: string,
  payload: string,
  now: number,
): Promise<InboundResult> {
  const decoded = decodePayload(payload);
  if (decoded === null || decoded.staging !== isStaging()) return NONE;
  const participantId = ctx.db.normalizeId(
    "rotaParticipants",
    decoded.participantId,
  );
  const participant = participantId ? await ctx.db.get(participantId) : null;
  if (!participant || participant.phone !== phone || !isActive(participant)) {
    return [reply(helpText)];
  }
  const khatma = await ctx.db.get(participant.khatmaId);
  if (!khatma) return [reply(helpText)];
  if (decoded.action === "dua") return [about(khatma, duaText())];
  const dayId = ctx.db.normalizeId("rotaDays", decoded.dayId);
  const day = dayId ? await ctx.db.get(dayId) : null;
  if (!day || day.khatmaId !== participant.khatmaId) return [reply(helpText)];
  return await answerDay(ctx, khatma, participant, day, decoded.action, now);
}

/** The reply to a listed member's join message: today's juz' if a day of theirs is open, else when the next one comes. */
async function welcome(
  ctx: MutationCtx,
  khatma: Khatma,
  participant: Participant,
  now: number,
): Promise<InboundReply> {
  const message = await welcomeMessage(ctx, khatma, participant, now);
  return reply(message.text, message.buttons);
}

/**
 * An admin set this khatma up on someone's behalf: the join message from that
 * person's own number makes them its organizer. Any other phone changes nothing
 * here, and neither does a blocked one. The membership has no share token: drawing one takes an action, and a
 * rota khatma has no use for it.
 */
async function takeUpOrganizing(
  ctx: MutationCtx,
  khatma: Khatma,
  rota: RotaConfig,
  args: { phone: string; now: number },
): Promise<void> {
  if (rota.pendingOrganizer !== true) return;
  const organizer = await ctx.db.get(khatma.creatorPersonId);
  if (organizer?.phone !== args.phone) return;
  // A number an admin blocked takes nothing up.
  if (await isBlocked(ctx, args.phone)) return;
  await ctx.db.insert("members", {
    khatmaId: khatma._id,
    personId: organizer._id,
    joinedAt: args.now,
    status: "active",
    notificationsOn: true,
    lastNudgeAt: null,
    lastCelebratedRound: 0,
  });
  await refreshPhone(ctx, organizer.phone);
  await ctx.db.patch(khatma._id, {
    rota: { ...rota, pendingOrganizer: false },
  });
  await notify(ctx, {
    personId: organizer._id,
    khatmaId: khatma._id,
    kind: "nowOrganizer",
  });
}

/**
 * A join message for a rota khatma, or null when this deployment has no such
 * khatma. An archived khatma only says it has ended. A listed phone joins (or rejoins
 * after «إيقاف»); any other phone files one open join request, and the
 * organizer is told once. A blocked number gets no request and no reply, and
 * a number declined in the last 7 days gets the reply but no new request.
 * A join never signs anyone in.
 */
async function join(
  ctx: MutationCtx,
  args: { phone: string; profileName?: string; now: number },
  code: string,
): Promise<InboundReply[] | null> {
  const khatma = await ctx.db
    .query("khatmas")
    .withIndex("by_joinCode", (q) => q.eq("joinCode", code))
    .first();
  const rota = khatma?.rota;
  if (!khatma || khatma.kind !== "rota" || !rota) return null;
  if (rota.archivedAt !== null) return [about(khatma, endedText)];
  await takeUpOrganizing(ctx, khatma, rota, args);
  const rows = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_khatma_phone", (q) =>
      q.eq("khatmaId", khatma._id).eq("phone", args.phone),
    )
    .collect();
  const participant = rows.find(isActive);
  if (!participant) {
    // A number an admin blocked asks nobody anything, and hears nothing back.
    if (await isBlocked(ctx, args.phone)) return [];
    const requests = await ctx.db
      .query("rotaJoinRequests")
      .withIndex("by_khatma_phone", (q) =>
        q.eq("khatmaId", khatma._id).eq("phone", args.phone),
      )
      .collect();
    const waiting = requests.some((r) => r.resolvedAt === null);
    // A request the organizer declined lately isn't filed again yet. One the
    // number withdrew itself with «إيقاف» doesn't hold it off.
    const lastDeclined = requests
      .filter(
        (r) =>
          r.outcome === "declined" &&
          r.resolvedAt !== null &&
          r.resolvedAt > args.now - DECLINED_COOLDOWN_MS,
      )
      .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))[0];
    const heldOff =
      lastDeclined !== undefined && lastDeclined.declinedBy !== "member";
    if (!waiting && heldOff) return [about(khatma, askOrganizerText)];
    if (!waiting) {
      const profileName = args.profileName ? args.profileName : null;
      await ctx.db.insert("rotaJoinRequests", {
        khatmaId: khatma._id,
        phone: args.phone,
        profileName,
        createdAt: args.now,
        resolvedAt: null,
        outcome: null,
      });
      await notify(ctx, {
        personId: khatma.creatorPersonId,
        khatmaId: khatma._id,
        kind: "rotaJoinRequest",
        name: profileName ?? maskPhone(args.phone),
      });
    }
    return [about(khatma, notOnListText)];
  }
  const person =
    participant.personId === null
      ? await ctx.db
          .query("people")
          .withIndex("by_phone", (q) => q.eq("phone", args.phone))
          .first()
      : null;
  const joined: Participant = {
    ...participant,
    joinedAt: participant.joinedAt ?? args.now,
    stoppedAt: null,
    ...(person && { personId: person._id }),
  };
  await ctx.db.patch(participant._id, {
    joinedAt: joined.joinedAt,
    stoppedAt: null,
    personId: joined.personId,
  });
  if (participant.joinedAt == null) {
    await takeFreeJuzToday(ctx, rota, khatma._id, joined._id, args.now);
  }
  return [await welcome(ctx, khatma, joined, args.now)];
}

/** «إيقاف»: stops every khatma's messages for the phone and tells each live khatma's organizer. */
async function stop(
  ctx: MutationCtx,
  joined: Participant[],
  now: number,
): Promise<InboundReply[]> {
  for (const p of joined) {
    if (p.stoppedAt != null) continue;
    await ctx.db.patch(p._id, { stoppedAt: now });
    const khatma = await ctx.db.get(p.khatmaId);
    if (!khatma || isArchived(khatma)) continue;
    await notify(ctx, {
      personId: khatma.creatorPersonId,
      khatmaId: khatma._id,
      kind: "rotaStopped",
      name: p.name,
    });
  }
  return [reply(stopText)];
}

/** Declines the phone's open join requests; whether it had any. */
async function declineRequests(
  ctx: MutationCtx,
  phone: string,
  now: number,
): Promise<boolean> {
  const open = (
    await ctx.db
      .query("rotaJoinRequests")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .collect()
  ).filter((r) => r.resolvedAt === null);
  for (const r of open) {
    await ctx.db.patch(r._id, {
      resolvedAt: now,
      outcome: "declined",
      declinedBy: "member",
    });
  }
  return open.length > 0;
}

/**
 * Button titles for `titles`, cut to what WhatsApp shows and kept apart:
 * a title equal to an earlier one ends in « ٢», « ٣».
 */
function distinctTitles(titles: string[]): string[] {
  const cut = (s: string, max: number) =>
    Array.from(s).slice(0, max).join("").trimEnd();
  const used = new Set<string>();
  return titles.map((full) => {
    const base = cut(full, MAX_BUTTON_TITLE);
    let title = base;
    for (let n = 2; used.has(title); n++) {
      const suffix = ` ${toArabicDigits(n)}`;
      title = `${cut(base, MAX_BUTTON_TITLE - suffix.length)}${suffix}`;
    }
    used.add(title);
    return title;
  });
}

/**
 * A typed «تم» or «ليس بعد». It acts only when exactly one open day has
 * unread reads for the phone; with several, the reply asks which khatma,
 * with one button per khatma (or, with more than buttons fit, names them),
 * and changes nothing.
 */
async function answerTyped(
  ctx: MutationCtx,
  joined: Participant[],
  action: "done" | "notYet",
  now: number,
): Promise<InboundReply[]> {
  const open: { participant: Participant; khatma: Khatma; day: Day }[] = [];
  let anyRead = false;
  for (const participant of joined) {
    const khatma = await ctx.db.get(participant.khatmaId);
    if (!khatma) continue;
    for (const day of await answerableDays(ctx, khatma, action, now)) {
      const { reading, handedOn } = await readsOf(ctx, participant, day);
      const reads = [...reading, ...handedOn];
      if (reads.length === 0) continue;
      anyRead = true;
      if (!reads.some((r) => r.doneAt === null)) continue;
      open.push({ participant, khatma, day });
      // The older unread day first; the next «تم» reaches the newer one.
      break;
    }
  }
  if (open.length === 1) {
    const [{ participant, khatma, day }] = open as [(typeof open)[number]];
    return await answerDay(ctx, khatma, participant, day, action, now);
  }
  if (open.length === 0) return [reply(anyRead ? alreadyText : helpText)];
  const titles = open.map(({ khatma }) => khatmaTitle(khatma));
  if (open.length > MAX_REPLY_BUTTONS) return [reply(manyKhatmasText(titles))];
  const buttonTitles = distinctTitles(titles);
  return [
    reply(
      whichKhatmaText,
      open.map(({ participant, day }, i) => ({
        id: encodePayload(
          { action, dayId: day._id, participantId: participant._id },
          isStaging(),
        ),
        title: buttonTitles[i]!,
      })),
    ),
  ];
}

/**
 * The newest of the phone's joined khatmas when every one of them is archived,
 * so a reply can say it ended; null with one still running.
 */
async function allEnded(
  ctx: MutationCtx,
  joined: Participant[],
): Promise<Khatma | null> {
  let newest: Khatma | null = null;
  for (const p of joined) {
    const khatma = await ctx.db.get(p.khatmaId);
    if (!khatma) continue;
    if (!isArchived(khatma)) return null;
    if (!newest || khatma.createdAt > newest.createdAt) newest = khatma;
  }
  return newest;
}

/** Whether the phone is on any rota khatma's list (not removed). */
export const hasParticipant = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const rows = await ctx.db
      .query("rotaParticipants")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .collect();
    return rows.some(isActive);
  },
});

/**
 * One incoming WhatsApp message that no sign-in code took. Every message
 * first counts as a reply from the phone's participants. Then, in order: a
 * button tap, a join message, and a typed reply from a phone with a rota
 * participant (a rota word from any of them; anything else only from a
 * joined one, and not when `mayBeSignIn`, so another deployment's sign-in
 * code is left for the relay). When all the phone's joined khatmas are
 * archived, only «إيقاف» still acts, and anything else hears that it ended.
 * `none` means it isn't a rota message here (a phone with no participant, or
 * a join code or a tap this deployment doesn't have). Last, the phone's
 * 24-hour window opens if it is on a running khatma's list or has a join
 * request waiting.
 */
export const handle = internalMutation({
  args: {
    phone: v.string(),
    text: v.string(),
    payload: v.optional(v.string()),
    profileName: v.optional(v.string()),
    mayBeSignIn: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<InboundResult> => {
    const active = await recordReply(ctx, args.phone, args.now);
    const result = await route(ctx, args, active);
    // After the message is handled, so a join request filed just now counts.
    await openWindow(ctx, args.phone, args.now, active);
    return result;
  },
});

/**
 * Media from a rota phone: a reply like any other, with nothing to answer.
 * Returns whether the phone has a participant here.
 */
export const recordMedia = internalMutation({
  args: { phone: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<boolean> => {
    const active = await recordReply(ctx, args.phone, args.now);
    if (active.length === 0) return false;
    await openWindow(ctx, args.phone, args.now, active);
    return true;
  },
});

/** What `handle` does with the message, before the window opens; `active` is the phone's participants. */
async function route(
  ctx: MutationCtx,
  args: {
    phone: string;
    text: string;
    payload?: string;
    profileName?: string;
    mayBeSignIn?: boolean;
    now: number;
  },
  active: Participant[],
): Promise<InboundResult> {
  if (args.payload !== undefined) {
    return await answerTap(ctx, args.phone, args.payload, args.now);
  }
  const code = findJoinCode(args.text);
  if (code !== null) return (await join(ctx, args, code)) ?? NONE;
  if (active.length === 0) {
    // «إيقاف» from a number that only asked to join withdraws its requests.
    if (classifyReply(args.text) !== "stop") return NONE;
    return (await declineRequests(ctx, args.phone, args.now))
      ? [reply(stopText)]
      : NONE;
  }
  const joined = active.filter(hasJoined);
  const word = classifyReply(args.text);
  if (word === "stop") {
    // Withdraws any join request too, so accepting one can't write to them.
    await declineRequests(ctx, args.phone, args.now);
    return await stop(ctx, joined, args.now);
  }
  if (word === null && args.mayBeSignIn) return NONE;
  const ended = await allEnded(ctx, joined);
  if (ended) return [about(ended, endedText)];
  switch (word) {
    case "done":
    case "notYet":
      return await answerTyped(ctx, joined, word, args.now);
    case "dua":
      return [reply(duaText())];
    case null:
      return joined.length === 0 ? NONE : [reply(helpText)];
  }
}
