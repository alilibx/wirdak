import { useState } from "react";
import { t } from "../../i18n/ar";

/** One line of the start or the end: its value and a button that opens a native date field. */
export function DateLine({
  label,
  value,
  inputLabel,
  inputValue,
  min,
  onPick,
  clearLabel,
}: {
  label: string;
  value: string;
  inputLabel: string;
  inputValue: string;
  min: string;
  onPick: (date: string | null) => void;
  /** When set, a button that clears the date (the end line goes back to no end). */
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-ui border-2 border-line bg-card px-4 py-2">
      <div className="flex min-h-14 items-center justify-between gap-3">
        <span>
          <span className="block text-base text-ink-soft">{label}</span>
          <span className="font-medium">{value}</span>
        </span>
        <button
          type="button"
          aria-label={`${label}: ${t.rota.change}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="min-h-14 px-3 font-medium text-green underline underline-offset-4"
        >
          {t.rota.change}
        </button>
      </div>
      {open && (
        <div className="pb-2">
          <input
            type="date"
            aria-label={inputLabel}
            min={min}
            value={inputValue}
            onChange={(event) => onPick(event.target.value || null)}
            className="min-h-14 w-full rounded-ui border-2 border-field-line bg-field px-4 text-ink"
          />
          {clearLabel && inputValue !== "" && (
            <button
              type="button"
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
              className="mt-1 min-h-14 font-medium text-green underline underline-offset-4"
            >
              {clearLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
