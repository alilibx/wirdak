import { useId, useState } from "react";
import { Button } from "../../components/Button";
import { t } from "../../i18n/ar";
import { useRotaCall, type Outcome } from "./useRotaCall";

/** The organizer's answer, passed on with the add. */
type Today = { readsToday?: boolean };

function TodayQuestion({
  onAnswer,
  onCancel,
}: {
  onAnswer: (readsToday: boolean) => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="mt-4 rounded-ui border-2 border-gold bg-[#FBF1D9] p-4"
    >
      <p id={id} className="font-medium">
        {t.rota.todayQuestion}
      </p>
      <p className="mt-1 text-base text-ink-soft">{t.rota.todayHint}</p>
      <div className="mt-3 grid gap-3">
        <Button onClick={() => onAnswer(true)}>{t.rota.readsToday}</Button>
        <Button variant="ghost" onClick={() => onAnswer(false)}>
          {t.rota.readsNextDay}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t.rota.cancel}
        </Button>
      </div>
    </div>
  );
}

/**
 * `useRotaCall` for adding someone. When the server answers `ask_today`, late in
 * the day, nobody is added yet: `question` holds the organizer's choice, and
 * `add` repeats the same call with their answer. `onDone` runs once they're added.
 */
export function useAddCall(errors: Record<string, string>) {
  const { busy, error, run } = useRotaCall(errors);
  const [answer, setAnswer] = useState<((readsToday: boolean) => void) | null>(
    null,
  );

  function add(
    call: (today: Today) => Promise<Outcome>,
    onDone?: () => void,
    today: Today = {},
  ): Promise<void> {
    let asked = false;
    return run(
      async () => {
        const result = await call(today);
        if (!result || !("error" in result) || result.error !== "ask_today") {
          return result;
        }
        asked = true;
        setAnswer(() => (readsToday: boolean) => {
          setAnswer(null);
          void add(call, onDone, { readsToday });
        });
      },
      () => {
        if (!asked) onDone?.();
      },
    );
  }

  const question = answer && (
    <TodayQuestion onAnswer={answer} onCancel={() => setAnswer(null)} />
  );
  return { busy, error, add, run, question };
}
