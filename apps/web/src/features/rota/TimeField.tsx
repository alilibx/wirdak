import { DAY_START } from "@convex/lib/rota";
import { useId } from "react";
import { t } from "../../i18n/ar";
import { formatTime } from "./format";

const STEP = 15;

/** Minutes after midnight from `min` to `max` in quarter hours; `value` is kept even when it falls outside. */
function options(min: number, max: number, value: number): number[] {
  const times: number[] = [];
  for (let at = min; at <= max; at += STEP) times.push(at);
  if (!times.includes(value)) times.push(value);
  return times.sort((a, b) => a - b);
}

/** A time of day to the quarter hour, chosen from a list between `min` and `max` (minutes after midnight). */
export function TimeField({
  label = t.rota.timeLabel,
  value,
  min,
  max,
  dayStart = false,
  disabled,
  onChange,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  /** Also offers 12:00 AM, as when the day starts. */
  dayStart?: boolean;
  disabled?: boolean;
  onChange: (minutes: number) => void;
}) {
  const id = useId();
  return (
    <div className="mt-2">
      <label htmlFor={id} className="block text-base text-ink-soft">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 min-h-14 w-full rounded-ui border-2 border-line bg-white px-4 text-ink disabled:opacity-50"
      >
        {dayStart && value !== DAY_START && (
          <option value={DAY_START}>{t.rota.atDayStart}</option>
        )}
        {options(min, max, value).map((minutes) => (
          <option key={minutes} value={minutes}>
            {dayStart && minutes === DAY_START
              ? t.rota.atDayStart
              : formatTime(minutes)}
          </option>
        ))}
      </select>
    </div>
  );
}
