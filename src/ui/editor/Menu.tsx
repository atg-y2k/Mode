/**
 * Small dropdown menu (button + floating list) for editor toolbars.
 * Portal-rendered with fixed positioning so scrollable toolbars don't clip it;
 * keyboard: arrows move, Enter/Space activate, Escape closes.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cn } from '../common';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Radio-style item: shows a check mark when true. */
  checked?: boolean;
  onSelect: () => void;
}

export function MenuButton({
  label,
  children,
  items,
  className,
  align = 'end',
  tone = 'default',
}: {
  /** Accessible name of the trigger. */
  label: string;
  /** Trigger content (usually an icon). */
  children: ReactNode;
  items: (MenuItem | 'separator')[];
  className?: string;
  align?: 'start' | 'end';
  /** 'stage' = light-on-dark trigger for controls floating over the photo. */
  tone?: 'default' | 'stage';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const b = btnRef.current?.getBoundingClientRect();
    const m = menuRef.current?.getBoundingClientRect();
    if (!b) return;
    const width = m?.width ?? 208;
    const height = m?.height ?? 0;
    let left = align === 'end' ? b.right - width : b.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = b.bottom + 6;
    if (height && top + height > window.innerHeight - 8) top = Math.max(8, b.top - height - 6);
    setPos({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onClose = () => setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    // Focus the first enabled item for keyboard users.
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
    // Keep editor shortcuts from firing while the menu has focus.
    e.stopPropagation();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
          tone === 'stage'
            ? open
              ? 'bg-white/20 text-white'
              : 'text-white/85 hover:bg-white/15'
            : open
              ? 'bg-surface-2 text-text'
              : 'text-muted hover:bg-surface-2 hover:text-text',
          className,
        )}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            className="fixed z-50 min-w-52 rounded-xl border border-line bg-surface p-1 shadow-panel"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
            {items.map((item, i) =>
              item === 'separator' ? (
                <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-line" />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  onClick={() => {
                    close(false);
                    item.onSelect();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    'focus-visible:bg-surface-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45',
                    item.danger ? 'text-danger hover:bg-danger-soft' : 'text-text hover:bg-surface-2',
                  )}
                >
                  {item.icon && <span className="flex size-4 shrink-0 items-center justify-center opacity-80">{item.icon}</span>}
                  <span className="flex-1">{item.label}</span>
                  {item.hint && <span className="text-xs text-subtle">{item.hint}</span>}
                  {item.checked !== undefined && (
                    <Check className={cn('size-4 shrink-0 text-accent', !item.checked && 'invisible')} aria-hidden />
                  )}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
