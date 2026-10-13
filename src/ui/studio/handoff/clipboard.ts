/**
 * Clipboard and window helpers for the hand-off.
 *
 * Writing an image must happen synchronously inside the click handler
 * (Safari drops the user activation after any await; opening a window can
 * consume it too): pass a Promise<Blob> to ClipboardItem and call write()
 * before window.open — never await first. Everything here takes the window
 * the click happened in, because the companion can float in a Document
 * Picture-in-Picture window whose own navigator.clipboard has the focus.
 */

type WindowWithClipboardItem = Window & { ClipboardItem?: typeof ClipboardItem };

/** The window an event happened in (the PiP window for clicks inside it). */
export function eventWindow(e: { currentTarget: EventTarget | null }): Window {
  const node = e.currentTarget as Node | null;
  return node?.ownerDocument?.defaultView ?? window;
}

export function canWriteImages(win: Window = window): boolean {
  return !!win.navigator.clipboard?.write && typeof (win as WindowWithClipboardItem).ClipboardItem === 'function';
}

// ---------------------------------------------------------------------------
// Mode's own image copies (clipboardchange also fires for the page's own writes)
// ---------------------------------------------------------------------------

/** Mode's latest image write: when it started / settled, and whether Mode lost focus since. */
let own: { at: number; settledAt: number | null; blurred: boolean } | null = null;
/** Cheap fingerprint of the image Mode copied last (backstop for clipboardchange events delivered later). */
let ownPrint: Promise<ImagePrint | null> | null = null;
const blurWatched = new WeakSet<Window>();

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function watchBlur(win: Window | undefined): void {
  if (!win || blurWatched.has(win) || typeof win.addEventListener !== 'function') return;
  blurWatched.add(win);
  win.addEventListener('blur', () => {
    if (own) own.blurred = true;
  });
}

/** How long after Mode's own write settles a clipboardchange still counts as that write. */
export const OWN_WRITE_WINDOW_MS = 1500;

/**
 * Whether a clipboardchange happening now is Mode's own image write (the
 * photo, a reference, the marked / clean copy): Mode kept the focus since
 * and the write is in flight or just settled. Events delivered after Mode
 * lost and regained focus (e.g. after "Copy photo & open ChatGPT") are never
 * treated as Mode's own — the user may have copied the result meanwhile.
 */
export function isOwnClipboardChange(at = now()): boolean {
  const hasFocus = typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  return !!own && !own.blurred && hasFocus && (own.settledAt === null || at - own.settledAt < OWN_WRITE_WINDOW_MS);
}

/** 16×16 grayscale thumbnail + size of an image. */
interface ImagePrint {
  width: number;
  height: number;
  gray: Uint8Array;
}

/** Fingerprint of an image blob (null where images can't be decoded, e.g. node). */
async function imagePrint(blob: Blob): Promise<ImagePrint | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const size = 16;
      const canvas: OffscreenCanvas | HTMLCanvasElement =
        typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, size, size);
      const rgba = ctx.getImageData(0, 0, size, size).data;
      const gray = new Uint8Array(size * size);
      for (let i = 0; i < gray.length; i++) gray[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
      return { width: bitmap.width, height: bitmap.height, gray };
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** Same picture: same size and nearly identical thumbnails (any real edit moves at least one cell clearly). */
export function samePrint(a: ImagePrint, b: ImagePrint): boolean {
  if (a.width !== b.width || a.height !== b.height || a.gray.length !== b.gray.length) return false;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.gray.length; i++) {
    const d = Math.abs(a.gray[i] - b.gray[i]);
    sum += d;
    if (d > max) max = d;
  }
  return sum / a.gray.length < 2.5 && max < 16;
}

/** Whether `blob` (read from the clipboard) is the image Mode itself copied last. */
export async function isOwnClipboardImage(blob: Blob): Promise<boolean> {
  const mine = await (ownPrint ?? Promise.resolve(null));
  if (!mine) return false;
  const theirs = await imagePrint(blob);
  return !!theirs && samePrint(mine, theirs);
}

/**
 * Puts a PNG on the clipboard. Call synchronously from the click handler;
 * `png` may still be resolving. Rejects when the browser refuses. Remembers
 * the write so the "Import copied image?" offer ignores Mode's own copies.
 */
export function writeImage(win: Window, png: Promise<Blob>): Promise<void> {
  const Item = (win as WindowWithClipboardItem).ClipboardItem;
  if (!win.navigator.clipboard?.write || !Item) {
    png.catch(() => undefined);
    return Promise.reject(new Error('This browser cannot copy images — use the download button and attach the file instead.'));
  }
  const record = { at: now(), settledAt: null as number | null, blurred: false };
  own = record;
  watchBlur(typeof window !== 'undefined' ? window : undefined);
  watchBlur(win);
  ownPrint = png.then(imagePrint, () => null);
  const settle = () => {
    record.settledAt = now();
  };
  try {
    const p = win.navigator.clipboard.write([new Item({ 'image/png': png })]);
    p.then(settle, settle);
    return p;
  } catch (err) {
    settle();
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

export function writeText(win: Window, text: string): Promise<void> {
  if (win.navigator.clipboard?.writeText) return win.navigator.clipboard.writeText(text);
  // Very old browsers / insecure contexts: a hidden textarea + execCommand.
  try {
    const doc = win.document;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('Copy failed'));
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Opens ChatGPT / Gemini in a new tab — a new tab per hand-off, so a chat
 * that is still generating is never navigated away. 'noopener': the app's
 * page gets no handle on Mode.
 */
export function openAppTab(win: Window, url: string): void {
  win.open(url, '_blank', 'noopener');
}

/** First image on the clipboard (asks for permission in most browsers). */
export async function readClipboardImage(win: Window = window): Promise<Blob | null> {
  if (!win.navigator.clipboard?.read) return null;
  const items = await win.navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return item.getType(type);
  }
  return null;
}

/** True in a secure context (https or localhost): clipboard images need it. */
export function clipboardAvailable(win: Window = window): boolean {
  return win.isSecureContext !== false && canWriteImages(win);
}
