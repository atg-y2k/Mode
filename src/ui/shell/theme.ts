/**
 * Appearance preference: System / Light / Dark, persisted in localStorage
 * 'mode.theme'. 'system' removes the override so src/index.css follows the
 * OS; light/dark set <html data-theme>. Also keeps <meta name="theme-color">
 * in sync with the resolved surface color (mobile browser chrome).
 */
import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'mode.theme';

const listeners = new Set<() => void>();
let current: ThemePref = readStoredTheme();

function readStoredTheme(): ThemePref {
  try {
    if (typeof localStorage === 'undefined') return 'system';
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** The theme actually shown. */
export function resolvedTheme(pref: ThemePref = current): 'light' | 'dark' {
  return pref === 'system' ? (prefersDark() ? 'dark' : 'light') : pref;
}

function syncThemeColorMeta() {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  if (color) meta.content = color;
}

/** Applies a preference to the document (no persistence). */
export function applyTheme(pref: ThemePref): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  syncThemeColorMeta();
}

export function getThemePref(): ThemePref {
  return current;
}

export function setThemePref(pref: ThemePref): void {
  current = pref;
  try {
    if (pref === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
  applyTheme(pref);
  listeners.forEach((l) => l());
}

let installed = false;

/** Applies the stored preference and follows OS / other-tab changes. Idempotent. */
export function installTheme(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  applyTheme(current);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (current === 'system') {
      syncThemeColorMeta();
      listeners.forEach((l) => l());
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    current = readStoredTheme();
    applyTheme(current);
    listeners.forEach((l) => l());
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** [preference, setPreference] — every consumer stays in sync. */
export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribe, getThemePref, () => 'system' as ThemePref);
  return [pref, setThemePref];
}
