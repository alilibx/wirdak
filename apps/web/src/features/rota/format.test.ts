import { describe, expect, it } from "vitest";
import { formatIsoDate, formatTime } from "./format";

describe("formatTime", () => {
  it("writes minutes after midnight on a 12-hour clock in Western digits", () => {
    expect(formatTime(480)).toBe("8:00 ص");
    expect(formatTime(1260)).toBe("9:00 م");
    expect(formatTime(960)).toBe("4:00 م");
    expect(formatTime(1140)).toBe("7:00 م");
  });

  it("reads midnight and noon as 12, and keeps the minutes", () => {
    expect(formatTime(0)).toBe("12:00 ص");
    expect(formatTime(720)).toBe("12:00 م");
    expect(formatTime(795)).toBe("1:15 م");
  });
});

describe("formatIsoDate", () => {
  it("writes the weekday, day and month of a YYYY-MM-DD date", () => {
    expect(formatIsoDate("2026-10-30")).toBe("الجمعة 30 أكتوبر");
    expect(formatIsoDate("2027-01-01")).toBe("الجمعة 1 يناير");
  });

  it("does not move with the machine's time zone", () => {
    expect(formatIsoDate("2026-10-29")).toBe("الخميس 29 أكتوبر");
  });
});
