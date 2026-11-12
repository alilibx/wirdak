import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY, resolve, storedChoice, useThemeChoice } from "./theme";

function systemDark(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query === "(prefers-color-scheme: dark)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the system when nothing is saved", () => {
    expect(storedChoice()).toBe("system");
    systemDark(true);
    expect(resolve("system")).toBe("dark");
    systemDark(false);
    expect(resolve("system")).toBe("light");
  });

  it("a saved choice wins over the system", () => {
    systemDark(true);
    localStorage.setItem(THEME_KEY, "light");
    expect(storedChoice()).toBe("light");
    expect(resolve(storedChoice())).toBe("light");
  });

  it("ignores a stored value it doesn't know", () => {
    localStorage.setItem(THEME_KEY, "sepia");
    expect(storedChoice()).toBe("system");
  });

  it("applies and remembers a choice, and forgets it for system", () => {
    systemDark(false);
    const { result } = renderHook(() => useThemeChoice());
    act(() => result.current[1]("dark"));
    expect(result.current[0]).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");

    act(() => result.current[1]("system"));
    expect(result.current[0]).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
});
