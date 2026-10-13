/**
 * Side-by-side view of one run (studio.gridGenerationId): every variation as
 * large as the stage allows, labeled with its option (compare runs) or title,
 * the option's rationale and plant feasibility, its provenance (ChatGPT /
 * Gemini / API) and alignment, with "Choose" — which writes that option into
 * the brief and shows the variation — or "View". Fills in live while the run
 * renders; hand-offs still waiting open the hand-off card, returned ones
 * open staging.
 */
import { Check, Eye, GitCompareArrows, Loader2, RotateCcw, ScanSearch, Sparkles, Star, TriangleAlert, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { ElementOption, Generation, Photo, PlantFeasibility, Project, Space } from '../../../shared/types';
import { useInvasivesReady } from '../../site/hooks';
import { useStore } from '../../state/store';
import { cn } from '../common';
import { chooseCompareOption, viewVariation } from './actions';
import { FeasibilityBadge, PlantSummaryChip } from './Feasibility';
import { cancelRun, retryRun, retryVariation } from './generate';
import { openHandoff, openStaging, retryPrepare } from './handoff/actions';
import { AppIcon, ProvenanceLine } from './handoff/bits';
import { appLabel } from './handoff/planned';
import { bestGridColumns } from './geometry';
import { useBlobUrl, useElementSize } from './hooks';
import { STUDIO_KNOWLEDGE } from './knowledge';
import { elementFeasibilityContext, rateOptions } from './planRequest';
import { useRunInfo } from './runs';
import { compareContext, runTiles, type Tile } from './tiles';
import { VariationMenuButton } from './VariationActions';

const GAP = 14;

type Cell = { kind: 'original' } | { kind: 'tile'; tile: Tile };

function CellImage({
  imageId,
  thumbId,
  alt,
  onClick,
  width,
  height,
  children,
}: {
  imageId: string;
  thumbId: string;
  alt: string;
  onClick?: () => void;
  width: number;
  height: number;
  children?: ReactNode;
}) {
  const full = useBlobUrl(imageId);
  const thumb = useBlobUrl(thumbId);
  const url = full.url ?? thumb.url;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View ${alt}`}
      className="group/img relative block overflow-hidden rounded-lg bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      style={{ width, height }}
    >
      {url && <img src={url} alt={alt} draggable={false} className="h-full w-full object-cover" />}
      <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover/img:bg-black/20 group-hover/img:opacity-100">
        <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
          <Eye className="size-3.5" /> View
        </span>
      </span>
      {children}
    </button>
  );
}

function optionRatings(g: Generation, project: Project | null, photo: Photo, space: Space | undefined): Map<string, PlantFeasibility> {
  const out = new Map<string, PlantFeasibility>();
  const cmp = compareContext(g);
  if (!cmp?.element || !cmp.dimension || (space?.kind ?? 'exterior') !== 'exterior') return out;
  const ctx = elementFeasibilityContext(cmp.element, photo.scene, project?.location, 'exterior', STUDIO_KNOWLEDGE, g.brief.targetZoneIds);
  const rated = rateOptions(
    cmp.element,
    cmp.options.map((option) => ({ dimension: cmp.dimension!, option })),
    ctx,
    STUDIO_KNOWLEDGE,
  );
  for (const r of rated) out.set(r.option.id, r.feasibility);
  return out;
}

export function CompareGrid({ photo, space, generation: g }: { photo: Photo; space: Space | undefined; generation: Generation }) {
  const info = useRunInfo(g.id);
  const progress = useStore((s) => s.runs[g.id]);
  const project = useStore((s) => s.project);
  const viewId = useStore((s) => s.studio.viewVariationId);
  const defaultApp = useStore((s) => s.studio.handoffApp);
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);
  const [withOriginal, setWithOriginal] = useState(false);
  const cmp = compareContext(g);
  const tiles = runTiles(g, info);
  const hand = g.renderMode === 'handoff';
  const refOf = (tile: Tile) => ({ photoId: photo.id, generationId: g.id, plannedId: tile.plannedId as string });
  // Re-rate once the US-RIIS list has loaded so invasive flags show.
  const invasivesReady = useInvasivesReady();
  const ratings = useMemo(() => optionRatings(g, project, photo, space), [g, project, photo, space, invasivesReady]);
  const options = new Map<string, ElementOption>((cmp?.options ?? []).map((o) => [o.id, o]));
  const chosen = cmp?.element ? (photo.draft?.elements.find((e) => e.id === cmp.element!.id)?.choices[cmp.dimension?.id ?? ''] ?? []) : [];

  const cells: Cell[] = [...(withOriginal ? [{ kind: 'original' } as const] : []), ...tiles.map((tile) => ({ kind: 'tile', tile }) as const)];
  const aspect = photo.width / Math.max(1, photo.height);
  const captionH = (cmp ? 62 : 32) + (hand || g.variations.some((v) => v.source) ? 16 : 0);
  const cols = Math.max(1, bestGridColumns(Math.max(1, cells.length), area.width, area.height, aspect, GAP, captionH));
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const cellW = Math.max(0, (area.width - GAP * (cols - 1)) / cols);
  const cellH = Math.max(0, (area.height - GAP * (rows - 1)) / rows);
  const imgW = Math.max(40, Math.floor(Math.min(cellW, (cellH - captionH) * aspect)));
  const imgH = Math.max(30, Math.floor(imgW / aspect));

  const title = cmp ? `${cmp.dimensionLabel} · ${cmp.elementLabel}` : `${tiles.length} variation${tiles.length === 1 ? '' : 's'}`;
  const subtitle = cmp ? cmp.dimension?.question || 'Everything else stays the same — only this choice changes.' : g.plan || g.brief.prompt;
  const close = () => useStore.getState().setStudio({ gridGenerationId: null });

  return (
    <div className="flex h-full w-full flex-col bg-stage text-white">
      <div className="flex items-start gap-3 px-4 pt-3 pb-2 sm:px-5">
        <span className="mt-1 text-white/60">{cmp ? <GitCompareArrows className="size-4" /> : <Sparkles className="size-4" />}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg leading-tight">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 line-clamp-2 text-xs text-white/60" title={subtitle}>
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {g.plantNotes && g.plantNotes.length > 0 && <PlantSummaryChip notes={g.plantNotes} />}
          {progress && (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              {progress.stage === 'planning' ? 'Planning…' : `${progress.done} of ${progress.total}`}
              <button type="button" onClick={() => cancelRun(g.id)} className="ml-1 rounded p-0.5 hover:bg-white/15" aria-label="Cancel run" title="Cancel run">
                <X className="size-3.5" />
              </button>
            </span>
          )}
          <button
            type="button"
            aria-pressed={withOriginal}
            onClick={() => setWithOriginal((x) => !x)}
            className={cn(
              'hidden h-8 items-center rounded-lg px-2.5 text-xs font-medium sm:inline-flex',
              withOriginal ? 'bg-white text-black' : 'bg-white/10 text-white/85 hover:bg-white/15',
            )}
          >
            Original
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close side by side (Esc)"
            title="Back to the photo (Esc)"
            className="grid size-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4 sm:px-5">
        <div ref={areaRef} className="h-full w-full overflow-y-auto">
          {area.width > 0 && (
            <div className="grid min-h-full content-center justify-center" style={{ gridTemplateColumns: `repeat(${cols}, ${imgW}px)`, gap: GAP }}>
              {cells.map((cell) => {
                if (cell.kind === 'original') {
                  return (
                    <figure key="original" className="flex flex-col items-center gap-1.5">
                      <CellImage
                        imageId={photo.imageId}
                        thumbId={photo.thumbId}
                        alt="Original photo"
                        width={imgW}
                        height={imgH}
                        onClick={() => viewVariation(null)}
                      />
                      <figcaption className="text-xs font-medium text-white/70" style={{ width: imgW, height: captionH - 6 }}>
                        Original
                      </figcaption>
                    </figure>
                  );
                }
                const { tile } = cell;
                const option = tile.optionId ? options.get(tile.optionId) : undefined;
                const rating = tile.optionId ? ratings.get(tile.optionId) : undefined;
                const v = tile.variation;
                const isChosen = !!tile.optionId && chosen.length === 1 && chosen[0] === tile.optionId;
                return (
                  <figure key={tile.key} className="flex flex-col items-center gap-1.5">
                    {v ? (
                      <div className="group/cell relative">
                        <CellImage imageId={v.imageId} thumbId={v.thumbId} alt={tile.label} width={imgW} height={imgH} onClick={() => viewVariation(v.id)}>
                          {v.id === viewId && <span className="absolute inset-0 rounded-lg ring-2 ring-white ring-inset" />}
                        </CellImage>
                        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100 [@media(hover:none)]:opacity-100">
                          <button
                            type="button"
                            aria-label={v.favorite ? 'Remove from favorites' : 'Add to favorites'}
                            aria-pressed={v.favorite}
                            onClick={() => useStore.getState().toggleFavorite(photo.id, v.id)}
                            className="grid size-7 place-items-center rounded-full bg-black/45 hover:bg-black/65"
                          >
                            <Star className={cn('size-3.5', v.favorite ? 'fill-gold text-gold' : 'text-white')} />
                          </button>
                          <VariationMenuButton photoId={photo.id} variation={v} tone="stage" />
                        </div>
                        {v.favorite && (
                          <Star
                            className="pointer-events-none absolute top-2.5 left-2.5 size-4 fill-gold text-gold drop-shadow group-hover/cell:opacity-0"
                            aria-hidden
                          />
                        )}
                        {cmp && (
                          <button
                            type="button"
                            onClick={() => chooseCompareOption(photo, g, v)}
                            className={cn(
                              'absolute right-2 bottom-2 inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold shadow-lg transition-colors focus-visible:outline-2 focus-visible:outline-white',
                              isChosen ? 'bg-accent text-accent-fg' : 'bg-white text-black hover:bg-white/90',
                            )}
                            title={`Use “${tile.label}” for ${cmp.dimensionLabel.toLowerCase()} in the brief`}
                          >
                            {isChosen && <Check className="size-3.5" />}
                            {isChosen ? 'Chosen' : 'Choose'}
                          </button>
                        )}
                      </div>
                    ) : tile.state === 'staged' && tile.staged ? (
                      <CellImage
                        imageId={tile.staged.imageId}
                        thumbId={tile.staged.thumbId}
                        alt={tile.label}
                        width={imgW}
                        height={imgH}
                        onClick={() => openStaging(refOf(tile))}
                      >
                        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-fg shadow">
                          <ScanSearch className="size-3.5" /> Back — review it
                        </span>
                      </CellImage>
                    ) : tile.state === 'awaiting' ? (
                      <button
                        type="button"
                        onClick={() => openHandoff(refOf(tile))}
                        className="grid place-items-center rounded-lg border border-dashed border-white/25 bg-white/5 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
                        style={{ width: imgW, height: imgH }}
                      >
                        <span className="flex max-w-[85%] flex-col items-center gap-2 text-center">
                          <AppIcon app={tile.app ?? defaultApp} className="size-5 text-white/70" />
                          <span className="text-xs text-white/75">Waiting for {appLabel(tile.app ?? defaultApp)}</span>
                          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black">Open hand-off</span>
                        </span>
                      </button>
                    ) : (
                      <div
                        className={cn(
                          'grid place-items-center rounded-lg',
                          tile.state === 'failed' || tile.state === 'missing' ? 'bg-danger/15' : 'bg-white/5',
                        )}
                        style={{ width: imgW, height: imgH }}
                      >
                        {tile.state === 'failed' || tile.state === 'missing' ? (
                          <div className="flex max-w-[85%] flex-col items-center gap-2 text-center">
                            <TriangleAlert className="size-5 text-danger" />
                            <p className="line-clamp-3 text-xs text-white/75">
                              {tile.state === 'missing' ? 'This option was not rendered.' : tile.error || 'This variation failed.'}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                hand && tile.plannedId
                                  ? retryPrepare(refOf(tile))
                                  : void (tile.slotKey
                                      ? retryVariation(g.id, tile.slotKey)
                                      : retryRun(g.id).catch((err: Error) => useStore.getState().notify(err.message, 'error')))
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black hover:bg-white/90"
                            >
                              <RotateCcw className="size-3.5" /> Retry
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-white/60">
                            <Loader2 className={cn('size-6', tile.state === 'rendering' && 'animate-spin')} />
                            <span className="text-xs">{info?.stage === 'planning' ? 'Planning…' : tile.state === 'rendering' ? 'Rendering…' : 'Waiting…'}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <figcaption className="flex flex-col gap-0.5" style={{ width: imgW, height: captionH - 6 }}>
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-medium" title={tile.label}>
                          {tile.label || (v ? v.title : '…')}
                        </span>
                        {rating && <FeasibilityBadge feasibility={rating} tone="stage" />}
                      </div>
                      {cmp && (option?.rationale || option?.description) && (
                        <p className="line-clamp-2 text-[11px] leading-snug text-white/60" title={option.rationale || option.description}>
                          {option.rationale || option.description}
                        </p>
                      )}
                      {v?.source && <ProvenanceLine source={v.source} tone="stage" />}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
