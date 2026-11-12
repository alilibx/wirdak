import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button, buttonClass } from "../components/Button";
import { InstallStepsSheet } from "../components/InstallStepsSheet";
import { Sheet } from "../components/Sheet";
import { SwitchRow } from "../components/SwitchRow";
import { t } from "../i18n/ar";
import { errorCode } from "../lib/errors";
import { ErrorLine } from "../features/rota/ErrorLine";
import { useRotaCall } from "../features/rota/useRotaCall";
import { useSignInSheet } from "../features/verify/useSignInSheet";
import { formatDate } from "../lib/format";
import {
  currentEndpoint,
  dropSubscription,
  enablePush,
  pushBlocked,
  pushSupport,
} from "../lib/push";
import {
  clearSessionToken,
  getSessionToken,
  useSessionToken,
} from "../lib/session";
import { type ThemeChoice, useThemeChoice } from "../lib/theme";
import { useClearDeadToken } from "../lib/useClearDeadToken";

const headingClass = "mt-8 mb-3 text-xl font-semibold";
const settingsErrors: Record<string, string> = t.settings.errors;

export function SettingsPage() {
  const sessionToken = useSessionToken();
  const me = useQuery(api.sessions.me, { sessionToken });
  useClearDeadToken(sessionToken, me === null);
  const signIn = useSignInSheet();

  // The sheet sits outside the page body so it survives the reload a new session token triggers.
  return (
    <>
      {me === undefined ? (
        <main aria-busy="true" className="mx-auto max-w-xl p-5">
          <p className="py-16 text-center text-xl text-ink-soft">
            {t.common.loading}
          </p>
        </main>
      ) : (
        <SettingsContent me={me} onSignIn={signIn.open} />
      )}
      {signIn.sheet}
    </>
  );
}

function SettingsContent({
  me,
  onSignIn,
}: {
  me: {
    displayName: string;
    maskedPhone: string;
    whatsappNotes: boolean;
  } | null;
  onSignIn: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl p-5">
      {/* Signed in, the bottom bar has the way home. */}
      {me === null && (
        <header className="mb-3.5">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center font-medium text-green underline underline-offset-4"
          >
            {t.common.home}
          </Link>
        </header>
      )}
      <h1 className="font-display text-4xl leading-tight text-green-deep">
        {t.home.settings}
      </h1>
      {me === null ? (
        <>
          <p className="mt-4 leading-relaxed text-ink-soft">
            {t.settings.signedOutPrompt}
          </p>
          <div className="mt-5">
            <Button variant="ghost" onClick={onSignIn}>
              {t.signIn.button}
            </Button>
          </div>
        </>
      ) : (
        <SignedInSettings
          displayName={me.displayName}
          maskedPhone={me.maskedPhone}
          whatsappNotes={me.whatsappNotes}
        />
      )}
      <ThemeSection />
    </main>
  );
}

const THEMES: ThemeChoice[] = ["system", "light", "dark"];

/** Light, dark, or the phone's setting. Kept on this device, so it works signed out too. */
function ThemeSection() {
  const [choice, setChoice] = useThemeChoice();
  return (
    <section aria-labelledby="theme-heading">
      <h2 id="theme-heading" className={headingClass}>
        {t.settings.themeHeading}
      </h2>
      <fieldset>
        <legend className="text-ink-soft">{t.settings.themeHint}</legend>
        <div className="mt-2 grid gap-2.5">
          {THEMES.map((value) => {
            const subtitle = t.settings.themeSubtitles[value];
            return (
              <label
                key={value}
                className="flex min-h-14 cursor-pointer items-center gap-3 rounded-ui border-2 border-line bg-card px-4 py-3 has-[:checked]:border-green has-[:checked]:bg-chosen has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green"
              >
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                  className="size-5 shrink-0 accent-green"
                />
                <span>
                  <span className="font-medium">
                    {t.settings.themes[value]}
                  </span>
                  {subtitle && (
                    <span className="block text-base text-ink-soft">
                      {subtitle}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}

function SignedInSettings({
  displayName,
  maskedPhone,
  whatsappNotes,
}: {
  displayName: string;
  maskedPhone: string;
  whatsappNotes: boolean;
}) {
  return (
    <>
      <NameForm initial={displayName} />
      <p className="mt-5">
        <span className="font-medium">{t.settings.numberLabel}: </span>
        <span dir="ltr">{maskedPhone}</span>
      </p>
      <MyNumbers />
      <SavedPeople />
      <DevicePush />
      <WhatsAppNotes on={whatsappNotes} />
      <Devices />
    </>
  );
}

/** The person's own numbers. Nobody else is ever sent these. */
function MyNumbers() {
  const sessionToken = useSessionToken();
  const stats = useQuery(api.people.myStats, { sessionToken });
  if (!stats) return null;
  return (
    <section aria-labelledby="numbers-heading">
      <h2 id="numbers-heading" className={headingClass}>
        {t.settings.numbers}
      </h2>
      <div className="grid gap-2 rounded-ui border border-line bg-card p-4">
        <p>
          {stats.juzRead > 0
            ? t.settings.juzRead(stats.juzRead)
            : t.settings.noJuzYet}
        </p>
        {stats.paceDays !== null && <p>{t.card.pace(stats.paceDays)}</p>}
        {stats.weekStreak !== null && (
          <p>{t.settings.weekStreak(stats.weekStreak)}</p>
        )}
      </div>
    </section>
  );
}

const savedErrors: Record<string, string> = t.settings.savedErrors;

/** The people the person added to their rotating khatmas, with the way to forget one. */
function SavedPeople() {
  const sessionToken = useSessionToken();
  const people = useQuery(api.people.savedPeople, { sessionToken });
  const [removing, setRemoving] = useState<
    NonNullable<typeof people>[number] | null
  >(null);
  if (!people || people.length === 0) return null;
  return (
    <section aria-labelledby="saved-heading">
      <h2 id="saved-heading" className={headingClass}>
        {t.settings.savedHeading}
      </h2>
      <p className="mb-3 leading-relaxed text-ink-soft">
        {t.settings.savedHint}
      </p>
      <ul className="grid gap-3">
        {people.map((person) => (
          <li
            key={person.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-ui border border-line bg-card p-4"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{person.name}</span>
              {person.phone === null ? (
                <span className="block text-base text-ink-soft">
                  {t.settings.savedHidden}
                </span>
              ) : (
                <span
                  dir="ltr"
                  className="block text-start text-base text-ink-soft"
                >
                  {person.phone}
                </span>
              )}
            </span>
            <button
              type="button"
              aria-label={t.settings.savedRemoveLabel(person.name)}
              onClick={() => setRemoving(person)}
              className={buttonClass("ghost", "!w-auto")}
            >
              {t.settings.savedRemove}
            </button>
          </li>
        ))}
      </ul>
      {removing && (
        <RemoveSavedSheet person={removing} onClose={() => setRemoving(null)} />
      )}
    </section>
  );
}

/** Asks before forgetting someone; they stay in the khatmas they are in. */
function RemoveSavedSheet({
  person,
  onClose,
}: {
  person: { id: Id<"rotaContacts">; name: string };
  onClose: () => void;
}) {
  const removeSaved = useMutation(api.rota.removeSaved);
  const { busy, error, run } = useRotaCall(savedErrors);
  return (
    <Sheet title={t.settings.savedRemoveTitle(person.name)} onClose={onClose}>
      <p className="leading-relaxed text-ink-soft">
        {t.settings.savedRemoveBody}
      </p>
      <div className="mt-5 grid gap-3">
        <Button
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                removeSaved({
                  sessionToken: getSessionToken() ?? undefined,
                  contactId: person.id,
                }),
              onClose,
            )
          }
        >
          {t.settings.savedRemoveConfirm}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t.settings.savedRemoveCancel}
        </Button>
      </div>
      <ErrorLine error={error} />
    </Sheet>
  );
}

function DevicePush() {
  const support = pushSupport();
  return (
    <section aria-labelledby="push-heading">
      <h2 id="push-heading" className={headingClass}>
        {t.settings.pushHeading}
      </h2>
      {support === "unsupported" ? (
        <p className="leading-relaxed text-ink-soft">
          {t.settings.pushUnsupported}
        </p>
      ) : support === "ios_install" ? (
        <IosInstall />
      ) : (
        <PushSwitch />
      )}
    </section>
  );
}

/** WhatsApp notifications for every khatma: off until the person turns them on. */
function WhatsAppNotes({ on }: { on: boolean }) {
  const sessionToken = useSessionToken();
  const setWhatsappNotes = useMutation(api.people.setWhatsappNotes);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    if (busyRef.current || !sessionToken) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await setWhatsappNotes({ sessionToken, on: next });
    } catch {
      setError(t.errors.network);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="whatsapp-heading">
      <h2 id="whatsapp-heading" className={headingClass}>
        {t.whatsappNotes.heading}
      </h2>
      <p className="leading-relaxed text-ink-soft">{t.whatsappNotes.explain}</p>
      <SwitchRow
        label={t.whatsappNotes.label}
        on={on}
        disabled={busy}
        onChange={(next) => void change(next)}
      />
      {error && (
        <p role="alert" className="mt-3 font-medium text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** On iPhone, push needs the home-screen app: this is the way back to those steps. */
function IosInstall() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="leading-relaxed text-ink-soft">
        {t.settings.pushInstallHint}
      </p>
      <div className="mt-3">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          {t.settings.pushInstall}
        </Button>
      </div>
      {open && <InstallStepsSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function PushSwitch() {
  const sessionToken = useSessionToken();
  const unsubscribe = useMutation(api.push.unsubscribe);
  // undefined while the browser is asked; null when it has no subscription.
  const [endpoint, setEndpoint] = useState<string | null | undefined>(
    undefined,
  );
  const mine = useQuery(
    api.push.mine,
    endpoint && sessionToken ? { sessionToken, endpoint } : "skip",
  );
  const [blocked, setBlocked] = useState(pushBlocked);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    currentEndpoint().then(
      (found) => live && setEndpoint(found),
      () => live && setEndpoint(null),
    );
    return () => {
      live = false;
    };
  }, []);

  if (blocked) {
    return (
      <p className="leading-relaxed text-ink-soft">{t.settings.pushBlocked}</p>
    );
  }
  if (endpoint === undefined) return null;

  const on = endpoint !== null && mine?.thisDevice === true;

  async function change(turnOn: boolean) {
    if (busyRef.current || !sessionToken) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (turnOn) {
        // Straight from the tap: the permission dialog needs the gesture.
        const result = await enablePush(sessionToken);
        if (result === "denied") setBlocked(true);
        else setEndpoint(await currentEndpoint());
      } else {
        const dropped = await dropSubscription();
        setEndpoint(null);
        if (dropped) await unsubscribe({ sessionToken, endpoint: dropped });
      }
    } catch {
      setError(t.errors.network);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <SwitchRow
        label={t.settings.pushLabel}
        on={on}
        disabled={busy}
        onChange={(next) => void change(next)}
      />
      {error && (
        <p role="alert" className="mt-3 font-medium text-danger">
          {error}
        </p>
      )}
    </>
  );
}

function NameForm({ initial }: { initial: string }) {
  const sessionToken = useSessionToken();
  const update = useMutation(api.people.updateDisplayName);
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const trimmed = name.trim();
      await update({ sessionToken, displayName: trimmed });
      setName(trimmed);
      setSaved(true);
    } catch (caught) {
      const code = errorCode(caught);
      setError(
        code === null
          ? t.settings.errors.network
          : (settingsErrors[code] ?? t.errors.generic),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="mt-5"
    >
      <label htmlFor="display-name" className="block font-medium">
        {t.settings.nameLabel}
      </label>
      <input
        id="display-name"
        type="text"
        autoComplete="name"
        maxLength={40}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setSaved(false);
        }}
        aria-invalid={error !== null}
        className="mt-1.5 min-h-14 w-full rounded-ui border-2 border-field-line bg-field px-4 text-ink"
      />
      {error && (
        <p role="alert" className="mt-2 font-medium text-danger">
          {error}
        </p>
      )}
      <p role="status" className="mt-2 font-medium text-green">
        {saved ? t.settings.saved : ""}
      </p>
      <div className="mt-3">
        <Button type="submit" disabled={saving}>
          {saving ? t.settings.saving : t.settings.save}
        </Button>
      </div>
    </form>
  );
}

function Devices() {
  const sessionToken = useSessionToken();
  const navigate = useNavigate();
  const sessions = useQuery(api.sessions.list, { sessionToken });
  const signOut = useMutation(api.sessions.signOut);
  const signOutOne = useMutation(api.sessions.signOutOne);
  const signOutOthers = useMutation(api.sessions.signOutOthers);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** One call at a time; a thrown call is shown as a network failure. */
  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await work();
    } catch {
      setError(t.errors.network);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const signOutThisDevice = () =>
    run(async () => {
      await signOut({ sessionToken });
      clearSessionToken();
      void navigate("/");
    });
  const signOutDevice = (sessionId: Id<"sessions">) =>
    run(async () => {
      await signOutOne({ sessionToken, sessionId });
      setMessage(t.settings.signedOutOne);
    });
  const signOutOtherDevices = () =>
    run(async () => {
      await signOutOthers({ sessionToken });
      setMessage(t.settings.signedOutOthers);
    });

  return (
    <section aria-labelledby="devices-heading">
      <h2 id="devices-heading" className={headingClass}>
        {t.settings.devicesHeading}
      </h2>
      <ul className="grid gap-3">
        {(sessions ?? []).map((s) => (
          <li
            key={s.sessionId}
            className="rounded-ui border border-line bg-card p-4"
          >
            <span className="block font-medium">{s.deviceLabel}</span>
            {s.isCurrent && (
              <span className="mt-1 inline-block rounded-full bg-saffron-soft px-3 py-0.5 text-base font-semibold text-saffron-ink">
                {t.settings.thisDevice}
              </span>
            )}
            <span className="mt-1 block text-base text-ink-soft">
              {t.settings.lastUsed(formatDate(s.lastUsedAt))}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void (s.isCurrent
                  ? signOutThisDevice()
                  : signOutDevice(s.sessionId))
              }
              className={buttonClass("ghost", "mt-3")}
            >
              {t.settings.signOut}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 font-medium text-danger">
          {error}
        </p>
      )}
      <p role="status" className="mt-3 font-medium text-green">
        {message}
      </p>
      <div className="mt-3">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void signOutOtherDevices()}
        >
          {t.settings.signOutOthers}
        </Button>
      </div>
    </section>
  );
}
