import { addDays, type ReadingDays } from "@convex/lib/rota";
import { localDate } from "@convex/lib/wakingTime";
import { useAction, useMutation } from "convex/react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { useRotaBackend, type RotaBackend } from "../rota/backend";
import { useEarliestStart } from "../rota/useEarliestStart";
import { DateLine } from "../rota/DateLine";
import { firstReadingDay } from "../rota/dates";
import { ErrorLine } from "../rota/ErrorLine";
import { formatIsoDate } from "../rota/format";
import { useRotaCall } from "../rota/useRotaCall";
import {
  dismissDeleteFailure,
  startDelete,
  useDeleteFailure,
  useDeleting,
} from "./deleting";

const errors: Record<string, string> = t.rota.errors;

/** The red ghost button for anything that can't be undone. */
const dangerClass = "border-[#8A2B1E] text-[#8A2B1E]";

/** «هذه الختمة مؤرشفة»: at the top of an archived khatma's page, which is read-only. */
export function ArchivedBanner() {
  return (
    <div
      role="note"
      className="mt-4 rounded-ui border-2 border-line bg-paper-2 p-3"
    >
      <p className="font-semibold">{t.archive.banner}</p>
      <p className="text-ink-soft">{t.archive.bannerHint}</p>
    </div>
  );
}

/** Asks once more before `confirm` runs: a title, what it means, the one button that does it. */
function ConfirmSheet({
  title,
  body,
  confirm,
  busyLabel,
  busy,
  error,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  busyLabel: string;
  busy: boolean;
  error: string | null;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="mt-1 leading-relaxed text-ink-soft">{body}</p>
      <div className="mt-5 grid gap-3">
        <Button
          variant={danger ? "ghost" : "primary"}
          className={danger ? dangerClass : ""}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? busyLabel : confirm}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t.archive.cancel}
        </Button>
      </div>
      <ErrorLine error={error} />
    </Sheet>
  );
}

/** The organizer's «أرشف الختمة»: messages stop, nothing is lost. For a khatma that is not archived. */
export function ArchiveSection({ inviteCode }: { inviteCode: string }) {
  const backend = useRotaBackend(inviteCode);
  const archive = useMutation(backend.archive);
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useRotaCall(errors);
  return (
    <section aria-label={t.archive.heading} className="mt-8">
      <h2 className="mb-3 text-xl font-semibold">{t.archive.heading}</h2>
      <p className="mb-3 leading-relaxed text-ink-soft">{t.archive.hint}</p>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {t.archive.button}
      </Button>
      {open && (
        <ConfirmSheet
          title={t.archive.title}
          body={t.archive.body}
          confirm={t.archive.confirm}
          busyLabel={t.archive.archiving}
          busy={busy}
          error={error}
          onConfirm={() =>
            void run(
              () => archive(backend.authArgs()),
              () => setOpen(false),
            )
          }
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

/** What a rota khatma starts again from: its days and the zone its dates are in. */
export type Restart = { days: ReadingDays; timeZone: string };

/** A new rota khatma with the same people, on the date picked (tomorrow, or the next reading day, to begin with). */
function RestartSheet({
  inviteCode,
  restart,
  startAgainFunction,
  onClose,
}: {
  inviteCode: string;
  restart: Restart;
  startAgainFunction: NonNullable<RotaBackend["startAgain"]>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const backend = useRotaBackend(inviteCode);
  const startAgain = useAction(startAgainFunction);
  const { busy, error, run } = useRotaCall(errors);
  // `null` while the start follows "tomorrow"; only a picked date is kept.
  const [picked, setPicked] = useState<string | null>(null);

  const today = localDate(Date.now(), restart.timeZone);
  const tomorrow = addDays(today, 1);
  const earliest = useEarliestStart(today);
  // The first day must be a reading day, so the start moves on to the next one.
  const start = firstReadingDay(restart.days, picked ?? tomorrow);

  // The code of the new khatma, known once the call answers and read when `run` is done.
  const created = useRef<string | null>(null);
  return (
    <Sheet title={t.archive.restartTitle} onClose={onClose}>
      <p className="mt-1 mb-4 leading-relaxed text-ink-soft">
        {t.archive.restartBody}
      </p>
      <DateLine
        label={t.archive.restartDate}
        value={
          start === today
            ? t.rota.today(formatIsoDate(start))
            : start === tomorrow
              ? t.rota.tomorrow(formatIsoDate(start))
              : formatIsoDate(start)
        }
        inputLabel={t.rota.startDateInput}
        // A start that is not a reading day moves on; the field shows where it landed.
        inputValue={picked === null ? "" : start}
        min={earliest}
        onPick={setPicked}
      />
      <div className="mt-5 grid gap-3">
        <Button
          disabled={busy}
          onClick={() =>
            void run(
              async () => {
                const result = await startAgain({
                  ...backend.authArgs(),
                  firstDate: start,
                });
                created.current = result.inviteCode;
              },
              () => {
                if (created.current !== null) {
                  void navigate(
                    `/j/${encodeURIComponent(created.current)}/setup`,
                  );
                }
              },
            )
          }
        >
          {busy ? t.archive.starting : t.archive.restartConfirm}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t.archive.cancel}
        </Button>
      </div>
      <ErrorLine error={error} />
    </Sheet>
  );
}

/**
 * Deletes the archived khatma for good, then goes home. The khatma's pages show `DeletingPage`
 * from the tap until the move, so none of them flashes a dead link or "not found".
 */
function DeleteSheet({
  inviteCode,
  onClose,
}: {
  inviteCode: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const backend = useRotaBackend(inviteCode);
  const remove = useMutation(backend.remove);
  const deleting = useDeleting(inviteCode);
  return (
    <ConfirmSheet
      title={t.archive.deleteTitle}
      body={t.archive.deleteBody}
      confirm={t.archive.deleteConfirm}
      busyLabel={t.archive.deleting}
      busy={deleting}
      error={null}
      danger
      onConfirm={() =>
        // A failure is kept by `deleting.tsx` and shown under the buttons; the sheet closes.
        void startDelete(
          inviteCode,
          () => remove(backend.authArgs()),
          () => void navigate("/", { replace: true }),
        ).then((deleted) => {
          if (!deleted) onClose();
        })
      }
      onClose={onClose}
    />
  );
}

/**
 * What can still be done with an archived khatma: start a rota khatma again with the same people
 * (`restart` is null for a pool khatma, which has no such thing, and an admin can't), or delete it.
 */
export function ArchivedSection({
  inviteCode,
  restart,
}: {
  inviteCode: string;
  restart: Restart | null;
}) {
  const { startAgain } = useRotaBackend(inviteCode);
  const [open, setOpen] = useState<"restart" | "delete" | null>(null);
  const failure = useDeleteFailure(inviteCode);
  const show = (sheet: "restart" | "delete") => {
    dismissDeleteFailure();
    setOpen(sheet);
  };
  return (
    <div className="mt-8 grid gap-3">
      {restart && startAgain && (
        <Button onClick={() => show("restart")}>{t.archive.restart}</Button>
      )}
      <Button
        variant="ghost"
        className={dangerClass}
        onClick={() => show("delete")}
      >
        {t.archive.delete}
      </Button>
      <ErrorLine error={failure} />
      {open === "restart" && restart && startAgain && (
        <RestartSheet
          inviteCode={inviteCode}
          restart={restart}
          startAgainFunction={startAgain}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "delete" && (
        <DeleteSheet inviteCode={inviteCode} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
