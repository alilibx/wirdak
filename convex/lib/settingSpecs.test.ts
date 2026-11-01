import { expect, test } from "vitest";
import { DEFAULT_GRACE } from "./grace";
import { SETTING_DEFAULTS, type SettingKey } from "./settings";
import { crossCheck, SETTING_SPECS, validateSetting } from "./settingSpecs";

const DAY = 86_400_000;

test("integers are checked for type and range", () => {
  expect(validateSetting("maxMembers", 1)).toBe("out_of_range");
  expect(validateSetting("maxMembers", 2)).toBeNull();
  expect(validateSetting("maxMembers", 500)).toBeNull();
  expect(validateSetting("maxMembers", 501)).toBe("out_of_range");
  expect(validateSetting("maxMembers", 2.5)).toBe("wrong_type");
  expect(validateSetting("maxMembers", "60")).toBe("wrong_type");
  expect(validateSetting("maxMembers", Number.NaN)).toBe("wrong_type");
});

test("durations, hours, fractions and switches", () => {
  expect(validateSetting("undoWindowMs", 2_999)).toBe("out_of_range");
  expect(validateSetting("undoWindowMs", 3_000)).toBeNull();
  expect(validateSetting("quietStartHour", 24)).toBe("out_of_range");
  expect(validateSetting("quietStartHour", 0)).toBeNull();
  expect(validateSetting("quietStartHour", 7.5)).toBe("wrong_type");
  expect(validateSetting("graceNoticeFraction", 0.8)).toBe("out_of_range");
  expect(validateSetting("reminderPaceMultiple", 1.25)).toBeNull();
  expect(validateSetting("maintenanceMode", "yes")).toBe("wrong_type");
  expect(validateSetting("maintenanceMode", true)).toBeNull();
});

test("texts are capped at 200 characters and may be null", () => {
  expect(validateSetting("announcement", "x".repeat(201))).toBe("too_long");
  expect(validateSetting("announcement", "x".repeat(200))).toBeNull();
  expect(validateSetting("announcement", null)).toBeNull();
  expect(validateSetting("maintenanceMessage", 5)).toBe("wrong_type");
});

test("versions must be x.y.z", () => {
  expect(validateSetting("minClientVersion", "1.2")).toBe("bad_version");
  expect(validateSetting("minClientVersion", "v1.2.3")).toBe("bad_version");
  expect(validateSetting("minClientVersion", "0.3.0")).toBeNull();
  expect(validateSetting("minClientVersion", null)).toBeNull();
});

test("grace defaults need every schedule, each a valid grace", () => {
  expect(
    validateSetting("graceDefaults", {
      ...DEFAULT_GRACE,
      daily: { value: 10, unit: "minutes" },
    }),
  ).toBe("bad_grace");
  const missing: Partial<typeof DEFAULT_GRACE> = { ...DEFAULT_GRACE };
  delete missing.daily;
  expect(validateSetting("graceDefaults", missing)).toBe("bad_grace");
  expect(validateSetting("graceDefaults", { ...DEFAULT_GRACE, extra: 1 })).toBe(
    "bad_grace",
  );
  expect(
    validateSetting("graceDefaults", {
      ...DEFAULT_GRACE,
      daily: { value: 8, unit: "hours" },
    }),
  ).toBeNull();
});

test("pace has to stay in order, and quiet hours can't be empty", () => {
  const ok = {
    defaultPaceMs: 3 * DAY,
    paceMinMs: DAY,
    paceMaxMs: 7 * DAY,
    quietStartHour: 22,
    quietEndHour: 7,
  };
  expect(crossCheck(ok)).toBeNull();
  expect(crossCheck({ ...ok, paceMinMs: 4 * DAY })).toBe("pace_order");
  expect(crossCheck({ ...ok, paceMaxMs: 2 * DAY })).toBe("pace_order");
  expect(crossCheck({ ...ok, quietEndHour: 22 })).toBe("quiet_hours_equal");
});

test("every default passes its own spec", () => {
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    expect([key, validateSetting(key, SETTING_DEFAULTS[key])]).toEqual([
      key,
      null,
    ]);
    expect(SETTING_SPECS[key]).toBeDefined();
  }
});

test("help settings have their own ranges", () => {
  expect(validateSetting("helpAutoCloseMs", 12 * 3_600_000)).toBe(
    "out_of_range",
  );
  expect(validateSetting("helpRequestsPerIpPerDay", 10)).toBeNull();
  expect(SETTING_SPECS.helpMessagesPerHour.group).toBe("help");
});

test("summary hour and milestone spacing", () => {
  expect(validateSetting("milestonePushSpacingMs", 5_000)).toBe("out_of_range");
  expect(validateSetting("summaryHour", 8)).toBeNull();
});

test("every rota setting has a spec in the rota group", () => {
  const keys = (Object.keys(SETTING_DEFAULTS) as SettingKey[]).filter((k) =>
    /^rota[A-Z]/.test(k),
  );
  expect(keys).toHaveLength(14);
  for (const key of keys) expect(SETTING_SPECS[key].group).toBe("rota");
});

test("a time is minutes after midnight in steps of 15", () => {
  expect(validateSetting("rotaDayAt", 480)).toBeNull();
  expect(validateSetting("rotaDayAt", 0)).toBeNull();
  expect(validateSetting("rotaDayAt", 1425)).toBeNull();
  expect(validateSetting("rotaDayAt", 485)).toBe("out_of_range");
  expect(validateSetting("rotaDayAt", 1440)).toBe("out_of_range");
  expect(validateSetting("rotaDayAt", -15)).toBe("out_of_range");
  expect(validateSetting("rotaDayAt", 7.5)).toBe("wrong_type");
  expect(validateSetting("rotaDayAt", "480")).toBe("wrong_type");
});

test("rota limits have their own ranges", () => {
  expect(validateSetting("rotaMaxActivePerOrganizer", 0)).toBe("out_of_range");
  expect(validateSetting("rotaMaxActivePerOrganizer", 2)).toBeNull();
  expect(validateSetting("rotaMaxSlotsPerPerson", 31)).toBe("out_of_range");
  expect(validateSetting("rotaSilenceStopDays", 1)).toBe("out_of_range");
  expect(validateSetting("rotaSilenceNoticeDays", 3)).toBeNull();
});
