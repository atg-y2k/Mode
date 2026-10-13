/** React bindings for the vision client: live status and which models are already downloaded. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { cachedModels, getVisionStatus, onVisionStatus, visionUnsupportedReason, type ModelKey, type VisionStatus } from '../index';

export function useVisionStatus(): VisionStatus {
  return useSyncExternalStore(onVisionStatus, getVisionStatus, getVisionStatus);
}

const ALL_MODELS: ModelKey[] = ['edgetam', 'segformer', 'clipseg'];
let cachedPromise: Promise<Partial<Record<ModelKey, boolean>>> | null = null;
let cachedValue: Partial<Record<ModelKey, boolean>> | null = null;
const cacheListeners = new Set<() => void>();

/** Re-checks the browser cache (after a download finished). */
export function refreshCachedModels(): void {
  cachedPromise = null;
  void loadCached();
}

function loadCached(): Promise<Partial<Record<ModelKey, boolean>>> {
  if (!cachedPromise) {
    cachedPromise = cachedModels(ALL_MODELS).then((v) => {
      cachedValue = v;
      for (const l of [...cacheListeners]) l();
      return v;
    });
  }
  return cachedPromise;
}

/** Which models are in the browser cache (null while checking or when the check is unavailable). */
export function useCachedModels(enabled = true): Partial<Record<ModelKey, boolean>> | null {
  const [value, setValue] = useState(cachedValue);
  useEffect(() => {
    if (!enabled || visionUnsupportedReason()) return;
    const update = () => setValue(cachedValue);
    cacheListeners.add(update);
    void loadCached().then(update);
    return () => {
      cacheListeners.delete(update);
    };
  }, [enabled]);
  return value;
}
