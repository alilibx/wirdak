import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { foldText } from "./searchFold";

export const peopleTabValidator = v.union(
  v.literal("organizers"),
  v.literal("members"),
  v.literal("noKhatma"),
);
export type PeopleTab = Infer<typeof peopleTabValidator>;

function peopleTab(organizesCount: number, memberOfCount: number): PeopleTab {
  if (organizesCount > 0) return "organizers";
  return memberOfCount > 0 ? "members" : "noKhatma";
}

/** A khatma's name with what the admin list reads from it. */
export function nameFields(name: string | null) {
  return { name, searchName: foldText(name ?? "") };
}

async function refreshCounts(
  ctx: MutationCtx,
  person: Doc<"people">,
  readingIn: Id<"khatmas">[],
): Promise<void> {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_person", (q) => q.eq("personId", person._id))
    .collect();
  const organized = await ctx.db
    .query("khatmas")
    .withIndex("by_creator", (q) => q.eq("creatorPersonId", person._id))
    .collect();
  // A rota khatma's organizer has a membership and a participant row in it.
  const memberOf = new Set([
    ...memberships.filter((m) => m.status === "active").map((m) => m.khatmaId),
    ...readingIn,
  ]);
  const fields = {
    organizesCount: organized.length,
    memberOfCount: memberOf.size,
    listTab: peopleTab(organized.length, memberOf.size),
    searchName: foldText(person.displayName),
  };
  const same =
    person.organizesCount === fields.organizesCount &&
    person.memberOfCount === fields.memberOfCount &&
    person.listTab === fields.listTab &&
    person.searchName === fields.searchName;
  if (!same) await ctx.db.patch(person._id, fields);
}

async function refreshReader(
  ctx: MutationCtx,
  phone: string,
  rows: Doc<"rotaParticipants">[],
): Promise<void> {
  const entry = await ctx.db
    .query("readerDirectory")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
  if (rows.length === 0) {
    if (entry) await ctx.db.delete(entry._id);
    return;
  }
  const newest = rows.reduce((a, b) => (b.addedAt >= a.addedAt ? b : a));
  const replies = rows.flatMap((p) => p.lastReplyAt ?? []);
  const fields = {
    phone,
    name: newest.name,
    searchName: foldText(newest.name),
    khatmaCount: new Set(rows.map((p) => p.khatmaId)).size,
    lastReplyAt: replies.length > 0 ? Math.max(...replies) : null,
    phoneHidden: rows.some((p) => p.phoneHidden === true) || undefined,
  };
  if (!entry) {
    await ctx.db.insert("readerDirectory", fields);
    return;
  }
  const same =
    entry.name === fields.name &&
    entry.khatmaCount === fields.khatmaCount &&
    entry.lastReplyAt === fields.lastReplyAt &&
    entry.phoneHidden === fields.phoneHidden;
  if (!same) await ctx.db.replace(entry._id, fields);
}

/**
 * Recomputes what the admin lists read about one phone: its person's counts,
 * tab and folded name, or its `readerDirectory` row when it has no account.
 * Call it after any write to `members`, `khatmas.creatorPersonId` or
 * `rotaParticipants`, and to a person's name. It reads the source rows, so it
 * can't drift; `directory.repair` catches a write that forgot it (spec 6).
 */
export async function refreshPhone(
  ctx: MutationCtx,
  phone: string,
): Promise<void> {
  const rows = (
    await ctx.db
      .query("rotaParticipants")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .collect()
  ).filter((p) => p.removedAt === null);
  const person = await ctx.db
    .query("people")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
  if (person) {
    await refreshCounts(
      ctx,
      person,
      rows.map((p) => p.khatmaId),
    );
  }
  await refreshReader(ctx, phone, person ? [] : rows);
}

/** `refreshPhone` for a write that knows the person, not the phone. */
export async function refreshPerson(
  ctx: MutationCtx,
  personId: Id<"people">,
): Promise<void> {
  const person = await ctx.db.get(personId);
  if (person) await refreshPhone(ctx, person.phone);
}
