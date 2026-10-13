/**
 * Shell hooks: blob-store object URLs (ref-counted, revoked when the last
 * user unmounts), media queries, and the "is desktop layout" breakpoint.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import * as db from '../../state/persistence';

// ---------------------------------------------------------------------------
// Object URLs for blobs in the blob store
// ---------------------------------------------------------------------------

interface UrlEntry {
  refs: number;
  url: string | null;
  promise: Promise<string | null>;
  revokeTimer: ReturnType<typeof setTimeout> | null;
}

const urlCache = new Map<string, UrlEntry>();

/** Grace period before revoking an unused URL (avoids churn when lists re-render / StrictMode remounts). */
const REVOKE_DELAY_MS = 4000;

function acquire(id: string): UrlEntry {
  let entry = urlCache.get(id);
  if (!entry) {
    const e: UrlEntry = { refs: 0, url: null, promise: Promise.resolve(null), revokeTimer: null };
    e.promise = db
      .getBlob(id)
      .then((blob) => {
        if (!blob) return null;
        e.url = URL.createObjectURL(blob);
        // Released while loading: revoke right away.
        if (e.refs === 0 && urlCache.get(id) !== e) URL.revokeObjectURL(e.url);
        return e.url;
      })
      .catch(() => null);
    urlCache.set(id, e);
    entry = e;
  }
  if (entry.revokeTimer) {
    clearTimeout(entry.revokeTimer);
    entry.revokeTimer = null;
  }
  entry.refs++;
  return entry;
}

function release(id: string) {
  const entry = urlCache.get(id);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.revokeTimer) return;
  entry.revokeTimer = setTimeout(() => {
    if (entry.refs > 0) return;
    urlCache.delete(id);
    if (entry.url) URL.revokeObjectURL(entry.url);
  }, REVOKE_DELAY_MS);
}

export type BlobUrlState = { status: 'idle' | 'loading' | 'missing'; url: null } | { status: 'ready'; url: string };

/**
 * Object URL for a blob in the blob store (photo thumbnails, variations…).
 * Revoked automatically after the last component using it unmounts.
 */
export function useBlobUrl(id: string | null | undefined): BlobUrlState {
  const [state, setState] = useState<{ id: string | null; value: BlobUrlState }>(() => ({
    id: id ?? null,
    value: initialState(id),
  }));

  useEffect(() => {
    if (!id) {
      setState({ id: null, value: { status: 'idle', url: null } });
      return;
    }
    let alive = true;
    const entry = acquire(id);
    if (entry.url) setState({ id, value: { status: 'ready', url: entry.url } });
    else {
      setState({ id, value: { status: 'loading', url: null } });
      void entry.promise.then((url) => {
        if (!alive) return;
        setState({ id, value: url ? { status: 'ready', url } : { status: 'missing', url: null } });
      });
    }
    return () => {
      alive = false;
      release(id);
    };
  }, [id]);

  // While the effect for a new id hasn't run yet, don't show the previous image.
  if ((id ?? null) !== state.id) return initialState(id);
  return state.value;
}

function initialState(id: string | null | undefined): BlobUrlState {
  if (!id) return { status: 'idle', url: null };
  const cached = urlCache.get(id)?.url;
  return cached ? { status: 'ready', url: cached } : { status: 'loading', url: null };
}

// ---------------------------------------------------------------------------
// Media queries
// ---------------------------------------------------------------------------

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && !!window.matchMedia?.(query).matches),
    () => false,
  );
}

/** Tailwind `lg` breakpoint (64rem): three-column workspace instead of one pane at a time. */
export const DESKTOP_QUERY = '(min-width: 64rem)';

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

export function isDesktopViewport(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(DESKTOP_QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
