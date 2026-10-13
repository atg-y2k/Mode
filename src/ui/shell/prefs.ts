/**
 * Per-device preferences that live outside the project document:
 * - image generation defaults (store.studio.provider / quality) persisted in
 *   localStorage 'mode.provider' / 'mode.quality';
 * - the optional server access token ('mode.apiToken', read by src/lib/api.ts).
 */
import type { ImageProviderId } from '../../../shared/api';
import { API_TOKEN_STORAGE_KEY } from '../../lib/api';
import { useStore, type StudioState } from '../../state/store';

export const PROVIDER_STORAGE_KEY = 'mode.provider';
export const QUALITY_STORAGE_KEY = 'mode.quality';

const PROVIDERS: readonly ImageProviderId[] = ['openai', 'gemini'];
const QUALITIES: readonly StudioState['quality'][] = ['draft', 'standard', 'high'];

function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): boolean {
  try {
    if (value === null || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readStoredProvider(): ImageProviderId | null {
  const v = read(PROVIDER_STORAGE_KEY);
  return PROVIDERS.includes(v as ImageProviderId) ? (v as ImageProviderId) : null;
}

export function readStoredQuality(): StudioState['quality'] | null {
  const v = read(QUALITY_STORAGE_KEY);
  return QUALITIES.includes(v as StudioState['quality']) ? (v as StudioState['quality']) : null;
}

let installed = false;

/**
 * Restores the stored generation defaults into the store and persists later
 * changes (from Settings or the Studio prompt bar). Idempotent.
 */
export function installStudioPrefs(): void {
  if (installed) return;
  installed = true;
  const provider = readStoredProvider();
  const quality = readStoredQuality();
  const patch: Partial<StudioState> = {};
  if (provider) patch.provider = provider;
  if (quality) patch.quality = quality;
  if (Object.keys(patch).length) useStore.getState().setStudio(patch);

  useStore.subscribe((s, prev) => {
    if (s.studio.provider !== prev.studio.provider) write(PROVIDER_STORAGE_KEY, s.studio.provider);
    if (s.studio.quality !== prev.studio.quality) write(QUALITY_STORAGE_KEY, s.studio.quality === 'standard' ? null : s.studio.quality);
  });
}

export function readApiToken(): string {
  return read(API_TOKEN_STORAGE_KEY) ?? '';
}

/** Saves (or clears with '') the server access token. Returns false when storage is blocked. */
export function saveApiToken(token: string): boolean {
  return write(API_TOKEN_STORAGE_KEY, token.trim() || null);
}
