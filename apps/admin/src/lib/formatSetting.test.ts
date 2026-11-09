import type { SettingSpec } from "@convex/lib/settingSpecs";
import { describe, expect, it } from "vitest";
import { formatSetting } from "./formatSetting";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const duration: SettingSpec = {
  kind: "duration",
  min: 0,
  max: 30 * DAY,
  group: "pace",
};

describe("formatSetting", () => {
  it("writes durations in the largest whole unit, never raw milliseconds", () => {
    expect(formatSetting(duration, 3 * DAY)).toBe("3 أيام");
    expect(formatSetting(duration, 10 * MINUTE)).toBe("10 دقائق");
    expect(formatSetting(duration, 45 * SECOND)).toBe("45 ثانية");
    expect(formatSetting(duration, 90 * MINUTE)).toBe("90 دقيقة");
    expect(formatSetting(duration, 0)).toBe("0");
    expect(formatSetting(duration, 3 * DAY)).not.toContain("259200000");
  });

  it("writes a time of day on a twelve-hour clock", () => {
    const time: SettingSpec = { kind: "time", group: "rota" };
    expect(formatSetting(time, 480)).toBe("8:00 ص");
    expect(formatSetting(time, 1260)).toBe("9:00 م");
    expect(formatSetting(time, 0)).toBe("12:00 ص");
    expect(formatSetting(time, 720)).toBe("12:00 م");
    expect(formatSetting(time, 1425)).toBe("11:45 م");
  });

  it("writes hours, switches, empty text and numbers", () => {
    expect(formatSetting({ kind: "hour", group: "notifications" }, 22)).toBe(
      "22:00",
    );
    expect(formatSetting({ kind: "hour", group: "notifications" }, 7)).toBe(
      "07:00",
    );
    expect(formatSetting({ kind: "bool", group: "switches" }, true)).toBe(
      "مفعّل",
    );
    expect(formatSetting({ kind: "bool", group: "switches" }, false)).toBe(
      "متوقف",
    );
    expect(
      formatSetting({ kind: "text", maxLength: 200, group: "switches" }, null),
    ).toBe("—");
    expect(
      formatSetting({ kind: "int", min: 2, max: 500, group: "limits" }, 60),
    ).toBe("60");
    expect(
      formatSetting({ kind: "number", min: 1, max: 5, group: "pace" }, 1.5),
    ).toBe("1.5");
    expect(formatSetting({ kind: "version", group: "switches" }, "0.3.0")).toBe(
      "0.3.0",
    );
  });
});
