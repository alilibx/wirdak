import { describe, expect, it } from "vitest";
import { toWesternDigits } from "@convex/lib/digits";
import { t } from "../i18n/ar";
import { deviceLabel, formatDate } from "./format";

describe("formatDate", () => {
  it("formats a Gregorian date in Arabic", () => {
    expect(formatDate(Date.UTC(2026, 9, 30, 12))).toContain("أكتوبر");
  });

  it("always uses Western digits", () => {
    expect(formatDate(Date.UTC(2026, 9, 30, 12))).toMatch(/30/);
    expect(formatDate(Date.UTC(2026, 9, 30, 12))).not.toMatch(/[٠-٩]/);
  });
});

describe("@convex alias", () => {
  it("resolves shared convex helpers", () => {
    expect(toWesternDigits(12)).toBe("12");
  });
});

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.56 Mobile/15E148 Safari/605.1.15",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  androidFirefox:
    "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  androidEdge:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.2849.48",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.56",
  windowsFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  linuxChrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  linuxFirefox:
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
};

describe("deviceLabel", () => {
  it.each([
    ["iphoneSafari", "iPhone · Safari"],
    ["iphoneChrome", "iPhone · Chrome"],
    ["iphoneFirefox", "iPhone · Firefox"],
    ["iphoneEdge", "iPhone · Edge"],
    ["ipadSafari", "iPad · Safari"],
    ["androidChrome", "Android · Chrome"],
    ["androidSamsung", "Android · Samsung Internet"],
    ["androidFirefox", "Android · Firefox"],
    ["androidEdge", "Android · Edge"],
    ["macSafari", "Mac · Safari"],
    ["macChrome", "Mac · Chrome"],
    ["windowsEdge", "Windows · Edge"],
    ["windowsFirefox", "Windows · Firefox"],
    ["linuxChrome", "Linux · Chrome"],
    ["linuxFirefox", "Linux · Firefox"],
  ] as const)("%s -> %s", (name, label) => {
    expect(deviceLabel(UA[name])).toBe(label);
  });

  it("falls back to generic words for unknown parts", () => {
    expect(deviceLabel("")).toBe(
      `${t.device.unknownDevice} · ${t.device.unknownBrowser}`,
    );
    expect(deviceLabel("curl/8.0")).toBe(
      `${t.device.unknownDevice} · ${t.device.unknownBrowser}`,
    );
    expect(
      deviceLabel(
        UA.iphoneSafari.replace("Safari/604.1", "").replace("Version/18.0", ""),
      ),
    ).toBe(`iPhone · ${t.device.unknownBrowser}`);
  });
});
