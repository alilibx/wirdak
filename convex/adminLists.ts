import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { dayProgress, memberCount } from "./adminLookup";
import { adminQuery } from "./lib/adminSession";
import { isBlocked } from "./lib/blocked";
import { peopleTabValidator, type PeopleTab } from "./lib/directory";
import { isArchived } from "./lib/khatma";
import { lastRotaDay } from "./lib/rotaPlace";
import { foldText } from "./lib/searchFold";
import { getSetting } from "./lib/settings";
import { maskPhone } from "./lib/text";

const orderValidator = v.union(v.literal("asc"), v.literal("desc"));
type Order = "asc" | "desc";

/** Only these orders exist: nothing sorts by a count, or it would rank people (spec 2). */
const peopleSortValidator = v.union(
  v.literal("name"),
  v.literal("lastSeen"),
  v.literal("joined"),
  v.literal("created"),
);
type PeopleSort = "name" | "lastSeen" | "joined" | "created";

/** Open requests are few; the filter reads at most this many. */
const MAX_OPEN_REQUESTS = 200;

/** What was typed, folded like the names it looks for, or null for nothing typed. */
function searchText(search: string | undefined): string | null {
  const text = foldText(search ?? "").slice(0, 100);
  return text === "" ? null : text;
}

function peopleQuery(
  ctx: QueryCtx,
  tab: PeopleTab | undefined,
  sort: PeopleSort,
  order: Order,
  search: string | null,
) {
  const people = ctx.db.query("people");
  if (search !== null) {
    return people.withSearchIndex("search_searchName", (q) => {
      const found = q.search("searchName", search);
      return tab ? found.eq("listTab", tab) : found;
    });
  }
  if (tab) {
    switch (sort) {
      case "name":
        return people
          .withIndex("by_tab_searchName", (q) => q.eq("listTab", tab))
          .order(order);
      case "lastSeen":
        return people
          .withIndex("by_tab_lastSeenAt", (q) => q.eq("listTab", tab))
          .order(order);
      case "joined":
        return people
          .withIndex("by_tab_verifiedAt", (q) => q.eq("listTab", tab))
          .order(order);
      case "created":
        return people
          .withIndex("by_tab", (q) => q.eq("listTab", tab))
          .order(order);
    }
  }
  switch (sort) {
    case "name":
      return people.withIndex("by_searchName").order(order);
    case "lastSeen":
      return people.withIndex("by_lastSeenAt").order(order);
    case "joined":
      return people.withIndex("by_verifiedAt").order(order);
    case "created":
      return people.order(order);
  }
}

/** A person's row: masked, because a full number shows only on their page. */
async function personRow(ctx: QueryCtx, p: Doc<"people">) {
  const blocked = await isBlocked(ctx, p.phone);
  return {
    personId: p._id,
    displayName: p.displayName,
    phoneMasked: maskPhone(p.phone),
    status: blocked
      ? ("blocked" as const)
      : p.verifiedAt === 0
        ? ("notJoined" as const)
        : ("active" as const),
    rotaAllowed: p.rotaAllowed === true,
    organizesCount: p.organizesCount ?? 0,
    memberOfCount: p.memberOfCount ?? 0,
    lastSeenAt: p.lastSeenAt,
    verifiedAt: p.verifiedAt,
    createdAt: p._creationTime,
  };
}

const listArgs = {
  paginationOpts: paginationOptsValidator,
  sort: peopleSortValidator,
  order: orderValidator,
  search: v.optional(v.string()),
};

/** Everyone with an account, or one tab of them (spec 6). */
export const people = adminQuery({
  args: { ...listArgs, tab: v.optional(peopleTabValidator) },
  handler: async (ctx, args) => {
    const result = await peopleQuery(
      ctx,
      args.tab,
      args.sort,
      args.order,
      searchText(args.search),
    ).paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(result.page.map((p) => personRow(ctx, p))),
    };
  },
});

/**
 * The organizers tab: each person's khatmas and total members, and whether
 * they've been away as long as the handover waits for (`organizerInactiveMs`).
 */
export const organizers = adminQuery({
  args: listArgs,
  handler: async (ctx, args) => {
    const result = await peopleQuery(
      ctx,
      "organizers",
      args.sort,
      args.order,
      searchText(args.search),
    ).paginate(args.paginationOpts);
    const cutoff = Date.now() - (await getSetting(ctx, "organizerInactiveMs"));
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (p) => {
          const organized = await ctx.db
            .query("khatmas")
            .withIndex("by_creator", (q) => q.eq("creatorPersonId", p._id))
            .collect();
          const khatmas = await Promise.all(
            organized.map(async (k) => ({
              khatmaId: k._id,
              name: k.name,
              memberCount: await memberCount(ctx, k),
            })),
          );
          return {
            ...(await personRow(ctx, p)),
            khatmas,
            totalMembers: khatmas.reduce((sum, k) => sum + k.memberCount, 0),
            // 0 means never signed in: that has its own status.
            away: p.lastSeenAt > 0 && p.lastSeenAt < cutoff,
          };
        }),
      ),
    };
  },
});

/** Blocked numbers, newest first. A blocked number needs no account (spec 6). */
export const blocked = adminQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("blockedPhones")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (b) => {
          const p = await ctx.db
            .query("people")
            .withIndex("by_phone", (q) => q.eq("phone", b.phone))
            .first();
          return {
            blockedId: b._id,
            phoneMasked: maskPhone(b.phone),
            at: b.at,
            note: b.note,
            person: p ? { personId: p._id, displayName: p.displayName } : null,
          };
        }),
      ),
    };
  },
});

function readersQuery(
  ctx: QueryCtx,
  sort: "name" | "lastReply" | "created",
  order: Order,
  search: string | null,
) {
  const readers = ctx.db.query("readerDirectory");
  if (search !== null) {
    return readers.withSearchIndex("search_searchName", (q) =>
      q.search("searchName", search),
    );
  }
  switch (sort) {
    case "name":
      return readers.withIndex("by_searchName").order(order);
    case "lastReply":
      return readers.withIndex("by_lastReplyAt").order(order);
    case "created":
      return readers.order(order);
  }
}

/** Who reads in a rotating khatma on WhatsApp with no account (spec 6). */
export const readers = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: v.union(
      v.literal("name"),
      v.literal("lastReply"),
      v.literal("created"),
    ),
    order: orderValidator,
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await readersQuery(
      ctx,
      args.sort,
      args.order,
      searchText(args.search),
    ).paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (r) => {
          const rows = await ctx.db
            .query("rotaParticipants")
            .withIndex("by_phone", (q) => q.eq("phone", r.phone))
            .collect();
          const khatmas = await Promise.all(
            rows
              .filter((p) => p.removedAt === null)
              .map(async (p) => ({
                khatmaId: p.khatmaId,
                name: (await ctx.db.get(p.khatmaId))?.name ?? null,
              })),
          );
          return {
            readerId: r._id,
            name: r.name,
            // A number imported from a pool khatma stays hidden, even masked.
            phoneMasked: r.phoneHidden === true ? null : maskPhone(r.phone),
            khatmaCount: r.khatmaCount,
            khatmas,
            lastReplyAt: r.lastReplyAt,
            createdAt: r._creationTime,
            blocked: await isBlocked(ctx, r.phone),
          };
        }),
      ),
    };
  },
});

function khatmaStatus(k: Doc<"khatmas">) {
  if (isArchived(k)) return "archived" as const;
  if (k.rota?.pendingOrganizer === true) return "waiting" as const;
  return k.rota?.pausedAt != null ? ("paused" as const) : ("active" as const);
}

/** Reading days that reached 30 ajza', at most one a day. */
async function completedDays(ctx: QueryCtx, khatmaId: Id<"khatmas">) {
  const days = await ctx.db
    .query("rotaDays")
    .withIndex("by_khatma_n", (q) => q.eq("khatmaId", khatmaId))
    .filter((q) => q.neq(q.field("completedAt"), null))
    .collect();
  return days.length;
}

async function khatmaRow(ctx: QueryCtx, k: Doc<"khatmas">) {
  const organizer = await ctx.db.get(k.creatorPersonId);
  const rota = k.kind === "rota";
  return {
    khatmaId: k._id,
    name: k.name,
    kind: rota ? ("rota" as const) : ("pool" as const),
    status: khatmaStatus(k),
    organizer: organizer
      ? { personId: organizer._id, displayName: organizer.displayName }
      : null,
    memberCount: await memberCount(ctx, k),
    today: rota ? await dayProgress(ctx, await lastRotaDay(ctx, k._id)) : null,
    completed: rota ? await completedDays(ctx, k._id) : k.completedRounds,
    createdAt: k.createdAt,
  };
}

type KhatmaKind = "pool" | "rota";
type KhatmaSort = "name" | "created";

function khatmasQuery(
  ctx: QueryCtx,
  kind: KhatmaKind | undefined,
  sort: KhatmaSort,
  order: Order,
  search: string | null,
) {
  const khatmas = ctx.db.query("khatmas");
  // A pool khatma has no `kind`.
  const kindValue = kind === "rota" ? ("rota" as const) : undefined;
  if (search !== null) {
    return khatmas.withSearchIndex("search_searchName", (q) => {
      const found = q.search("searchName", search);
      return kind ? found.eq("kind", kindValue) : found;
    });
  }
  if (kind) {
    return sort === "name"
      ? khatmas
          .withIndex("by_kind_searchName", (q) => q.eq("kind", kindValue))
          .order(order)
      : khatmas
          .withIndex("by_kind", (q) => q.eq("kind", kindValue))
          .order(order);
  }
  return sort === "name"
    ? khatmas.withIndex("by_searchName").order(order)
    : khatmas.order(order);
}

/** The khatmas with an open join request: one page, since they're few. */
async function khatmasWaitingToJoin(
  ctx: QueryCtx,
  kind: KhatmaKind | undefined,
  sort: KhatmaSort,
  order: Order,
  search: string | null,
) {
  // Only a rota khatma takes join requests.
  if (kind === "pool") return [];
  const open = await ctx.db
    .query("rotaJoinRequests")
    .withIndex("by_open", (q) => q.eq("resolvedAt", null))
    .take(MAX_OPEN_REQUESTS);
  const found = await Promise.all(
    [...new Set(open.map((r) => r.khatmaId))].map((id) => ctx.db.get(id)),
  );
  const key = (k: Doc<"khatmas">) =>
    sort === "name" ? (k.searchName ?? "") : String(k._creationTime);
  return found
    .filter((k) => k !== null)
    .filter((k) => search === null || k.searchName?.includes(search))
    .sort((a, b) => key(a).localeCompare(key(b)) * (order === "asc" ? 1 : -1));
}

/**
 * Every khatma (spec 6). Only name and created sort; the kind has an index,
 * and the status filters what a page reads, which a table of khatmas can bear.
 */
export const khatmas = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: v.union(v.literal("name"), v.literal("created")),
    order: orderValidator,
    search: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("pool"), v.literal("rota"))),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("archived"),
        v.literal("pendingJoin"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const search = searchText(args.search);
    const { kind, sort, order, status } = args;
    if (status === "pendingJoin") {
      const found = await khatmasWaitingToJoin(ctx, kind, sort, order, search);
      return {
        page: await Promise.all(found.map((k) => khatmaRow(ctx, k))),
        isDone: true,
        continueCursor: "",
      };
    }
    const query = khatmasQuery(ctx, kind, sort, order, search);
    const filtered =
      status === undefined
        ? query
        : query.filter((q) => {
            const live = q.and(
              q.or(
                q.eq(q.field("archivedAt"), undefined),
                q.eq(q.field("archivedAt"), null),
              ),
              q.or(
                q.eq(q.field("rota.archivedAt"), undefined),
                q.eq(q.field("rota.archivedAt"), null),
              ),
            );
            return status === "active" ? live : q.not(live);
          });
    const result = await filtered.paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(result.page.map((k) => khatmaRow(ctx, k))),
    };
  },
});
