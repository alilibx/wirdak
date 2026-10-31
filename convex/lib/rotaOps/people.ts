import { ConvexError } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  enqueue,
  slotFreeToday,
  takeFreeJuzToday,
  welcomeGoesNow,
} from "../../rotaOutbox";
import { env } from "../../whatsapp";
import {
  readingDaysKind,
  ROTA_SIZE,
  slotFor,
  type ReadingDaysKind,
} from "../rota";
import { isArchived } from "../khatma";
import { khatmaJoinLink } from "../rotaJoin";
import { slotRowsByJuz, targetDay, type RotaConfig } from "../rotaPlace";
import { NEW_MEMBER_NAME } from "../rotaTemplates";
import { getSetting } from "../settings";
import { cleanDisplayName, maskPhone, normalizePhone } from "../text";
import { localMinutes } from "../wakingTime";
import { khatmaTitle } from "../whatsappTemplates";

/** From 18:00, six hours before the day ends, the organizer says when someone they add starts. */
const LATE_ADD_FROM = 18 * 60;

/** Whoever is running the khatma. An admin helping out has no `personId`: nobody is "me" to them. */
export type Actor = { personId: Id<"people"> | null };

/** Whether this participant is the actor themselves. */
export function isActor(
  participant: Doc<"rotaParticipants">,
  actor: Actor,
): boolean {
  return actor.personId !== null && participant.personId === actor.personId;
}

/**
 * Ends setup: from now the khatma's days may start, and if today's start
 * time has passed already, today's day starts at once. Safe to repeat.
 */
export async function finishSetup(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
): Promise<{ ok: true }> {
  if (rota.setupDoneAt === null) {
    await ctx.db.patch(khatma._id, {
      rota: { ...rota, setupDoneAt: Date.now() },
    });
    await ctx.scheduler.runAfter(0, internal.rotaDays.tick, {
      khatmaId: khatma._id,
    });
  }
  return { ok: true };
}

/** An active participant of the khatma, or null. */
export async function activeParticipant(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  participantId: Id<"rotaParticipants">,
): Promise<Doc<"rotaParticipants"> | null> {
  const participant = await ctx.db.get(participantId);
  return participant &&
    participant.khatmaId === khatmaId &&
    participant.removedAt === null
    ? participant
    : null;
}

function isJuz(juz: number): boolean {
  return Number.isInteger(juz) && juz >= 1 && juz <= ROTA_SIZE;
}

/**
 * What the organizer sees of one participant; the phone is the one they typed,
 * and null for someone imported from a pool khatma (the organizer never sees it).
 */
type PersonState = {
  phone: string | null;
  /** They sent their own join message. */
  joined: boolean;
  /** They sent «إيقاف». */
  stopped: boolean;
  /** Wirdak stopped messaging them after days without a reply. */
  silenced: boolean;
  /** They run the khatma, so nobody can take them out of it. */
  isOrganizer: boolean;
};

export type PeopleView = {
  /** The khatma's title, as the join message names it. */
  title: string;
  /** Read-only: nothing can be set up on it any more. */
  archived: boolean;
  /** How often the khatma is read, as the share message says it. */
  daysKind: ReadingDaysKind;
  /** The wa.me link members tap to join; null until the khatma has a join code. */
  joinLink: string | null;
  /** Numbers that sent the join code and wait for the organizer's answer. */
  requests: {
    id: Id<"rotaJoinRequests">;
    name: string | null;
    phoneMasked: string;
    createdAt: number;
  }[];
  target: { number: number; date: string | null; isFirst: boolean };
  rows: {
    juz: number;
    participant:
      | ({
          id: Id<"rotaParticipants">;
          name: string;
          isMe: boolean;
          slots: number;
        } & PersonState)
      | null;
  }[];
  participants: ({
    id: Id<"rotaParticipants">;
    name: string;
    isMe: boolean;
    juz: number[];
  } & PersonState)[];
  freeJuz: number[];
  maxSlots: number;
};

function personState(
  p: Doc<"rotaParticipants">,
  khatma: Doc<"khatmas">,
): PersonState {
  return {
    isOrganizer: p.personId === khatma.creatorPersonId,
    phone: p.phoneHidden === true ? null : p.phone,
    joined: p.joinedAt != null,
    stopped: p.stoppedAt != null,
    silenced: p.silencedAt != null,
  };
}

/** Everyone in the khatma and who holds which juz' of the next day to start. */
export async function people(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  actor: Actor,
): Promise<PeopleView> {
  const target = await targetDay(ctx, khatma);
  const byJuz = await slotRowsByJuz(ctx, khatma._id, target.number);
  const participants = (
    await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect()
  )
    .filter((p) => p.removedAt === null)
    .sort((a, b) => a.addedAt - b.addedAt || a._creationTime - b._creationTime);
  const heldBy = new Map<Id<"rotaParticipants">, number[]>();
  for (let juz = 1; juz <= ROTA_SIZE; juz++) {
    const row = byJuz.get(juz);
    if (!row) continue;
    heldBy.set(row.participantId, [
      ...(heldBy.get(row.participantId) ?? []),
      juz,
    ]);
  }
  const byId = new Map(participants.map((p) => [p._id, p]));
  const requests = (
    await ctx.db
      .query("rotaJoinRequests")
      .withIndex("by_khatma_open", (q) =>
        q.eq("khatmaId", khatma._id).eq("resolvedAt", null),
      )
      .collect()
  ).sort((a, b) => a.createdAt - b.createdAt);
  return {
    title: khatmaTitle(khatma),
    archived: isArchived(khatma),
    daysKind: readingDaysKind(rota.days),
    joinLink: khatmaJoinLink(khatma, env("WHATSAPP_PUBLIC_NUMBER")),
    requests: requests.map((r) => ({
      id: r._id,
      name: r.profileName,
      phoneMasked: maskPhone(r.phone),
      createdAt: r.createdAt,
    })),
    target: {
      number: target.number,
      date: target.date,
      isFirst: target.n === 1,
    },
    rows: Array.from({ length: ROTA_SIZE }, (_, i) => {
      const juz = i + 1;
      const holderId = byJuz.get(juz)?.participantId;
      const holder = holderId ? byId.get(holderId) : undefined;
      return {
        juz,
        participant: holder
          ? {
              id: holder._id,
              name: holder.name,
              isMe: isActor(holder, actor),
              slots: heldBy.get(holder._id)?.length ?? 0,
              ...personState(holder, khatma),
            }
          : null,
      };
    }),
    participants: participants.map((p) => ({
      id: p._id,
      name: p.name,
      isMe: isActor(p, actor),
      juz: heldBy.get(p._id) ?? [],
      ...personState(p, khatma),
    })),
    freeJuz: Array.from({ length: ROTA_SIZE }, (_, i) => i + 1).filter(
      (juz) => !byJuz.has(juz),
    ),
    maxSlots: await getSetting(ctx, "rotaMaxSlotsPerPerson"),
  };
}

/**
 * Adds a new participant to the khatma on the juz' (or the lowest free one
 * when `juz` is undefined) of the next day to start. `joinedAt` is set only
 * for someone who already sent their join message.
 */
export async function placeNewParticipant(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  who: {
    name: string;
    phone: string;
    personId: Id<"people"> | null;
    /** Imported from a pool khatma: no client gets the phone. */
    phoneHidden?: boolean;
  },
  juz: number | undefined,
  joinedAt?: number,
  /** The organizer's add screens: late in the day, they say when the person starts. */
  late?: { readsToday: boolean | undefined },
): Promise<
  | { participantId: Id<"rotaParticipants">; juz: number }
  | { error: "no_free_juz" | "juz_taken" | "ask_today" }
> {
  const target = await targetDay(ctx, khatma);
  const byJuz = await slotRowsByJuz(ctx, khatma._id, target.number);
  if (juz === undefined) {
    juz = Array.from({ length: ROTA_SIZE }, (_, i) => i + 1).find(
      (j) => !byJuz.has(j),
    );
    if (juz === undefined) return { error: "no_free_juz" };
  } else if (!isJuz(juz)) {
    throw new ConvexError({ code: "invalid_juz" });
  } else if (byJuz.has(juz)) {
    return { error: "juz_taken" };
  }

  const slot = slotFor(juz, target.number);
  const asks =
    late !== undefined &&
    target.date !== null &&
    (await lateInTheDay(ctx, khatma, who.phone, slot, joinedAt !== undefined));
  if (asks && late.readsToday === undefined) return { error: "ask_today" };
  const readsFrom = asks && !late.readsToday ? target.date : null;

  const participantId = await ctx.db.insert("rotaParticipants", {
    khatmaId: khatma._id,
    name: who.name,
    phone: who.phone,
    personId: who.personId,
    addedAt: Date.now(),
    removedAt: null,
    ...(who.phoneHidden === true ? { phoneHidden: true } : {}),
    ...(joinedAt !== undefined ? { joinedAt } : {}),
    ...(readsFrom !== null ? { readsFrom } : {}),
  });
  await ctx.db.insert("rotaSlots", {
    khatmaId: khatma._id,
    slot,
    participantId,
  });
  return { participantId, juz };
}

/**
 * Whether someone added now, in the day's last six hours, could still take
 * today's juz', so the organizer should say if they do. Someone already joined
 * takes it only with a welcome that goes at once.
 */
async function lateInTheDay(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  phone: string,
  slot: number,
  joined: boolean,
): Promise<boolean> {
  const rota = khatma.rota;
  const now = Date.now();
  if (!rota || localMinutes(now, rota.timeZone) < LATE_ADD_FROM) return false;
  if (!(await slotFreeToday(ctx, rota, khatma._id, slot, now))) return false;
  return !joined || (await welcomeGoesNow(ctx, rota, phone, now));
}

export async function addParticipant(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { name: string; phone: string; juz?: number; readsToday?: boolean },
): Promise<
  | { ok: true; participantId: Id<"rotaParticipants">; juz: number }
  | {
      error:
        | "bad_name"
        | "bad_phone"
        | "no_free_juz"
        | "juz_taken"
        | "already_added"
        | "ask_today";
    }
> {
  const name = cleanDisplayName(args.name);
  if (name === null) return { error: "bad_name" };
  const phone = normalizePhone(args.phone);
  if (phone === null) return { error: "bad_phone" };
  const same = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_khatma_phone", (q) =>
      q.eq("khatmaId", khatma._id).eq("phone", phone),
    )
    .collect();
  if (same.some((p) => p.removedAt === null)) {
    return { error: "already_added" };
  }

  const placed = await placeNewParticipant(
    ctx,
    khatma,
    { name, phone, personId: null },
    args.juz,
    undefined,
    { readsToday: args.readsToday },
  );
  if ("error" in placed) return placed;
  const organizer = await ctx.db.get(khatma.creatorPersonId);
  if (organizer) {
    await saveContact(ctx, organizer, {
      name,
      phone,
      hidden: false,
      personId: null,
    });
  }
  return { ok: true, ...placed };
}

export async function giveJuz(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { participantId: Id<"rotaParticipants">; juz: number },
): Promise<{ ok: true } | { error: "juz_taken" | "too_many" | "not_found" }> {
  const participant = await activeParticipant(
    ctx,
    khatma._id,
    args.participantId,
  );
  if (!participant || !isJuz(args.juz)) return { error: "not_found" };
  const target = await targetDay(ctx, khatma);
  const byJuz = await slotRowsByJuz(ctx, khatma._id, target.number);
  if (byJuz.has(args.juz)) return { error: "juz_taken" };
  const held = await ctx.db
    .query("rotaSlots")
    .withIndex("by_participant", (q) => q.eq("participantId", participant._id))
    .collect();
  if (held.length >= (await getSetting(ctx, "rotaMaxSlotsPerPerson"))) {
    return { error: "too_many" };
  }
  await ctx.db.insert("rotaSlots", {
    khatmaId: khatma._id,
    slot: slotFor(args.juz, target.number),
    participantId: participant._id,
  });
  return { ok: true };
}

export async function moveJuz(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: {
    participantId: Id<"rotaParticipants">;
    fromJuz: number;
    toJuz: number;
  },
): Promise<{ ok: true } | { error: "not_found" }> {
  if (!isJuz(args.fromJuz) || !isJuz(args.toJuz)) {
    return { error: "not_found" };
  }
  const target = await targetDay(ctx, khatma);
  const byJuz = await slotRowsByJuz(ctx, khatma._id, target.number);
  const from = byJuz.get(args.fromJuz);
  if (!from || from.participantId !== args.participantId) {
    return { error: "not_found" };
  }
  const to = byJuz.get(args.toJuz);
  if (to) {
    // Swap holders; the slots stay where they are.
    await ctx.db.patch(from._id, { participantId: to.participantId });
    await ctx.db.patch(to._id, { participantId: from.participantId });
  } else {
    await ctx.db.patch(from._id, {
      slot: slotFor(args.toJuz, target.number),
    });
  }
  return { ok: true };
}

export async function freeJuz(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { participantId: Id<"rotaParticipants">; juz: number },
): Promise<{ ok: true } | { error: "not_found" }> {
  if (!isJuz(args.juz)) return { error: "not_found" };
  const target = await targetDay(ctx, khatma);
  const row = (await slotRowsByJuz(ctx, khatma._id, target.number)).get(
    args.juz,
  );
  // The screen may be a day behind: only free the slot the organizer saw.
  if (!row || row.participantId !== args.participantId) {
    return { error: "not_found" };
  }
  await ctx.db.delete(row._id);
  return { ok: true };
}

export async function removeParticipant(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { participantId: Id<"rotaParticipants"> },
): Promise<{ ok: true } | { error: "not_found" | "is_me" }> {
  const participant = await activeParticipant(
    ctx,
    khatma._id,
    args.participantId,
  );
  if (!participant) return { error: "not_found" };
  // Not even an admin: a khatma keeps its organizer.
  if (participant.personId === khatma.creatorPersonId) {
    return { error: "is_me" };
  }
  const slots = await ctx.db
    .query("rotaSlots")
    .withIndex("by_participant", (q) => q.eq("participantId", participant._id))
    .collect();
  for (const slot of slots) await ctx.db.delete(slot._id);
  // Today's reads keep their reader: only the slots go.
  await ctx.db.patch(participant._id, { removedAt: Date.now() });
  return { ok: true };
}

/**
 * Sets someone's name in this khatma, and in the organizer's saved list unless
 * they removed that row. Their own account's name stays as it is.
 */
async function setParticipantName(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  participant: Doc<"rotaParticipants">,
  name: string,
): Promise<void> {
  await ctx.db.patch(participant._id, { name });
  const owner = khatma.creatorPersonId;
  const { personId, phone } = participant;
  const byPhone = await ctx.db
    .query("rotaContacts")
    .withIndex("by_owner_phone", (q) =>
      q.eq("ownerPersonId", owner).eq("phone", phone),
    )
    .first();
  const byPerson =
    personId == null
      ? null
      : await ctx.db
          .query("rotaContacts")
          .withIndex("by_owner_person", (q) =>
            q.eq("ownerPersonId", owner).eq("personId", personId),
          )
          .first();
  for (const contact of [byPhone, byPerson]) {
    if (contact && contact.removedAt === undefined) {
      await ctx.db.patch(contact._id, { name });
    }
  }
}

export async function renameParticipant(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { participantId: Id<"rotaParticipants">; name: string },
): Promise<{ ok: true } | { error: "not_found" | "bad_name" }> {
  const participant = await activeParticipant(
    ctx,
    khatma._id,
    args.participantId,
  );
  if (!participant) return { error: "not_found" };
  const name = cleanDisplayName(args.name);
  if (name === null) return { error: "bad_name" };
  await setParticipantName(ctx, khatma, participant, name);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Saved participants

/**
 * Remembers someone added to the khatma, so its organizer can add them to
 * another one in a tap. One row per phone (the name follows the latest
 * spelling) or, for someone imported from a pool khatma, per person; a person
 * whose number was typed before joins that row. The organizer's own row isn't
 * saved. `who.phone` is always their number; `hidden` keeps it out of the row.
 * A contact the organizer removed comes back when they are added again.
 */
export async function saveContact(
  ctx: MutationCtx,
  organizer: Pick<Doc<"people">, "_id" | "phone">,
  who: {
    name: string;
    phone: string;
    /** Imported from a pool khatma: the row has no number. */
    hidden: boolean;
    personId: Id<"people"> | null;
  },
): Promise<void> {
  if (who.phone === organizer.phone || who.personId === organizer._id) return;
  const { personId } = who;
  const same = await ctx.db
    .query("rotaContacts")
    .withIndex("by_owner_phone", (q) =>
      q.eq("ownerPersonId", organizer._id).eq("phone", who.phone),
    )
    .first();
  if (same) {
    await ctx.db.patch(same._id, {
      name: who.name,
      ...(personId !== null ? { personId } : {}),
    });
    return;
  }
  if (personId !== null) {
    const linked = await ctx.db
      .query("rotaContacts")
      .withIndex("by_owner_person", (q) =>
        q.eq("ownerPersonId", organizer._id).eq("personId", personId),
      )
      .first();
    // A number typed once stays as it is, and a hidden one stays hidden.
    if (linked) {
      if (linked.removedAt !== undefined) {
        await ctx.db.patch(linked._id, {
          name: who.name,
          removedAt: undefined,
        });
      }
      return;
    }
  }
  await ctx.db.insert("rotaContacts", {
    ownerPersonId: organizer._id,
    name: who.name,
    phone: who.hidden ? null : who.phone,
    personId,
    createdAt: Date.now(),
  });
}

export type SavedContact = {
  id: Id<"rotaContacts">;
  name: string;
  /** Null for someone imported from a pool khatma. */
  phone: string | null;
  /** They are an active participant of this khatma. */
  inKhatma: boolean;
};

/** Active participants of a khatma, by phone and by linked person. */
export async function activeIdentities(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<{ phones: Set<string>; personIds: Set<Id<"people">> }> {
  const rows = (
    await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
      .collect()
  ).filter((p) => p.removedAt === null);
  return {
    phones: new Set(rows.map((p) => p.phone)),
    personIds: new Set(
      rows.flatMap((p) => (p.personId === null ? [] : [p.personId])),
    ),
  };
}

/** The organizer's saved participants, by name, and which are in this khatma already. */
export async function saved(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
): Promise<SavedContact[]> {
  const { phones, personIds } = await activeIdentities(ctx, khatma._id);
  const contacts = await ctx.db
    .query("rotaContacts")
    .withIndex("by_owner", (q) => q.eq("ownerPersonId", khatma.creatorPersonId))
    .collect();
  return contacts
    .filter((c) => c.removedAt === undefined)
    .map((c) => ({
      id: c._id,
      name: c.name,
      phone: c.phone,
      inKhatma:
        (c.phone !== null && phones.has(c.phone)) ||
        (c.personId !== null && personIds.has(c.personId)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** Adds a saved contact to the khatma, as `addParticipant` does for a typed one. */
export async function addSaved(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { contactId: Id<"rotaContacts">; juz?: number; readsToday?: boolean },
): Promise<
  | { ok: true; participantId: Id<"rotaParticipants">; juz: number }
  | {
      error:
        | "not_found"
        | "no_free_juz"
        | "juz_taken"
        | "already_added"
        | "ask_today";
    }
> {
  const contact = await ctx.db.get(args.contactId);
  if (
    !contact ||
    contact.ownerPersonId !== khatma.creatorPersonId ||
    contact.removedAt !== undefined
  ) {
    return { error: "not_found" };
  }
  // A contact without a number is someone from a pool khatma: it stays hidden.
  const linked =
    contact.phone === null && contact.personId !== null
      ? await ctx.db.get(contact.personId)
      : null;
  const phone = contact.phone ?? linked?.phone ?? null;
  if (phone === null) return { error: "not_found" };

  const { phones, personIds } = await activeIdentities(ctx, khatma._id);
  if (
    phones.has(phone) ||
    (contact.personId !== null && personIds.has(contact.personId))
  ) {
    return { error: "already_added" };
  }
  const placed = await placeNewParticipant(
    ctx,
    khatma,
    {
      name: contact.name,
      phone,
      personId: contact.personId,
      phoneHidden: contact.phone === null,
    },
    args.juz,
    undefined,
    { readsToday: args.readsToday },
  );
  if ("error" in placed) return placed;
  return { ok: true, ...placed };
}

// ---------------------------------------------------------------------------
// Joining

/**
 * Whether this person's number stays hidden from the organizer: they came in
 * from a pool khatma (their saved contact has no number, even one the organizer
 * removed from their list: that row is kept for this), or are in a pool khatma
 * the organizer runs.
 */
async function numberHiddenFrom(
  ctx: QueryCtx,
  organizerId: Id<"people">,
  personId: Id<"people">,
): Promise<boolean> {
  if (personId === organizerId) return false;
  const contacts = await ctx.db
    .query("rotaContacts")
    .withIndex("by_owner_person", (q) =>
      q.eq("ownerPersonId", organizerId).eq("personId", personId),
    )
    .collect();
  if (contacts.some((c) => c.phone === null)) return true;
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_person", (q) => q.eq("personId", personId))
    .collect();
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    const khatma = await ctx.db.get(membership.khatmaId);
    if (khatma?.kind !== "rota" && khatma?.creatorPersonId === organizerId) {
      return true;
    }
  }
  return false;
}

/** The welcome for a member accepted from a join request: they were told the organizer would let them know. */
function welcomeRow(
  khatmaId: Id<"khatmas">,
  participantId: Id<"rotaParticipants">,
) {
  return {
    khatmaId,
    participantId,
    dayId: null,
    kind: "welcome" as const,
    juz: [],
    number: null,
  };
}

/**
 * Queues an accepted member's welcome. On a first join, when it will go at
 * once, it carries today's free juz'; a welcome that can't go leaves it free.
 */
async function welcomeAccepted(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  participant: {
    id: Id<"rotaParticipants">;
    phone: string;
    firstJoin: boolean;
  },
  now: number,
): Promise<void> {
  const queued = await enqueue(ctx, welcomeRow(khatma._id, participant.id));
  if (
    queued !== null &&
    participant.firstJoin &&
    (await welcomeGoesNow(ctx, rota, participant.phone, now))
  ) {
    await takeFreeJuzToday(ctx, rota, khatma._id, participant.id, now);
  }
}

/** An open join request of this khatma, or null. */
async function openRequest(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  requestId: Id<"rotaJoinRequests">,
): Promise<Doc<"rotaJoinRequests"> | null> {
  const request = await ctx.db.get(requestId);
  return request && request.khatmaId === khatmaId && request.resolvedAt === null
    ? request
    : null;
}

/**
 * Accepts a join request: the number becomes a participant on that juz' of the
 * next day to start, already joined (their join message was the opt-in), and
 * is welcomed. If the number was added meanwhile, the request is closed, that
 * person counts as joined and is welcomed. A number that sent «إيقاف» after
 * asking withdrew the request: it is declined, and `not_found`. Someone whose
 * number is hidden from the organizer stays hidden, in the khatma and the saved list.
 */
export async function acceptJoinRequest(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  rota: RotaConfig,
  args: {
    requestId: Id<"rotaJoinRequests">;
    juz: number;
    name?: string;
    readsToday?: boolean;
  },
): Promise<
  | { ok: true; participantId: Id<"rotaParticipants"> }
  | {
      error:
        "not_found" | "juz_taken" | "already_added" | "bad_name" | "ask_today";
    }
> {
  const request = await openRequest(ctx, khatma._id, args.requestId);
  if (!request) return { error: "not_found" };
  const chosenName =
    args.name === undefined ? undefined : cleanDisplayName(args.name);
  if (chosenName === null) return { error: "bad_name" };
  const now = Date.now();
  const stoppedSince = (
    await ctx.db
      .query("rotaParticipants")
      .withIndex("by_phone", (q) => q.eq("phone", request.phone))
      .collect()
  ).some((p) => p.stoppedAt != null && p.stoppedAt >= request.createdAt);
  if (stoppedSince) {
    await ctx.db.patch(request._id, {
      resolvedAt: now,
      outcome: "declined",
      // The phone's own «إيقاف» ended it, so it doesn't hold off a later join.
      declinedBy: "member",
    });
    return { error: "not_found" };
  }
  const existing = (
    await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma_phone", (q) =>
        q.eq("khatmaId", khatma._id).eq("phone", request.phone),
      )
      .collect()
  ).find((p) => p.removedAt === null);
  if (existing) {
    if (existing.joinedAt == null) {
      await ctx.db.patch(existing._id, { joinedAt: now });
    }
    if (chosenName !== undefined) {
      await setParticipantName(ctx, khatma, existing, chosenName);
    }
    await ctx.db.patch(request._id, { resolvedAt: now, outcome: "accepted" });
    await welcomeAccepted(
      ctx,
      khatma,
      rota,
      {
        id: existing._id,
        phone: existing.phone,
        firstJoin: existing.joinedAt == null,
      },
      now,
    );
    return { error: "already_added" };
  }

  const person = await ctx.db
    .query("people")
    .withIndex("by_phone", (q) => q.eq("phone", request.phone))
    .first();
  const personId = person?._id ?? null;
  const phoneHidden =
    personId !== null &&
    (await numberHiddenFrom(ctx, khatma.creatorPersonId, personId));
  const name =
    chosenName ??
    cleanDisplayName(request.profileName ?? "") ??
    NEW_MEMBER_NAME;
  const placed = await placeNewParticipant(
    ctx,
    khatma,
    { name, phone: request.phone, personId, phoneHidden },
    args.juz,
    now,
    { readsToday: args.readsToday },
  );
  if ("error" in placed) {
    // `juz` was given, so a juz' is always chosen.
    return { error: placed.error === "ask_today" ? "ask_today" : "juz_taken" };
  }
  const organizer = await ctx.db.get(khatma.creatorPersonId);
  if (organizer) {
    await saveContact(ctx, organizer, {
      name,
      phone: request.phone,
      hidden: phoneHidden,
      personId,
    });
  }
  await ctx.db.patch(request._id, { resolvedAt: now, outcome: "accepted" });
  await welcomeAccepted(
    ctx,
    khatma,
    rota,
    { id: placed.participantId, phone: request.phone, firstJoin: true },
    now,
  );
  return { ok: true, participantId: placed.participantId };
}

export async function declineJoinRequest(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { requestId: Id<"rotaJoinRequests"> },
): Promise<{ ok: true } | { error: "not_found" }> {
  const request = await openRequest(ctx, khatma._id, args.requestId);
  if (!request) return { error: "not_found" };
  await ctx.db.patch(request._id, {
    resolvedAt: Date.now(),
    outcome: "declined",
    declinedBy: "organizer",
  });
  return { ok: true };
}
