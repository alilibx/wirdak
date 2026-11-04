import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mergedStream, stream } from "convex-helpers/server/stream";
import type { Doc } from "./_generated/dataModel";
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
import schema from "./schema";

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
      : p.lastSeenAt === 0
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

/** A WhatsApp reader's row: masked, and nothing at all of a hidden number. */
async function readerRow(ctx: QueryCtx, r: Doc<"readerDirectory">) {
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
      page: await Promise.all(result.page.map((r) => readerRow(ctx, r))),
    };
  },
});

type EveryoneRow =
  | ({ kind: "person" } & Awaited<ReturnType<typeof personRow>>)
  | ({ kind: "reader" } & Awaited<ReturnType<typeof readerRow>>);

type EveryonePage = {
  page: EveryoneRow[];
  isDone: boolean;
  continueCursor: string;
};

type Source = (cursor: string | null, numItems: number) => Promise<EveryonePage>;

/**
 * Pages through `first` to its end, then through `second`, topping up the
 * page where `first` runs out. The cursor says which one it's in. Only `first`
 * may run a Convex paginated query: a function gets one.
 */
async function oneThenOther(
  first: Source,
  second: Source,
  opts: { cursor: string | null; numItems: number },
): Promise<EveryonePage> {
  const inner = opts.cursor === null ? null : opts.cursor.slice(2) || null;
  if (opts.cursor?.startsWith("2:")) {
    const result = await second(inner, opts.numItems);
    return { ...result, continueCursor: `2:${result.continueCursor}` };
  }
  const result = await first(inner, opts.numItems);
  if (!result.isDone) {
    return { ...result, continueCursor: `1:${result.continueCursor}` };
  }
  const room = opts.numItems - result.page.length;
  if (room <= 0) return { ...result, isDone: false, continueCursor: "2:" };
  const rest = await second(null, room);
  return {
    page: [...result.page, ...rest.page],
    isDone: rest.isDone,
    continueCursor: `2:${rest.continueCursor}`,
  };
}

/**
 * The "all" tab: everyone with an account and every WhatsApp reader, in one
 * list. Name and created interleave the two. Readers have never signed in, so
 * for last seen and joined they sit where a never-seen person would, and a
 * search lists matching people before matching readers.
 */
export const everyone = adminQuery({
  args: listArgs,
  handler: async (ctx, args): Promise<EveryonePage> => {
    const { sort, order } = args;
    const search = searchText(args.search);
    const db = stream(ctx.db, schema);
    const asPerson = async (p: Doc<"people">): Promise<EveryoneRow> => ({
      kind: "person",
      ...(await personRow(ctx, p)),
    });
    const asReader = async (
      r: Doc<"readerDirectory">,
    ): Promise<EveryoneRow> => ({ kind: "reader", ...(await readerRow(ctx, r)) });

    if (search !== null) {
      const people: Source = async (cursor, numItems) => {
        const result = await peopleQuery(
          ctx,
          undefined,
          sort,
          order,
          search,
        ).paginate({ cursor, numItems });
        return {
          page: await Promise.all(result.page.map(asPerson)),
          isDone: result.isDone,
          continueCursor: result.continueCursor,
        };
      };
      // A search finds at most a few hundred, so readers page by offset.
      const readers: Source = async (cursor, numItems) => {
        const offset = Number(cursor ?? 0);
        const found = await readersQuery(ctx, "created", order, search).take(
          offset + numItems,
        );
        return {
          page: await Promise.all(found.slice(offset).map(asReader)),
          isDone: found.length < offset + numItems,
          continueCursor: String(offset + numItems),
        };
      };
      return oneThenOther(people, readers, args.paginationOpts);
    }

    const readerStream = db.query("readerDirectory").order(order);
    if (sort === "name" || sort === "created") {
      const people =
        sort === "name"
          ? db.query("people").withIndex("by_searchName").order(order)
          : db.query("people").order(order);
      const readers =
        sort === "name"
          ? db.query("readerDirectory").withIndex("by_searchName").order(order)
          : readerStream;
      const result = await mergedStream(
        [people.map(asPerson), readers.map(asReader)],
        [sort === "name" ? "searchName" : "_creationTime"],
      ).paginate(args.paginationOpts);
      return {
        page: result.page,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }

    const peopleStream = db
      .query("people")
      .withIndex(sort === "lastSeen" ? "by_lastSeenAt" : "by_verifiedAt")
      .order(order)
      .map(asPerson);
    const fromStream =
      (s: typeof peopleStream): Source =>
      async (cursor, numItems) => {
        const result = await s.paginate({ cursor, numItems });
        return {
          page: result.page,
          isDone: result.isDone,
          continueCursor: result.continueCursor,
        };
      };
    const people = fromStream(peopleStream);
    const readers = fromStream(readerStream.map(asReader));
    // Ascending, a never-seen reader comes before everyone who was seen.
    return order === "asc"
      ? oneThenOther(readers, people, args.paginationOpts)
      : oneThenOther(people, readers, args.paginationOpts);
  },
});

function khatmaStatus(k: Doc<"khatmas">) {
  if (isArchived(k)) return "archived" as const;
  if (k.rota?.pendingOrganizer === true) return "waiting" as const;
  return k.rota?.pausedAt != null ? ("paused" as const) : ("active" as const);
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
    completed: rota ? (k.completedDays ?? 0) : k.completedRounds,
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
