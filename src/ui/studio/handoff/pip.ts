/**
 * Document Picture-in-Picture host for the hand-off companion: a small
 * always-on-top window that floats over the ChatGPT / Gemini tab, so the
 * user can copy the photo / prompt again and drop or paste the result
 * without switching tabs. Same origin and same JS realm as Mode: React
 * renders into it through a portal and imports land straight in the opener.
 * Feature-detected ('documentPictureInPicture' in window — Chromium 116+).
 */
import { handoffSession, setHandoffSession } from './session';

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>;
  window: Window | null;
}

function api(): DocumentPictureInPicture | null {
  if (typeof window === 'undefined' || !('documentPictureInPicture' in window)) return null;
  return (window as unknown as { documentPictureInPicture: DocumentPictureInPicture }).documentPictureInPicture;
}

export function pipSupported(): boolean {
  return api() !== null;
}

/** Copies every stylesheet of the opener (Vite <style> tags in dev, <link>ed CSS in production). */
function copyStyles(from: Document, to: Document): void {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n');
      const style = to.createElement('style');
      style.textContent = css;
      to.head.appendChild(style);
    } catch {
      // Cross-origin sheet (e.g. a font CDN): link it instead.
      if (!sheet.href) continue;
      const link = to.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      to.head.appendChild(link);
    }
  }
}

/** Keeps the PiP document's theme attribute in sync with the opener's (System / Light / Dark). */
function mirrorTheme(from: HTMLElement, to: HTMLElement): MutationObserver {
  const apply = () => {
    const theme = from.getAttribute('data-theme');
    if (theme) to.setAttribute('data-theme', theme);
    else to.removeAttribute('data-theme');
    to.className = from.className;
  };
  apply();
  const obs = new MutationObserver(apply);
  obs.observe(from, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  return obs;
}

/** Opens the floating companion (call from a click). Resolves with the window, or null when unsupported / refused. */
export async function openCompanionPip(): Promise<Window | null> {
  const dpip = api();
  if (!dpip) return null;
  const existing = handoffSession().pip;
  if (existing && !existing.closed) {
    existing.focus();
    return existing;
  }
  let win: Window;
  try {
    win = await dpip.requestWindow({ width: 380, height: 620 });
  } catch {
    return null;
  }
  const doc = win.document;
  doc.title = 'Mode · Hand-off';
  const meta = doc.createElement('meta');
  meta.name = 'color-scheme';
  meta.content = 'light dark';
  doc.head.appendChild(meta);
  copyStyles(document, doc);
  const obs = mirrorTheme(document.documentElement, doc.documentElement);
  doc.body.style.margin = '0';
  doc.body.style.height = '100%';
  doc.documentElement.style.height = '100%';
  win.addEventListener('pagehide', () => {
    obs.disconnect();
    if (handoffSession().pip === win) setHandoffSession({ pip: null, companion: 'open' });
  });
  setHandoffSession({ pip: win, companion: 'collapsed' });
  return win;
}

export function closeCompanionPip(): void {
  const win = handoffSession().pip;
  setHandoffSession({ pip: null, companion: 'open' });
  if (win && !win.closed) win.close();
}
