/**
 * React hooks shared by the Surfaces / Paint / Materials panels: region
 * masks loaded on demand, debounced mask statistics (coverage, area) that
 * follow brush strokes without recomputing every frame, and viewport helpers.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/**
 * Statistics for a region, recomputed ~200 ms after its outline (or its
 * plane / area override, e.g. while a plane corner is dragged) stops
 * changing. Null while the mask loads.
 */
export function useRegionStats(region: Region | undefined, photo: Pick<Photo, 'width' | 'height' | 'calibration'>): RegionStats | null {
  const { mask, version } = useRegionMask(region?.maskId, photo.width, photo.height);
  const settledVersion = useSettled(version, 200);
  const settledRegion = useSettled(region, 200);
  // A different region is never stale data: use it right away.
  const r = settledRegion && region && settledRegion.id === region.id ? settledRegion : region;
  const { width, height, calibration } = photo;
  const coverage = useMemo(() => {
    void settledVersion; // recompute after in-place mask edits settle
    if (!mask) return null;
    const empty = isMaskEmpty(mask);
    const total = mask.width * mask.height;
    return { empty, share: empty || total === 0 ? 0 : maskCoverage(mask) / total };
  }, [mask, settledVersion]);
  const plane = r?.plane;
  const override = r?.areaSqFtOverride;
  return useMemo(() => {
    void settledVersion;
    if (!r || !mask || !coverage) return null;
    const area = regionAreaSqFt({ ...r, plane, areaSqFtOverride: override }, mask, { width, height, calibration });
    return { empty: coverage.empty, coverage: coverage.share, sqft: area.sqft, method: area.method };
    // Only the plane and the override affect the area; other region edits (name, color) don't.
  }, [mask, coverage, settledVersion, plane, override, width, height, calibration, r?.id]);
}

/** A callback with a stable identity that always calls the latest `fn` (lets memoized children skip re-renders). */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
