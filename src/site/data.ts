/**
 * Loading the bundled site data files from public/data/ (served at
 * `<base>data/<name>`; cached by the service worker for offline use).
 * Safe to import from Node (the server imports the design knowledge, which
 * reads the invasive-plant cache): nothing here runs at module load.
 */

/** URL of a bundled data file, honoring Vite's base path. */
export function dataUrl(name: string): string {
  // import.meta.env only exists under Vite (app + vitest); the server imports this module through tsx.
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}data/${name}`;
}

/** True where relative fetches resolve (a page or worker), false in Node. */
export function canFetchRelative(): boolean {
  return typeof fetch === 'function' && typeof location !== 'undefined' && typeof location.href === 'string';
}

/** Fetches and parses a bundled JSON data file; throws on HTTP or parse errors. */
export async function fetchDataJson(name: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(dataUrl(name), { signal });
  if (!res.ok) throw new Error(`Couldn't load ${name} (HTTP ${res.status}).`);
  return (await res.json()) as unknown;
}
