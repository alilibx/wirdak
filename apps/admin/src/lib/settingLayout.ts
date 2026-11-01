import type { SettingGroup } from "@convex/lib/settingSpecs";
import type { SettingKey } from "@convex/lib/settings";

/** A titled run of settings inside a group, most-used first. */
export type SettingSection =
  | "general"
  | "grace"
  | "pace"
  | "reading"
  | "quiet"
  | "readers"
  | "cheers"
  | "admins"
  | "khatmaUse"
  | "signInAbuse"
  | "links"
  | "signInCodes"
  | "organizer"
  | "notes"
  | "helpLimits"
  | "helpRetention"
  | "rotaTimes"
  | "rotaLimits"
  | "rotaSilence";

/**
 * Where each setting sits on the settings page. A missing group is a type
 * error; a missing or misplaced key fails `settingLayout.test.ts`.
 */
export const SETTING_LAYOUT: Record<
  SettingGroup,
  { section: SettingSection; keys: SettingKey[] }[]
> = {
  switches: [
    {
      section: "general",
      keys: [
        "maintenanceMode",
        "maintenanceMessage",
        "announcement",
        "minClientVersion",
      ],
    },
  ],
  pace: [
    { section: "grace", keys: ["graceDefaults", "graceNoticeFraction"] },
    {
      section: "pace",
      keys: [
        "defaultPaceMs",
        "paceMinMs",
        "paceMaxMs",
        "paceSampleSize",
        "paceMinFinishes",
        "paceMinCountedMs",
      ],
    },
    {
      section: "reading",
      keys: ["rotationLookbackRounds", "undoWindowMs", "completionDelayMs"],
    },
  ],
  notifications: [
    { section: "quiet", keys: ["quietStartHour", "quietEndHour"] },
    {
      section: "readers",
      keys: ["reminderPaceMultiple", "nudgeCooldownMs", "openForHelpBatchMs"],
    },
    {
      section: "cheers",
      keys: [
        "cheerOn",
        "cheerEveryone",
        "cheerGapMs",
        "cheerShowName",
        "cheerShowJuz",
      ],
    },
    { section: "admins", keys: ["summaryHour", "milestonePushSpacingMs"] },
  ],
  help: [
    {
      section: "helpLimits",
      keys: [
        "helpRequestsPerPersonPerDay",
        "helpRequestsPerVisitorPerDay",
        "helpRequestsPerIpPerDay",
        "helpMessagesPerHour",
      ],
    },
    {
      section: "helpRetention",
      keys: ["helpAutoCloseMs", "helpAttachmentRetentionMs", "helpRetentionMs"],
    },
  ],
  limits: [
    {
      section: "khatmaUse",
      keys: [
        "maxMembers",
        "createsPerPersonPerDay",
        "newMembersPerKhatmaPerHour",
        "poolActionsPerPersonPerMinute",
        "nameChangesPerPersonPerHour",
      ],
    },
    {
      section: "signInAbuse",
      keys: [
        "verifyStartPerClientPer10Min",
        "verifyStartPerIpPer10Min",
        "verifyPerPhonePerHour",
        "verifyGlobalPerMinute",
      ],
    },
    {
      section: "links",
      keys: ["previewPerIpPerMinute", "handoffRedeemGlobalPerMinute"],
    },
  ],
  sessions: [
    {
      section: "signInCodes",
      keys: [
        "verificationTtlMs",
        "pinMaxAttempts",
        "signInAlertOn",
        "handoffTtlMs",
      ],
    },
    {
      section: "organizer",
      keys: ["organizerInactiveMs", "successorActiveMs"],
    },
    { section: "notes", keys: ["notesRetentionMs", "notesUnclearedCapMs"] },
  ],
  rota: [
    {
      section: "rotaTimes",
      keys: [
        "rotaDayAt",
        "rotaReminderAt",
        "rotaReminderOn",
        "rotaUnreadAt",
        "rotaUnreadOn",
        "rotaSummaryAt",
        "rotaSummaryOn",
      ],
    },
    {
      section: "rotaLimits",
      keys: ["rotaMaxActivePerOrganizer", "rotaMaxSlotsPerPerson"],
    },
    {
      section: "rotaSilence",
      keys: ["rotaSilenceNoticeDays", "rotaSilenceStopDays"],
    },
  ],
};
