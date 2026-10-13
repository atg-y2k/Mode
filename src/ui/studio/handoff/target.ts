/**
 * A run's target area at photo size (browser side of maskFromZones):
 * - freezeRunTarget: the snapshot a run keeps when it starts
 *   (Generation.target), with copies of the refined zone masks it uses, so a
 *   re-map, a cleared map, a deleted zone, an undone "Analyze scene" or
 *   sharper outlines never widen or move a pending run's area;
 * - runTargetMask: the mask of that snapshot — or, for runs from older saves
 *   without one, of the live scene, refusing (TargetLostError) when the
 *   areas the run named are gone instead of turning it into a whole-image
 *   edit.
 * Used by API renders (generate.ts), hand-off exports and imports (pack.ts)
 * and the review's "What may change" preview.
 */
import { newId } from '../../../../shared/ids';
import type { DesignBrief, Generation, Photo, RunTarget } from '../../../../shared/types';
import { cloneMask, createMask, isMaskEmpty } from '../../../engine/mask';
import type { Mask } from '../../../engine/types';
import * as runtime from '../../../state/runtime';
import { briefTargetIds, maskForBrief, maskForRunTarget, runTargetLost, snapshotRunTarget, TARGET_LOST_MESSAGE } from '../maskFromZones';

/** The run named areas that are no longer in the scene (runs from older saves). */
export class TargetLostError extends Error {
  constructor(message = TARGET_LOST_MESSAGE) {
    super(message);
    this.name = 'TargetLostError';
  }
}

/** Mask copies still being written, per run. */
const copying = new Map<string, Promise<void>>();

/** Copies a refined zone mask under a run-owned id (synchronously when it is in memory). */
async function copyMask(src: string, dst: string, width: number, height: number): Promise<void> {
  const mask = runtime.getMask(src) ?? (await runtime.loadMask(src, width, height));
  if (!mask || isMaskEmpty(mask) || mask.width !== width || mask.height !== height) return; // the copy falls back to the outline
  runtime.setMask(dst, cloneMask(mask));
  runtime.markMaskDirty(dst, 0);
}

/**
 * The snapshot a new run keeps (Generation.target): what `brief` targets in
 * the photo's scene now, with its refined zone masks copied under new ids
 * owned by the run (written in the background; runTargetMask waits for
 * them). An empty snapshot when nothing is targeted (a whole-image edit, as
 * the dock showed when the run started).
 */
export function freezeRunTarget(generationId: string, photo: Photo, brief: DesignBrief): RunTarget {
  return cloneRunTarget(generationId, photo, snapshotRunTarget(brief, photo.scene, photo) ?? { zones: [], paths: [] });
}

/**
 * A run's own copy of a snapshot — a fresh one, or another run's (retrying
 * a run, "More like this"): refined masks are copied under new ids, since
 * each run owns (and deletes) its own.
 */
export function cloneRunTarget(generationId: string, photo: Photo, source: RunTarget): RunTarget {
  const target = structuredClone(source);
  const jobs: Promise<void>[] = [];
  for (const z of target.zones) {
    if (!z.maskId) continue;
    const dst = newId('msk');
    jobs.push(copyMask(z.maskId, dst, photo.width, photo.height).catch(() => undefined));
    z.maskId = dst;
  }
  if (jobs.length) {
    const done = Promise.all(jobs).then(() => undefined);
    copying.set(generationId, done);
    void done.finally(() => {
      if (copying.get(generationId) === done) copying.delete(generationId);
    });
  }
  return target;
}

function fullMask(photo: Pick<Photo, 'width' | 'height'>): Mask {
  const full = createMask(photo.width, photo.height);
  full.data.fill(255);
  return full;
}

/**
 * Everything a run may change, at photo size: its frozen snapshot, else
 * (older saves) the live scene. `wholeImage` when it may change everything
 * (scope 'whole', or nothing was targeted). Throws TargetLostError when an
 * older run's areas are gone from the scene.
 */
export async function runTargetMask(photo: Photo, g: Pick<Generation, 'id' | 'brief' | 'target'>): Promise<{ mask: Mask; wholeImage: boolean }> {
  let mask: Mask | null = null;
  if (g.brief.scope === 'whole') mask = null;
  else if (g.target) {
    await copying.get(g.id);
    const ids = g.target.zones.flatMap((z) => (z.maskId ? [z.maskId] : []));
    await Promise.all(ids.map((id) => runtime.loadMask(id, photo.width, photo.height).catch(() => undefined)));
    mask = maskForRunTarget(photo, g.target, { getMask: runtime.getMask });
  } else {
    if (runTargetLost(g, photo.scene)) throw new TargetLostError();
    const { zoneIds } = briefTargetIds(g.brief, photo.scene);
    const zones = photo.scene?.zones.filter((z) => z.maskId && zoneIds.includes(z.id)) ?? [];
    await Promise.all(zones.map((z) => runtime.loadMask(z.maskId as string, photo.width, photo.height).catch(() => undefined)));
    mask = maskForBrief(photo, photo.scene, g.brief, { getMask: runtime.getMask });
  }
  return mask ? { mask, wholeImage: false } : { mask: fullMask(photo), wholeImage: true };
}

/**
 * The run's own area without the footprint room (its zones and paths only):
 * what the wrong-image check compares, so an unchanged lawn beside a new
 * path doesn't make a real edit look unchanged. Null without room.
 */
export async function runCoreMask(photo: Photo, g: Pick<Generation, 'id' | 'brief' | 'target'>): Promise<Mask | null> {
  if (!g.target?.room?.zones.length || g.brief.scope === 'whole') return null;
  await copying.get(g.id);
  const ids = g.target.zones.flatMap((z) => (z.maskId ? [z.maskId] : []));
  await Promise.all(ids.map((id) => runtime.loadMask(id, photo.width, photo.height).catch(() => undefined)));
  return maskForRunTarget(photo, { zones: g.target.zones, paths: g.target.paths }, { getMask: runtime.getMask });
}
