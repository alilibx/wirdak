import { api } from "@convex/_generated/api";
import { isValidGrace, type Grace } from "@convex/lib/grace";
import { SCHEDULES, type Schedule } from "@convex/lib/schedule";
import { useAction, useQuery } from "convex/react";
import posthog from "posthog-js";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../components/Button";
import { GraceField } from "../components/GraceField";
import { pendingIntent } from "../features/verify/progress";
import { VerifySheet } from "../features/verify/VerifySheet";
import { t } from "../i18n/ar";
import { errorCode } from "../lib/errors";
import { formatDate } from "../lib/format";
import { posthogLog } from "../lib/posthogLogs";
import {
  clearSessionToken,
  getSessionToken,
  useSessionToken,
} from "../lib/session";

const DEFAULT_SCHEDULE: Schedule = "weekly";
const createErrors: Record<string, string> = t.create.errors;

/** A create still waiting on verification (e.g. the tab reloaded while in WhatsApp). */
function resumedCreate() {
  const intent = pendingIntent();
  return intent?.kind === "create" ? intent : null;
}

const typeCardClass =
  "block min-h-14 w-full cursor-pointer rounded-ui border-2 border-line bg-card px-4 py-3 text-start focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-green";

/** The question of which kind: the pool khatma's form, or the rota khatma's two screens. */
function TypeCards({ onPool }: { onPool: () => void }) {
  return (
    <section className="mt-4">
      <h2 className="text-xl font-semibold">{t.rota.typeQuestion}</h2>
      <div className="mt-2 grid gap-2.5">
        <button type="button" onClick={onPool} className={typeCardClass}>
          <span className="block font-medium">{t.rota.poolTitle}</span>
          <span className="block text-base text-ink-soft">
            {t.rota.poolBody}
          </span>
        </button>
        <Link to="/new/rota" className={typeCardClass}>
          <span className="block font-medium">{t.rota.rotaTitle}</span>
          <span className="block text-base text-ink-soft">
            {t.rota.rotaBody}
          </span>
        </Link>
      </div>
    </section>
  );
}

export function CreatePage() {
  const navigate = useNavigate();
  const sessionToken = useSessionToken();
  const signedIn = sessionToken !== undefined;
  const me = useQuery(api.people.me, { sessionToken });
  const createKhatma = useAction(api.khatmas.create);
  const [resumed] = useState(resumedCreate);
  const [name, setName] = useState(resumed?.name ?? "");
  const [schedule, setSchedule] = useState<Schedule>(
    resumed?.schedule ?? DEFAULT_SCHEDULE,
  );
  // `null` while the grace follows the schedule's default; only an edit is sent.
  const [grace, setGrace] = useState<Grace | null>(resumed?.grace ?? null);
  // Only people an admin switched rota khatmas on for are asked which kind; a resumed create is a pool one.
  const [poolChosen, setPoolChosen] = useState(resumed !== null);
  const [verifying, setVerifying] = useState(resumed !== null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creatingRef = useRef(false);

  async function create() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    try {
      const { inviteCode } = await createKhatma({
        // Read at call time: right after verification the hook has not re-rendered yet.
        sessionToken: getSessionToken() ?? undefined,
        name: name.trim() === "" ? null : name.trim(),
        schedule,
        ...(grace ? { grace } : {}),
      });
      posthog.capture("khatma_created", {
        schedule,
        has_custom_grace: grace !== null,
      });
      posthogLog.info("khatma creation completed", {
        schedule,
        has_custom_grace: grace !== null,
      });
      void navigate(`/j/${encodeURIComponent(inviteCode)}`, {
        state: { justCreated: true },
      });
    } catch (caught) {
      const code = errorCode(caught);
      creatingRef.current = false;
      setCreating(false);
      if (code === "not_signed_in") {
        // The stored token is dead: forget it and sign in again, then create with the same values.
        clearSessionToken();
        setVerifying(true);
        return;
      }
      if (code !== null) {
        posthog.capture("khatma_create_blocked", { kind: "pool", code });
      }
      setError(
        code === null
          ? t.create.errors.network
          : (createErrors[code] ?? t.create.errors.generic),
      );
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (grace && !isValidGrace(grace)) return setError(t.create.graceInvalid);
    if (signedIn) void create();
    else setVerifying(true);
  }

  // Signed in, wait for the answer rather than flash a form that may turn into the cards.
  const waiting = signedIn && me === undefined;
  const showCards = !waiting && me?.rotaAllowed === true && !poolChosen;
  const showForm = !waiting && !showCards;

  return (
    <main className="mx-auto max-w-xl p-5">
      {/* Signed in, the bottom bar has the way home. */}
      {!signedIn && (
        <header className="mb-3.5">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center font-medium text-green underline underline-offset-4"
          >
            {t.create.back}
          </Link>
        </header>
      )}
      <h1 className="font-display text-4xl leading-tight text-green-deep">
        {t.pages.create}
      </h1>

      {showCards && <TypeCards onPool={() => setPoolChosen(true)} />}
      {showForm && (
        <form onSubmit={onSubmit} noValidate className="mt-4">
          <label htmlFor="khatma-name" className="block font-medium">
            {t.create.nameLabel}{" "}
            <span className="font-normal text-ink-soft">
              {t.create.optional}
            </span>
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

          <fieldset className="mt-5">
            <legend className="font-medium">{t.create.scheduleLegend}</legend>
            <div className="mt-2 grid gap-2.5">
              {SCHEDULES.map((value) => {
                const subtitle: string | undefined = t.create.subtitles[value];
                return (
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
                    <span>
                      <span className="font-medium">{t.schedules[value]}</span>
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
          <GraceField
            value={grace}
            schedule={schedule}
            onChange={(next) => {
              setGrace(next);
              setError(null);
            }}
          />

          {error && (
            <p role="alert" className="mt-4 font-medium text-[#8A2B1E]">
              {error}
            </p>
          )}
          <div className="mt-6">
            <Button type="submit" disabled={creating}>
              {creating ? t.create.submitting : t.create.submit}
            </Button>
          </div>
        </form>
      )}

      {verifying && (
        <VerifySheet
          title={t.create.beforeCreate}
          intent={{
            kind: "create",
            name,
            schedule,
            ...(grace ? { grace } : {}),
          }}
          onVerified={() => {
            setVerifying(false);
            void create();
          }}
          onClose={() => setVerifying(false)}
        />
      )}
    </main>
  );
}
