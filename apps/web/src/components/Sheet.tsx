import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { t } from "../i18n/ar";

type Props = { title: string; onClose: () => void; children: ReactNode };

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal bottom sheet. Closed only by its labelled button or Escape (no swipe, no hidden gestures).
 * Focus moves into it on open, stays inside while it is open, and returns to the opener on close.
 */
export function Sheet({ title, onClose, children }: Props) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Read during the first render, before any child's autoFocus moves focus into the sheet.
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    // An autofocused field inside the sheet (the PIN box on resume) keeps focus.
    if (!panel.current?.contains(document.activeElement)) {
      panel.current?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [opener]);

  // Tab wraps inside the sheet; the panel itself is the entry point when nothing inside has focus.
  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panel.current) return;
    const items = Array.from(
      panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return event.preventDefault();
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-20">
      <div className="animate-sheet-fade absolute inset-0 bg-scrim" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="animate-sheet-up absolute inset-x-0 bottom-0 mx-auto max-h-[88%] max-w-xl overflow-y-auto rounded-t-[28px] bg-card px-5 pt-3.5 pb-7 outline-none"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-xl font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-14 rounded-ui px-4 font-medium text-ink-soft underline underline-offset-4"
          >
            {t.sheet.close}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
