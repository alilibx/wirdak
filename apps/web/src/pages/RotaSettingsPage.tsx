import {
  messageTimesError,
  type ReadingDays,
  type RotaMessages,
} from "@convex/lib/rota";
import type { SettingsView } from "@convex/lib/rotaOps";
import { localDate } from "@convex/lib/wakingTime";
import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router";
import { Button } from "../components/Button";
import { Sheet } from "../components/Sheet";
import { SwitchRow } from "../components/SwitchRow";
import {
  ArchivedSection,
  ArchiveSection,
} from "../features/khatma/ArchivedActions";
import { CheerField } from "../features/khatma/CheerField";
import { DeletingPage, useDeleting } from "../features/khatma/deleting";
import { useRotaBackend } from "../features/rota/backend";
import { DateLine } from "../features/rota/DateLine";
import { firstReadingDay } from "../features/rota/dates";
import { formatIsoDate, formatTime } from "../features/rota/format";
import { ReadingDaysField } from "../features/rota/ReadingDaysField";
import { TimeField } from "../features/rota/TimeField";
import { useRotaCall } from "../features/rota/useRotaCall";
import { t } from "../i18n/ar";

type SectionId = "pause" | "messages" | "cheer" | "details";
type Feedback = { section: SectionId; kind: "saved" | "error"; text: string };
type Message = "reminder" | "unread" | "summary";

const rotaErrors: Record<string, string> = t.rota.errors;
const MESSAGES: Message[] = ["reminder", "unread", "summary"];
const fieldClass =
  "mt-1.5 min-h-14 w-full rounded-ui border-2 border-line bg-white px-4 text-ink";

const khatmaPath = (inviteCode: string) =>
  `/j/${encodeURIComponent(inviteCode)}`;

/** The zones this browser knows, the khatma's own first. */
function timeZones(current: string): string[] {
  const known =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return [current, ...known.filter((zone) => zone !== current)];
}

const sameDays = (a: ReadingDays, b: ReadingDays) =>
  JSON.stringify(a) === JSON.stringify(b);

function Section({
  id,
  heading,
  feedback,
  children,
}: {
  id: SectionId;
  heading: string;
  feedback: Feedback | null;
  children: ReactNode;
}) {
  const own = feedback?.section === id ? feedback : null;
  return (
    <section aria-label={heading} className="mt-8">
      <h2 className="mb-3 text-xl font-semibold">{heading}</h2>
      {children}
      {own?.kind === "error" && (
        <p role="alert" className="mt-3 font-medium text-[#8A2B1E]">
          {own.text}
        </p>
      )}
      <p role="status" className="mt-3 font-medium text-green">
        {own?.kind === "saved" ? own.text : ""}
      </p>
    </section>
  );
}

/** The organizer's page of a rotating khatma's settings. */
export function RotaSettingsPage() {
  const { inviteCode = "" } = useParams();
  const backend = useRotaBackend(inviteCode);
  const settings = useQuery(backend.settings, backend.scope);
  const deleting = useDeleting(inviteCode);

  // Deleted from here: the settings are about to turn null, and this page must not show that.
  if (deleting) return <DeletingPage />;
  if (settings === undefined) {
    return (
      <main aria-busy="true" className="mx-auto max-w-xl p-5">
        <p className="py-16 text-center text-xl text-ink-soft">
          {t.common.loading}
        </p>
      </main>
    );
  }
  // Only the organizer has settings.
  if (settings === null) {
    return <Navigate to={khatmaPath(inviteCode)} replace />;
  }
  return (
    <main className="mx-auto max-w-xl p-5">
      <header className="mb-3.5">
        <Link
          to={khatmaPath(inviteCode)}
          className="inline-flex min-h-11 items-center font-medium text-green underline underline-offset-4"
        >
          {t.organizer.back}
        </Link>
      </header>
      <RotaSettingsContent settings={settings} inviteCode={inviteCode} />
    </main>
  );
}

/**
 * A rotating khatma's settings: pausing, the message times, the days and the name. `headingLevel`
 * is for a page that already has its `h1`.
 */
export function RotaSettingsContent({
  settings,
  inviteCode,
  headingLevel: Heading = "h1",
}: {
  settings: SettingsView;
  inviteCode: string;
  headingLevel?: "h1" | "h2";
}) {
  const backend = useRotaBackend(inviteCode);
  const update = useMutation(backend.update);
  const setPaused = useMutation(backend.setPaused);
  const addPauseDate = useMutation(backend.addPauseDate);
  const removePauseDate = useMutation(backend.removePauseDate);
  const [name, setName] = useState(settings.name);
  const [days, setDays] = useState<ReadingDays>(settings.days);
  const [endDate, setEndDate] = useState<string | null>(settings.endDate);
  const [timeZone, setTimeZone] = useState(settings.timeZone);
  // The times and switches are edited here and saved together, so a move that
  // only makes sense with another one (a later reminder and summary) can be made.
  const [messages, setMessages] = useState<RotaMessages>(settings.messages);
  const [addingDate, setAddingDate] = useState(false);
  const { busy, error, run: call } = useRotaCall(rotaErrors);
  // Which section the last call was for, and the word of thanks once it went through.
  const [scope, setScope] = useState<{
    section: SectionId;
    saved: string | null;
  } | null>(null);
  const args = backend.authArgs();

  const paused = settings.pausedAt !== null;
  const { quiet } = settings;
  const earliest = quiet.endHour * 60;
  const latest = quiet.startHour * 60 - 15;

  // A start still ahead moves on to the first reading day of the new days; one behind us stays.
  const start = settings.firstDatePassed
    ? settings.firstDate
    : firstReadingDay(days, settings.firstDate);
  const changes = {
    ...(name.trim() !== settings.name ? { name: name.trim() } : {}),
    ...(!sameDays(days, settings.days)
      ? {
          days,
          ...(start !== settings.firstDate ? { firstDate: start } : {}),
        }
      : {}),
    ...(endDate !== settings.endDate ? { endDate } : {}),
    ...(timeZone !== settings.timeZone ? { timeZone } : {}),
  };
  const changed = Object.keys(changes).length > 0;
  const messagesChanged =
    JSON.stringify(messages) !== JSON.stringify(settings.messages);
  // An end date behind today would end the khatma for good.
  const today = localDate(Date.now(), settings.timeZone);
  const earliestEnd = start > today ? start : today;

  const feedback: Feedback | null =
    scope === null
      ? null
      : error !== null
        ? { section: scope.section, kind: "error", text: error }
        : scope.saved !== null
          ? { section: scope.section, kind: "saved", text: scope.saved }
          : null;

  /** One call at a time; its result shows under `section`. */
  function run(
    section: SectionId,
    work: () => Promise<{ ok: true } | { error: string }>,
    saved: string | null = null,
  ): Promise<void> {
    setScope({ section, saved: null });
    return call(work, () => setScope({ section, saved }));
  }

  const saveMessages = () =>
    run(
      "messages",
      async () =>
        messageTimesError(messages, quiet.startHour, quiet.endHour)
          ? { error: "invalid_times" }
          : update({ ...args, messages }),
      t.organizer.saved,
    );

  const pickPauseDate = (date: string) => {
    setAddingDate(false);
    return run("pause", () => addPauseDate({ ...args, date }));
  };

  const offeredDates = settings.upcoming.filter(
    (date) => !settings.pauseDates.includes(date),
  );

  return (
    <>
      <Heading className="font-display text-4xl leading-tight text-green-deep">
        {t.khatmaSettings.link}
      </Heading>
      {settings.archived && (
        <p
          role="note"
          className="mt-4 rounded-ui border-2 border-line bg-paper-2 p-3 font-medium"
        >
          {t.rota.archivedSettings}
        </p>
      )}

      {/* An archived khatma is read-only: every control below is off. */}
      <fieldset disabled={settings.archived} className="min-w-0">
        <Section id="pause" heading={t.rota.pauseHeading} feedback={feedback}>
          <SwitchRow
            label={t.rota.pauseNow}
            on={paused}
            disabled={busy}
            onChange={(next) =>
              void run("pause", () => setPaused({ ...args, paused: next }))
            }
          />
          <p className="mt-2 text-ink-soft">{t.rota.pauseHint}</p>

          <h3 className="mt-5 font-medium">{t.rota.pauseDates}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {settings.pauseDates.map((date) => (
              <li key={date}>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t.rota.removeDate(formatIsoDate(date))}
                  onClick={() =>
                    void run("pause", () => removePauseDate({ ...args, date }))
                  }
                  className="min-h-12 rounded-full border-2 border-saffron bg-saffron-soft px-4 font-medium text-saffron-ink disabled:opacity-50"
                >
                  {formatIsoDate(date)} ×
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAddingDate(true)}
                className="min-h-12 rounded-full border-2 border-dashed border-green px-4 font-semibold text-green disabled:opacity-50"
              >
                {t.rota.addDate}
              </button>
            </li>
          </ul>
          <p className="mt-2 text-base text-ink-soft">
            {t.rota.pauseDatesHint}
          </p>
        </Section>

        <Section
          id="messages"
          heading={t.rota.messagesHeading}
          feedback={feedback}
        >
          <p className="text-ink-soft">
            {t.rota.messagesHint(formatTime(earliest), formatTime(latest))}
          </p>
          <div className="mt-3 rounded-ui border-2 border-line bg-card px-4 py-3">
            <p className="font-medium">{t.rota.messageNames.dayAt}</p>
            <TimeField
              value={messages.dayAt}
              min={earliest}
              max={latest}
              disabled={busy}
              onChange={(at) => setMessages({ ...messages, dayAt: at })}
            />
            <p className="mt-2 text-base text-ink-soft">{t.rota.locked}</p>
          </div>
          {MESSAGES.map((key) => (
            <div
              key={key}
              className="mt-3 rounded-ui border-2 border-line bg-card px-4 pb-3"
            >
              <SwitchRow
                label={t.rota.messageNames[key]}
                on={messages[key].on}
                disabled={busy}
                onChange={(on) =>
                  setMessages({
                    ...messages,
                    [key]: { ...messages[key], on },
                  })
                }
              />
              <TimeField
                value={messages[key].at}
                min={earliest}
                max={latest}
                disabled={busy}
                onChange={(at) =>
                  setMessages({
                    ...messages,
                    [key]: { ...messages[key], at },
                  })
                }
              />
            </div>
          ))}
          <div className="mt-4">
            <Button
              disabled={busy || !messagesChanged}
              onClick={() => void saveMessages()}
            >
              {t.rota.saveTimes}
            </Button>
          </div>
        </Section>

        <Section id="cheer" heading={t.cheer.heading} feedback={feedback}>
          <CheerField
            setting={settings.cheer}
            disabled={busy}
            hint={t.cheer.rotaHint}
            onSave={(cheer) =>
              void run(
                "cheer",
                () => update({ ...args, cheer }),
                t.organizer.saved,
              )
            }
          />
        </Section>

        <Section
          id="details"
          heading={t.rota.detailsHeading}
          feedback={feedback}
        >
          <label htmlFor="rota-settings-name" className="block font-medium">
            {t.rota.nameLabel}
          </label>
          <input
            id="rota-settings-name"
            type="text"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClass}
          />

          <div className="mt-6">
            <ReadingDaysField value={days} onChange={setDays} />
          </div>

          <div className="mt-4 grid gap-2.5">
            <div className="rounded-ui border-2 border-line bg-card px-4 py-3">
              <span className="block text-base text-ink-soft">
                {t.rota.startLabel}
              </span>
              <span className="font-medium">{formatIsoDate(start)}</span>
            </div>
            <DateLine
              label={t.rota.endLabel}
              value={endDate === null ? t.rota.noEnd : formatIsoDate(endDate)}
              inputLabel={t.rota.endDateInput}
              inputValue={endDate ?? ""}
              min={earliestEnd}
              onPick={setEndDate}
              clearLabel={t.rota.noEnd}
            />
          </div>

          <label
            htmlFor="rota-settings-zone"
            className="mt-6 block font-medium"
          >
            {t.rota.timeZoneLabel}
          </label>
          <select
            id="rota-settings-zone"
            dir="ltr"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            className={`${fieldClass} text-end`}
          >
            {timeZones(settings.timeZone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className="mt-1 text-base text-ink-soft">{t.rota.timeZoneHint}</p>

          <div className="mt-4">
            <Button
              disabled={busy || !changed || name.trim() === ""}
              onClick={() =>
                void run(
                  "details",
                  () => update({ ...args, ...changes }),
                  t.organizer.saved,
                )
              }
            >
              {t.organizer.save}
            </Button>
          </div>
        </Section>
      </fieldset>

      {/* Outside the fieldset: an archived khatma can still start again or be deleted. */}
      {settings.archived ? (
        <ArchivedSection
          inviteCode={inviteCode}
          restart={{ days: settings.days, timeZone: settings.timeZone }}
        />
      ) : (
        <ArchiveSection inviteCode={inviteCode} />
      )}

      {addingDate && (
        <Sheet
          title={t.rota.pickDateTitle}
          onClose={() => setAddingDate(false)}
        >
          {offeredDates.length === 0 ? (
            <p className="text-ink-soft">{t.rota.noUpcoming}</p>
          ) : (
            <ul className="grid gap-2">
              {offeredDates.map((date) => (
                <li key={date}>
                  <button
                    type="button"
                    onClick={() => void pickPauseDate(date)}
                    className="min-h-14 w-full rounded-ui border-2 border-line bg-card px-4 text-start font-medium"
                  >
                    {formatIsoDate(date)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </>
  );
}
