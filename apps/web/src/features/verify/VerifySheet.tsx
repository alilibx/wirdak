import { api } from "@convex/_generated/api";
import { normalizeDigits, toArabicDigits } from "@convex/lib/digits";
import { useQuery } from "convex/react";
import posthog from "posthog-js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, buttonClass } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { WhatsAppIcon } from "../../components/WhatsAppIcon";
import { t } from "../../i18n/ar";
import { formatDate } from "../../lib/format";
import { useSessionToken } from "../../lib/session";
import type { VerifyIntent } from "./progress";
import { useVerification } from "./useVerification";

type Props = {
  title: string;
  /** What the person is verifying for; saved so a reloaded tab can resume on the right page. */
  intent?: VerifyIntent;
  onVerified: () => void;
  onClose: () => void;
};

const PIN_LENGTH = 6;
const heading = "text-xl font-semibold outline-none";
/** Marks the element that takes focus when its step appears. */
const STEP_HEADING = "data-step-heading";
const stepHeading = { tabIndex: -1, [STEP_HEADING]: "" } as const;
const hint = "mt-1.5 leading-relaxed text-ink-soft";
const errorText = "mt-2 font-medium text-[#8A2B1E]";

export function VerifySheet({ title, intent, onVerified, onClose }: Props) {
  const v = useVerification(intent);
  // Why the person is signing in, never what they typed: the funnel splits on it.
  const reason = intent?.kind ?? "signin";

  // One event per step reached and per error shown, so PostHog shows where a sign-in stops.
  useEffect(() => {
    posthog.capture("verification_step", { step: v.step, intent: reason });
  }, [v.step, reason]);
  // Only a new code counts: an error still shown when the step moves on is the same error.
  const shownError = useRef<string | null>(null);
  useEffect(() => {
    if (v.errorCode === shownError.current) return;
    shownError.current = v.errorCode;
    if (v.errorCode === null) return;
    posthog.capture("verification_error", {
      code: v.errorCode,
      step: v.step,
      intent: reason,
    });
  }, [v.errorCode, v.step, reason]);

  // Fire once, when the flow reaches its end; the page decides what comes next.
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;
  useEffect(() => {
    if (v.step === "done") onVerifiedRef.current();
  }, [v.step]);

  // When the step changes, focus its heading so a screen reader announces where the flow is.
  // The first step keeps the sheet's own focus handling (and the PIN box's autofocus on resume).
  const body = useRef<HTMLDivElement>(null);
  const shownStep = useRef(v.step);
  useEffect(() => {
    if (shownStep.current === v.step) return;
    shownStep.current = v.step;
    body.current?.querySelector<HTMLElement>(`[${STEP_HEADING}]`)?.focus();
  }, [v.step]);

  // Leaving at confirm or pin drops the attempt, so the next person on a shared phone
  // cannot continue it. Leaving while waiting keeps it: the user may be in WhatsApp.
  const close = () => {
    posthog.capture("verification_closed", { step: v.step, intent: reason });
    if (v.step === "confirm" || v.step === "pin") v.discard();
    onClose();
  };

  return (
    <Sheet title={title} onClose={close}>
      <div ref={body}>
        {v.step === "start" && <StartStep v={v} />}
        {v.step === "waiting" && <WaitingStep v={v} />}
        {v.step === "confirm" && <ConfirmStep v={v} />}
        {v.step === "pin" && <PinStep v={v} />}
        {v.step === "devices" && <DevicesStep v={v} />}
        {v.step === "error" && <ErrorStep v={v} />}
      </div>
    </Sheet>
  );
}

type StepProps = { v: ReturnType<typeof useVerification> };

/** No name here: a returning number never needs one, and a new one gives it on confirm. */
function StartStep({ v }: StepProps) {
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void v.start();
  };
  return (
    <form onSubmit={onSubmit} noValidate>
      <p className={hint}>{t.verify.intro}</p>
      {v.error && (
        <p role="alert" className={errorText}>
          {v.error}
        </p>
      )}
      <div className="mt-5 grid gap-3">
        <Button variant="whatsapp" type="submit" disabled={v.busy}>
          <WhatsAppIcon />
          {v.busy ? t.verify.starting : t.verify.start}
        </Button>
      </div>
      <p className="mt-3.5 rounded-xl bg-paper-2 p-3 text-base leading-relaxed">
        {t.verify.startHint}
      </p>
      {/* A static page outside the SPA, so a plain link (a router Link would show NotFound).
          A new tab keeps the sheet and the typed name. */}
      <a
        href="/privacy"
        target="_blank"
        rel="noopener"
        className="mt-3 inline-flex min-h-11 items-center text-ink-soft underline underline-offset-4"
      >
        {t.verify.privacy}
      </a>
    </form>
  );
}

function WaitingStep({ v }: StepProps) {
  return (
    <div>
      <div className="py-2.5 text-center">
        <div
          role="status"
          aria-label={t.verify.waitingTitle}
          className="mx-auto mt-1.5 mb-4 size-14 rounded-full border-[5px] border-paper-2 border-t-wa motion-safe:animate-spin"
        />
        <h3 className={heading} {...stepHeading}>
          {t.verify.waitingTitle}
        </h3>
        <p className={hint}>{t.verify.waitingHint}</p>
      </div>
      {v.waUrl && (
        <div className="mt-5 grid gap-3">
          <a
            href={v.waUrl}
            target="_blank"
            rel="noopener"
            className={buttonClass("whatsapp", "no-underline")}
            // A tap here means WhatsApp didn't open by itself, or the person lost the message.
            onClick={() =>
              posthog.capture("verification_whatsapp_tapped", {
                reopen: v.opened,
              })
            }
          >
            <WhatsAppIcon />
            {v.opened ? t.verify.reopenWhatsApp : t.verify.openWhatsApp}
          </a>
        </div>
      )}
    </div>
  );
}

/** Only a new number gets here, so this is where its name is asked, once. */
function ConfirmStep({ v }: StepProps) {
  const [name, setName] = useState("");
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void v.confirm(name);
  };
  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="text-center">
        <div
          aria-hidden="true"
          className="mx-auto mt-2 flex size-14 items-center justify-center rounded-full bg-green text-3xl text-white"
        >
          ✓
        </div>
        <h3 className={`${heading} mt-3`} {...stepHeading}>
          {t.verify.confirmTitle}
        </h3>
        {v.maskedPhone && (
          <p className={hint}>
            {t.verify.yourNumber}{" "}
            <span dir="ltr" className="font-bold text-ink">
              {v.maskedPhone}
            </span>
          </p>
        )}
      </div>
      <label htmlFor="verify-name" className="mt-4 block font-medium">
        {t.verify.nameLabel}
      </label>
      <input
        id="verify-name"
        type="text"
        autoComplete="name"
        maxLength={40}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t.verify.namePlaceholder}
        aria-invalid={v.error !== null}
        aria-describedby={v.error ? "verify-name-error" : undefined}
        className="mt-1.5 min-h-14 w-full rounded-ui border-2 border-line bg-white px-4 text-ink"
      />
      {v.error && (
        <p id="verify-name-error" role="alert" className={errorText}>
          {v.error}
        </p>
      )}
      <div className="mt-5 grid gap-3">
        <Button type="submit" disabled={v.busy}>
          {t.verify.yes}
        </Button>
        <Button
          variant="ghost"
          disabled={v.busy}
          onClick={() => void v.notMe()}
        >
          {t.verify.notMe}
        </Button>
      </div>
    </form>
  );
}

/** Reads the clipboard where the browser allows it (it may ask first); null elsewhere. */
function clipboardReader(): (() => Promise<string>) | null {
  const clipboard =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;
  return clipboard?.readText ? () => clipboard.readText() : null;
}

/**
 * One real input, drawn as six boxes: paste, autofill and the keyboard all behave like a normal
 * field. Phones never suggest a code that came by WhatsApp, and long-pressing an invisible field
 * is hard to find, so a button pastes what WhatsApp's "copy code" button copied.
 */
function PinStep({ v }: StepProps) {
  const [pin, setPin] = useState("");
  const [focused, setFocused] = useState(false);
  const [pasteError, setPasteError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const readClipboard = clipboardReader();

  async function submit(value: string) {
    await v.submitPin(value);
    // A wrong PIN leaves the step as it was; start over in the same field.
    setPin("");
    input.current?.focus();
  }

  const onChange = (raw: string) => {
    const digits = normalizeDigits(raw)
      .replace(/\D/gu, "")
      .slice(0, PIN_LENGTH);
    setPin(digits);
    setPasteError(false);
    if (digits.length === PIN_LENGTH && !v.busy) void submit(digits);
  };

  async function paste(read: () => Promise<string>) {
    let text = "";
    try {
      text = await read();
    } catch {
      // Refused or unreadable: same as an empty clipboard.
    }
    const digits = normalizeDigits(text).replace(/\D/gu, "");
    if (digits.length !== PIN_LENGTH) {
      setPasteError(true);
      return;
    }
    onChange(digits);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (pin.length === PIN_LENGTH && !v.busy) void submit(pin);
      }}
    >
      <h3 className={heading} {...stepHeading}>
        {t.verify.pinTitle}
      </h3>
      <p className={hint}>
        {t.verify.pinHint}
        {v.maskedPhone && (
          <>
            {" "}
            <span dir="ltr" className="font-bold text-ink">
              {v.maskedPhone}
            </span>
          </>
        )}
      </p>
      <label htmlFor="verify-pin" className="mt-4 block font-medium">
        {t.verify.pinLabel}
      </label>
      <div dir="ltr" className="relative mt-1.5 flex justify-center gap-2">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`flex h-16 w-12 items-center justify-center rounded-ui border-2 bg-white text-3xl font-bold ${
              focused && i === Math.min(pin.length, PIN_LENGTH - 1)
                ? "border-green"
                : "border-line"
            }`}
          >
            {pin[i] ? toArabicDigits(pin[i]) : ""}
          </span>
        ))}
        <input
          id="verify-pin"
          ref={input}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={pin}
          disabled={v.busy}
          aria-invalid={v.error !== null || pasteError}
          aria-describedby={
            v.error || pasteError ? "verify-pin-error" : undefined
          }
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-0 size-full cursor-text opacity-0"
        />
      </div>
      {(v.error || pasteError) && (
        <p id="verify-pin-error" role="alert" className={errorText}>
          {pasteError ? t.verify.pinPasteEmpty : v.error}
        </p>
      )}
      <div className="mt-5 grid gap-3">
        {readClipboard && (
          <Button
            variant="ghost"
            disabled={v.busy}
            onClick={() => void paste(readClipboard)}
          >
            {t.verify.pinPaste}
          </Button>
        )}
        <Button type="submit" disabled={v.busy || pin.length !== PIN_LENGTH}>
          {t.verify.pinSubmit}
        </Button>
      </div>
    </form>
  );
}

function DevicesStep({ v }: StepProps) {
  const sessionToken = useSessionToken();
  const sessions = useQuery(
    api.sessions.list,
    sessionToken ? { sessionToken } : "skip",
  );
  const others = sessions?.filter((s) => !s.isCurrent);
  return (
    <div>
      <h3 className={heading} {...stepHeading}>
        {t.verify.devicesTitle}
      </h3>
      <p className={hint}>{t.verify.devicesHint}</p>
      {others === undefined ? (
        <p role="status" className="mt-3 text-ink-soft">
          {t.common.loading}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {others.map((s) => (
            <li
              key={s.sessionId}
              className="rounded-ui border border-line bg-paper-2 px-4 py-2.5"
            >
              <span className="block font-medium">{s.deviceLabel}</span>
              <span className="block text-base text-ink-soft">
                {t.verify.lastUsed(formatDate(s.lastUsedAt))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {v.error && (
        <p role="alert" className={errorText}>
          {v.error}
        </p>
      )}
      <div className="mt-5 grid gap-3">
        <Button disabled={v.busy} onClick={() => void v.signOutOthers()}>
          {t.verify.signOutOthers}
        </Button>
        <Button
          variant="ghost"
          disabled={v.busy}
          onClick={v.continueFromDevices}
        >
          {t.verify.keep}
        </Button>
      </div>
    </div>
  );
}

function ErrorStep({ v }: StepProps) {
  return (
    <div>
      <p
        role="alert"
        className="mt-2 text-lg leading-relaxed outline-none"
        {...stepHeading}
      >
        {v.error}
      </p>
      {v.canRetry && (
        <div className="mt-5 grid gap-3">
          <Button onClick={v.reset}>{t.verify.retry}</Button>
        </div>
      )}
    </div>
  );
}
