import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { membersByJoin, organizerOf, requireOrganizer } from "./organizer";
import { cheerConfigValidator } from "./lib/cheer";
import { randomToken } from "./lib/crypto";
import { nameFields, refreshPerson, refreshPhone } from "./lib/directory";
import { DEFAULT_GRACE } from "./lib/grace";
import { isArchived } from "./lib/khatma";
import { checkRateLimit } from "./lib/rateLimit";
import { randomJoinCode } from "./lib/rotaJoin";
import {
  isDate,
  isReadingDate,
  isValidReadingDays,
  readingDaysValidator,
  rotaMessagesValidator,
  type ReadingDays,
  type RotaMessages,
} from "./lib/rota";
import * as ops from "./lib/rotaOps";
import { earliestFirstDate, type RotaConfig } from "./lib/rotaPlace";
import type { SessionContext } from "./lib/session";
import { requirePerson, sessionMutation, sessionQuery } from "./lib/session";
import { getSetting } from "./lib/settings";
import { cleanKhatmaName } from "./lib/text";
import { khatmaTitle } from "./lib/whatsappTemplates";
import { localDate } from "./lib/wakingTime";

const DAY_MS = 86_400_000;
/** Attempts at drawing an unused invite code; a collision is ~1e-20 likely. */
const INVITE_CODE_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Create

/**
 * How many rota khatmas the person organizes that are not archived, counting
 * the ones an admin set up that wait for them: those have no membership yet,
 * only the person's row among the participants.
 */
async function activeRotaCount(
  ctx: QueryCtx,
  person: Doc<"people">,
): Promise<number> {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_person", (q) => q.eq("personId", person._id))
    .collect();
  const participants = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_phone", (q) => q.eq("phone", person.phone))
    .collect();
  const organizes = (khatma: Doc<"khatmas"> | null) =>
    khatma?.kind === "rota" &&
    khatma.creatorPersonId === person._id &&
    !isArchived(khatma);

  let count = 0;
  for (const member of memberships) {
    if (organizes(await ctx.db.get(member.khatmaId))) count += 1;
  }
  for (const participant of participants) {
    if (participant.removedAt !== null) continue;
    const khatma = await ctx.db.get(participant.khatmaId);
    if (organizes(khatma) && khatma?.rota?.pendingOrganizer === true) {
      count += 1;
    }
  }
  return count;
}

async function defaultMessages(ctx: QueryCtx): Promise<RotaMessages> {
  return {
    dayAt: await getSetting(ctx, "rotaDayAt"),
    reminder: {
      at: await getSetting(ctx, "rotaReminderAt"),
      on: await getSetting(ctx, "rotaReminderOn"),
    },
    unread: {
      at: await getSetting(ctx, "rotaUnreadAt"),
      on: await getSetting(ctx, "rotaUnreadOn"),
    },
    summary: {
      at: await getSetting(ctx, "rotaSummaryAt"),
      on: await getSetting(ctx, "rotaSummaryOn"),
    },
  };
}

/**
 * The row of a new rota khatma, created by `person`. `null` on an invite or
 * join code collision. `countsAgainstLimit` is whether it counts against their
 * daily allowance of new khatmas, which refuses with `rate_limited`.
 */
async function insertRotaRow(
  ctx: MutationCtx,
  person: Doc<"people">,
  spec: {
    name: Doc<"khatmas">["name"];
    inviteCode: string;
    joinCode: string;
    rota: NonNullable<Doc<"khatmas">["rota"]>;
  },
  countsAgainstLimit: boolean,
  now: number,
): Promise<Id<"khatmas"> | null> {
  const taken = await ctx.db
    .query("khatmas")
    .withIndex("by_inviteCode", (q) => q.eq("inviteCode", spec.inviteCode))
    .first();
  if (taken) return null;
  const joinTaken = await ctx.db
    .query("khatmas")
    .withIndex("by_joinCode", (q) => q.eq("joinCode", spec.joinCode))
    .first();
  if (joinTaken) return null;

  if (countsAgainstLimit) {
    const allowed = await checkRateLimit(
      ctx,
      `khatmaCreate:${person._id}`,
      await getSetting(ctx, "createsPerPersonPerDay"),
      DAY_MS,
    );
    if (!allowed) throw new ConvexError({ code: "rate_limited" });
  }

  return ctx.db.insert("khatmas", {
    ...nameFields(spec.name),
    schedule: "none",
    grace: DEFAULT_GRACE.none,
    creatorPersonId: person._id,
    inviteCode: spec.inviteCode,
    joinCode: spec.joinCode,
    completedRounds: 0,
    createdAt: now,
    kind: "rota",
    rota: spec.rota,
  });
}

/** The organizer's membership of a khatma they create. */
async function insertOrganizerMembership(
  ctx: MutationCtx,
  khatmaId: Id<"khatmas">,
  personId: Id<"people">,
  shareToken: string,
  now: number,
): Promise<void> {
  await ctx.db.insert("members", {
    khatmaId,
    personId,
    joinedAt: now,
    shareToken,
    status: "active",
    notificationsOn: true,
    lastNudgeAt: null,
    lastCelebratedRound: 0,
  });
  await refreshPerson(ctx, personId);
}

/**
 * Inserts a rota khatma with `person` as its organizer and as participant 1 on
 * slot 1, within the cap and with valid dates. `null` on a code collision. No
 * membership: with `pendingOrganizer`, it comes with the person's join message.
 */
export async function insertRotaKhatma(
  ctx: MutationCtx,
  person: Doc<"people">,
  args: {
    name: string;
    days: ReadingDays;
    firstDate: string;
    endDate: string | null;
    inviteCode: string;
    joinCode: string;
  },
  pendingOrganizer: boolean,
): Promise<Id<"khatmas"> | null> {
  if (
    (await activeRotaCount(ctx, person)) >=
    (await getSetting(ctx, "rotaMaxActivePerOrganizer"))
  ) {
    throw new ConvexError({ code: "rota_cap" });
  }
  if (!isValidReadingDays(args.days)) {
    throw new ConvexError({ code: "invalid_days" });
  }
  const today = localDate(Date.now(), person.timeZone);
  if (
    !isDate(args.firstDate) ||
    args.firstDate < (await earliestFirstDate(ctx, today)) ||
    (args.endDate !== null &&
      (!isDate(args.endDate) || args.endDate < args.firstDate)) ||
    !isReadingDate(args.days, args.firstDate, args.firstDate)
  ) {
    throw new ConvexError({ code: "invalid_dates" });
  }

  const now = Date.now();
  // An admin setting one up is not the organizer creating: it leaves their daily allowance alone.
  const khatmaId = await insertRotaRow(
    ctx,
    person,
    {
      name: args.name,
      inviteCode: args.inviteCode,
      joinCode: args.joinCode,
      rota: {
        days: args.days,
        firstDate: args.firstDate,
        endDate: args.endDate,
        timeZone: person.timeZone,
        messages: await defaultMessages(ctx),
        pausedAt: null,
        pauseDates: [],
        archivedAt: null,
        // No day starts until the organizer finishes adding people (`finishSetup`).
        setupDoneAt: null,
        ...(pendingOrganizer ? { pendingOrganizer: true } : {}),
      },
    },
    !pendingOrganizer,
    now,
  );
  if (khatmaId === null) return null;
  const participantId = await ctx.db.insert("rotaParticipants", {
    khatmaId,
    name: person.displayName,
    phone: person.phone,
    personId: person._id,
    addedAt: now,
    removedAt: null,
  });
  await ctx.db.insert("rotaSlots", { khatmaId, slot: 1, participantId });
  await refreshPhone(ctx, person.phone);
  return khatmaId;
}

/** Inserts a rota khatma for the person creating it, with their membership. */
export const insertRota = internalMutation({
  args: {
    personId: v.id("people"),
    name: v.string(),
    days: readingDaysValidator,
    firstDate: v.string(),
    endDate: v.union(v.string(), v.null()),
    inviteCode: v.string(),
    joinCode: v.string(),
    shareToken: v.string(),
  },
  handler: async (ctx, args): Promise<{ inviteCode: string } | null> => {
    if (await getSetting(ctx, "maintenanceMode")) {
      throw new ConvexError({ code: "maintenance" });
    }
    const person = await ctx.db.get(args.personId);
    if (!person) throw new ConvexError({ code: "not_signed_in" });
    if (person.rotaAllowed !== true) {
      throw new ConvexError({ code: "rota_not_allowed" });
    }
    const khatmaId = await insertRotaKhatma(ctx, person, args, false);
    if (khatmaId === null) return null;
    await insertOrganizerMembership(
      ctx,
      khatmaId,
      person._id,
      args.shareToken,
      Date.now(),
    );
    return { inviteCode: args.inviteCode };
  },
});

export const create = action({
  args: {
    sessionToken: v.optional(v.string()),
    name: v.string(),
    days: readingDaysValidator,
    firstDate: v.string(),
    endDate: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<{ inviteCode: string }> => {
    const personId = await ctx.runQuery(internal.khatmas.personIdForToken, {
      sessionToken: args.sessionToken,
    });
    if (!personId) throw new ConvexError({ code: "not_signed_in" });
    const name = cleanKhatmaName(args.name);
    if (name === null) throw new ConvexError({ code: "invalid_name" });
    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
      const created = await ctx.runMutation(internal.rota.insertRota, {
        personId,
        name,
        days: args.days,
        firstDate: args.firstDate,
        endDate: args.endDate,
        inviteCode: randomToken(9),
        joinCode: randomJoinCode(),
        shareToken: randomToken(8),
      });
      if (created) return created;
    }
    throw new Error("could not allocate an invite or join code");
  },
});

/**
 * Inserts a new rota khatma from an archived one: the same name, days, messages,
 * time zone and active participants on the same slots, and a membership for the
 * organizer. Nobody has joined it: everyone sends their own join message again.
 * `null` on invite or join code collision.
 */
export const insertAgain = internalMutation({
  args: {
    personId: v.id("people"),
    sourceInviteCode: v.string(),
    firstDate: v.string(),
    inviteCode: v.string(),
    joinCode: v.string(),
    shareToken: v.string(),
  },
  handler: async (ctx, args): Promise<{ inviteCode: string } | null> => {
    if (await getSetting(ctx, "maintenanceMode")) {
      throw new ConvexError({ code: "maintenance" });
    }
    const person = await ctx.db.get(args.personId);
    if (!person) throw new ConvexError({ code: "not_signed_in" });
    // The organizer runs one already, so `rotaAllowed` isn't asked again.
    const found = await organizerOf(ctx, args.sourceInviteCode, person);
    const rota = found?.khatma.rota;
    if (!found || found.khatma.kind !== "rota" || !rota) {
      throw new ConvexError({ code: "forbidden" });
    }
    const source = found.khatma;
    if (!isArchived(source)) throw new ConvexError({ code: "not_archived" });
    if (
      (await activeRotaCount(ctx, person)) >=
      (await getSetting(ctx, "rotaMaxActivePerOrganizer"))
    ) {
      throw new ConvexError({ code: "rota_cap" });
    }
    const today = localDate(Date.now(), rota.timeZone);
    if (
      !isDate(args.firstDate) ||
      args.firstDate < (await earliestFirstDate(ctx, today)) ||
      !isReadingDate(rota.days, args.firstDate, args.firstDate)
    ) {
      throw new ConvexError({ code: "invalid_dates" });
    }

    const now = Date.now();
    const khatmaId = await insertRotaRow(
      ctx,
      person,
      {
        name: source.name,
        inviteCode: args.inviteCode,
        joinCode: args.joinCode,
        rota: {
          days: rota.days,
          firstDate: args.firstDate,
          endDate: null,
          timeZone: rota.timeZone,
          messages: rota.messages,
          ...(rota.lateTapMs !== undefined
            ? { lateTapMs: rota.lateTapMs }
            : {}),
          pausedAt: null,
          pauseDates: [],
          archivedAt: null,
          setupDoneAt: null,
        },
      },
      true,
      now,
    );
    if (khatmaId === null) return null;
    await insertOrganizerMembership(
      ctx,
      khatmaId,
      person._id,
      args.shareToken,
      now,
    );

    const participants = (
      await ctx.db
        .query("rotaParticipants")
        .withIndex("by_khatma", (q) => q.eq("khatmaId", source._id))
        .collect()
    )
      .filter((p) => p.removedAt === null)
      .sort(
        (a, b) => a.addedAt - b.addedAt || a._creationTime - b._creationTime,
      );
    for (const old of participants) {
      const participantId = await ctx.db.insert("rotaParticipants", {
        khatmaId,
        name: old.name,
        phone: old.phone,
        personId: old.personId,
        addedAt: now,
        removedAt: null,
        ...(old.phoneHidden === true ? { phoneHidden: true } : {}),
      });
      await refreshPhone(ctx, old.phone);
      const slots = await ctx.db
        .query("rotaSlots")
        .withIndex("by_participant", (q) => q.eq("participantId", old._id))
        .collect();
      for (const slot of slots) {
        await ctx.db.insert("rotaSlots", {
          khatmaId,
          slot: slot.slot,
          participantId,
        });
      }
    }
    return { inviteCode: args.inviteCode };
  },
});

/**
 * Starts a rota khatma again from an archived one of the same organizer: its
 * settings and people on the same slots, first read on `firstDate`.
 */
export const startAgain = action({
  args: {
    sessionToken: v.optional(v.string()),
    inviteCode: v.string(),
    firstDate: v.string(),
  },
  handler: async (ctx, args): Promise<{ inviteCode: string }> => {
    const personId = await ctx.runQuery(internal.khatmas.personIdForToken, {
      sessionToken: args.sessionToken,
    });
    if (!personId) throw new ConvexError({ code: "not_signed_in" });
    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
      const created = await ctx.runMutation(internal.rota.insertAgain, {
        personId,
        sourceInviteCode: args.inviteCode,
        firstDate: args.firstDate,
        inviteCode: randomToken(9),
        joinCode: randomJoinCode(),
        shareToken: randomToken(8),
      });
      if (created) return created;
    }
    throw new Error("could not allocate an invite or join code");
  },
});

/**
 * The rota khatma's join code, drawing and storing one when it has none (a
 * khatma created before join codes). For mutations: `by_joinCode` is checked
 * inside the transaction, so a drawn code is never taken. A join code is not a
 * secret: it is shared in the group and only admits a phone the organizer
 * listed, or files a request they approve. Uniqueness comes from that
 * in-transaction check; real secrets must still be drawn in actions (see the
 * header of `lib/crypto.ts`).
 */
export async function ensureJoinCode(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
): Promise<string> {
  if (khatma.joinCode !== undefined) return khatma.joinCode;
  for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS * 3; attempt++) {
    const joinCode = randomJoinCode();
    const taken = await ctx.db
      .query("khatmas")
      .withIndex("by_joinCode", (q) => q.eq("joinCode", joinCode))
      .first();
    if (taken) continue;
    await ctx.db.patch(khatma._id, { joinCode });
    return joinCode;
  }
  throw new Error("could not allocate a join code");
}

// ---------------------------------------------------------------------------
// The organizer's operations: who may call is decided here, and the work is in
// `lib/rotaOps`.

/**
 * The organizer, their rota khatma and its settings, for every change the
 * organizer makes: `forbidden` for anyone else (and for a pool khatma), and
 * `archived` once the khatma is archived, which leaves it read-only.
 */
async function requireRotaOrganizer(
  ctx: MutationCtx & SessionContext,
  inviteCode: string,
): Promise<{
  person: Doc<"people">;
  khatma: Doc<"khatmas">;
  rota: RotaConfig;
}> {
  const { person, khatma } = await requireOrganizer(ctx, inviteCode);
  const rota = khatma.rota;
  if (khatma.kind !== "rota" || !rota) {
    throw new ConvexError({ code: "forbidden" });
  }
  if (isArchived(khatma)) throw new ConvexError({ code: "archived" });
  return { person, khatma, rota };
}

/** The organizer's rota khatma, to read: null for anyone else, and for a pool khatma. */
async function organizerRota(
  ctx: QueryCtx & SessionContext,
  inviteCode: string,
): Promise<{
  person: Doc<"people">;
  khatma: Doc<"khatmas">;
  rota: RotaConfig;
} | null> {
  const found = await organizerOf(ctx, inviteCode, ctx.person);
  const rota = found?.khatma.rota;
  if (!found || found.khatma.kind !== "rota" || !rota) return null;
  return { ...found, rota };
}

// ---------------------------------------------------------------------------
// People

export const finishSetup = sessionMutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): ReturnType<typeof ops.finishSetup> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.finishSetup(ctx, khatma, rota);
  },
});

/** Organizer only. */
export const people = sessionQuery({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<ops.PeopleView | null> => {
    const found = await organizerRota(ctx, args.inviteCode);
    if (!found) return null;
    const { person, khatma, rota } = found;
    return ops.people(ctx, khatma, rota, { personId: person._id });
  },
});

export const addParticipant = sessionMutation({
  args: {
    inviteCode: v.string(),
    name: v.string(),
    phone: v.string(),
    juz: v.optional(v.number()),
    readsToday: v.optional(v.boolean()),
  },
  handler: async (ctx, args): ReturnType<typeof ops.addParticipant> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.addParticipant(ctx, khatma, rota, args);
  },
});

export const giveJuz = sessionMutation({
  args: {
    inviteCode: v.string(),
    participantId: v.id("rotaParticipants"),
    juz: v.number(),
  },
  handler: async (ctx, args): ReturnType<typeof ops.giveJuz> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.giveJuz(ctx, khatma, rota, args);
  },
});

export const moveJuz = sessionMutation({
  args: {
    inviteCode: v.string(),
    participantId: v.id("rotaParticipants"),
    fromJuz: v.number(),
    toJuz: v.number(),
  },
  handler: async (ctx, args): ReturnType<typeof ops.moveJuz> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.moveJuz(ctx, khatma, rota, args);
  },
});

export const freeJuz = sessionMutation({
  args: {
    inviteCode: v.string(),
    participantId: v.id("rotaParticipants"),
    juz: v.number(),
  },
  handler: async (ctx, args): ReturnType<typeof ops.freeJuz> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.freeJuz(ctx, khatma, rota, args);
  },
});

export const renameParticipant = sessionMutation({
  args: {
    inviteCode: v.string(),
    participantId: v.id("rotaParticipants"),
    name: v.string(),
  },
  handler: async (ctx, args): ReturnType<typeof ops.renameParticipant> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.renameParticipant(ctx, khatma, rota, args);
  },
});

export const removeParticipant = sessionMutation({
  args: {
    inviteCode: v.string(),
    participantId: v.id("rotaParticipants"),
  },
  handler: async (ctx, args): ReturnType<typeof ops.removeParticipant> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.removeParticipant(ctx, khatma, rota, args);
  },
});

// ---------------------------------------------------------------------------
// Saved participants

/** Organizer only. */
export const saved = sessionQuery({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<ops.SavedContact[] | null> => {
    const found = await organizerRota(ctx, args.inviteCode);
    return found && ops.saved(ctx, found.khatma);
  },
});

export const addSaved = sessionMutation({
  args: {
    inviteCode: v.string(),
    contactId: v.id("rotaContacts"),
    juz: v.optional(v.number()),
    readsToday: v.optional(v.boolean()),
  },
  handler: async (ctx, args): ReturnType<typeof ops.addSaved> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.addSaved(ctx, khatma, rota, args);
  },
});

export const removeSaved = sessionMutation({
  args: { contactId: v.id("rotaContacts") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "not_found" }> => {
    const person = requirePerson(ctx);
    const contact = await ctx.db.get(args.contactId);
    if (!contact || contact.ownerPersonId !== person._id) {
      return { error: "not_found" };
    }
    if (contact.removedAt !== undefined) return { error: "not_found" };
    if (contact.phone === null) {
      // The row also records that their number stays hidden from this organizer.
      await ctx.db.patch(contact._id, { removedAt: Date.now() });
    } else {
      await ctx.db.delete(contact._id);
    }
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Pool import

/**
 * The pool khatmas the organizer runs that are live and have members besides
 * them that this khatma doesn't have yet: one whose members are all in is left out.
 */
export const importable = sessionQuery({
  args: { inviteCode: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ inviteCode: string; title: string; memberCount: number }[]> => {
    const found = await organizerOf(ctx, args.inviteCode, ctx.person);
    if (!found || found.khatma.kind !== "rota") return [];
    const { person } = found;
    const { phones, personIds } = await ops.activeIdentities(
      ctx,
      found.khatma._id,
    );
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_person", (q) => q.eq("personId", person._id))
      .collect();
    const list: { inviteCode: string; title: string; memberCount: number }[] =
      [];
    for (const membership of memberships) {
      if (membership.status !== "active") continue;
      const khatma = await ctx.db.get(membership.khatmaId);
      if (
        !khatma ||
        khatma.kind === "rota" ||
        khatma.creatorPersonId !== person._id ||
        isArchived(khatma)
      ) {
        continue;
      }
      const others = (await membersByJoin(ctx, khatma._id)).filter(
        (m) => m.status === "active" && m.personId !== person._id,
      );
      let addable = 0;
      for (const member of others) {
        const them = await ctx.db.get(member.personId);
        if (them && !personIds.has(them._id) && !phones.has(them.phone)) {
          addable += 1;
        }
      }
      if (addable === 0) continue;
      list.push({
        inviteCode: khatma.inviteCode,
        title: khatmaTitle(khatma),
        memberCount: addable,
      });
    }
    return list.sort((a, b) => a.title.localeCompare(b.title, "ar"));
  },
});

/**
 * Adds the active members of one of the organizer's pool khatmas to the free
 * ajza' in the order they joined it. The organizer never sees their numbers:
 * the participants are marked `phoneHidden`, and each has to join on WhatsApp
 * themselves. Stops when the ajza' run out; the rest count as skipped.
 */
export const importMembers = sessionMutation({
  args: { inviteCode: v.string(), sourceInviteCode: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true; added: number; skipped: number } | { error: "not_found" }
  > => {
    const { person, khatma } = await requireRotaOrganizer(ctx, args.inviteCode);
    const source = await organizerOf(ctx, args.sourceInviteCode, person);
    if (!source || source.khatma.kind === "rota" || isArchived(source.khatma)) {
      return { error: "not_found" };
    }
    const { phones, personIds } = await ops.activeIdentities(ctx, khatma._id);

    const candidates = (await membersByJoin(ctx, source.khatma._id)).filter(
      (m) => m.status === "active" && m.personId !== person._id,
    );
    let added = 0;
    let skipped = 0;
    for (const [index, member] of candidates.entries()) {
      const them = await ctx.db.get(member.personId);
      if (!them || personIds.has(them._id) || phones.has(them.phone)) {
        skipped += 1;
        continue;
      }
      const placed = await ops.placeNewParticipant(
        ctx,
        khatma,
        {
          name: them.displayName,
          phone: them.phone,
          personId: them._id,
          phoneHidden: true,
        },
        undefined,
      );
      if ("error" in placed) {
        skipped += candidates.length - index;
        break;
      }
      added += 1;
      personIds.add(them._id);
      phones.add(them.phone);
      await ops.saveContact(ctx, person, {
        name: them.displayName,
        phone: them.phone,
        hidden: true,
        personId: them._id,
      });
    }
    return { ok: true, added, skipped };
  },
});

// ---------------------------------------------------------------------------
// Joining

/**
 * Makes sure the khatma has a join code, so the People screen can show its
 * link. Queries can't write, so the screen asks for this when it has none.
 */
export const ensureJoinLink = sessionMutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { khatma } = await requireRotaOrganizer(ctx, args.inviteCode);
    await ensureJoinCode(ctx, khatma);
    return { ok: true };
  },
});

export const acceptJoinRequest = sessionMutation({
  args: {
    inviteCode: v.string(),
    requestId: v.id("rotaJoinRequests"),
    juz: v.number(),
    name: v.optional(v.string()),
    readsToday: v.optional(v.boolean()),
  },
  handler: async (ctx, args): ReturnType<typeof ops.acceptJoinRequest> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.acceptJoinRequest(ctx, khatma, rota, args);
  },
});

export const declineJoinRequest = sessionMutation({
  args: { inviteCode: v.string(), requestId: v.id("rotaJoinRequests") },
  handler: async (ctx, args): ReturnType<typeof ops.declineJoinRequest> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.declineJoinRequest(ctx, khatma, rota, args);
  },
});

// ---------------------------------------------------------------------------
// Today

/** Organizer only. */
export const today = sessionQuery({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<ops.TodayView | null> => {
    const found = await organizerRota(ctx, args.inviteCode);
    if (!found) return null;
    const { person, khatma, rota } = found;
    return ops.today(ctx, khatma, rota, { personId: person._id });
  },
});

export const reassign = sessionMutation({
  args: {
    inviteCode: v.string(),
    readId: v.id("rotaReads"),
    participantId: v.id("rotaParticipants"),
  },
  handler: async (ctx, args): ReturnType<typeof ops.reassign> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.reassign(ctx, khatma, rota, args);
  },
});

export const markDone = sessionMutation({
  args: { inviteCode: v.string(), readId: v.id("rotaReads") },
  handler: async (ctx, args): ReturnType<typeof ops.markDone> => {
    const { person, khatma, rota } = await requireRotaOrganizer(
      ctx,
      args.inviteCode,
    );
    return ops.markDone(ctx, khatma, rota, args, { personId: person._id });
  },
});

export const markNotDone = sessionMutation({
  args: { inviteCode: v.string(), readId: v.id("rotaReads") },
  handler: async (ctx, args): ReturnType<typeof ops.markNotDone> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.markNotDone(ctx, khatma, rota, args);
  },
});

// ---------------------------------------------------------------------------
// Settings

/** Organizer only. */
export const settings = sessionQuery({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<ops.SettingsView | null> => {
    const found = await organizerRota(ctx, args.inviteCode);
    return found && ops.settings(ctx, found.khatma, found.rota);
  },
});

export const update = sessionMutation({
  args: {
    inviteCode: v.string(),
    name: v.optional(v.union(v.string(), v.null())),
    days: v.optional(readingDaysValidator),
    firstDate: v.optional(v.string()),
    endDate: v.optional(v.union(v.string(), v.null())),
    timeZone: v.optional(v.string()),
    messages: v.optional(rotaMessagesValidator),
    lateTapMs: v.optional(v.union(v.number(), v.null())),
    cheer: v.optional(v.union(cheerConfigValidator, v.null())),
  },
  handler: async (ctx, args): ReturnType<typeof ops.update> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.update(ctx, khatma, rota, args);
  },
});

export const setPaused = sessionMutation({
  args: { inviteCode: v.string(), paused: v.boolean() },
  handler: async (ctx, args): ReturnType<typeof ops.setPaused> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.setPaused(ctx, khatma, rota, args);
  },
});

export const addPauseDate = sessionMutation({
  args: { inviteCode: v.string(), date: v.string() },
  handler: async (ctx, args): ReturnType<typeof ops.addPauseDate> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.addPauseDate(ctx, khatma, rota, args);
  },
});

export const removePauseDate = sessionMutation({
  args: { inviteCode: v.string(), date: v.string() },
  handler: async (ctx, args): ReturnType<typeof ops.removePauseDate> => {
    const { khatma, rota } = await requireRotaOrganizer(ctx, args.inviteCode);
    return ops.removePauseDate(ctx, khatma, rota, args);
  },
});
