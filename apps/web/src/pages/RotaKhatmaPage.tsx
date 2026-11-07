import { api } from "@convex/_generated/api";
import type { OrganizerAccess } from "@convex/lib/organizerAuth";
import type { TodayView } from "@convex/lib/rotaOps";
import type { NoteView } from "@convex/notes";
import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { buttonClass } from "../components/Button";
import { KhatmaTabs } from "../components/KhatmaTabs";
import { NoteCard } from "../components/NoteCard";
import { canSwitch, SwitchKhatmaSheet } from "../components/SwitchKhatmaSheet";
import { WhatsAppIcon } from "../components/WhatsAppIcon";
import {
  ArchivedBanner,
  ArchivedSection,
} from "../features/khatma/ArchivedActions";
import { DeletingPage, useDeleting } from "../features/khatma/deleting";
import { useSignInSheet } from "../features/verify/useSignInSheet";
import { useRotaBackend } from "../features/rota/backend";
import { ErrorLine } from "../features/rota/ErrorLine";
import { DayCard } from "../features/rota/DayCard";
import { PeoplePanel } from "../features/rota/PeoplePanel";
import {
  noDayLine,
  PausedBanner,
  StartKhatma,
  TodayPanel,
} from "../features/rota/TodayPanel";
import { useRotaCall } from "../features/rota/useRotaCall";
import { t } from "../i18n/ar";
import { getSessionToken, useSessionToken } from "../lib/session";
import { RotaSettingsContent } from "./RotaSettingsPage";

type RotaTab = "today" | "people" | "settings";

const TABS = [
  { id: "today", label: t.rota.tabs.today },
  { id: "people", label: t.rota.tabs.people },
] as const satisfies readonly { id: RotaTab; label: string }[];

/** The new layout's tabs: the people first, then the settings; the day is a card above them. */
const NEW_TABS = [
  { id: "people", label: t.rota.tabs.people },
  { id: "settings", label: t.rota.tabs.settings },
] as const satisfies readonly { id: RotaTab; label: string }[];

/** The `?tab=` value, whichever layout reads it. */
const parseRotaTab = (value: string | null): RotaTab =>
  value === "people" || value === "settings" ? value : "today";

/** Whether this access opens the organizer's page: the owner, or a co-organizer with a switch on. */
const runsKhatma = (
  access: OrganizerAccess | null,
): access is OrganizerAccess =>
  access !== null &&
  (access.owner || access.readings || access.people || access.settings);

const pill =
  "inline-flex min-h-11 max-w-full items-center rounded-full border-2 border-green px-3.5 text-base font-semibold text-green";

function Loading() {
  return (
    <main aria-busy="true" className="mx-auto max-w-xl p-5">
      <p className="py-16 text-center text-xl text-ink-soft">
        {t.common.loading}
      </p>
    </main>
  );
}

/**
 * Everyone but the organizer: members are on WhatsApp, and have no page to run. A visitor who is
 * signed out may be the organizer on a new phone, so they can sign in from here.
 */
function WhatsAppPage({
  title,
  archived,
  joinLink,
  onSignIn,
}: {
  title: string;
  /** An archived khatma says so, and nobody can join it. */
  archived: boolean;
  /** Opens WhatsApp with the join message typed; null while the khatma has none. */
  joinLink: string | null;
  onSignIn: (() => void) | null;
}) {
  return (
    <main className="mx-auto max-w-xl p-5">
      <header className="mb-3.5">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center font-display text-2xl text-green"
        >
          {t.app.name}
        </Link>
      </header>
      <h1 className="font-display text-4xl leading-tight break-words text-green-deep">
        {title}
      </h1>
      {archived ? (
        <ArchivedBanner />
      ) : (
        <p className="mt-4 text-xl leading-relaxed">{t.rota.whatsappOnly}</p>
      )}
      {!archived && joinLink && (
        <a
          href={joinLink}
          target="_blank"
          rel="noopener"
          className={buttonClass("whatsapp", "mt-5 no-underline")}
        >
          <WhatsAppIcon />
          {t.rota.joinOnWhatsApp}
        </a>
      )}
      {onSignIn && (
        <button
          type="button"
          onClick={onSignIn}
          className="mt-4 min-h-14 font-semibold text-green underline underline-offset-4"
        >
          {t.rota.imOrganizer}
        </button>
      )}
    </main>
  );
}

const noop = () => {};

/** The organizer's notes about the khatma (the unread list, the day's summary), each to dismiss. */
function RotaNotes({ notes }: { notes: NoteView[] }) {
  const dismiss = useMutation(api.notes.dismiss);
  const { busy, error, run } = useRotaCall(t.rota.errors);
  if (notes.length === 0) return null;
  return (
    <section aria-label={t.notes.heading} className="mt-4 grid gap-3">
      {notes.map((note) => (
        <NoteCard
          key={note.noteId}
          note={note}
          takeJuz={null}
          onStillReading={noop}
          onFinish={noop}
          onRelease={noop}
          onTake={noop}
          onInvite={noop}
          onDismiss={() =>
            void run(async () => {
              await dismiss({
                sessionToken: getSessionToken() ?? undefined,
                noteId: note.noteId,
              });
            })
          }
          busy={busy}
        />
      ))}
      <ErrorLine error={error} />
    </section>
  );
}

/**
 * The new layout's day, above the tabs: the pause banner, the start button while setup is
 * unfinished, and the open day as a card. With no open day, the line of when the next day comes or
 * that the days have ended; before khatma 1 only for a viewer with no Settings tab to read it in.
 */
function AboveTabs({
  inviteCode,
  view,
  canStart,
  sayStart,
}: {
  inviteCode: string;
  view: TodayView;
  canStart: boolean;
  sayStart: boolean;
}) {
  const unfinished = !view.setupDone && !view.archived;
  const line = noDayLine(view, view.dayAt);
  // Before khatma 1 the Settings tab says when it starts; between later days, only this does.
  const first = view.next.number === 1 && view.next.date !== null;
  const showLine =
    view.day === null && !unfinished && line !== null && (sayStart || !first);
  return (
    <>
      {view.paused && !view.archived && <PausedBanner className="mt-4" />}
      {unfinished && (
        <div className="mt-4">
          <StartKhatma inviteCode={inviteCode} canStart={canStart} />
        </div>
      )}
      {showLine && (
        <p className="mt-4 rounded-ui border-2 border-line bg-card p-4 text-xl leading-relaxed">
          {line}
        </p>
      )}
      <DayCard
        inviteCode={inviteCode}
        view={view}
        dayAt={view.dayAt}
        timeZone={view.timeZone}
      />
    </>
  );
}

/**
 * A rotating khatma's page: the organizer's Today and People tabs, or the short WhatsApp page for
 * anyone else. A co-organizer gets the tabs their switches open: Today with Readings, People with
 * People, the settings link with Settings; with none on, the WhatsApp page like any member.
 */
export function RotaKhatmaPage({
  inviteCode,
  name,
  archived,
  joinLink,
  access,
}: {
  inviteCode: string;
  /** The khatma's name, which anyone can see. */
  name: string | null;
  /** Whether the khatma is archived, which anyone can see. */
  archived: boolean;
  /** The wa.me link that joins the khatma, which anyone can use. */
  joinLink: string | null;
  /** What the viewer may run here (from the khatma's view); null for anyone but an organizer. */
  access: OrganizerAccess | null;
}) {
  const sessionToken = useSessionToken();
  const [search, setSearch] = useSearchParams();
  const ids = useId();
  const backend = useRotaBackend(inviteCode);
  const organizer = runsKhatma(access) ? access : null;
  const today = useQuery(
    backend.today,
    organizer?.readings ? backend.scope : "skip",
  );
  const settings = useQuery(
    backend.settings,
    organizer?.settings ? backend.scope : "skip",
  );
  const notes = useQuery(
    api.notes.forKhatma,
    organizer ? { sessionToken, inviteCode } : "skip",
  );
  const mine = useQuery(api.khatmas.mine, { sessionToken });
  const me = useQuery(api.sessions.me, { sessionToken });
  // The new layout, while it is tried: an admin turns it on for everyone or for one person.
  const newLayout = me?.rotaNewLayout === true;
  const tabs: readonly { id: RotaTab; label: string }[] = newLayout
    ? NEW_TABS.filter((item) =>
        item.id === "people" ? organizer?.people : organizer?.settings,
      )
    : TABS.filter((item) =>
        item.id === "today" ? organizer?.readings : organizer?.people,
      );
  const asked = parseRotaTab(search.get("tab"));
  // A tab the viewer can't open falls back to the first one they can.
  const tab: RotaTab | null = tabs.some((item) => item.id === asked)
    ? asked
    : (tabs[0]?.id ?? null);
  const signIn = useSignInSheet();
  const [switching, setSwitching] = useState(false);
  const deleting = useDeleting(inviteCode);

  // Tabs replace the entry, so the phone's back leaves the khatma instead of stepping through tabs.
  const setTab = (next: RotaTab) =>
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        // Each layout's first tab is the plain address.
        if (next === (newLayout ? "people" : "today")) params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );

  // Today and the settings know first; the khatma's own view says it for everyone else.
  const isArchived = today?.archived ?? settings?.archived ?? archived;

  // Deleted from here: the queries are about to turn null, and this page must not show that.
  if (deleting) return <DeletingPage />;
  if (
    organizer &&
    ((organizer.readings && today === undefined) ||
      (organizer.settings && settings === undefined) ||
      // Which layout to draw: without it the old one would flash first.
      me === undefined)
  ) {
    return <Loading />;
  }
  // Anyone but an organizer; also when a query refuses before the access has caught up.
  if (
    !organizer ||
    (organizer.readings && !today) ||
    (organizer.settings && !settings)
  ) {
    // The sheet sits outside the page body so it survives the reload a new session token triggers.
    return (
      <>
        <WhatsAppPage
          title={name ?? t.app.name}
          archived={archived}
          joinLink={joinLink}
          onSignIn={me === null ? signIn.open : null}
        />
        {signIn.sheet}
      </>
    );
  }

  return (
    <>
      <main className="mx-auto max-w-xl p-5">
        <header className="mb-3.5">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-1 font-medium text-green"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="rtl:-scale-x-100"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            {t.nav.back}
          </Link>
        </header>

        <h1 className="min-w-0 font-display text-4xl leading-tight break-words text-green-deep">
          {settings?.name ?? name ?? t.app.name}
        </h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {/* The new layout has Settings as a tab instead. */}
          {organizer.settings && !newLayout && (
            <Link
              to={`/j/${encodeURIComponent(inviteCode)}/settings`}
              className={pill}
            >
              {t.khatmaSettings.link}
            </Link>
          )}
          {mine !== undefined && canSwitch(mine, inviteCode) && (
            <button
              type="button"
              onClick={() => setSwitching(true)}
              className={pill}
            >
              {t.nav.switchKhatma}
            </button>
          )}
        </div>

        {isArchived && <ArchivedBanner />}
        {newLayout && (
          <>
            <RotaNotes notes={notes ?? []} />
            {today && (
              <AboveTabs
                inviteCode={inviteCode}
                view={today}
                canStart={organizer.settings}
                // Settings says when the khatma starts; without it, this is the only place.
                sayStart={!organizer.settings}
              />
            )}
          </>
        )}
        {tabs.length > 1 && tab !== null && (
          <KhatmaTabs tab={tab} onChange={setTab} idPrefix={ids} tabs={tabs} />
        )}
        {tab !== null && (
          <section
            {...(tabs.length > 1
              ? {
                  role: "tabpanel",
                  id: `${ids}-panel`,
                  "aria-labelledby": `${ids}-tab-${tab}`,
                }
              : {})}
          >
            {tab === "settings" && settings ? (
              <RotaSettingsContent
                settings={settings}
                inviteCode={inviteCode}
                headingLevel="h2"
                inTab
              />
            ) : tab === "today" && today ? (
              <>
                <RotaNotes notes={notes ?? []} />
                <TodayPanel
                  inviteCode={inviteCode}
                  view={today}
                  dayAt={today.dayAt}
                  timeZone={today.timeZone}
                  canStart={organizer.settings}
                />
              </>
            ) : (
              <>
                {/* Without Today, the notes their switches bring them sit here. */}
                {!newLayout && !organizer.readings && (
                  <RotaNotes notes={notes ?? []} />
                )}
                <PeoplePanel
                  inviteCode={inviteCode}
                  archived={isArchived}
                  viewerIsOwner={organizer.owner}
                />
              </>
            )}
          </section>
        )}
        {/* The Settings tab has these itself. */}
        {isArchived && organizer.owner && settings && tab !== "settings" && (
          <ArchivedSection
            inviteCode={inviteCode}
            restart={{ days: settings.days, timeZone: settings.timeZone }}
          />
        )}
      </main>
      {signIn.sheet}
      {switching && mine && (
        <SwitchKhatmaSheet
          khatmas={mine}
          currentCode={inviteCode}
          onClose={() => setSwitching(false)}
        />
      )}
    </>
  );
}
