/**
 * Where a returned image can come from: a drop or paste (files → file items
 * → a dragged image's URL fetched server-side), the clipboard (the
 * `clipboardchange` offer) and the Downloads folder watcher.
 */
import { fetchImageUrl } from '../../../lib/handoff';

/** Image files of a DataTransfer: `files` first, then file items (Chrome sometimes fills only items). */
export function transferFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|heic|gif)$/i.test(f.name));
  if (files.length) return files;
  const out: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const f = item.getAsFile();
    if (f && (f.type.startsWith('image/') || f.type === '')) out.push(f);
  }
  return out;
}

/** The image URL of a drag from another tab: text/uri-list, else the first <img src> of text/html. */
export function transferImageUrl(dt: DataTransfer | null): string | null {
  if (!dt) return null;
  const list = dt.getData('text/uri-list');
  const fromList = list
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (fromList && /^https?:\/\//i.test(fromList)) return fromList;
  const html = dt.getData('text/html');
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (m && /^https?:\/\//i.test(m[1])) return m[1].replace(/&amp;/g, '&');
  const text = dt.getData('text/plain').trim();
  if (/^https?:\/\/\S+$/i.test(text)) return text;
  return null;
}

/** True when a drag carries files or a link (worth showing the drop target for). */
export function dragLooksImportable(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types ?? []);
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html');
}

/**
 * Gemini serves dragged previews at 1024 px (`=s1024-rj` and similar);
 * `=s0` asks Google's image server for the original size.
 */
export function fullSizeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)googleusercontent\.com$/i.test(u.hostname) && /=[swh]\d+[^/]*$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/=[swh]\d+[^/]*$/, '=s0');
      return u.toString();
    }
  } catch {
    // not a URL
  }
  return url;
}

/** Fetches a dragged image through the server (CORS-free, SSRF-guarded), trying the full-size variant first. */
export async function fetchDroppedImage(url: string, signal?: AbortSignal): Promise<Blob> {
  const full = fullSizeImageUrl(url);
  if (full !== url) {
    try {
      return await fetchImageUrl(full, signal);
    } catch {
      // fall back to the URL as dragged
    }
  }
  return fetchImageUrl(url, signal);
}

/** Everything importable in a DataTransfer (drop or paste): files, else the dragged image's URL fetched via the server. */
export async function transferImages(dt: DataTransfer | null): Promise<Blob[]> {
  const files = transferFiles(dt);
  if (files.length) return files;
  const url = transferImageUrl(dt);
  if (!url) return [];
  try {
    return [await fetchDroppedImage(url)];
  } catch (err) {
    const msg = (err as Error)?.message || '';
    throw new Error(
      /401|403|sign|log ?in|forbidden|unauthori/i.test(msg)
        ? 'That image needs your ChatGPT / Gemini login to download. Use Copy image or Download full size, then paste or drop the file here.'
        : msg || "Couldn't download that image — use Download, then drop the file here.",
    );
  }
}

/** Whether `clipboardchange` (Chromium 144+) is available: it tells us an image was copied without reading it. */
export function clipboardChangeSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.clipboard && 'onclipboardchange' in navigator.clipboard;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}
