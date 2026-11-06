import { describe, expect, it } from "vitest";
import { buttonClass } from "./Button";

describe("buttonClass", () => {
  it("lets a passed colour replace the variant's own", () => {
    const classes = buttonClass(
      "ghost",
      "border-[#8A2B1E] text-[#8A2B1E]",
    ).split(" ");
    expect(classes).toContain("text-[#8A2B1E]");
    expect(classes).toContain("border-[#8A2B1E]");
    expect(classes).not.toContain("text-ink-soft");
    expect(classes).not.toContain("border-line");
  });

  it("keeps the variant's classes that nothing replaces", () => {
    const classes = buttonClass("ghost", "text-green").split(" ");
    expect(classes).toContain("text-green");
    expect(classes).toContain("border-2");
    expect(classes).toContain("border-line");
    expect(classes).toContain("text-base");
  });
});
