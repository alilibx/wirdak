import { useId } from "react";
import { t } from "../i18n/ar";

/** A real switch: the state is announced, and also written out beside it. */
export function SwitchRow({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const labelId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-ui border-2 border-line bg-card px-4 py-3 text-start font-medium disabled:opacity-50"
    >
      <span id={labelId}>{label}</span>
      <span
        className={`flex items-center gap-2.5 ${on ? "text-green-deep" : "text-ink-soft"}`}
      >
        {on ? t.khatmaSettings.on : t.khatmaSettings.off}
        <span
          aria-hidden="true"
          className={`flex h-7 w-12 items-center rounded-full p-1 transition-colors ${on ? "bg-green-fill" : "bg-line"}`}
        >
          <span
            className={`size-5 rounded-full bg-white transition-[margin] ${on ? "ms-auto" : "me-auto"}`}
          />
        </span>
      </span>
    </button>
  );
}
