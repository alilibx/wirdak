import type { ShareSheet } from "../features/share/useShareSheet";
import { useShareUrl } from "../features/share/useShareUrl";
import { t } from "../i18n/ar";
import { inviteMessage, remindMessage, waShareLink } from "../lib/whatsapp";
import { Button, buttonClass } from "./Button";
import { Sheet } from "./Sheet";
import { WhatsAppIcon } from "./WhatsAppIcon";

type MessageSheetProps = {
  title: string;
  /** Builds the message once the member's link is known. */
  message: (url: string) => string;
  inviteCode: string;
  note?: string;
  closeLabel: string;
  onClose: () => void;
};

function MessageSheet({
  title,
  message,
  inviteCode,
  note,
  closeLabel,
  onClose,
}: MessageSheetProps) {
  const { url, failed } = useShareUrl(inviteCode);
  const text = url === null ? null : message(url);
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="mt-1 text-ink-soft">{note ?? t.share.previewHint}</p>
      {text !== null && (
        <div
          dir="auto"
          className="mt-3 rounded-ui border border-line bg-paper-2 p-3.5 leading-relaxed whitespace-pre-wrap break-words"
        >
          {text}
        </div>
      )}
      {text === null && !failed && (
        <p className="mt-3 text-ink-soft">{t.share.preparing}</p>
      )}
      {failed && (
        <p role="alert" className="mt-3 font-medium text-danger">
          {t.share.error}
        </p>
      )}
      <div className="mt-5 grid gap-3">
        {text !== null && (
          <a
            href={waShareLink(text)}
            target="_blank"
            rel="noopener"
            className={buttonClass("whatsapp", "no-underline")}
          >
            <WhatsAppIcon />
            {t.share.send}
          </a>
        )}
        <Button variant="ghost" onClick={onClose}>
          {closeLabel}
        </Button>
      </div>
    </Sheet>
  );
}

type InviteProps = {
  inviteCode: string;
  khatmaName: string;
  /** True right after creating the khatma, for the warmer title. */
  justCreated: boolean;
  onClose: () => void;
};

export function InviteSheet({
  inviteCode,
  khatmaName,
  justCreated,
  onClose,
}: InviteProps) {
  return (
    <MessageSheet
      title={justCreated ? t.share.createdTitle : t.share.inviteTitle}
      message={(url) => inviteMessage(khatmaName, url)}
      inviteCode={inviteCode}
      closeLabel={t.share.done}
      onClose={onClose}
    />
  );
}

type RemindProps = {
  inviteCode: string;
  khatmaName: string;
  openJuz: number[];
  targetEndAt: number | null;
  onClose: () => void;
};

export function RemindSheet({
  inviteCode,
  khatmaName,
  openJuz,
  targetEndAt,
  onClose,
}: RemindProps) {
  return (
    <MessageSheet
      title={t.share.remindTitle}
      message={(url) => remindMessage(khatmaName, openJuz, targetEndAt, url)}
      inviteCode={inviteCode}
      note={t.share.remindNote}
      closeLabel={t.share.done}
      onClose={onClose}
    />
  );
}

type ShareSheetsProps = {
  sheet: ShareSheet;
  inviteCode: string;
  khatmaName: string;
  openJuz: number[];
  targetEndAt: number | null;
  onClose: () => void;
};

/** Whichever share sheet is open, or nothing. */
export function ShareSheets({ sheet, ...rest }: ShareSheetsProps) {
  if (sheet === "remind") return <RemindSheet {...rest} />;
  if (sheet === null) return null;
  return (
    <InviteSheet
      inviteCode={rest.inviteCode}
      khatmaName={rest.khatmaName}
      justCreated={sheet === "created"}
      onClose={rest.onClose}
    />
  );
}
