/**
 * The variations strip: the original, then every run of this photo (newest
 * first), each labeled with its plan (compare runs: the compared question)
 * and its plants' feasibility; thumbnails with favorite stars and option
 * labels, live placeholders while planning / rendering, failed tiles with
 * retry. Click a tile to view it; each tile has the full action menu.
 */
import { GitCompareArrows, ImageOff, LayoutGrid, Loader2, PenLine, RotateCcw, Sparkles, Star, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Generation, Photo, Variation } from '../../../shared/types';
import { useStore } from '../../state/store';
import { cn } from '../common';
import { runOrNotify, viewVariation } from './actions';
import { PlantSummaryChip } from './Feasibility';
import { cancelRun, retryRun, retryVariation } from './generate';
import { useBlobUrl } from './hooks';
import { useRunInfo } from './runs';
import { compareContext, runTiles, type Tile } from './tiles';
import { setStudioUI } from './ui';
import { VariationMenuButton } from './VariationActions';

const TILE_H = 68;

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d} d ago` : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One-line name of a run for headers. */
export function runTitle(g: Generation): string {
  const cmp = compareContext(g);
  if (cmp) return `${cmp.dimensionLabel} · ${cmp.elementLabel}`;
  if (g.plan) return g.plan;
  if (g.brief.prompt.trim()) return g.brief.prompt.trim();
  if (g.brief.elements.length) return g.brief.elements.map((e) => e.label).join(' + ');
  return g.status === 'running' ? 'Planning…' : 'Run';
}

function Thumb({ id, alt }: { id: string; alt: string }) {
  const url = useBlobUrl(id);
  return url.url ? (
    <img src={url.url} alt={alt} draggable={false} className="h-full w-full object-cover" />
  ) : (
    <div className="grid h-full w-full place-items-center bg-surface-3 text-subtle">{url.status === 'missing' ? <ImageOff className="size-4" /> : null}</div>
  );
}

function TileFrame({
  width,
  selected,
  children,
  className,
  onClick,
  label,
}: {
  width: number;
  selected?: boolean;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  label: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={label}
      aria-pressed={onClick ? selected : undefined}
      title={label}
      className={cn(
        'relative block shrink-0 overflow-hidden rounded-lg bg-surface-3 transition-[box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : onClick && 'hover:brightness-105',
        className,
      )}
      style={{ width, height: TILE_H }}
    >
      {children}
    </Tag>
  );
}

function OriginalTile({ photo, width, selected }: { photo: Photo; width: number; selected: boolean }) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex h-6 items-center text-[11px] font-semibold uppercase tracking-wider text-muted">Original</div>
      <TileFrame width={width} selected={selected} onClick={() => viewVariation(null)} label="Original photo (Esc)">
        <Thumb id={photo.thumbId} alt="Original photo" />
      </TileFrame>
    </div>
  );
}

function VariationTile({ photo, g, tile, width, selected }: { photo: Photo; g: Generation; tile: Tile; width: number; selected: boolean }) {
  const v = tile.variation as Variation;
  return (
    <div className="group relative shrink-0">
      <TileFrame width={width} selected={selected} onClick={() => viewVariation(v.id)} label={`${tile.label}${g.mode === 'compare' ? '' : ` — ${v.title}`}`}>
        <Thumb id={v.thumbId} alt={v.title} />
        {(g.mode === 'compare' || v.optionLabel) && (
          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1.5 pt-3 pb-1 text-left text-[10px] font-medium text-white">
            {v.optionLabel ?? v.title}
          </span>
        )}
      </TileFrame>
      <button
        type="button"
        aria-label={v.favorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={v.favorite}
        onClick={() => useStore.getState().toggleFavorite(photo.id, v.id)}
        className={cn(
          'absolute top-1 left-1 grid size-6 place-items-center rounded-full bg-black/40 transition-opacity focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white',
          v.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <Star className={cn('size-3.5', v.favorite ? 'fill-gold text-gold' : 'text-white')} />
      </button>
      <VariationMenuButton
        photoId={photo.id}
        variation={v}
        tone="stage"
        className="absolute top-1 right-1 size-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      />
    </div>
  );
}

function PendingTile({ tile, width, planning }: { tile: Tile; width: number; planning: boolean }) {
  return (
    <TileFrame width={width} label={planning ? 'Planning' : `Rendering ${tile.label}`} className="bg-surface-3">
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-surface-2 to-surface-3" />
      <div className="relative flex h-full flex-col items-center justify-center gap-1 px-1.5 text-center">
        <Loader2 className={cn('size-4 text-muted', tile.state === 'rendering' && 'animate-spin')} />
        <span className="line-clamp-2 text-[10px] leading-tight text-muted">{tile.label || (planning ? 'Planning…' : 'Waiting…')}</span>
      </div>
    </TileFrame>
  );
}

function FailedTile({ g, tile, width }: { g: Generation; tile: Tile; width: number }) {
  const missing = tile.state === 'missing';
  return (
    <TileFrame width={width} label={`${tile.label || 'Variation'} — ${missing ? 'not rendered' : `failed: ${tile.error ?? ''}`}`} className="bg-danger-soft">
      <div className="flex h-full flex-col items-center justify-center gap-1 px-1.5 text-center">
        <span className="line-clamp-1 text-[10px] font-medium text-danger">
          <TriangleAlert className="mr-0.5 inline size-3 align-[-2px]" />
          {tile.label || (missing ? 'Not rendered' : 'Failed')}
        </span>
        <button
          type="button"
          onClick={() =>
            void (tile.slotKey ? retryVariation(g.id, tile.slotKey) : retryRun(g.id).catch((err: Error) => useStore.getState().notify(err.message, 'error')))
          }
          className="inline-flex h-6 items-center gap-1 rounded-full bg-surface px-2 text-[10px] font-semibold text-text shadow-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <RotateCcw className="size-3" /> Retry
        </button>
      </div>
    </TileFrame>
  );
}

function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

function RunGroup({ photo, g, tileW, viewId, gridOpen }: { photo: Photo; g: Generation; tileW: number; viewId: string | null; gridOpen: boolean }) {
  const info = useRunInfo(g.id);
  const progress = useStore((s) => s.runs[g.id]);
  const tiles = runTiles(g, info);
  const running = g.status === 'running' && !!progress;
  const failedCount = tiles.filter((t) => t.state === 'failed' || t.state === 'missing').length;
  const title = runTitle(g);
  const icon =
    g.mode === 'compare' ? <GitCompareArrows className="size-3.5" /> : g.baseVariationId ? <PenLine className="size-3.5" /> : <Sparkles className="size-3.5" />;
  const planning = info?.stage === 'planning';

  return (
    <section
      aria-label={`Run: ${title}`}
      className={cn(
        'group/run flex min-w-60 shrink-0 flex-col gap-1.5 rounded-xl p-1.5 transition-colors',
        gridOpen ? 'bg-accent-soft' : 'hover:bg-surface-2/70',
      )}
    >
      <header className="flex h-6 w-0 min-w-full items-center gap-1.5 px-0.5 text-xs">
        <span className={cn('shrink-0', g.status === 'failed' ? 'text-danger' : 'text-muted')}>{icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-text" title={[g.plan || title, g.error, timeAgo(g.createdAt)].filter(Boolean).join('\n\n')}>
          {title}
        </span>
        {running && <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" aria-label="Running" />}
        {!running && g.status !== 'done' && (
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold',
              g.status === 'failed' ? 'bg-danger-soft text-danger' : 'bg-warning/15 text-warning',
            )}
            title={g.error}
          >
            {g.error?.startsWith('Interrupted')
              ? 'Interrupted'
              : g.error?.startsWith('Cancelled')
                ? 'Cancelled'
                : g.status === 'failed'
                  ? 'Failed'
                  : `${failedCount} failed`}
          </span>
        )}
        {g.plantNotes && g.plantNotes.length > 0 && <PlantSummaryChip notes={g.plantNotes} compact />}
        {g.variations.length + tiles.filter((t) => !t.variation).length > 1 && (
          <HeaderButton label="Side by side" onClick={() => useStore.getState().setStudio({ gridGenerationId: gridOpen ? null : g.id })}>
            <LayoutGrid className="size-3.5" />
          </HeaderButton>
        )}
        {running ? (
          <HeaderButton label="Cancel run" onClick={() => cancelRun(g.id)}>
            <X className="size-3.5" />
          </HeaderButton>
        ) : (
          (g.status === 'failed' || g.status === 'partial') && (
            <HeaderButton
              label={failedCount > 0 ? 'Retry the failed variations' : 'Run again with the same brief'}
              onClick={() => void retryRun(g.id).catch((err: Error) => useStore.getState().notify(err.message, 'error'))}
            >
              <RotateCcw className="size-3.5" />
            </HeaderButton>
          )
        )}
        <HeaderButton label="Delete run" onClick={() => setStudioUI({ confirm: { kind: 'run', photoId: photo.id, id: g.id, title } })}>
          <Trash2 className="size-3.5" />
        </HeaderButton>
      </header>
      <div className="flex gap-1.5">
        {tiles.length === 0 && g.status !== 'running' && (
          <div className="flex h-[68px] items-center gap-2 px-1 text-xs text-muted">
            <span className="line-clamp-2 max-w-60">{g.error ?? 'No variations'}</span>
            <button
              type="button"
              onClick={() =>
                void runOrNotify({ photoId: photo.id, mode: g.mode, compare: g.compare, brief: g.brief, baseVariationId: g.baseVariationId ?? null })
              }
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-surface px-2.5 font-medium text-text shadow-sm hover:bg-surface-3"
            >
              <RotateCcw className="size-3" /> Run again
            </button>
          </div>
        )}
        {tiles.map((t) =>
          t.variation ? (
            <VariationTile key={t.key} photo={photo} g={g} tile={t} width={tileW} selected={t.variation.id === viewId} />
          ) : t.state === 'failed' || t.state === 'missing' ? (
            <FailedTile key={t.key} g={g} tile={t} width={tileW} />
          ) : (
            <PendingTile key={t.key} tile={t} width={tileW} planning={planning} />
          ),
        )}
      </div>
    </section>
  );
}

export function VariationStrip({ photo }: { photo: Photo }) {
  const viewId = useStore((s) => s.studio.viewVariationId);
  const gridId = useStore((s) => s.studio.gridGenerationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const aspect = photo.width / Math.max(1, photo.height);
  const tileW = Math.round(Math.min(132, Math.max(52, TILE_H * aspect)));
  const newest = photo.generations[0]?.id;

  // A new run appears at the start: bring it into view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, [newest]);

  return (
    <div className="@container border-t border-line bg-surface">
      <div
        ref={scrollRef}
        className="scroll-thin flex items-start gap-2 overflow-x-auto px-2.5 py-2 sm:px-3.5"
        onWheel={(e) => {
          const el = scrollRef.current;
          if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
        }}
      >
        <div className="p-1.5">
          <OriginalTile photo={photo} width={tileW} selected={!viewId && !gridId} />
        </div>
        <div className="my-1.5 w-px self-stretch bg-line" />
        {photo.generations.length === 0 ? (
          <div className="flex min-h-[94px] max-w-md flex-col justify-center gap-1 px-2 text-xs text-muted">
            <span className="font-medium text-text">Your variations will appear here, newest first.</span>
            <span className="hidden @lg:inline">
              Each run shows its plan and the plants it uses. Click one to view it, then refine it, ask for more like it, or compare it with the original.
            </span>
          </div>
        ) : (
          photo.generations.map((g) => <RunGroup key={g.id} photo={photo} g={g} tileW={tileW} viewId={viewId} gridOpen={gridId === g.id} />)
        )}
      </div>
    </div>
  );
}
