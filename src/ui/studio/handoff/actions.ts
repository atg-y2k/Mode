/**
 * Hand-off actions: open an item in the companion, bring a returned image
 * back (align + protect + stage), accept / reject / skip / retry stricter,
 * and switch waiting items to the other app. Every change to a planned item
 * goes through the store (persisted) and re-rolls the run's status.
 */
import type { Draft } from 'immer';
import { newId } from '../../../../shared/ids';
import type { Generation, HandoffApp, HandoffPack, HandoffPackGeometry, PlannedVariation, Variation } from '../../../../shared/types';
import { importHandoffResult, targetTouchesWatermark, type ImportProgress } from '../../../handoff';
import { imageDataToBlob } from '../../../lib/imageImport';
import * as db from '../../../state/persistence';
import { findPhoto, useStore } from '../../../state/store';
import { firstPendingPlanned } from '../panels/historyTree';
import { thumbnailBlob } from '../composite';
import { errorMessage, retryRun } from '../generate';
import { readHandoffLog, wasSent, type HandoffLogEntry } from './log';
import { dropPack, ensurePack, lookupPlanned, runAssets, warmPack } from './pack';
import { appLabel, assignTargets, isPending, projectPendingHandoffs, rollupStatus, sameRef, type PendingItem, type PlannedRef } from './planned';
import { focusHandoff, handoffSession, setExtras, setHandoffSession, setItemError, setJob } from './session';
import { runCoreMask } from './target';

const store = () => useStore.getState();

function withPlanned(ref: PlannedRef, recipe: (p: Draft<PlannedVariation>, g: Draft<Generation>) => void): void {
  store().updateGeneration(ref.photoId, ref.generationId, (g) => {
    const p = g.planned?.find((x) => x.id === ref.plannedId);
    if (!p) return;
    recipe(p, g);
    const r = rollupStatus(g as Generation);
    g.status = r.status;
    if (r.error) g.error = r.error;
    else delete g.error;
  });
}

/** Pending items of the project, the active photo's first. */
export function pendingItems(): PendingItem[] {
  const s = store();
  return projectPendingHandoffs(s.project, s.selection.photoId);
}

/** The item after `ref` that still waits for a hand-off (same run first). */
export function nextWaiting(ref: PlannedRef | null): PendingItem | undefined {
  const items = pendingItems().filter((i) => i.planned.status === 'awaiting-handoff' && !sameRef(i, ref));
  return items.find((i) => i.generationId === ref?.generationId) ?? items[0];
}

/** Shows an item in the companion and prepares its pack in the background. */
export function openHandoff(ref: PlannedRef, opts: { open?: boolean } = {}): void {
  const s = store();
  if (s.selection.photoId !== ref.photoId && findPhoto(s.project, ref.photoId)) s.selectPhoto(ref.photoId);
  focusHandoff(ref, opts);
  const found = lookupPlanned(ref);
  if (found?.planned.status === 'awaiting-handoff' || (found?.planned.status === 'failed' && found.generation.renderMode === 'handoff')) {
    void ensurePack(ref)
      .then(warmPack)
      .catch(() => undefined); // the companion shows the item's error
  } else if (found?.planned.status === 'staged') {
    openStaging(ref);
  }
}

/**
 * Opens the companion on a run's pending items (History → "Open hand-off",
 * via the `mode:open-handoff` event): its first item still waiting for a
 * hand-off, else the first one waiting in staging. False when the run is
 * gone or has nothing pending.
 */
export function openRunHandoff(generationId: string): boolean {
  const project = store().project;
  for (const sp of project?.spaces ?? []) {
    for (const ph of sp.photos) {
      const g = ph.generations.find((x) => x.id === generationId);
      if (!g) continue;
      const plannedId = firstPendingPlanned(g);
      if (!plannedId) return false;
      openHandoff({ photoId: ph.id, generationId, plannedId });
      return true;
    }
  }
  return false;
}

export function openStaging(ref: PlannedRef): void {
  const s = store();
  if (s.selection.photoId !== ref.photoId) s.selectPhoto(ref.photoId);
  s.setStudio({ gridGenerationId: null });
  setHandoffSession({ staging: ref, active: ref });
}

export function closeStaging(): void {
  setHandoffSession({ staging: null });
}

/**
 * Retry a hand-off that failed: prepare it again — or, when the plan never
 * produced its instruction (an option the planner left out), run the brief again.
 */
export function retryPrepare(ref: PlannedRef): void {
  const found = lookupPlanned(ref);
  if (!found) return;
  if (!found.planned.brief.trim()) {
    void retryRun(ref.generationId).catch((err: Error) => store().notify(errorMessage(err), 'error'));
    return;
  }
  setItemError(ref.plannedId, null);
  openHandoff(ref);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const MAX_IMPORT_BYTES = 40 * 1024 * 1024;

/** Staged progress messages of an import (importHandoffResult's onProgress). */
export const IMPORT_STAGES: Record<ImportProgress, string> = {
  loading: 'Reading the image (the first import also loads the alignment engine)…',
  aligning: 'Lining the result up with your photo…',
  compositing: 'Protecting everything outside the outline…',
};

function looksLikeImage(blob: Blob): boolean {
  return blob.type === '' || blob.type.startsWith('image/');
}

/** A pack whose outline no longer matches the run's target (prepared before the area changed). */
export const OUTLINE_CHANGED_MESSAGE =
  'The outlined area of this run changed since it was prepared. Prepare it again (the new photo will show the current outline) before bringing an image back.';

class OutlineChangedError extends Error {}

/** What an import needs from a pack: where the export came from and how it was framed. */
type ImportGeometry = Pick<HandoffPack, 'app' | 'crop' | 'outW' | 'outH' | 'markerColor'>;

/** Items being imported right now (the re-entrancy guard; the jobs map is only for the spinner). */
const importing = new Set<string>();

/** Whether the item was sent to an app other than `prev.app` after its waiting items were switched. */
function sentAfterSwitch(log: readonly HandoffLogEntry[], plannedId: string, prev: HandoffPackGeometry): boolean {
  return log.some((e) => e.plannedId === plannedId && e.app !== prev.app && e.at >= prev.switchedAt);
}

/** Aspect ratio of a returned image (null when it can't be read here). */
async function imageAspect(blob: Blob): Promise<number | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const aspect = bitmap.width / Math.max(1, bitmap.height);
    bitmap.close();
    return aspect;
  } catch {
    return null;
  }
}

/**
 * The pack a returned image was made from. An item that was already sent
 * when its waiting items moved to the other app keeps that pack's geometry
 * (handoffPrev): the result comes from the old app — unless the item was
 * sent to the new app too; then the image's aspect picks the closer export.
 */
async function packForImport(ref: PlannedRef, planned: PlannedVariation, blob: Blob): Promise<ImportGeometry> {
  const prev = planned.handoffPrev;
  if (prev && !sentAfterSwitch(readHandoffLog(), planned.id, prev)) return prev;
  const current = planned.handoff ?? (await ensurePack(ref));
  if (!prev) return current;
  const aspect = await imageAspect(blob);
  if (aspect === null) return current;
  const off = (g: ImportGeometry) => Math.abs(Math.log(aspect / (g.outW / Math.max(1, g.outH))));
  return off(prev) < off(current) ? prev : current;
}

/** Long edge of the persisted change map (the heatmap after a reload). */
const CHANGE_MAP_EDGE = 256;

/** The outside-change map as a small grayscale PNG for the blob store (null when it can't be encoded here). */
async function changeMapPng(map: { width: number; height: number; data: Uint8Array }): Promise<Blob | null> {
  if (map.width <= 0 || map.height <= 0) return null;
  const k = Math.min(1, CHANGE_MAP_EDGE / Math.max(map.width, map.height));
  const w = Math.max(1, Math.round(map.width * k));
  const h = Math.max(1, Math.round(map.height * k));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(map.height - 1, Math.floor(y / k));
    for (let x = 0; x < w; x++) {
      const v = map.data[sy * map.width + Math.min(map.width - 1, Math.floor(x / k))];
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  try {
    return await imageDataToBlob({ width: w, height: h, data }, 'image/png');
  } catch {
    return null;
  }
}

/** Blob ids a staged result owns (image, thumb, change map). */
export function stagedBlobIds(staged: PlannedVariation['staged']): string[] {
  if (!staged) return [];
  return [staged.imageId, staged.thumbId, ...(staged.review?.changeMapId ? [staged.review.changeMapId] : [])];
}

/**
 * Lines a returned image up with the photo and stages it on the item:
 * the composite (original outside the target) becomes the staged result,
 * replacing an earlier one. The target is the run's frozen one — the
 * outline the user pasted — and the pack the one the image came from
 * (packForImport). Returns false when it failed (shown on the item).
 */
export async function importInto(ref: PlannedRef, blob: Blob, origin?: string): Promise<boolean> {
  const found = lookupPlanned(ref);
  if (!found) return false;
  if (!looksLikeImage(blob)) {
    store().notify("That file isn't an image — bring back the picture ChatGPT or Gemini made (PNG, JPEG or WebP).", 'error');
    return false;
  }
  if (blob.size > MAX_IMPORT_BYTES) {
    store().notify('That image is too large to import (over 40 MB).', 'error');
    return false;
  }
  // Checked and set before any await: a second paste / drop / Downloads file for this item waits its turn.
  if (importing.has(ref.plannedId)) {
    store().notify(`Still lining up the previous image for “${found.planned.title}” — try again in a moment.`, 'info');
    return false;
  }
  importing.add(ref.plannedId);
  setItemError(ref.plannedId, null);
  setJob(ref.plannedId, { kind: 'importing', message: IMPORT_STAGES.loading });
  let ids: string[] = [];
  try {
    const pack = await packForImport(ref, found.planned, blob);
    setJob(ref.plannedId, { kind: 'importing', message: IMPORT_STAGES.loading });
    const { photo, generation } = lookupPlanned(ref) ?? found;
    const assets = await runAssets(photo, generation);
    // A pack drawn with an outline is never composited as a whole-image edit.
    if (assets.wholeImage && pack.markerColor) throw new OutlineChangedError(OUTLINE_CHANGED_MESSAGE);
    // With room beside a wider / curvier element, the wrong-image check looks at the element's own area.
    const inside = await runCoreMask(photo, generation).catch(() => null);
    const result = await importHandoffResult(
      photo,
      assets.base,
      assets.target,
      pack,
      blob,
      undefined,
      (stage) => setJob(ref.plannedId, { kind: 'importing', message: IMPORT_STAGES[stage] ?? IMPORT_STAGES.aligning }),
      { inside },
    );
    setJob(ref.plannedId, { kind: 'importing', message: 'Saving the result…' });
    const [full, thumb, map] = await Promise.all([
      imageDataToBlob(result.composite, 'image/jpeg', 0.9),
      thumbnailBlob(result.composite),
      changeMapPng(result.outsideChangeMap),
    ]);
    const imageId = newId('img');
    const thumbId = newId('img');
    const changeMapId = map ? newId('img') : undefined;
    ids = [imageId, thumbId, ...(changeMapId ? [changeMapId] : [])];
    await Promise.all([db.putBlob(imageId, full), db.putBlob(thumbId, thumb), ...(map && changeMapId ? [db.putBlob(changeMapId, map)] : [])]);
    const still = lookupPlanned(ref);
    if (!still || still.planned.status === 'done' || still.planned.status === 'rejected') {
      void db.deleteBlobs(ids);
      return false;
    }
    const unchanged = !!result.insideCheck?.unchanged;
    // Gemini's sparkle survives only where the composite keeps the returned pixels.
    const watermark = pack.app === 'gemini' && (assets.wholeImage || targetTouchesWatermark(assets.target, pack.crop));
    const alignNote = result.report.aligned ? '' : result.alignNote || '';
    const old = still.planned.staged;
    withPlanned(ref, (p) => {
      p.status = 'staged';
      p.staged = {
        imageId,
        thumbId,
        source: { kind: 'handoff', app: pack.app, importedAt: Date.now(), alignment: result.report },
        // Persisted: after a reload staging still flags a wrong image (and asks before keeping it) and shows the evidence.
        checks: {
          unchanged,
          watermark,
          ...(result.insideCheck ? { insideMedian: result.insideCheck.medianInside, outsideMedian: result.insideCheck.medianOutside } : {}),
        },
        review: { ...(changeMapId ? { changeMapId } : {}), blobs: result.outsideBlobs, ...(alignNote ? { alignNote } : {}) },
      };
      delete p.error;
    });
    if (old) void db.deleteBlobs(stagedBlobIds(old));
    setExtras(ref.plannedId, { changeMap: result.outsideChangeMap, blobs: result.outsideBlobs, alignNote, unchanged, watermark });
    openStaging(ref);
    if (unchanged) store().notify(UNCHANGED_MESSAGE, 'error');
    else if (origin) store().notify(origin, 'info');
    return true;
  } catch (err) {
    if (ids.length) void db.deleteBlobs(ids);
    const message = errorMessage(err);
    // Prepared with an outline the run no longer has: "Try again" prepares it afresh.
    if (err instanceof OutlineChangedError) dropPack(ref);
    setItemError(ref.plannedId, message);
    store().notify(`Couldn't import that image: ${message}`, 'error');
    return false;
  } finally {
    importing.delete(ref.plannedId);
    setJob(ref.plannedId, null);
  }
}

/** Wrong-image check (Gemini's "Download full size" sometimes saves the uploaded original or an older image). */
export const UNCHANGED_MESSAGE = 'This looks like your original or an older image — nothing changed in the area.';

/**
 * Returned images from a paste / drop / file picker / Downloads: one image
 * goes to the active item (replacing its staged result), else the first
 * waiting one; several fill the waiting items in order (the active item's
 * run first) and never replace a result already back (assignTargets).
 * Imports run one after another.
 * `preferWaiting`: skip an active item that is already back (staged).
 */
export async function importBlobs(blobs: Blob[], origin?: string, opts: { preferWaiting?: boolean } = {}): Promise<number> {
  const images = blobs.filter(looksLikeImage);
  if (images.length === 0) {
    if (blobs.length) store().notify("That isn't an image — bring back the picture ChatGPT or Gemini made.", 'error');
    return 0;
  }
  const items = pendingItems();
  let active = handoffSession().active;
  // A file that turns up by itself (Downloads) never replaces a result already waiting for review.
  if (opts.preferWaiting && active && items.find((i) => sameRef(i, active))?.planned.status === 'staged') active = null;
  const targets = assignTargets(items, active, images.length).filter((t) => !opts.preferWaiting || t.planned.status === 'awaiting-handoff');
  if (targets.length === 0) {
    store().notify('No hand-off is waiting for an image right now.', 'info');
    return 0;
  }
  if (images.length > targets.length) {
    store().notify(`${images.length} images but only ${targets.length} waiting variation${targets.length === 1 ? '' : 's'} — the extra ones were ignored.`, 'info');
  } else if (images.length > 1) {
    store().notify(`Importing ${images.length} images in order: ${targets.map((t) => `“${t.planned.title}”`).join(', ')}.`, 'info');
  }
  let ok = 0;
  for (let i = 0; i < targets.length; i++) {
    if (await importInto(targets[i], images[i], i === 0 ? origin : undefined)) ok++;
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Staging decisions
// ---------------------------------------------------------------------------

/**
 * Accept: the staged result becomes a variation of the run (with its
 * provenance) and is shown; the item's hand-off exports are freed. A result
 * flagged as unchanged (the original or an older image came back) is only
 * kept with `force` (staging asks first). Returns whether it was accepted.
 */
export function acceptStaged(ref: PlannedRef, opts: { force?: boolean } = {}): boolean {
  const found = lookupPlanned(ref);
  const staged = found?.planned.staged;
  if (!found || !staged || found.planned.status !== 'staged') return false;
  if (staged.checks?.unchanged && !opts.force) {
    store().notify(`${UNCHANGED_MESSAGE} Confirm in the review to keep it anyway.`, 'error');
    return false;
  }
  const { photo, planned } = found;
  const pack = planned.handoff;
  const variation: Variation = {
    id: newId('var'),
    imageId: staged.imageId,
    thumbId: staged.thumbId,
    width: photo.width,
    height: photo.height,
    title: planned.title || 'Variation',
    brief: planned.brief,
    favorite: false,
    createdAt: Date.now(),
    source: staged.source,
    ...(planned.optionId ? { optionId: planned.optionId } : {}),
    ...(planned.optionLabel ? { optionLabel: planned.optionLabel } : {}),
  };
  const s = store();
  s.addVariation(ref.photoId, ref.generationId, variation);
  withPlanned(ref, (p) => {
    p.status = 'done';
    p.variationId = variation.id;
    delete p.staged;
    delete p.handoff;
    delete p.handoffPrev;
    delete p.error;
  });
  // The exports were only for pasting; the variation keeps its provenance. The change map isn't kept either.
  void db.deleteBlobs([...(pack ? [pack.cleanImageId, pack.markedImageId] : []), ...(staged.review?.changeMapId ? [staged.review.changeMapId] : [])]);
  setExtras(ref.plannedId, null);
  setHandoffSession({ staging: null });
  s.setStudio({ viewVariationId: variation.id, gridGenerationId: null });
  advanceAfter(ref, `“${variation.title}” added to your variations.`);
  return true;
}

/** Moves the companion on to the next waiting item, or closes it when everything is back. */
function advanceAfter(ref: PlannedRef, message: string): void {
  const next = nextWaiting(ref);
  const s = store();
  if (next) {
    // Phones: the card would cover the result just accepted — fold it to its pill.
    const phone = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 639px)').matches;
    openHandoff(next, { open: !phone && handoffSession().companion !== 'closed' });
    if (phone || handoffSession().companion === 'closed') setHandoffSession({ companion: 'collapsed' });
    s.notify(`${message} Next: “${next.planned.title}”.`, 'success');
    return;
  }
  const staged = pendingItems().find((i) => i.planned.status === 'staged');
  if (staged) {
    setHandoffSession({ active: staged });
    s.notify(`${message} “${staged.planned.title}” is waiting for your review.`, 'success');
    return;
  }
  setHandoffSession({ active: null, companion: 'closed' });
  s.notify(`${message} All hand-offs are back.`, 'success');
}

/** Reject: discard the staged image; the item waits for another try (new chat recommended). */
export function rejectStaged(ref: PlannedRef): void {
  const found = lookupPlanned(ref);
  const staged = found?.planned.staged;
  if (!found || !staged) return;
  withPlanned(ref, (p) => {
    p.status = 'awaiting-handoff';
    delete p.staged;
    // The next try goes to the item's current app.
    delete p.handoffPrev;
  });
  void db.deleteBlobs(stagedBlobIds(staged));
  setExtras(ref.plannedId, null);
  setHandoffSession({ staging: null });
  openHandoff(ref);
  store().notify('Result discarded. Try again in a new chat, or skip this variation.', 'info');
}

/** Skip: the user doesn't want this variation (staged result and hand-off exports discarded). */
export function skipPlanned(ref: PlannedRef): void {
  const found = lookupPlanned(ref);
  if (!found || !isPending(found.planned)) return;
  const staged = found.planned.staged;
  const pack = found.planned.handoff;
  withPlanned(ref, (p) => {
    p.status = 'rejected';
    delete p.staged;
    delete p.handoff;
    delete p.handoffPrev;
  });
  void db.deleteBlobs([...stagedBlobIds(staged), ...(pack ? [pack.cleanImageId, pack.markedImageId] : [])]);
  setExtras(ref.plannedId, null);
  if (sameRef(handoffSession().staging, ref)) setHandoffSession({ staging: null });
  advanceAfter(ref, `Skipped “${found.planned.title}”.`);
}

/**
 * Retry with a stricter prompt: the staged result is discarded and the item's
 * prompt rebuilt with strictness 'strict'; the companion opens on it.
 */
export async function retryStricter(ref: PlannedRef): Promise<void> {
  const found = lookupPlanned(ref);
  if (!found) return;
  const staged = found.planned.staged;
  const before = found.planned.handoff?.prompt;
  withPlanned(ref, (p) => {
    p.status = 'awaiting-handoff';
    delete p.staged;
    delete p.handoffPrev;
  });
  void db.deleteBlobs(stagedBlobIds(staged));
  setExtras(ref.plannedId, null);
  setHandoffSession({ staging: null });
  focusHandoff(ref);
  try {
    const pack = await ensurePack(ref, { strictness: 'strict' });
    store().notify(
      pack.prompt === before ? 'Ready to try again — start a new chat with the same prompt, then bring the result back.' : 'Stricter prompt ready — start a new chat with it, then bring the result back.',
      'success',
    );
  } catch (err) {
    store().notify(`Couldn't prepare the stricter prompt: ${errorMessage(err)}`, 'error');
  }
}

/**
 * When one app hits its limits: every item still waiting for a hand-off
 * (all photos) is prepared for the other app instead. Items already back
 * (staged) keep their app. Also makes it the Studio's hand-off app.
 */
export function switchPendingApp(app: HandoffApp): number {
  const s = store();
  s.setStudio({ handoffApp: app });
  const log = readHandoffLog();
  const moved = pendingItems().filter((i) => i.planned.status === 'awaiting-handoff' && i.planned.handoff?.app !== app);
  for (const item of moved) {
    const pack = item.planned.handoff;
    // Already pasted into the old app: its result may still come back from there — keep how that export was framed.
    if (pack && log.some((e) => e.plannedId === item.plannedId && e.app === pack.app)) {
      const prev: HandoffPackGeometry = {
        app: pack.app,
        crop: { ...pack.crop },
        outW: pack.outW,
        outH: pack.outH,
        markerColor: pack.markerColor,
        ...(pack.ratio ? { ratio: pack.ratio } : {}),
        switchedAt: Date.now(),
      };
      store().updateGeneration(item.photoId, item.generationId, (g) => {
        const p = g.planned?.find((x) => x.id === item.plannedId);
        if (p) p.handoffPrev = prev;
      });
    }
    // Prepared again for the new app when opened (the companion does it for the active one); also cancels a preparation in flight.
    dropPack(item);
  }
  relabelRuns(moved, app);
  if (moved.length > 0) s.notify(`${moved.length} waiting variation${moved.length === 1 ? '' : 's'} moved to ${appLabel(app)}.`, 'success');
  return moved.length;
}

/** Runs record the app they hand off to (History shows it): follow a switch of their waiting items. */
function relabelRuns(items: readonly PendingItem[], app: HandoffApp): void {
  const runs = new Map(items.map((i) => [i.generationId, i.photoId]));
  for (const [generationId, photoId] of runs) {
    store().updateGeneration(photoId, generationId, (g) => {
      if (g.renderMode === 'handoff') g.provider = appLabel(app);
    });
  }
}

/** Items waiting for a hand-off that the user hasn't sent anywhere yet (safe to re-prepare for another app). */
export function unsentItems(): PendingItem[] {
  const log = readHandoffLog();
  return pendingItems().filter((i) => i.planned.status === 'awaiting-handoff' && !wasSent(log, i.plannedId));
}

/**
 * The Studio's hand-off app (prompt dock): new runs go there, and waiting
 * items that were not sent yet follow it. Items already pasted into an app
 * keep theirs — use switchPendingApp to move those too.
 */
export function setDefaultHandoffApp(app: HandoffApp): void {
  store().setStudio({ renderMode: 'handoff', handoffApp: app });
  const moved = unsentItems().filter((i) => i.planned.handoff?.app !== app);
  // Also cancels a preparation still in flight for the old app.
  for (const item of moved) dropPack(item);
  relabelRuns(moved, app);
}
