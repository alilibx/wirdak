import type { Id } from "@convex/_generated/dataModel";
import type { TodayView } from "@convex/lib/rotaOps";
import { useState } from "react";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { formatIsoDate } from "./format";
import { DayGrid, nextLine, TileSheet, type Tile } from "./TodayPanel";

const STRIP: Record<Tile["state"], string> = {
  done: "bg-green",
  reassigned: "bg-saffron",
  unread: "border-[1.5px] border-dashed border-[#8A7D62] bg-card",
};

/**
 * The open day as a card above the tabs: its number, how many are done, a strip of the 30 ajza'
 * and when the next day comes. Pressing it opens the 30 tiles in a sheet, and a tile opens the
 * same sheet the Today tab has; closing that goes back to the tiles.
 */
export function DayCard({
  inviteCode,
  view,
  dayAt,
  timeZone,
}: {
  inviteCode: string;
  view: TodayView;
  /** When the next day's message goes out, minutes after midnight. */
  dayAt: number;
  timeZone: string;
}) {
  const [gridOpen, setGridOpen] = useState(false);
  const [openRead, setOpenRead] = useState<Id<"rotaReads"> | null>(null);
  const { day } = view;
  if (day === null) return null;
  const total = view.tiles.length;
  const heading = t.rota.heading(day.number, formatIsoDate(day.date));
  const next = nextLine(view, dayAt, timeZone);
  const open = view.tiles.find((tile) => tile.readId === openRead) ?? null;

  return (
    <section
      aria-label={heading}
      className="mt-4 rounded-ui border-2 border-line bg-card"
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t.rota.dayCardOpen(day.number, day.doneCount, total)}
        onClick={() => setGridOpen(true)}
        className="block w-full rounded-ui p-4 text-start"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-lg font-semibold">{heading}</span>
            {day.cycle > 1 && (
              <span className="rounded-full border border-line bg-paper-2 px-3 py-0.5 text-base text-ink-soft">
                {t.rota.cycle(day.cycle)}
              </span>
            )}
          </span>
          <span className="inline-flex items-center gap-1 text-base font-semibold text-green">
            {t.rota.dayCardMore}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="rtl:-scale-x-100"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </span>
        <span className="mt-1 flex items-baseline gap-3">
          <span className="font-display text-5xl text-green-deep">
            {t.rota.progress(day.doneCount, total)}
          </span>
          <span className="text-ink-soft">{t.rota.readToday}</span>
        </span>
        <span
          aria-hidden="true"
          className="mt-3 grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
        >
          {view.tiles.map((tile) => (
            <i
              key={tile.readId}
              className={`h-3.5 rounded-[3px] ${STRIP[tile.state]}`}
            />
          ))}
        </span>
      </button>
      {(day.completedAt !== null || next) && (
        <div className="grid gap-1 px-4 pb-4">
          {day.completedAt !== null && (
            <p role="status" className="font-medium text-green-deep">
              {t.rota.completeBanner(day.number)}
            </p>
          )}
          {next && <p className="text-ink-soft">{next}</p>}
        </div>
      )}

      {gridOpen && open === null && (
        <Sheet title={heading} onClose={() => setGridOpen(false)}>
          <p className="text-ink-soft">
            {t.rota.progress(day.doneCount, total)} {t.rota.readToday}
          </p>
          <DayGrid
            view={view}
            className="mt-4"
            onPress={(tile) => setOpenRead(tile.readId)}
          />
        </Sheet>
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
    </section>
  );
}
