/**
 * Small floating surfaces for the Studio: a click-to-open popover (menus,
 * the refine form) and a hover card (plant feasibility details). Rendered in
 * a portal with fixed positioning so scroll containers (the variation strip)
 * never clip them; flips below the anchor when there is no room above.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../common';

interface Position {
  left: number;
  top: number;
}

function place(anchor: DOMRect, panel: { width: number; height: number }, prefer: 'top' | 'bottom', align: 'start' | 'center' | 'end'): Position {
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = align === 'start' ? anchor.left : align === 'end' ? anchor.right - panel.width : anchor.left + anchor.width / 2 - panel.width / 2;
  left = Math.min(Math.max(margin, left), Math.max(margin, vw - panel.width - margin));
  const above = anchor.top - panel.height - 6;
  const below = anchor.bottom + 6;
  let top = prefer === 'top' ? (above >= margin ? above : below) : below + panel.height <= vh - margin ? below : above;
  top = Math.min(Math.max(margin, top), Math.max(margin, vh - panel.height - margin));
  return { left, top };
}

export function Popover({
  anchor,
  open,
  onClose,
  children,
  prefer = 'top',
  align = 'center',
  className,
  label,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  prefer?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
  label?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !panelRef.current) return;
    const update = () => {
      if (!panelRef.current) return;
      const r = panelRef.current.getBoundingClientRect();
      setPos(place(anchor.getBoundingClientRect(), { width: r.width, height: r.height }, prefer, align));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(panelRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchor, prefer, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Handled here: the viewer must not also go "back to original".
      e.preventDefault();
      e.stopPropagation();
      onClose();
      anchor?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor, onClose]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  if (!open || !anchor) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className={cn(
        'fixed z-50 rounded-xl border border-line bg-surface p-1.5 text-text shadow-panel transition-opacity duration-100',
        pos ? 'opacity-100' : 'opacity-0',
        className,
      )}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** A trigger that shows `content` in a floating card while hovered or focused. */
export function HoverCard({ trigger, content, className, prefer = 'top' }: { trigger: ReactNode; content: ReactNode; className?: string; prefer?: 'top' | 'bottom' }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 120);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 80);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-accent"
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {trigger}
      </span>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} prefer={prefer} className={cn('pointer-events-none max-w-80 p-3', className)}>
        {content}
      </Popover>
    </>
  );
}
