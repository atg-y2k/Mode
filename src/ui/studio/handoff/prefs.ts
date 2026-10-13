/**
 * Per-device hand-off preferences (localStorage): how runs render
 * (store.studio.renderMode / handoffApp), ChatGPT temporary chats, the
 * Downloads-folder watcher, the user's Gemini plan (Free accounts may only
 * get the Lite image model: no reference images, a warning), which export
 * the main button copies (the MARKED photo by default — a visual cue plus
 * the text beats text alone), and optional per-app aspect-ratio overrides.
 * Plus the effective render mode: API mode falls back to hand-off while the
 * server has no image provider — and the variation count that follows it.
 */
import { useSyncExternalStore } from 'react';
import type { HealthResponse } from '../../../../shared/api';
import type { HandoffApp } from '../../../../shared/types';
import { parseRatioList, type RatioSpec } from '../../../handoff/prepare';
import { useStore, type StudioState } from '../../../state/store';

export const RENDER_MODE_KEY = 'mode.renderMode';
export const HANDOFF_APP_KEY = 'mode.handoffApp';
export const TEMPORARY_CHAT_KEY = 'mode.handoffTemporaryChat';
export const WATCH_DOWNLOADS_KEY = 'mode.handoffWatchDownloads';
/** 'free' | 'paid' (a Google AI plan); unset = unknown, treated like Free. */
export const GEMINI_PLAN_KEY = 'mode.geminiPlan';
/** 'marked' (default) | 'clean': which export "Copy photo & open …" puts on the clipboard. */
export const PASTE_IMAGE_KEY = 'mode.handoffPaste';
/** Per-app aspect-ratio overrides, e.g. "1:1, 3:2, 4:3" (advanced). */
export const RATIOS_KEY_PREFIX = 'mode.handoffRatios.';

export type GeminiPlan = 'free' | 'paid';
export type PasteImage = 'marked' | 'clean';

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

/** Variations per run: the user's pick, else 1 per hand-off (each is its own round trip) and 3 when an image API renders. */
export function variationCountOf(
  studio: Pick<StudioState, 'variationCount' | 'renderMode'>,
  health: HealthResponse | null | undefined,
  renderMode = effectiveRenderMode(studio, health),
): number {
  return studio.variationCount ?? (renderMode === 'api' ? 3 : 1);
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

// Preferences with a tiny subscription so components re-render.
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const memo = new Map<string, string | null>();

function cached(key: string): string | null {
  if (!memo.has(key)) memo.set(key, read(key));
  return memo.get(key) ?? null;
}

/** A stored preference (null = unset). */
export function readPref(key: string): string | null {
  return cached(key);
}

/** Stores a preference (null / '' clears it) and re-renders its users. */
export function setPref(key: string, value: string | null): void {
  const v = value === '' ? null : value;
  write(key, v);
  memo.set(key, v);
  for (const l of listeners) l();
}

export function usePref(key: string): string | null {
  return useSyncExternalStore(subscribe, () => cached(key), () => null);
}

export function readToggle(key: string): boolean {
  return cached(key) === '1';
}

export function setToggle(key: string, on: boolean): void {
  setPref(key, on ? '1' : null);
}

export function useToggle(key: string): boolean {
  return usePref(key) === '1';
}

// ---------------------------------------------------------------------------
// Typed preferences
// ---------------------------------------------------------------------------

/** The user's Gemini plan: 'paid' only when they said so (unknown counts as Free). */
export function geminiPlan(value: string | null = readPref(GEMINI_PLAN_KEY)): GeminiPlan | null {
  return value === 'free' || value === 'paid' ? value : null;
}

export function useGeminiPlan(): GeminiPlan | null {
  return geminiPlan(usePref(GEMINI_PLAN_KEY));
}

/**
 * Reference (inspiration) images may go with a hand-off: never to Gemini
 * unless the user has a Google AI plan (Free routes to the Lite model, which
 * "isn't designed for multiple image references").
 */
export function referencesAllowed(app: HandoffApp, plan: GeminiPlan | null): boolean {
  return app !== 'gemini' || plan === 'paid';
}

/** Which export the main button copies: the marked photo unless the user chose the clean one. */
export function pasteImage(value: string | null = readPref(PASTE_IMAGE_KEY)): PasteImage {
  return value === 'clean' ? 'clean' : 'marked';
}

export function usePasteImage(): PasteImage {
  return pasteImage(usePref(PASTE_IMAGE_KEY));
}

/** The user's aspect-ratio list for an app ([] = the defaults). */
export function ratioOverride(app: HandoffApp, value: string | null = readPref(RATIOS_KEY_PREFIX + app)): RatioSpec[] {
  return value ? parseRatioList(value) : [];
}
