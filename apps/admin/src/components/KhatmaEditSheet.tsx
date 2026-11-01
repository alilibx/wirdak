import { isValidGrace, type Grace } from "@convex/lib/grace";
import { SCHEDULES, type Schedule } from "@convex/lib/schedule";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GraceField } from "@web/components/GraceField";
import { t as webT } from "@web/i18n/ar";
import { useId, useState } from "react";
import { t } from "../i18n/ar";
import { ConfirmSheet } from "./ConfirmSheet";

type Fields = { name: string | null; schedule: Schedule; grace: Grace };

/** A pool khatma's name, schedule and grace, as its organizer edits them. */
export function KhatmaEditSheet({
  khatma,
  onSave,
  onClose,
}: {
  khatma: Fields;
  onSave: (fields: Fields, note: string | undefined) => void;
  onClose: () => void;
}) {
  const nameId = useId();
  const scheduleId = useId();
  const [name, setName] = useState(khatma.name ?? "");
  const [schedule, setSchedule] = useState(khatma.schedule);
  const [grace, setGrace] = useState(khatma.grace);
  return (
    <ConfirmSheet
      title={t.ops.editKhatma}
      body={t.ops.editKhatmaBody}
      confirmLabel={t.ops.save}
      disabled={!isValidGrace(grace)}
      onConfirm={(note) =>
        onSave({ name: name.trim() ? name : null, schedule, grace }, note)
      }
      onClose={onClose}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={nameId} className="text-[13px]">
          {t.ops.khatmaName}
        </Label>
        <Input
          id={nameId}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={scheduleId} className="text-[13px]">
          {t.ops.schedule}
        </Label>
        <select
          id={scheduleId}
          value={schedule}
          onChange={(e) => setSchedule(e.target.value as Schedule)}
          className="w-full rounded-lg border bg-card p-2"
        >
          {SCHEDULES.map((option) => (
            <option key={option} value={option}>
              {webT.schedules[option]}
            </option>
          ))}
        </select>
      </div>
      <GraceField value={grace} schedule={schedule} onChange={setGrace} />
    </ConfirmSheet>
  );
}
