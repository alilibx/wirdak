import type { AddSavedManyResult, SavedContact } from "@convex/lib/rotaOps";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { useRotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { useAddCall } from "./useAddCall";

const savedErrors: Record<string, string> = t.rota.savedErrors;

/**
 * The people the organizer added to earlier khatmas, by name, with those who read with them now
 * first. Those already in the khatma can't be picked. Pool members never show a number, since the
 * organizer never saw it.
 *
 * With `juz` (an empty row) pressing one adds them there and closes. With `share` too, they join
 * `juz` as its second reader once the organizer confirms `explain`. Without `juz` the list is a
 * checklist: the organizer ticks up to as many as there are free ajza' and adds them all in one
 * call, each on the lowest free juz', or once every juz' has a reader and sharing is open, as the
 * second reader of the lowest juz' that has none. `onAddedMany` gets the line saying what it did.
 */
export function SavedPicker({
  inviteCode,
  juz,
  share = false,
  explain,
  onClose,
  onStart,
  onAdded,
  onAddedMany,
}: {
  inviteCode: string;
  juz?: number;
  /** With `juz`: as that juz''s second reader. */
  share?: boolean;
  /** With `share`: what adding this person means, said before the organizer confirms. */
  explain?: (name: string) => string;
  onClose: () => void;
  /** Called when the organizer adds, before the call. */
  onStart?: () => void;
  /** With `juz`: after the person is added. */
  onAdded?: () => void;
  /** Without `juz`: after the batch is added, with the result line. */
  onAddedMany?: (line: string) => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const saved = useQuery(backend.saved, backend.scope);
  return (
    <Sheet title={t.rota.savedTitle} onClose={onClose}>
      {juz === undefined ? (
        <Checklist
          inviteCode={inviteCode}
          saved={saved ?? []}
          onClose={onClose}
          onStart={onStart}
          onAddedMany={onAddedMany}
        />
      ) : (
        <OneTap
          inviteCode={inviteCode}
          juz={juz}
          share={share}
          explain={explain}
          saved={saved ?? []}
          onClose={onClose}
          onStart={onStart}
          onAdded={onAdded}
        />
      )}
    </Sheet>
  );
}

function ActiveTag() {
  return (
    <span className="rounded-full bg-saffron-soft px-2.5 py-0.5 text-sm font-semibold text-saffron-ink">
      {t.rota.savedActive}
    </span>
  );
}

/**
 * Under a saved person's name: «في هذه الختمة» when they are in it already, else their number.
 * It sits on its own line so a long number never squeezes the name onto two on a small phone.
 */
function SecondLine({ contact }: { contact: SavedContact }) {
  if (contact.inKhatma) {
    return (
      <span className="text-base text-ink-soft">{t.rota.savedInKhatma}</span>
    );
  }
  if (contact.phone === null) return null;
  return (
    <span dir="ltr" className="text-base text-ink-soft">
      {contact.phone}
    </span>
  );
}

function OneTap({
  inviteCode,
  juz,
  share,
  explain,
  saved,
  onClose,
  onStart,
  onAdded,
}: {
  inviteCode: string;
  juz: number;
  share: boolean;
  explain?: (name: string) => string;
  saved: SavedContact[];
  onClose: () => void;
  onStart?: () => void;
  onAdded?: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const addSaved = useMutation(backend.addSaved);
  const { busy, error, add: addCall, question } = useAddCall(savedErrors);
  // Sharing a juz' says what follows first: the one picked waits here for the organizer's yes.
  const [chosen, setChosen] = useState<SavedContact | null>(null);

  const add = (contactId: SavedContact["id"]) => {
    onStart?.();
    return addCall(
      (today) =>
        addSaved({
          ...backend.authArgs(),
          contactId,
          juz,
          ...(share ? { share } : {}),
          ...today,
        }),
      () => {
        onClose();
        onAdded?.();
      },
    );
  };

  if (chosen) {
    return (
      <>
        {explain && <p className="leading-relaxed">{explain(chosen.name)}</p>}
        {question ?? (
          <div className="mt-4 grid gap-3">
            <Button disabled={busy} onClick={() => void add(chosen.id)}>
              {busy ? t.rota.adding : t.rota.add}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setChosen(null)}
            >
              {t.rota.back}
            </Button>
          </div>
        )}
        <ErrorLine error={error} />
      </>
    );
  }

  return (
    <>
      <p className="text-ink-soft">{t.rota.savedHint}</p>
      {question}
      <ul aria-label={t.rota.savedTitle} className="mt-3 grid gap-2">
        {saved.map((contact) => (
          <li key={contact.id}>
            <button
              type="button"
              disabled={busy || contact.inKhatma || question !== null}
              onClick={() =>
                share ? setChosen(contact) : void add(contact.id)
              }
              className="flex min-h-14 w-full flex-col items-start justify-center gap-0.5 rounded-ui border-2 border-line bg-card px-4 py-2 text-start disabled:opacity-50"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{contact.name}</span>
                {contact.active && !contact.inKhatma && <ActiveTag />}
              </span>
              <SecondLine contact={contact} />
            </button>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />
    </>
  );
}

function Checklist({
  inviteCode,
  saved,
  onClose,
  onStart,
  onAddedMany,
}: {
  inviteCode: string;
  saved: SavedContact[];
  onClose: () => void;
  onStart?: () => void;
  onAddedMany?: (line: string) => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const people = useQuery(backend.people, backend.scope);
  const addSavedMany = useMutation(backend.addSavedMany);
  const { busy, error, add: addCall, question } = useAddCall(savedErrors);
  const [ticked, setTicked] = useState<ReadonlySet<SavedContact["id"]>>(
    () => new Set(),
  );

  // Once every juz' has a reader and sharing is open, each one added shares a juz' one person
  // reads, lowest first. Nothing says so while a juz' is empty.
  const sharing =
    people != null && people.freeJuz.length === 0 && people.sharing.open;
  // Until the free ajza' load, the server's own count is the limit (it reports who didn't fit).
  const free = people
    ? people.freeJuz.length + people.unsharedJuz.length
    : Infinity;
  const room = Math.max(0, free - ticked.size);
  const locked = busy || question !== null;
  const canTick = (c: SavedContact) =>
    !c.inKhatma && !ticked.has(c.id) && room > 0;
  const activeToTick = saved.filter((c) => c.active && canTick(c));

  const toggle = (id: SavedContact["id"]) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const tickActive = () =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const c of activeToTick.slice(0, room)) next.add(c.id);
      return next;
    });

  const add = () => {
    // In the list's order, so the first on the list takes the lowest juz'.
    const contactIds = saved.filter((c) => ticked.has(c.id)).map((c) => c.id);
    let result: AddSavedManyResult | null = null;
    onStart?.();
    return addCall(
      async (today) => {
        result = await addSavedMany({
          ...backend.authArgs(),
          contactIds,
          ...today,
        });
        return result;
      },
      () => {
        const done = result;
        if (done && "ok" in done) {
          onAddedMany?.(
            t.rota.savedManyResult({
              added: done.added,
              noRoom: done.noRoom,
              skipped: done.alreadyIn + done.notFound,
            }),
          );
        }
        onClose();
      },
    );
  };

  return (
    <>
      <p className="text-ink-soft">
        {sharing ? t.rota.savedShareHint : t.rota.savedManyHint}
      </p>
      {people !== undefined && people !== null && (
        <p role="status" className="mt-2 font-medium">
          {t.rota.savedRoom(room)}
        </p>
      )}
      {activeToTick.length > 0 && (
        <div className="mt-3">
          <Button variant="ghost" disabled={locked} onClick={tickActive}>
            {t.rota.savedPickActive}
          </Button>
        </div>
      )}
      <ul aria-label={t.rota.savedTitle} className="mt-3 grid gap-2">
        {saved.map((contact) => {
          const checked = ticked.has(contact.id);
          return (
            <li key={contact.id}>
              <label
                className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-ui border-2 bg-card px-4 py-2 has-[:disabled]:cursor-default has-[:disabled]:opacity-50 ${
                  checked ? "border-green" : "border-line"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked || (!checked && !canTick(contact))}
                  onChange={() => toggle(contact.id)}
                  className="size-6 shrink-0 accent-[var(--green)]"
                />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{contact.name}</span>
                    {contact.active && !contact.inKhatma && <ActiveTag />}
                  </span>
                  <SecondLine contact={contact} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {question}
      <div className="sticky -bottom-7 mt-4 bg-card pt-2 pb-7">
        <Button
          disabled={locked || ticked.size === 0}
          onClick={() => void add()}
        >
          {t.rota.savedAddMany(ticked.size)}
        </Button>
      </div>
      <ErrorLine error={error} />
    </>
  );
}

/**
 * «من ختمات سابقة» on the People screen: opens the checklist. Nothing when every saved person is
 * in the khatma already, or the caller has no saved list (a co-organizer without People).
 */
export function PickSavedButton({
  inviteCode,
  onStart,
  onAddedMany,
}: {
  inviteCode: string;
  onStart?: () => void;
  onAddedMany?: (line: string) => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const saved = useQuery(backend.saved, backend.scope);
  const [picking, setPicking] = useState(false);
  if (!saved?.some((c) => !c.inKhatma)) return null;
  return (
    <>
      <Button variant="ghost" onClick={() => setPicking(true)}>
        {t.rota.savedFrom}
      </Button>
      {picking && (
        <SavedPicker
          inviteCode={inviteCode}
          onClose={() => setPicking(false)}
          onStart={onStart}
          onAddedMany={onAddedMany}
        />
      )}
    </>
  );
}
