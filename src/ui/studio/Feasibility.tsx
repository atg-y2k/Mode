/**
 * Plant feasibility at a glance: rating dots and chips (good / caution /
 * poor) with the reasons and better-suited alternatives on hover. Used on
 * runs (the plants a plan uses), the variation info card, zone hover cards
 * and compare-grid options.
 */
import { Leaf } from 'lucide-react';
import type { PlantFeasibility, PlantNote } from '../../../shared/types';
import { cn } from '../common';
import { HoverCard } from './Popover';

type Rating = PlantFeasibility['rating'];

const RATING_LABEL: Record<Rating, string> = { good: 'Good fit', caution: 'Caution', poor: 'Poor fit' };

const DOT: Record<Rating, string> = { good: 'bg-success', caution: 'bg-warning', poor: 'bg-danger' };
const CHIP_SURFACE: Record<Rating, string> = {
  good: 'bg-success/12 text-success',
  caution: 'bg-warning/15 text-warning',
  poor: 'bg-danger-soft text-danger',
};

export function RatingDot({ rating, className }: { rating: Rating; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', DOT[rating], className)} />;
}

export function worstRating(ratings: readonly Rating[]): Rating | undefined {
  if (ratings.includes('poor')) return 'poor';
  if (ratings.includes('caution')) return 'caution';
  return ratings.length ? 'good' : undefined;
}

function NoteDetails({ note }: { note: PlantNote }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <RatingDot rating={note.rating} />
        <span className="text-sm font-medium text-text">{note.name}</span>
        <span className="text-[11px] text-subtle">{RATING_LABEL[note.rating]}</span>
      </div>
      {note.botanical && <div className="text-xs italic text-muted">{note.botanical}</div>}
      {note.notes.length > 0 && (
        <ul className="ml-4 list-disc text-xs leading-relaxed text-muted">
          {note.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {note.alternative && <div className="text-xs text-text">Better here: {note.alternative}</div>}
    </div>
  );
}

/** One chip per plant with its rating; hover for the reasons. `tone="stage"` sits on the dark viewer. */
export function PlantNoteChips({ notes, tone = 'surface', max = 6 }: { notes: readonly PlantNote[]; tone?: 'surface' | 'stage'; max?: number }) {
  if (notes.length === 0) return null;
  const shown = notes.slice(0, max);
  const rest = notes.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((n) => (
        <HoverCard
          key={n.name}
          trigger={
            <span
              className={cn(
                'inline-flex max-w-44 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                tone === 'stage' ? 'bg-white/12 text-white/90' : CHIP_SURFACE[n.rating],
              )}
            >
              <RatingDot rating={n.rating} />
              <span className="truncate">{n.name}</span>
            </span>
          }
          content={<NoteDetails note={n} />}
        />
      ))}
      {rest > 0 && <span className={cn('text-[11px]', tone === 'stage' ? 'text-white/60' : 'text-subtle')}>+{rest} more</span>}
    </div>
  );
}

/** Compact "🌿 4 plants" chip summarizing a run's plant feasibility; hover lists every plant. */
export function PlantSummaryChip({ notes, compact }: { notes: readonly PlantNote[]; compact?: boolean }) {
  if (notes.length === 0) return null;
  const worst = worstRating(notes.map((n) => n.rating)) ?? 'good';
  const issues = notes.filter((n) => n.rating !== 'good').length;
  return (
    <HoverCard
      trigger={
        <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium', CHIP_SURFACE[worst])}>
          <Leaf className="size-3" />
          {notes.length}
          {issues > 0 && <span className="opacity-80">{compact ? `· ${issues}!` : `· ${issues} to check`}</span>}
        </span>
      }
      content={
        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Plants in this run</div>
          {notes.map((n) => (
            <NoteDetails key={n.name} note={n} />
          ))}
        </div>
      }
    />
  );
}

/** good / caution / poor badge for an option, reasons on hover. */
export function FeasibilityBadge({ feasibility, label, tone = 'surface' }: { feasibility: PlantFeasibility; label?: string; tone?: 'surface' | 'stage' }) {
  return (
    <HoverCard
      trigger={
        <span
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
            tone === 'stage' ? 'bg-white/12 text-white/90' : CHIP_SURFACE[feasibility.rating],
          )}
        >
          <RatingDot rating={feasibility.rating} />
          <span className="truncate">{label ?? RATING_LABEL[feasibility.rating]}</span>
        </span>
      }
      content={
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-sm font-medium text-text">
            <RatingDot rating={feasibility.rating} />
            {label ? `${label} — ${RATING_LABEL[feasibility.rating].toLowerCase()}` : RATING_LABEL[feasibility.rating]}
          </div>
          <ul className="ml-4 list-disc text-xs leading-relaxed text-muted">
            {feasibility.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      }
    />
  );
}
