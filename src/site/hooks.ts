/**
 * React hooks over the site data modules (ZIP table, US-RIIS list).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ensureInvasivesLoading, invasivesReady, onInvasivesLoaded } from './invasives';
import { lookupZip, normalizeZip, type ZipInfo } from './zip';

/**
 * True once the US-RIIS list has loaded (starts loading on first use). Components
 * that memoize plant feasibility can add it to their dependencies so ratings
 * pick up the invasive flags as soon as the list arrives.
 */
export function useInvasivesReady(): boolean {
  useEffect(() => ensureInvasivesLoading(), []);
  return useSyncExternalStore(onInvasivesLoaded, invasivesReady, invasivesReady);
}

export type ZipLookupState =
  | { status: 'idle'; info: null }
  | { status: 'loading'; info: null }
  | { status: 'found'; info: ZipInfo }
  | { status: 'unknown'; info: null };

/** Looks up a ZIP as the user types (only complete 5-digit ZIPs; stale answers are ignored). */
export function useZipLookup(zip: string | undefined): ZipLookupState {
  const z = normalizeZip(zip);
  const [state, setState] = useState<{ zip: string | null; result: ZipLookupState }>({ zip: null, result: { status: 'idle', info: null } });
  useEffect(() => {
    if (!z) return;
    let live = true;
    const controller = new AbortController();
    void lookupZip(z, { signal: controller.signal }).then((info) => {
      if (live) setState({ zip: z, result: info ? { status: 'found', info } : { status: 'unknown', info: null } });
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [z]);
  if (!z) return { status: 'idle', info: null };
  return state.zip === z ? state.result : { status: 'loading', info: null };
}
