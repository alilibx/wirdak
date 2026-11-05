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

export function makeView(overrides: Partial<KhatmaView> = {}): KhatmaView {
  return {
    khatmaId: "k1" as KhatmaView["khatmaId"],
    name: "ختمة العائلة",
    createdAt: Date.UTC(2026, 9, 20, 12),
    schedule: "weekly",
    grace: { value: 2, unit: "days" },
    isOrganizer: false,
    organizerAccess: null,
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
