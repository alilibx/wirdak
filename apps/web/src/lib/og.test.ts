import { describe, expect, it } from "vitest";
import { injectOg, previewTags } from "./og";

const PAGE = "https://wirdak.app/j/x";

describe("previewTags", () => {
  it("shows name, progress, round and the inviter", () => {
    const tags = previewTags(
      {
        name: "ختمة العائلة",
        createdAt: 0,
        done: 18,
        round: 4,
        inviterName: "أحمد",
      },
      PAGE,
    );
    expect(tags.title).toBe("ختمة العائلة · وِردك");
    expect(tags.description).toBe("تمّ 18 من 30 جزءاً · الختمة 4 · دعاك أحمد");
    expect(tags.url).toBe(PAGE);
  });

  it("leaves the inviter out when there is none", () => {
    const tags = previewTags(
      { name: "ن", createdAt: 0, done: 0, round: 1, inviterName: null },
      PAGE,
    );
    expect(tags.description).toBe("تمّ 0 من 30 جزءاً · الختمة 1");
  });

  it("titles an unnamed khatma by its date", () => {
    const createdAt = Date.UTC(2026, 9, 30, 12);
    const tags = previewTags(
      { name: null, createdAt, done: 3, round: 1, inviterName: null },
      PAGE,
    );
    expect(tags.title).toBe("ختمة 30 أكتوبر · وِردك");
  });

  it("dates an unnamed khatma in Dubai, not UTC", () => {
    const lateUtc = Date.UTC(2026, 9, 30, 21, 0); // already 31 Oct in Dubai
    const tags = previewTags(
      { name: null, createdAt: lateUtc, done: 0, round: 1, inviterName: null },
      PAGE,
    );
    expect(tags.title).toBe("ختمة 31 أكتوبر · وِردك");
  });

  it("gives generic tags for null", () => {
    const tags = previewTags(null, PAGE);
    expect(tags.title).toBe("وِردك");
    expect(tags.description).toBe("نختم القرآن معاً، كل واحد يأخذ جزءاً.");
  });

  it("always makes og:image absolute", () => {
    const real = previewTags(
      { name: "ن", createdAt: 0, done: 1, round: 1, inviterName: null },
      PAGE,
    );
    expect(real.image).toBe("https://wirdak.app/og.png");
    expect(previewTags(null, PAGE).image).toBe("https://wirdak.app/og.png");
  });
});

describe("injectOg", () => {
  const shell = `<head><!--og:start--><title>old</title><!--og:end--></head>`;

  it("escapes hostile names", () => {
    const html = injectOg(
      shell,
      previewTags(
        {
          name: `"><script>x</script>&`,
          createdAt: 0,
          done: 0,
          round: 1,
          inviterName: null,
        },
        "u",
      ),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("replaces the block with the full tag set", () => {
    const html = injectOg(shell, previewTags(null, PAGE));
    expect(html).not.toContain("old");
    expect(html).toContain("<title>وِردك</title>");
    expect(html).toContain(`<meta property="og:title" content="وِردك" />`);
    expect(html).toContain(
      `<meta property="og:image" content="https://wirdak.app/og.png" />`,
    );
    expect(html).toContain(`<meta property="og:url" content="${PAGE}" />`);
    expect(html).toContain(`<meta property="og:type" content="website" />`);
    expect(html).toContain(`<meta property="og:locale" content="ar_AR" />`);
    expect(html).toContain(`<meta property="og:description" content=`);
  });

  it("is a no-op without the markers", () => {
    const plain = "<head></head>";
    expect(injectOg(plain, previewTags(null, PAGE))).toBe(plain);
  });

  it("does not misread $ patterns in values", () => {
    const html = injectOg(
      shell,
      previewTags(
        { name: "a$&b", createdAt: 0, done: 0, round: 1, inviterName: null },
        PAGE,
      ),
    );
    expect(html).toContain("a$&amp;b");
  });
});
