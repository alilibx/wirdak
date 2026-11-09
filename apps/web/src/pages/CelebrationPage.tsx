import type { TileView } from "@convex/khatmas";
import { toWesternDigits } from "@convex/lib/digits";
import { buttonClass } from "../components/Button";
import { WhatsAppIcon } from "../components/WhatsAppIcon";
import { useHideHelpButton } from "../features/help/helpUi";
import { useHideBottomBar } from "../features/nav/bottomBarUi";
import { Ring } from "../components/Ring";
import { t } from "../i18n/ar";
import { waShareLink } from "../lib/whatsapp";

type Props = {
  /** The khatma's name (or its dated fallback title). */
  title: string;
  round: number;
  /** How many took part; null when the server has no count. */
  participants: number | null;
  tiles: TileView[];
  busy: boolean;
  onContinue: () => void;
};

/** Shown once per completed round, in place of the khatma. Nobody is named and nobody is ranked. */
export function CelebrationPage({
  title,
  round,
  participants,
  tiles,
  busy,
  onContinue,
}: Props) {
  // The celebration fills the screen; the help button would only get in the way.
  useHideHelpButton();
  useHideBottomBar();
  const roundText = toWesternDigits(round);
  // The round just ended, so every bead is done, whatever state the next round shows.
  const done = tiles.map((tile) => ({
    ...tile,
    state: "done" as const,
    readerName: null,
  }));

  return (
    <main className="min-h-screen bg-[radial-gradient(120%_70%_at_50%_30%,#23674F,var(--green-deep)_70%)] text-center text-[#F6EEDB]">
      <div className="mx-auto max-w-xl p-5 pb-10">
        <Ring tiles={done} gold />
        <h1 className="mt-1.5 font-display text-5xl leading-tight text-gold">
          {t.celebration.title}
        </h1>
        <p className="mt-1.5 text-xl">
          {t.celebration.subtitle(title, roundText)}
        </p>
        {participants !== null && (
          <p className="mt-1.5 text-lg text-[#E7DFC9]">
            {t.celebration.participants(toWesternDigits(participants))}
          </p>
        )}

        <div className="my-6 rounded-[22px] border border-gold/40 bg-white/10 px-4 py-4.5">
          {t.celebration.duas.map((dua, i) => (
            <div key={dua.ref}>
              {i > 0 && (
                <hr className="my-3 border-0 border-t border-dashed border-gold/40" />
              )}
              <p lang="ar" className="font-quran text-[1.55rem] leading-[2.3]">
                {dua.text}
              </p>
              <p className="text-base text-[#E7DFC9]">{dua.ref}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3.5">
          <a
            href={waShareLink(t.celebration.shareMessage(roundText))}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("gold", "no-underline")}
          >
            <WhatsAppIcon />
            {t.celebration.share}
          </a>
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="flex min-h-14 w-full items-center justify-center rounded-ui border-2 border-white/30 bg-white/10 px-5 py-3 text-[1.15rem] font-medium text-[#F6EEDB] transition duration-150 disabled:pointer-events-none disabled:opacity-50"
          >
            {t.celebration.continue}
          </button>
        </div>
      </div>
    </main>
  );
}
