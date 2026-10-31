import { useRef, useState } from "react";
import { t } from "../../i18n/ar";
import { thrownMessage } from "./errors";

/** What a rota call answers: `{ ok }`, a refusal as `{ error }`, or nothing. */
export type Outcome = { ok: true } | { error: string } | void;

/**
 * Runs one call at a time for a screen of the rota page. A refusal (`{ error }`, mapped through
 * `errors`) or a thrown failure becomes `error`; a success runs `onDone`. A second `run` while
 * one is in flight does nothing.
 */
export function useRotaCall(errors: Record<string, string>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function run(
    call: () => Promise<Outcome>,
    onDone?: () => void,
  ): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await call();
      if (result && "error" in result) {
        setError(errors[result.error] ?? t.errors.generic);
      } else {
        onDone?.();
      }
    } catch (caught) {
      setError(thrownMessage(caught, errors));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return { busy, error, run };
}
