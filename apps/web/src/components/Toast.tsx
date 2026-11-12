import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { t } from "../i18n/ar";

export const UNDO_WINDOW_MS = 10_000;
const MESSAGE_MS = 6_000;
const LINGER_MS = 3_000;
/** Movement before a press counts as a drag, so a tap on undo stays a tap. */
const SLOP_PX = 8;
/** A drag this far dismisses on release. */
const SWIPE_PX = 56;
/** A flick at least this fast (px/ms) and this far dismisses early. */
const FLICK_SPEED = 0.5;
const FLICK_PX = 24;
const EXIT_MS = 200;
/** A release this soon after the last move keeps that move's speed; later, the finger had stopped. */
const FLICK_WINDOW_MS = 100;

type Axis = "x" | "y";
type Drag = {
  id: number;
  x: number;
  y: number;
  axis?: Axis;
  /** Distance, time and speed of the latest move, for telling a flick from a slow drag. */
  distance: number;
  at: number;
  speed: number;
};

/** How far the toast has moved toward dismissal: only left (negative x) and down (positive y) count. */
function along(axis: Axis, dx: number, dy: number): number {
  return axis === "x" ? Math.max(0, -dx) : Math.max(0, dy);
}

export type ToastData = {
  /** A new id replaces the toast on screen and restarts its timers. */
  id: number;
  text: string;
  /** Present for the finish toast: how long the undo button stays, in ms (0 < n <= 10 000). */
  undoMs?: number;
};

type Props = {
  toast: ToastData;
  busy: boolean;
  onUndo: () => void;
  onDismiss: () => void;
};

/**
 * One toast at a time, shown inside the page's always-mounted live region. A finish toast
 * offers an undo button with a bar that drains over `undoMs`; at zero the button goes away
 * and the message lingers a moment longer. Swiping it left or down dismisses it early; it
 * closes by itself anyway, so the swipe is a shortcut, never the only way. Mount it with
 * `key={toast.id}` so a new toast starts clean.
 */
export function Toast({ toast, busy, onUndo, onDismiss }: Props) {
  const remaining = toast.undoMs ?? null;
  const [expired, setExpired] = useState(false);
  const drag = useRef<Drag | null>(null);
  // Set once a press became a drag, so the click that ends it does not reach the undo button.
  const dragged = useRef(false);
  // The toast's time ran out mid-drag: it goes once the finger lifts, not from under it.
  const due = useRef(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [leaving, setLeaving] = useState<Axis | null>(null);

  useEffect(() => {
    const expire = () => {
      if (drag.current?.axis) due.current = true;
      else onDismiss();
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (remaining === null) {
      timers.push(setTimeout(expire, MESSAGE_MS));
    } else {
      timers.push(setTimeout(() => setExpired(true), remaining));
      timers.push(setTimeout(expire, remaining + LINGER_MS));
    }
    return () => timers.forEach(clearTimeout);
    // Timers start once per toast; the parent remounts this component for a new one.
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onDismiss, EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  const springBack = () => {
    drag.current = null;
    setOffset({ x: 0, y: 0 });
    if (due.current) onDismiss();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (leaving || (e.pointerType === "mouse" && e.button !== 0)) return;
    // A second finger never takes over a drag already under way.
    if (drag.current?.axis) return;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      distance: 0,
      at: Date.now(),
      speed: 0,
    };
    dragged.current = false;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      dragged.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const now = Date.now();
    const distance = along(d.axis, dx, dy);
    d.speed = (distance - d.distance) / Math.max(1, now - d.at);
    d.distance = distance;
    d.at = now;
    const next =
      d.axis === "x" ? { x: -distance, y: 0 } : { x: 0, y: distance };
    setOffset((prev) => (prev.x === next.x && prev.y === next.y ? prev : next));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.axis) return;
    // The click that follows this release (if any) arrives before the timer; after it, clicks count.
    setTimeout(() => (dragged.current = false), 0);
    const distance = along(d.axis, e.clientX - d.x, e.clientY - d.y);
    const flicked =
      distance >= FLICK_PX &&
      d.speed >= FLICK_SPEED &&
      Date.now() - d.at <= FLICK_WINDOW_MS;
    if (distance >= SWIPE_PX || flicked) setLeaving(d.axis);
    else springBack();
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    dragged.current = false;
    springBack();
  };

  const canUndo = remaining !== null && !expired;
  const dragging = drag.current?.axis !== undefined;
  // `translate`, not `transform`: the entrance animation holds `transform` and would win.
  const translate =
    leaving === "x"
      ? "-110vw 0px"
      : leaving === "y"
        ? "0px calc(100% + 1.25rem + var(--nav-h, 0px))"
        : `${offset.x}px ${offset.y}px`;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={(e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.stopPropagation();
      }}
      style={{
        translate,
        opacity: leaving
          ? 0
          : 1 - Math.min(0.5, Math.hypot(offset.x, offset.y) / 240),
      }}
      className={`fixed inset-x-4 bottom-[calc(1.25rem+var(--nav-h,0px))] z-30 mx-auto flex max-w-xl animate-sheet-up touch-none items-center justify-between gap-3 overflow-hidden rounded-[18px] bg-toast px-4 py-3.5 text-[#F7F1E3] shadow-[0_12px_30px_rgba(0,0,0,0.3)] select-none ${dragging ? "" : "transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none"}`}
    >
      <span className="py-1.5 text-lg font-medium">{toast.text}</span>
      {canUndo && (
        <>
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className="min-h-14 shrink-0 rounded-xl bg-white/15 px-5 font-semibold text-white disabled:opacity-50"
          >
            {t.toast.undo}
          </button>
          <span
            data-testid="undo-bar"
            aria-hidden="true"
            className="animate-toast-shrink absolute start-0 bottom-0 h-1 bg-gold"
            style={{ animationDuration: `${remaining}ms` }}
          />
        </>
      )}
    </div>
  );
}
