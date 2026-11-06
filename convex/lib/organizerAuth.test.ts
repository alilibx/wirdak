import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { WithoutSystemFields } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { DEFAULT_GRACE } from "./grace";
import { allows, roleIn, type Need } from "./organizerAuth";

const modules = import.meta.glob("../**/*.ts");

const NEEDS: Need[] = ["owner", "readings", "people", "settings"];
const HELPER_PHONE = "+971500000002";

test("the owner passes every need", () => {
  for (const need of NEEDS) expect(allows({ owner: true }, need)).toBe(true);
});

test("a co-organizer passes only its switches, never owner", () => {
  const role = {
    owner: false,
    readings: true,
    people: false,
    settings: false,
  } as const;
  expect(allows(role, "readings")).toBe(true);
  expect(allows(role, "people")).toBe(false);
  expect(allows(role, "owner")).toBe(false);
  expect(allows(null, "readings")).toBe(false);
});

async function person(ctx: MutationCtx, phone: string): Promise<Id<"people">> {
  return await ctx.db.insert("people", {
    phone,
    displayName: phone,
    verifiedAt: 0,
    timeZone: "Asia/Dubai",
    lastSeenAt: 0,
    rotaAllowed: true,
  });
}

async function khatma(
  ctx: MutationCtx,
  creatorPersonId: Id<"people">,
  kind?: "rota",
): Promise<Id<"khatmas">> {
  return await ctx.db.insert("khatmas", {
    name: "ختمة",
    schedule: "none",
    grace: DEFAULT_GRACE.none,
    creatorPersonId,
    inviteCode: "code",
    completedRounds: 0,
    createdAt: 0,
    ...(kind
      ? {
          kind,
          rota: {
            days: { kind: "daily" },
            firstDate: "2027-01-15",
            endDate: null,
            timeZone: "Asia/Dubai",
            messages: {
              dayAt: 480,
              reminder: { at: 960, on: true },
              unread: { at: 1140, on: true },
              summary: { at: 1260, on: false },
            },
            pausedAt: null,
            pauseDates: [],
            archivedAt: null,
          },
        }
      : {}),
  });
}

function member(
  khatmaId: Id<"khatmas">,
  personId: Id<"people">,
): WithoutSystemFields<Doc<"members">> {
  return {
    khatmaId,
    personId,
    joinedAt: 0,
    status: "active",
    notificationsOn: true,
    lastNudgeAt: null,
    lastCelebratedRound: 0,
  };
}

const SWITCHES = { readings: true, people: false, settings: true, addedAt: 0 };

test("roleIn finds a pool co-organizer by phone while they are an active member", async () => {
  const t = convexTest(schema, modules);
  const result = await t.run(async (ctx) => {
    const ownerId = await person(ctx, "+971500000001");
    const helperId = await person(ctx, HELPER_PHONE);
    const khatmaId = await khatma(ctx, ownerId);
    await ctx.db.insert("members", member(khatmaId, ownerId));
    const memberId = await ctx.db.insert("members", member(khatmaId, helperId));
    await ctx.db.insert("coOrganizers", {
      khatmaId,
      phone: HELPER_PHONE,
      ...SWITCHES,
    });
    const k = (await ctx.db.get(khatmaId))!;
    const helper = (await ctx.db.get(helperId))!;
    const active = await roleIn(ctx, k, helper);
    await ctx.db.patch(memberId, { status: "blocked" });
    const blocked = await roleIn(ctx, k, helper);
    return { active, blocked };
  });
  expect(result.active).toEqual({
    owner: false,
    readings: true,
    people: false,
    settings: true,
  });
  expect(result.blocked).toBeNull();
});

test("roleIn finds a rota co-organizer only while their participant row is live", async () => {
  const t = convexTest(schema, modules);
  const result = await t.run(async (ctx) => {
    const ownerId = await person(ctx, "+971500000001");
    const helperId = await person(ctx, HELPER_PHONE);
    const khatmaId = await khatma(ctx, ownerId, "rota");
    const participantId = await ctx.db.insert("rotaParticipants", {
      khatmaId,
      name: "مساعد",
      phone: HELPER_PHONE,
      personId: null,
      addedAt: 0,
      removedAt: null,
    });
    await ctx.db.insert("coOrganizers", {
      khatmaId,
      phone: HELPER_PHONE,
      ...SWITCHES,
    });
    const k = (await ctx.db.get(khatmaId))!;
    const helper = (await ctx.db.get(helperId))!;
    const live = await roleIn(ctx, k, helper);
    await ctx.db.patch(participantId, { removedAt: 1 });
    const removed = await roleIn(ctx, k, helper);
    return { live, removed };
  });
  expect(result.live).toMatchObject({ owner: false, readings: true });
  expect(result.removed).toBeNull();
});

test("a removed owner holds no role", async () => {
  const t = convexTest(schema, modules);
  const result = await t.run(async (ctx) => {
    const ownerId = await person(ctx, "+971500000001");
    const khatmaId = await khatma(ctx, ownerId);
    const k = (await ctx.db.get(khatmaId))!;
    const owner = (await ctx.db.get(ownerId))!;
    const without = await roleIn(ctx, k, owner);
    await ctx.db.insert("members", member(khatmaId, ownerId));
    const withMembership = await roleIn(ctx, k, owner);
    return { without, withMembership };
  });
  expect(result.without).toBeNull();
  expect(result.withMembership).toEqual({ owner: true });
});
