import type { CheerConfig, CheerSetting } from "@convex/lib/cheer";
import { useState } from "react";
import { Button } from "../../components/Button";
import { SwitchRow } from "../../components/SwitchRow";
import { t } from "../../i18n/ar";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const GAPS = [0, 6 * HOUR, DAY, 3 * DAY, 7 * DAY];

const selectClass =
  "mt-1.5 min-h-14 w-full rounded-ui border-2 border-line bg-white px-4 text-ink";

type Props = {
  setting: CheerSetting;
  disabled: boolean;
  /** One more line under the explanation, for what differs by kind of khatma. */
  hint?: string;
  onSave: (cheer: CheerConfig | null) => void;
};

/**
 * A khatma's cheer settings: its own choice, or the defaults until it makes
 * one. `onSave` gets null to go back to them. The form starts over when the
 * server's values change, so an old copy can't be saved over a newer one.
 */
export function CheerField(props: Props) {
  return <CheerForm key={JSON.stringify(props.setting)} {...props} />;
}

function CheerForm({ setting, disabled, hint, onSave }: Props) {
  const current = setting.override ?? setting.defaults;
  const [draft, setDraft] = useState<CheerConfig>(current);
  const changed = JSON.stringify(draft) !== JSON.stringify(current);
  // The admin's default can be any length: it stays selectable as it is.
  const gaps = GAPS.includes(draft.gapMs)
    ? GAPS
    : [...GAPS, draft.gapMs].sort((a, b) => a - b);

  return (
    <>
      <p className="leading-relaxed text-ink-soft">{t.cheer.explain}</p>
      {hint && <p className="mt-2 leading-relaxed text-ink-soft">{hint}</p>}
      <SwitchRow
        label={t.cheer.switchLabel}
        on={draft.on}
        disabled={disabled}
        onChange={(on) => setDraft({ ...draft, on })}
      />
      {draft.on && (
        <>
          <SwitchRow
            label={t.cheer.showNameLabel}
            on={draft.showName}
            disabled={disabled}
            onChange={(showName) => setDraft({ ...draft, showName })}
          />
          <SwitchRow
            label={t.cheer.showJuzLabel}
            on={draft.showJuz}
            disabled={disabled}
            onChange={(showJuz) => setDraft({ ...draft, showJuz })}
          />
          <label htmlFor="cheer-audience" className="mt-4 block font-medium">
            {t.cheer.audienceLabel}
          </label>
          <select
            id="cheer-audience"
            value={draft.everyone ? "everyone" : "reading"}
            disabled={disabled}
            onChange={(event) =>
              setDraft({
                ...draft,
                everyone: event.target.value === "everyone",
              })
            }
            className={selectClass}
          >
            <option value="reading">{t.cheer.audience.reading}</option>
            <option value="everyone">{t.cheer.audience.everyone}</option>
          </select>
          <label htmlFor="cheer-gap" className="mt-4 block font-medium">
            {t.cheer.gapLabel}
          </label>
          <select
            id="cheer-gap"
            value={draft.gapMs}
            disabled={disabled}
            onChange={(event) =>
              setDraft({ ...draft, gapMs: Number(event.target.value) })
            }
            className={selectClass}
          >
            {gaps.map((gapMs) => (
              <option key={gapMs} value={gapMs}>
                {t.cheer.gapEvery(gapMs)}
              </option>
            ))}
          </select>
        </>
      )}
      {setting.override === null && !changed && (
        <p className="mt-3 text-ink-soft">{t.cheer.followsDefault}</p>
      )}
      <div className="mt-4 grid gap-3">
        <Button disabled={disabled || !changed} onClick={() => onSave(draft)}>
          {t.organizer.save}
        </Button>
        {setting.override !== null && (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => onSave(null)}
          >
            {t.cheer.useDefault}
          </Button>
        )}
      </div>
    </>
  );
}
