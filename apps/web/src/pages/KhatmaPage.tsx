import { api } from "@convex/_generated/api";
import type { KhatmaView } from "@convex/khatmas";
import type { NoteView } from "@convex/notes";
import { toWesternDigits } from "@convex/lib/digits";
import { useQuery } from "convex/react";
import { useEffect, useId, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button } from "../components/Button";
import { NoteCard, takeTarget } from "../components/NoteCard";
import { MainCard } from "../components/MainCard";
import { InstallStepsSheet } from "../components/InstallStepsSheet";
import {
  KhatmaTabs,
  parseTab,
  tabParam,
  type KhatmaTab,
} from "../components/KhatmaTabs";
import { canSwitch, SwitchKhatmaSheet } from "../components/SwitchKhatmaSheet";
import { SwitchRow } from "../components/SwitchRow";
import { WhatsAppIcon } from "../components/WhatsAppIcon";
import { WhatsAppSheet } from "../components/WhatsAppSheet";
import { PoolGrid } from "../components/PoolGrid";
import { PushPromptSheet } from "../components/PushPromptSheet";
import { ReleaseSheet } from "../components/ReleaseSheet";
import { Ring } from "../components/Ring";
import { ShareSheets } from "../components/ShareSheets";
import { TakeSheet } from "../components/TakeSheet";
import { Toast } from "../components/Toast";
import { ArchivedBanner } from "../features/khatma/ArchivedActions";
import { DeletingPage, useDeleting } from "../features/khatma/deleting";
import { useKhatmaActions } from "../features/khatma/useKhatmaActions";
import { useShareSheet } from "../features/share/useShareSheet";
import { VerifySheet } from "../features/verify/VerifySheet";
import { t } from "../i18n/ar";
import { formatDate } from "../lib/format";
import { useSessionToken } from "../lib/session";
import { useClearDeadToken } from "../lib/useClearDeadToken";
import { CelebrationPage } from "./CelebrationPage";
import { NotFoundPage } from "./NotFoundPage";
import { RotaKhatmaPage } from "./RotaKhatmaPage";

const chip =
  "rounded-full border border-line bg-paper-2 px-3 py-1 text-base text-ink-soft";

function khatmaTitle(view: KhatmaView): string {
  return view.name ?? t.khatma.untitled(formatDate(view.createdAt));
}

export function KhatmaPage() {
  const { inviteCode = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const from = search.get("from");
  const tab = parseTab(search.get("tab"));
  // Tabs replace the entry, so the phone's back leaves the khatma instead of stepping through tabs.
  const setTab = (next: KhatmaTab) =>
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        const value = tabParam(next);
        if (value === null) params.delete("tab");
        else params.set("tab", value);
        return params;
      },
      { replace: true },
    );
  const sessionToken = useSessionToken();
  const found = useQuery(api.khatmas.view, {
    sessionToken,
    inviteCode,
    ...(from ? { from } : {}),
  });
  // A rotating khatma has its own page, rendered below once every hook has run; to the pool
  // page's hooks it is still loading.
  const view = found !== undefined && "rota" in found ? undefined : found;
  // Tab ids live here so a tab change the page makes can move focus to the new tab.
  const tabIds = useId();
  const [focusTab, setFocusTab] = useState<KhatmaTab | null>(null);
  // A tab change from inside a panel unmounts the control that had focus. Put focus on the newly
  // selected tab, unless something else (a sheet that just opened) has already taken it.
  useEffect(() => {
    // The tab comes from the URL, which can update a render after this request.
    if (focusTab === null || focusTab !== tab) return;
    const el = document.getElementById(`${tabIds}-tab-${focusTab}`);
    if (!el) return;
    setFocusTab(null);
    if (
      document.activeElement === null ||
      document.activeElement === document.body
    )
      el.focus();
  });
  const showTab = (next: KhatmaTab) => {
    setTab(next);
    setFocusTab(next);
  };
  // A confirmed take shows the person their juz' card, which lives on the mine tab.
  const actions = useKhatmaActions(view, inviteCode, {
    onTaken: () => showTab("mine"),
  });
  const { sheet, busy } = actions;
  const share = useShareSheet();
  const isMember =
    view !== undefined && !("notFound" in view) && view.me.isMember;
  // Only members have notes; everyone else's query is skipped.
  const notes = useQuery(
    api.notes.forKhatma,
    isMember ? { sessionToken, inviteCode } : "skip",
  );
  // The switch button needs the member's other khatmas; nobody else sees it.
  const mine = useQuery(api.khatmas.mine, isMember ? { sessionToken } : "skip");
  const [switching, setSwitching] = useState(false);
  const deleting = useDeleting(inviteCode);

  // The server decides who is signed in; a stored token alone proves nothing.
  const tokenIsDead =
    sessionToken !== undefined &&
    view !== undefined &&
    !("notFound" in view) &&
    !view.me.signedIn;

  // `view` is only defined once Convex has answered for the current args (it is undefined
  // while they change), so a dead token is never judged on a stale answer.
  useClearDeadToken(sessionToken, tokenIsDead);

  const loaded = view !== undefined && !("notFound" in view) ? view : null;
  const openJuz = (loaded?.tiles ?? [])
    .filter((tile) => tile.state === "open")
    .map((tile) => tile.juz);

  // Deleted from this khatma's settings: its link is about to die, and the page must not show that.
  if (deleting) return <DeletingPage />;
  if (found !== undefined && "rota" in found) {
    return (
      <RotaKhatmaPage
        inviteCode={inviteCode}
        name={found.name}
        archived={found.archived}
        joinLink={found.joinLink}
        access={found.organizerAccess}
      />
    );
  }

  // The sheets sit outside the page body so they survive the reload the new session token triggers.
  return (
    <>
      {view === undefined ? (
        <main aria-busy="true" className="mx-auto max-w-xl p-5">
          <p className="py-16 text-center text-xl text-ink-soft">
            {t.common.loading}
          </p>
        </main>
      ) : "notFound" in view ? (
        <NotFoundPage />
      ) : view.me.celebrateRound !== null ? (
        <CelebrationPage
          title={khatmaTitle(view)}
          round={view.me.celebrateRound}
          participants={view.lastCompleted?.participants ?? null}
          tiles={view.tiles}
          busy={busy}
          onContinue={() => void actions.continueToKhatma()}
        />
      ) : (
        <KhatmaContent
          view={view}
          notes={notes ?? []}
          inviteCode={inviteCode}
          tab={tab}
          tabIds={tabIds}
          onTab={setTab}
          onShowTab={showTab}
          onSwitch={
            mine !== undefined && canSwitch(mine, inviteCode)
              ? () => setSwitching(true)
              : null
          }
          busy={busy}
          onTake={actions.take}
          onFinish={() => void actions.finish()}
          onRelease={actions.openRelease}
          onStillReading={() => void actions.stillReading()}
          onDismissNote={(noteId) => void actions.dismissNote(noteId)}
          onSetNotifications={(on) => void actions.setNotifications(on)}
          onInvite={share.openInvite}
          onRemind={share.openRemind}
          hasOpen={openJuz.length > 0}
        />
      )}
      {loaded && loaded.me.isMember && loaded.me.celebrateRound === null && (
        <ShareSheets
          sheet={share.sheet}
          inviteCode={inviteCode}
          khatmaName={khatmaTitle(loaded)}
          openJuz={openJuz}
          targetEndAt={loaded.targetEndAt}
          onClose={share.close}
        />
      )}
      {loaded && sheet?.kind === "take" && (
        <TakeSheet
          juz={sheet.juz}
          takerName={loaded.me.displayName}
          busy={busy}
          onConfirm={() => void actions.confirmTake(sheet.juz)}
          onSwitchAccount={() => void actions.switchAccount(sheet.juz)}
          onClose={actions.closeSheet}
        />
      )}
      {loaded && sheet?.kind === "release" && (
        <ReleaseSheet
          juz={loaded.me.holding}
          busy={busy}
          onConfirm={() => void actions.confirmRelease()}
          onClose={actions.closeSheet}
        />
      )}
      {switching && mine && (
        <SwitchKhatmaSheet
          khatmas={mine}
          currentCode={inviteCode}
          onClose={() => setSwitching(false)}
        />
      )}
      {sheet?.kind === "push" && (
        <PushPromptSheet onClose={actions.closeSheet} />
      )}
      {sheet?.kind === "install" && (
        <InstallStepsSheet fromPrompt onClose={actions.closeSheet} />
      )}
      {sheet?.kind === "whatsapp" && (
        <WhatsAppSheet onClose={actions.closeSheet} />
      )}
      {actions.pendingJuz !== null && (
        <VerifySheet
          title={t.verify.beforeTake}
          intent={{ kind: "take", inviteCode, juz: actions.pendingJuz }}
          onVerified={actions.verified}
          onClose={actions.cancelVerify}
        />
      )}
      {/* Always mounted: screen readers announce text changed inside a live region, not a new one. */}
      <div role="status" aria-live="polite">
        {actions.toast && (
          <Toast
            key={actions.toast.id}
            toast={actions.toast}
            busy={busy}
            onUndo={() => void actions.undo()}
            onDismiss={actions.dismissToast}
          />
        )}
      </div>
    </>
  );
}

type ContentProps = {
  view: KhatmaView;
  notes: NoteView[];
  inviteCode: string;
  tab: KhatmaTab;
  /** The prefix of the tab and panel ids. */
  tabIds: string;
  onTab: (tab: KhatmaTab) => void;
  /** Selects a tab from inside a panel and moves focus to it. */
  onShowTab: (tab: KhatmaTab) => void;
  /** Opens the switch-khatma sheet; `null` hides the button (fewer than two khatmas). */
  onSwitch: (() => void) | null;
  busy: boolean;
  onTake: (juz: number) => void;
  onFinish: () => void;
  onRelease: () => void;
  onStillReading: () => void;
  onDismissNote: (noteId: NoteView["noteId"]) => void;
  onSetNotifications: (on: boolean) => void;
  onInvite: () => void;
  onRemind: () => void;
  hasOpen: boolean;
};

/** Members get the tabbed page; visitors and non-members keep the single page (spec 5.4). */
function KhatmaContent(props: ContentProps) {
  return props.view.me.isMember ? (
    <MemberContent {...props} />
  ) : (
    <VisitorContent {...props} />
  );
}

function Chips({ view }: { view: KhatmaView }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <span className={chip}>
        {t.khatma.round(toWesternDigits(view.roundNumber))}
      </span>
      <span className={chip}>{t.schedules[view.schedule]}</span>
      {view.targetEndAt !== null && (
        <span className={chip}>
          {t.khatma.target(formatDate(view.targetEndAt))}
        </span>
      )}
    </div>
  );
}

function GroupTotal({ view }: { view: KhatmaView }) {
  if (view.completedRounds === 0) return null;
  return (
    <p className="mt-5 text-center text-ink-soft">
      {t.khatma.groupTotal(toWesternDigits(view.completedRounds))}
    </p>
  );
}

function VisitorContent({
  view,
  busy,
  onTake,
  onFinish,
  onRelease,
  onStillReading,
}: ContentProps) {
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

      {/* An archived khatma invites nobody, so it has no invitation to show. */}
      {!view.archived && (
        <p
          role="note"
          className="mb-3.5 rounded-ui border border-chosen-line bg-chosen p-3 text-ink"
        >
          {view.inviterName
            ? t.khatma.invited(view.inviterName)
            : t.khatma.invitedAnon}
          {!view.me.signedIn && ` ${t.khatma.verifyHint}`}
        </p>
      )}

      <h1 className="font-display text-4xl leading-tight text-green-deep">
        {khatmaTitle(view)}
      </h1>
      <Chips view={view} />
      {view.archived && <ArchivedBanner />}
      <Ring tiles={view.tiles} />
      {!view.archived && (
        <MainCard
          view={view}
          onTake={onTake}
          onFinish={onFinish}
          onRelease={onRelease}
          onStillReading={onStillReading}
          busy={busy}
        />
      )}
      <PoolGrid tiles={view.tiles} onTake={onTake} readOnly={view.archived} />
      <GroupTotal view={view} />
    </main>
  );
}

function MemberContent({
  view,
  notes,
  inviteCode,
  tab,
  tabIds: ids,
  onTab,
  onShowTab,
  onSwitch,
  busy,
  onTake,
  onFinish,
  onRelease,
  onStillReading,
  onDismissNote,
  onSetNotifications,
  onInvite,
  onRemind,
  hasOpen,
}: ContentProps) {
  return (
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

      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h1 className="min-w-0 font-display text-4xl leading-tight break-words text-green-deep">
          {khatmaTitle(view)}
        </h1>
        {onSwitch && (
          <button
            type="button"
            onClick={onSwitch}
            className="mt-1 inline-flex min-h-11 max-w-full items-center rounded-full border-2 border-green px-3.5 text-base font-semibold text-green"
          >
            {t.nav.switchKhatma}
          </button>
        )}
      </div>
      <Chips view={view} />
      {view.archived && <ArchivedBanner />}
      <KhatmaTabs tab={tab} onChange={onTab} idPrefix={ids} />

      <section
        role="tabpanel"
        id={`${ids}-panel`}
        aria-labelledby={`${ids}-tab-${tab}`}
      >
        {tab === "mine" && (
          <>
            {!view.archived && notes.length > 0 && (
              <section aria-label={t.notes.heading} className="mt-4 grid gap-3">
                {notes.map((note) => (
                  <NoteCard
                    key={note.noteId}
                    note={note}
                    takeJuz={takeTarget(
                      note,
                      view.tiles,
                      view.me.holding,
                      view.me.suggestion,
                    )}
                    onStillReading={onStillReading}
                    onFinish={onFinish}
                    onRelease={onRelease}
                    onTake={onTake}
                    onInvite={onInvite}
                    onDismiss={() => onDismissNote(note.noteId)}
                    busy={busy}
                  />
                ))}
              </section>
            )}
            <Ring tiles={view.tiles} />
            {!view.archived && (
              <MainCard
                view={view}
                onTake={onTake}
                onFinish={onFinish}
                onRelease={onRelease}
                onStillReading={onStillReading}
                onPickYourself={() => onShowTab("pool")}
                busy={busy}
              />
            )}
          </>
        )}
        {tab === "pool" && (
          <PoolGrid
            tiles={view.tiles}
            onTake={onTake}
            readOnly={view.archived}
          />
        )}
        {tab === "group" && (
          <>
            {!view.archived && (
              <>
                <div className="mt-4 grid gap-3">
                  <Button variant="whatsapp" onClick={onInvite}>
                    <WhatsAppIcon />
                    {t.share.inviteButton}
                  </Button>
                  {hasOpen && (
                    <Button variant="ghost" onClick={onRemind}>
                      {t.share.remindButton}
                    </Button>
                  )}
                </div>
                <SwitchRow
                  label={t.khatmaSettings.notifications}
                  on={view.me.notificationsOn !== false}
                  disabled={busy}
                  onChange={onSetNotifications}
                />
              </>
            )}
            {/* The owner and every co-organizer: the settings page shows each their own controls. */}
            {view.organizerAccess !== null && (
              <Link
                to={`/j/${encodeURIComponent(inviteCode)}/settings`}
                className="mt-3 inline-flex min-h-14 items-center font-semibold text-green underline underline-offset-4"
              >
                {t.khatmaSettings.link}
              </Link>
            )}
            <GroupTotal view={view} />
          </>
        )}
      </section>
    </main>
  );
}

/**
 * The khatma route. Keyed by invite code so switching khatmas starts fresh: an undo toast, a
 * lost-race wait or an open sheet belongs to the khatma it came from.
 */
export function KhatmaRoute() {
  const { inviteCode = "" } = useParams();
  return <KhatmaPage key={inviteCode} />;
}
