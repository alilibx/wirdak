import { useId, useState } from "react";
import { t } from "../i18n/ar";
import { ConfirmSheet } from "./ConfirmSheet";
import { SwitchLine } from "./SwitchLine";

type Switches = { readings: boolean; people: boolean; settings: boolean };

/**
 * Names a co-organizer (pick someone) or changes one's switches (no picker).
 * The three switches start from `initial`.
 */
export function CoOrganizerSheet({
  title,
  body,
  people,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  body: string;
  /** Who can be named; omit when editing someone already named. */
  people?: { candidateId: string; name: string }[];
  initial: Switches;
  /** `candidateId` is the picked person; "" when editing. */
  onSave: (
    fields: Switches & { candidateId: string },
    note: string | undefined,
  ) => void;
  onClose: () => void;
}) {
  const pickId = useId();
  const [candidateId, setCandidateId] = useState("");
  const [switches, setSwitches] = useState<Switches>({
    readings: initial.readings,
    people: initial.people,
    settings: initial.settings,
  });
  return (
    <ConfirmSheet
      title={title}
      body={body}
      confirmLabel={t.coOrganizers.save}
      disabled={people !== undefined && candidateId === ""}
      onConfirm={(note) => onSave({ ...switches, candidateId }, note)}
      onClose={onClose}
    >
      {people && (
        <div>
          <label htmlFor={pickId} className="block text-sm">
            {t.coOrganizers.pick}
          </label>
          <select
            id={pickId}
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
            className="mt-1 w-full rounded-lg border bg-card p-2"
          >
            <option value="" />
            {people.map((p) => (
              <option key={p.candidateId} value={p.candidateId}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {(["readings", "people", "settings"] as const).map((key) => (
        <SwitchLine
          key={key}
          label={t.coOrganizers[key]}
          on={switches[key]}
          disabled={false}
          onChange={(on) => setSwitches({ ...switches, [key]: on })}
        />
      ))}
    </ConfirmSheet>
  );
}
