import { CHEER_MAX_GAP_MS } from "./cheer";
import { isValidGrace, type Grace } from "./grace";
import { SCHEDULES } from "./schedule";
import type { SettingKey } from "./settings";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type SettingGroup =
  | "pace"
  | "notifications"
  | "limits"
  | "sessions"
  | "switches"
  | "help"
  | "rota";

export type SettingSpec = { group: SettingGroup } & (
  | { kind: "int"; min: number; max: number }
  | { kind: "number"; min: number; max: number }
  /** milliseconds */
  | { kind: "duration"; min: number; max: number }
  /** a whole hour, 0 to 23 */
  | { kind: "hour" }
  /** minutes after local midnight, 0 to 1425 in steps of 15 */
  | { kind: "time" }
  | { kind: "bool" }
  /** trimmed text or null */
  | { kind: "text"; maxLength: number }
  /** `x.y.z` or null */
  | { kind: "version" }
  /** a grace per schedule */
  | { kind: "grace" }
);

/** How each setting may be edited (plan 3a, Task 5). A missing key is a type error. */
export const SETTING_SPECS: { [K in SettingKey]: SettingSpec } = {
  maxMembers: { kind: "int", min: 2, max: 500, group: "limits" },
  rotationLookbackRounds: { kind: "int", min: 0, max: 10, group: "pace" },
  undoWindowMs: {
    kind: "duration",
    min: 3 * SECOND,
    max: 60 * SECOND,
    group: "pace",
  },
  completionDelayMs: {
    kind: "duration",
    min: 0,
    max: 60 * SECOND,
    group: "pace",
  },
  verificationTtlMs: {
    kind: "duration",
    min: 2 * MINUTE,
    max: 30 * MINUTE,
    group: "sessions",
  },
  pinMaxAttempts: { kind: "int", min: 3, max: 10, group: "sessions" },
  signInAlertOn: { kind: "bool", group: "sessions" },
  verifyStartPerClientPer10Min: {
    kind: "int",
    min: 1,
    max: 100,
    group: "limits",
  },
  verifyStartPerIpPer10Min: { kind: "int", min: 1, max: 1000, group: "limits" },
  verifyPerPhonePerHour: { kind: "int", min: 1, max: 100, group: "limits" },
  verifyGlobalPerMinute: { kind: "int", min: 10, max: 10000, group: "limits" },
  poolActionsPerPersonPerMinute: {
    kind: "int",
    min: 1,
    max: 100,
    group: "limits",
  },
  createsPerPersonPerDay: { kind: "int", min: 1, max: 100, group: "limits" },
  newMembersPerKhatmaPerHour: {
    kind: "int",
    min: 1,
    max: 500,
    group: "limits",
  },
  nameChangesPerPersonPerHour: {
    kind: "int",
    min: 1,
    max: 100,
    group: "limits",
  },
  graceDefaults: { kind: "grace", group: "pace" },
  graceNoticeFraction: { kind: "number", min: 0.05, max: 0.75, group: "pace" },
  quietStartHour: { kind: "hour", group: "notifications" },
  quietEndHour: { kind: "hour", group: "notifications" },
  defaultPaceMs: { kind: "duration", min: DAY, max: 14 * DAY, group: "pace" },
  paceMinMs: { kind: "duration", min: HOUR, max: 7 * DAY, group: "pace" },
  paceMaxMs: { kind: "duration", min: DAY, max: 30 * DAY, group: "pace" },
  paceMinCountedMs: { kind: "duration", min: 0, max: 2 * HOUR, group: "pace" },
  paceSampleSize: { kind: "int", min: 1, max: 20, group: "pace" },
  paceMinFinishes: { kind: "int", min: 1, max: 20, group: "pace" },
  reminderPaceMultiple: {
    kind: "number",
    min: 1.1,
    max: 5,
    group: "notifications",
  },
  nudgeCooldownMs: {
    kind: "duration",
    min: HOUR,
    max: 7 * DAY,
    group: "notifications",
  },
  openForHelpBatchMs: {
    kind: "duration",
    min: 0,
    max: 6 * HOUR,
    group: "notifications",
  },
  cheerOn: { kind: "bool", group: "notifications" },
  cheerEveryone: { kind: "bool", group: "notifications" },
  cheerGapMs: {
    kind: "duration",
    min: 0,
    max: CHEER_MAX_GAP_MS,
    group: "notifications",
  },
  cheerShowName: { kind: "bool", group: "notifications" },
  cheerShowJuz: { kind: "bool", group: "notifications" },
  organizerInactiveMs: {
    kind: "duration",
    min: 7 * DAY,
    max: 180 * DAY,
    group: "sessions",
  },
  successorActiveMs: {
    kind: "duration",
    min: DAY,
    max: 30 * DAY,
    group: "sessions",
  },
  notesRetentionMs: {
    kind: "duration",
    min: DAY,
    max: 365 * DAY,
    group: "sessions",
  },
  notesUnclearedCapMs: {
    kind: "duration",
    min: 30 * DAY,
    max: 730 * DAY,
    group: "sessions",
  },
  handoffTtlMs: {
    kind: "duration",
    min: 5 * MINUTE,
    max: 2 * HOUR,
    group: "sessions",
  },
  previewPerIpPerMinute: { kind: "int", min: 1, max: 1000, group: "limits" },
  handoffRedeemGlobalPerMinute: {
    kind: "int",
    min: 1,
    max: 1000,
    group: "limits",
  },
  maintenanceMode: { kind: "bool", group: "switches" },
  announcement: { kind: "text", maxLength: 200, group: "switches" },
  maintenanceMessage: { kind: "text", maxLength: 200, group: "switches" },
  minClientVersion: { kind: "version", group: "switches" },
  helpRequestsPerPersonPerDay: { kind: "int", min: 1, max: 50, group: "help" },
  helpRequestsPerVisitorPerDay: { kind: "int", min: 1, max: 50, group: "help" },
  helpRequestsPerIpPerDay: { kind: "int", min: 1, max: 500, group: "help" },
  helpMessagesPerHour: { kind: "int", min: 1, max: 200, group: "help" },
  helpAutoCloseMs: { kind: "duration", min: DAY, max: 90 * DAY, group: "help" },
  helpAttachmentRetentionMs: {
    kind: "duration",
    min: DAY,
    max: 365 * DAY,
    group: "help",
  },
  summaryHour: { kind: "hour", group: "notifications" },
  milestonePushSpacingMs: {
    kind: "duration",
    min: 10 * SECOND,
    max: HOUR,
    group: "notifications",
  },
  helpRetentionMs: {
    kind: "duration",
    min: 30 * DAY,
    max: 730 * DAY,
    group: "help",
  },
  rotaDayAt: { kind: "time", group: "rota" },
  rotaReminderAt: { kind: "time", group: "rota" },
  rotaReminderOn: { kind: "bool", group: "rota" },
  rotaUnreadAt: { kind: "time", group: "rota" },
  rotaUnreadOn: { kind: "bool", group: "rota" },
  rotaSummaryAt: { kind: "time", group: "rota" },
  rotaSummaryOn: { kind: "bool", group: "rota" },
  rotaLateTapMs: { kind: "duration", min: 0, max: 12 * HOUR, group: "rota" },
  rotaStartNextDay: { kind: "bool", group: "rota" },
  rotaAssignDuringQuiet: { kind: "bool", group: "rota" },
  rotaMaxActivePerOrganizer: { kind: "int", min: 1, max: 20, group: "rota" },
  rotaMaxSlotsPerPerson: { kind: "int", min: 1, max: 30, group: "rota" },
  rotaSilenceNoticeDays: { kind: "int", min: 1, max: 30, group: "rota" },
  rotaSilenceStopDays: { kind: "int", min: 2, max: 60, group: "rota" },
};

export type SettingError =
  "wrong_type" | "out_of_range" | "too_long" | "bad_version" | "bad_grace";

const VERSION_RE = /^\d+\.\d+\.\d+$/;

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inRange(value: number, min: number, max: number): SettingError | null {
  return value >= min && value <= max ? null : "out_of_range";
}

function isGrace(value: unknown): value is Grace {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Record<string, unknown>;
  return (
    Object.keys(g).length === 2 &&
    isNumber(g.value) &&
    (g.unit === "minutes" || g.unit === "hours" || g.unit === "days") &&
    isValidGrace(g as Grace)
  );
}

function isGraceDefaults(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === SCHEDULES.length &&
    SCHEDULES.every((s) => isGrace(record[s]))
  );
}

/**
 * Why `value` can't be stored for `key`, or null when it can. Values are
 * refused, never clamped. Text is expected already trimmed (see `cleanValue`).
 */
export function validateSetting(
  key: SettingKey,
  value: unknown,
): SettingError | null {
  const spec = SETTING_SPECS[key];
  switch (spec.kind) {
    case "int":
      if (!isNumber(value) || !Number.isInteger(value)) return "wrong_type";
      return inRange(value, spec.min, spec.max);
    case "number":
    case "duration":
      if (!isNumber(value)) return "wrong_type";
      return inRange(value, spec.min, spec.max);
    case "hour":
      if (!isNumber(value) || !Number.isInteger(value)) return "wrong_type";
      return inRange(value, 0, 23);
    case "time":
      if (!isNumber(value) || !Number.isInteger(value)) return "wrong_type";
      if (value % 15 !== 0) return "out_of_range";
      return inRange(value, 0, 1425);
    case "bool":
      return typeof value === "boolean" ? null : "wrong_type";
    case "text":
      if (value === null) return null;
      if (typeof value !== "string") return "wrong_type";
      return value.length <= spec.maxLength ? null : "too_long";
    case "version":
      if (value === null) return null;
      if (typeof value !== "string") return "wrong_type";
      return VERSION_RE.test(value) ? null : "bad_version";
    case "grace":
      return isGraceDefaults(value) ? null : "bad_grace";
  }
}

/** Trims text settings and turns an empty one into null. Other values pass through. */
export function cleanValue(key: SettingKey, value: unknown): unknown {
  const kind = SETTING_SPECS[key].kind;
  if ((kind === "text" || kind === "version") && typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value;
}

export type CrossCheckValues = {
  defaultPaceMs: number;
  paceMinMs: number;
  paceMaxMs: number;
  quietStartHour: number;
  quietEndHour: number;
};

/** Rules that span settings: pace bounds in order, and a quiet window that isn't empty. */
export function crossCheck(
  next: CrossCheckValues,
): "pace_order" | "quiet_hours_equal" | null {
  if (!(
    next.paceMinMs <= next.defaultPaceMs && next.defaultPaceMs <= next.paceMaxMs
  )) {
    return "pace_order";
  }
  if (next.quietStartHour === next.quietEndHour) return "quiet_hours_equal";
  return null;
}
