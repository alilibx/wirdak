import type { TileView } from "@convex/khatmas";
import { toWesternDigits } from "@convex/lib/digits";
import { JUZ_COUNT } from "@convex/lib/juz";
import { t } from "../i18n/ar";

const CENTER = 125;
const RADIUS = 108;

type Props = { tiles: TileView[]; gold?: boolean };

/** Misbaha ring: one bead per juz', green when done, saffron when being read, dashed when open. */
export function Ring({ tiles, gold = false }: Props) {
  const done = tiles.filter((x) => x.state === "done").length;
  // CSS variables, so the ring follows the theme. They go in `style`: SVG attributes don't
  // take var().
  const thread = gold ? "rgba(217,169,63,.5)" : "var(--thread)";
  const tassel = gold ? "#D9A93F" : "var(--green-fill)";
  const doneFill = tassel;

  return (
    <div
      role="img"
      aria-label={t.ring.label(
        toWesternDigits(done),
        toWesternDigits(JUZ_COUNT),
      )}
      className="relative mx-auto mt-3.5 mb-1.5 w-[250px]"
    >
      <svg
        viewBox="0 0 250 290"
        aria-hidden="true"
        className="block w-full overflow-visible"
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          style={{ stroke: thread }}
          strokeWidth="2"
        />
        <path
          d="M125 233 L125 252"
          style={{ stroke: thread }}
          strokeWidth="2"
        />
        <circle cx="125" cy="258" r="7" style={{ fill: tassel }} />
        <path
          d="M119 266 L114 288 M122 266 L120 289 M125 266 L125 290 M128 266 L130 289 M131 266 L136 288"
          style={{ stroke: tassel }}
          strokeWidth="2"
          strokeLinecap="round"
        />
        {tiles.map((tile, i) => {
          const angle = -Math.PI / 2 + (i / JUZ_COUNT) * Math.PI * 2;
          const base = {
            cx: (CENTER + RADIUS * Math.cos(angle)).toFixed(1),
            cy: (CENTER + RADIUS * Math.sin(angle)).toFixed(1),
          };
          let fill = "var(--card)";
          let stroke = "var(--dash)";
          let dash: string | undefined = "3 2";
          if (tile.state === "done") {
            fill = stroke = doneFill;
            dash = undefined;
          } else if (tile.state === "reading") {
            fill = "var(--saffron)";
            stroke = "var(--saffron-stroke)";
            dash = undefined;
          }
          return (
            <circle
              key={tile.juz}
              data-bead={tile.juz}
              {...base}
              r="9.5"
              style={{ fill, stroke }}
              strokeWidth="2"
              strokeDasharray={dash}
            />
          );
        })}
      </svg>
      {!gold && (
        <div className="absolute inset-x-0 top-0 bottom-[26px] flex flex-col items-center justify-center text-center">
          <div className="text-[2.6rem] leading-none font-bold text-green-deep">
            {toWesternDigits(done)}
          </div>
          <div className="mt-1.5 text-base text-ink-soft">
            {t.ring.ofThirty(toWesternDigits(JUZ_COUNT))}
          </div>
        </div>
      )}
    </div>
  );
}
