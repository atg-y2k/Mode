/**
 * Arming the editor's 'place' tool from the Lighting / Library panels, plus
 * the small set of whole-design edits these panels need. Everything goes
 * through store actions.
 */
import { useEffect, useState } from 'react';
import type { AssetDef } from '../../../../shared/types';
import { selectActiveDesign, selectActivePhoto, useStore, type Placement } from '../../../state/store';
import { glowPlacement, lightPlacementForAsset, samePlacement, type GenericGlow } from './lights';

const NARROW_QUERY = '(max-width: 1023px)';
const COARSE_QUERY = '(pointer: coarse)';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** One pane at a time (phones, small tablets) — mirrors the shell's lg breakpoint. */
export function isNarrowScreen(): boolean {
  return matches(NARROW_QUERY);
}

/** "Tap" on touch screens, "Click" with a mouse. */
export function pointerVerb(): 'Tap' | 'Click' {
  return matches(COARSE_QUERY) ? 'Tap' : 'Click';
}

/** Reactive media query (SSR / jsdom safe). */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setValue(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return value;
}

export function useIsNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY);
}

export function usePointerVerb(): 'Tap' | 'Click' {
  return useMediaQuery(COARSE_QUERY) ? 'Tap' : 'Click';
}

/** Name of what is armed, for hints. */
export function placementName(p: Placement, resolve: (id: string) => AssetDef | undefined): string | null {
  if (!p) return null;
  if (p.kind === 'object') return resolve(p.assetId)?.name ?? 'item';
  return p.name;
}

/**
 * Arms (or, when the same item is already armed, disarms) a placement.
 * On phones the editor pane is brought forward and a toast tells the user
 * what to do next, since the panel itself goes out of view.
 */
function arm(next: NonNullable<Placement>, name: string): void {
  let s = useStore.getState();
  if (!selectActivePhoto(s) || !selectActiveDesign(s)) {
    s.notify('Open a photo first — then tap it to place items on it.', 'info');
    return;
  }
  if (s.mode !== 'finetune') {
    s.setMode('finetune');
    s = useStore.getState();
  }
  if (samePlacement(s.placement, next)) {
    s.setPlacement(null);
    return;
  }
  s.setPlacement(next);
  if (isNarrowScreen()) {
    s.setView({ mobilePane: 'editor' });
    s.notify(`${pointerVerb()} the photo to place ${name}`, 'info');
  }
}

/** Plants, decor, furniture, hardscape — and fixtures shown as unlit objects. */
export function armObject(asset: AssetDef): void {
  arm({ kind: 'object', assetId: asset.id }, asset.name);
}

/** A light fixture: the light carries the asset's art, beam and color temperature. */
export function armFixture(asset: AssetDef): void {
  arm(lightPlacementForAsset(asset), asset.name);
}

/** Lighting assets place as lights (glow + art); everything else as objects. */
export function armAsset(asset: AssetDef): void {
  if (asset.category === 'lighting') armFixture(asset);
  else armObject(asset);
}

export function armGlow(glow: GenericGlow): void {
  arm(glowPlacement(glow), glow.name.toLowerCase());
}

export function cancelPlacement(): void {
  useStore.getState().setPlacement(null);
}

/** Is this asset (or glow) the armed placement? */
export function isArmed(p: Placement, target: AssetDef | GenericGlow): boolean {
  if (!p) return false;
  if ('beam' in target) return samePlacement(p, glowPlacement(target));
  if (target.category === 'lighting') return samePlacement(p, lightPlacementForAsset(target));
  return p.kind === 'object' && p.assetId === target.id;
}

// ---------------------------------------------------------------------------
// Whole-design edits (one undo step each)
// ---------------------------------------------------------------------------

/** Turn every placed light of the active design on or off. */
export function setAllLightsOn(on: boolean): void {
  const s = useStore.getState();
  const photoId = s.selection.photoId;
  if (!photoId) return;
  s.mutateProject(on ? 'All lights on' : 'All lights off', (d) => {
    for (const sp of d.spaces) {
      const ph = sp.photos.find((p) => p.id === photoId);
      if (!ph) continue;
      const des = ph.designs.find((x) => x.id === ph.activeDesignId) ?? ph.designs[0];
      if (!des) return;
      let changed = false;
      for (const l of des.lights) {
        if (l.on !== on) {
          l.on = on;
          changed = true;
        }
      }
      if (changed) des.updatedAt = Date.now();
      return;
    }
  });
}

/** How many placed objects and lights in the open project use an asset (all design options). */
export function countPlacements(assetId: string): number {
  const p = useStore.getState().project;
  if (!p) return 0;
  let n = 0;
  for (const sp of p.spaces)
    for (const ph of sp.photos)
      for (const des of ph.designs) {
        n += des.objects.filter((o) => o.assetId === assetId).length;
        n += des.lights.filter((l) => l.assetId === assetId).length;
      }
  return n;
}

/**
 * Before a library asset is deleted: remove its placed objects from the open
 * project and stop drawing its fixture art (the glow stays). Not undoable —
 * the asset's image is deleted right after.
 */
export function detachAssetFromProject(assetId: string): void {
  const s = useStore.getState();
  if (!s.project || countPlacements(assetId) === 0) return;
  s.mutateProject(
    'Remove deleted item',
    (d) => {
      for (const sp of d.spaces)
        for (const ph of sp.photos)
          for (const des of ph.designs) {
            const before = des.objects.length;
            des.objects = des.objects.filter((o) => o.assetId !== assetId);
            let changed = des.objects.length !== before;
            for (const l of des.lights) {
              if (l.assetId === assetId) {
                l.assetId = undefined;
                l.showFixture = false;
                changed = true;
              }
            }
            if (changed) des.updatedAt = Date.now();
          }
    },
    { history: false },
  );
  const sel = useStore.getState().selection;
  const design = selectActiveDesign(useStore.getState());
  if (sel.objectId && !design?.objects.some((o) => o.id === sel.objectId)) useStore.getState().select({ objectId: null });
}
