import { useMutation } from "convex/react";
import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/Button";
import { t } from "../../i18n/ar";
import { useRotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { fieldClass } from "./fieldClass";
import { useAddCall } from "./useAddCall";

const addErrors: Record<string, string> = t.rota.addErrors;

/**
 * A name and a number, added as a participant. With `juz` the person takes that juz' of the next
 * khatma; without it, the first one nobody reads. With `share` they become the second reader of
 * `juz`, and `explain` says what follows for the name typed, above the add button.
 */
export function AddPersonForm({
  inviteCode,
  juz,
  phoneExample,
  variant = "ghost",
  share = false,
  explain,
  onStart,
  onAdded,
}: {
  inviteCode: string;
  juz?: number;
  /** As the second reader of `juz`. */
  share?: boolean;
  /** What adding this person means, shown once a name is typed. */
  explain?: (name: string) => string;
  /** A local number from the organizer's country, shown in the hint. */
  phoneExample: string | null;
  variant?: "ghost" | "primary";
  /** Called when the organizer presses add, before the call. */
  onStart?: () => void;
  /** Called after the person is added, once the fields are empty. */
  onAdded?: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const addParticipant = useMutation(backend.addParticipant);
  const ids = useId();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const { busy: adding, error, add, question } = useAddCall(addErrors);
  const nameField = useRef<HTMLInputElement>(null);

  function onAdd(event: FormEvent) {
    event.preventDefault();
    onStart?.();
    void add(
      (today) =>
        addParticipant({
          ...backend.authArgs(),
          name: name.trim(),
          phone: phone.trim(),
          ...(juz === undefined ? {} : { juz }),
          ...(share ? { share } : {}),
          ...today,
        }),
      () => {
        setName("");
        setPhone("");
        nameField.current?.focus();
        onAdded?.();
      },
    );
  }

  return (
    <form onSubmit={onAdd} noValidate>
      <label htmlFor={`${ids}-name`} className="block font-medium">
        {t.rota.personName}
      </label>
      <input
        ref={nameField}
        id={`${ids}-name`}
        type="text"
        maxLength={60}
        value={name}
        readOnly={question !== null}
        onChange={(event) => setName(event.target.value)}
        className={fieldClass}
      />
      <label htmlFor={`${ids}-phone`} className="mt-4 block font-medium">
        {t.rota.personPhone}
      </label>
      <input
        id={`${ids}-phone`}
        type="text"
        inputMode="tel"
        autoComplete="off"
        dir="ltr"
        value={phone}
        readOnly={question !== null}
        onChange={(event) => setPhone(event.target.value)}
        aria-describedby={`${ids}-hint`}
        className={`${fieldClass} text-right`}
      />
      <p id={`${ids}-hint`} className="mt-1 text-base text-ink-soft">
        {t.rota.phoneHint(phoneExample)}
      </p>
      {explain && name.trim() !== "" && (
        <p className="mt-4 leading-relaxed">{explain(name.trim())}</p>
      )}
      <ErrorLine error={error} />
      {question ?? (
        <div className="mt-4">
          <Button type="submit" variant={variant} disabled={adding}>
            {adding ? t.rota.adding : t.rota.add}
          </Button>
        </div>
      )}
    </form>
  );
}
