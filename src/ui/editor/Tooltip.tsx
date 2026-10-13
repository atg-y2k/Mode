/**
 * Lightweight tooltip for icon-only editor controls. Shows on mouse hover
 * (after a short delay) and on keyboard focus; never on touch. Rendered in a
 * portal so scrolling toolbars cannot clip it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../common';

export type TooltipSide = 'right' | 'top' | 'bottom' | 'left' | 'auto';

interface Pos {
  x: number;
  y: number;
  side: Exclude<TooltipSide, 'auto'>;
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  /** 'auto' = right of the anchor on desktop (≥1024 px), above it on smaller screens. */
  side?: TooltipSide;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const [pos, setPos] = useState<Pos | null>(null);
  const [nudge, setNudge] = useState(0);

  // Keep the bubble inside the viewport (e.g. first/last tool of a toolbar).
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!pos || !el) {
      setNudge(0);
      return;
    }
    const r = el.getBoundingClientRect();
    const left = r.left - nudge;
    const right = r.right - nudge;
    setNudge(left < 8 ? 8 - left : right > window.innerWidth - 8 ? window.innerWidth - 8 - right : 0);
  }, [pos]);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let s: Pos['side'] = side === 'auto' ? (window.matchMedia('(min-width: 1024px)').matches ? 'right' : 'top') : side;
    if (s === 'bottom' && r.bottom + 40 > window.innerHeight) s = 'top';
    const p: Pos =
      s === 'right'
        ? { x: r.right + 8, y: r.top + r.height / 2, side: s }
        : s === 'left'
          ? { x: r.left - 8, y: r.top + r.height / 2, side: s }
          : s === 'top'
            ? { x: r.left + r.width / 2, y: r.top - 8, side: s }
            : { x: r.left + r.width / 2, y: r.bottom + 8, side: s };
    setPos(p);
  }, [side]);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setPos(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!pos) return;
    const close = () => hide();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos, hide]);

  const transform =
    pos?.side === 'right'
      ? 'translate(0, -50%)'
      : pos?.side === 'left'
        ? 'translate(-100%, -50%)'
        : pos?.side === 'top'
          ? 'translate(-50%, -100%)'
          : 'translate(-50%, 0)';

  return (
    <span
      ref={ref}
      className={cn('inline-flex', className)}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(show, 350);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches?.(':focus-visible')) show();
      }}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="pointer-events-none fixed z-[60] max-w-64 rounded-lg bg-text px-2.5 py-1.5 text-xs leading-snug text-bg shadow-panel"
            style={{ left: pos.x + nudge, top: pos.y, transform }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Keyboard shortcut chip used inside tooltips and menus. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded border border-current/25 px-1 font-sans text-[10px] font-semibold opacity-80">
      {children}
    </kbd>
  );
}
