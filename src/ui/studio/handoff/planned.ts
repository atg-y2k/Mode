/**
 * Pure helpers around a run's planned variations (Generation.planned): the
 * run status they roll up to, the hand-offs still waiting for the user, how
 * returned files are assigned to them, and how a variation's provenance and
 * alignment read in the UI. No store access — unit-tested in node.
 */
import type { AlignmentReport, DesignBrief, Generation, HandoffApp, PlannedVariation, Photo, Project, VariationSource } from '../../../../shared/types';
import { growChoice } from '../maskFromZones';

/** A planned item and where it lives. */
export interface PlannedRef {
  photoId: string;
  generationId: string;
  plannedId: string;
}

export interface PendingItem extends PlannedRef {
  generation: Generation;
  planned: PlannedVariation;
  /** 0-based position in the run's plan. */
  index: number;
}

export const APP_LABELS: Record<HandoffApp, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini' };

export function appLabel(app: HandoffApp | undefined | null): string {
  return app ? APP_LABELS[app] : 'ChatGPT';
}

export function otherApp(app: HandoffApp): HandoffApp {
  return app === 'chatgpt' ? 'gemini' : 'chatgpt';
}

/** Waiting for the user: not handed off / not back yet, or back and waiting in staging. */
export function isPending(p: Pick<PlannedVariation, 'status'>): boolean {
  return p.status === 'awaiting-handoff' || p.status === 'staged';
}

/**
 * The run status implied by its planned items: 'awaiting' while any hand-off
 * is waiting or staged, 'running' while an API render is pending, else
 * 'done' (everything that wasn't skipped was accepted), 'partial' (some
 * results, some failures) or 'failed' (no results). Runs without planned
 * items keep their status.
 */
export function rollupStatus(g: Pick<Generation, 'planned' | 'status' | 'variations'>): { status: Generation['status']; error?: string } {
  const planned = g.planned ?? [];
  if (planned.length === 0) return { status: g.status };
  if (planned.some(isPending)) return { status: 'awaiting' };
  if (planned.some((p) => p.status === 'pending')) return { status: 'running' };
  const done = planned.filter((p) => p.status === 'done').length;
  const failed = planned.filter((p) => p.status === 'failed');
  const skipped = planned.filter((p) => p.status === 'rejected').length;
  if (done === 0) {
    if (failed.length) return { status: 'failed', error: failed[0].error || 'No variation could be made.' };
    return { status: 'failed', error: skipped === planned.length ? 'Every variation was skipped — nothing was kept.' : 'No variation was kept.' };
  }
  if (failed.length) {
    const total = planned.length - skipped;
    return { status: 'partial', error: `${failed.length} of ${total} variation${total === 1 ? '' : 's'} failed: ${failed[0].error ?? ''}`.trim() };
  }
  return { status: 'done' };
}

/** Hand-offs of a photo that still need the user (awaiting or staged), newest run first, plan order within a run. */
export function pendingHandoffs(photo: Photo | undefined): PendingItem[] {
  if (!photo) return [];
  const out: PendingItem[] = [];
  for (const g of photo.generations) {
    (g.planned ?? []).forEach((p, index) => {
      if (isPending(p)) out.push({ photoId: photo.id, generationId: g.id, plannedId: p.id, generation: g, planned: p, index });
    });
  }
  return out;
}

/** Pending hand-offs of every photo in the project (the active photo's first when given). */
export function projectPendingHandoffs(project: Project | null | undefined, firstPhotoId?: string | null): PendingItem[] {
  if (!project) return [];
  const photos = project.spaces.flatMap((s) => s.photos);
  photos.sort((a, b) => (a.id === firstPhotoId ? -1 : b.id === firstPhotoId ? 1 : 0));
  return photos.flatMap((p) => pendingHandoffs(p));
}

export function findPlanned(photo: Photo | undefined, generationId: string, plannedId: string): { generation: Generation; planned: PlannedVariation; index: number } | undefined {
  const generation = photo?.generations.find((g) => g.id === generationId);
  const index = generation?.planned?.findIndex((p) => p.id === plannedId) ?? -1;
  if (!generation || index < 0) return undefined;
  return { generation, planned: generation.planned![index], index };
}

export function sameRef(a: PlannedRef | null | undefined, b: PlannedRef | null | undefined): boolean {
  return !!a && !!b && a.photoId === b.photoId && a.generationId === b.generationId && a.plannedId === b.plannedId;
}

/**
 * Which pending items N returned files go to. A single file goes to the
 * active item (replacing its staged result when it is already back), else to
 * the first waiting one. Several files fill only the items still waiting for
 * a hand-off, in order — the active item first when it is waiting, then the
 * rest of its run, then the other runs — so a result already back is never
 * replaced (and the files never shift by one item). With nothing waiting, a
 * file replaces the active (else the first) staged result.
 */
export function assignTargets(items: readonly PendingItem[], active: PlannedRef | null, count: number): PendingItem[] {
  if (count <= 0) return [];
  const hit = active ? items.find((i) => sameRef(i, active)) : undefined;
  // Several files fill the items still waiting; only a single file may replace a staged result.
  const first = hit && (count === 1 || hit.planned.status === 'awaiting-handoff') ? hit : undefined;
  const awaiting = items.filter((i) => i.planned.status === 'awaiting-handoff' && i !== first);
  // Prefer the active item's run, then the rest.
  const sameRun = hit ? awaiting.filter((i) => i.generationId === hit.generationId) : [];
  const others = awaiting.filter((i) => !sameRun.includes(i));
  const ordered = [...(first ? [first] : []), ...sameRun, ...others];
  if (ordered.length === 0) {
    // Nothing waits: a new file replaces the active (else the first) staged result.
    const staged = hit ?? items.find((i) => i.planned.status === 'staged');
    return staged ? [staged] : [];
  }
  return ordered.slice(0, count);
}

// ---------------------------------------------------------------------------
// Provenance & alignment
// ---------------------------------------------------------------------------

/** "ChatGPT", "Gemini", "API" — or null for variations from before provenance was recorded. */
export function sourceLabel(source: VariationSource | undefined): string | null {
  if (!source) return null;
  if (source.kind === 'handoff') return appLabel(source.app);
  return 'API';
}

/** Short tag for tiny tiles. */
export function sourceTag(source: VariationSource | undefined): string | null {
  if (!source) return null;
  if (source.kind === 'api') return 'API';
  return source.app === 'gemini' ? 'Gemini' : 'GPT';
}

/** Above this share of changed protected pixels the model most likely re-framed or regenerated the scene. */
export const REFRAMED_SHARE = 0.15;
/** Below this share outside changes are noise. */
export const NOTICEABLE_SHARE = 0.005;
/** Colour drift (mean ΔE outside the target) that is still visible after correction. */
export const DRIFT_WARN = 6;

export type AlignmentTone = 'success' | 'info' | 'warning';

export interface AlignmentSummary {
  tone: AlignmentTone;
  /** Badge text, e.g. "Aligned", "Model changed 2 areas outside — protected". */
  label: string;
  /** One or two sentences for the tooltip / staging card. */
  detail: string;
  /** Worth flagging on a small tile. */
  warn: boolean;
  /** Suggest the stricter prompt. */
  suggestStricter: boolean;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const de = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/**
 * How a returned image lined up, in words. `outsideAreas` (number of notable
 * change blobs) is only known right after import; the share is persisted.
 */
export function alignmentSummary(report: AlignmentReport, outsideAreas?: number): AlignmentSummary {
  const drift = `colour drift ΔE ${de(report.driftBefore)} → ${de(report.driftAfter)}`;
  if (!report.aligned) {
    return {
      tone: 'warning',
      label: 'Rough fit',
      detail: `The result didn't line up reliably with your photo (${report.inliers} matching features), so it was fitted by size only. Check the edges of the change, or try again in a new chat.`,
      warn: true,
      suggestStricter: true,
    };
  }
  if (report.outsideChanged >= REFRAMED_SHARE) {
    return {
      tone: 'warning',
      label: 'Scene redrawn — protected',
      detail: `The model changed ${pct(report.outsideChanged)} of the area that should have stayed the same. Mode restored it from your photo, but the edit may not blend well — a stricter prompt in a new chat usually helps.`,
      warn: true,
      suggestStricter: true,
    };
  }
  if (report.outsideChanged >= NOTICEABLE_SHARE) {
    const what = outsideAreas && outsideAreas > 0 ? `${outsideAreas} area${outsideAreas === 1 ? '' : 's'}` : `${pct(Math.max(0.01, report.outsideChanged))} of the scene`;
    return {
      tone: 'info',
      label: `Model changed ${what} outside — protected`,
      detail: `Those changes were dropped: everything outside the outline comes from your photo. Aligned within ${de(report.residualPx)} px; ${drift}.`,
      warn: report.driftAfter > DRIFT_WARN,
      suggestStricter: false,
    };
  }
  if (report.driftAfter > DRIFT_WARN) {
    return {
      tone: 'warning',
      label: `Colour drift ΔE ${de(report.driftAfter)}`,
      detail: `Aligned within ${de(report.residualPx)} px, but the colours still differ from your photo after correction (${drift}). The edit may look slightly off-tone.`,
      warn: true,
      suggestStricter: false,
    };
  }
  return {
    tone: 'success',
    label: 'Aligned',
    detail: `Lined up within ${de(report.residualPx)} px using ${report.inliers} matching features; ${drift}. Everything outside the outline is your original photo.`,
    warn: false,
    suggestStricter: false,
  };
}

/**
 * A result whose model changed things outside the area, for a brief with a
 * footprint-changing choice (a wider or curvier path…): the new shape most
 * likely ran past the area that may change — a stricter prompt won't fix
 * that, letting the ground beside it change will. Null otherwise.
 */
export function footprintHint(
  brief: DesignBrief,
  report: AlignmentReport | undefined,
  /** Whether the notable outside changes touch the run's area (unknown → assume they do). */
  touchesArea = true,
): { message: string; elementId: string } | null {
  if (!report || brief.scope === 'whole' || report.outsideChanged < NOTICEABLE_SHARE || !touchesArea) return null;
  const el = brief.elements.find((e) => growChoice(e) && (e.zoneIds.length > 0 || e.pathIds.length > 0));
  if (!el) return null;
  const noun = el.type === 'driveway' ? 'drive' : el.type === 'patio' ? 'patio' : 'path';
  return { message: `The new ${noun} ran past the area that may change. Let the lawn beside it change and retry.`, elementId: el.id };
}

/**
 * Whether any outside-change box lies at the edge of the run's area (its
 * frozen zones and paths, room included): within ~3 % of the photo's long
 * edge of their bounding box. Unknown (no snapshot / no boxes) → undefined.
 */
export function changesTouchArea(
  blobs: readonly { x: number; y: number; w: number; h: number }[] | undefined,
  target: Generation['target'],
  photo: { width: number; height: number },
): boolean | undefined {
  if (!blobs || !target) return undefined;
  const pts = [...target.zones, ...(target.room?.zones ?? [])].flatMap((z) => z.polygon);
  const pad = 0.03 * Math.max(photo.width, photo.height);
  const boxes = [
    ...(pts.length ? [{ x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) }] : []),
    ...target.paths.map((p) => ({
      x0: Math.min(...p.points.map((q) => q.x)) - p.widthPx,
      y0: Math.min(...p.points.map((q) => q.y)) - p.widthPx,
      x1: Math.max(...p.points.map((q) => q.x)) + p.widthPx,
      y1: Math.max(...p.points.map((q) => q.y)) + p.widthPx,
    })),
  ];
  if (!boxes.length) return undefined;
  return blobs.some((b) => boxes.some((a) => b.x < a.x1 + pad && b.x + b.w > a.x0 - pad && b.y < a.y1 + pad && b.y + b.h > a.y0 - pad));
}
