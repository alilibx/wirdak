import { describe, expect, it } from "vitest";
import { inviteMessage, remindMessage } from "./whatsapp";

const url = "https://x/j/a?from=s";

describe("inviteMessage", () => {
  it("is the agreed invitation with the name and link", () => {
    expect(inviteMessage("ختمة العائلة", url)).toBe(
      `السلام عليكم 🤍\nانضم إلينا في «ختمة العائلة». نختم القرآن معاً، وكل واحد يأخذ جزءاً واحداً في كل مرة.\nاضغط هنا: ${url}`,
    );
  });
});

describe("remindMessage", () => {
  it("omits the date when there is no target", () => {
    expect(remindMessage("ختمة العائلة", [14, 19], null, url)).not.toMatch(
      /حتى/,
    );
  });

  it("lists open ajza' in Western digits and includes the date and link", () => {
    const end = Date.UTC(2026, 9, 30, 12);
    const text = remindMessage("ختمة العائلة", [14, 19], end, url);
    expect(text).toContain("14، 19");
    expect(text).toContain("حتى ");
    expect(text).toContain("بقي جزءان");
    expect(text).toContain(url);
    expect(text.replace(url, "")).not.toMatch(/[٠-٩]/);
  });

  it("uses natural Arabic counts", () => {
    expect(remindMessage("ن", [5], null, url)).toContain("بقي جزء واحد");
    expect(remindMessage("ن", [1, 2, 3, 4, 5], null, url)).toContain(
      "بقي 5 أجزاء",
    );
    expect(
      remindMessage("ن", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], null, url),
    ).toContain("بقي 11 جزءاً");
  });
});
