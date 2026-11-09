import type { api } from "@convex/_generated/api";
import { toWesternDigits } from "@convex/lib/digits";
import { JUZ, JUZ_COUNT } from "@convex/lib/juz";
import type { FunctionReturnType } from "convex/server";
import { Link } from "react-router";
import { t } from "../i18n/ar";
import { formatDate } from "../lib/format";
import { buttonClass } from "./Button";
import { Sheet } from "./Sheet";

type Khatmas = FunctionReturnType<typeof api.khatmas.mine>;

/** The khatmas to jump to: archived ones are read-only, and have no place in the switcher. */
export function switchable(khatmas: Khatmas): Khatmas {
  return khatmas.filter((khatma) => !khatma.archived);
}

/** Whether there is another active khatma to switch to from the one on screen. */
export function canSwitch(khatmas: Khatmas, currentCode: string): boolean {
  return switchable(khatmas).some(
    (khatma) => khatma.inviteCode !== currentCode,
  );
}

type Props = {
  khatmas: Khatmas;
  /** The khatma on screen: marked, and tapping it only closes the sheet. */
  currentCode: string;
  onClose: () => void;
};

/** Jumps from one of the person's khatmas to another without going home (navigation spec 4.3). */
export function SwitchKhatmaSheet({ khatmas, currentCode, onClose }: Props) {
  return (
    <Sheet title={t.nav.switchTitle} onClose={onClose}>
      <ul className="grid gap-2.5">
        {switchable(khatmas).map((khatma) => (
          <li key={khatma.inviteCode}>
            <Row
              khatma={khatma}
              current={khatma.inviteCode === currentCode}
              onClose={onClose}
            />
          </li>
        ))}
      </ul>
      <Link
        to="/new"
        onClick={onClose}
        className={buttonClass(
          "ghost",
          "mt-3 border-dashed font-semibold text-green",
        )}
      >
        {t.home.startNewPlain}
      </Link>
    </Sheet>
  );
}

function Row({
  khatma,
  current,
  onClose,
}: {
  khatma: Khatmas[number];
  current: boolean;
  onClose: () => void;
}) {
  const name = khatma.name ?? t.khatma.untitled(formatDate(khatma.createdAt));
  const heldName =
    khatma.holding === null
      ? null
      : (JUZ.find((j) => j.number === khatma.holding)?.name ?? "");
  return (
    <Link
      to={`/j/${encodeURIComponent(khatma.inviteCode)}`}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        // Already here: closing is all there is to do.
        if (current) event.preventDefault();
        onClose();
      }}
      className={`block min-h-14 rounded-ui bg-paper px-4 py-3 ${
        current ? "border-2 border-green" : "border border-line"
      }`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="font-display text-xl text-green-deep">{name}</span>
        {current && (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0 text-green"
          >
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        )}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-ink-soft">
        <span>
          {(khatma.kind === "rota" ? t.rota.cardLine : t.home.doneOf)(
            toWesternDigits(khatma.done),
            toWesternDigits(JUZ_COUNT),
          )}
        </span>
        {heldName !== null && khatma.holding !== null && (
          <span className="rounded-full bg-saffron-soft px-3 py-0.5 font-semibold text-saffron-ink">
            {t.home.yours(toWesternDigits(khatma.holding), heldName)}
          </span>
        )}
        {khatma.hasNote && (
          <span className="flex items-center gap-1.5 font-semibold text-green-deep">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full bg-saffron"
            />
            {t.notes.newMessage}
          </span>
        )}
      </span>
    </Link>
  );
}
