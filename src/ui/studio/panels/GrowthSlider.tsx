/**
 * Plant growth slider — "As planted · ~3 years · Mature" — for the brief's
 * plantMaturity (one setting for the whole brief: it is shown on every
 * planting element and in the brief's Plants section). With plants chosen it
 * shows their rough heights at each stage so "as planted" means something.
 */
import { useId } from 'react';
import { Sprout } from 'lucide-react';
import { cn } from '../../common';
import { GROWTH_STOPS, formatHeight, growthAt, growthIndex, type GrowthExample, type Maturity } from './growth';

/** A plant silhouette per stop, growing left to right (aligned with the stop labels); the chosen stage in the success color. */
function GrowthGlyph({ index }: { index: number }) {
  const scales = [0.45, 0.72, 1];
  return (
    <div className="grid grid-cols-3 items-end" aria-hidden>
      {scales.map((sc, i) => {
        const r = 7 * sc;
        const stem = 5 * sc;
        const h = 2 * r + stem + 2;
        return (
          <svg
            key={i}
            viewBox={`${-r * 1.8} 0 ${r * 3.6} ${h}`}
            style={{ height: `${h * 1.3}px` }}
            className={cn('transition-colors', i === 0 ? 'justify-self-start' : i === 1 ? 'justify-self-center' : 'justify-self-end', i === index ? 'fill-success' : 'fill-line-strong')}
          >
            <rect x={-1} y={h - stem} width="2" height={stem} rx="1" />
            <circle cx={0} cy={h - stem - r} r={r} />
            <circle cx={-r * 0.8} cy={h - stem - r * 0.45} r={r * 0.7} />
            <circle cx={r * 0.8} cy={h - stem - r * 0.45} r={r * 0.7} />
          </svg>
        );
      })}
    </div>
  );
}

export function GrowthSlider({
  value,
  onChange,
  examples = [],
  label = 'Show plants as',
  className,
}: {
  value: Maturity;
  onChange: (value: Maturity) => void;
  /** Rough heights of the chosen plants at each stage. */
  examples?: GrowthExample[];
  label?: string;
  className?: string;
}) {
  const id = useId();
  const index = growthIndex(value);
  const stop = GROWTH_STOPS[index];
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <Sprout className="size-3.5 text-success" aria-hidden />
          {label}
        </label>
        <span className="text-xs font-medium text-text">{stop.label}</span>
      </div>
      <GrowthGlyph index={index} />
      <input
        id={id}
        type="range"
        min={0}
        max={GROWTH_STOPS.length - 1}
        step={1}
        value={index}
        aria-valuetext={stop.label}
        onChange={(e) => {
          const next = growthAt(Number(e.target.value));
          if (next !== value) onChange(next);
        }}
        className="h-6 w-full cursor-pointer"
      />
      <div className="grid grid-cols-3 text-[11px]">
        {GROWTH_STOPS.map((s, i) => (
          <button
            key={s.value}
            type="button"
            tabIndex={-1}
            onClick={() => s.value !== value && onChange(s.value)}
            className={cn(
              'rounded px-0.5 py-0.5 font-medium transition-colors hover:text-text',
              i === 0 ? 'text-left' : i === GROWTH_STOPS.length - 1 ? 'text-right' : 'text-center',
              i === index ? 'text-success' : 'text-subtle',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-subtle">{stop.hint}</p>
      {examples.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted" aria-label="Rough plant heights at each stage">
          {examples.map((ex) => (
            <li key={ex.name} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-text">{ex.name}</span>
              <span className="shrink-0 tabular-nums">
                {ex.heights.map((h, i) => (
                  <span key={i}>
                    {i > 0 && <span className="text-subtle"> → </span>}
                    <span className={cn(i === index && 'font-semibold text-success')}>{formatHeight(h)}</span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
