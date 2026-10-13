/**
 * Studio run orchestration (browser):
 *   brief + scene + idea board → POST plan → review (the user sees the plan
 *   and each instruction, edits, Sends) → then either
 *   - API mode: N × POST render-variation (in parallel, max 3 at a time) →
 *     protect pixels outside the target mask (scope 'zones') → store
 *     variation blobs + Variation records as each arrives; or
 *   - hand-off mode: the run waits ('awaiting') with one planned item per
 *     variation; the user renders each in their ChatGPT / Gemini app and
 *     brings the image back (see ./handoff).
 * Both modes persist the plan's items on Generation.planned, so a reload
 * keeps every instruction (retry after reload, pending hand-offs).
 * Progress is published through store.setRunProgress; runs can be cancelled.
 *
 * Robustness:
 * - partial failures: each variation renders independently; a run whose
 *   variations partly fail ends 'partial' with the error text, and a failed
 *   variation can be retried alone with its planned instruction
 *   (retryVariation) — or all failed ones at once (retryRun), also after a reload;
 * - cancellation: one AbortController per run (cancelRun);
 * - reloads: runs left 'running' by an earlier session are marked
 *   interrupted on load (recoverInterruptedRuns, called by StudioView).
 */
import { API_PATHS, PlanRequestSchema, PlanResultSchema, type PlanRequest, type PlanResult, type RenderVariationRequest } from '../../../shared/api';
import { newId } from '../../../shared/ids';
import {
  SPACE_TYPE_LABELS,
  emptyBrief,
  type DesignBrief,
  type Generation,
  type HandoffApp,
  type IdeaItem,
  type Photo,
  type PlannedVariation,
  type PlantNote,
  type SceneMap,
  type Variation,
} from '../../../shared/types';
import type { ImageDataLike, Mask } from '../../engine/types';
import { ApiError, isAbortError } from '../../lib/api';
import { blobToAIDataUrl, blobToDataUrl, blobToImageData, dataUrlToBlob, imageDataToBlob } from '../../lib/imageImport';
import { renderVariation, STUDIO_TIMEOUTS_MS, studioPost } from '../../lib/studio';
import * as db from '../../state/persistence';
import * as runtime from '../../state/runtime';
import { findPhoto, findVariation, useStore, type AppState, type StudioState } from '../../state/store';
import { STUDIO_KNOWLEDGE } from './knowledge';
import { compositeVariation, maskToKeepAlpha, resizePixels, thumbnailBlob } from './composite';
import { appLabel, rollupStatus } from './handoff/planned';
import { effectiveRenderMode } from './handoff/prefs';
import { awaitReview, closeReview, openReview, reviewAvailable, type ReviewItem } from './handoff/review';
import { focusHandoff } from './handoff/session';
import { briefTargetIds, maskForBrief } from './maskFromZones';
import { buildPlanRequest, ideasForBrief, resolveCompare, sceneSummaryText as sceneText, swapOptionInBrief, type PlanKnowledge } from './planRequest';
import { forgetRunInfo, getRunInfo, patchRunInfo, patchSlot, setRunInfo, type RunSlot } from './runs';

export interface StartRunOptions {
  photoId: string;
  /** 'variations' = N takes on the brief; 'compare' = one variation per option of one dimension. */
  mode: 'variations' | 'compare';
  compare?: { elementId: string; dimensionId: string; optionIds: string[] };
  /** Start from this variation instead of the original (default: the variation shown in the viewer). */
  baseVariationId?: string | null;
  /** Refine: what to change relative to the base variation ("more like this, but wider path"). */
  feedback?: string;
  /** Override the brief (default: the photo's draft). */
  brief?: DesignBrief;
  /** Override store.studio.variationCount. */
  count?: number;
  /**
   * "More like this": close siblings of this variation — same brief and the
   * same starting image as the run that produced it, with the variation's
   * instruction as the model to follow. Overrides baseVariationId / feedback.
   */
  moreLikeThis?: string;
  /** Show the run in the compare grid as it renders (default: API runs whose photo is on screen). */
  showGrid?: boolean;
  /** 'handoff' = the user renders each variation in ChatGPT / Gemini; default: the Studio's choice (API only when the server has an image provider). */
  renderMode?: StudioState['renderMode'];
  /** App for hand-offs (default store.studio.handoffApp). */
  app?: HandoffApp;
  /** Show the review step before rendering / handing off (default: whenever the review modal is mounted). */
  review?: boolean;
}

/** Variations rendered in parallel. */
const CONCURRENCY = 3;
/** Long edge of idea-board images sent as inspiration. */
const IDEA_IMAGE_SIZE = 768;
const MAX_VARIATIONS = 6;

const KNOWLEDGE: PlanKnowledge = STUDIO_KNOWLEDGE;

/** Everything a render needs, prepared once per run (and again for a retry after the run ended). */
interface RenderInputs {
  /** Photo-size data URL of the starting image ('' for hand-off runs, which never call the render API). */
  image: string;
  /** The starting image downscaled for Claude (plan request). */
  planImage: string;
  /** OpenAI-convention mask (opaque keep / transparent edit) or null for whole-image edits. */
  maskUrl: string | null;
  /** Coverage mask used to keep pixels outside the targets. */
  mask: Mask | null;
  base: ImageDataLike;
  references: string[];
}

interface RunContext {
  generationId: string;
  photoId: string;
  projectId: string;
  spaceId: string;
  brief: DesignBrief;
  baseVariationId?: string;
  provider: RenderVariationRequest['provider'];
  quality: RenderVariationRequest['quality'];
  controller: AbortController;
  /** True while planning or rendering (including retries). */
  active: boolean;
  cancelled: boolean;
  inputs: Promise<RenderInputs> | null;
  /** Provider/model recorded from the first finished render. */
  providerRecorded: boolean;
  /** Original run options (for "Retry" after a failed plan). */
  options: StartRunOptions;
  renderMode: StudioState['renderMode'];
  app: HandoffApp;
  /** Waits for the user's review after planning. */
  review: boolean;
}

const contexts = new Map<string, RunContext>();

/** Error text of runs a reload interrupted (the strip and History show it as "Interrupted"). */
export const INTERRUPTED = 'Interrupted — Mode was closed or reloaded before this run finished.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const state = (): AppState => useStore.getState();

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message || 'Something went wrong.';
  return typeof err === 'string' ? err : 'Something went wrong.';
}

const cancelledError = () => new ApiError('network', 'Cancelled.', 0, { aborted: true });

function currentPhoto(ctx: Pick<RunContext, 'projectId' | 'photoId'>): Photo | undefined {
  const s = state();
  if (s.project?.id !== ctx.projectId) return undefined;
  return findPhoto(s.project, ctx.photoId)?.photo;
}

function currentGeneration(ctx: RunContext): Generation | undefined {
  return currentPhoto(ctx)?.generations.find((g) => g.id === ctx.generationId);
}

/** The run is still wanted: not cancelled, its project open and the run not deleted. */
function alive(ctx: RunContext): boolean {
  return !ctx.cancelled && !ctx.controller.signal.aborted && !!currentGeneration(ctx);
}

function checkAlive(ctx: RunContext): void {
  if (!alive(ctx)) throw cancelledError();
}

function photoOfGeneration(generationId: string): Photo | undefined {
  for (const space of state().project?.spaces ?? []) {
    for (const photo of space.photos) if (photo.generations.some((g) => g.id === generationId)) return photo;
  }
  return undefined;
}

export function generationOfVariation(photo: Photo | undefined, variationId: string | null | undefined): Generation | undefined {
  if (!photo || !variationId) return undefined;
  return photo.generations.find((g) => g.variations.some((v) => v.id === variationId));
}

function clampCount(n: number): number {
  return Math.min(MAX_VARIATIONS, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
}

function providerLabel(s: AppState, id: RenderVariationRequest['provider']): { provider: string; model: string } {
  const list = s.health?.imageProviders ?? [];
  const p = (id ? list.find((x) => x.id === id) : list.find((x) => x.isDefault)) ?? list[0];
  if (p) return { provider: p.id, model: p.model };
  return { provider: id ?? s.health?.imageProvider.name ?? 'default', model: s.health?.imageProvider.model ?? '' };
}

/**
 * User-facing reason the next run can't start, or null. Unknown health
 * (still loading) doesn't block. Hand-off runs only need the server (Claude
 * plans, or the server's template plan without Claude); API runs also need
 * an image provider. Without `renderMode` the Studio's effective mode applies
 * (API falls back to hand-off while no provider is configured).
 */
export function generationBlocker(s: Pick<AppState, 'health'> & { studio?: Pick<StudioState, 'renderMode'> }, renderMode?: StudioState['renderMode']): string | null {
  const h = s.health;
  if (!h) return null;
  if (!h.ok) return "Can't reach the Mode server — check that it's running.";
  const mode = renderMode ?? effectiveRenderMode(s.studio ?? state().studio, h);
  if (mode === 'handoff') return null;
  const providers = h.imageProviders ?? [];
  if (!h.imageProvider.enabled && providers.length === 0) {
    return 'Rendering with an image API needs OPENAI_API_KEY or GEMINI_API_KEY in .env (restart the server) — or switch to hand-off and use your ChatGPT or Gemini app.';
  }
  return null;
}

function publishProgress(ctx: RunContext): void {
  const info = getRunInfo(ctx.generationId);
  if (!info) return;
  if (!ctx.active) {
    state().setRunProgress(ctx.generationId, null);
    return;
  }
  const done = info.slots.filter((x) => x.state === 'done').length;
  const failed = info.slots.filter((x) => x.state === 'failed').length;
  state().setRunProgress(ctx.generationId, {
    stage: info.stage === 'planning' || info.stage === 'review' ? 'planning' : 'rendering',
    total: info.slots.length,
    done,
    failed,
  });
}

function updateGeneration(ctx: RunContext, recipe: (g: Generation) => void): void {
  if (!currentGeneration(ctx)) return;
  state().updateGeneration(ctx.photoId, ctx.generationId, recipe as Parameters<AppState['updateGeneration']>[2]);
}

/** Updates one planned item of the run (no-op for runs without a recorded plan). */
function patchPlanned(ctx: RunContext, key: string, patch: Partial<PlannedVariation>): void {
  updateGeneration(ctx, (g) => {
    const p = g.planned?.find((x) => x.id === key);
    if (!p) return;
    Object.assign(p, patch);
    for (const k of Object.keys(patch) as (keyof PlannedVariation)[]) if (patch[k] === undefined) delete p[k];
  });
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const PROVIDER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Starting image of a run — the original photo or a saved variation — as its
 * stored blob plus photo-size pixels. `blobIsPhotoSize` tells whether the
 * blob itself can be sent as the photo-size image.
 */
async function loadBase(photo: Photo, baseVariationId: string | undefined): Promise<{ blob: Blob; pixels: ImageDataLike; blobIsPhotoSize: boolean }> {
  let blob: Blob | undefined;
  let decoded: ImageDataLike;
  if (baseVariationId) {
    const v = findVariation(photo, baseVariationId);
    blob = v ? await db.getBlob(v.imageId) : undefined;
    if (!blob) throw new Error('The variation this run starts from is missing from storage. Start from the original instead.');
    decoded = await blobToImageData(blob);
  } else {
    blob = await db.getBlob(photo.imageId);
    if (!blob) throw new Error(`Photo "${photo.name}" is missing from storage.`);
    decoded = await runtime.loadPhotoImage(photo);
  }
  const blobIsPhotoSize = PROVIDER_TYPES.has(blob.type) && decoded.width === photo.width && decoded.height === photo.height;
  return { blob, pixels: resizePixels(decoded, photo.width, photo.height), blobIsPhotoSize };
}

async function ideaImages(ideas: readonly IdeaItem[]): Promise<string[]> {
  const out: string[] = [];
  for (const item of ideas) {
    if (out.length >= 3) break;
    if (!item.imageId || item.kind === 'note' || item.kind === 'theme') continue;
    try {
      const blob = await db.getBlob(item.imageId);
      if (blob) out.push(await blobToAIDataUrl(blob, IDEA_IMAGE_SIZE));
    } catch {
      // An unreadable inspiration image only loses that reference.
    }
  }
  return out;
}

/** Makes sure refined zone masks of the brief's targets are in the runtime cache. */
async function loadTargetMasks(photo: Photo, brief: DesignBrief): Promise<void> {
  const { zoneIds } = briefTargetIds(brief, photo.scene);
  const zones = photo.scene?.zones.filter((z) => z.maskId && zoneIds.includes(z.id)) ?? [];
  await Promise.all(zones.map((z) => runtime.loadMask(z.maskId as string, photo.width, photo.height).catch(() => undefined)));
}

async function prepareInputs(ctx: RunContext, photo: Photo): Promise<RenderInputs> {
  const project = state().project;
  const [{ blob, pixels, blobIsPhotoSize }, references] = await Promise.all([
    loadBase(photo, ctx.baseVariationId),
    ideaImages(project ? ideasForBrief(project.ideaBoard, ctx.brief, ctx.spaceId) : []),
    loadTargetMasks(photo, ctx.brief),
  ]);
  const mask = buildTargetMask(photo, ctx.brief);
  const forApi = ctx.renderMode === 'api';
  const [image, planImage, maskUrl] = await Promise.all([
    // The provider mask must match the image size exactly: send photo-size pixels.
    !forApi ? Promise.resolve('') : blobIsPhotoSize ? blobToDataUrl(blob) : imageDataToBlob(pixels, 'image/jpeg', 0.92).then(blobToDataUrl),
    blobToAIDataUrl(blob),
    mask && forApi ? imageDataToBlob(maskToKeepAlpha(mask), 'image/png').then(blobToDataUrl) : Promise.resolve(null),
  ]);
  return { image, planImage, maskUrl, mask, base: pixels, references };
}

/** POST plan, also reporting whether Claude planned it or the server filled its template (no Claude configured). */
async function requestPlan(req: PlanRequest, signal: AbortSignal): Promise<{ plan: PlanResult; source: 'ai' | 'template' | null }> {
  const { data, headers } = await studioPost(API_PATHS.plan, PlanRequestSchema, req, PlanResultSchema, STUDIO_TIMEOUTS_MS.plan, signal);
  const source = headers.get('x-mode-plan-source');
  return { plan: data, source: source === 'ai' || source === 'template' ? source : null };
}

function inputsFor(ctx: RunContext, photo: Photo): Promise<RenderInputs> {
  if (!ctx.inputs) {
    ctx.inputs = prepareInputs(ctx, photo);
    ctx.inputs.catch(() => {
      ctx.inputs = null;
    });
  }
  return ctx.inputs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Coverage mask (photo size) of everything the brief may change: target zones
 * + element zones (polygon or refined mask) + element paths (buffered
 * centerline) — grown and feathered for natural blending. Null when the brief
 * has no targets or scope is 'whole'.
 */
export function buildTargetMask(photo: Photo, brief: DesignBrief): Mask | null {
  return maskForBrief(photo, photo.scene, brief, { getMask: runtime.getMask });
}

/** Compact description of a scene for prompts (summary, architecture, zones with sun, paths, keep-list). */
export function sceneSummaryText(scene: SceneMap): string {
  return sceneText(scene);
}

/** True while the run is planning or rendering in this session. */
export function isRunActive(generationId: string): boolean {
  return contexts.get(generationId)?.active ?? false;
}

/**
 * Starts a run and resolves with the new generation id as soon as it is
 * created (rendering continues). Rejects without creating a run — with a
 * message meant for the user — when the photo is gone, no image provider is
 * configured, the brief is empty, or a compared element/dimension no longer
 * exists. Failures after that (planning, rendering) are recorded on the run
 * (status 'failed' / 'partial' + error) and announced with a toast.
 */
export async function startRun(opts: StartRunOptions): Promise<string> {
  const s = state();
  const project = s.project;
  if (!project) throw new Error('Open a project first.');
  const found = findPhoto(project, opts.photoId);
  if (!found) throw new Error('That photo is no longer in this project.');
  const { photo, space } = found;
  const renderMode = opts.renderMode ?? effectiveRenderMode(s.studio, s.health);
  const app = opts.app ?? s.studio.handoffApp;
  const blocker = generationBlocker(s, renderMode);
  if (blocker) throw new Error(blocker);

  // Starting image, brief and refine context.
  let brief: DesignBrief;
  let baseVariationId: string | undefined;
  let refine: PlanRequest['refine'] = null;
  const moreLike = opts.moreLikeThis ? findVariation(photo, opts.moreLikeThis) : undefined;
  if (opts.moreLikeThis && !moreLike) throw new Error('That variation was deleted.');
  if (moreLike) {
    const source = generationOfVariation(photo, moreLike.id);
    baseVariationId = source?.baseVariationId && findVariation(photo, source.baseVariationId) ? source.baseVariationId : undefined;
    brief = opts.brief ?? source?.brief ?? photo.draft ?? emptyBrief();
    refine = { title: moreLike.title, brief: moreLike.brief, feedback: null };
  } else {
    const requested = opts.baseVariationId === undefined ? s.studio.viewVariationId : opts.baseVariationId;
    const base = requested ? findVariation(photo, requested) : undefined;
    baseVariationId = base?.id;
    if (opts.feedback !== undefined) {
      if (!base) throw new Error('Choose the variation to refine first.');
      const feedback = opts.feedback.trim();
      refine = { title: base.title, brief: base.brief, feedback: feedback || null };
      brief = opts.brief ?? generationOfVariation(photo, base.id)?.brief ?? photo.draft ?? emptyBrief();
    } else {
      brief = opts.brief ?? photo.draft ?? emptyBrief();
    }
  }
  brief = structuredClone(brief);

  const compare = opts.mode === 'compare' ? (opts.compare ? resolveCompare(brief, opts.compare, KNOWLEDGE) : null) : null;
  if (opts.mode === 'compare') {
    if (!compare) throw new Error('That element or question is no longer in the brief.');
    if (compare.options.length < 2) throw new Error('Pick at least two options to compare.');
  }
  if (!refine && !compare && !brief.prompt.trim() && brief.elements.length === 0) {
    throw new Error('Describe what you would like to change, or add a design element.');
  }

  const count = compare ? compare.options.length : clampCount(opts.count ?? s.studio.variationCount);
  const provider = s.studio.provider;
  const generationId = newId('gen');
  const label = renderMode === 'handoff' ? { provider: appLabel(app), model: 'hand-off' } : providerLabel(s, provider);
  const generation: Generation = {
    id: generationId,
    createdAt: Date.now(),
    brief,
    mode: compare ? 'compare' : 'variations',
    plan: '',
    provider: label.provider,
    model: label.model,
    variations: [],
    status: 'running',
    renderMode,
  };
  if (compare) generation.compare = { elementId: compare.element.id, dimensionId: compare.dimension.id, optionIds: compare.options.map((o) => o.id) };
  if (baseVariationId) generation.baseVariationId = baseVariationId;

  const ctx: RunContext = {
    generationId,
    photoId: photo.id,
    projectId: project.id,
    spaceId: space.id,
    brief,
    baseVariationId,
    provider,
    quality: s.studio.quality,
    controller: new AbortController(),
    active: true,
    cancelled: false,
    inputs: null,
    providerRecorded: false,
    options: { ...opts, brief, baseVariationId: baseVariationId ?? null, renderMode, app },
    renderMode,
    app,
    review: opts.review ?? reviewAvailable(),
  };
  contexts.set(generationId, ctx);
  watchForRemovedRuns();

  // Placeholders straight away: one per compared option, else one per planned variation.
  // Slot keys double as the planned items' ids.
  const slots: RunSlot[] = compare
    ? compare.options.map((o) => ({ key: newId('plv'), title: o.label, brief: '', optionId: o.id, optionLabel: o.label, state: 'pending' }))
    : Array.from({ length: count }, () => ({ key: newId('plv'), title: '', brief: '', state: 'pending' }));
  setRunInfo({ generationId, photoId: photo.id, stage: 'planning', slots });

  s.addGeneration(photo.id, generation);
  publishProgress(ctx);
  const onScreen = s.selection.photoId === photo.id;
  if ((opts.showGrid ?? renderMode === 'api') && onScreen) s.setStudio({ gridGenerationId: generationId });
  if (ctx.review) {
    openReview({
      generationId,
      photoId: photo.id,
      renderMode,
      app,
      runMode: generation.mode,
      count,
      ...(baseVariationId ? { baseVariationId } : {}),
    });
  }

  void execute(ctx, photo, space.kind, SPACE_TYPE_LABELS[space.type], count, compare, refine);
  return generationId;
}

/** Stops a run: in-flight requests are aborted; finished variations are kept. */
export function cancelRun(generationId: string): void {
  const ctx = contexts.get(generationId);
  if (!ctx || !ctx.active) return;
  ctx.cancelled = true;
  ctx.controller.abort();
  const info = getRunInfo(generationId);
  if (info) {
    patchRunInfo(generationId, {
      stage: 'finished',
      slots: info.slots.map((x) => (x.state === 'pending' || x.state === 'rendering' ? { ...x, state: 'failed', error: 'Cancelled' } : x)),
    });
  }
  ctx.active = false;
  ctx.inputs = null;
  publishProgress(ctx);
  closeReview(generationId);
  const g = currentGeneration(ctx);
  if (!g) return;
  updateGeneration(ctx, (gen) => {
    for (const p of gen.planned ?? []) {
      if (p.status === 'pending') {
        p.status = 'failed';
        p.error = 'Cancelled';
      }
    }
  });
  if (g.variations.length === 0) {
    // Nothing to keep: drop the empty run.
    void state().deleteGeneration(ctx.photoId, generationId);
    forgetRunInfo(generationId);
    contexts.delete(generationId);
    return;
  }
  const total = info?.slots.length ?? g.variations.length;
  updateGeneration(ctx, (gen) => {
    gen.status = 'partial';
    gen.error = `Cancelled — ${gen.variations.length} of ${total} variations finished.`;
  });
}

/**
 * Re-renders one failed variation of an API run, reusing its planned
 * instruction — from this session's live slots, or from the plan recorded
 * on the run (after a reload).
 */
export async function retryVariation(generationId: string, slotKey: string): Promise<void> {
  const ctx = contexts.get(generationId) ?? restoreContext(generationId);
  const slot = getRunInfo(generationId)?.slots.find((x) => x.key === slotKey);
  if (!ctx || !slot || slot.state !== 'failed') return;
  if (!slot.brief) {
    await retryRun(generationId);
    return;
  }
  const photo = currentPhoto(ctx);
  if (!photo || !currentGeneration(ctx)) return;
  const blocker = generationBlocker(state());
  if (blocker) {
    state().notify(blocker, 'error');
    return;
  }
  reactivate(ctx);
  patchSlot(generationId, slotKey, { state: 'pending', error: undefined });
  patchPlanned(ctx, slotKey, { status: 'pending', error: undefined });
  publishProgress(ctx);
  try {
    const inputs = await inputsFor(ctx, photo);
    await renderSlot(ctx, photo, inputs, slotKey);
  } catch (err) {
    if (!isAbortError(err)) {
      patchSlot(generationId, slotKey, { state: 'failed', error: errorMessage(err) });
      patchPlanned(ctx, slotKey, { status: 'failed', error: errorMessage(err) });
    }
  }
  if (!othersBusy(ctx)) finish(ctx);
  else publishProgress(ctx);
}

/**
 * "Retry" for a run: re-renders every failed variation when their
 * instructions are known (this session); otherwise — the plan failed, or
 * the run is from an earlier session — starts the same run again (same
 * brief, mode, compared options and starting image), replacing the old run
 * when it has no finished variations.
 */
export async function retryRun(generationId: string): Promise<string | null> {
  const s = state();
  const ctx = contexts.get(generationId) ?? restoreContext(generationId);
  const info = getRunInfo(generationId);
  const failed = info?.slots.filter((x) => x.state === 'failed') ?? [];
  if (ctx && failed.length > 0 && failed.every((x) => x.brief)) {
    await Promise.all(failed.map((x) => retryVariation(generationId, x.key)));
    return generationId;
  }
  const owner = ctx ? currentPhoto(ctx) : photoOfGeneration(generationId);
  const g = owner?.generations.find((x) => x.id === generationId);
  if (!owner || !g) return null;
  // A new run follows the Studio's current render mode (the user may have switched since).
  const opts: StartRunOptions = ctx
    ? { ...ctx.options, photoId: owner.id, renderMode: undefined, app: undefined, review: undefined }
    : {
        photoId: owner.id,
        mode: g.mode,
        compare: g.compare,
        brief: g.brief,
        baseVariationId: g.baseVariationId ?? null,
      };
  const id = await startRun(opts);
  if (g.variations.length === 0) {
    contexts.delete(generationId);
    forgetRunInfo(generationId);
    await s.deleteGeneration(owner.id, generationId);
  }
  return id;
}

/**
 * Marks runs left 'running' by an earlier session (the app was closed or
 * reloaded mid-run) as interrupted: status 'partial' with an "Interrupted…"
 * error, keeping whatever variations finished. Runs active in this session
 * are left alone. Returns how many runs were marked.
 */
export function recoverInterruptedRuns(): number {
  const s = state();
  const project = s.project;
  if (!project) return 0;
  let n = 0;
  for (const space of project.spaces) {
    for (const photo of space.photos) {
      for (const g of photo.generations) {
        if (g.status !== 'running' || contexts.get(g.id)?.active) continue;
        n++;
        s.updateGeneration(photo.id, g.id, (gen) => {
          gen.status = 'partial';
          gen.error = INTERRUPTED;
          for (const p of gen.planned ?? []) {
            if (p.status !== 'pending') continue;
            p.status = 'failed';
            p.error = 'Interrupted before it rendered.';
          }
        });
        s.setRunProgress(g.id, null);
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Rebuilds the context of an API run from an earlier session from its
 * recorded plan, so failed variations can be re-rendered without planning
 * again. Undefined when there is nothing to retry that way.
 */
function restoreContext(generationId: string): RunContext | undefined {
  const s = state();
  const project = s.project;
  const owner = photoOfGeneration(generationId);
  const g = owner?.generations.find((x) => x.id === generationId);
  if (!project || !owner || !g || g.renderMode === 'handoff' || g.status === 'running') return undefined;
  const planned = (g.planned ?? []).filter((p) => p.status !== 'rejected');
  if (!planned.some((p) => (p.status === 'failed' || p.status === 'pending') && p.brief.trim())) return undefined;
  const space = findPhoto(project, owner.id)?.space;
  if (!space) return undefined;
  const baseVariationId = g.baseVariationId && findVariation(owner, g.baseVariationId) ? g.baseVariationId : undefined;
  const ctx: RunContext = {
    generationId,
    photoId: owner.id,
    projectId: project.id,
    spaceId: space.id,
    brief: g.brief,
    baseVariationId,
    provider: s.studio.provider,
    quality: s.studio.quality,
    controller: new AbortController(),
    active: false,
    cancelled: false,
    inputs: null,
    providerRecorded: g.variations.length > 0,
    options: { photoId: owner.id, mode: g.mode, compare: g.compare, brief: g.brief, baseVariationId: baseVariationId ?? null },
    renderMode: 'api',
    app: s.studio.handoffApp,
    review: false,
  };
  contexts.set(generationId, ctx);
  watchForRemovedRuns();
  setRunInfo({
    generationId,
    photoId: owner.id,
    stage: 'finished',
    slots: planned.map((p) => ({
      key: p.id,
      title: p.title,
      brief: p.brief,
      ...(p.optionId ? { optionId: p.optionId } : {}),
      ...(p.optionLabel ? { optionLabel: p.optionLabel } : {}),
      state: p.status === 'done' ? 'done' : 'failed',
      ...(p.status === 'done' ? {} : { error: p.error || 'Not rendered.' }),
      ...(p.variationId ? { variationId: p.variationId } : {}),
    })),
  });
  return ctx;
}

function reactivate(ctx: RunContext): void {
  if (ctx.active) return;
  ctx.active = true;
  ctx.cancelled = false;
  ctx.controller = new AbortController();
  patchRunInfo(ctx.generationId, { stage: 'rendering' });
  updateGeneration(ctx, (g) => {
    g.status = 'running';
    delete g.error;
  });
}

function othersBusy(ctx: RunContext): boolean {
  return (getRunInfo(ctx.generationId)?.slots ?? []).some((x) => x.state === 'pending' || x.state === 'rendering');
}

function plantNotesFrom(plan: PlanResult): PlantNote[] {
  return plan.plants.map((p) => {
    const note: PlantNote = { name: p.name, rating: p.rating, notes: p.notes };
    if (p.botanical) note.botanical = p.botanical;
    if (p.alternative) note.alternative = p.alternative;
    return note;
  });
}

/** Planned variations → slots (compare runs: matched to the options; skipped options get a sibling's instruction with the wording swapped). */
function slotsFromPlan(plan: PlanResult, placeholders: RunSlot[], compare: ReturnType<typeof resolveCompare>): RunSlot[] {
  const planned = plan.variations.filter((v) => v.brief.trim());
  if (!compare) {
    return planned
      .slice(0, placeholders.length)
      .map((v, i) => ({ key: placeholders[i]?.key ?? `v${i + 1}`, title: v.title.trim() || `Variation ${i + 1}`, brief: v.brief, state: 'pending' }));
  }
  const remaining = [...planned];
  const take = (pred: (v: (typeof planned)[number]) => boolean) => {
    const i = remaining.findIndex(pred);
    return i >= 0 ? remaining.splice(i, 1)[0] : undefined;
  };
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const matched = compare.options.map((o) => take((v) => v.optionId === o.id));
  compare.options.forEach((o, i) => {
    matched[i] ??= take((v) => norm(v.title) === norm(o.label));
  });
  compare.options.forEach((_o, i) => {
    matched[i] ??= take((v) => v.optionId == null || !compare.options.some((x) => x.id === v.optionId));
  });
  return compare.options.map((o, i) => {
    let brief = matched[i]?.brief;
    if (!brief) {
      const j = matched.findIndex((m) => !!m);
      brief = j >= 0 ? swapOptionInBrief(matched[j]!.brief, compare.options[j], o, compare.dimension.label) : '';
    }
    return {
      key: placeholders.find((p) => p.optionId === o.id)?.key ?? placeholders[i]?.key ?? o.id,
      title: o.label,
      brief,
      optionId: o.id,
      optionLabel: o.label,
      state: brief ? 'pending' : 'failed',
      ...(brief ? {} : { error: 'The plan left this option out.' }),
    };
  });
}

async function execute(
  ctx: RunContext,
  photo: Photo,
  setting: 'interior' | 'exterior',
  spaceLabel: string,
  count: number,
  compare: ReturnType<typeof resolveCompare>,
  refine: PlanRequest['refine'],
): Promise<void> {
  const { generationId } = ctx;
  try {
    // 1. Plan: Claude turns the brief into one instruction per variation.
    const inputs = await inputsFor(ctx, photo);
    checkAlive(ctx);
    const project = state().project;
    const ideas = project ? ideasForBrief(project.ideaBoard, ctx.brief, ctx.spaceId) : [];
    const request = buildPlanRequest(
      {
        image: inputs.planImage,
        ideaImages: inputs.references,
        scene: photo.scene,
        setting,
        spaceLabel,
        brief: ctx.brief,
        ideas,
        location: project?.location,
        count,
        compare,
        refine,
      },
      KNOWLEDGE,
    );
    const { plan, source } = await requestPlan(request, ctx.controller.signal);
    checkAlive(ctx);

    const placeholders = getRunInfo(generationId)?.slots ?? [];
    let slots = slotsFromPlan(plan, placeholders, compare);
    if (slots.length === 0) throw new Error('The planner returned no variations — try rephrasing the brief.');
    const notes = plantNotesFrom(plan);
    updateGeneration(ctx, (g) => {
      g.plan = plan.plan.trim();
      if (notes.length) g.plantNotes = notes;
    });
    const poor = notes.filter((n) => n.rating === 'poor');
    if (poor.length > 0 && !ctx.review) {
      const list = poor.map((n) => (n.alternative ? `${n.name} (try ${n.alternative})` : n.name)).join(', ');
      state().notify(`Plant check: ${list} ${poor.length === 1 ? "isn't a good fit" : "aren't good fits"} for this spot — see the run's plants.`, 'info');
    }

    // 2. Review: the user sees the plan and each instruction, may edit or drop some, then Sends.
    if (ctx.review) {
      patchRunInfo(generationId, { stage: 'review', slots });
      publishProgress(ctx);
      const reviewed = await awaitReview(generationId, {
        plan: plan.plan.trim(),
        plantNotes: notes,
        planSource: source,
        items: slots
          .filter((x) => x.state !== 'failed')
          .map((x) => ({ key: x.key, title: x.title, brief: x.brief, ...(x.optionLabel ? { optionLabel: x.optionLabel } : {}) })),
      });
      if (!reviewed || reviewed.length === 0) {
        if (!ctx.cancelled) cancelRun(generationId);
        return;
      }
      checkAlive(ctx);
      slots = applyReview(slots, reviewed);
    }

    // 3. Record the plan's items on the run (survives reloads).
    const hand = ctx.renderMode === 'handoff';
    const planned: PlannedVariation[] = slots.map((x) => ({
      id: x.key,
      title: x.title,
      brief: x.brief,
      ...(x.optionId ? { optionId: x.optionId } : {}),
      ...(x.optionLabel ? { optionLabel: x.optionLabel } : {}),
      status: x.state === 'failed' ? 'failed' : hand ? 'awaiting-handoff' : 'pending',
      ...(x.error ? { error: x.error } : {}),
    }));
    updateGeneration(ctx, (g) => {
      g.planned = planned;
    });
    if (hand) {
      enterHandoff(ctx, planned);
      return;
    }
    patchRunInfo(generationId, { stage: 'rendering', slots });
    publishProgress(ctx);

    // 2. Render, up to CONCURRENCY at a time; each variation succeeds or fails on its own.
    const queue = slots.filter((x) => x.state === 'pending').map((x) => x.key);
    const worker = async () => {
      for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
        if (!alive(ctx)) return;
        await renderSlot(ctx, photo, inputs, key);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (ctx.cancelled) return;
    if (!currentGeneration(ctx)) abandon(ctx);
    else if (!othersBusy(ctx)) finish(ctx);
  } catch (err) {
    closeReview(generationId);
    if (ctx.cancelled) return;
    if (!currentGeneration(ctx)) abandon(ctx);
    else if (!isAbortError(err)) failRun(ctx, errorMessage(err));
  }
}

/** Slots after the review: edited titles / instructions; items the user removed are dropped. */
function applyReview(slots: RunSlot[], reviewed: readonly ReviewItem[]): RunSlot[] {
  const byKey = new Map(reviewed.map((r) => [r.key, r]));
  return slots
    .filter((x) => byKey.has(x.key))
    .map((x) => {
      const r = byKey.get(x.key)!;
      return { ...x, title: r.title.trim() || x.title, brief: r.brief.trim() || x.brief };
    });
}

/**
 * Hand-off run: planning is over and the variations wait for the user to
 * render them in ChatGPT / Gemini. The live run ends here; the persisted
 * plan (Generation.planned) drives the companion, staging and the strip.
 */
function enterHandoff(ctx: RunContext, planned: PlannedVariation[]): void {
  ctx.active = false;
  ctx.inputs = null;
  state().setRunProgress(ctx.generationId, null);
  contexts.delete(ctx.generationId);
  forgetRunInfo(ctx.generationId);
  updateGeneration(ctx, (g) => {
    const r = rollupStatus(g);
    g.status = r.status;
    if (r.error) g.error = r.error;
    else delete g.error;
  });
  const first = planned.find((p) => p.status === 'awaiting-handoff');
  if (!first) return;
  const s = state();
  if (s.project?.id === ctx.projectId && s.selection.photoId === ctx.photoId) {
    focusHandoff({ photoId: ctx.photoId, generationId: ctx.generationId, plannedId: first.id });
  }
  const n = planned.filter((p) => p.status === 'awaiting-handoff').length;
  s.notify(
    n === 1
      ? `Ready for ${appLabel(ctx.app)} — follow the steps in the hand-off card.`
      : `${n} variations ready for ${appLabel(ctx.app)} — one at a time, each in a new chat. Do some now and the rest later if you like.`,
    'success',
  );
}

/** The run (or its project) went away mid-flight: stop and forget it. */
function abandon(ctx: RunContext): void {
  ctx.active = false;
  ctx.cancelled = true;
  ctx.inputs = null;
  ctx.controller.abort();
  state().setRunProgress(ctx.generationId, null);
  contexts.delete(ctx.generationId);
  forgetRunInfo(ctx.generationId);
  closeReview(ctx.generationId);
}

let watchingStore = false;

/**
 * Deleting a run (History, strip) or closing its project aborts its requests
 * right away. Undo / redo restore a project snapshot taken before the run
 * started (runs are recorded without history), which would silently drop an
 * in-flight run: it is put back instead, so the run keeps rendering.
 */
function watchForRemovedRuns(): void {
  if (watchingStore) return;
  watchingStore = true;
  useStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    const undoRedo = s.past.length !== prev.past.length && s.future.length !== prev.future.length;
    for (const ctx of [...contexts.values()]) {
      if (!ctx.active || currentGeneration(ctx)) continue;
      const lost =
        undoRedo && s.project?.id === ctx.projectId && findPhoto(s.project, ctx.photoId)
          ? findPhoto(prev.project, ctx.photoId)?.photo.generations.find((g) => g.id === ctx.generationId)
          : undefined;
      if (lost) s.addGeneration(ctx.photoId, lost);
      else abandon(ctx);
    }
  });
}

async function renderSlot(ctx: RunContext, photo: Photo, inputs: RenderInputs, key: string): Promise<void> {
  const { generationId } = ctx;
  const slot = getRunInfo(generationId)?.slots.find((x) => x.key === key);
  if (!slot || !slot.brief) return;
  patchSlot(generationId, key, { state: 'rendering', error: undefined });
  publishProgress(ctx);
  const signal = ctx.controller.signal;
  try {
    const result = await renderVariation(
      { image: inputs.image, mask: inputs.maskUrl, brief: slot.brief, references: inputs.references, provider: ctx.provider, quality: ctx.quality },
      signal,
    );
    checkAlive(ctx);
    const pixels = await compositeVariation(await dataUrlToBlob(result.image), inputs.base, inputs.mask);
    const [full, thumb] = await Promise.all([imageDataToBlob(pixels, 'image/jpeg', 0.9), thumbnailBlob(pixels)]);
    checkAlive(ctx);
    const imageId = newId('img');
    const thumbId = newId('img');
    await Promise.all([db.putBlob(imageId, full), db.putBlob(thumbId, thumb)]);
    if (!alive(ctx)) {
      void db.deleteBlobs([imageId, thumbId]);
      throw cancelledError();
    }
    const variation: Variation = {
      id: newId('var'),
      imageId,
      thumbId,
      width: photo.width,
      height: photo.height,
      title: slot.title || 'Variation',
      brief: slot.brief,
      favorite: false,
      createdAt: Date.now(),
    };
    if (slot.optionId) variation.optionId = slot.optionId;
    if (slot.optionLabel) variation.optionLabel = slot.optionLabel;
    variation.source = { kind: 'api', model: `${result.provider} ${result.model}`.trim() };
    state().addVariation(ctx.photoId, generationId, variation);
    if (!ctx.providerRecorded) {
      ctx.providerRecorded = true;
      updateGeneration(ctx, (g) => {
        g.provider = result.provider;
        g.model = result.model;
      });
    }
    patchSlot(generationId, key, { state: 'done', variationId: variation.id });
    patchPlanned(ctx, key, { status: 'done', variationId: variation.id, error: undefined });
  } catch (err) {
    if (ctx.cancelled || isAbortError(err)) return;
    patchSlot(generationId, key, { state: 'failed', error: errorMessage(err) });
    patchPlanned(ctx, key, { status: 'failed', error: errorMessage(err) });
  } finally {
    publishProgress(ctx);
  }
}

function finish(ctx: RunContext): void {
  const info = getRunInfo(ctx.generationId);
  const slots = info?.slots ?? [];
  const failed = slots.filter((x) => x.state === 'failed');
  const done = slots.filter((x) => x.state === 'done').length;
  ctx.active = false;
  ctx.inputs = null; // free the base pixels; a later retry prepares them again
  patchRunInfo(ctx.generationId, { stage: 'finished' });
  publishProgress(ctx);
  const total = slots.length;
  const status: Generation['status'] = failed.length === 0 ? 'done' : done > 0 ? 'partial' : 'failed';
  const firstError = failed[0]?.error ?? '';
  updateGeneration(ctx, (g) => {
    g.status = status;
    if (failed.length) g.error = `${failed.length} of ${total} variation${total === 1 ? '' : 's'} failed: ${firstError}`;
    else delete g.error;
  });
  if (status === 'failed') state().notify(`Generation failed: ${firstError}`, 'error');
  else if (status === 'partial') state().notify(`${failed.length} of ${total} variations failed — retry them from the strip.`, 'info');
}

function failRun(ctx: RunContext, message: string): void {
  ctx.active = false;
  ctx.inputs = null;
  const info = getRunInfo(ctx.generationId);
  if (info) {
    patchRunInfo(ctx.generationId, {
      stage: 'finished',
      slots: info.slots.map((x) => (x.state === 'done' ? x : { ...x, state: 'failed', error: message })),
    });
  }
  publishProgress(ctx);
  updateGeneration(ctx, (g) => {
    g.status = g.variations.length > 0 ? 'partial' : 'failed';
    g.error = message;
    for (const p of g.planned ?? []) {
      if (p.status === 'done') continue;
      p.status = 'failed';
      p.error = message;
    }
  });
  if (currentGeneration(ctx)) state().notify(`Generation failed: ${message}`, 'error');
}
