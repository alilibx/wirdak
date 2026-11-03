import type { PeopleView as View } from "@convex/lib/rotaOps";
import { useMutation } from "convex/react";
import { Button } from "../../components/Button";
import { t } from "../../i18n/ar";
import { useRotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { useRotaCall } from "./useRotaCall";

const spreadErrors: Record<string, string> = t.rota.spreadErrors;

/** Who `spreadFreeJuz` can give one more juz' to. */
function canTakeMore(p: View["participants"][number], maxSlots: number) {
  return (
    !p.stopped && !p.silenced && p.juz.length > 0 && p.juz.length < maxSlots
  );
}

/**
 * One press that gives every juz' with no reader to the people already in the khatma, as
 * `spreadFreeJuz` does. Nothing when no juz' is free or nobody can read one more.
 * `onStart` runs when the organizer presses it, before the call; `onSpread` gets what it did,
 * for a status line that outlives the button.
 */
export function SpreadFreeJuz({
  inviteCode,
  view,
  onStart,
  onSpread,
}: {
  inviteCode: string;
  view: View;
  onStart?: () => void;
  onSpread?: (message: string) => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const spread = useMutation(backend.spreadFreeJuz);
  const { busy, error, run } = useRotaCall(spreadErrors);
  const hasRoom = view.participants.some((p) => canTakeMore(p, view.maxSlots));
  if (view.freeJuz.length === 0 || !hasRoom) return null;

  return (
    <div>
      <Button
        variant="gold"
        disabled={busy}
        onClick={() => {
          onStart?.();
          void run(async () => {
            const done = await spread(backend.authArgs());
            if ("ok" in done) onSpread?.(t.rota.spreadResult(done.left));
            return done;
          });
        }}
      >
        {t.rota.spread}
      </Button>
      <p className="mt-1.5 text-base text-ink-soft">{t.rota.spreadHint}</p>
      <ErrorLine error={error} />
    </div>
  );
}
