/**
 * Small UI building blocks for the Surfaces / Paint / Materials panels,
 * built on the shared primitives' look (semantic tokens only).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Info, TriangleAlert } from 'lucide-react';
import { TextInput, cn } from '../../common';

/** Pill-shaped filter chip (collections, families, quick picks). */
export function Chip({
  active,
  onClick,
  children,
  title,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors pointer-coarse:h-9',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        active ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-text',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Callout({
  tone = 'info',
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'warning' | 'accent';
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-line bg-surface-2 text-muted',
    warning: 'border-warning/30 bg-warning/10 text-text',
    accent: 'border-accent/25 bg-accent-soft text-text',
  };
  const iconTone = { info: 'text-muted', warning: 'text-warning', accent: 'text-accent' };
  return (
    <div className={cn('flex gap-2.5 rounded-xl border p-3 text-xs leading-relaxed', tones[tone], className)}>
      <span className={cn('mt-px shrink-0', iconTone[tone])} aria-hidden>
        {icon ?? (tone === 'warning' ? <TriangleAlert className="size-4" /> : <Info className="size-4" />)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {title && <p className="text-sm font-medium text-text">{title}</p>}
        {children && <div>{children}</div>}
        {action && <div className="flex flex-wrap gap-2 pt-0.5">{action}</div>}
      </div>
    </div>
  );
}

/** The overlay color of a region (data color). */
export function RegionDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-3 shrink-0 rounded-full ring-2 ring-surface', className)} style={{ backgroundColor: color, boxShadow: `0 0 0 3px ${color}33` }} />;
}

/** Slider with a logarithmic mapping (fine control at small values). */
export function LogSlider({
  label,
  value,
  min,
  max,
  onChange,
  onCommit,
  valueText,
  disabled,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  valueText: string;
  disabled?: boolean;
}) {
  const id = useId();
  const lo = Math.max(1e-6, Math.min(min, max));
  const hi = Math.max(lo * 1.0001, max);
  const span = Math.log(hi / lo);
  const toT = (x: number) => Math.round((Math.log(Math.min(hi, Math.max(lo, x)) / lo) / span) * 1000);
  const fromT = (t: number) => lo * Math.exp((t / 1000) * span);
  return (
    <div className={cn('flex flex-col gap-1', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="font-medium text-muted">
          {label}
        </label>
        <span className="tabular-nums text-subtle">{valueText}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={1000}
        step={1}
        value={toT(value)}
        disabled={disabled}
        aria-valuetext={valueText}
        onChange={(e) => onChange(fromT(Number(e.target.value)))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="w-full"
      />
    </div>
  );
}

/** Small uppercase caption above a group of controls. */
export function GroupLabel({ children, id, action }: { children: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span id={id} className="text-xs font-medium text-muted">
        {children}
      </span>
      {action}
    </div>
  );
}

const STEPS = [
  { title: 'Add a surface', body: 'Pick what you want to change — a wall, the siding, the lawn.' },
  { title: 'Outline it on the photo', body: 'Tap or brush over it with the smart brush or the magic wand.' },
  { title: 'Pick a paint or material', body: 'Choose a color or a texture — it previews instantly.' },
] as const;

/**
 * The three-step flow for first-time users. `current` is the step to do next
 * (1..3); earlier steps show as done, 4 = all done.
 */
export function StepGuide({ current, compact }: { current: 1 | 2 | 3 | 4; compact?: boolean }) {
  return (
    <ol className={cn('flex', compact ? 'flex-row items-center gap-1.5' : 'flex-col gap-3')} aria-label="How it works">
      {STEPS.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < current;
        const active = n === current;
        return (
          <li key={s.title} className={cn('flex items-start gap-3', compact && 'min-w-0 flex-1 items-center gap-1.5')} aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums',
                compact ? 'size-5 text-[10px]' : 'size-7 text-xs',
                done ? 'bg-accent text-accent-fg' : active ? 'bg-accent-soft text-accent ring-2 ring-accent' : 'bg-surface-2 text-subtle',
              )}
            >
              {done ? <Check className={compact ? 'size-3' : 'size-3.5'} aria-label="Done" /> : n}
            </span>
            {compact ? (
              <span className={cn('truncate text-[11px] font-medium', active ? 'text-text' : 'text-subtle')}>{s.title}</span>
            ) : (
              <span className="min-w-0 pt-0.5">
                <span className={cn('block text-sm font-medium', done ? 'text-muted line-through decoration-line-strong' : 'text-text')}>{s.title}</span>
                <span className="block text-xs text-muted">{s.body}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function formatDraft(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  return String(Math.round(v * 100) / 100);
}

/**
 * Positive-number input that keeps what the user is typing ("0.", "0.5")
 * and reports only valid values: a positive number, or undefined when emptied.
 * Shows the external value again when it changes while not focused.
 */
export function PositiveNumberInput({
  id,
  value,
  onValueChange,
  suffix,
  placeholder,
  max = 1e6,
  className,
}: {
  id?: string;
  value: number | undefined;
  onValueChange: (value: number | undefined) => void;
  suffix?: string;
  placeholder?: string;
  max?: number;
  className?: string;
}) {
  const [text, setText] = useState(() => formatDraft(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(formatDraft(value));
  }, [value]);
  const invalid = text.trim() !== '' && !(Number(text) > 0);
  return (
    <div className={cn('relative', className)}>
      <TextInput
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={cn(suffix && 'pr-12', invalid && 'border-danger focus:border-danger focus:ring-danger/25')}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          setText(formatDraft(value));
        }}
        onChange={(e) => {
          const t = e.target.value.replace(',', '.');
          setText(t);
          if (t.trim() === '') onValueChange(undefined);
          else {
            const n = Number(t);
            if (Number.isFinite(n) && n > 0) onValueChange(Math.min(max, n));
          }
        }}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-subtle">{suffix}</span>}
    </div>
  );
}

/**
 * Labeled on/off switch (same look as the shared Toggle, with the knob
 * anchored to the track's left edge so it stays inside the track).
 */
export function Switch({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; className?: string }) {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-3 text-sm', disabled && 'opacity-50', className)}>
      <label htmlFor={id} className="cursor-pointer text-text">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          checked ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span
          aria-hidden
          className={cn('absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0')}
        />
      </button>
    </div>
  );
}
