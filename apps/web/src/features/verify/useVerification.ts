import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { normalizeDigits } from "@convex/lib/digits";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n/ar";
import { convexSiteUrl } from "../../lib/env";
import { deviceLabel } from "../../lib/format";
import {
  getClientKey,
  getSessionToken,
  setSessionToken,
} from "../../lib/session";
import { waLink } from "../../lib/whatsapp";
import {
  clearProgress,
  loadProgress,
  saveProgress,
  type Progress,
  type VerifyIntent,
} from "./progress";

export type Step =
  "start" | "waiting" | "confirm" | "pin" | "devices" | "done" | "error";

type ErrorCode = keyof typeof t.verify.errors;
type Phase = null | "pin" | "devices" | "done" | "error";
type Busy = null | "start" | "claim" | "pin" | "notMe" | "signOut";

/** Verification codes and PINs both live 10 minutes. */
const TTL_MS = 10 * 60_000;
const PIN_LENGTH = 6;
/** Errors a fresh attempt cannot fix. */
const NO_RETRY: ReadonlySet<ErrorCode> = new Set(["whatsapp_not_configured"]);

const START_ERRORS: ReadonlySet<string> = new Set([
  "rate_limited",
  "maintenance",
  "whatsapp_not_configured",
]);

type StartResponse = {
  verificationId: string;
  secret: string;
  waNumber: string;
  message: string;
};

function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Opens a blank tab inside the click, before any await, so the popup blocker allows it.
 * Callers point it at WhatsApp after the fetch, or close it on failure.
 */
function openBlankWindow(): Window | null {
  try {
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;
    return win;
  } catch {
    return null;
  }
}

/** `intent` is stored with the progress, so the right page can resume after a reload. */
export function useVerification(intent?: VerifyIntent) {
  const [saved, setSaved] = useState<Progress | null>(loadProgress);
  const intentRef = useRef(intent);
  intentRef.current = intent;
  const [phase, setPhase] = useState<Phase>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [opened, setOpened] = useState(false);
  const busyRef = useRef(false);

  const live = useQuery(
    api.verification.status,
    saved
      ? {
          verificationId: saved.verificationId as Id<"verifications">,
          secret: saved.secret,
        }
      : "skip",
  );
  const claim = useAction(api.verification.claim);
  const confirmPin = useAction(api.verification.confirmPin);
  const reject = useMutation(api.verification.reject);
  const signOutOthersMutation = useMutation(api.sessions.signOutOthers);

  // Where the flow is, and the error that explains an error step, when the status decides it.
  let step: Step;
  let statusError: ErrorCode | null = null;
  if (phase === "done" || phase === "devices" || phase === "error") {
    step = phase;
  } else if (!saved) {
    step = "start";
  } else if (live === undefined) {
    step = phase === "pin" ? "pin" : "waiting";
  } else if (live.status === "expired" || live.status === "rejected") {
    step = "error";
    statusError = live.status;
  } else if (live.status === "claimed") {
    // Our own claim flips this just before it returns; keep the step until it does.
    if (busy === "pin") step = "pin";
    else if (busy === "claim") step = "confirm";
    else if (getSessionToken() !== null) step = "done";
    else {
      step = "error";
      statusError = "generic";
    }
  } else if (phase === "pin" || live.status === "needs_pin") {
    step = "pin";
  } else {
    step = live.status === "matched" ? "confirm" : "waiting";
  }

  // Progress only matters while a verification is open.
  useEffect(() => {
    if (step === "error" || step === "devices" || step === "done") {
      clearProgress();
    }
  }, [step]);

  // A match (or the PIN request) restarts the server's 10 minutes, so the stored deadline moves
  // with it; otherwise a reload late in the first window would drop a verification still alive.
  const liveStatus = live?.status;
  useEffect(() => {
    if (!saved || (liveStatus !== "matched" && liveStatus !== "needs_pin")) {
      return;
    }
    saveProgress({ ...saved, expiresAt: Date.now() + TTL_MS });
  }, [liveStatus, saved]);

  const code = statusError ?? errorCode;
  const error = code ? t.verify.errors[code] : null;

  function fail(next: ErrorCode): void {
    setErrorCode(next);
    setPhase("error");
  }

  /** Runs one server call at a time; a thrown call is a network failure (by default it ends the attempt). */
  async function run(
    kind: Exclude<Busy, null>,
    work: () => Promise<void>,
    onThrow: () => void = () => fail("network"),
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try {
      await work();
    } catch {
      onThrow();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function finish(token: string, otherSessions: number): void {
    setSessionToken(token);
    clearProgress();
    setErrorCode(null);
    setPhase(otherSessions > 0 ? "devices" : "done");
  }

  /** No name yet: only a new number needs one, and WhatsApp tells us which it is. */
  async function start(): Promise<void> {
    if (busyRef.current) return;
    const win = openBlankWindow();
    const closeBlank = () => {
      if (win && !win.closed) win.close();
    };
    await run("start", async () => {
      setErrorCode(null);
      let res: Response;
      try {
        res = await fetch(`${convexSiteUrl()}/api/verification/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The WhatsApp reply links back to this page, where the sheet resumes.
          body: JSON.stringify({
            clientKey: getClientKey(),
            returnPath: window.location.pathname,
          }),
        });
      } catch {
        closeBlank();
        return fail("network");
      }
      const body = (await res.json().catch(() => null)) as
        (Partial<StartResponse> & { error?: string }) | null;
      if (
        !res.ok ||
        !body ||
        typeof body.verificationId !== "string" ||
        typeof body.secret !== "string" ||
        typeof body.waNumber !== "string" ||
        typeof body.message !== "string"
      ) {
        closeBlank();
        const reason = body?.error ?? "";
        return fail(
          START_ERRORS.has(reason) ? (reason as ErrorCode) : "generic",
        );
      }
      const waUrl = waLink(body.waNumber, body.message);
      if (win && !win.closed) {
        win.location.href = waUrl;
        setOpened(true);
      }
      const progress: Progress = {
        verificationId: body.verificationId,
        secret: body.secret,
        expiresAt: Date.now() + TTL_MS,
        waUrl,
        ...(intentRef.current ? { intent: intentRef.current } : {}),
      };
      saveProgress(progress);
      setSaved(progress);
      setPhase(null);
    });
  }

  // A thrown call keeps the attempt and its step; the user taps again.
  const keepStep = () => setErrorCode("network");

  /** A new number's name goes with the claim, which creates the account. */
  async function confirm(name: string): Promise<void> {
    if (!saved || busyRef.current) return;
    const displayName = name.trim();
    if (!displayName) {
      setErrorCode("nameRequired");
      return;
    }
    await run(
      "claim",
      async () => {
        setErrorCode(null);
        const res = await claim({
          verificationId: saved.verificationId as Id<"verifications">,
          secret: saved.secret,
          deviceLabel: deviceLabel(navigator.userAgent),
          timeZone: timeZone(),
          displayName,
        });
        if ("sessionToken" in res) return finish(res.sessionToken, 0);
        if (res.error === "needs_pin") return setPhase("pin");
        // The attempt stays open: the person fixes the name and taps again.
        if (res.error === "name_required") return setErrorCode("nameRequired");
        if (res.error === "invalid_name") return setErrorCode("invalid_name");
        fail("expired");
      },
      keepStep,
    );
  }

  async function notMe(): Promise<void> {
    if (!saved) return;
    await run(
      "notMe",
      async () => {
        setErrorCode(null);
        await reject({
          verificationId: saved.verificationId as Id<"verifications">,
          secret: saved.secret,
        });
        fail("rejected");
      },
      keepStep,
    );
  }

  async function submitPin(raw: string): Promise<void> {
    const pin = normalizeDigits(raw).replace(/\D/gu, "");
    if (!saved || pin.length !== PIN_LENGTH) return;
    await run(
      "pin",
      async () => {
        setErrorCode(null);
        const res = await confirmPin({
          verificationId: saved.verificationId as Id<"verifications">,
          secret: saved.secret,
          pin,
          deviceLabel: deviceLabel(navigator.userAgent),
          timeZone: timeZone(),
        });
        if ("sessionToken" in res) {
          return finish(res.sessionToken, res.otherSessions);
        }
        if (res.error === "wrong_pin") return setErrorCode("wrong_pin");
        fail(res.error);
      },
      keepStep,
    );
  }

  /** The user is already signed in here, so a failure stays on the devices step. */
  async function signOutOthers(): Promise<void> {
    await run(
      "signOut",
      async () => {
        setErrorCode(null);
        await signOutOthersMutation({
          sessionToken: getSessionToken() ?? undefined,
        });
        setPhase("done");
      },
      keepStep,
    );
  }

  /** Forgets a sign-in that was not finished, e.g. when the sheet closes on a shared phone. */
  function discard(): void {
    clearProgress();
  }

  function continueFromDevices(): void {
    setPhase("done");
  }

  function reopenWhatsApp(): void {
    if (!saved?.waUrl) return;
    window.open(saved.waUrl, "_blank", "noopener");
    setOpened(true);
  }

  /** Back to the start step, forgetting the current attempt. */
  function reset(): void {
    clearProgress();
    setSaved(null);
    setPhase(null);
    setErrorCode(null);
    setBusy(null);
    setOpened(false);
  }

  return {
    step,
    maskedPhone: live?.maskedPhone ?? null,
    error,
    /** The key of `error`, for analytics: never the person's input. */
    errorCode: code,
    canRetry: step === "error" && code !== null && !NO_RETRY.has(code),
    busy: busy !== null,
    waUrl: saved?.waUrl ?? null,
    opened,
    start,
    confirm,
    notMe,
    submitPin,
    signOutOthers,
    continueFromDevices,
    reopenWhatsApp,
    reset,
    discard,
  };
}
