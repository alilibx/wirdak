import { toWesternDigits } from "@convex/lib/digits";
import { JUZ } from "@convex/lib/juz";
import { t } from "../i18n/ar";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

type Props = {
  juz: number;
  /** The signed-in account's name, shown so a shared phone never takes under the wrong name. */
  takerName: string | null;
  busy: boolean;
  onConfirm: () => void;
  /** Signs this account out and verifies someone else for the same juz'. */
  onSwitchAccount: () => void;
  onClose: () => void;
};

/** Confirms taking one juz': its number, name and first surah, and whose account takes it. */
export function TakeSheet({
  juz,
  takerName,
  busy,
  onConfirm,
  onSwitchAccount,
  onClose,
}: Props) {
  const info = JUZ.find((j) => j.number === juz);
  const number = toWesternDigits(juz);
  return (
    <Sheet title={t.tile.juz(number)} onClose={onClose}>
      <div className="py-2.5 text-center">
        <div className="text-[4.2rem] leading-none font-bold text-green-deep">
          {number}
        </div>
        {info && (
          <>
            <div className="mt-1 font-display text-[2.4rem]">{info.name}</div>
            <div className="mt-1 text-base text-ink-soft">
              {t.card.startsFrom(info.startSurah)}
            </div>
          </>
        )}
      </div>
      {takerName && (
        <div className="mt-3 text-center">
          <p className="font-medium">{t.take.as(takerName)}</p>
          <button
            type="button"
            disabled={busy}
            onClick={onSwitchAccount}
            className="min-h-14 rounded-ui px-4 font-medium text-green underline underline-offset-4"
          >
            {t.take.notYou(takerName)}
          </button>
        </div>
      )}
      <div className="mt-5 grid gap-3">
        <Button onClick={onConfirm} disabled={busy}>
          {t.take.confirm}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t.take.notNow}
        </Button>
      </div>
    </Sheet>
  );
}
