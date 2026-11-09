import { toWesternDigits } from "@convex/lib/digits";
import { t } from "../i18n/ar";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

type Props = {
  juz: number | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Asks before giving a juz' back; the copy promises nobody will know. */
export function ReleaseSheet({ juz, busy, onConfirm, onClose }: Props) {
  return (
    <Sheet title={t.release.title} onClose={onClose}>
      {juz !== null && (
        <p className="leading-relaxed text-ink-soft">
          {t.release.body(toWesternDigits(juz))}
        </p>
      )}
      <div className="mt-5 grid gap-3">
        <Button onClick={onConfirm} disabled={busy}>
          {t.release.confirm}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t.release.keep}
        </Button>
      </div>
    </Sheet>
  );
}
