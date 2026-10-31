import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { useRotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { fieldClass } from "./fieldClass";
import { useRotaCall } from "./useRotaCall";

const errors: Record<string, string> = t.rota.peopleErrors;

/** The organizer's name for someone in the khatma. `onBack` leaves it, changing nothing. */
export function RenameSheet({
  inviteCode,
  person,
  onBack,
  onClose,
}: {
  inviteCode: string;
  person: { id: Id<"rotaParticipants">; name: string };
  onBack: () => void;
  onClose: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const rename = useMutation(backend.renameParticipant);
  const fieldId = useId();
  const [name, setName] = useState(person.name);
  const { busy, error, run } = useRotaCall(errors);

  function onSave(event: FormEvent) {
    event.preventDefault();
    void run(
      () =>
        rename({
          ...backend.authArgs(),
          participantId: person.id,
          name: name.trim(),
        }),
      onClose,
    );
  }

  return (
    <Sheet title={t.rota.renameTitle} onClose={onClose}>
      <form noValidate onSubmit={onSave}>
        <label htmlFor={fieldId} className="block font-medium">
          {t.rota.personName}
        </label>
        <input
          id={fieldId}
          type="text"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={fieldClass}
        />
        <ErrorLine error={error} />
        <div className="mt-5 grid gap-3">
          <Button type="submit" disabled={busy}>
            {t.rota.renameSave}
          </Button>
          <Button variant="ghost" onClick={onBack}>
            {t.rota.cancel}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
