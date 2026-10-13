/**
 * Per-device hand-off preferences (localStorage): how runs render
 * (store.studio.renderMode / handoffApp), ChatGPT temporary chats, and the
 * Downloads-folder watcher. Plus the effective render mode: API mode falls
 * back to hand-off while the server has no image provider.
 */
import { useSyncExternalStore } from 'react';
import type { HealthResponse } from '../../../../shared/api';
import { useStore, type StudioState } from '../../../state/store';

export const RENDER_MODE_KEY = 'mode.renderMode';
export const HANDOFF_APP_KEY = 'mode.handoffApp';
export const TEMPORARY_CHAT_KEY = 'mode.handoffTemporaryChat';
export const WATCH_DOWNLOADS_KEY = 'mode.handoffWatchDownloads';

function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice applies to this session only.
  }
}

/** True when the server can render with an image API (unknown health counts as no). */
export function hasImageProviders(health: HealthResponse | null | undefined): boolean {
  if (!health?.ok) return false;
  return (health.imageProviders?.length ?? 0) > 0 || health.imageProvider.enabled;
}

/** The render mode a new run uses: API only when chosen AND the server has an image provider. */
export function effectiveRenderMode(studio: Pick<StudioState, 'renderMode'>, health: HealthResponse | null | undefined): StudioState['renderMode'] {
  if (studio.renderMode === 'api' && health && !hasImageProviders(health)) return 'handoff';
  return studio.renderMode;
}

let installed = false;

/** Restores the stored render mode / app and persists later changes. Idempotent. */
export function installHandoffPrefs(): void {
  if (installed) return;
  installed = true;
  const mode = read(RENDER_MODE_KEY);
  const app = read(HANDOFF_APP_KEY);
  const patch: Partial<StudioState> = {};
  if (mode === 'api' || mode === 'handoff') patch.renderMode = mode;
  if (app === 'chatgpt' || app === 'gemini') patch.handoffApp = app;
  if (Object.keys(patch).length) useStore.getState().setStudio(patch);
  useStore.subscribe((s, prev) => {
    if (s.studio.renderMode !== prev.studio.renderMode) write(RENDER_MODE_KEY, s.studio.renderMode);
    if (s.studio.handoffApp !== prev.studio.handoffApp) write(HANDOFF_APP_KEY, s.studio.handoffApp);
  });
}

// Boolean toggles with a tiny subscription so components re-render.
const toggleListeners = new Set<() => void>();
const subscribeToggles = (l: () => void) => {
  toggleListeners.add(l);
  return () => toggleListeners.delete(l);
};

export function readToggle(key: string): boolean {
  return read(key) === '1';
}

export function setToggle(key: string, on: boolean): void {
  write(key, on ? '1' : null);
  memo.set(key, on);
  for (const l of toggleListeners) l();
}

const memo = new Map<string, boolean>();

export function useToggle(key: string): boolean {
  return useSyncExternalStore(
    subscribeToggles,
    () => {
      if (!memo.has(key)) memo.set(key, readToggle(key));
      return memo.get(key)!;
    },
    () => false,
  );
}
