import type { Id } from "@convex/_generated/dataModel";
import { addDays } from "@convex/lib/rota";
import type { TodayView } from "@convex/lib/rotaOps";
import { localDate } from "@convex/lib/wakingTime";
import { useMutation } from "convex/react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { toArabicDigits } from "@convex/lib/digits";
import { useRotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { useRotaCall } from "./useRotaCall";
import { formatIsoDate, formatTime } from "./format";

type Tile = TodayView["tiles"][number];

const todayErrors: Record<string, string> = t.rota.todayErrors;
const swatch = "me-1.5 inline-block size-3 rounded-full align-[-1px]";

const LOOK: Record<Tile["state"], string> = {
  done: "border-green bg-green text-[#F4EEDD]",
  unread: "border-dashed border-[#8A7D62] bg-card text-ink",
  reassigned: "border-saffron bg-saffron-soft text-ink",
};

const WORD: Record<Tile["state"], string> = {
  done: t.rota.legendDone,
  unread: t.rota.legendUnread,
  reassigned: t.rota.legendReassigned,
};

/** One juz' of the day: its number, and its state as a border and a word for screen readers. */
function GridTile({
  tile,
  disabled,
  onPress,
}: {
  tile: Tile;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={t.rota.tileLabel(tile.juz, WORD[tile.state])}
      onClick={onPress}
      className={`flex min-h-14 items-center justify-center gap-0.5 rounded-xl border-2 text-xl font-bold disabled:cursor-default ${LOOK[tile.state]}`}
    >
      {tile.state === "done" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      )}
      {toArabicDigits(tile.juz)}
    </button>
  );
}

/** What the organizer can do with one juz' of today: who reads it, give it away, or record it. */
function TileSheet({
  inviteCode,
  view,
  tile,
  onClose,
}: {
  inviteCode: string;
  view: TodayView;
  tile: Tile;
  onClose: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const reassign = useMutation(backend.reassign);
  const markDone = useMutation(backend.markDone);
  const markNotDone = useMutation(backend.markNotDone);
  const [picking, setPicking] = useState(false);
  const { busy, error, run } = useRotaCall(todayErrors);
  const me = view.participants.find((p) => p.isMe);
  const args = backend.authArgs();

  const give = (participantId: Id<"rotaParticipants">) =>
    run(
      () => reassign({ ...args, readId: tile.readId, participantId }),
      onClose,
    );

  if (tile.state === "done") {
    return (
      <Sheet title={t.rota.doneTitle(tile.juz)} onClose={onClose}>
        {tile.readerName && (
          <p className="text-ink-soft">{t.rota.readBy(tile.readerName)}</p>
        )}
        <div className="mt-4">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                () => markNotDone({ ...args, readId: tile.readId }),
                onClose,
              )
            }
          >
            {t.rota.undoDone}
          </Button>
        </div>
        <ErrorLine error={error} />
      </Sheet>
    );
  }

  if (picking) {
    return (
      <Sheet title={t.rota.pickTitle(tile.juz)} onClose={onClose}>
        <ul className="grid gap-2">
          {view.participants.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                disabled={busy || person.id === tile.readerId}
                onClick={() => void give(person.id)}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-ui border-2 border-line bg-card px-4 text-start disabled:opacity-60"
              >
                <span className="font-medium">
                  {person.isMe ? t.rota.me : person.name}
                </span>
                <span className="text-base text-ink-soft">
                  {person.id === tile.readerId
                    ? t.rota.readingIt
                    : person.doneToday
                      ? t.rota.finishedToday
                      : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <ErrorLine error={error} />
        <div className="mt-4">
          <Button variant="ghost" onClick={() => setPicking(false)}>
            {t.rota.back}
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={t.rota.unreadTitle(tile.juz)} onClose={onClose}>
      {tile.holderName && (
        <p className="text-ink-soft">{t.rota.holder(tile.holderName)}</p>
      )}
      {tile.state === "reassigned" && tile.readerName && (
        <p className="mt-1 text-ink-soft">
          {t.rota.readerNow(tile.readerName)}
        </p>
      )}
      {tile.answer !== null && (
        <p className="mt-1 text-ink-soft">
          {tile.answer === "notYet" ? t.rota.answerNotYet : t.rota.answerNone}
        </p>
      )}
      <div className="mt-4 grid gap-3">
        <Button disabled={busy} onClick={() => setPicking(true)}>
          {t.rota.assign}
        </Button>
        {me && me.id !== tile.readerId && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void give(me.id)}
          >
            {t.rota.readMyself}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(() => markDone({ ...args, readId: tile.readId }), onClose)
          }
        >
          {t.rota.markDone}
        </Button>
      </div>
      <ErrorLine error={error} />
    </Sheet>
  );
}

/** The line about the next reading day: «التالي: الختمة ١٣ · غداً ٨:٠٠ ص». */
function nextLine(view: TodayView, dayAt: number, timeZone: string) {
  if (view.next.date === null) return null;
  const tomorrow = addDays(localDate(Date.now(), timeZone), 1);
  const time = formatTime(dayAt);
  return t.rota.nextDay(
    view.next.number,
    view.next.date === tomorrow
      ? t.rota.nextTomorrow(time)
      : t.rota.nextOn(formatIsoDate(view.next.date), time),
  );
}

/**
 * Setup was left unfinished: no day starts until the organizer starts the khatma here. Only
 * someone with Settings may start it; anyone else is only told.
 */
function StartKhatma({
  inviteCode,
  canStart,
}: {
  inviteCode: string;
  canStart: boolean;
}) {
  const backend = useRotaBackend(inviteCode);
  const finishSetup = useMutation(backend.finishSetup);
  const { busy, error, run } = useRotaCall(t.rota.errors);
  return (
    <div className="rounded-ui border-2 border-line bg-card p-4">
      <p className="text-xl leading-relaxed">{t.rota.setupNotDone}</p>
      {canStart && (
        <div className="mt-4">
          <Button
            disabled={busy}
            onClick={() => void run(() => finishSetup(backend.authArgs()))}
          >
            {t.rota.startKhatma}
          </Button>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/** The organizer's Today screen: the day, how many are done, and the 30 ajza' to tap. */
export function TodayPanel({
  inviteCode,
  view,
  dayAt,
  timeZone,
  canStart,
}: {
  inviteCode: string;
  view: TodayView;
  /** When the next day's message goes out, minutes after midnight. */
  dayAt: number;
  timeZone: string;
  /** Whether the viewer may start an unfinished khatma: the owner, Settings, or an admin. */
  canStart: boolean;
}) {
  const [openRead, setOpenRead] = useState<Id<"rotaReads"> | null>(null);
  const { day } = view;
  const open = view.tiles.find((tile) => tile.readId === openRead) ?? null;
  const next = nextLine(view, dayAt, timeZone);
  // With no open day: when the first or next one starts, or that the dates have run out.
  const before =
    view.next.date !== null
      ? t.rota.notStarted(
          view.next.number,
          formatIsoDate(view.next.date),
          formatTime(dayAt),
        )
      : view.paused && !view.archived
        ? null
        : t.rota.ended;
  const noDay =
    !view.setupDone && !view.archived ? (
      <StartKhatma inviteCode={inviteCode} canStart={canStart} />
    ) : (
      before && (
        <p className="rounded-ui border-2 border-line bg-card p-4 text-xl leading-relaxed">
          {before}
        </p>
      )
    );

  return (
    <div className="mt-4">
      {view.paused && !view.archived && (
        <p
          role="note"
          className="mb-3 rounded-ui border-2 border-gold bg-[#FBF1D9] p-3 font-medium"
        >
          {t.rota.pausedBanner}
        </p>
      )}

      {day === null ? (
        noDay
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-xl font-semibold">
              {t.rota.heading(day.number, formatIsoDate(day.date))}
            </h2>
            {day.cycle > 1 && (
              <span className="rounded-full border border-line bg-paper-2 px-3 py-1 text-base text-ink-soft">
                {t.rota.cycle(day.cycle)}
              </span>
            )}
          </div>
          <p className="mt-2 flex items-baseline gap-3">
            <span className="font-display text-5xl text-green-deep">
              {t.rota.progress(day.doneCount, view.tiles.length)}
            </span>
            <span className="text-ink-soft">{t.rota.readToday}</span>
          </p>
          {day.completedAt !== null && (
            <p role="status" className="mt-2 font-medium text-green-deep">
              {t.rota.completeBanner(day.number)}
            </p>
          )}
        </>
      )}
      {day !== null && next && <p className="mt-2 text-ink-soft">{next}</p>}

      {day !== null && (
        <section aria-label={t.rota.gridLabel} className="mt-5">
          <ul className="mb-3 flex flex-wrap gap-3 px-0.5 text-base text-ink-soft">
            <li>
              <i
                className={`${swatch} border-2 border-dashed border-[#8A7D62]`}
              />
              {t.rota.legendUnread}
            </li>
            <li>
              <i className={`${swatch} bg-saffron`} />
              {t.rota.legendReassigned}
            </li>
            <li>
              <i className={`${swatch} bg-green`} />
              {t.rota.legendDone}
            </li>
          </ul>
          <div className="grid grid-cols-6 gap-1.5">
            {view.tiles.map((tile) => (
              <GridTile
                key={tile.readId}
                tile={tile}
                disabled={view.archived}
                onPress={() => setOpenRead(tile.readId)}
              />
            ))}
          </div>
        </section>
      )}

      {open && (
        <TileSheet
          // A tile that changes state (marked done) is a different sheet.
          key={`${open.readId}-${open.state}`}
          inviteCode={inviteCode}
          view={view}
          tile={open}
          onClose={() => setOpenRead(null)}
        />
      )}
    </div>
  );
}
