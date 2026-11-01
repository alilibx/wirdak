import { toArabicDigits } from "@convex/lib/digits";

export type TimeZoneOption = { value: string; label: string };

function zoneName(zone: string, style: "longGeneric" | "shortOffset"): string {
  return (
    new Intl.DateTimeFormat("ar", { timeZone: zone, timeZoneName: style })
      .formatToParts(Date.now())
      .find((part) => part.type === "timeZoneName")?.value ?? zone
  );
}

/** A zone as an Arabic reader knows it: «توقيت الخليج (غرينتش+٤)». */
export function timeZoneLabel(zone: string): string {
  const offset = toArabicDigits(zoneName(zone, "shortOffset"));
  return `${zoneName(zone, "longGeneric")} (${offset})`;
}

let known: TimeZoneOption[] | null = null;

/** The browser's zones. Hundreds share a name and a clock, so each name appears once. */
function knownZones(): TimeZoneOption[] {
  if (known === null) {
    const zones =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [];
    const byLabel = new Map<string, string>();
    for (const value of zones) {
      const label = timeZoneLabel(value);
      if (!byLabel.has(label)) byLabel.set(label, value);
    }
    known = [...byLabel]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label, "ar"));
  }
  return known;
}

/** The zones to choose from, the current one first. */
export function timeZoneOptions(current: string): TimeZoneOption[] {
  const label = timeZoneLabel(current);
  return [
    { value: current, label },
    ...knownZones().filter((zone) => zone.label !== label),
  ];
}
