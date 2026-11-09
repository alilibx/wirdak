import type { Id } from "@convex/_generated/dataModel";
import { toWesternDigits } from "@convex/lib/digits";
import type { PeopleView as View } from "@convex/lib/rotaOps";
import { useMutation, useQuery } from "convex/react";
import { useId, useState, type ReactNode } from "react";
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
import { PickSavedButton, SavedPicker } from "./SavedPicker";
import { SpreadFreeJuz } from "./SpreadFreeJuz";
import { useRotaCall } from "./useRotaCall";
import { formatIsoDate } from "./format";

type Person = View["participants"][number];
type Reader = NonNullable<View["rows"][number]["participant"]>;

const peopleErrors: Record<string, string> = t.rota.peopleErrors;

/**
 * Someone's juz' of the next khatma: move it, add a second one, free it, or take them out. The
 * organizer can't leave the khatma, but can stop reading: their ajza' go, and they stay its
 * organizer. Whoever else may change the organizer's ajza' (the owner or an admin) frees them one
 * at a time.
 * Only the owner takes out or moves someone who runs the khatma, swaps a juz' into theirs, or frees
 * their own ajza' (co-organizers spec 4.2): a co-organizer looking sees none of it on those rows,
 * their own included.
 * Once every juz' has a reader, a juz' read by one person can take a second (`canShare`). On a juz'
 * two people share, each change says first that the other will read it alone, and a move goes
 * only to a juz' with no reader: a swap never takes a shared juz'.
 */
function PersonSheet({
  inviteCode,
  view,
  person,
  juz,
  viewerIsOwner,
  canShare,
  onClose,
}: {
  inviteCode: string;
  view: View;
  person: Person;
  /** The row that was pressed. */
  juz: number;
  viewerIsOwner: boolean;
  /** A second reader may be added to a juz' now. */
  canShare: boolean;
  onClose: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const moveJuz = useMutation(backend.moveJuz);
  const giveJuz = useMutation(backend.giveJuz);
  const freeJuz = useMutation(backend.freeJuz);
  const removeParticipant = useMutation(backend.removeParticipant);
  const holderOf = (n: number) => view.rows[n - 1]?.participant ?? null;
  const runsKhatma = (p: { isOrganizer: boolean; isCoOrganizer: boolean }) =>
    p.isOrganizer || p.isCoOrganizer;
  const canMove = viewerIsOwner || !runsKhatma(person);
  // A lone juz' goes with «أزله من الختمة», or «لن أقرأ جزءاً» on the organizer's own row.
  const canFree =
    canMove && (person.juz.length > 1 || (runsKhatma(person) && !person.isMe));
  const pressed = view.rows[juz - 1];
  // Who else reads the pressed juz', when two share it.
  const other =
    pressed?.participant?.id === person.id
      ? pressed.partner
      : pressed?.partner?.id === person.id
        ? pressed.participant
        : null;
  // Whether they also read a juz' nobody shares with them, which a removal leaves empty.
  const holdsWholeJuz = view.rows.some(
    (row) => row.participant?.id === person.id && row.partner === null,
  );
  const others = view.rows.filter(
    (row) =>
      row.juz !== juz &&
      row.partner === null &&
      (other === null || row.participant === null) &&
      (viewerIsOwner ||
        row.participant === null ||
        !runsKhatma(row.participant)),
  );
  const free = others.find((row) => row.participant === null);
  const [target, setTarget] = useState(free?.juz ?? others[0]?.juz ?? juz);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const { busy, error, run } = useRotaCall(peopleErrors);
  const args = backend.authArgs();
  const nextFree = view.freeJuz[0];
  const canGive = nextFree !== undefined && person.heldSlots < view.maxSlots;
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
        {other && (
          <p className="leading-relaxed text-ink-soft">
            {t.rota.leavesAlone(other.name)}
          </p>
        )}
        <p className="leading-relaxed text-ink-soft">
          {/* A shared juz' keeps its other reader; any juz' they read alone loses its reader. */}
          {other && !holdsWholeJuz
            ? t.rota.removeBodyShared
            : t.rota.removeBody}
        </p>
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

  if (sharing) {
    return (
      <ShareSheet
        inviteCode={inviteCode}
        view={view}
        reader={person}
        juz={juz}
        onClose={onClose}
      />
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

      {canMove && others.length > 0 && (
        <>
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
              {swapWith.isMe
                ? t.rota.swapsWithMe
                : t.rota.swapsWith(swapWith.name)}
            </p>
          )}
          {other && (
            <p className="mt-1.5 text-base text-ink-soft">
              {t.rota.leavesAlone(other.name)}
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
        </>
      )}

      <div className="mt-5 grid gap-3">
        {canShare && other === null && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setSharing(true)}
          >
            {t.rota.shareAction}
          </Button>
        )}
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
        {canFree && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                () => freeJuz({ ...args, participantId: person.id, juz }),
                onClose,
              )
            }
          >
            <span>
              <span className="block">{t.rota.freeThis(juz)}</span>
              <span className="block text-base font-normal">
                {other
                  ? `${t.rota.leavesAlone(other.name)}. ${
                      person.isMe
                        ? t.rota.freeThisStaysSharedMe
                        : t.rota.freeThisStaysShared
                    }`
                  : person.isMe
                    ? t.rota.freeThisHintMe
                    : t.rota.freeThisHint}
              </span>
            </span>
          </Button>
        )}
        {person.isMe
          ? viewerIsOwner && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run(freeAll, onClose)}
              >
                <span>
                  <span className="block">{t.rota.stopReading}</span>
                  <span className="block text-base font-normal">
                    {other
                      ? `${t.rota.leavesAlone(other.name)}. ${
                          holdsWholeJuz
                            ? t.rota.stopReadingHint
                            : t.rota.stopReadingHintShared
                        }`
                      : t.rota.stopReadingHint}
                  </span>
                </span>
              </Button>
            )
          : // A khatma keeps its organizer, whoever is looking at it; and only the owner takes
            // out a co-organizer.
            !person.isOrganizer &&
            (viewerIsOwner || !person.isCoOrganizer) && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                {t.rota.remove}
              </Button>
            )}
      </div>
      <ErrorLine error={error} />
    </Sheet>
  );
}

/**
 * A second reader for a juz' one person reads: someone new, or from the saved list. Both pickers
 * say what follows before the organizer confirms.
 */
function ShareSheet({
  inviteCode,
  view,
  reader,
  juz,
  onClose,
}: {
  inviteCode: string;
  view: View;
  /** Who reads the juz' now. */
  reader: Person;
  juz: number;
  onClose: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const saved = useQuery(backend.saved, backend.scope);
  const [picking, setPicking] = useState(false);
  const explain = (name: string) =>
    t.rota.shareExplain(reader.name, name, juz, view.target.number);
  if (picking) {
    return (
      <SavedPicker
        inviteCode={inviteCode}
        juz={juz}
        share
        explain={explain}
        onClose={() => setPicking(false)}
        onAdded={onClose}
      />
    );
  }
  return (
    <Sheet title={t.rota.shareAction} onClose={onClose}>
      <AddPersonForm
        inviteCode={inviteCode}
        juz={juz}
        share
        explain={explain}
        phoneExample={view.phoneExample}
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
        phoneExample={view.phoneExample}
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
                  disabled={busy || person.heldSlots >= view.maxSlots}
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
  viewerIsOwner,
}: {
  inviteCode: string;
  archived: boolean;
  /** False for a co-organizer; the owner and an admin may take out or move anyone. */
  viewerIsOwner: boolean;
}) {
  const backend = useRotaBackend(inviteCode);
  const view = useQuery(backend.people, backend.scope);
  const [open, setOpen] = useState<Open | null>(null);
  const [spreadResult, setSpreadResult] = useState<string | null>(null);
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

      {/* Above the 30 rows, so the organizer sees what is left without scrolling. An admin
          can turn the box off; the open rows still invite an add. */}
      {!archived && view.leftoverBox && view.freeJuz.length > 0 && (
        <section className="mt-4 grid gap-3 rounded-ui border-2 border-gold bg-[#FBF1D9] p-4">
          <p className="font-medium">{t.rota.leftover(view.freeJuz)}</p>
          <SpreadFreeJuz
            inviteCode={inviteCode}
            view={view}
            onStart={() => setSpreadResult(null)}
            onSpread={setSpreadResult}
          />
          <PickSavedButton
            inviteCode={inviteCode}
            onStart={() => setSpreadResult(null)}
            onAddedMany={setSpreadResult}
          />
        </section>
      )}
      {/* Every juz' has a reader: saved people still come in, each sharing a juz'. */}
      {!archived && view.freeJuz.length === 0 && view.sharing.open && (
        <div className="mt-4 empty:hidden">
          <PickSavedButton
            inviteCode={inviteCode}
            onStart={() => setSpreadResult(null)}
            onAddedMany={setSpreadResult}
          />
        </div>
      )}
      {/* Mounted even once the banner is gone, so the result is still read out. */}
      <p role="status" className="mt-3 font-medium text-green empty:hidden">
        {spreadResult}
      </p>

      {view.sharing.shared > 0 && (
        <p className="mt-4 font-medium">
          {t.rota.sharedCount(view.sharing.readers, view.sharing.shared)}
        </p>
      )}

      <ol className="mt-4 grid gap-2">
        {view.rows.map((row) => {
          const readers = [row.participant, row.partner].filter(
            (reader): reader is Reader => reader !== null,
          );
          const look = (held: boolean) =>
            `flex min-h-14 min-w-[12rem] flex-1 items-center gap-3 rounded-ui border-2 px-4 py-2 text-start ${
              held
                ? "border-line bg-card"
                : "border-dashed border-[#8A7D62] bg-transparent text-ink-soft"
            }`;
          const number = (
            <span className="w-7 shrink-0 text-center font-semibold text-green-deep">
              {toWesternDigits(row.juz)}
            </span>
          );
          /** One line of the row: a reader of it, or its add button when it has none. */
          const line = (
            key: string,
            content: ReactNode,
            onPress: () => void,
            held: boolean,
            chip: ReactNode = null,
          ) => (
            <div key={key} className="flex flex-wrap items-center gap-2">
              {archived ? (
                <div className={look(held)}>{content}</div>
              ) : (
                <button type="button" onClick={onPress} className={look(held)}>
                  {content}
                </button>
              )}
              {chip}
            </div>
          );
          if (readers.length === 0) {
            return (
              <li key={row.juz} className="grid gap-1.5">
                {line(
                  "add",
                  <>
                    {number}
                    <span className="font-medium text-green">
                      {archived ? t.rota.noReader : t.rota.addReader(row.juz)}
                    </span>
                  </>,
                  () => setOpen({ kind: "add", juz: row.juz }),
                  false,
                )}
              </li>
            );
          }
          return (
            // A shared juz' has a line for each of its two readers.
            <li key={row.juz} className="grid gap-1.5">
              {readers.map((reader) => {
                // The second juz' someone holds says so, so one person's rows read as a pair.
                const second = seen.has(reader.id);
                seen.add(reader.id);
                return line(
                  reader.id,
                  <>
                    {number}
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {reader.isMe ? t.rota.me : reader.name}
                        {reader.isCoOrganizer && (
                          <span className="ms-2 inline-block rounded-full bg-paper-2 px-2.5 py-0.5 text-base font-semibold text-green-deep">
                            {t.organizer.coOrganizerBadge}
                          </span>
                        )}
                      </span>
                      <PersonPhone phone={reader.phone} />
                    </span>
                    {second && (
                      <span className="ms-auto rounded-full bg-saffron-soft px-3 py-0.5 text-base font-semibold text-saffron-ink">
                        {t.rota.secondJuz}
                      </span>
                    )}
                  </>,
                  () =>
                    setOpen({
                      kind: "person",
                      juz: row.juz,
                      participantId: reader.id,
                    }),
                  true,
                  !archived && !second && (
                    <JoinChip
                      person={reader}
                      isMe={reader.isMe}
                      title={view.title}
                      daysKind={view.daysKind}
                      joinLink={view.joinLink}
                    />
                  ),
                );
              })}
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
          viewerIsOwner={viewerIsOwner}
          canShare={view.sharing.on && view.sharing.open && !archived}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
