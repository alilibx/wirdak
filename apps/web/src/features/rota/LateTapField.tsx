import { useId } from "react";
import { t } from "../../i18n/ar";

const HOUR_MS = 3_600_000;
const MAX_HOURS = 12;

/** How long after midnight a late «أتممت» counts, chosen in whole hours; `value` is kept even off the hour. */
export function LateTapField({
  value,
  disabled,
  onChange,
}: {
  /** Milliseconds. */
  value: number;
  disabled?: boolean;
  onChange: (ms: number) => void;
}) {
  const id = useId();
  const hours = Array.from({ length: MAX_HOURS + 1 }, (_, h) => h * HOUR_MS);
  const options = hours.includes(value)
    ? hours
    : [...hours, value].sort((a, b) => a - b);
  return (
    <div className="mt-2">
      <label htmlFor={id} className="block text-base text-ink-soft">
        {t.rota.lateTapLabel}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 min-h-14 w-full rounded-ui border-2 border-line bg-white px-4 text-ink disabled:opacity-50"
      >
        {options.map((ms) => (
          <option key={ms} value={ms}>
            {t.rota.lateTapHours(Math.round(ms / HOUR_MS))}
          </option>
        ))}
      </select>
    </div>
  );
}
