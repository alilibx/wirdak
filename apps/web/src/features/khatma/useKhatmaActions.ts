import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { KhatmaView } from "@convex/khatmas";
import { toWesternDigits } from "@convex/lib/digits";
import type {
  FinishResult,
  ReleaseResult,
  StillReadingResult,
  TakeResult,
  UndoResult,
} from "@convex/pool";
import { useMutation } from "convex/react";
import posthog from "posthog-js";
import { useEffect, useRef, useState } from "react";
import { UNDO_WINDOW_MS, type ToastData } from "../../components/Toast";
import { pendingIntent } from "../verify/progress";
import { t } from "../../i18n/ar";
import { errorCode } from "../../lib/errors";
import { markPushAsked, pushAsked, pushSupport } from "../../lib/push";
import { clearSessionToken, useSessionToken } from "../../lib/session";

type Failure<R> = R extends { ok: false; reason: infer Reason }
  ? Reason
  : never;

const errors = t.actions.errors;
// Typed against the server's unions: a new failure reason is a compile error until it has copy.
const takeCopy: Record<Failure<TakeResult>, string> = {
  ...errors.shared,
  ...errors.take,
};
const releaseCopy: Record<Failure<ReleaseResult>, string> = {
  ...errors.shared,
  not_holding: errors.notHolding,
};
// `taken_over` is not here: it is a thank-you with the juz' number, handled in `finish`.
const finishCopy: Record<
  Exclude<Failure<FinishResult>, "taken_over">,
  string
> = releaseCopy;
const stillReadingCopy: Record<Failure<StillReadingResult>, string> = {
  ...errors.shared,
  not_holding: errors.notHolding,
  ...errors.stillReading,
};
const undoCopy: Record<Failure<UndoResult>, string> = {
  ...errors.shared,
  ...errors.undo,
};

/** The juz' of a verification still in flight for this khatma (e.g. the tab reloaded while in WhatsApp). */
function resumedJuz(inviteCode: string): number | null {
  const intent = pendingIntent();
  return intent?.kind === "take" && intent.inviteCode === inviteCode
    ? intent.juz
    : null;
}

/** How long after losing a race we wait for the view to offer another juz'. */
const LOST_WAIT_MS = 5_000;

export type OpenSheet =
  | { kind: "take"; juz: number }
  | { kind: "release" }
  | { kind: "push" }
  | { kind: "install" }
  | { kind: "whatsapp" }
  | null;

/**
 * How long the undo button stays, from the moment the finish result arrives. The server's
 * deadline is trusted only when it lands inside the 10-second window; if the client clock is
 * off it cannot be, so the full window starts at receipt instead.
 */
export function undoWindowMs(undoUntil: number, now: number): number {
  const remaining = undoUntil - now;
  return remaining > 0 && remaining <= UNDO_WINDOW_MS
    ? remaining
    : UNDO_WINDOW_MS;
}

/**
 * Everything the khatma page does besides drawing: the take, finish, undo, release and
 * celebrated mutations behind one busy lock, the sheet and toast state, and the two flows that
 * wait for the view (take after verification, take again after losing a race).
 */
export function useKhatmaActions(
  view: KhatmaView | { notFound: true } | undefined,
  inviteCode: string,
  options: { onTaken?: (juz: number) => void } = {},
) {
  const sessionToken = useSessionToken();
  const loaded = view !== undefined && !("notFound" in view) ? view : null;
  const signedIn = loaded?.me.signedIn ?? false;
  const celebrating = loaded !== null && loaded.me.celebrateRound !== null;

  // The juz' a signed-out visitor tapped; it also means the verify sheet is open. A verification
  // already in flight for this khatma reopens the sheet, so a reloaded tab carries on.
  const [pendingJuz, setPendingJuz] = useState<number | null>(() =>
    resumedJuz(inviteCode),
  );
  // The juz' to offer once the view has reloaded for the new session.
  const [verifiedJuz, setVerifiedJuz] = useState<number | null>(null);
  // The juz' someone else just took; we reopen the sheet when the view offers another.
  const [lostJuz, setLostJuz] = useState<number | null>(null);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const toastId = useRef(0);
  // A mutation can come back after the person has left the page. Nothing may act on it then:
  // a tab change would navigate them back to this khatma.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const takeMutation = useMutation(api.pool.take);
  const finishMutation = useMutation(api.pool.finish);
  const undoMutation = useMutation(api.pool.undoFinish);
  const releaseMutation = useMutation(api.pool.release);
  const stillReadingMutation = useMutation(api.pool.stillReading);
  const dismissMutation = useMutation(api.notes.dismiss);
  const notificationsMutation = useMutation(api.khatmas.setNotifications);
  const celebratedMutation = useMutation(api.khatmas.markCelebrated);
  const signOutMutation = useMutation(api.sessions.signOut);

  // After verification the view reloads under the new token. Wait for it, and never offer a
  // second juz' to someone who already holds one.
  useEffect(() => {
    if (verifiedJuz === null || !loaded?.me.signedIn || celebrating) return;
    setVerifiedJuz(null);
    if (loaded.me.holding !== null) return;
    const wanted = loaded.tiles.find((x) => x.juz === verifiedJuz);
    const juz = wanted?.state === "open" ? verifiedJuz : loaded.me.suggestion;
    if (juz !== null) setSheet({ kind: "take", juz });
  }, [verifiedJuz, loaded, celebrating]);

  // After losing a race, offer the new suggestion. While the view still suggests the juz' we
  // lost, it has not caught up yet, so keep waiting (see the timeout below).
  useEffect(() => {
    if (lostJuz === null || !loaded || celebrating) return;
    const { holding, suggestion } = loaded.me;
    if (holding !== null || suggestion === null) return setLostJuz(null);
    if (suggestion === lostJuz) return;
    setLostJuz(null);
    setSheet({ kind: "take", juz: suggestion });
  }, [lostJuz, loaded, celebrating]);

  // The wait is bounded, so a much later, unrelated change of suggestion cannot pop a sheet open.
  useEffect(() => {
    if (lostJuz === null) return;
    const timer = setTimeout(() => setLostJuz(null), LOST_WAIT_MS);
    return () => clearTimeout(timer);
  }, [lostJuz]);

  // The celebration takes over the screen, and nothing may wait behind it.
  useEffect(() => {
    if (!celebrating) return;
    setSheet(null);
    setLostJuz(null);
    setVerifiedJuz(null);
  }, [celebrating]);

  // A release confirmation for a juz' that is no longer held (released elsewhere, or finished
  // by someone's other device) has nothing left to confirm.
  const holdingNothing = loaded !== null && loaded.me.holding === null;
  useEffect(() => {
    if (holdingNothing && sheet?.kind === "release") setSheet(null);
  }, [holdingNothing, sheet]);

  const showToast = (text: string, undoMs?: number) =>
    setToast({ id: ++toastId.current, text, undoMs });

  const askToSignInAgain = () => showToast(t.actions.errors.signedOut);

  /**
   * One server call at a time. A thrown call without a server code is a network failure: toast it
   * and let the user retry. `not_signed_in` means the session ended elsewhere, and retrying never
   * helps: forget the dead token and hand over to `onSignedOut`. Any other code gets generic copy.
   */
  async function run<T>(
    work: () => Promise<T>,
    onSignedOut: () => void = askToSignInAgain,
  ): Promise<T | undefined> {
    setLostJuz(null); // any user action ends the wait for a suggestion
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    try {
      return await work();
    } catch (caught) {
      const code = errorCode(caught);
      if (code === "not_signed_in") {
        clearSessionToken();
        onSignedOut();
      } else if (code === "archived") {
        // Archived while the page was open: the view catches up by itself.
        showToast(t.actions.errors.archived);
      } else {
        showToast(code === null ? t.errors.network : t.errors.generic);
      }
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const args = { sessionToken, inviteCode };

  const take = (juz: number) => {
    if (!signedIn) return setPendingJuz(juz);
    setLostJuz(null);
    setSheet({ kind: "take", juz });
  };
  const openRelease = () => {
    setLostJuz(null);
    setSheet({ kind: "release" });
  };
  const closeSheet = () => {
    setLostJuz(null);
    setSheet(null);
  };
  const verified = () => {
    const juz = pendingJuz;
    setPendingJuz(null);
    if (juz !== null) setVerifiedJuz(juz);
  };
  const cancelVerify = () => setPendingJuz(null);

  /**
   * "Not you?" on a shared phone: sign this account out (here and on the server), then verify
   * whoever is holding the phone for the same juz'; the usual take-after-verification flow
   * offers it once the view reloads under their session.
   */
  async function switchAccount(juz: number) {
    const signedOut = await run(async () => {
      await signOutMutation({ sessionToken });
      return true;
    });
    if (!signedOut) return;
    clearSessionToken();
    setSheet(null);
    setPendingJuz(juz);
  }

  /**
   * Once, after the first juz' taken in this browser: the push prompt, the iPhone install steps,
   * or, where push can't work, the offer to send notifications on WhatsApp.
   */
  function offerPush() {
    if (pushAsked()) return;
    const support = pushSupport();
    markPushAsked();
    const kind =
      support === "ready"
        ? "push"
        : support === "ios_install"
          ? "install"
          : "whatsapp";
    posthog.capture("notification_prompt_shown", { prompt: kind });
    setSheet({ kind });
  }

  async function confirmTake(juz: number) {
    // A dead session takes the signed-out path: verify, then take the same juz'.
    const result = await run(
      () => takeMutation({ ...args, juz }),
      () => {
        setSheet(null);
        setPendingJuz(juz);
      },
    );
    if (!result) return;
    setSheet(null);
    if (result.ok) {
      posthog.capture("juz_taken", { juz_number: juz });
      if (!mounted.current) return;
      options.onTaken?.(juz);
      showToast(t.toast.taken(toWesternDigits(juz)));
      return offerPush();
    }
    showToast(takeCopy[result.reason]);
    if (result.reason === "taken") setLostJuz(juz);
  }

  async function finish() {
    const held = loaded?.me.holding ?? null;
    const result = await run(() => finishMutation(args));
    if (!result) return;
    if (result.ok) {
      posthog.capture("juz_finished", { juz_number: held });
      showToast(t.toast.finished, undoWindowMs(result.undoUntil, Date.now()));
    } else if (result.reason === "taken_over") {
      // Someone else is finishing it: thank them for it, and offer no undo (nothing was finished).
      showToast(
        held === null
          ? t.errors.generic
          : t.toast.takenOver(toWesternDigits(held)),
      );
    } else {
      showToast(finishCopy[result.reason]);
    }
  }

  async function stillReading() {
    const result = await run(() => stillReadingMutation(args));
    if (!result) return;
    if (result.ok) posthog.capture("reading_extended");
    showToast(
      result.ok ? t.toast.stillReading : stillReadingCopy[result.reason],
    );
  }

  async function dismissNote(noteId: Id<"notes">) {
    await run(() => dismissMutation({ sessionToken, noteId }));
  }

  /** The switch shows the stored value, so only a failure needs a word; success arrives through the view. */
  async function setNotifications(on: boolean) {
    const result = await run(() => notificationsMutation({ ...args, on }));
    if (result && !result.ok) showToast(t.errors.generic);
  }

  async function undo() {
    const result = await run(() => undoMutation(args));
    if (!result) return;
    if (result.ok) posthog.capture("juz_finish_undone");
    showToast(result.ok ? t.toast.undone : undoCopy[result.reason]);
  }

  async function confirmRelease() {
    const result = await run(() => releaseMutation(args));
    if (!result) return;
    setSheet(null);
    if (result.ok) posthog.capture("juz_released");
    showToast(result.ok ? t.toast.released : releaseCopy[result.reason]);
  }

  async function continueToKhatma() {
    const result = await run(() => celebratedMutation(args));
    // On success the view flips `celebrateRound` to null by itself.
    if (result?.ok) posthog.capture("khatma_round_continued");
    if (result && !result.ok) showToast(t.errors.generic);
  }

  return {
    busy,
    toast,
    dismissToast: () => setToast(null),
    // Never show a sheet over the celebration, even in the render before the effect clears it.
    sheet: celebrating ? null : sheet,
    closeSheet,
    openRelease,
    pendingJuz,
    verified,
    cancelVerify,
    take,
    confirmTake,
    switchAccount,
    finish,
    stillReading,
    dismissNote,
    setNotifications,
    undo,
    confirmRelease,
    continueToKhatma,
  };
}
