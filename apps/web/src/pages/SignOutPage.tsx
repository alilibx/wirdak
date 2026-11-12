import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button, buttonClass } from "../components/Button";
import { t } from "../i18n/ar";
import { clearSessionToken, getSessionToken } from "../lib/session";

/**
 * kept: the caller's own session (the real owner's) survived. all: every session of the owner is
 * gone, this device's included if it was one. owner: this device is signed in as someone else
 * (a shared phone), so it stays signed in and the message names nobody.
 */
type Outcome = "kept" | "all" | "owner" | "invalid";

const OUTCOMES: readonly Outcome[] = ["kept", "all", "owner", "invalid"];
const PREFIX = "wirdak.signout.";
const LAST_KEY = `${PREFIX}last`;

/** A short, non-secret key for the token, so the token itself is never written to storage. */
function keyFor(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash = Math.imul(hash ^ token.charCodeAt(i), 0x01000193);
  }
  return PREFIX + (hash >>> 0).toString(16);
}

function readOutcome(key: string | null): Outcome | null {
  try {
    const stored = key && sessionStorage.getItem(key);
    return OUTCOMES.find((o) => o === stored) ?? null;
  } catch {
    return null;
  }
}

function saveOutcome(key: string, outcome: Outcome): void {
  try {
    sessionStorage.setItem(key, outcome);
    sessionStorage.setItem(LAST_KEY, key);
  } catch {
    // Without storage a reload simply asks the server again.
  }
}

/** Removes `t` from the address bar, keeping the router's history state. */
function stripToken(): void {
  const params = new URLSearchParams(location.search);
  if (!params.has("t")) return;
  params.delete("t");
  const query = params.toString();
  history.replaceState(
    history.state,
    "",
    location.pathname + (query ? `?${query}` : "") + location.hash,
  );
}

function lastKey(): string | null {
  try {
    return sessionStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/**
 * The "not me" link from a sign-in alert. Nothing happens until the person confirms, so an
 * accidental tap or a link preview cannot sign anyone out. The alert token is single use, so the
 * server is asked once per token and the answer is remembered for this tab: a reload or a double
 * tap must not turn "done" into "link no longer valid".
 */
export function SignOutPage() {
  const [search] = useSearchParams();
  // Captured on first render; the address bar is cleaned right after.
  const [token] = useState(() => search.get("t"));
  const key = token ? keyFor(token) : null;
  const [outcome, setOutcome] = useState<Outcome | null>(() =>
    // Reloaded without `t`: show what this tab last learned, else the link is not usable.
    token ? readOutcome(key) : (readOutcome(lastKey()) ?? "invalid"),
  );
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const signOutOthers = useMutation(api.sessions.signOutOthersByAlertToken);
  const started = useRef(false);

  // The link is only spent once its outcome is remembered. Until then `t` stays in the address
  // bar, so a reload mid-flight or after a network failure can still finish the job.
  useEffect(() => {
    if (outcome !== null) stripToken();
  }, [outcome]);

  /** Runs on the confirm (or retry) tap only; `started` makes a double tap send once. */
  async function run(alertToken: string, storeKey: string) {
    if (started.current) return;
    started.current = true;
    setFailed(false);
    setRunning(true);
    try {
      const sessionToken = getSessionToken() ?? undefined;
      const result = await signOutOthers({ alertToken, sessionToken });
      let next: Outcome = "invalid";
      if (result.ok) {
        // Only forget the local token when it was one of those signed out.
        if (result.callerAffected) clearSessionToken();
        next = result.keptCurrent
          ? "kept"
          : result.callerAffected || sessionToken === undefined
            ? "all"
            : "owner";
      }
      saveOutcome(storeKey, next);
      setOutcome(next);
    } catch {
      started.current = false;
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main
      aria-busy={running}
      className="mx-auto flex max-w-xl flex-col gap-6 p-5 pt-16 text-center"
    >
      {outcome !== null ? (
        <p
          role="status"
          className="font-display text-3xl leading-snug text-green-deep"
        >
          {t.signOut[outcome]}
        </p>
      ) : failed ? (
        <>
          <p role="alert" className="text-xl font-medium text-danger">
            {t.signOut.error}
          </p>
          {token && key && (
            <Button variant="ghost" onClick={() => void run(token, key)}>
              {t.signOut.retry}
            </Button>
          )}
        </>
      ) : running ? (
        <p className="text-xl text-ink-soft">{t.common.loading}</p>
      ) : (
        token &&
        key && (
          <>
            <h1 className="font-display text-3xl leading-snug text-green-deep">
              {t.signOut.confirmTitle}
            </h1>
            <p className="text-lg leading-relaxed">{t.signOut.confirmBody}</p>
            <Button onClick={() => void run(token, key)}>
              {t.signOut.confirm}
            </Button>
          </>
        )
      )}
      <Link to="/" className={buttonClass("ghost", "text-green")}>
        {t.common.home}
      </Link>
    </main>
  );
}
