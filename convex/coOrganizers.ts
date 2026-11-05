import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { activeMembership } from "./khatmas";
import { refreshPerson, refreshPhone } from "./lib/directory";
import { notify } from "./notes";
import { sessionMutation, sessionQuery } from "./lib/session";
import { getSetting } from "./lib/settings";
import { organizerOf, requireLiveOrganizer } from "./organizer";

/**
 * The owner names co-organizers and sets their three switches (spec 4.2-4.4a).
 * A co-organizer is keyed by phone; no phone ever leaves this module. Someone
 * the owner can name is a candidate, identified by an opaque id: `m:<memberId>`
 * in a pool khatma, `p:<participantId>` in a rota khatma.
 */

type Switches = { readings: boolean; people: boolean; settings: boolean };

export type CoOrganizersView = {
  max: number;
  enabled: boolean;
  defaults: Switches;
  coOrganizers: ({
    coOrganizerId: Id<"coOrganizers">;
    name: string;
    /** No account has this number yet (a rota participant on WhatsApp only). */
    pending: boolean;
  } & Switches)[];
  candidates: { candidateId: string; name: string }[];
};

export type SetResult =
  { ok: true } | { error: "disabled" | "full" | "not_member" | "self" };

async function rowsOf(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
): Promise<Doc<"coOrganizers">[]> {
  return await ctx.db
    .query("coOrganizers")
    .withIndex("by_khatma", (q) => q.eq("khatmaId", khatmaId))
    .collect();
}

export async function personByPhone(
  ctx: QueryCtx,
  phone: string,
): Promise<Doc<"people"> | null> {
  return await ctx.db
    .query("people")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
}

export async function liveParticipant(
  ctx: QueryCtx,
  khatmaId: Id<"khatmas">,
  phone: string,
): Promise<Doc<"rotaParticipants"> | null> {
  const rows = await ctx.db
    .query("rotaParticipants")
    .withIndex("by_khatma_phone", (q) =>
      q.eq("khatmaId", khatmaId).eq("phone", phone),
    )
    .collect();
  return rows.find((p) => p.removedAt === null) ?? null;
}

/** Everyone the owner could name, with the phone the role would be keyed by. */
async function candidatesOf(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
): Promise<{ candidateId: string; name: string; phone: string }[]> {
  const owner = await ctx.db.get(khatma.creatorPersonId);
  const found: { candidateId: string; name: string; phone: string }[] = [];
  if (khatma.kind === "rota") {
    const participants = await ctx.db
      .query("rotaParticipants")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect();
    for (const p of participants) {
      if (p.removedAt !== null) continue;
      if (p.personId === khatma.creatorPersonId || p.phone === owner?.phone) {
        continue;
      }
      found.push({ candidateId: `p:${p._id}`, name: p.name, phone: p.phone });
    }
  } else {
    const members = await ctx.db
      .query("members")
      .withIndex("by_khatma", (q) => q.eq("khatmaId", khatma._id))
      .collect();
    for (const m of members) {
      if (m.status !== "active" || m.personId === khatma.creatorPersonId) {
        continue;
      }
      const person = await ctx.db.get(m.personId);
      if (!person) continue;
      found.push({
        candidateId: `m:${m._id}`,
        name: person.displayName,
        phone: person.phone,
      });
    }
  }
  return found;
}

/** The name a co-organizer goes by in this khatma. */
async function nameOf(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  phone: string,
  person: Doc<"people"> | null,
): Promise<string> {
  if (khatma.kind === "rota") {
    const participant = await liveParticipant(ctx, khatma._id, phone);
    if (participant) return participant.name;
  }
  return person?.displayName ?? "";
}

/** The switches a newly named co-organizer starts with (the admin's defaults). */
export async function coOrganizerDefaults(ctx: QueryCtx): Promise<Switches> {
  return {
    readings: await getSetting(ctx, "coOrganizerDefaultReadings"),
    people: await getSetting(ctx, "coOrganizerDefaultPeople"),
    settings: await getSetting(ctx, "coOrganizerDefaultSettings"),
  };
}

/** Who helps run the khatma, oldest first, with their switches. */
export async function coOrganizersOf(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
): Promise<CoOrganizersView["coOrganizers"]> {
  const rows = (await rowsOf(ctx, khatma._id)).sort(
    (a, b) => a.addedAt - b.addedAt || a._creationTime - b._creationTime,
  );
  const coOrganizers: CoOrganizersView["coOrganizers"] = [];
  for (const row of rows) {
    const person = await personByPhone(ctx, row.phone);
    coOrganizers.push({
      coOrganizerId: row._id,
      name: await nameOf(ctx, khatma, row.phone, person),
      readings: row.readings,
      people: row.people,
      settings: row.settings,
      pending: person === null,
    });
  }
  return coOrganizers;
}

/** Who could still be named: candidates who aren't co-organizers yet. */
export async function openCandidates(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
): Promise<CoOrganizersView["candidates"]> {
  const named = new Set((await rowsOf(ctx, khatma._id)).map((r) => r.phone));
  return (await candidatesOf(ctx, khatma))
    .filter((c) => !named.has(c.phone))
    .map(({ candidateId, name }) => ({ candidateId, name }));
}

/** Owner only: who helps run the khatma, and who could. */
export const list = sessionQuery({
  args: { inviteCode: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<CoOrganizersView | { forbidden: true }> => {
    const found = await organizerOf(ctx, args.inviteCode, ctx.person);
    if (!found) return { forbidden: true };
    const { khatma } = found;

    const coOrganizers = await coOrganizersOf(ctx, khatma);
    const candidates = await openCandidates(ctx, khatma);

    return {
      max: await getSetting(ctx, "maxCoOrganizers"),
      enabled: await getSetting(ctx, "coOrganizersOn"),
      defaults: await coOrganizerDefaults(ctx),
      coOrganizers,
      candidates,
    };
  },
});

/**
 * The phone behind `candidateId` in `khatma`, or why it names no one. The
 * owner is `self`; anyone not (or no longer) in the khatma is `not_member`.
 */
async function candidatePhone(
  ctx: QueryCtx,
  khatma: Doc<"khatmas">,
  candidateId: string,
): Promise<string | "self" | "not_member"> {
  const [tag, raw] = [candidateId.slice(0, 2), candidateId.slice(2)];
  if (tag === "m:" && khatma.kind !== "rota") {
    const id = ctx.db.normalizeId("members", raw);
    const member = id ? await ctx.db.get(id) : null;
    if (!member || member.khatmaId !== khatma._id) return "not_member";
    if (member.status !== "active") return "not_member";
    if (member.personId === khatma.creatorPersonId) return "self";
    return (await ctx.db.get(member.personId))?.phone ?? "not_member";
  }
  if (tag === "p:" && khatma.kind === "rota") {
    const id = ctx.db.normalizeId("rotaParticipants", raw);
    const participant = id ? await ctx.db.get(id) : null;
    if (!participant || participant.khatmaId !== khatma._id) {
      return "not_member";
    }
    if (participant.removedAt !== null) return "not_member";
    const owner = await ctx.db.get(khatma.creatorPersonId);
    if (
      participant.personId === khatma.creatorPersonId ||
      participant.phone === owner?.phone
    ) {
      return "self";
    }
    return participant.phone;
  }
  return "not_member";
}

/**
 * A rota co-organizer with an account gets an active membership with
 * notifications on, so the khatma is on their home list and push reaches
 * them. Rota participants have none otherwise. A pool co-organizer is a member already.
 * Their participant row, added by phone before the account, gets the account
 * too, so Today knows it is them ("me", and their own juz' marked is their reply).
 */
export async function ensureRotaMembership(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  person: Doc<"people">,
): Promise<void> {
  if (khatma.kind !== "rota") return;
  const row = await liveParticipant(ctx, khatma._id, person.phone);
  if (row && row.personId === null) {
    await ctx.db.patch(row._id, { personId: person._id });
  }
  const existing = await ctx.db
    .query("members")
    .withIndex("by_khatma_person", (q) =>
      q.eq("khatmaId", khatma._id).eq("personId", person._id),
    )
    .first();
  if (existing) {
    if (existing.status !== "active" || !existing.notificationsOn) {
      await ctx.db.patch(existing._id, {
        status: "active",
        notificationsOn: true,
      });
    }
  } else {
    await ctx.db.insert("members", {
      khatmaId: khatma._id,
      personId: person._id,
      joinedAt: Date.now(),
      status: "active",
      notificationsOn: true,
      lastNudgeAt: null,
      lastCelebratedRound: 0,
    });
  }
  await refreshPerson(ctx, person._id);
}

/** Tells a co-organizer with an account that they were named: in the app and by push. */
async function tellNamed(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  person: Doc<"people">,
): Promise<void> {
  await notify(ctx, {
    personId: person._id,
    khatmaId: khatma._id,
    kind: "coOrganizerNow",
  });
}

/**
 * Names someone (`candidateId`) or changes a co-organizer's switches
 * (`coOrganizerId`). Naming refuses `disabled` while `coOrganizersOn` is off
 * and `full` at `maxCoOrganizers`, unless the caller opts out of those limits
 * (an admin does). Editing works even with the feature off. The caller decides
 * who may call.
 */
export async function setCoOrganizer(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  input: Switches & {
    candidateId?: string;
    coOrganizerId?: Id<"coOrganizers">;
  },
  options: { ignoreLimits?: boolean } = {},
): Promise<SetResult> {
  const switches = {
    readings: input.readings,
    people: input.people,
    settings: input.settings,
  };
  if (input.coOrganizerId !== undefined) {
    if (input.candidateId !== undefined) return { error: "not_member" };
    const row = await ctx.db.get(input.coOrganizerId);
    if (!row || row.khatmaId !== khatma._id) return { error: "not_member" };
    await ctx.db.patch(row._id, switches);
    return { ok: true };
  }
  if (input.candidateId === undefined) return { error: "not_member" };

  const limited = options.ignoreLimits !== true;
  if (limited && !(await getSetting(ctx, "coOrganizersOn"))) {
    return { error: "disabled" };
  }
  const phone = await candidatePhone(ctx, khatma, input.candidateId);
  if (phone === "self" || phone === "not_member") return { error: phone };

  const rows = await rowsOf(ctx, khatma._id);
  const same = rows.find((r) => r.phone === phone);
  if (same) {
    // Named already (a stale screen): the switches are what the owner chose now.
    await ctx.db.patch(same._id, switches);
    return { ok: true };
  }
  if (limited && rows.length >= (await getSetting(ctx, "maxCoOrganizers"))) {
    return { error: "full" };
  }
  await ctx.db.insert("coOrganizers", {
    khatmaId: khatma._id,
    phone,
    ...switches,
    addedAt: Date.now(),
  });
  const person = await personByPhone(ctx, phone);
  if (person) {
    await ensureRotaMembership(ctx, khatma, person);
    await tellNamed(ctx, khatma, person);
  }
  return { ok: true };
}

/**
 * The old owner after a transfer: a co-organizer with every switch, past
 * `maxCoOrganizers` if need be (spec 4.5). Only someone still in the khatma
 * stays on: an active member, and in a rota khatma a live participant too. No
 * `coOrganizerNow` note: the transfer's own notes say what happened. Whether
 * they hold the role now.
 */
export async function keepOldOwner(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  person: Doc<"people">,
): Promise<boolean> {
  if (!(await activeMembership(ctx, khatma._id, person._id))) return false;
  if (
    khatma.kind === "rota" &&
    !(await liveParticipant(ctx, khatma._id, person.phone))
  ) {
    return false;
  }
  const rows = await rowsOf(ctx, khatma._id);
  if (rows.some((r) => r.phone === person.phone)) return true;
  await ctx.db.insert("coOrganizers", {
    khatmaId: khatma._id,
    phone: person.phone,
    readings: true,
    people: true,
    settings: true,
    addedAt: Date.now(),
  });
  return true;
}

/** Takes the role away; the person stays in the khatma. The caller decides who may call. */
export async function removeCoOrganizer(
  ctx: MutationCtx,
  khatma: Doc<"khatmas">,
  coOrganizerId: Id<"coOrganizers">,
): Promise<{ ok: true } | { error: "not_found" }> {
  const row = await ctx.db.get(coOrganizerId);
  if (!row || row.khatmaId !== khatma._id) return { error: "not_found" };
  await endCoOrganizer(ctx, khatma._id, row.phone);
  return { ok: true };
}

/**
 * Ends `phone`'s co-organizer role in a khatma, if it has one: on removal of
 * the role, and on every path that ends their place in the khatma (coming back
 * doesn't restore it). In a rota khatma the membership naming gave them goes
 * too, so the khatma leaves their home list.
 */
export async function endCoOrganizer(
  ctx: MutationCtx,
  khatmaId: Id<"khatmas">,
  phone: string,
): Promise<void> {
  const rows = await ctx.db
    .query("coOrganizers")
    .withIndex("by_khatma_phone", (q) =>
      q.eq("khatmaId", khatmaId).eq("phone", phone),
    )
    .collect();
  if (rows.length === 0) return;
  for (const row of rows) await ctx.db.delete(row._id);

  const khatma = await ctx.db.get(khatmaId);
  const person = await personByPhone(ctx, phone);
  if (khatma?.kind !== "rota" || !person) return;
  if (person._id === khatma.creatorPersonId) return;
  const member = await ctx.db
    .query("members")
    .withIndex("by_khatma_person", (q) =>
      q.eq("khatmaId", khatmaId).eq("personId", person._id),
    )
    .first();
  if (member) {
    await ctx.db.delete(member._id);
    await refreshPhone(ctx, phone);
  }
}

/**
 * A new account on a number named in a rota khatma: it gets the membership
 * naming would have given it. Called where a `people` row is inserted.
 */
export async function linkCoOrganizerRoles(
  ctx: MutationCtx,
  person: Doc<"people">,
): Promise<void> {
  const rows = await ctx.db
    .query("coOrganizers")
    .withIndex("by_phone", (q) => q.eq("phone", person.phone))
    .collect();
  for (const row of rows) {
    const khatma = await ctx.db.get(row.khatmaId);
    if (khatma?.kind !== "rota") continue;
    if (!(await liveParticipant(ctx, khatma._id, person.phone))) continue;
    await ensureRotaMembership(ctx, khatma, person);
    await tellNamed(ctx, khatma, person);
  }
}

const switchArgs = {
  readings: v.boolean(),
  people: v.boolean(),
  settings: v.boolean(),
};

/** Owner only: names someone, or changes a co-organizer's switches. */
export const set = sessionMutation({
  args: {
    inviteCode: v.string(),
    candidateId: v.optional(v.string()),
    coOrganizerId: v.optional(v.id("coOrganizers")),
    ...switchArgs,
  },
  handler: async (ctx, args): Promise<SetResult> => {
    const { khatma } = await requireLiveOrganizer(ctx, args.inviteCode);
    return await setCoOrganizer(ctx, khatma, {
      candidateId: args.candidateId,
      coOrganizerId: args.coOrganizerId,
      readings: args.readings,
      people: args.people,
      settings: args.settings,
    });
  },
});

/** Owner only: takes a co-organizer's role away. */
export const remove = sessionMutation({
  args: { inviteCode: v.string(), coOrganizerId: v.id("coOrganizers") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { error: "not_found" }> => {
    const { khatma } = await requireLiveOrganizer(ctx, args.inviteCode);
    return await removeCoOrganizer(ctx, khatma, args.coOrganizerId);
  },
});
