import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toWesternDigits } from "@convex/lib/digits";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { useSessionToken } from "../../lib/session";
import { useReporterToken } from "./reporterToken";
import { helpContext, sendHelp, type HelpErrorCode } from "./sendHelp";
import { useVoiceRecorder } from "./useVoiceRecorder";

const MAX_TEXT = 1000;

type Props = {
  /** The conversation to open, or null for a new request. */
  requestId: string | null;
  /** The picture taken when "؟" was tapped; offered with a new request only. */
  screenshot: Blob | null;
  onClose: () => void;
};

type View =
  { kind: "list" } | { kind: "conversation"; id: string } | { kind: "sent" };

function useObjectUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

function seconds(s: number): string {
  const m = Math.floor(s / 60);
  return toWesternDigits(`${m}:${String(s % 60).padStart(2, "0")}`);
}

/** The help sheet (spec 3.2 to 3.4): the person's requests, a composer, and conversations. */
export function HelpSheet({ requestId, screenshot, onClose }: Props) {
  const sessionToken = useSessionToken();
  const reporterToken = useReporterToken() ?? undefined;
  const mine = useQuery(api.help.mine, { sessionToken, reporterToken });
  const [view, setView] = useState<View>(
    requestId ? { kind: "conversation", id: requestId } : { kind: "list" },
  );

  return (
    <Sheet title={t.help.title} onClose={onClose}>
      {view.kind === "sent" ? (
        <div className="flex flex-col gap-3 text-center">
          <p className="text-xl font-semibold">{t.help.sentTitle}</p>
          <p className="text-ink-soft">{t.help.sentBody}</p>
          <Button onClick={onClose}>{t.help.done}</Button>
        </div>
      ) : view.kind === "conversation" ? (
        <Conversation
          request={mine?.find((r) => r._id === view.id) ?? null}
          requestId={view.id}
          sessionToken={sessionToken}
          reporterToken={reporterToken}
          onBack={() => setView({ kind: "list" })}
        />
      ) : (
        <>
          {mine && mine.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 font-semibold">{t.help.yourRequests}</h3>
              <ul className="flex flex-col gap-2">
                {mine.map((r) => (
                  <li key={r._id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-ui border border-line bg-card px-3 py-2 text-start"
                      onClick={() =>
                        setView({ kind: "conversation", id: r._id })
                      }
                    >
                      <span className="truncate">
                        {r.messages.find((m) => m.text)?.text ??
                          t.help.voiceNote}
                      </span>
                      <span className="shrink-0 text-sm text-ink-soft">
                        {r.unread
                          ? t.help.replyCardTitle
                          : t.help.status[r.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="mb-3 text-ink-soft">{t.help.intro}</p>
          <Composer
            label={t.help.message}
            screenshot={screenshot}
            onSend={(input) =>
              sendHelp({ sessionToken, ...input, context: helpContext() })
            }
            onSent={() => setView({ kind: "sent" })}
          />
        </>
      )}
    </Sheet>
  );
}

type MineRequest = NonNullable<
  ReturnType<typeof useQuery<typeof api.help.mine>>
>[number];

function Conversation({
  request,
  requestId,
  sessionToken,
  reporterToken,
  onBack,
}: {
  request: MineRequest | null;
  requestId: string;
  sessionToken: string | undefined;
  reporterToken: string | undefined;
  onBack: () => void;
}) {
  const markSeen = useMutation(api.help.markSeen);
  const unread = request?.unread ?? false;
  useEffect(() => {
    if (!request) return;
    void markSeen({
      requestId: requestId as Id<"helpRequests">,
      sessionToken,
      reporterToken,
    }).catch(() => undefined);
    // Re-marks when a new reply arrives while the conversation is open.
  }, [request, unread, requestId, sessionToken, reporterToken, markSeen]);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="self-start text-green underline"
        onClick={onBack}
      >
        {t.help.back}
      </button>
      {request && (
        <ol className="flex flex-col gap-2">
          {request.messages.map((m) => (
            <li
              key={m._id}
              className={`rounded-ui px-3 py-2 ${m.from === "team" ? "bg-saffron-soft text-saffron-ink" : "border border-line bg-card"}`}
            >
              <p className="text-xs font-semibold">
                {m.from === "team" ? t.help.team : t.help.you}
              </p>
              {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
              {m.voiceUrl && (
                <audio controls src={m.voiceUrl} className="mt-1 w-full" />
              )}
              {m.hasScreenshot && (
                <p className="mt-1 text-xs text-ink-soft">
                  {t.help.screenshot}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      <Composer
        label={t.help.reply}
        screenshot={null}
        onSend={(input) =>
          sendHelp({
            sessionToken,
            requestId,
            ...input,
            context: helpContext(),
          })
        }
        onSent={() => undefined}
      />
    </div>
  );
}

function Composer({
  label,
  screenshot: initialScreenshot,
  onSend,
  onSent,
}: {
  label: string;
  screenshot: Blob | null;
  onSend: (input: {
    text: string;
    screenshot: Blob | null;
    voice: { blob: Blob; seconds: number } | null;
  }) => Promise<{ requestId: string } | { error: HelpErrorCode }>;
  onSent: () => void;
}) {
  const textId = useId();
  const [text, setText] = useState("");
  const [screenshot, setScreenshot] = useState(initialScreenshot);
  const [enlarged, setEnlarged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HelpErrorCode | null>(null);
  const voice = useVoiceRecorder();
  const shotUrl = useObjectUrl(screenshot);
  const voiceUrl = useObjectUrl(voice.blob);
  const sending = useRef(false);
  const canRecord = voice.supported && voice.state !== "denied";
  const hasVoice = voice.state === "done" && voice.blob !== null;
  const canSend =
    !busy && (text.trim() !== "" || hasVoice) && voice.state !== "recording";

  async function submit() {
    if (!canSend || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const res = await onSend({
      text,
      screenshot,
      voice:
        hasVoice && voice.blob
          ? { blob: voice.blob, seconds: voice.seconds }
          : null,
    });
    sending.current = false;
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setText("");
    setScreenshot(null);
    voice.discard();
    onSent();
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={textId} className="sr-only">
        {label}
      </label>
      <textarea
        id={textId}
        value={text}
        maxLength={MAX_TEXT}
        rows={3}
        placeholder={t.help.placeholder}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-ui border-2 border-line bg-white p-3"
      />
      <div className="flex items-stretch gap-2">
        {shotUrl && (
          <div className="relative">
            <button
              type="button"
              aria-label={t.help.enlargeScreenshot}
              onClick={() => setEnlarged(true)}
              className="block h-24 w-16 overflow-hidden rounded-lg border border-line"
            >
              <img
                src={shotUrl}
                alt={t.help.screenshot}
                className="h-full w-full object-cover"
              />
            </button>
            <button
              type="button"
              aria-label={t.help.removeScreenshot}
              onClick={() => setScreenshot(null)}
              className="absolute -start-2 -top-2 flex size-6 items-center justify-center rounded-full bg-ink text-sm text-white"
            >
              ×
            </button>
          </div>
        )}
        {canRecord && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-ui border-2 border-dashed border-green p-2 text-green">
            {voice.state === "recording" ? (
              <>
                <span>{t.help.recording(seconds(voice.seconds))}</span>
                <button
                  type="button"
                  onClick={voice.stop}
                  className="font-semibold underline"
                >
                  {t.help.stop}
                </button>
              </>
            ) : hasVoice && voiceUrl ? (
              <>
                <audio controls src={voiceUrl} className="w-full" />
                <button
                  type="button"
                  onClick={voice.discard}
                  className="text-sm underline"
                >
                  {t.help.deleteVoice}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void voice.start()}
                className="font-semibold"
              >
                🎙 {t.help.record}
              </button>
            )}
          </div>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="text-center text-saffron-ink">
          {t.help.errors[error]}
        </p>
      )}
      <Button type="submit" disabled={!canSend}>
        {busy ? t.help.sending : t.help.send}
      </Button>
      {enlarged && shotUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink/90 p-4">
          <button
            type="button"
            onClick={() => setEnlarged(false)}
            className="self-end text-white underline"
          >
            {t.help.closeScreenshot}
          </button>
          <img
            src={shotUrl}
            alt={t.help.screenshot}
            className="m-auto max-h-full max-w-full"
          />
        </div>
      )}
    </form>
  );
}
