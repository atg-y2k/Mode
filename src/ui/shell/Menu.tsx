/**
 * Accessible dropdown menu for shell toolbars and cards: a trigger plus a
 * portal-rendered list with fixed positioning (never clipped by scrolling
 * containers), clamped to the viewport. Keyboard: Enter/Space/ArrowDown open,
 * arrows/Home/End move, Enter/Space activate, Escape/Tab close; focus returns
 * to the trigger.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cn } from '../common';

export interface MenuAction {
  kind?: 'item';
  label: ReactNode;
  /** Secondary line or trailing hint (shortcut, file type…). */
  hint?: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Shown as a check mark (radio-style). */
  checked?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuAction | { kind: 'separator' } | { kind: 'heading'; label: ReactNode };

export interface MenuProps {
  /** Accessible name of the trigger. */
  label: string;
  /** Renders the trigger; spread `props` onto a <button>. */
  trigger: (props: {
    ref: (el: HTMLButtonElement | null) => void;
    onClick: () => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string | undefined;
    'aria-label': string;
    title: string;
  }) => ReactNode;
  items: MenuEntry[];
  align?: 'start' | 'end';
  /** Min width of the list in px. */
  width?: number;
  onOpenChange?: (open: boolean) => void;
}

function isAction(e: MenuEntry): e is MenuAction {
  return e.kind === undefined || e.kind === 'item';
}

export function Menu({ label, trigger, items, align = 'end', width = 224, onOpenChange }: MenuProps) {
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );

  const enabled = items.map((it, i) => (isAction(it) && !it.disabled ? i : -1)).filter((i) => i >= 0);

  const close = useCallback(
    (refocus = true) => {
      setOpen(false);
      if (refocus) triggerRef.current?.focus();
    },
    [setOpen],
  );

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const b = triggerRef.current?.getBoundingClientRect();
      const m = listRef.current?.getBoundingClientRect();
      if (!b) return;
      const w = m?.width ?? width;
      const h = m?.height ?? 0;
      let left = align === 'end' ? b.right - w : b.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = b.bottom + 6;
      if (h && top + h > window.innerHeight - 8) top = Math.max(8, b.top - h - 6);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, width]);

  // Focus the active item.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [open, active, pos]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close]);

  const openWith = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const move = (dir: 1 | -1) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    const next = at < 0 ? (dir === 1 ? 0 : enabled.length - 1) : (at + dir + enabled.length) % enabled.length;
    setActive(enabled[next]);
  };

  const onListKey = (e: ReactKeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        if (enabled.length) setActive(enabled[0]);
        break;
      case 'End':
        e.preventDefault();
        if (enabled.length) setActive(enabled[enabled.length - 1]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <>
      {trigger({
        ref: (el) => {
          triggerRef.current = el;
        },
        onClick: () => (open ? close(false) : openWith(-1)),
        onKeyDown: (e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openWith(enabled[0] ?? -1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            openWith(enabled[enabled.length - 1] ?? -1);
          }
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        'aria-label': label,
        title: label,
      })}
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={menuId}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onListKey}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth: width }}
            className={cn(
              'fixed z-[70] max-h-[70dvh] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-panel scroll-thin',
              'motion-safe:animate-[mode-pop-in_120ms_ease-out]',
              !pos && 'invisible',
            )}
          >
            {items.map((it, i) => {
              if (it.kind === 'separator') return <div key={i} role="separator" className="my-1 h-px bg-line" />;
              if (it.kind === 'heading')
                return (
                  <div key={i} className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                    {it.label}
                  </div>
                );
              return (
                <button
                  key={i}
                  type="button"
                  role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'}
                  aria-checked={it.checked}
                  data-index={i}
                  tabIndex={-1}
                  disabled={it.disabled}
                  onMouseEnter={() => !it.disabled && setActive(i)}
                  onClick={() => {
                    close();
                    it.onSelect();
                  }}
                  className={cn(
                    'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none transition-colors',
                    'focus-visible:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45',
                    it.danger ? 'text-danger hover:bg-danger-soft focus:bg-danger-soft' : 'text-text hover:bg-surface-2 focus:bg-surface-2',
                  )}
                >
                  {it.icon !== undefined && (
                    <span className={cn('flex size-4 shrink-0 items-center justify-center', it.danger ? 'text-danger' : 'text-muted')}>{it.icon}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it.label}</span>
                    {it.hint && <span className="block truncate text-xs text-subtle">{it.hint}</span>}
                  </span>
                  {it.checked && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
