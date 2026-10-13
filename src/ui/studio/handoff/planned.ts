/**
 * Pure helpers around a run's planned variations (Generation.planned): the
 * run status they roll up to, the hand-offs still waiting for the user, how
 * returned files are assigned to them, and how a variation's provenance and
 * alignment read in the UI. No store access — unit-tested in node.
 */
import type { AlignmentReport, Generation, HandoffApp, PlannedVariation, Photo, Project, VariationSource } from '../../../../shared/types';

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
 * Which pending items N returned files go to: the active item first (when it
 * is still pending), then the other items still waiting for a hand-off, in
 * order. A single file always goes to the active item (replacing a staged
 * result), else to the first waiting one.
 */
export function assignTargets(items: readonly PendingItem[], active: PlannedRef | null, count: number): PendingItem[] {
  if (count <= 0) return [];
  const first = active ? items.find((i) => sameRef(i, active)) : undefined;
  const awaiting = items.filter((i) => i.planned.status === 'awaiting-handoff' && i !== first);
  // Prefer the active item's run, then the rest.
  const sameRun = first ? awaiting.filter((i) => i.generationId === first.generationId) : [];
  const others = awaiting.filter((i) => !sameRun.includes(i));
  const ordered = [...(first ? [first] : []), ...sameRun, ...others];
  if (!first && ordered.length === 0) {
    // Only staged items left: a new file replaces the first staged result.
    const staged = items.find((i) => i.planned.status === 'staged');
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
