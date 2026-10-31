import { describe, expect, it } from "vitest";
import { foldText } from "./searchFold";

describe("foldText", () => {
  it("treats the spellings of a name as one", () => {
    expect(foldText("أحمد")).toBe(foldText("احمد"));
    expect(foldText("إيمان")).toBe(foldText("ايمان"));
    expect(foldText("آمنة")).toBe(foldText("امنه"));
    expect(foldText("هدى")).toBe(foldText("هدي"));
    expect(foldText("مؤمن")).toBe(foldText("مومن"));
    expect(foldText("فائزة")).toBe(foldText("فايزه"));
  });

  it("drops marks and the stretching line", () => {
    expect(foldText("مُحَمَّد")).toBe("محمد");
    expect(foldText("الرحمٰن")).toBe("الرحمن");
    expect(foldText("محمـــد")).toBe("محمد");
  });

  it("writes Arabic and Persian digits as Latin ones", () => {
    expect(foldText("ختمة ٢٠٢٦")).toBe("ختمه 2026");
    expect(foldText("۱۲")).toBe("12");
  });

  it("lower-cases Latin letters and trims the ends", () => {
    expect(foldText("  Sara ")).toBe("sara");
  });
});
