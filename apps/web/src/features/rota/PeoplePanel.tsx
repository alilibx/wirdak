import type { Id } from "@convex/_generated/dataModel";
import { toArabicDigits } from "@convex/lib/digits";
import type { PeopleView as View } from "@convex/lib/rotaOps";
import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { AddPersonForm } from "./AddPersonForm";
import { useRotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { fieldClass } from "./fieldClass";
import { JoinChip, ShareJoinLink, useEnsureJoinLink } from "./JoinStatus";
import { JoinRequests } from "./JoinRequests";
import { PersonPhone } from "./PersonPhone";
import { RenameSheet } from "./RenameSheet";
import { SavedPicker } from "./SavedPicker";
import { useRotaCall } from "./useRotaCall";
import { formatIsoDate } from "./format";

type Person = View["participants"][number];

const peopleErrors: Record<string, string> = t.rota.peopleErrors;

/**
 * Someone's juz' of the next khatma: move it, add a second one, or take them out. The organizer
 * can't leave the khatma, but can stop reading: their ajza' go, and they stay its organizer.
 */
function PersonSheet({
  inviteCode,
  view,
  person,
  juz,
  onClose,
}: {
  inviteCode: string;
  view: View;
  person: Person;
  /** The row that was pressed. */
  juz: number;
  onClose: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const moveJuz = useMutation(backend.moveJuz);
  const giveJuz = useMutation(backend.giveJuz);
  const freeJuz = useMutation(backend.freeJuz);
  const removeParticipant = useMutation(backend.removeParticipant);
  const holderOf = (n: number) => view.rows[n - 1]?.participant ?? null;
  const others = view.rows.filter((row) => row.juz !== juz);
  const free = others.find((row) => row.participant === null);
  const [target, setTarget] = useState(free?.juz ?? others[0]?.juz ?? juz);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const { busy, error, run } = useRotaCall(peopleErrors);
  const args = backend.authArgs();
  const nextFree = view.freeJuz[0];
  const canGive = nextFree !== undefined && person.juz.length < view.maxSlots;
  const swapWith = holderOf(target);

  const name = person.isMe ? t.rota.me : person.name;

  /** Frees each of the person's ajza' in turn, stopping at the first refusal. */
  const freeAll = async () => {
    for (const held of person.juz) {
      const result = await freeJuz({
        ...args,
        participantId: person.id,
        juz: held,
      });
      if ("error" in result) return result;
    }
    return { ok: true as const };
  };

  if (confirming) {
    return (
      <Sheet title={t.rota.removeTitle(name)} onClose={onClose}>
        <p className="leading-relaxed text-ink-soft">{t.rota.removeBody}</p>
        <div className="mt-5 grid gap-3">
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                () => removeParticipant({ ...args, participantId: person.id }),
                onClose,
              )
            }
          >
            {t.rota.removeConfirm}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t.rota.cancel}
          </Button>
        </div>
        <ErrorLine error={error} />
      </Sheet>
    );
  }

  if (renaming) {
    return (
      <RenameSheet
        inviteCode={inviteCode}
        person={person}
        onBack={() => setRenaming(false)}
        onClose={onClose}
      />
    );
  }

  return (
    <Sheet title={name} onClose={onClose}>
      <p className="text-ink-soft">{t.rota.juzOf(person.juz)}</p>

      <label htmlFor="rota-move-to" className="mt-4 block font-medium">
        {t.rota.moveLabel}
      </label>
      <select
        id="rota-move-to"
        value={target}
        onChange={(event) => setTarget(Number(event.target.value))}
        className={fieldClass}
      >
        {others.map((row) => (
          <option key={row.juz} value={row.juz}>
            {t.rota.moveOption(
              row.juz,
              row.participant ? row.participant.name : null,
            )}
          </option>
        ))}
      </select>
      {swapWith && (
        <p className="mt-1.5 text-base text-ink-soft">
          {swapWith.isMe ? t.rota.swapsWithMe : t.rota.swapsWith(swapWith.name)}
        </p>
      )}
      <div className="mt-3">
        <Button
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                moveJuz({
                  ...args,
                  participantId: person.id,
                  fromJuz: juz,
                  toJuz: target,
                }),
              onClose,
            )
          }
        >
          {t.rota.move}
        </Button>
      </div>

      <div className="mt-5 grid gap-3">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setRenaming(true)}
        >
          {t.rota.rename}
        </Button>
        {canGive && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  giveJuz({ ...args, participantId: person.id, juz: nextFree }),
                onClose,
              )
            }
          >
            <span>
              <span className="block">{t.rota.giveMore}</span>
              <span className="block text-base font-normal">
                {t.rota.giveMoreHint(nextFree)}
              </span>
            </span>
          </Button>
        )}
        {person.isMe ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(freeAll, onClose)}
          >
            <span>
              <span className="block">{t.rota.stopReading}</span>
              <span className="block text-base font-normal">
                {t.rota.stopReadingHint}
              </span>
            </span>
          </Button>
        ) : (
          // A khatma keeps its organizer, whoever is looking at it.
          !person.isOrganizer && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {t.rota.remove}
            </Button>
          )
        )}
      </div>
      <ErrorLine error={error} />
    </Sheet>
  );
}

/** An empty juz' of the next khatma: a new person for it, or someone already in the khatma. */
function EmptyRowSheet({
  inviteCode,
  view,
  juz,
  onClose,
}: {
  inviteCode: string;
  view: View;
  juz: number;
  onClose: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const giveJuz = useMutation(backend.giveJuz);
  const saved = useQuery(backend.saved, backend.scope);
  const [picking, setPicking] = useState(false);
  const { busy, error, run } = useRotaCall(peopleErrors);
  const listId = useId();
  if (picking) {
    return (
      <SavedPicker
        inviteCode={inviteCode}
        juz={juz}
        onClose={() => setPicking(false)}
        onAdded={onClose}
      />
    );
  }
  return (
    <Sheet title={t.rota.readerTitle(juz)} onClose={onClose}>
      <p className="mb-4 leading-relaxed text-ink-soft">
        {t.rota.walk(juz, view.target.number)}
      </p>
      <AddPersonForm
        inviteCode={inviteCode}
        juz={juz}
        variant="primary"
        onAdded={onClose}
      />
      {saved && saved.length > 0 && (
        <div className="mt-4">
          <Button variant="ghost" onClick={() => setPicking(true)}>
            {t.rota.savedFrom}
          </Button>
        </div>
      )}
      {view.participants.length > 0 && (
        <>
          <h3 id={listId} className="mt-6 font-medium">
            {t.rota.orGiveTo}
          </h3>
          <ul aria-labelledby={listId} className="mt-2 grid gap-2">
            {view.participants.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  disabled={busy || person.juz.length >= view.maxSlots}
                  onClick={() =>
                    void run(
                      () =>
                        giveJuz({
                          ...backend.authArgs(),
                          participantId: person.id,
                          juz,
                        }),
                      onClose,
                    )
                  }
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-ui border-2 border-line bg-card px-4 text-start disabled:opacity-50"
                >
                  <span className="font-medium">
                    {person.isMe ? t.rota.me : person.name}
                  </span>
                  {person.juz.length > 0 && (
                    <span className="text-base text-ink-soft">
                      {t.rota.juzOf(person.juz)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <ErrorLine error={error} />
        </>
      )}
    </Sheet>
  );
}

/** The open sheet: the add form of an empty row, or a person (by id, so it follows the live list). */
type Open =
  | { kind: "add"; juz: number }
  | { kind: "person"; juz: number; participantId: Id<"rotaParticipants"> };

/**
 * The organizer's People screen: the 30 ajza' of the next khatma and who reads each. Once the
 * khatma is archived it is only a list: nothing to press, add or send.
 */
export function PeoplePanel({
  inviteCode,
  archived,
}: {
  inviteCode: string;
  archived: boolean;
}) {
  const backend = useRotaBackend(inviteCode);
  const view = useQuery(backend.people, backend.scope);
  const [open, setOpen] = useState<Open | null>(null);
  // An archived khatma refuses a new join link, and has no use for one.
  useEnsureJoinLink(inviteCode, archived ? undefined : view?.joinLink);

  if (view === undefined) {
    return (
      <p className="py-10 text-center text-xl text-ink-soft">
        {t.common.loading}
      </p>
    );
  }
  if (view === null) return null;

  const date =
    view.target.date === null ? null : formatIsoDate(view.target.date);
  const seen = new Set<Id<"rotaParticipants">>();
  const person =
    open?.kind === "person"
      ? view.participants.find((p) => p.id === open.participantId)
      : undefined;

  return (
    <div className="mt-4">
      <p className="rounded-ui border-2 border-line bg-card p-4 leading-relaxed">
        {view.target.isFirst
          ? t.rota.firstBanner(date)
          : t.rota.nextBanner(view.target.number, date)}
      </p>

      {!archived && <JoinRequests inviteCode={inviteCode} view={view} />}

      <ol className="mt-4 grid gap-2">
        {view.rows.map((row) => {
          const holder = row.participant;
          // The second juz' someone holds says so, so one person's rows read as a pair.
          const second = holder !== null && seen.has(holder.id);
          if (holder) seen.add(holder.id);
          const look = `flex min-h-14 min-w-[12rem] flex-1 items-center gap-3 rounded-ui border-2 px-4 py-2 text-start ${
            holder
              ? "border-line bg-card"
              : "border-dashed border-[#8A7D62] bg-transparent text-ink-soft"
          }`;
          const content = (
            <>
              <span className="w-7 shrink-0 text-center font-semibold text-green-deep">
                {toArabicDigits(row.juz)}
              </span>
              {holder ? (
                <>
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {holder.isMe ? t.rota.me : holder.name}
                    </span>
                    <PersonPhone phone={holder.phone} />
                  </span>
                  {second && (
                    <span className="ms-auto rounded-full bg-saffron-soft px-3 py-0.5 text-base font-semibold text-saffron-ink">
                      {t.rota.secondJuz}
                    </span>
                  )}
                </>
              ) : (
                <span className="font-medium text-green">
                  {archived ? t.rota.noReader : t.rota.addReader(row.juz)}
                </span>
              )}
            </>
          );
          return (
            <li key={row.juz} className="flex flex-wrap items-center gap-2">
              {archived ? (
                <div className={look}>{content}</div>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setOpen(
                      holder
                        ? {
                            kind: "person",
                            juz: row.juz,
                            participantId: holder.id,
                          }
                        : { kind: "add", juz: row.juz },
                    )
                  }
                  className={look}
                >
                  {content}
                </button>
              )}
              {!archived && holder && !second && (
                <JoinChip
                  person={holder}
                  isMe={holder.isMe}
                  title={view.title}
                  daysKind={view.daysKind}
                  joinLink={view.joinLink}
                />
              )}
            </li>
          );
        })}
      </ol>

      {!archived && (
        <div className="mt-5">
          <ShareJoinLink
            title={view.title}
            daysKind={view.daysKind}
            joinLink={view.joinLink}
          />
        </div>
      )}

      {open?.kind === "add" && (
        <EmptyRowSheet
          inviteCode={inviteCode}
          view={view}
          juz={open.juz}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "person" && person && (
        <PersonSheet
          inviteCode={inviteCode}
          view={view}
          person={person}
          juz={open.juz}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
