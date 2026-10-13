/**
 * Studio hooks: blob-store object URLs (ref-counted, revoked a few seconds
 * after the last user unmounts), decoded-image swapping without flashes,
 * element size, and the active photo / space.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Photo, Space } from '../../../shared/types';
import * as db from '../../state/persistence';
import { findPhoto, useStore } from '../../state/store';

// ---------------------------------------------------------------------------
// Object URLs
// ---------------------------------------------------------------------------

interface UrlEntry {
  refs: number;
  url: string | null;
  promise: Promise<string | null>;
  revokeTimer: ReturnType<typeof setTimeout> | null;
}

const urls = new Map<string, UrlEntry>();
const REVOKE_DELAY_MS = 5000;

function acquire(id: string): UrlEntry {
  let entry = urls.get(id);
  if (!entry) {
    const e: UrlEntry = { refs: 0, url: null, promise: Promise.resolve(null), revokeTimer: null };
    e.promise = db
      .getBlob(id)
      .then((blob) => {
        if (!blob) return null;
        e.url = URL.createObjectURL(blob);
        return e.url;
      })
      .catch(() => null);
    urls.set(id, e);
    entry = e;
  }
  if (entry.revokeTimer) {
    clearTimeout(entry.revokeTimer);
    entry.revokeTimer = null;
  }
  entry.refs++;
  return entry;
}

function release(id: string): void {
  const entry = urls.get(id);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.revokeTimer) return;
  entry.revokeTimer = setTimeout(() => {
    if (entry.refs > 0) return;
    urls.delete(id);
    if (entry.url) URL.revokeObjectURL(entry.url);
    else void entry.promise.then((u) => u && URL.revokeObjectURL(u));
  }, REVOKE_DELAY_MS);
}

export type BlobUrl = { status: 'idle' | 'loading' | 'missing'; url: null } | { status: 'ready'; url: string };

function initial(id: string | null | undefined): BlobUrl {
  if (!id) return { status: 'idle', url: null };
  const url = urls.get(id)?.url;
  return url ? { status: 'ready', url } : { status: 'loading', url: null };
}

/** Object URL of a blob in the blob store (photos, variations, thumbnails). */
export function useBlobUrl(id: string | null | undefined): BlobUrl {
  const [state, setState] = useState<{ id: string | null; value: BlobUrl }>(() => ({ id: id ?? null, value: initial(id) }));
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
        if (alive) setState({ id, value: url ? { status: 'ready', url } : { status: 'missing', url: null } });
      });
    }
    return () => {
      alive = false;
      release(id);
    };
  }, [id]);
  return (id ?? null) === state.id ? state.value : initial(id);
}

// ---------------------------------------------------------------------------
// Flash-free image swaps
// ---------------------------------------------------------------------------

const decoded = new Set<string>();

/**
 * Returns `url` once the browser has decoded it, keeping the previously
 * decoded URL meanwhile — switching variations never flashes an empty frame.
 */
export function useDecodedUrl(url: string | null): { url: string | null; pending: boolean } {
  const [shown, setShown] = useState<string | null>(() => (url && decoded.has(url) ? url : null));
  useEffect(() => {
    if (!url) {
      setShown(null);
      return;
    }
    if (decoded.has(url)) {
      setShown(url);
      return;
    }
    let alive = true;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    const done = () => {
      if (!alive) return;
      decoded.add(url);
      setShown(url);
    };
    img.decode().then(done, done);
    return () => {
      alive = false;
    };
  }, [url]);
  return { url: url ? shown : null, pending: !!url && shown !== url };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5 ? s : { width: r.width, height: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** The active photo and its space. */
export function useActivePhoto(): { photo: Photo | undefined; space: Space | undefined } {
  // Two selectors: each returns a stable reference (a fresh wrapper object would re-render forever).
  const photo = useStore((s) => findPhoto(s.project, s.selection.photoId)?.photo);
  const space = useStore((s) => findPhoto(s.project, s.selection.photoId)?.space);
  return { photo, space };
}

/** Latest value in a ref (for stable event handlers). */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
