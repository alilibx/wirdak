import { toWesternDigits } from "@convex/lib/digits";
import type { ReadingDays } from "@convex/lib/rota";
import { useId } from "react";
import { t } from "../../i18n/ar";

type Kind = ReadingDays["kind"];

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "daily", label: t.rota.daily },
  { kind: "weekly", label: t.rota.weekly },
  { kind: "monthly", label: t.rota.monthly },
];

/** Saturday first, Friday last (weekday 0 is Sunday). */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const DEFAULTS: Record<Kind, ReadingDays> = {
  daily: { kind: "daily" },
  weekly: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
  monthly: { kind: "monthly", days: [1] },
};

/** Adds or removes `n`, never emptying the list: at least one day always stays chosen. */
function toggled(list: number[], n: number): number[] {
  if (!list.includes(n)) return [...list, n].sort((a, b) => a - b);
  return list.length === 1 ? list : list.filter((x) => x !== n);
}

function Chip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-12 min-w-12 rounded-ui border-2 px-3 font-medium ${
        on
          ? "border-green-fill bg-green-fill text-on-green"
          : "border-field-line bg-field text-ink"
      }`}
    >
      {label}
    </button>
  );
}

/** The reading days question: every day, every week, or every month, the days opening inside the chosen card. */
export function ReadingDaysField({
  value,
  onChange,
}: {
  value: ReadingDays;
  onChange: (next: ReadingDays) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="text-xl font-semibold">{t.rota.whenQuestion}</legend>
      <div className="mt-2 grid gap-2.5">
        {KINDS.map(({ kind, label }) => {
          const chosen = value.kind === kind;
          return (
            <div
              key={kind}
              className={`rounded-ui border-2 px-4 py-3 ${
                chosen ? "border-green bg-chosen" : "border-line bg-card"
              }`}
            >
              <label className="flex min-h-14 cursor-pointer items-center gap-3 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
                <input
                  type="radio"
                  name={name}
                  checked={chosen}
                  onChange={() => onChange(DEFAULTS[kind])}
                  className="size-5 shrink-0 accent-green"
                />
                <span className="font-medium">{label}</span>
              </label>
              {chosen && value.kind === "weekly" && (
                <div className="pb-2">
                  <div
                    role="group"
                    aria-label={t.rota.onDays}
                    className="flex flex-wrap gap-2"
                  >
                    {WEEK_ORDER.map((weekday) => (
                      <Chip
                        key={weekday}
                        label={t.rota.weekdays[weekday] ?? ""}
                        on={value.weekdays.includes(weekday)}
                        onClick={() =>
                          onChange({
                            ...value,
                            weekdays: toggled(value.weekdays, weekday),
                          })
                        }
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip
                      label={t.rota.everyWeek}
                      on={value.everyWeeks === 1}
                      onClick={() => onChange({ ...value, everyWeeks: 1 })}
                    />
                    <Chip
                      label={t.rota.everyTwoWeeks}
                      on={value.everyWeeks === 2}
                      onClick={() => onChange({ ...value, everyWeeks: 2 })}
                    />
                  </div>
                </div>
              )}
              {chosen && value.kind === "monthly" && (
                <div
                  role="group"
                  aria-label={t.rota.ofMonth}
                  className="flex flex-wrap gap-2 pb-2"
                >
                  {MONTH_DAYS.map((day) => (
                    <Chip
                      key={day}
                      label={toWesternDigits(day)}
                      on={value.days.includes(day)}
                      onClick={() =>
                        onChange({ ...value, days: toggled(value.days, day) })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
