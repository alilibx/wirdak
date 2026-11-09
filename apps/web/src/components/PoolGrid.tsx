import type { TileView } from "@convex/khatmas";
import { toWesternDigits } from "@convex/lib/digits";
import { t } from "../i18n/ar";
import { Tile } from "./Tile";

type Props = {
  tiles: TileView[];
  onTake: (juz: number) => void;
  /** An archived khatma: the grid shows, but nothing can be taken. */
  readOnly?: boolean;
};

const swatch = "me-1.5 inline-block size-3 rounded-full align-[-1px]";

export function PoolGrid({ tiles, onTake, readOnly = false }: Props) {
  const open = tiles.filter((x) => x.state === "open").length;
  return (
    <section id="pool" className="scroll-mt-4">
      <div className="mt-6 mb-2.5 flex items-baseline justify-between px-0.5">
        <h2 className="text-xl font-semibold">{t.khatma.poolHeading}</h2>
        {/* Nothing can be taken from an archived khatma, so "N open" would promise it. */}
        {!readOnly && (
          <span className="text-base text-ink-soft">
            {t.khatma.openCount(toWesternDigits(open))}
          </span>
        )}
      </div>
      <ul className="mb-3 flex flex-wrap gap-3 px-0.5 text-base text-ink-soft">
        <li>
          <i className={`${swatch} border-2 border-dashed border-[#8A7D62]`} />
          {t.legend.open}
        </li>
        <li>
          <i className={`${swatch} bg-saffron`} />
          {t.legend.reading}
        </li>
        <li>
          <i className={`${swatch} bg-green`} />
          {t.legend.done}
        </li>
      </ul>
      <div className="grid grid-cols-3 gap-2.5">
        {tiles.map((tile) => (
          <Tile
            key={tile.juz}
            tile={tile}
            onTake={onTake}
            readOnly={readOnly}
          />
        ))}
      </div>
    </section>
  );
}
