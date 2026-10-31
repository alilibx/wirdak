import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CheerConfig } from "@convex/lib/cheer";
import { isValidGrace, type Grace } from "@convex/lib/grace";
import { SCHEDULES, type Schedule } from "@convex/lib/schedule";
import { useAction, useMutation, useQuery } from "convex/react";
import posthog from "posthog-js";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { Button } from "../components/Button";
import { formatGrace, GraceField } from "../components/GraceField";
import { Sheet } from "../components/Sheet";
import {
  ArchivedSection,
  ArchiveSection,
} from "../features/khatma/ArchivedActions";
import { CheerField } from "../features/khatma/CheerField";
import { DeletingPage, useDeleting } from "../features/khatma/deleting";
import { t } from "../i18n/ar";
import { errorCode } from "../lib/errors";
import { formatDate } from "../lib/format";
import { useSessionToken } from "../lib/session";
import { RotaSettingsPage } from "./RotaSettingsPage";

const headingClass = "mb-3 text-xl font-semibold";
const sectionClass = "mt-8";
const errorText = "mt-3 font-medium text-[#8A2B1E]";
const rowButton =
  "min-h-14 rounded-ui border-2 border-line px-4 font-medium text-green-deep disabled:opacity-50";
const organizerErrors: Record<string, string> = t.organizer.errors;

type Settings = Exclude<
  NonNullable<ReturnType<typeof useQuery<typeof api.organizer.settings>>>,
  { forbidden: true }
>;

type Confirm =
  | { kind: "remove" | "handover"; memberId: Id<"members">; name: string }
  | { kind: "reset" };

type SectionId =
  "name" | "schedule" | "grace" | "cheer" | "members" | "blocked" | "reset";

/** The one line of feedback on the page, shown under the section that caused it. */
type Feedback = { section: SectionId; kind: "saved" | "error"; text: string };

const sameGrace = (a: Grace, b: Grace) =>
  a.value === b.value && a.unit === b.unit;

export function OrganizerPage() {
  const { inviteCode = "" } = useParams();
  const sessionToken = useSessionToken();
  const settings = useQuery(api.organizer.settings, {
    sessionToken,
    inviteCode,
  });
  // A rotating khatma has its own settings; the answer is null for any other.
  const rotaSettings = useQuery(api.rota.settings, {
    sessionToken,
    inviteCode,
  });
  // Resetting the link kills the old code, so its query turns `forbidden` before the new code
  // is navigated to. That moment must not bounce the organizer to the dead address.
  const resetting = useRef(false);
  // Deleted from here: the queries are about to turn null, and this page must not show that.
  const deleting = useDeleting(inviteCode);

  if (deleting) return <DeletingPage />;
  if (rotaSettings !== undefined && rotaSettings !== null) {
    return <RotaSettingsPage />;
  }
  if (
    settings === undefined ||
    rotaSettings === undefined ||
    ("forbidden" in settings && resetting.current)
  ) {
    return (
      <main aria-busy="true" className="mx-auto max-w-xl p-5">
        <p className="py-16 text-center text-xl text-ink-soft">
          {t.common.loading}
        </p>
      </main>
    );
  }
  if ("forbidden" in settings) {
    return <Navigate to={khatmaPath(inviteCode)} replace />;
  }
  return (
    <OrganizerContent
      settings={settings}
      inviteCode={inviteCode}
      resetting={resetting}
      archived={settings.archived}
    />
  );
}

const khatmaPath = (inviteCode: string) =>
  `/j/${encodeURIComponent(inviteCode)}`;

function OrganizerContent({
  settings,
  inviteCode,
  resetting,
  archived,
}: {
  settings: Settings;
  inviteCode: string;
  resetting: RefObject<boolean>;
  archived: boolean;
}) {
  const sessionToken = useSessionToken();
  const navigate = useNavigate();
  const update = useMutation(api.organizer.update);
  const removeMember = useMutation(api.organizer.removeMember);
  const unblock = useMutation(api.organizer.unblock);
  const handOver = useMutation(api.organizer.handOver);
  const resetInvite = useAction(api.organizer.resetInvite);

  const [name, setName] = useState(settings.name ?? "");
  const [schedule, setSchedule] = useState<Schedule>(settings.schedule);
  const [grace, setGrace] = useState<Grace>(settings.grace);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const trimmed = name.trim();
  const nameChanged = trimmed !== (settings.name ?? "");
  const scheduleChanged = schedule !== settings.schedule;
  const graceChanged = !sameGrace(grace, settings.grace);
  const graceValid = isValidGrace(grace);

  /**
   * One call at a time. A thrown `forbidden` means the role is gone: back to the khatma.
   * `work` returns the copy of a refusal to show, or null when it went through; the result
   * shows under `section`.
   */
  async function run(
    section: SectionId,
    work: () => Promise<string | null>,
    saved: string | null = null,
  ): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const refusal = await work();
      if (refusal !== null) {
        setFeedback({ section, kind: "error", text: refusal });
      } else if (saved !== null) {
        setFeedback({ section, kind: "saved", text: saved });
      }
    } catch (caught) {
      const code = errorCode(caught);
      if (code === "forbidden") {
        void navigate(khatmaPath(inviteCode), { replace: true });
        return;
      }
      setFeedback({
        section,
        kind: "error",
        text:
          code === null
            ? t.organizer.errors.network
            : (organizerErrors[code] ?? t.organizer.errors.generic),
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const save = (
    section: SectionId,
    changes:
      | { name: string | null }
      | { schedule: Schedule }
      | { grace: Grace }
      | { cheer: CheerConfig | null },
  ) =>
    run(
      section,
      async () => {
        const result = await update({ sessionToken, inviteCode, ...changes });
        if (!result.ok) {
          return result.reason === "invalid_grace"
            ? t.grace.range
            : t.organizer.errors.generic;
        }
        posthog.capture("organizer_settings_updated", { setting: section });
        return null;
      },
      t.organizer.saved,
    );

  const confirmed = (action: Confirm) => {
    setConfirm(null);
    if (action.kind === "reset") {
      return run("reset", async () => {
        resetting.current = true;
        try {
          const { inviteCode: fresh } = await resetInvite({
            sessionToken,
            inviteCode,
          });
          posthog.capture("khatma_invite_reset");
          void navigate(khatmaPath(fresh), {
            replace: true,
            state: { openInvite: true },
          });
        } catch (error) {
          // Only a failed reset gives the old code back. After a success the
          // page is about to leave, so the flag stays and the old code's
          // forbidden state can't bounce the organizer to the dead link.
          resetting.current = false;
          throw error;
        }
        return null;
      });
    }
    return run("members", async () => {
      const args = { sessionToken, inviteCode, memberId: action.memberId };
      const result =
        action.kind === "remove"
          ? await removeMember(args)
          : await handOver(args);
      if (!result.ok) return t.organizer.errors.generic;
      posthog.capture("member_management_completed", {
        action: action.kind,
      });
      if (action.kind === "handover") {
        void navigate(khatmaPath(inviteCode), { replace: true });
      }
      return null;
    });
  };

  const sheet = confirm && sheetCopy(confirm);

  return (
    <>
      <main className="mx-auto max-w-xl p-5">
        <header className="mb-3.5">
          <Link
            to={`${khatmaPath(inviteCode)}?tab=group`}
            className="inline-flex min-h-11 items-center font-medium text-green underline underline-offset-4"
          >
            {t.organizer.back}
          </Link>
        </header>
        <h1 className="font-display text-4xl leading-tight text-green-deep">
          {t.khatmaSettings.link}
        </h1>

        {archived && (
          <p
            role="note"
            className="mt-4 rounded-ui border-2 border-line bg-paper-2 p-3 font-medium"
          >
            {t.rota.archivedSettings}
          </p>
        )}

        {!archived && (
          <>
            <Section
              id="name"
              heading={t.organizer.nameHeading}
              feedback={feedback}
            >
              <label htmlFor="khatma-name" className="block font-medium">
                {t.create.nameLabel}
              </label>
              <input
                id="khatma-name"
                type="text"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.create.namePlaceholder(formatDate(Date.now()))}
                className="mt-1.5 min-h-14 w-full rounded-ui border-2 border-line bg-white px-4 text-ink"
              />
              <SaveButton
                disabled={busy || !nameChanged}
                onClick={() =>
                  void save("name", { name: trimmed === "" ? null : trimmed })
                }
              />
            </Section>

            <Section
              id="schedule"
              heading={t.create.scheduleLegend}
              feedback={feedback}
            >
              <div className="grid gap-2.5">
                {SCHEDULES.map((value) => (
                  <label
                    key={value}
                    className="flex min-h-14 cursor-pointer items-center gap-3 rounded-ui border-2 border-line bg-card px-4 py-3 has-[:checked]:border-green has-[:checked]:bg-[#E7F5EC] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green"
                  >
                    <input
                      type="radio"
                      name="schedule"
                      value={value}
                      checked={schedule === value}
                      onChange={() => setSchedule(value)}
                      className="size-5 shrink-0 accent-green"
                    />
                    <span className="font-medium">{t.schedules[value]}</span>
                  </label>
                ))}
              </div>
              <p className="mt-3 text-ink-soft">{t.organizer.scheduleNote}</p>
              <SaveButton
                disabled={busy || !scheduleChanged}
                onClick={() => void save("schedule", { schedule })}
              />
            </Section>

            <Section id="grace" heading={t.grace.label} feedback={feedback}>
              <p className="leading-relaxed text-ink-soft">
                {t.organizer.graceNote}
              </p>
              <GraceField
                value={grace}
                schedule={settings.schedule}
                onChange={(next) => {
                  setGrace(next);
                  setFeedback(null);
                }}
              />
              {!sameGrace(settings.suggestedGrace, settings.grace) && (
                <p className="mt-3 text-ink-soft">
                  {t.organizer.suggested(formatGrace(settings.suggestedGrace))}
                </p>
              )}
              <SaveButton
                disabled={busy || !graceChanged || !graceValid}
                onClick={() => void save("grace", { grace })}
              />
            </Section>

            <Section id="cheer" heading={t.cheer.heading} feedback={feedback}>
              <CheerField
                setting={settings.cheer}
                disabled={busy}
                onSave={(cheer) => void save("cheer", { cheer })}
              />
            </Section>
          </>
        )}

        <Section
          id="members"
          heading={t.organizer.membersHeading}
          feedback={feedback}
        >
          <ul className="grid gap-3">
            {settings.members.map((member) => (
              <li
                key={member.memberId}
                className="rounded-ui border border-line bg-card p-4"
              >
                <span className="font-medium">{member.displayName}</span>
                {member.isOrganizer ? (
                  <span className="ms-2 inline-block rounded-full bg-saffron-soft px-3 py-0.5 text-base font-semibold text-saffron-ink">
                    {t.organizer.organizerBadge}
                  </span>
                ) : archived ? null : (
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${t.organizer.makeOrganizer}: ${member.displayName}`}
                      onClick={() =>
                        setConfirm({
                          kind: "handover",
                          memberId: member.memberId,
                          name: member.displayName,
                        })
                      }
                      className={rowButton}
                    >
                      {t.organizer.makeOrganizer}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${t.organizer.remove}: ${member.displayName}`}
                      onClick={() =>
                        setConfirm({
                          kind: "remove",
                          memberId: member.memberId,
                          name: member.displayName,
                        })
                      }
                      className={rowButton}
                    >
                      {t.organizer.remove}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>

        {!archived && settings.blocked.length > 0 && (
          <Section
            id="blocked"
            heading={t.organizer.blockedHeading}
            feedback={feedback}
          >
            <ul className="grid gap-3">
              {settings.blocked.map((member) => (
                <li
                  key={member.memberId}
                  className="rounded-ui border border-line bg-card p-4"
                >
                  <span className="font-medium">{member.displayName}</span>
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${t.organizer.allow}: ${member.displayName}`}
                      onClick={() =>
                        void run("blocked", async () => {
                          const result = await unblock({
                            sessionToken,
                            inviteCode,
                            memberId: member.memberId,
                          });
                          if (!result.ok) return t.organizer.errors.generic;
                          posthog.capture("member_management_completed", {
                            action: "unblock",
                          });
                          return null;
                        })
                      }
                      className={rowButton}
                    >
                      {t.organizer.allow}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {!archived && (
          <Section
            id="reset"
            heading={t.organizer.resetHeading}
            feedback={feedback}
          >
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirm({ kind: "reset" })}
            >
              {t.organizer.reset}
            </Button>
          </Section>
        )}

        {archived ? (
          <ArchivedSection inviteCode={inviteCode} restart={null} />
        ) : (
          <ArchiveSection inviteCode={inviteCode} />
        )}
      </main>

      {confirm && sheet && (
        <Sheet title={sheet.title} onClose={() => setConfirm(null)}>
          <p className="mt-1 leading-relaxed text-ink-soft">{sheet.body}</p>
          <div className="mt-5 grid gap-3">
            <Button disabled={busy} onClick={() => void confirmed(confirm)}>
              {sheet.confirm}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t.organizer.cancel}
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function sheetCopy(confirm: Confirm) {
  switch (confirm.kind) {
    case "remove":
      return {
        title: t.organizer.removeTitle(confirm.name),
        body: t.organizer.removeBody,
        confirm: t.organizer.remove,
      };
    case "handover":
      return {
        title: t.organizer.handoverTitle(confirm.name),
        body: t.organizer.handoverBody,
        confirm: t.organizer.makeOrganizer,
      };
    case "reset":
      return {
        title: t.organizer.resetTitle,
        body: t.organizer.resetBody,
        confirm: t.organizer.resetConfirm,
      };
  }
}

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
    <section aria-label={heading} className={sectionClass}>
      <h2 className={headingClass}>{heading}</h2>
      {children}
      {own?.kind === "error" && (
        <p role="alert" className={errorText}>
          {own.text}
        </p>
      )}
      <p role="status" className="mt-3 font-medium text-green">
        {own?.kind === "saved" ? own.text : ""}
      </p>
    </section>
  );
}

function SaveButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="mt-4">
      <Button disabled={disabled} onClick={onClick}>
        {t.organizer.save}
      </Button>
    </div>
  );
}
