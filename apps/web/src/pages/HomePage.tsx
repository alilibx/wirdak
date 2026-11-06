import { api } from "@convex/_generated/api";
import { toArabicDigits } from "@convex/lib/digits";
import { JUZ, JUZ_COUNT } from "@convex/lib/juz";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { Button, buttonClass } from "../components/Button";
import { HelpReplyCard } from "../features/help/HelpReplyCard";
import { pendingResumePath } from "../features/verify/progress";
import { useSignInSheet } from "../features/verify/useSignInSheet";
import { t } from "../i18n/ar";
import { formatDate } from "../lib/format";
import { useSessionToken } from "../lib/session";
import { useClearDeadToken } from "../lib/useClearDeadToken";

export function HomePage() {
  // Someone who left for WhatsApp mid-take or mid-create and came back here (an older reply's
  // link, typing the address) goes back to the page that finishes it. Only when the app opened here
  // ("default" is the first history entry's key): choosing home in the app stays home.
  const opened = useLocation().key === "default";
  const [resumePath] = useState(() => (opened ? pendingResumePath() : null));
  if (resumePath !== null) return <Navigate to={resumePath} replace />;
  return <Home />;
}

function Home() {
  const sessionToken = useSessionToken();
  const me = useQuery(api.sessions.me, { sessionToken });
  const mine = useQuery(api.khatmas.mine, { sessionToken });
  // A stored token the server answers as signed out is dead; clearing it makes this page signed out.
  useClearDeadToken(sessionToken, me === null);
  const signIn = useSignInSheet();

  // The sheet sits outside the page body so it survives the reload a new session token triggers.
  return (
    <>
      {me === undefined || mine === undefined ? (
        <main aria-busy="true" className="mx-auto max-w-xl p-5">
          <p className="py-16 text-center text-xl text-ink-soft">
            {t.common.loading}
          </p>
        </main>
      ) : (
        <HomeContent me={me} mine={mine} onSignIn={signIn.open} />
      )}
      {signIn.sheet}
    </>
  );
}

type Me = NonNullable<FunctionReturnType<typeof api.sessions.me>>;
type Mine = FunctionReturnType<typeof api.khatmas.mine>;

function HomeContent({
  me,
  mine,
  onSignIn,
}: {
  me: Me | null;
  mine: Mine;
  onSignIn: () => void;
}) {
  const active = mine.filter((khatma) => !khatma.archived);
  const archived = mine.filter((khatma) => khatma.archived);
  return (
    <main className="mx-auto max-w-xl p-5">
      <header className="mb-3.5">
        <span className="font-display text-2xl text-green">{t.app.name}</span>
      </header>

      <HelpReplyCard />

      {me ? (
        <>
          <h1 className="mb-1 text-2xl font-semibold">
            {t.home.hello(me.displayName)}
          </h1>
          <h2 className="mb-3 text-ink-soft">{t.pages.home}</h2>
          {active.length === 0 ? (
            <p className="mb-5 rounded-ui border border-line bg-card p-4 leading-relaxed">
              {t.home.empty}
            </p>
          ) : (
            <ul className="grid gap-3">
              {active.map((khatma) => (
                <li key={khatma.inviteCode}>
                  <KhatmaCard khatma={khatma} />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5">
            <Link
              to="/new"
              className={buttonClass(
                active.length === 0 ? "primary" : "ghost",
                active.length === 0
                  ? ""
                  : "border-dashed font-semibold text-green",
              )}
            >
              {active.length === 0 ? t.home.startNewPlain : t.home.startNew}
            </Link>
          </div>
          {archived.length > 0 && (
            <details className="mt-8">
              <summary className="flex min-h-14 cursor-pointer items-center gap-2 text-xl font-semibold text-ink-soft">
                {t.home.archived}
                <span className="rounded-full bg-paper-2 px-3 py-0.5 text-base font-medium">
                  {toArabicDigits(archived.length)}
                </span>
              </summary>
              <ul className="mt-2 grid gap-3">
                {archived.map((khatma) => (
                  <li key={khatma.inviteCode}>
                    <KhatmaCard khatma={khatma} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <>
          <h1 className="mb-1 text-2xl font-semibold">{t.home.helloAnon}</h1>
          <p className="mb-5 leading-relaxed text-ink-soft">
            {t.home.signedOutIntro}
          </p>
          <Link to="/new" className={buttonClass("primary")}>
            {t.home.startNewPlain}
          </Link>
          <div className="mt-3">
            <Button variant="ghost" onClick={onSignIn}>
              {t.signIn.button}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

type Card = FunctionReturnType<typeof api.khatmas.mine>[number];

function KhatmaCard({ khatma }: { khatma: Card }) {
  const total = toArabicDigits(JUZ_COUNT);
  const done = toArabicDigits(khatma.done);
  const name = khatma.name ?? t.khatma.untitled(formatDate(khatma.createdAt));
  const heldName =
    khatma.holding === null
      ? null
      : JUZ.find((j) => j.number === khatma.holding)?.name;
  return (
    <Link
      to={`/j/${encodeURIComponent(khatma.inviteCode)}`}
      className="block rounded-[22px] border border-line bg-card px-[18px] py-4"
    >
      <span className="block font-display text-2xl text-green-deep">
        {name}
      </span>
      <span
        role="progressbar"
        aria-label={t.ring.label(done, total)}
        aria-valuemin={0}
        aria-valuemax={JUZ_COUNT}
        aria-valuenow={khatma.done}
        className="my-2.5 block h-3 overflow-hidden rounded-full bg-paper-2"
      >
        <span
          className="block h-full rounded-full bg-green"
          style={{ width: `${(khatma.done / JUZ_COUNT) * 100}%` }}
        />
      </span>
      {khatma.kind === "rota" ? (
        <span className="block text-base text-ink-soft">
          {t.rota.cardLine(done, total)}
        </span>
      ) : (
        <span className="flex justify-between gap-3 text-base text-ink-soft">
          <span>{t.home.doneOf(done, total)}</span>
          <span>{t.schedules[khatma.schedule]}</span>
        </span>
      )}
      {khatma.peopleCount !== null && (
        <span className="mt-2 inline-block rounded-full bg-paper-2 px-3 py-0.5 text-base font-medium text-ink-soft">
          {t.home.peopleCount(khatma.peopleCount)}
        </span>
      )}
      {!khatma.archived && khatma.hasNote && (
        <span className="mt-2 flex items-center gap-2 text-base font-semibold text-green-deep">
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-full bg-saffron"
          />
          {t.notes.newMessage}
        </span>
      )}
      {!khatma.archived && khatma.holding !== null && (
        <span className="mt-2 inline-block rounded-full bg-saffron-soft px-3 py-1 text-base font-semibold text-saffron-ink">
          {t.home.yours(toArabicDigits(khatma.holding), heldName ?? "")}
        </span>
      )}
    </Link>
  );
}
