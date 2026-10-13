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

/**
 * Puts a PNG on the clipboard. Call synchronously from the click handler;
 * `png` may still be resolving. Rejects when the browser refuses.
 */
export function writeImage(win: Window, png: Promise<Blob>): Promise<void> {
  const Item = (win as WindowWithClipboardItem).ClipboardItem;
  if (!win.navigator.clipboard?.write || !Item) {
    png.catch(() => undefined);
    return Promise.reject(new Error('This browser cannot copy images — use the download button and attach the file instead.'));
  }
  try {
    return win.navigator.clipboard.write([new Item({ 'image/png': png })]);
  } catch (err) {
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
