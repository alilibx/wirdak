import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useId, useState } from "react";
import { t } from "../i18n/ar";
import { ConfirmSheet } from "./ConfirmSheet";
import { SwitchLine } from "./SwitchLine";

type Fields = { displayName: string; whatsappNotes: boolean };

/** A person's name and WhatsApp notes. Their number moves only through a code they send. */
export function PersonEditSheet({
  person,
  onSave,
  onClose,
}: {
  person: Fields;
  onSave: (fields: Fields, note: string | undefined) => void;
  onClose: () => void;
}) {
  const nameId = useId();
  const [displayName, setDisplayName] = useState(person.displayName);
  const [whatsappNotes, setWhatsappNotes] = useState(person.whatsappNotes);
  return (
    <ConfirmSheet
      title={t.ops.editPerson}
      body={t.ops.editPersonBody}
      confirmLabel={t.ops.save}
      disabled={displayName.trim() === ""}
      onConfirm={(note) => onSave({ displayName, whatsappNotes }, note)}
      onClose={onClose}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={nameId} className="text-[13px]">
          {t.ops.personName}
        </Label>
        <Input
          id={nameId}
          value={displayName}
          maxLength={40}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <SwitchLine
        label={t.ops.whatsappNotes}
        on={whatsappNotes}
        disabled={false}
        onChange={setWhatsappNotes}
      />
    </ConfirmSheet>
  );
}
