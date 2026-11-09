import { DUAS } from "@convex/lib/duas";
import { SCHEDULES } from "@convex/lib/schedule";
import { describe, expect, it } from "vitest";
import { t } from "./ar";

describe("schedule labels", () => {
  it("are exactly the six agreed labels, in order", () => {
    expect(SCHEDULES.map((s) => t.schedules[s])).toEqual([
      "يومية",
      "كل 3 أيام",
      "أسبوعية",
      "كل أسبوعين",
      "شهرية",
      "بدون موعد",
    ]);
  });
});

describe("separators next to numbers", () => {
  // A comma or a space separates a number from the words after it, never a middle dot.
  it("never put a middle dot beside a number", () => {
    expect(t.home.yours("14", "ربما")).toBe("جزؤك: الجزء 14 «ربما»");
    expect(t.celebration.subtitle("ختمة العائلة", "12")).toBe(
      "الحمد لله، ختمة العائلة، الختمة 12",
    );
  });
});

describe("phone hint", () => {
  it("shows the organizer's local example, isolated left-to-right", () => {
    expect(t.rota.phoneHint("010 01234567")).toBe(
      "مثل \u2066010 01234567\u2069، أو مع رمز الدولة إن كان من بلد آخر",
    );
  });

  it("asks for the country code when the organizer's country is unknown", () => {
    expect(t.rota.phoneHint(null)).toBe("مع رمز الدولة، مثل \u200E+971");
  });
});

describe("celebration duas", () => {
  it("are the same ones the WhatsApp dua text sends", () => {
    expect(t.celebration.duas).toBe(DUAS);
  });
});

describe("the rota join link's share message", () => {
  it("says how often the khatma is read", () => {
    const link = "https://wa.me/971500000000?text=x";
    const said = (days: "daily" | "weekly" | "biweekly" | "monthly") =>
      t.rota.shareMessage("ختمة العائلة", link, days);
    expect(said("daily")).toBe(
      `السلام عليكم، بدأنا ختمة العائلة، ختمة يومية بالتناوب. اضغطوا الرابط وأرسلوا الرسالة كما هي: ${link}`,
    );
    expect(said("weekly")).toContain("، ختمة أسبوعية بالتناوب.");
    expect(said("biweekly")).toContain("، ختمة كل أسبوعين بالتناوب.");
    expect(said("monthly")).toContain("، ختمة شهرية بالتناوب.");
  });
});

describe("where a rota reader goes next", () => {
  it("is one juz' up in the next khatma, and 30 goes back to 1, for one reader or two", () => {
    expect(t.rota.walk(5, 2)).toBe(
      "يقرأ الجزء 5 في الختمة 2، ثم 6 في الختمة 3، وهكذا.",
    );
    expect(t.rota.walk(30, 30)).toBe(
      "يقرأ الجزء 30 في الختمة 30، ثم 1 في الختمة 1، وهكذا.",
    );
    expect(t.rota.shareExplain("سعد", "ليلى", 30, 29)).toContain(
      "الجزء 30 في الختمة 29، ثم الجزء 1 في الختمة 30.",
    );
  });
});
