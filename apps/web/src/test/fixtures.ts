import type { KhatmaView, TileView } from "@convex/khatmas";
import { JUZ } from "@convex/lib/juz";

export function makeTiles(
  overrides: Record<number, Partial<TileView>> = {},
): TileView[] {
  return JUZ.map((j) => ({
    juz: j.number,
    name: j.name,
    state: "open" as const,
    readerName: null,
    isMine: false,
    ...overrides[j.number],
  }));
}

/** The owner's access: every control. */
export const OWNER_ACCESS = {
  owner: true,
  readings: true,
  people: true,
  settings: true,
} as const;

/** A co-organizer's access with the given switches on. */
export function coOrganizerAccess(
  switches: Partial<Record<"readings" | "people" | "settings", boolean>> = {},
): NonNullable<KhatmaView["organizerAccess"]> {
  return {
    owner: false,
    readings: false,
    people: false,
    settings: false,
    ...switches,
  };
}

/** A pool khatma's view; the owner (`isOrganizer`) gets the owner's access, as the server gives it. */
export function makeView(overrides: Partial<KhatmaView> = {}): KhatmaView {
  return {
    khatmaId: "k1" as KhatmaView["khatmaId"],
    name: "ختمة العائلة",
    createdAt: Date.UTC(2026, 9, 20, 12),
    schedule: "weekly",
    grace: { value: 2, unit: "days" },
    isOrganizer: false,
    organizerAccess: overrides.isOrganizer ? { ...OWNER_ACCESS } : null,
    roundNumber: 12,
    targetEndAt: null,
    completedRounds: 0,
    archived: false,
    memberCount: 9,
    lastCompleted: null,
    inviterName: null,
    tiles: makeTiles(),
    me: {
      signedIn: true,
      displayName: "علي",
      isMember: true,
      notificationsOn: true,
      holding: null,
      hold: null,
      suggestion: null,
      celebrateRound: null,
    },
    ...overrides,
  };
}
