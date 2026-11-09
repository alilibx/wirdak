import { PageHeader } from "../components/PageHeader";
import { Input } from "@/components/ui/input";
import { api } from "@convex/_generated/api";
import { normalizeDigits, toWesternDigits } from "@convex/lib/digits";
import type { SettingGroup } from "@convex/lib/settingSpecs";
import { useQuery } from "convex/react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import { SettingList, type SettingRow } from "../components/SettingField";
import { t } from "../i18n/ar";
import { useAdminToken } from "../lib/adminSession";
import { SETTING_LAYOUT } from "../lib/settingLayout";

const ORDER: SettingGroup[] = [
  "switches",
  "pace",
  "notifications",
  "help",
  "limits",
  "sessions",
  "rota",
];

/** A group, or every setting that differs from its default. */
type Tab = SettingGroup | "changed";

const TABS: Tab[] = [...ORDER, "changed"];

/** The `?group=` value; anything unknown is the first group. */
export function parseTab(value: string | null): Tab {
  return TABS.find((tab) => tab === value) ?? ORDER[0]!;
}

/** Lowercased, Arabic digits made Latin, and alef/ya/ta marbuta forms folded. */
function fold(text: string): string {
  return normalizeDigits(text)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

function matches(row: SettingRow, words: string[]): boolean {
  const help = t.settings.help[row.key];
  const haystack = fold(
    `${t.settings.labels[row.key]} ${help.what} ${help.why} ${row.key}`,
  );
  return words.every((word) => haystack.includes(word));
}

/** The group's settings in its sections, in layout order, keeping only `keep`. */
function sectionsOf(
  group: SettingGroup,
  byKey: Map<string, SettingRow>,
  keep: (row: SettingRow) => boolean,
) {
  return SETTING_LAYOUT[group]
    .map(({ section, keys }) => ({
      section,
      rows: keys
        .map((key) => byKey.get(key))
        .filter((row): row is SettingRow => row !== undefined && keep(row)),
    }))
    .filter(({ rows }) => rows.length > 0);
}

/**
 * Every setting, one group at a time (spec 9.1). Tabs pick the group, a
 * "changed" tab lists what differs from the defaults, and search looks
 * through every group at once.
 */
export function SettingsPage() {
  const adminToken = useAdminToken() ?? "";
  const rows = useQuery(api.adminSettings.list, { adminToken });
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("group"));
  const query = params.get("q") ?? "";
  const idPrefix = useId();
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const loaded = rows !== undefined;
  // Rows the "changed" tab has listed. They stay until the tab changes, so
  // resetting one doesn't pull it (and its open sheet) out from under the admin.
  const listed = useRef<{ tab: Tab; keys: Set<string> }>({
    tab,
    keys: new Set(),
  });
  if (listed.current.tab !== tab) listed.current = { tab, keys: new Set() };

  // The tab row scrolls sideways on a phone; keep the chosen tab on screen.
  useEffect(() => {
    refs.current[tab]?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [tab, loaded]);

  if (rows === undefined) return null;
  const byKey = new Map<string, SettingRow>(rows.map((row) => [row.key, row]));
  const changedCount = rows.filter((row) => !row.isDefault).length;
  const words = fold(query).split(/\s+/).filter(Boolean);
  const searching = words.length > 0;

  const update = (next: { group?: Tab; q?: string }) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next.group !== undefined) out.set("group", next.group);
        if (next.q !== undefined) {
          if (next.q === "") out.delete("q");
          else out.set("q", next.q);
        }
        return out;
      },
      { replace: true },
    );

  // A new tab starts at its top, not wherever the last one was scrolled to.
  const show = (next: Tab) => {
    update({ group: next, q: "" });
    document.scrollingElement?.scrollTo?.({ top: 0 });
  };

  const select = (next: Tab) => {
    show(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const at = TABS.indexOf(tab);
    // In Arabic (dir="rtl") the next tab sits on the ArrowLeft side.
    const forward =
      document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = forward === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    const target =
      event.key === forward
        ? TABS[(at + 1) % TABS.length]
        : event.key === back
          ? TABS[(at + TABS.length - 1) % TABS.length]
          : event.key === "Home"
            ? TABS[0]
            : event.key === "End"
              ? TABS[TABS.length - 1]
              : undefined;
    if (!target) return;
    event.preventDefault();
    select(target);
  };

  // Searching and the "changed" tab span every group; a group tab shows its own.
  const groups: SettingGroup[] = searching || tab === "changed" ? ORDER : [tab];
  const keep = searching
    ? (row: SettingRow) => matches(row, words)
    : tab === "changed"
      ? (row: SettingRow) => {
          if (!row.isDefault) listed.current.keys.add(row.key);
          return listed.current.keys.has(row.key);
        }
      : () => true;
  const shown = groups
    .map((group) => ({ group, sections: sectionsOf(group, byKey, keep) }))
    .filter(({ sections }) => sections.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.settings.title} />
      <div className="sticky top-14 z-10 -mx-4 flex flex-col gap-2 bg-background px-4 pt-1 pb-2 md:-mx-5 md:px-5">
        <label className="sr-only" htmlFor={`${idPrefix}-search`}>
          {t.settings.searchLabel}
        </label>
        <Input
          id={`${idPrefix}-search`}
          type="search"
          value={query}
          placeholder={t.settings.searchPlaceholder}
          onChange={(e) => update({ q: e.target.value })}
          className="w-full rounded-lg border bg-card px-4 py-2.5"
        />
        <div
          role="tablist"
          aria-label={t.settings.tabsLabel}
          onKeyDown={onKeyDown}
          className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]"
        >
          {TABS.map((name) => {
            const selected = !searching && name === tab;
            const count =
              name === "changed"
                ? changedCount
                : rows.filter((row) => row.spec.group === name).length;
            return (
              <button
                key={name}
                ref={(el) => {
                  refs.current[name] = el;
                }}
                type="button"
                role="tab"
                id={`${idPrefix}-tab-${name}`}
                aria-selected={selected}
                aria-controls={`${idPrefix}-panel`}
                tabIndex={name === tab ? 0 : -1}
                onClick={() => show(name)}
                className={`shrink-0 rounded-md border px-2.5 py-1 text-[13px] whitespace-nowrap ${
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-foreground hover:bg-accent"
                }`}
              >
                {name === "changed"
                  ? t.settings.changedTab
                  : t.settings.groups[name]}{" "}
                <span
                  className={selected ? "opacity-70" : "text-muted-foreground"}
                >
                  {toWesternDigits(count)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={searching ? undefined : `${idPrefix}-tab-${tab}`}
        className="flex flex-col gap-5"
      >
        {!searching && tab !== "changed" && (
          <p className="text-sm text-muted-foreground">
            {t.settings.groupIntros[tab]}
          </p>
        )}
        {shown.length === 0 && (
          <p className="py-6 text-center text-muted-foreground">
            {searching ? t.settings.noResults : t.settings.noChanges}
          </p>
        )}
        {shown.map(({ group, sections }) => (
          <section key={group} className="flex flex-col gap-3">
            {groups.length > 1 && (
              <h2 className="text-lg font-semibold">
                {t.settings.groups[group]}
              </h2>
            )}
            {sections.map(({ section, rows: sectionRows }) => (
              <div key={section} className="flex flex-col gap-1.5">
                {SETTING_LAYOUT[group].length > 1 && (
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {t.settings.sections[section]}
                  </h3>
                )}
                <SettingList rows={sectionRows} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
