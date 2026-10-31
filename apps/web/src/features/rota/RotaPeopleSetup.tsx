import type { Id } from "@convex/_generated/dataModel";
import type { PeopleView as View } from "@convex/lib/rotaOps";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { toArabicDigits } from "@convex/lib/digits";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { AddPersonForm } from "./AddPersonForm";
import { useRotaBackend, type RotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { PersonPhone } from "./PersonPhone";
import { RenameSheet } from "./RenameSheet";
import { JoinChip, ShareJoinLink, useEnsureJoinLink } from "./JoinStatus";
import { SavedPicker } from "./SavedPicker";
import { StepBar } from "./StepBar";
import { useRotaCall } from "./useRotaCall";

const giveErrors: Record<string, string> = t.rota.giveErrors;

/** Who reads each leftover juz' too: one juz' at a time, until none is left. */
function GiveJuzSheet({
  inviteCode,
  view,
  onClose,
  onStart,
}: {
  inviteCode: string;
  view: View;
  onClose: () => void;
  onStart: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const give = useMutation(backend.giveJuz);
  const { busy, error, run } = useRotaCall(giveErrors);
  const juz = view.freeJuz[0];
  // Everyone has a reader now, so there is nothing left to ask.
  if (juz === undefined) return null;

  const choose = (participantId: View["participants"][number]["id"]) => {
    onStart();
    return run(() =>
      give({
        ...backend.authArgs(),
        participantId,
        juz,
      }),
    );
  };

  return (
    <Sheet title={t.rota.giveTitle(juz)} onClose={onClose}>
      <p className="text-ink-soft">{t.rota.giveHint}</p>
      <ul className="mt-3 grid gap-2">
        {view.participants.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              disabled={busy || person.juz.length >= view.maxSlots}
              onClick={() => void choose(person.id)}
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
    </Sheet>
  );
}

const importErrors: Record<string, string> = t.rota.importErrors;

type Pool = { inviteCode: string; title: string; memberCount: number };

/**
 * Ways to fill the ajza' without typing: the members of one of the organizer's pool khatmas
 * (names only, their numbers stay hidden), or people saved from earlier khatmas. Shows only what
 * applies, and nothing when neither does and there is no import result or error to read.
 * `onStart` runs when the organizer starts adding a saved person.
 */
function BringPeopleInList({
  inviteCode,
  pools,
  busy = false,
  error = null,
  result = null,
  onBringIn,
  onStart,
}: {
  inviteCode: string;
  pools?: Pool[] | undefined;
  busy?: boolean;
  error?: string | null;
  result?: string | null;
  onBringIn?: (sourceInviteCode: string) => void;
  onStart?: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const saved = useQuery(backend.saved, backend.scope);
  const [picking, setPicking] = useState(false);

  const hasPools = pools !== undefined && pools.length > 0;
  const hasSaved = saved !== undefined && saved !== null && saved.length > 0;
  // An import takes its pool off the list, but what it did stays to be read.
  if (!hasPools && !hasSaved && !result && !error) return null;

  return (
    <section className="mb-5 grid gap-3">
      {hasPools &&
        pools.map((pool) => (
          <button
            key={pool.inviteCode}
            type="button"
            disabled={busy}
            onClick={() => onBringIn?.(pool.inviteCode)}
            className="min-h-14 w-full rounded-ui border-2 border-gold bg-[#FBF1D9] px-4 py-3 text-start disabled:opacity-50"
          >
            <span className="block font-medium">
              {t.rota.importTitle(pool.title)}
            </span>
            <span className="block text-base text-ink-soft">
              {t.rota.importCount(pool.memberCount)}
            </span>
          </button>
        ))}
      {hasPools && (
        <p className="text-base text-ink-soft">{t.rota.importHint}</p>
      )}
      {hasSaved && (
        <Button variant="ghost" onClick={() => setPicking(true)}>
          {t.rota.savedFrom}
        </Button>
      )}
      <ErrorLine error={error} />
      <p role="status" className="font-medium text-green empty:hidden">
        {result}
      </p>
      {picking && (
        <SavedPicker
          inviteCode={inviteCode}
          onClose={() => setPicking(false)}
          onStart={onStart}
        />
      )}
    </section>
  );
}

/** The list with the organizer's pool khatmas in it, for a backend that can read them. */
function BringPoolMembersIn({
  inviteCode,
  importable,
  importMembers,
  result,
  onResult,
}: {
  inviteCode: string;
  importable: NonNullable<RotaBackend["importable"]>;
  importMembers: NonNullable<RotaBackend["importMembers"]>;
  result: string | null;
  onResult: (result: string | null) => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const pools = useQuery(importable, backend.scope);
  const bring = useMutation(importMembers);
  const { busy, error, run } = useRotaCall(importErrors);

  const bringIn = (sourceInviteCode: string) => {
    onResult(null);
    return run(async () => {
      const done = await bring({ ...backend.authArgs(), sourceInviteCode });
      if ("ok" in done) onResult(t.rota.importResult(done.added, done.skipped));
      return done;
    });
  };

  return (
    <BringPeopleInList
      inviteCode={inviteCode}
      pools={pools}
      busy={busy}
      error={error}
      result={result}
      onBringIn={(code) => void bringIn(code)}
      onStart={() => onResult(null)}
    />
  );
}

function BringPeopleIn({
  inviteCode,
  result,
  onResult,
}: {
  inviteCode: string;
  result: string | null;
  onResult: (result: string | null) => void;
}) {
  const { importable, importMembers } = useRotaBackend(inviteCode);
  return importable && importMembers ? (
    <BringPoolMembersIn
      inviteCode={inviteCode}
      importable={importable}
      importMembers={importMembers}
      result={result}
      onResult={onResult}
    />
  ) : (
    <BringPeopleInList inviteCode={inviteCode} onStart={() => onResult(null)} />
  );
}

/**
 * Step 2 of 2: add people in order, hand out the leftover ajza', then start the khatma. Whoever
 * has no People view, and anyone on an archived khatma, is sent to `khatmaPath`, where «تمّ» goes too.
 */
export function RotaPeopleSetupContent({
  inviteCode,
  khatmaPath,
}: {
  inviteCode: string;
  khatmaPath: string;
}) {
  const navigate = useNavigate();
  const backend = useRotaBackend(inviteCode);
  const view = useQuery(backend.people, backend.scope);
  const finishSetup = useMutation(backend.finishSetup);
  const finishing = useRotaCall(t.rota.errors);
  const [giving, setGiving] = useState(false);
  const [renamingId, setRenamingId] = useState<Id<"rotaParticipants"> | null>(
    null,
  );
  // What the last import did: it stays until the organizer starts something else.
  const [importResult, setImportResult] = useState<string | null>(null);
  useEnsureJoinLink(inviteCode, view?.archived ? undefined : view?.joinLink);

  if (view === undefined) return null;
  // Only the organizer sets people up, and an archived khatma is read-only.
  if (view === null || view.archived) {
    return <Navigate to={khatmaPath} replace />;
  }

  const renaming = view.participants.find((p) => p.id === renamingId);

  return (
    <>
      <h1 className="font-display text-4xl leading-tight text-green-deep">
        {t.rota.setupTitle}
      </h1>
      <StepBar step={2} />

      <div className="mt-5">
        <BringPeopleIn
          inviteCode={inviteCode}
          result={importResult}
          onResult={setImportResult}
        />
        <AddPersonForm
          inviteCode={inviteCode}
          onStart={() => setImportResult(null)}
        />
      </div>

      <ol
        aria-label={t.rota.peopleList}
        className="mt-5 divide-y divide-line rounded-ui border-2 border-line bg-card px-4"
      >
        {view.participants.map((person, index) => (
          <li
            key={person.id}
            className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2"
          >
            <span className="w-7 shrink-0 text-center font-semibold text-green-deep">
              {toArabicDigits(index + 1)}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">
                {person.isMe ? t.rota.me : person.name}
              </span>
              <PersonPhone phone={person.phone} />
            </span>
            {person.juz.length > 0 && (
              <span className="ms-auto text-base text-ink-soft">
                {t.rota.juzOf(person.juz)}
              </span>
            )}
            <span className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 ps-10">
              <JoinChip
                person={person}
                isMe={person.isMe}
                title={view.title}
                daysKind={view.daysKind}
                joinLink={view.joinLink}
              />
              <button
                type="button"
                aria-label={t.rota.renameOf(
                  person.isMe ? t.rota.me : person.name,
                )}
                onClick={() => setRenamingId(person.id)}
                className="inline-flex min-h-11 items-center font-medium text-green underline underline-offset-4"
              >
                {t.rota.rename}
              </button>
            </span>
          </li>
        ))}
      </ol>

      {view.freeJuz.length > 0 && (
        <button
          type="button"
          onClick={() => setGiving(true)}
          className="mt-4 block min-h-14 w-full rounded-ui border-2 border-gold bg-[#FBF1D9] px-4 py-3 text-start"
        >
          <span className="block font-medium">
            {t.rota.leftover(view.freeJuz)}
          </span>
          <span className="block text-base text-ink-soft">
            {t.rota.leftoverHint}
          </span>
        </button>
      )}

      <div className="mt-6 grid gap-3">
        <ShareJoinLink
          title={view.title}
          daysKind={view.daysKind}
          joinLink={view.joinLink}
        />
        {/* The khatma's days start only once setup is done. */}
        <Button
          disabled={finishing.busy}
          onClick={() =>
            void finishing.run(
              () => finishSetup(backend.authArgs()),
              () => void navigate(khatmaPath),
            )
          }
        >
          {t.rota.done}
        </Button>
        <ErrorLine error={finishing.error} />
      </div>

      {renaming && (
        <RenameSheet
          inviteCode={inviteCode}
          person={renaming}
          onBack={() => setRenamingId(null)}
          onClose={() => setRenamingId(null)}
        />
      )}

      {giving && view.freeJuz.length > 0 && (
        <GiveJuzSheet
          inviteCode={inviteCode}
          view={view}
          onClose={() => setGiving(false)}
          onStart={() => setImportResult(null)}
        />
      )}
    </>
  );
}

/** The organizer's setup of the khatma in the address. */
export function RotaPeopleSetup() {
  const { inviteCode = "" } = useParams();
  return (
    <main className="mx-auto max-w-xl p-5">
      <RotaPeopleSetupContent
        inviteCode={inviteCode}
        khatmaPath={`/j/${encodeURIComponent(inviteCode)}`}
      />
    </main>
  );
}
