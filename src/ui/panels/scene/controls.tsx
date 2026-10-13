/**
 * Small building blocks for the Lighting / Library panels: color-temperature
 * slider with a warm→cool track, logarithmic slider, filter chips, plant
 * badges, kelvin chips and callouts. Built on the shared primitives' look.
 */
import { useId, useMemo, type ReactNode } from 'react';
import { Cloud, CloudSun, Droplet, Info, Sun, TriangleAlert } from 'lucide-react';
import type { PlantInfo, SunExposure } from '../../../../shared/types';
import { Badge, cn } from '../../common';
import { SUN_LABELS, WATER_DROPS, WATER_LABELS, formatKelvin, zoneFit, zoneShortLabel } from './format';
import { kelvinCss, kelvinGradient, kelvinTextColor } from './lights';

// ---------------------------------------------------------------------------
// Sliders
// ---------------------------------------------------------------------------

/** Native range input laid over a custom track; thumb styled for WebKit and Firefox. */
const OVERLAY_RANGE =
  'absolute inset-0 m-0 size-full cursor-pointer appearance-none bg-transparent focus:outline-none disabled:cursor-not-allowed ' +
  '[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent ' +
  '[&::-webkit-slider-thumb]:mt-[5px] [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none ' +
  '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white ' +
  '[&::-webkit-slider-thumb]:bg-(--thumb) [&::-webkit-slider-thumb]:shadow-md ' +
  '[&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:size-[14px] [&::-moz-range-thumb]:rounded-full ' +
  '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-(--thumb) [&::-moz-range-thumb]:shadow-md';

export function KelvinSlider({
  label,
  value,
  min,
  max,
  step = 50,
  onChange,
  valueText,
  ends,
  disabled,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (kelvin: number) => void;
  /** Shown next to the label and announced to screen readers. */
  valueText: string;
  /** Captions under both ends of the track, e.g. ['Warm', 'Cool']. */
  ends?: [string, string];
  disabled?: boolean;
}) {
  const id = useId();
  const gradient = useMemo(() => kelvinGradient(min, max), [min, max]);
  const v = Math.min(max, Math.max(min, value));
  return (
    <div className={cn('flex flex-col gap-1', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="font-medium text-muted">
          {label}
        </label>
        <span className="tabular-nums text-subtle">{valueText}</span>
      </div>
      <div className="relative h-7 rounded-full has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full ring-1 ring-black/10 ring-inset"
          style={{ backgroundImage: gradient }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          disabled={disabled}
          aria-valuetext={valueText}
          onChange={(e) => onChange(Number(e.target.value))}
          className={OVERLAY_RANGE}
          style={{ ['--thumb' as string]: kelvinCss(v) }}
        />
      </div>
      {ends && (
        <div className="flex justify-between text-[11px] text-subtle" aria-hidden>
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}

/** Slider with a logarithmic scale (fine control for small sizes, reach for big ones). */
export function LogSlider({
  label,
  value,
  min,
  max,
  onChange,
  valueText,
  disabled,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
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
        className="w-full"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips & badges
// ---------------------------------------------------------------------------

export function FilterChip({
  active,
  onClick,
  children,
  count,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  title?: string;
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
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn('tabular-nums', active ? 'opacity-80' : 'text-subtle')}>{count}</span>
      )}
    </button>
  );
}

/** Small pill showing a color temperature in its own color. */
export function KelvinChip({ kelvin, dim }: { kelvin: number; dim?: boolean }) {
  return (
    <span
      className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums ring-1 ring-black/10 ring-inset', dim && 'opacity-45')}
      style={{ backgroundColor: kelvinCss(kelvin), color: kelvinTextColor(kelvin) }}
      title={formatKelvin(kelvin)}
    >
      {Math.round(kelvin / 10) * 10}K
    </span>
  );
}

/** Round dot in the light's color; glows when the light is on. */
export function LightDot({ kelvin, on, className }: { kelvin: number; on: boolean; className?: string }) {
  const color = kelvinCss(kelvin);
  return (
    <span
      aria-hidden
      className={cn('inline-block size-3 shrink-0 rounded-full ring-1 ring-black/15', !on && 'opacity-35', className)}
      style={{ backgroundColor: color, boxShadow: on ? `0 0 8px 2px ${color}` : undefined }}
    />
  );
}

const SUN_ICONS: Record<SunExposure, typeof Sun> = { 'full-sun': Sun, 'part-sun': CloudSun, shade: Cloud };

/** Sun / water / zone badges for plant cards. */
export function PlantBadges({ plant, zone, className }: { plant: PlantInfo; zone: number | undefined; className?: string }) {
  const zoneLabel = zoneShortLabel(plant);
  const fit = zoneFit(plant, zone);
  const drops = WATER_DROPS[plant.water] ?? 1;
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      <span className="inline-flex h-5 items-center gap-0.5 rounded-full bg-surface-2 px-1.5 text-gold" title={plant.sun.map((s) => SUN_LABELS[s]).join(', ')}>
        {plant.sun.map((s) => {
          const Icon = SUN_ICONS[s] ?? Sun;
          return <Icon key={s} className="size-3" aria-hidden />;
        })}
        <span className="sr-only">{plant.sun.map((s) => SUN_LABELS[s]).join(', ')}</span>
      </span>
      <span className="inline-flex h-5 items-center rounded-full bg-surface-2 px-1.5 text-accent" title={WATER_LABELS[plant.water]}>
        {Array.from({ length: drops }, (_, i) => (
          <Droplet key={i} className="-mx-px size-3" aria-hidden />
        ))}
        <span className="sr-only">{WATER_LABELS[plant.water]}</span>
      </span>
      {plant.indoor ? (
        <Badge>Indoor</Badge>
      ) : (
        zoneLabel && (
          <span title={fit === 'outside' ? `Not hardy in your zone (${zone})` : fit === 'fits' ? `Hardy in your zone (${zone})` : `USDA zones ${zoneLabel.slice(1)}`}>
            <Badge tone={fit === 'outside' ? 'warning' : fit === 'fits' ? 'success' : 'neutral'}>
              {fit === 'outside' && <TriangleAlert className="size-3" aria-hidden />}
              {zoneLabel}
            </Badge>
          </span>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Callouts
// ---------------------------------------------------------------------------

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

/** Label / value row used in info sheets. */
export function FactRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-text">{children}</dd>
    </div>
  );
}
