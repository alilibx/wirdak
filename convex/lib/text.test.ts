import { describe, expect, it } from "vitest";
import {
  cleanDisplayName,
  cleanKhatmaName,
  localPhoneExample,
  maskPhone,
  normalizeDigits,
  normalizePhone,
  phoneCountry,
  toWesternDigits,
} from "./text";

describe("digits", () => {
  it("writes numbers and Eastern Arabic digits in Western digits", () => {
    expect(toWesternDigits(1430)).toBe("1430");
    expect(toWesternDigits("١٢/٣٠")).toBe("12/30");
    expect(toWesternDigits("٠")).toBe("0");
  });

  it("normalizes Arabic-Indic and Persian digits to ASCII", () => {
    expect(normalizeDigits("٤٨٢١ ۴")).toBe("4821 4");
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹")).toBe(
      "01234567890123456789",
    );
    expect(normalizeDigits("abc 12")).toBe("abc 12");
  });
});

describe("cleanDisplayName", () => {
  it("returns null for empty or whitespace-only input", () => {
    expect(cleanDisplayName("   ")).toBeNull();
    expect(cleanDisplayName("")).toBeNull();
    expect(cleanDisplayName("\u0007\u0000\n")).toBeNull();
  });

  it("trims, collapses spaces, and strips control characters", () => {
    expect(cleanDisplayName("  أبو   علي \u0007")).toBe("أبو علي");
    expect(cleanDisplayName("a\tb\nc")).toBe("a b c");
    expect(cleanDisplayName("a\u0000b")).toBe("ab");
  });

  it("rejects names made only of invisible characters", () => {
    expect(cleanDisplayName("\u200B")).toBeNull();
    expect(cleanDisplayName("\u2800")).toBeNull();
    expect(cleanDisplayName("\u3164")).toBeNull();
    expect(cleanDisplayName(" \u200B\u2800\u3164 \u200E")).toBeNull();
    expect(cleanDisplayName("\u200C\u200D")).toBeNull();
    expect(cleanDisplayName("-- !!")).toBeNull();
  });

  it("keeps ZWNJ and ZWJ inside a name", () => {
    expect(cleanDisplayName("می\u200Cخواهم")).toBe("می\u200Cخواهم");
    expect(cleanDisplayName("a\u200Db")).toBe("a\u200Db");
  });

  it("strips zero-width, bidi marks, and bidi overrides", () => {
    expect(cleanDisplayName("ab\u200Bc")).toBe("abc");
    expect(cleanDisplayName("\u202Eعلي\u202C")).toBe("علي");
    expect(cleanDisplayName("\u2066x\u2069\u200F")).toBe("x");
  });

  it("accepts digit-only and mixed names", () => {
    expect(cleanDisplayName("١٢٣")).toBe("١٢٣");
    expect(cleanDisplayName("😀 علي")).toBe("😀 علي");
  });

  it("cuts to 40 characters", () => {
    expect(cleanDisplayName("ا".repeat(60))).toHaveLength(40);
  });

  it("does not leave a trailing space after cutting", () => {
    const name = cleanDisplayName("ا".repeat(39) + " " + "ب".repeat(10));
    expect(name).toBe("ا".repeat(39));
  });

  it("requires a letter or digit within the first 40 characters", () => {
    expect(cleanDisplayName("-".repeat(45) + "a")).toBeNull();
    expect(cleanDisplayName("-".repeat(39) + "a")).toBe("-".repeat(39) + "a");
  });

  it("does not leave a trailing ZWNJ or ZWJ after cutting", () => {
    expect(cleanDisplayName("ا".repeat(39) + "\u200C" + "ب".repeat(5))).toBe(
      "ا".repeat(39),
    );
    expect(cleanDisplayName("ا".repeat(38) + " \u200D" + "ب")).toBe(
      "ا".repeat(38),
    );
  });
});

describe("maskPhone", () => {
  it("masks UAE and Sudan numbers", () => {
    expect(maskPhone("+971501234567")).toBe("+971 50 ••• 4567");
    expect(maskPhone("+249912345678")).toBe("+249 91 ••• 5678");
  });

  it("handles single-digit country codes", () => {
    expect(maskPhone("+14155552671")).toBe("+1 41 ••• 2671");
  });

  it("falls back to a fully masked form for unparseable input", () => {
    expect(maskPhone("garbage")).not.toMatch(/garbage/);
  });
});

describe("cleanKhatmaName", () => {
  it("returns null for null, empty, or whitespace-only input", () => {
    expect(cleanKhatmaName(null)).toBeNull();
    expect(cleanKhatmaName("")).toBeNull();
    expect(cleanKhatmaName(" \t\n ")).toBeNull();
    expect(cleanKhatmaName("\u0007\u200B\u2800")).toBeNull();
  });

  it("returns null unless a letter or digit remains", () => {
    expect(cleanKhatmaName("\u200C")).toBeNull();
    expect(cleanKhatmaName("\u200C\u200D \u200C")).toBeNull();
    expect(cleanKhatmaName("-- !!")).toBeNull();
    expect(cleanKhatmaName("😀".repeat(3))).toBeNull();
    expect(cleanKhatmaName("ختمة ١")).toBe("ختمة ١");
  });

  it("trims, collapses whitespace, and strips control characters", () => {
    expect(cleanKhatmaName("  ختمة   العائلة \u0007\u202E")).toBe(
      "ختمة العائلة",
    );
    expect(cleanKhatmaName("a\tb\nc")).toBe("a b c");
  });

  it("keeps ZWNJ and ZWJ", () => {
    expect(cleanKhatmaName("می\u200Cخواهم")).toBe("می\u200Cخواهم");
  });

  it("caps at 60 characters and never leaves a trailing space", () => {
    expect(cleanKhatmaName("ب".repeat(100))).toBe("ب".repeat(60));
    expect(cleanKhatmaName(`${"ب".repeat(59)} ${"ج".repeat(10)}`)).toBe(
      "ب".repeat(59),
    );
    expect(
      Array.from(cleanKhatmaName("ب" + "😀".repeat(70)) ?? ""),
    ).toHaveLength(60);
  });
});

describe("normalizePhone", () => {
  it("strips spaces and keeps the plus", () => {
    expect(normalizePhone("+971 50 123 4567")).toBe("+971501234567");
  });

  it("reads Arabic digits and a leading 00", () => {
    expect(normalizePhone("٠٠٩٧١ ٥٠-١٢٣ ٤٥٦٧")).toBe("+971501234567");
    expect(normalizePhone("(+971) 50.123.4567")).toBe("+971501234567");
  });

  it("refuses a number without a country code or one too short or long", () => {
    expect(normalizePhone("0501234567")).toBeNull();
    expect(normalizePhone("+12")).toBeNull();
    expect(normalizePhone("+1234567890123456")).toBeNull();
    expect(normalizePhone("+971abc")).toBeNull();
  });

  it("refuses a country code that starts with 0", () => {
    expect(normalizePhone("+0123456789")).toBeNull();
    expect(normalizePhone("000971501234567")).toBeNull();
  });

  it.each([
    ["EG", "01012345678", "+201012345678"],
    ["EG", "٠١٠١٢٣٤٥٦٧٨", "+201012345678"],
    ["EG", "1012345678", "+201012345678"],
    ["AE", "050 123 4567", "+971501234567"],
    ["AE", "٠٥٠١٢٣٤٥٦٧", "+971501234567"],
    ["SA", "055 123 4567", "+966551234567"],
    ["SA", "٠٥٥١٢٣٤٥٦٧", "+966551234567"],
  ] as const)("reads a %s local number %s", (country, raw, e164) => {
    expect(normalizePhone(raw, country)).toBe(e164);
  });

  it.each([
    ["EG", "+971 50 123 4567", "+971501234567"],
    ["AE", "00201012345678", "+201012345678"],
    ["SA", "+٢٠١٠١٢٣٤٥٦٧٨", "+201012345678"],
    ["EG", "+966 55 123 4567", "+966551234567"],
  ] as const)(
    "keeps the country code a %s organizer types: %s",
    (country, raw, e164) => {
      expect(normalizePhone(raw, country)).toBe(e164);
    },
  );

  it("drops a national 0 kept after the country code", () => {
    expect(normalizePhone("+20 010 1234 5678")).toBe("+201012345678");
    expect(normalizePhone("+9710501234567")).toBe("+971501234567");
  });

  it("refuses a number that is not real for its country", () => {
    expect(normalizePhone("0101234", "EG")).toBeNull();
    expect(normalizePhone("+20 12345")).toBeNull();
    expect(normalizePhone("05012345678901", "AE")).toBeNull();
  });

  it("refuses a landline, so another country's local number isn't misread", () => {
    // `050…` is a UAE mobile, and a Mansoura landline when read as Egyptian.
    expect(normalizePhone("0501234567", "EG")).toBeNull();
    expect(normalizePhone("+20 50 123 4567")).toBeNull();
  });
});

describe("phoneCountry", () => {
  it("names the country of a stored number", () => {
    expect(phoneCountry("+201012345678")).toBe("EG");
    expect(phoneCountry("+971501234567")).toBe("AE");
    expect(phoneCountry("+966551234567")).toBe("SA");
    expect(phoneCountry("not a number")).toBeUndefined();
  });
});

describe("localPhoneExample", () => {
  it("gives a mobile number as people write it at home", () => {
    expect(localPhoneExample("EG")).toBe("010 01234567");
    expect(localPhoneExample("AE")).toBe("050 123 4567");
    expect(localPhoneExample("SA")).toBe("051 234 5678");
    expect(localPhoneExample(undefined)).toBeNull();
  });
});
