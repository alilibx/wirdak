import {
  DEFAULT_GRACE,
  isValidGrace,
  type Grace,
  type GraceUnit,
} from "@convex/lib/grace";
import { normalizeDigits } from "@convex/lib/digits";
import type { Schedule } from "@convex/lib/schedule";
import { useId, useState } from "react";
import { t } from "../i18n/ar";
import { Button } from "./Button";

const UNITS: GraceUnit[] = ["minutes", "hours", "days"];

/** The amount with its unit, agreeing in Arabic (see `t.grace.amount`). */
export function formatGrace(g: Grace): string {
  return t.grace.amount[g.unit](g.value);
}

/** The typed number, or 0 when it is empty or not a plain number (0 is never a valid grace). */
function parseAmount(text: string): number {
  const digits = normalizeDigits(text.trim());
  return /^\d+$/.test(digits) ? Number(digits) : 0;
}

type Props = {
  /** The edited grace, or `null` while it still follows the schedule's default. */
  value: Grace | null;
  schedule: Schedule;
  onChange: (grace: Grace) => void;
};

/**
 * The grace period of one juz', as one quiet line that opens into
 * a number and a unit. It reports every edit, valid or not, so its owner can refuse to submit
 * an invalid one; the error shows here for as long as the value is out of range.
 */
export function GraceField({ value, schedule, onChange }: Props) {
  const shown = value ?? DEFAULT_GRACE[schedule];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(shown.value));
  // While the grace still follows the default, a new default (another schedule) replaces the text.
  const [seen, setSeen] = useState(shown);
  if (
    value === null &&
    (seen.value !== shown.value || seen.unit !== shown.unit)
  ) {
    setSeen(shown);
    setText(String(shown.value));
  }
  const errorId = useId();
  const invalid = !isValidGrace(shown);

  if (!open && !invalid) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(String(shown.value));
          setOpen(true);
        }}
        className="mt-3 inline-flex min-h-14 items-center text-base font-medium text-green underline underline-offset-4"
      >
        {`${t.grace.summary(formatGrace(shown))} · ${t.grace.change}`}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={t.grace.label}
      className="mt-3 rounded-ui border-2 border-line bg-card p-4"
    >
      <div className="font-medium">{t.grace.label}</div>
      <div className="mt-2 flex flex-wrap gap-2.5">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={t.grace.amountLabel}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChange({
              value: parseAmount(event.target.value),
              unit: shown.unit,
            });
          }}
          className="min-h-14 w-24 rounded-ui border-2 border-field-line bg-field px-4 text-center text-ink"
        />
        <div
          role="group"
          aria-label={t.grace.unitsLabel}
          className="flex flex-1 gap-2"
        >
          {UNITS.map((unit) => (
            <button
              key={unit}
              type="button"
              aria-pressed={shown.unit === unit}
              onClick={() => {
                const amount = parseAmount(text);
                // Re-tapping the unit already shown changes nothing, so it must not count as an edit.
                if (unit === shown.unit && amount === shown.value) return;
                onChange({ value: amount, unit });
              }}
              className="min-h-14 flex-1 rounded-ui border-2 border-line bg-card px-3 font-medium aria-pressed:border-green aria-pressed:bg-chosen aria-pressed:text-green-deep"
            >
              {t.grace.units[unit]}
            </button>
          ))}
        </div>
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="mt-3 font-medium text-danger">
          {t.grace.range}
        </p>
      )}
      <div className="mt-3">
        <Button
          variant="ghost"
          disabled={invalid}
          onClick={() => setOpen(false)}
        >
          {t.grace.done}
        </Button>
      </div>
    </div>
  );
}
