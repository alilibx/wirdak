import { expect, test } from "vitest";
import { counted } from "./arabicCount";

const DAYS = { few: "أيام", many: "يوماً", other: "يوم" };

test("a counted noun agrees with its number", () => {
  expect(counted(4, DAYS)).toBe("4 أيام");
  expect(counted(10, DAYS)).toBe("10 أيام");
  expect(counted(11, DAYS)).toBe("11 يوماً");
  expect(counted(99, DAYS)).toBe("99 يوماً");
  expect(counted(100, DAYS)).toBe("100 يوم");
  expect(counted(103, DAYS)).toBe("103 أيام");
  expect(counted(150, DAYS)).toBe("150 يوماً");
  expect(counted(0, DAYS)).toBe("0 يوم");
  expect(counted(1, DAYS)).toBe("1 يوم");
  expect(counted(2, DAYS)).toBe("2 يوم");
});

test("a decimal takes the singular, with the digits it's given", () => {
  expect(counted(29.4, DAYS, "29.4")).toBe("29.4 يوم");
});
