import { describe, expect, it } from "vitest";
import {
  addWakingMs,
  instantAt,
  isQuiet,
  localDate,
  localMinutes,
  nextAwake,
  safeTimeZone,
  wakingDayMs,
} from "./wakingTime";

const Q = { startHour: 22, endHour: 7 };
const H = 3_600_000;
const dubai = (iso: string) => Date.parse(`${iso}+04:00`);

describe("wakingTime", () => {
  it("a waking day is 15 hours for 22/7", () => {
    expect(wakingDayMs(Q)).toBe(15 * H);
  });

  it("detects quiet hours at the edges", () => {
    expect(isQuiet(dubai("2026-11-02T21:59:00"), "Asia/Dubai", Q)).toBe(false);
    expect(isQuiet(dubai("2026-11-02T22:00:00"), "Asia/Dubai", Q)).toBe(true);
    expect(isQuiet(dubai("2026-11-03T06:59:00"), "Asia/Dubai", Q)).toBe(true);
    expect(isQuiet(dubai("2026-11-03T07:00:00"), "Asia/Dubai", Q)).toBe(false);
  });

  it("nextAwake returns the instant itself when awake", () => {
    const at = dubai("2026-11-02T12:00:00");
    expect(nextAwake(at, "Asia/Dubai", Q)).toBe(at);
  });

  it("nextAwake moves to 07:00, same day before midnight or next day after", () => {
    expect(nextAwake(dubai("2026-11-02T23:00:00"), "Asia/Dubai", Q)).toBe(
      dubai("2026-11-03T07:00:00"),
    );
    expect(nextAwake(dubai("2026-11-03T03:00:00"), "Asia/Dubai", Q)).toBe(
      dubai("2026-11-03T07:00:00"),
    );
  });

  it("a start inside quiet hours begins at 07:00", () => {
    expect(addWakingMs(dubai("2026-11-02T23:00:00"), H, "Asia/Dubai", Q)).toBe(
      dubai("2026-11-03T08:00:00"),
    );
  });

  it("zero waking time from a quiet instant lands at 07:00", () => {
    expect(addWakingMs(dubai("2026-11-02T23:00:00"), 0, "Asia/Dubai", Q)).toBe(
      dubai("2026-11-03T07:00:00"),
    );
  });

  it("2 days from Monday 10:00 ends Wednesday 10:00", () => {
    expect(
      addWakingMs(
        dubai("2026-11-02T10:00:00"),
        2 * wakingDayMs(Q),
        "Asia/Dubai",
        Q,
      ),
    ).toBe(dubai("2026-11-04T10:00:00"));
  });

  it("London across the March DST change", () => {
    // Sat 28 Mar 2026 21:00 GMT + 2 waking hours -> Sun 29 Mar 08:00 BST (07:00 UTC)
    expect(
      addWakingMs(
        Date.parse("2026-03-28T21:00:00Z"),
        2 * H,
        "Europe/London",
        Q,
      ),
    ).toBe(Date.parse("2026-03-29T07:00:00Z"));
  });

  it("London across the October DST change", () => {
    // Sat 24 Oct 2026 21:00 BST (20:00Z) + 2h -> Sun 25 Oct 08:00 GMT (08:00Z)
    expect(
      addWakingMs(
        Date.parse("2026-10-24T20:00:00Z"),
        2 * H,
        "Europe/London",
        Q,
      ),
    ).toBe(Date.parse("2026-10-25T08:00:00Z"));
  });

  it("Kolkata half-hour offset", () => {
    expect(
      nextAwake(
        Date.parse("2026-11-02T17:00:00Z") /* 22:30 IST */,
        "Asia/Kolkata",
        Q,
      ),
    ).toBe(Date.parse("2026-11-03T01:30:00Z") /* 07:00 IST */);
  });

  it("unknown time zone falls back to Asia/Dubai and never throws", () => {
    expect(safeTimeZone("Not/AZone")).toBe("Asia/Dubai");
    expect(safeTimeZone("Europe/London")).toBe("Europe/London");
    expect(() => addWakingMs(0, H, "Not/AZone", Q)).not.toThrow();
    expect(addWakingMs(dubai("2026-11-02T10:00:00"), H, "Not/AZone", Q)).toBe(
      dubai("2026-11-02T11:00:00"),
    );
  });

  it("local date, minutes and the instant of a wall-clock minute", () => {
    const at = Date.UTC(2026, 9, 29, 20, 30); // 00:30 on 30 Oct in Dubai
    expect(localDate(at, "Asia/Dubai")).toBe("2026-10-30");
    expect(localMinutes(at, "Asia/Dubai")).toBe(30);
    expect(instantAt("2026-10-30", 480, "Asia/Dubai")).toBe(
      Date.UTC(2026, 9, 30, 4, 0),
    );
    expect(instantAt("2027-03-14", 480, "America/New_York")).toBe(
      Date.UTC(2027, 2, 14, 12, 0),
    );
  });
});

it("a midnight the clocks skip lands just after the gap, on its own date", () => {
  for (const [tz, date] of [
    ["America/Havana", "2027-03-14"],
    ["Asia/Beirut", "2027-03-28"],
    ["Africa/Cairo", "2027-04-30"],
  ] as const) {
    const at = instantAt(date, 0, tz);
    expect(localDate(at, tz)).toBe(date);
    expect(localMinutes(at, tz)).toBe(60);
  }
});
