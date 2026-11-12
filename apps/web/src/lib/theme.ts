import { useEffect, useState } from "react";

/**
 * Light or dark. "system" follows the phone's setting and is the default.
 *
 * index.html runs a copy of `resolve` + `paint` inline in <head>, so the first frame already has
 * the right colours. Keep THEME_KEY and the attribute in step with that script.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "wirdak.theme";
const QUERY = "(prefers-color-scheme: dark)";

export function storedChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // Private windows can refuse storage; the system setting still applies.
    return "system";
  }
}

function systemDark(): boolean {
  return typeof matchMedia === "function" && matchMedia(QUERY).matches;
}

export function resolve(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return systemDark() ? "dark" : "light";
  return choice;
}

function paint(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = resolve(choice);
}

/** Keeps a "system" page in step when the phone switches between light and dark. */
export function followSystemTheme(): void {
  if (typeof matchMedia !== "function") return;
  matchMedia(QUERY).addEventListener("change", () => {
    if (storedChoice() === "system") paint("system");
  });
}

/** The saved choice and a setter that applies and remembers it on this device. */
export function useThemeChoice(): [ThemeChoice, (next: ThemeChoice) => void] {
  const [choice, setChoice] = useState(storedChoice);

  // Another tab changed it: follow along.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) return;
      const next = storedChoice();
      paint(next);
      setChoice(next);
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);

  return [
    choice,
    (next) => {
      try {
        if (next === "system") localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, next);
      } catch {
        // Not remembered, but it still applies for this visit.
      }
      paint(next);
      setChoice(next);
    },
  ];
}
