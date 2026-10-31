import { describe, expect, it } from "vitest";
import { timeZoneLabel, timeZoneOptions } from "./timeZones";

describe("timeZoneLabel", () => {
  it("names a zone in Arabic, with its offset in Arabic digits", () => {
    expect(timeZoneLabel("Asia/Dubai")).toBe("توقيت الخليج (غرينتش+٤)");
  });
});

describe("timeZoneOptions", () => {
  it("puts the current zone first, once", () => {
    const options = timeZoneOptions("Asia/Dubai");
    expect(options[0]).toEqual({
      value: "Asia/Dubai",
      label: timeZoneLabel("Asia/Dubai"),
    });
    expect(options.filter((o) => o.value === "Asia/Dubai")).toHaveLength(1);
  });

  it("offers each Arabic name once, none of it in Latin letters", () => {
    const options = timeZoneOptions("Asia/Dubai");
    expect(options.length).toBeGreaterThan(50);
    expect(new Set(options.map((o) => o.label)).size).toBe(options.length);
    expect(options.filter((o) => /[A-Za-z]{3}/.test(o.label))).toEqual([]);
  });

  it("keeps a current zone that shares its name with another", () => {
    const options = timeZoneOptions("Asia/Muscat");
    expect(options[0]?.value).toBe("Asia/Muscat");
    expect(options.some((o) => o.value === "Asia/Dubai")).toBe(false);
  });
});
