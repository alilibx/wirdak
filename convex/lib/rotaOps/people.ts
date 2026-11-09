import { ConvexError } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  enqueue,
  reachable,
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
import { endCoOrganizer, hasAccount, personByPhone } from "../../coOrganizers";
import { refreshPhone } from "../directory";
import { allows, roleIn, type OrganizerRole } from "../organizerAuth";
import { isArchived } from "../khatma";
import { isOwnerRow } from "../rotaOwner";
import { khatmaJoinLink } from "../rotaJoin";
import {
  heldSlotCount,
  leaveSlot,
  partnerRowsByJuz,
  sharingOpen,
  slotRowsByJuz,
  targetDay,
  type RotaConfig,
} from "../rotaPlace";
import { NEW_MEMBER_NAME } from "../rotaTemplates";
import { getSetting } from "../settings";
import {
  cleanDisplayName,
  localPhoneExample,
  maskPhone,
  normalizePhone,
  phoneCountry,
} from "../text";
import { localMinutes } from "../wakingTime";
import { khatmaTitle } from "../whatsappTemplates";

/** From 18:00, six hours before the day ends, the organizer says when someone they add starts. */
const LATE_ADD_FROM = 18 * 60;

/** Whoever is running the khatma. An admin helping out has no `personId`: nobody is "me" to them. */
export type Actor = { personId: Id<"people"> | null };

/**
 * Whose saved list (and home country) a call works with: the caller's own, so
 * a co-organizer saves to and picks from their own list and one person's
 * contacts never reach another (spec 4.3). An admin has none: the owner's.
 */
export function savedOwner(khatma: Doc<"khatmas">, actor: Actor): Id<"people"> {
  return actor.personId ?? khatma.creatorPersonId;
}

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

/** The ajza' with no reader, lowest first. */
function freeJuzOf(byJuz: Map<number, unknown>): number[] {
  return Array.from({ length: ROTA_SIZE }, (_, i) => i + 1).filter(
    (juz) => !byJuz.has(juz),
  );
}

function isJuz(juz: number): boolean {
  return Number.isInteger(juz) && juz >= 1 && juz <= ROTA_SIZE;
}

/**
 * What the organizer sees of one participant; the phone is the one they typed,
 * and null for someone imported from a pool khatma (the organizer never sees it),
 * or, to a co-organizer, for someone in a pool khatma that co-organizer runs.
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
  /** The owner named them a co-organizer: only the owner can take them out. */
  isCoOrganizer: boolean;
  /** They have signed in to Wirdak (an admin's placeholder has not): ownership can be handed to them. */
  hasAccount: boolean;
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
    /** The juz''s first reader. */
    participant: SlotReader | null;
    /** The second reader who shares the juz'. */
    partner: SlotReader | null;
  }[];
  participants: ({
    id: Id<"rotaParticipants">;
    name: string;
    isMe: boolean;
    juz: number[];
    /** How many of their ajza' count toward `maxSlots`, as `heldSlotCount` counts them. */
    heldSlots: number;
    /** Their ajza' that have two readers. */
    shared: number[];
  } & PersonState)[];
  freeJuz: number[];
  maxSlots: number;
  /** A local number from the organizer's country, for the phone field's hint. */
  phoneExample: string | null;
  /** The list opens with the box about juz' left without a reader (`rotaLeftoverBoxOn`). */
  leftoverBox: boolean;
  sharing: {
    /** Organizers may add a second reader to a juz' (`rotaSharedSlotsOn`). */
    on: boolean;
    /** A juz' may take a second reader now: it's on and every juz' has a reader. */
    open: boolean;
    /** How many people hold a juz', as its first or second reader. */
    readers: number;
    /** How many ajza' have a second reader. */
    shared: number;
  };
};

/** One reader of a juz', as the people view shows them. */
type SlotReader = {
  id: Id<"rotaParticipants">;
  name: string;
  isMe: boolean;
  /** How many of their ajza' count toward `maxSlots`, as `heldSlotCount` counts them. */
  slots: number;
} & PersonState;

/** A number typed without a country code is one from the organizer's country. */
function homeCountry(organizer: Doc<"people"> | null) {
  return organizer ? phoneCountry(organizer.phone) : undefined;
}

/** `isOwnerRow`, reading the owner. */
async function isOwnerParticipant(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  p: Doc<"rotaParticipants">,
): Promise<boolean> {
  return isOwnerRow(p, khatma, await ctx.db.get(khatma.creatorPersonId));
}

function personState(
  p: Doc<"rotaParticipants">,
  khatma: Doc<"khatmas">,
  owner: Doc<"people"> | null,
  coOrganizerPhones: ReadonlySet<string>,
  hiddenFromViewer: ReadonlySet<Id<"rotaParticipants">>,
  withAccount: ReadonlySet<Id<"rotaParticipants">>,
): PersonState {
  const isOrganizer = isOwnerRow(p, khatma, owner);
  return {
    isOrganizer,
    isCoOrganizer: !isOrganizer && coOrganizerPhones.has(p.phone),
    phone:
      p.phoneHidden === true || hiddenFromViewer.has(p._id) ? null : p.phone,
    joined: p.joinedAt != null,
    stopped: p.stoppedAt != null,
    silenced: p.silencedAt != null,
    hasAccount: withAccount.has(p._id),
  };
}

/** The participants who have signed in: by their account, or by the person on their number. */
async function participantsWithAccount(
  ctx: QueryCtx,
  participants: Doc<"rotaParticipants">[],
): Promise<Set<Id<"rotaParticipants">>> {
  const found = new Set<Id<"rotaParticipants">>();
  for (const p of participants) {
    const person = p.personId
      ? await ctx.db.get(p.personId)
      : await personByPhone(ctx, p.phone);
    if (person && hasAccount(person)) found.add(p._id);
  }
  return found;
}

/**
 * The participants whose number stays hidden from a co-organizer looking at
 * the khatma, beyond the ones hidden from everyone (`phoneHidden`): those in a
 * pool khatma the viewer runs, or who came to the viewer from one. The owner,
 * and an admin (no `personId`), see what the row says.
 */
async function hiddenFromViewer(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  participants: Doc<"rotaParticipants">[],
  actor: Actor,
): Promise<Set<Id<"rotaParticipants">>> {
  const hidden = new Set<Id<"rotaParticipants">>();
  const viewer = actor.personId;
  if (viewer === null || viewer === khatma.creatorPersonId) return hidden;
  for (const p of participants) {
    if (p.phoneHidden === true) continue;
    const personId =
      p.personId ??
      (
        await ctx.db
          .query("people")
          .withIndex("by_phone", (q) => q.eq("phone", p.phone))
          .first()
      )?._id ??
      null;
    if (personId !== null && (await numberHiddenFrom(ctx, viewer, personId))) {
      hidden.add(p._id);
    }
  }
  return hidden;
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
  const partners = await partnerRowsByJuz(ctx, khatma._id, target.number);
  const participants = (
    await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect()
  )
    .filter((p) => p.removedAt === null)
    .sort((a, b) => a.addedAt - b.addedAt || a._creationTime - b._creationTime);
  const heldBy = new Map<Id<"rotaParticipants">, number[]>();
  const sharedBy = new Map<Id<"rotaParticipants">, number[]>();
  // Counted toward the cap the way `heldSlotCount` counts them.
  const countsSecond = await getSetting(ctx, "rotaHalfCountsAsSlot");
  const counted = new Map<Id<"rotaParticipants">, number>();
  const push = (
    map: Map<Id<"rotaParticipants">, number[]>,
    id: Id<"rotaParticipants">,
    juz: number,
  ) => map.set(id, [...(map.get(id) ?? []), juz]);
  for (let juz = 1; juz <= ROTA_SIZE; juz++) {
    const first = byJuz.get(juz);
    const second = partners.get(juz);
    for (const row of [first, second]) {
      if (!row) continue;
      push(heldBy, row.participantId, juz);
      if (first && second) push(sharedBy, row.participantId, juz);
      if (row === first || countsSecond) {
        counted.set(
          row.participantId,
          (counted.get(row.participantId) ?? 0) + 1,
        );
      }
    }
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
  const organizer = await ctx.db.get(savedOwner(khatma, actor));
  const owner = await ctx.db.get(khatma.creatorPersonId);
  const coOrganizerPhones = new Set(
    (
      await ctx.db
        .query("coOrganizers")
        .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
        .collect()
    ).map((row) => row.phone),
  );
  const hidden = await hiddenFromViewer(ctx, khatma, participants, actor);
  const withAccount = await participantsWithAccount(ctx, participants);
  const reader = (row: Doc<"rotaSlots"> | undefined): SlotReader | null => {
    const p = row ? byId.get(row.participantId) : undefined;
    if (!p) return null;
    return {
      id: p._id,
      name: p.name,
      isMe: isActor(p, actor),
      slots: counted.get(p._id) ?? 0,
      ...personState(p, khatma, owner, coOrganizerPhones, hidden, withAccount),
    };
  };
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
    rows: Array.from({ length: ROTA_SIZE }, (_, i) => ({
      juz: i + 1,
      participant: reader(byJuz.get(i + 1)),
      partner: reader(partners.get(i + 1)),
    })),
    participants: participants.map((p) => ({
      id: p._id,
      name: p.name,
      isMe: isActor(p, actor),
      juz: heldBy.get(p._id) ?? [],
      heldSlots: counted.get(p._id) ?? 0,
      shared: sharedBy.get(p._id) ?? [],
      ...personState(p, khatma, owner, coOrganizerPhones, hidden, withAccount),
    })),
    freeJuz: freeJuzOf(byJuz),
    maxSlots: await getSetting(ctx, "rotaMaxSlotsPerPerson"),
    phoneExample: localPhoneExample(homeCountry(organizer)),
    leftoverBox: await getSetting(ctx, "rotaLeftoverBoxOn"),
    sharing: {
      on: await getSetting(ctx, "rotaSharedSlotsOn"),
      open: await sharingOpen(ctx, khatma._id, target.number),
      readers: heldBy.size,
      shared: partners.size,
    },
  };
}

/**
 * How a new participant is placed:
 * - `empty`: on a juz' with no reader.
 * - `share`: as the second reader of a juz' that has one, which needs
 *   `rotaSharedSlotsOn` and a reader on every juz'.
 * - `fill`: on the lowest juz' with no reader, or once every juz' has one and
 *   sharing is open, as the second reader of the lowest juz' that has none.
 */
export type PlaceMode = "empty" | "share" | "fill";

export type PlaceError =
  | "no_free_juz"
  | "juz_taken"
  | "ask_today"
  | "not_full"
  | "sharing_off"
  | "already_shared";

/** Why `juz` can't take a second reader now, or null when it can. */
async function shareRefusal(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  number: number,
  byJuz: Map<number, Doc<"rotaSlots">>,
  juz: number,
): Promise<"not_full" | "sharing_off" | "already_shared" | null> {
  if (!(await getSetting(ctx, "rotaSharedSlotsOn"))) return "sharing_off";
  if (byJuz.size < ROTA_SIZE) return "not_full";
  const partners = await partnerRowsByJuz(ctx, khatmaId, number);
  return partners.has(juz) ? "already_shared" : null;
}

/** The lowest juz' of khatma `number` with no second reader, when sharing is open. */
async function lowestUnshared(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  number: number,
): Promise<number | undefined> {
  if (!(await sharingOpen(ctx, khatmaId, number))) return undefined;
  const partners = await partnerRowsByJuz(ctx, khatmaId, number);
  return Array.from({ length: ROTA_SIZE }, (_, i) => i + 1).find(
    (j) => !partners.has(j),
  );
}

/** An add screen's placement: `share` asks for the second reader's place on the juz' chosen. */
function placeMode(args: { share?: boolean }): PlaceMode {
  return args.share === true ? "share" : "empty";
}

/**
 * Adds a new participant to the khatma on the juz' (or the lowest free one
 * when `juz` is undefined) of the next day to start, placed as `mode` says.
 * `joinedAt` is set only for someone who already sent their join message.
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
  mode: PlaceMode = "empty",
): Promise<
  { participantId: Id<"rotaParticipants">; juz: number } | { error: PlaceError }
> {
  const target = await targetDay(ctx, khatma);
  const byJuz = await slotRowsByJuz(ctx, khatma._id, target.number);
  let second = false;
  if (mode === "share") {
    if (juz === undefined || !isJuz(juz)) {
      throw new ConvexError({ code: "invalid_juz" });
    }
    const refused = await shareRefusal(
      ctx,
      khatma._id,
      target.number,
      byJuz,
      juz,
    );
    if (refused !== null) return { error: refused };
    second = true;
  } else if (juz === undefined) {
    juz = freeJuzOf(byJuz)[0];
    if (juz === undefined && mode === "fill") {
      juz = await lowestUnshared(ctx, khatma._id, target.number);
      second = juz !== undefined;
    }
    if (juz === undefined) return { error: "no_free_juz" };
  } else if (!isJuz(juz)) {
    throw new ConvexError({ code: "invalid_juz" });
  } else if (byJuz.has(juz)) {
    return { error: "juz_taken" };
  }

  const slot = slotFor(juz, target.number);
  // A second reader never takes today's juz', so they're never asked about it.
  const asks =
    !second &&
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
  await refreshPhone(ctx, who.phone);
  await ctx.db.insert("rotaSlots", {
    khatmaId: khatma._id,
    slot,
    participantId,
    ...(second ? { second: true } : {}),
  });
  return { participantId, juz };
}

/**
 * Whether someone added now, in the day's last six hours, could still take
 * today's juz', so the organizer should say if they do. Someone already joined
 * takes it only with a welcome that goes at once.
 */
export async function lateInTheDay(
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
  args: {
    name: string;
    phone: string;
    juz?: number;
    readsToday?: boolean;
    /** As the second reader of `juz`. */
    share?: boolean;
  },
  actor: Actor,
): Promise<
  | { ok: true; participantId: Id<"rotaParticipants">; juz: number }
  | { error: "bad_name" | "bad_phone" | "already_added" | PlaceError }
> {
  const name = cleanDisplayName(args.name);
  if (name === null) return { error: "bad_name" };
  const organizer = await ctx.db.get(savedOwner(khatma, actor));
  const phone = normalizePhone(args.phone, homeCountry(organizer));
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
    placeMode(args),
  );
  if ("error" in placed) return placed;
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
  if (
    (await heldSlotCount(ctx, participant._id)) >=
    (await getSetting(ctx, "rotaMaxSlotsPerPerson"))
  ) {
    return { error: "too_many" };
  }
  await ctx.db.insert("rotaSlots", {
    khatmaId: khatma._id,
    slot: slotFor(args.juz, target.number),
    participantId: participant._id,
  });
  return { ok: true };
}

/**
 * Gives every juz' with no reader to the people already in the khatma, lowest juz' first: each
 * goes to whoever holds the fewest (the earliest added on a tie), up to the per-person cap. Nobody
 * who holds none, stopped their messages, or was silenced gets one. `left` is how many stay
 * without a reader.
 */
export async function spreadFreeJuz(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
): Promise<
  | { ok: true; given: number; left: number }
  | { error: "no_free_juz" | "no_room" }
> {
  const target = await targetDay(ctx, khatma);
  const byJuz = await slotRowsByJuz(ctx, khatma._id, target.number);
  const free = freeJuzOf(byJuz);
  if (free.length === 0) return { error: "no_free_juz" };
  const max = await getSetting(ctx, "rotaMaxSlotsPerPerson");
  const active = (
    await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect()
  )
    .filter(
      (p) =>
        p.removedAt === null && p.stoppedAt == null && p.silencedAt == null,
    )
    .sort((a, b) => a.addedAt - b.addedAt || a._creationTime - b._creationTime);
  // Held counts the way `giveJuz` checks the cap.
  const counted = await Promise.all(
    active.map(async (p) => ({
      id: p._id,
      held: await heldSlotCount(ctx, p._id),
      holdsAny:
        (await ctx.db
          .query("rotaSlots")
          .withIndex("by_participant", (q) => q.eq("participantId", p._id))
          .first()) !== null,
    })),
  );
  // Someone holding none stopped reading on purpose (the organizer can), so they get none back.
  const readers = counted.filter((r) => r.holdsAny);

  let given = 0;
  for (const juz of free) {
    const reader = readers.reduce<(typeof readers)[number] | undefined>(
      (best, r) => (r.held < max && (!best || r.held < best.held) ? r : best),
      undefined,
    );
    if (!reader) break;
    await ctx.db.insert("rotaSlots", {
      khatmaId: khatma._id,
      slot: slotFor(juz, target.number),
      participantId: reader.id,
    });
    reader.held += 1;
    given += 1;
  }
  if (given === 0) return { error: "no_room" };
  return { ok: true, given, left: free.length - given };
}

/** Whether this participant runs the khatma: its owner, or someone named co-organizer. */
async function runsKhatma(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  participant: Doc<"rotaParticipants">,
): Promise<boolean> {
  if (await isOwnerParticipant(ctx, khatma, participant)) return true;
  const named = await ctx.db
    .query("coOrganizers")
    .withIndex("by_khatma_phone", (q) =>
      q.eq("khatmaId", khatma._id).eq("phone", participant.phone),
    )
    .first();
  return named !== null;
}

/**
 * Whether `caller` may take a slot from these participants: the owner and an
 * admin always; a co-organizer never from the owner or another co-organizer,
 * since only the owner changes what the people running the khatma hold (spec 4.2).
 */
async function mayTakeSlotsOf(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  participantIds: Id<"rotaParticipants">[],
  caller: OrganizerRole | "admin",
): Promise<boolean> {
  if (caller === "admin" || caller.owner) return true;
  for (const id of participantIds) {
    const participant = await ctx.db.get(id);
    if (participant && (await runsKhatma(ctx, khatma, participant))) {
      return false;
    }
  }
  return true;
}

/**
 * Moves a participant's juz' of the next day to another one, swapping with its
 * holder if it has one. A co-organizer can't move the owner's or another
 * co-organizer's juz', nor swap one into theirs (`is_organizer`). Either
 * reader of a shared slot may move to an empty juz', which leaves the other as
 * its only reader; a swap never takes a shared slot, from either side (`shared`).
 */
export async function moveJuz(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: {
    participantId: Id<"rotaParticipants">;
    fromJuz: number;
    toJuz: number;
  },
  caller: OrganizerRole | "admin",
): Promise<{ ok: true } | { error: "not_found" | "is_organizer" | "shared" }> {
  if (!isJuz(args.fromJuz) || !isJuz(args.toJuz)) {
    return { error: "not_found" };
  }
  const target = await targetDay(ctx, khatma);
  const byJuz = await slotRowsByJuz(ctx, khatma._id, target.number);
  const partners = await partnerRowsByJuz(ctx, khatma._id, target.number);
  const from = rowOf(byJuz, partners, args.fromJuz, args.participantId);
  if (!from) return { error: "not_found" };
  const to = byJuz.get(args.toJuz);
  const moved = to
    ? [from.participantId, to.participantId]
    : [from.participantId];
  if (!(await mayTakeSlotsOf(ctx, khatma, moved, caller))) {
    return { error: "is_organizer" };
  }
  if (to) {
    if (partners.has(args.fromJuz) || partners.has(args.toJuz)) {
      return { error: "shared" };
    }
    // Swap holders; the slots stay where they are.
    await ctx.db.patch(from._id, { participantId: to.participantId });
    await ctx.db.patch(to._id, { participantId: from.participantId });
  } else {
    await leaveSlot(ctx, from);
    await ctx.db.insert("rotaSlots", {
      khatmaId: khatma._id,
      slot: slotFor(args.toJuz, target.number),
      participantId: from.participantId,
    });
  }
  return { ok: true };
}

/** The participant's row on `juz`, as its first or its second reader. */
function rowOf(
  byJuz: Map<number, Doc<"rotaSlots">>,
  partners: Map<number, Doc<"rotaSlots">>,
  juz: number,
  participantId: Id<"rotaParticipants">,
): Doc<"rotaSlots"> | undefined {
  return [byJuz.get(juz), partners.get(juz)].find(
    (row) => row?.participantId === participantId,
  );
}

/**
 * Frees a participant's juz' of the next day. Freeing one reader of a shared
 * slot leaves the other as its only reader. A co-organizer can't free the
 * owner's or a co-organizer's (`is_organizer`).
 */
export async function freeJuz(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { participantId: Id<"rotaParticipants">; juz: number },
  caller: OrganizerRole | "admin",
): Promise<{ ok: true } | { error: "not_found" | "is_organizer" }> {
  if (!isJuz(args.juz)) return { error: "not_found" };
  const target = await targetDay(ctx, khatma);
  const row = rowOf(
    await slotRowsByJuz(ctx, khatma._id, target.number),
    await partnerRowsByJuz(ctx, khatma._id, target.number),
    args.juz,
    args.participantId,
  );
  // The screen may be a day behind: only free the slot the organizer saw.
  if (!row) return { error: "not_found" };
  if (!(await mayTakeSlotsOf(ctx, khatma, [row.participantId], caller))) {
    return { error: "is_organizer" };
  }
  await leaveSlot(ctx, row);
  return { ok: true };
}

/**
 * Takes someone out of the khatma: their slots go, and so does a co-organizer
 * role (coming back doesn't restore it). A `caller` who isn't the owner (a
 * co-organizer) gets `is_organizer` for the owner and for every co-organizer:
 * only the owner changes who else runs the khatma. An admin passes `"admin"`.
 */
export async function removeParticipant(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: { participantId: Id<"rotaParticipants"> },
  caller: OrganizerRole | "admin",
): Promise<{ ok: true } | { error: "not_found" | "is_me" | "is_organizer" }> {
  const participant = await activeParticipant(
    ctx,
    khatma._id,
    args.participantId,
  );
  if (!participant) return { error: "not_found" };
  const byOwner = caller === "admin" || caller.owner;
  // Not even an admin: a khatma keeps its organizer.
  if (await isOwnerParticipant(ctx, khatma, participant)) {
    return { error: byOwner ? "is_me" : "is_organizer" };
  }
  if (!byOwner && (await runsKhatma(ctx, khatma, participant))) {
    return { error: "is_organizer" };
  }
  const slots = await ctx.db
    .query("rotaSlots")
    .withIndex("by_participant", (q) => q.eq("participantId", participant._id))
    .collect();
  // A shared slot they leave keeps its other reader.
  for (const slot of slots) await leaveSlot(ctx, slot);
  // Today's reads keep their readers: only the slots go.
  await ctx.db.patch(participant._id, { removedAt: Date.now() });
  await endCoOrganizer(ctx, khatma._id, participant.phone);
  await refreshPhone(ctx, participant.phone);
  return { ok: true };
}

/**
 * Sets someone's name in this khatma, and in the caller's own saved list
 * (`savedOwner`) unless they removed that row. Their own account's name stays
 * as it is.
 */
async function setParticipantName(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  participant: Doc<"rotaParticipants">,
  name: string,
  actor: Actor,
): Promise<void> {
  await ctx.db.patch(participant._id, { name });
  await refreshPhone(ctx, participant.phone);
  const owner = savedOwner(khatma, actor);
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
  actor: Actor,
): Promise<{ ok: true } | { error: "not_found" | "bad_name" }> {
  const participant = await activeParticipant(
    ctx,
    khatma._id,
    args.participantId,
  );
  if (!participant) return { error: "not_found" };
  const name = cleanDisplayName(args.name);
  if (name === null) return { error: "bad_name" };
  await setParticipantName(ctx, khatma, participant, name, actor);
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
  /** They read now in another of the list owner's live khatmas. */
  active: boolean;
};

/**
 * Who reads now in the live rota khatmas `owner` runs, other than `except`, by
 * phone and by linked person: set up, on the list, joined, not stopped or
 * silenced, and holding a juz'. Someone who holds nothing was taken off on
 * purpose (`spreadFreeJuz` gives them nothing either).
 */
async function readingNow(
  ctx: QueryCtx,
  owner: Id<"people">,
  except: Id<"khatmas">,
): Promise<{ phones: Set<string>; personIds: Set<Id<"people">> }> {
  const phones = new Set<string>();
  const personIds = new Set<Id<"people">>();
  const khatmas = (
    await ctx.db
      .query("khatmas")
      .withIndex("by_creator", (q) => q.eq("creatorPersonId", owner))
      .collect()
  ).filter(
    (k) =>
      k._id !== except &&
      k.kind === "rota" &&
      !isArchived(k) &&
      k.rota?.setupDoneAt != null,
  );
  await Promise.all(
    khatmas.map(async (k) => {
      const [rows, slots] = await Promise.all([
        ctx.db
          .query("rotaParticipants")
          .withIndex("by_khatma", (q) => q.eq("khatmaId", k._id))
          .collect(),
        ctx.db
          .query("rotaSlots")
          .withIndex("by_khatma_slot", (q) => q.eq("khatmaId", k._id))
          .collect(),
      ]);
      const holding = new Set(slots.map((slot) => slot.participantId));
      for (const row of rows) {
        if (!reachable(row) || !holding.has(row._id)) continue;
        phones.add(row.phone);
        if (row.personId !== null) personIds.add(row.personId);
      }
    }),
  );
  return { phones, personIds };
}

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

/** The caller's saved participants, by name, and which are in this khatma already. */
export async function saved(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  actor: Actor,
): Promise<SavedContact[]> {
  const { phones, personIds } = await activeIdentities(ctx, khatma._id);
  const owner = savedOwner(khatma, actor);
  const contacts = await ctx.db
    .query("rotaContacts")
    .withIndex("by_owner", (q) => q.eq("ownerPersonId", owner))
    .collect();
  const reading = await readingNow(ctx, owner, khatma._id);
  return contacts
    .filter((c) => c.removedAt === undefined)
    .map((c) => ({
      id: c._id,
      name: c.name,
      phone: c.phone,
      inKhatma:
        (c.phone !== null && phones.has(c.phone)) ||
        (c.personId !== null && personIds.has(c.personId)),
      active:
        (c.phone !== null && reading.phones.has(c.phone)) ||
        (c.personId !== null && reading.personIds.has(c.personId)),
    }))
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.name.localeCompare(b.name, "ar"),
    );
}

/**
 * A saved contact of `owner`, ready to place: its name, number (a hidden one
 * through the linked person) and link. `not_found` for a contact that isn't
 * theirs, was removed, or has no number to reach; `already_added` when that
 * number or person is in `identities` (the khatma's active participants).
 */
export async function resolveContact(
  ctx: QueryCtx,
  contactId: Id<"rotaContacts">,
  owner: Id<"people">,
  identities: { phones: Set<string>; personIds: Set<Id<"people">> },
): Promise<
  | {
      name: string;
      phone: string;
      personId: Id<"people"> | null;
      phoneHidden: boolean;
    }
  | { error: "not_found" | "already_added" }
> {
  const contact = await ctx.db.get(contactId);
  if (
    !contact ||
    contact.ownerPersonId !== owner ||
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
  if (
    identities.phones.has(phone) ||
    (contact.personId !== null && identities.personIds.has(contact.personId))
  ) {
    return { error: "already_added" };
  }
  return {
    name: contact.name,
    phone,
    personId: contact.personId,
    phoneHidden: contact.phone === null,
  };
}

/** Adds a saved contact to the khatma, as `addParticipant` does for a typed one. */
export async function addSaved(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  _rota: RotaConfig,
  args: {
    contactId: Id<"rotaContacts">;
    juz?: number;
    readsToday?: boolean;
    /** As the second reader of `juz`. */
    share?: boolean;
  },
  actor: Actor,
): Promise<
  | { ok: true; participantId: Id<"rotaParticipants">; juz: number }
  | { error: "not_found" | "already_added" | PlaceError }
> {
  const who = await resolveContact(
    ctx,
    args.contactId,
    savedOwner(khatma, actor),
    await activeIdentities(ctx, khatma._id),
  );
  if ("error" in who) return who;
  const placed = await placeNewParticipant(
    ctx,
    khatma,
    who,
    args.juz,
    undefined,
    { readsToday: args.readsToday },
    placeMode(args),
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
 * the organizer runs, as its owner or as a co-organizer with People.
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
  const organizer = await ctx.db.get(organizerId);
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    const khatma = await ctx.db.get(membership.khatmaId);
    if (!khatma || khatma.kind === "rota") continue;
    if (khatma.creatorPersonId === organizerId) return true;
    if (allows(await roleIn(ctx, khatma, organizer), "people")) return true;
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
    /** As the second reader of `juz`. */
    share?: boolean;
  },
  actor: Actor,
): Promise<
  | { ok: true; participantId: Id<"rotaParticipants"> }
  | {
      error:
        | "not_found"
        | "already_added"
        | "bad_name"
        | Exclude<PlaceError, "no_free_juz">;
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
      await setParticipantName(ctx, khatma, existing, chosenName, actor);
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
  // Everyone with People sees the row's number, so it stays hidden when it is
  // hidden from the owner or from whoever accepts.
  const accepter = savedOwner(khatma, actor);
  const phoneHidden =
    personId !== null &&
    ((await numberHiddenFrom(ctx, khatma.creatorPersonId, personId)) ||
      (accepter !== khatma.creatorPersonId &&
        (await numberHiddenFrom(ctx, accepter, personId))));
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
    placeMode(args),
  );
  if ("error" in placed) {
    // `juz` was given, so a juz' is always chosen.
    return {
      error: placed.error === "no_free_juz" ? "juz_taken" : placed.error,
    };
  }
  const organizer = await ctx.db.get(accepter);
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
