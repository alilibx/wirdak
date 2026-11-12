import type { TileView } from "@convex/khatmas";
import type { NoteView } from "@convex/notes";
import { t } from "../i18n/ar";
import { Button } from "./Button";
import { WhatsAppIcon } from "./WhatsAppIcon";

/**
 * The juz' a note's take button offers, or `null` for no button. Nobody who already holds a
 * juz' can take another. An open-for-help note offers the lowest listed juz' that is still
 * open (the list can have gone stale); a behind note offers the suggestion, else the first open one.
 */
export function takeTarget(
  note: Pick<NoteView, "kind" | "juz">,
  tiles: readonly TileView[],
  holding: number | null,
  suggestion: number | null,
): number | null {
  if (holding !== null) return null;
  const open = tiles.filter((x) => x.state === "open").map((x) => x.juz);
  if (note.kind === "openForHelp") {
    const listed = note.juz.filter((juz) => open.includes(juz));
    return listed.length > 0 ? Math.min(...listed) : null;
  }
  if (note.kind === "behind") return suggestion ?? open[0] ?? null;
  return null;
}

type Props = {
  note: NoteView;
  /** From `takeTarget`: the juz' the take button opens, or `null` when it should not show. */
  takeJuz: number | null;
  onStillReading: () => void;
  onFinish: () => void;
  onRelease: () => void;
  onTake: (juz: number) => void;
  onInvite: () => void;
  onDismiss: () => void;
  busy?: boolean;
};

/** A private note on the khatma page: its text, and the few things that can be done about it. */
export function NoteCard({
  note,
  takeJuz,
  onStillReading,
  onFinish,
  onRelease,
  onTake,
  onInvite,
  onDismiss,
  busy = false,
}: Props) {
  const take = (label: string) =>
    takeJuz !== null && (
      <Button onClick={() => onTake(takeJuz)} disabled={busy}>
        {label}
      </Button>
    );

  return (
    <div className="rounded-3xl border-2 border-saffron bg-linear-to-br from-note-from to-saffron-soft p-4.5">
      <p className="text-lg leading-relaxed text-ink">{t.notes.text(note)}</p>
      <div className="mt-3 grid gap-3">
        {note.kind === "almostUp" && (
          <>
            <Button onClick={onStillReading} disabled={busy}>
              {t.notes.stillReading}
            </Button>
            <Button variant="gold" onClick={onFinish} disabled={busy}>
              {t.notes.finished}
            </Button>
            <button
              type="button"
              onClick={onRelease}
              disabled={busy}
              className="min-h-14 text-base font-medium text-ink-soft underline underline-offset-4 disabled:opacity-50"
            >
              {t.notes.cantFinish}
            </button>
          </>
        )}
        {note.kind === "openForHelp" && (
          <>
            {take(t.notes.takeJuz)}
            <Button variant="whatsapp" onClick={onInvite} disabled={busy}>
              <WhatsAppIcon />
              {t.notes.sendInvite}
            </Button>
            <Button variant="ghost" onClick={onDismiss} disabled={busy}>
              {t.notes.ok}
            </Button>
          </>
        )}
        {note.kind === "behind" && (
          <>
            {take(t.notes.takeOne)}
            <Button variant="ghost" onClick={onDismiss} disabled={busy}>
              {t.notes.ok}
            </Button>
          </>
        )}
        {note.kind !== "almostUp" &&
          note.kind !== "openForHelp" &&
          note.kind !== "behind" && (
            <Button variant="ghost" onClick={onDismiss} disabled={busy}>
              {t.notes.ok}
            </Button>
          )}
      </div>
    </div>
  );
}
