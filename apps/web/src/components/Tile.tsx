import type { TileView } from "@convex/khatmas";
import { toWesternDigits } from "@convex/lib/digits";
import { t } from "../i18n/ar";

type Props = {
  tile: TileView;
  onTake: (juz: number) => void;
  /** An archived khatma: nothing can be taken. */
  readOnly?: boolean;
};

const base =
  "relative flex min-h-24 w-full flex-col items-center justify-between rounded-2xl border-2 px-2 pt-2.5 pb-2 text-center font-sans disabled:cursor-default";

// 18px text. At 390px a tile has about 90px inside, so the chip keeps its padding small and
// the longest state word (t.tile.mine, about 81px) fits on one line; on narrower phones it wraps
// rather than being cut, because the state word is what tells tiles apart without color.
const chip =
  "max-w-full rounded-full px-1 py-0.5 text-base leading-snug font-semibold";

/** One juz'. Only open tiles can be pressed. The state is always a word; reader names show on "reading" tiles only. */
export function Tile({ tile, onTake, readOnly = false }: Props) {
  const { juz, name, state, readerName, isMine } = tile;
  const number = toWesternDigits(juz);
  // A done tile never shows a name, whatever the data says.
  const reader = state === "reading" && !isMine ? readerName : null;

  const stateWord =
    state === "done"
      ? t.tile.doneWord
      : state === "reading"
        ? isMine
          ? t.tile.mine
          : t.tile.reading
        : t.tile.open;
  const label = [t.tile.juz(number), name, stateWord, reader]
    .filter(Boolean)
    .join(t.common.listSeparator);

  // An open tile of an archived khatma looks like the others: nothing invites a press.
  const look =
    state === "open"
      ? readOnly
        ? "border-dashed border-[#8A7D62] bg-card text-ink"
        : "border-dashed border-[#8A7D62] bg-card text-ink hover:border-green focus-visible:border-green"
      : state === "reading"
        ? "border-saffron bg-saffron-soft text-ink"
        : "border-green bg-green text-[#F4EEDD]";
  const chipLook =
    state === "open"
      ? "bg-paper-2 text-ink-soft"
      : state === "reading"
        ? "bg-[#fff8e6] text-saffron-ink"
        : "bg-white/15 text-[#F4EEDD]";
  const mine = isMine
    ? "shadow-[0_0_0_3px_var(--card),0_0_0_5px_var(--saffron)]"
    : "";

  return (
    <button
      type="button"
      disabled={state !== "open" || readOnly}
      aria-label={label}
      onClick={() => onTake(juz)}
      className={`${base} ${look} ${mine}`}
    >
      <span className="text-[1.45rem] leading-none font-bold">{number}</span>
      <span className="text-base font-medium">{name}</span>
      <span className={`${chip} ${chipLook}`}>
        {state === "done"
          ? t.tile.done
          : state === "reading"
            ? isMine
              ? t.tile.mine
              : t.tile.reading
            : t.tile.open}
      </span>
      {reader && (
        <span className="line-clamp-2 max-w-full text-base leading-snug break-words text-saffron-ink">
          {reader}
        </span>
      )}
    </button>
  );
}
