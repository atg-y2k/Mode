/**
 * Hand-off actions: open an item in the companion, bring a returned image
 * back (align + protect + stage), accept / reject / skip / retry stricter,
 * and switch waiting items to the other app. Every change to a planned item
 * goes through the store (persisted) and re-rolls the run's status.
 */
import type { Draft } from 'immer';
import { newId } from '../../../../shared/ids';
import type { Generation, HandoffApp, PlannedVariation, Variation } from '../../../../shared/types';
import { importHandoffResult, type ImportProgress } from '../../../handoff';
import { imageDataToBlob } from '../../../lib/imageImport';
import * as db from '../../../state/persistence';
import { findPhoto, useStore } from '../../../state/store';
import { thumbnailBlob } from '../composite';
import { errorMessage, retryRun } from '../generate';
import { readHandoffLog, wasSent } from './log';
import { dropPack, ensurePack, forgetRunCaches, lookupPlanned, runAssets, warmPack } from './pack';
import { appLabel, assignTargets, isPending, projectPendingHandoffs, rollupStatus, sameRef, type PendingItem, type PlannedRef } from './planned';
import { focusHandoff, handoffSession, setExtras, setHandoffSession, setItemError, setJob } from './session';

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

const IMPORT_STAGES: Partial<Record<ImportProgress, string>> = {
  loading: 'Reading the image…',
  aligning: 'Lining the result up with your photo…',
  compositing: 'Protecting everything outside the outline…',
};

function looksLikeImage(blob: Blob): boolean {
  return blob.type === '' || blob.type.startsWith('image/');
}

/**
 * Lines a returned image up with the photo and stages it on the item:
 * the composite (original outside the target) becomes the staged result,
 * replacing an earlier one. Returns false when it failed (shown on the item).
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
  if (handoffSession().jobs[ref.plannedId]?.kind === 'importing') {
    store().notify(`Still lining up the previous image for “${found.planned.title}” — try again in a moment.`, 'info');
    return false;
  }
  setItemError(ref.plannedId, null);
  setJob(ref.plannedId, { kind: 'importing', message: 'Lining the result up with your photo…' });
  let ids: string[] = [];
  try {
    const pack = found.planned.handoff ?? (await ensurePack(ref));
    setJob(ref.plannedId, { kind: 'importing', message: 'Lining the result up with your photo…' });
    const { photo, generation } = found;
    const assets = await runAssets(photo, generation);
    const result = await importHandoffResult(photo, assets.base, assets.target, pack, blob, undefined, (stage) =>
      setJob(ref.plannedId, { kind: 'importing', message: IMPORT_STAGES[stage] ?? 'Lining the result up with your photo…' }),
    );
    setJob(ref.plannedId, { kind: 'importing', message: 'Saving the result…' });
    const [full, thumb] = await Promise.all([imageDataToBlob(result.composite, 'image/jpeg', 0.9), thumbnailBlob(result.composite)]);
    const imageId = newId('img');
    const thumbId = newId('img');
    ids = [imageId, thumbId];
    await Promise.all([db.putBlob(imageId, full), db.putBlob(thumbId, thumb)]);
    const still = lookupPlanned(ref);
    if (!still || still.planned.status === 'done' || still.planned.status === 'rejected') {
      void db.deleteBlobs(ids);
      return false;
    }
    const old = still.planned.staged;
    withPlanned(ref, (p) => {
      p.status = 'staged';
      p.staged = { imageId, thumbId, source: { kind: 'handoff', app: pack.app, importedAt: Date.now(), alignment: result.report } };
      delete p.error;
    });
    if (old) void db.deleteBlobs([old.imageId, old.thumbId]);
    setExtras(ref.plannedId, { changeMap: result.outsideChangeMap, blobs: result.outsideBlobs });
    openStaging(ref);
    if (origin) store().notify(origin, 'info');
    return true;
  } catch (err) {
    if (ids.length) void db.deleteBlobs(ids);
    const message = errorMessage(err);
    setItemError(ref.plannedId, message);
    store().notify(`Couldn't import that image: ${message}`, 'error');
    return false;
  } finally {
    setJob(ref.plannedId, null);
  }
}

/**
 * Returned images from a paste / drop / file picker / Downloads: one image
 * goes to the active item (else the first waiting one); several are assigned
 * to the waiting items in order. Imports run one after another.
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

/** Accept: the staged result becomes a variation of the run (with its provenance) and is shown. */
export function acceptStaged(ref: PlannedRef): void {
  const found = lookupPlanned(ref);
  const staged = found?.planned.staged;
  if (!found || !staged || found.planned.status !== 'staged') return;
  const { photo, planned } = found;
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
    delete p.error;
  });
  setExtras(ref.plannedId, null);
  setHandoffSession({ staging: null });
  s.setStudio({ viewVariationId: variation.id, gridGenerationId: null });
  advanceAfter(ref, `“${variation.title}” added to your variations.`);
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
  });
  void db.deleteBlobs([staged.imageId, staged.thumbId]);
  setExtras(ref.plannedId, null);
  setHandoffSession({ staging: null });
  openHandoff(ref);
  store().notify('Result discarded. Try again in a new chat, or skip this variation.', 'info');
}

/** Skip: the user doesn't want this variation (staged result discarded). */
export function skipPlanned(ref: PlannedRef): void {
  const found = lookupPlanned(ref);
  if (!found || !isPending(found.planned)) return;
  const staged = found.planned.staged;
  withPlanned(ref, (p) => {
    p.status = 'rejected';
    delete p.staged;
  });
  if (staged) void db.deleteBlobs([staged.imageId, staged.thumbId]);
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
  withPlanned(ref, (p) => {
    p.status = 'awaiting-handoff';
    delete p.staged;
  });
  if (staged) void db.deleteBlobs([staged.imageId, staged.thumbId]);
  setExtras(ref.plannedId, null);
  setHandoffSession({ staging: null });
  focusHandoff(ref);
  try {
    await ensurePack(ref, { strictness: 'strict' });
    store().notify('Stricter prompt ready — start a new chat with it, then bring the result back.', 'success');
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
  const moved = pendingItems().filter((i) => i.planned.status === 'awaiting-handoff' && i.planned.handoff?.app !== app);
  // Prepared items are prepared again for the new app when opened (the companion does it for the active one).
  for (const item of moved) if (item.planned.handoff) dropPack(item);
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
  for (const item of moved) if (item.planned.handoff) dropPack(item);
  relabelRuns(moved, app);
}

/** Drops cached pixels and blobs of a deleted hand-off run. */
export function cleanupRun(g: Generation): void {
  forgetRunCaches(g.id);
  const ids: string[] = [];
  for (const p of g.planned ?? []) {
    if (p.handoff) ids.push(p.handoff.cleanImageId, p.handoff.markedImageId);
    if (p.staged) ids.push(p.staged.imageId, p.staged.thumbId);
    setExtras(p.id, null);
  }
  const s = handoffSession();
  const gone = (ref: PlannedRef | null) => !!ref && ref.generationId === g.id;
  if (gone(s.active) || gone(s.staging)) setHandoffSession({ active: gone(s.active) ? null : s.active, staging: gone(s.staging) ? null : s.staging });
  if (ids.length) void db.deleteBlobs(ids);
}

let gcInstalled = false;

/**
 * Deleting a run (strip, History) removes its variations' blobs in the store;
 * this also removes its hand-off images (prepared exports, staged results).
 * Undo/redo never bring a deleted run back (runs are recorded without history).
 */
export function installHandoffCleanup(): void {
  if (gcInstalled) return;
  gcInstalled = true;
  useStore.subscribe((s, prev) => {
    if (s.project?.id !== prev.project?.id) {
      // Another project (or none): the session's items belong to the old one.
      setHandoffSession({ active: null, staging: null, jobs: {}, extras: {}, errors: {}, clipboardOffer: false, companion: 'closed' });
      return;
    }
    if (!prev.project || !s.project || s.project === prev.project) return;
    const next = new Set<string>();
    for (const sp of s.project.spaces) for (const ph of sp.photos) for (const g of ph.generations) next.add(g.id);
    for (const sp of prev.project.spaces) {
      for (const ph of sp.photos) {
        // A deleted photo / space cleans up its own blobs (persistence.photoReferencedIds).
        if (!findPhoto(s.project, ph.id)) continue;
        for (const g of ph.generations) if (!next.has(g.id) && g.planned?.length) cleanupRun(g);
      }
    }
  });
}
