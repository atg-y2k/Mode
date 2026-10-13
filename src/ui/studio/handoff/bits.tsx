/**
 * Small shared pieces of the hand-off UI: app glyphs, provenance / alignment
 * badges, the target preview (what may change vs what stays protected) and
 * the "copied" button feedback.
 */
import { BadgeCheck, Info, MessageCircle, ShieldCheck, Sparkle, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AlignmentReport, Generation, HandoffApp, Photo, VariationSource } from '../../../../shared/types';
import type { Mask } from '../../../engine/types';
import { findVariation } from '../../../state/store';
import { cn } from '../../common';
import { useBlobUrl } from '../hooks';
import { targetMaskFor } from './pack';
import { alignmentSummary, appLabel, sourceLabel, sourceTag, type AlignmentSummary } from './planned';

export function AppIcon({ app, className }: { app: HandoffApp | undefined; className?: string }) {
  return app === 'gemini' ? <Sparkle className={cn('size-3.5', className)} aria-hidden /> : <MessageCircle className={cn('size-3.5', className)} aria-hidden />;
}

const TONES = {
  success: 'bg-success/15 text-success',
  info: 'bg-accent-soft text-accent',
  warning: 'bg-warning/15 text-warning',
} as const;

const STAGE_TONES = {
  success: 'bg-success/25 text-white',
  info: 'bg-white/15 text-white',
  warning: 'bg-warning/30 text-white',
} as const;

export function AlignmentBadge({ report, areas, tone = 'surface', className }: { report: AlignmentReport; areas?: number; tone?: 'surface' | 'stage'; className?: string }) {
  const s = alignmentSummary(report, areas);
  const Icon = s.tone === 'success' ? BadgeCheck : s.tone === 'info' ? ShieldCheck : TriangleAlert;
  return (
    <span
      className={cn('inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-[11px] font-semibold', (tone === 'stage' ? STAGE_TONES : TONES)[s.tone], className)}
      title={s.detail}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{s.label}</span>
    </span>
  );
}

export function summaryOf(source: VariationSource | undefined): AlignmentSummary | null {
  return source?.alignment ? alignmentSummary(source.alignment) : null;
}

/** Tiny provenance tag for tiles: "GPT", "Gemini", "API" (+ a warning when the alignment needs a look). */
export function SourceTag({ source, className }: { source: VariationSource | undefined; className?: string }) {
  const tag = sourceTag(source);
  if (!tag) return null;
  const summary = summaryOf(source);
  const label = `${sourceLabel(source)}${summary ? ` · ${summary.label}` : ''}`;
  return (
    <span
      className={cn('pointer-events-none inline-flex h-4 items-center gap-0.5 rounded bg-black/55 px-1 text-[9px] font-semibold uppercase tracking-wide text-white', className)}
      title={summary ? `${label}\n${summary.detail}` : label}
      aria-label={label}
    >
      {summary?.warn && <TriangleAlert className="size-2.5 text-gold" aria-hidden />}
      {tag}
    </span>
  );
}

/** "From ChatGPT · Aligned" line for menus and cards. */
export function ProvenanceLine({ source, tone = 'surface' }: { source: VariationSource | undefined; tone?: 'surface' | 'stage' }) {
  const label = sourceLabel(source);
  if (!label) return null;
  const summary = summaryOf(source);
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px]', tone === 'stage' ? 'text-white/70' : 'text-muted')} title={summary?.detail}>
      {source?.kind === 'handoff' ? <AppIcon app={source.app} /> : <Info className="size-3.5" aria-hidden />}
      <span className="truncate">
        {source?.kind === 'handoff' ? `Made in ${label}` : 'Rendered with the image API'}
        {summary && <span className={cn(summary.warn && (tone === 'stage' ? 'text-gold' : 'text-warning'))}> · {summary.label}</span>}
      </span>
    </div>
  );
}

/** Button label that flips to "Copied" for a moment after `trigger` changes. */
export function useFlash(ms = 1800): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return [
    on,
    () => {
      setOn(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOn(false), ms);
    },
  ];
}

/**
 * The starting image with everything that stays protected dimmed and the
 * area that may change outlined — the review step's "what changes" view.
 * Shows the run's own target (frozen when it started, or the outline its
 * hand-off was prepared with), the same mask the export and the import use.
 */
export function TargetPreview({
  photo,
  generation,
  baseVariationId,
  className,
  children,
}: {
  photo: Photo;
  generation: Pick<Generation, 'id' | 'brief' | 'target' | 'handoffTarget'>;
  baseVariationId?: string;
  className?: string;
  children?: ReactNode;
}) {
  const base = baseVariationId ? findVariation(photo, baseVariationId) : undefined;
  const img = useBlobUrl(base?.imageId ?? photo.imageId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mask, setMask] = useState<{ mask: Mask; wholeImage: boolean } | null>(null);

  // Recompute only when the outlines can differ (not on every document edit); runs from older saves follow the live scene.
  const zones = generation.target ? null : photo.scene?.zones;
  const paths = generation.target ? null : photo.scene?.paths;
  useEffect(() => {
    let alive = true;
    void targetMaskFor(photo, generation)
      .then((m) => alive && setMask(m))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [photo.id, generation.id, generation.brief, generation.target, generation.handoffTarget?.maskId, zones, paths]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mask) return;
    drawMaskOverlay(canvas, mask.mask, mask.wholeImage);
  }, [mask]);

  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-stage', className)} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
      {img.url && <img src={img.url} alt="The photo this run starts from" className="absolute inset-0 h-full w-full object-cover" draggable={false} />}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      {children}
    </div>
  );
}

/** Dims the protected area and outlines the target, at ≤ 640 px. */
function drawMaskOverlay(canvas: HTMLCanvasElement, mask: Mask, whole: boolean): void {
  const k = Math.min(1, 640 / Math.max(mask.width, mask.height));
  const w = Math.max(1, Math.round(mask.width * k));
  const h = Math.max(1, Math.round(mask.height * k));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (whole) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  const out = ctx.createImageData(w, h);
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(mask.height - 1, Math.floor(y / k));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(mask.width - 1, Math.floor(x / k));
      inside[y * w + x] = mask.data[sy * mask.width + sx] >= 128 ? 1 : 0;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (!inside[i]) {
        out.data[o + 3] = 120; // dim what stays
        continue;
      }
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !inside[i - 1] || !inside[i + 1] || !inside[i - w] || !inside[i + w];
      if (edge) {
        out.data[o] = 255;
        out.data[o + 1] = 255;
        out.data[o + 2] = 255;
        out.data[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

export function appName(app: HandoffApp): string {
  return appLabel(app);
}
