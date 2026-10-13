/**
 * Preparing a planned variation for a manual hand-off (lazily, when the user
 * opens it): the run's starting image + target mask → the engine's export
 * (crop / ratio / marker; src/handoff) → the app-specific prompt → both
 * images stored in the blob store and the pack saved on planned[i].handoff.
 *
 * The export only depends on the run (starting image, target), the app and
 * the user's ratio override, so it is computed once per run × app and shared
 * by its items; the prompt differs per item and follows what the user is
 * told to paste (marked or clean photo, the reference images the app / plan
 * allows) — it is rebuilt when those change. Decoded pixels and blobs are
 * cached in memory for the clipboard (which needs a Promise<Blob>
 * synchronously inside a click).
 *
 * The target is the run's own (frozen when it started, ./target.ts); the
 * mask the first export of a run was made with is frozen too
 * (Generation.handoffTarget), so every import composites against the
 * outline that was pasted — after a reload, a cache eviction or a scene edit.
 */
import { newId } from '../../../../shared/ids';
import type { DesignBrief, Generation, HandoffApp, HandoffPack, Photo, PlannedVariation } from '../../../../shared/types';
import { isMaskEmpty } from '../../../engine/mask';
import type { ImageDataLike, Mask } from '../../../engine/types';
import {
  buildHandoffPrompt,
  markerColorName,
  prepareHandoff,
  promptContextFromScene,
  ratioLabel,
  targetTouchesWatermark,
  type PreparedHandoff,
} from '../../../handoff';
import { blobToImageData } from '../../../lib/imageImport';
import * as db from '../../../state/persistence';
import * as runtime from '../../../state/runtime';
import { findPhoto, findVariation, useStore } from '../../../state/store';
import { resizePixels } from '../composite';
import { briefTargetIds, sceneForRun, targetFingerprint } from '../maskFromZones';
import { appLabel, findPlanned, rollupStatus, type PlannedRef } from './planned';
import { geminiPlan, pasteImage, ratioOverride } from './prefs';
import { handoffReferences, type HandoffReference } from './references';
import { handoffSession, setItemError, setJob, type ItemJob } from './session';
import { runTargetMask } from './target';

const store = () => useStore.getState();

/** Pixels a run works from: its starting image at photo size and the area that may change. */
export interface RunAssets {
  base: ImageDataLike;
  target: Mask;
  /** No targets / scope 'whole': the full frame may change. */
  wholeImage: boolean;
}

/** Small LRU of promises (decoded photos are large: keep only a few runs). */
class PromiseCache<T> {
  private map = new Map<string, Promise<T>>();
  constructor(private limit: number) {}
  get(key: string, make: () => Promise<T>): Promise<T> {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const p = make();
    this.map.set(key, p);
    p.catch(() => {
      if (this.map.get(key) === p) this.map.delete(key);
    });
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string);
    return p;
  }
  forget(prefix: string): void {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

const assetsCache = new PromiseCache<RunAssets>(3);
const exportCache = new PromiseCache<PreparedHandoff>(4);

let watchingRuns = false;

/** Deleted runs (History, strip, a deleted photo) drop their cached pixels. */
function forgetDeletedRuns(): void {
  if (watchingRuns) return;
  watchingRuns = true;
  useStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    const live = new Set<string>();
    for (const sp of s.project?.spaces ?? []) for (const ph of sp.photos) for (const g of ph.generations) live.add(g.id);
    for (const id of [...assetsCache.keys(), ...exportCache.keys().map((k) => k.split(':')[0])]) if (!live.has(id)) forgetRunCaches(id);
  });
}

function lookup(ref: PlannedRef): { photo: Photo; generation: Generation; planned: PlannedVariation } | undefined {
  const photo = findPhoto(store().project, ref.photoId)?.photo;
  const found = findPlanned(photo, ref.generationId, ref.plannedId);
  return photo && found ? { photo, generation: found.generation, planned: found.planned } : undefined;
}

export function lookupPlanned(ref: PlannedRef) {
  return lookup(ref);
}

async function loadBase(photo: Photo, g: Generation): Promise<ImageDataLike> {
  if (g.baseVariationId) {
    const v = findVariation(photo, g.baseVariationId);
    const blob = v ? await db.getBlob(v.imageId) : undefined;
    if (!blob) throw new Error('The variation this run starts from was deleted — start a new run from the original.');
    return resizePixels(await blobToImageData(blob), photo.width, photo.height);
  }
  return resizePixels(await runtime.loadPhotoImage(photo), photo.width, photo.height);
}

/**
 * Everything a run may change, at photo size: the mask its hand-off export
 * was frozen with when there is one, else its target (frozen snapshot, or
 * the live scene for runs from older saves — TargetLostError when those
 * areas are gone). The review's "What may change" preview.
 */
export async function targetMaskFor(photo: Photo, g: Pick<Generation, 'id' | 'brief' | 'target' | 'handoffTarget'>): Promise<{ mask: Mask; wholeImage: boolean }> {
  const frozen = await loadFrozenTarget(photo, g);
  return frozen ?? runTargetMask(photo, g);
}

/** The mask a run's hand-off export was frozen with (undefined when none, or when its bytes are missing). */
async function loadFrozenTarget(photo: Photo, g: Pick<Generation, 'handoffTarget'>): Promise<{ mask: Mask; wholeImage: boolean } | undefined> {
  const ht = g.handoffTarget;
  if (!ht) return undefined;
  const mask = await runtime.loadMask(ht.maskId, photo.width, photo.height).catch(() => undefined);
  if (!mask || (!ht.wholeImage && isMaskEmpty(mask))) return undefined;
  return { mask, wholeImage: ht.wholeImage };
}

function currentGeneration(photoId: string, generationId: string): Generation | undefined {
  return findPhoto(store().project, photoId)?.photo.generations.find((x) => x.id === generationId);
}

/** Starting image + target of a run (cached per run; the hand-off target once frozen). */
export function runAssets(photo: Photo, g: Generation): Promise<RunAssets> {
  forgetDeletedRuns();
  return assetsCache.get(g.id, async () => {
    const latest = currentGeneration(photo.id, g.id) ?? g;
    const [base, target] = await Promise.all([loadBase(photo, latest), targetMaskFor(photo, latest)]);
    return { base, target: target.mask, wholeImage: target.wholeImage };
  });
}

/**
 * Freezes the target a run's first hand-off export was made with
 * (Generation.handoffTarget): stored in the mask store so every later import
 * — after a reload, an LRU eviction or a scene edit — composites against
 * the outline the user pasted. The first writer wins.
 */
export async function freezeHandoffTarget(photo: Photo, g: Generation, assets: RunAssets): Promise<void> {
  const cur = currentGeneration(photo.id, g.id);
  if (!cur || (cur.handoffTarget && (await loadFrozenTarget(photo, cur)))) return;
  const maskId = newId('msk');
  runtime.setMask(maskId, assets.target);
  runtime.markMaskDirty(maskId, 0);
  await runtime.flushMasks();
  const stale = cur.handoffTarget?.maskId;
  // (Recipes also replay on the undo history: no side effects inside.)
  store().updateGeneration(photo.id, g.id, (gd) => {
    // Keep the first writer (another item of the run may have frozen it meanwhile); replace one whose bytes are gone.
    if (gd.handoffTarget && gd.handoffTarget.maskId !== stale) return;
    gd.handoffTarget = { maskId, wholeImage: assets.wholeImage, ...(gd.target ? {} : { fingerprint: targetFingerprint(gd.brief as DesignBrief, photo.scene) }) };
  });
  if (currentGeneration(photo.id, g.id)?.handoffTarget?.maskId === maskId) {
    if (stale) void db.deleteMasks([stale]);
  } else {
    runtime.forgetMasks([maskId]);
    void db.deleteMasks([maskId]);
  }
}

/**
 * Runs from older saves (no frozen snapshot): whether the live outline
 * differs from the one their hand-off was prepared with — the companion
 * offers to prepare it again.
 */
export function targetOutlineChanged(photo: Photo | undefined, g: Pick<Generation, 'brief' | 'target' | 'handoffTarget'>): boolean {
  const fp = g.handoffTarget?.fingerprint;
  return !!photo && !g.target && !!fp && fp !== targetFingerprint(g.brief, photo.scene);
}

/** The engine's export of a run for one app (cached per run × app × ratio override). */
export function preparedExport(photo: Photo, g: Generation, app: HandoffApp): Promise<PreparedHandoff> {
  const ratios = ratioOverride(app);
  return exportCache.get(`${g.id}:${app}:${ratios.map((r) => r.label).join(',')}`, async () => {
    const assets = await runAssets(photo, g);
    return prepareHandoff(assets.base, assets.target, { app, ...(ratios.length ? { ratios } : {}), ...(assets.wholeImage ? { fullFrame: true } : {}) });
  });
}

/**
 * Whether Gemini's bottom-right sparkle would survive the composite: the
 * run's composite band reaches that corner of the exported frame (or the
 * whole image may change). Other apps: false.
 */
export async function watermarkRisk(photo: Photo, g: Generation, pack: Pick<HandoffPack, 'app' | 'crop'>): Promise<boolean> {
  if (pack.app !== 'gemini') return false;
  const assets = await runAssets(photo, g);
  return assets.wholeImage || targetTouchesWatermark(assets.target, pack.crop);
}

/** Forget cached pixels of a run (e.g. after the run was deleted). */
export function forgetRunCaches(generationId: string): void {
  assetsCache.forget(generationId);
  exportCache.forget(`${generationId}:`);
}

/** What the prompt needs to know about the exported frame. */
export interface FrameInfo {
  ratio: string;
  /** The engine's marker colour name ("magenta"); '' = no marker (whole image) → no outline wording. */
  markerColorName: string;
  /** Exported region of the photo (position words are relative to it). */
  crop: HandoffPack['crop'];
}

export interface PackPromptOptions {
  strictness?: NonNullable<DesignBrief['strictness']>;
  /** Roles of the reference images the user is told to paste (Image 2, 3, …), in order. */
  references?: readonly string[];
  /** The user pastes the clean export: name the area in words only. */
  unmarked?: boolean;
}

/** The app-specific prompt for one planned item. */
export function packPrompt(
  photo: Photo,
  g: Generation,
  planned: Pick<PlannedVariation, 'brief'>,
  app: HandoffApp,
  frame: FrameInfo,
  opts: PackPromptOptions = {},
): string {
  // The run's own areas (frozen when it started) under their own ids, whatever the live scene became.
  const scene = sceneForRun(photo.scene, g);
  const targetZoneIds = briefTargetIds(g.brief, scene).zoneIds;
  const ctx = promptContextFromScene(
    scene,
    g.brief,
    targetZoneIds,
    { app, instruction: planned.brief, ratio: frame.ratio, markerColorName: frame.markerColorName, references: (opts.references ?? []).map((role) => ({ role })) },
    // Position words and visibility are relative to the exported crop of the photo.
    { view: frame.crop, frame: { width: photo.width, height: photo.height }, roomZoneIds: g.target?.room?.zones.map((z) => z.id) ?? [] },
  );
  return buildHandoffPrompt({
    ...ctx,
    ...(opts.strictness ? { strictness: opts.strictness } : {}),
    ...(opts.unmarked && ctx.markerColorName ? { unmarked: true } : {}),
  });
}

/** The reference images a run's hand-off to `app` carries now (brief picks; none for Gemini without a Google AI plan). */
export function currentReferences(g: Pick<Generation, 'brief'>, app: HandoffApp): HandoffReference[] {
  return handoffReferences(store().project?.ideaBoard ?? [], g.brief, app, geminiPlan());
}

/** The strict sentence of either template (packs saved before `strictness` was recorded). */
const STRICT_SENTENCE = /Change nothing beyond this request|Make exactly this change and nothing more/;

// ---------------------------------------------------------------------------
// Blobs (memory first: the clipboard wants them without waiting on IndexedDB)
// ---------------------------------------------------------------------------

const blobMemo = new Map<string, Blob>();
const pngMemo = new Map<string, Promise<Blob>>();

function remember(id: string, blob: Blob): void {
  blobMemo.set(id, blob);
  if (blobMemo.size > 24) blobMemo.delete(blobMemo.keys().next().value as string);
}

export async function packBlob(id: string): Promise<Blob> {
  const hit = blobMemo.get(id);
  if (hit) return hit;
  const blob = await db.getBlob(id);
  if (!blob) throw new Error('The prepared image is missing from storage — reopen this hand-off to prepare it again.');
  remember(id, blob);
  return blob;
}

/** PNG copy of a stored image (the only image type every browser's clipboard accepts). */
export function packPng(id: string): Promise<Blob> {
  let p = pngMemo.get(id);
  if (!p) {
    p = packBlob(id).then(toPng);
    pngMemo.set(id, p);
    p.catch(() => pngMemo.delete(id));
    if (pngMemo.size > 12) pngMemo.delete(pngMemo.keys().next().value as string);
  }
  return p;
}

export async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      c.getContext('2d')!.drawImage(bitmap, 0, 0);
      return await c.convertToBlob({ type: 'image/png' });
    }
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')!.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))), 'image/png'));
  } finally {
    bitmap.close();
  }
}

/** Starts the PNG conversion early so a later click finds it ready. */
export function warmPack(pack: HandoffPack): void {
  void packPng(pack.markedImageId).catch(() => undefined);
  void packPng(pack.cleanImageId).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<HandoffPack>>();

/**
 * Preparation tokens per item: dropPack bumps it, so a preparation started
 * for the old app (switching apps while the photo is being prepared) never
 * saves its pack — it joins a fresh preparation for the new app instead.
 */
const packGen = new Map<string, number>();
const genOf = (plannedId: string) => packGen.get(plannedId) ?? 0;

export interface EnsurePackOptions {
  /** Prepare for this app (default: the item's pack app, else the Studio's hand-off app). */
  app?: HandoffApp;
  /** Rebuild the prompt with this strictness (keeps the images). */
  strictness?: NonNullable<DesignBrief['strictness']>;
}

async function blobsExist(pack: HandoffPack): Promise<boolean> {
  if (blobMemo.has(pack.markedImageId) && blobMemo.has(pack.cleanImageId)) return true;
  const [a, b] = await Promise.all([db.getBlob(pack.markedImageId), db.getBlob(pack.cleanImageId)]);
  if (a) remember(pack.markedImageId, a);
  if (b) remember(pack.cleanImageId, b);
  return !!a && !!b;
}

const finished = (p: Pick<PlannedVariation, 'status'>) => p.status === 'done' || p.status === 'rejected';

/**
 * The item's hand-off pack, prepared now when missing (or for another app /
 * strictness). Concurrent calls for the same item, app and preferences share
 * one preparation.
 */
export function ensurePack(ref: PlannedRef, opts: EnsurePackOptions = {}): Promise<HandoffPack> {
  // The app this call resolves to (not only an explicit one): a switch of app starts a fresh preparation.
  const app = opts.app ?? lookup(ref)?.planned.handoff?.app ?? store().studio.handoffApp;
  const gen = genOf(ref.plannedId);
  // The prompt also follows the paste / plan preferences: a change starts a fresh preparation.
  const key = `${ref.plannedId}:${gen}:${app}:${opts.strictness ?? ''}:${pasteImage()}:${geminiPlan() ?? ''}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = buildPack(ref, opts, gen).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function buildPack(ref: PlannedRef, opts: EnsurePackOptions, gen: number): Promise<HandoffPack> {
  const stale = () => genOf(ref.plannedId) !== gen;
  const found = lookup(ref);
  if (!found) throw new Error('This hand-off is no longer in the project.');
  const { photo, generation, planned } = found;
  if (finished(planned)) throw new Error('This hand-off is already finished.');
  const existing = planned.handoff;
  const app = opts.app ?? existing?.app ?? store().studio.handoffApp;

  // What the user is told to paste right now: the references and the marked / clean photo.
  const references = currentReferences(generation, app).map((r) => r.role);
  const unmarked = pasteImage() === 'clean';

  // Same app, images still stored: reuse — only the prompt may change (strictness, references, marked/clean).
  if (existing && existing.app === app && (await blobsExist(existing))) {
    const strictness = opts.strictness ?? existing.strictness ?? (STRICT_SENTENCE.test(existing.prompt) ? 'strict' : undefined);
    const frame: FrameInfo = { ratio: existing.ratio ?? ratioLabel(existing.outW, existing.outH), markerColorName: markerColorName(existing.markerColor), crop: existing.crop };
    const prompt = packPrompt(photo, generation, planned, app, frame, { strictness, references, unmarked });
    const next: HandoffPack = { ...existing, prompt, ratio: frame.ratio, strictness: strictness ?? generation.brief.strictness ?? 'balanced' };
    // Switched to the other app meanwhile: join the fresh preparation for it.
    if (stale()) return ensurePack(ref, opts);
    if (next.prompt !== existing.prompt || next.ratio !== existing.ratio || next.strictness !== existing.strictness) savePack(ref, next);
    return next;
  }

  setItemError(ref.plannedId, null);
  // Never clobber an import's spinner (importInto prepares a missing pack while its job shows).
  const prev = handoffSession().jobs[ref.plannedId];
  let job: ItemJob | null = null;
  if (prev?.kind !== 'importing') {
    job = { kind: 'preparing', message: `Preparing the photo for ${appLabel(app)}…` };
    setJob(ref.plannedId, job);
  }
  try {
    const prepared = await preparedExport(photo, generation, app);
    // Strictness defaults to the run's brief (promptContextFromScene reads it); the marker name is the engine's.
    const frame: FrameInfo = { ratio: prepared.ratio, markerColorName: prepared.markerColorName, crop: prepared.crop };
    const prompt = packPrompt(photo, generation, planned, app, frame, { strictness: opts.strictness, references, unmarked });
    const cleanImageId = newId('img');
    const markedImageId = newId('img');
    await Promise.all([db.putBlob(cleanImageId, prepared.clean), db.putBlob(markedImageId, prepared.marked)]);
    // Every import of this run composites against the outline this export shows.
    await freezeHandoffTarget(photo, generation, await runAssets(photo, generation));
    if (stale()) {
      // The item moved to the other app while this was prepared: drop it and join the new preparation.
      void db.deleteBlobs([cleanImageId, markedImageId]);
      return ensurePack(ref, opts);
    }
    remember(cleanImageId, prepared.clean);
    remember(markedImageId, prepared.marked);
    const pack: HandoffPack = {
      app,
      prompt,
      crop: prepared.crop,
      outW: prepared.outW,
      outH: prepared.outH,
      markerColor: prepared.markerColor,
      ratio: prepared.ratio,
      strictness: opts.strictness ?? generation.brief.strictness ?? 'balanced',
      cleanImageId,
      markedImageId,
      createdAt: Date.now(),
    };
    // The item may have been deleted, accepted or skipped (or prepared by someone else) meanwhile.
    const still = lookup(ref);
    if (!still || finished(still.planned)) {
      void db.deleteBlobs([cleanImageId, markedImageId]);
      throw new Error(still ? 'This hand-off is already finished.' : 'This hand-off is no longer in the project.');
    }
    const old = still.planned.handoff;
    if (!savePack(ref, pack)) {
      void db.deleteBlobs([cleanImageId, markedImageId]);
      throw new Error('This hand-off is already finished.');
    }
    if (old && old.cleanImageId !== cleanImageId) void db.deleteBlobs([old.cleanImageId, old.markedImageId]);
    warmPack(pack);
    return pack;
  } catch (err) {
    if (!stale()) setItemError(ref.plannedId, (err as Error).message || 'Could not prepare this hand-off.');
    throw err;
  } finally {
    // Only clear the spinner this call put up: an import's, or the new app's preparation (which replaced it), stays.
    if (job && handoffSession().jobs[ref.plannedId] === job) setJob(ref.plannedId, null);
  }
}

/** Saves a pack on its item; false (nothing written) when the item is gone or already finished. */
function savePack(ref: PlannedRef, pack: HandoffPack): boolean {
  store().updateGeneration(ref.photoId, ref.generationId, (g) => {
    const p = g.planned?.find((x) => x.id === ref.plannedId);
    // A late preparation never re-attaches images to an accepted or skipped item.
    if (!p || finished(p)) return;
    p.handoff = pack;
    if (p.status !== 'failed') return;
    // A failed hand-off that could be prepared now waits for the user again.
    p.status = 'awaiting-handoff';
    delete p.error;
    const r = rollupStatus(g as Generation);
    g.status = r.status;
    if (r.error) g.error = r.error;
    else delete g.error;
  });
  return lookup(ref)?.planned.handoff?.cleanImageId === pack.cleanImageId;
}

/**
 * Drops an item's prepared pack (e.g. switching apps); it is prepared again
 * when opened. Also invalidates a preparation still in flight for it.
 */
export function dropPack(ref: PlannedRef): void {
  packGen.set(ref.plannedId, genOf(ref.plannedId) + 1);
  const found = lookup(ref);
  const pack = found?.planned.handoff;
  if (!pack) return;
  store().updateGeneration(ref.photoId, ref.generationId, (g) => {
    const p = g.planned?.find((x) => x.id === ref.plannedId);
    if (p) delete p.handoff;
  });
  void db.deleteBlobs([pack.cleanImageId, pack.markedImageId]);
}

/**
 * Projects saved before finished items released their exports: drops the
 * packs (and their images) still kept on accepted or skipped items.
 * Returns how many were removed.
 */
export function sweepFinishedPacks(): number {
  const project = store().project;
  const stale: { photoId: string; generationId: string; ids: string[] }[] = [];
  for (const sp of project?.spaces ?? []) {
    for (const ph of sp.photos) {
      for (const g of ph.generations) {
        const ids = (g.planned ?? []).filter((p) => finished(p) && p.handoff).flatMap((p) => [p.handoff!.cleanImageId, p.handoff!.markedImageId]);
        if (ids.length) stale.push({ photoId: ph.id, generationId: g.id, ids });
      }
    }
  }
  for (const r of stale) {
    store().updateGeneration(r.photoId, r.generationId, (g) => {
      for (const p of g.planned ?? []) if (finished(p)) delete p.handoff;
    });
    void db.deleteBlobs(r.ids);
  }
  return stale.reduce((n, r) => n + r.ids.length / 2, 0);
}

/**
 * Prepares a run's waiting items again with its current outline (runs from
 * older saves whose outline changed since their hand-off was prepared):
 * the frozen target is released and every waiting item's pack dropped.
 */
export function reprepareRun(photoId: string, generationId: string): void {
  const g = currentGeneration(photoId, generationId);
  if (!g) return;
  const frozen = g.handoffTarget?.maskId;
  store().updateGeneration(photoId, generationId, (gd) => void delete gd.handoffTarget);
  if (frozen) {
    runtime.forgetMasks([frozen]);
    void db.deleteMasks([frozen]);
  }
  forgetRunCaches(generationId);
  for (const p of g.planned ?? []) if (p.status === 'awaiting-handoff') dropPack({ photoId, generationId, plannedId: p.id });
}
