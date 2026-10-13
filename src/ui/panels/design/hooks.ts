/**
 * React hooks shared by the Surfaces / Paint / Materials panels: region
 * masks loaded on demand, debounced mask statistics (coverage, area) that
 * follow brush strokes without recomputing every frame, and viewport helpers.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Photo, Region } from '../../../../shared/types';
import { regionAreaSqFt, type AreaMethod } from '../../../assetList/area';
import { isMaskEmpty, maskCoverage } from '../../../engine/mask';
import type { Mask } from '../../../engine/types';
import * as runtime from '../../../state/runtime';
import { useStore } from '../../../state/store';

/** Phones and small tablets show one pane at a time (same breakpoint as the shell). */
export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches;
}

/** On phones, bring the photo forward so the user sees what to do next. */
export function showPhotoOnPhone(): void {
  if (isNarrowViewport()) useStore.getState().setView({ mobilePane: 'editor' });
}

/** Follows `value` once it has stopped changing for `delayMs` (the first value is immediate). */
export function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, settled, delayMs]);
  return settled;
}

/**
 * The runtime mask of a region, loaded from storage on demand, and a version
 * number that bumps whenever its pixels change (brush strokes, undo, ops).
 */
export function useRegionMask(maskId: string | undefined, width: number, height: number): { mask: Mask | undefined; version: string } {
  const storeVersion = useStore((s) => (maskId ? (s.maskVersions[maskId] ?? 0) : 0));
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    if (!maskId || runtime.getMask(maskId) || width <= 0 || height <= 0) return;
    let alive = true;
    runtime
      .loadMask(maskId, width, height)
      .then(() => {
        if (alive) setLoads((n) => n + 1);
      })
      .catch((err: unknown) => console.warn('[surfaces] could not load outline', err));
    return () => {
      alive = false;
    };
  }, [maskId, width, height]);
  const mask = maskId ? runtime.getMask(maskId) : undefined;
  return { mask, version: `${storeVersion}:${loads}` };
}

export interface RegionStats {
  /** Nothing outlined yet. */
  empty: boolean;
  /** Share of the photo covered, 0..1. */
  coverage: number;
  /** Estimated real area (null when unknown) and how it was obtained. */
  sqft: number | null;
  method: AreaMethod;
}

/** Statistics for a region, recomputed ~200 ms after its outline stops changing. Null while the mask loads. */
export function useRegionStats(region: Region | undefined, photo: Pick<Photo, 'width' | 'height' | 'calibration'>): RegionStats | null {
  const { mask, version } = useRegionMask(region?.maskId, photo.width, photo.height);
  const settled = useSettled(version, 200);
  const { width, height, calibration } = photo;
  return useMemo(() => {
    void settled; // recompute after in-place mask edits settle
    if (!region || !mask) return null;
    const empty = isMaskEmpty(mask);
    const total = mask.width * mask.height;
    const coverage = empty || total === 0 ? 0 : maskCoverage(mask) / total;
    const area = regionAreaSqFt(region, mask, { width, height, calibration });
    return { empty, coverage, sqft: area.sqft, method: area.method };
  }, [mask, settled, region, width, height, calibration]);
}
