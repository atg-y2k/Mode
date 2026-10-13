/**
 * File names of what Mode itself saves during a hand-off (the photo it
 * downloads when the clipboard is unavailable, or when the user clicks
 * Download). Shared with the server's Downloads watcher, which must never
 * announce these files as a returned result — so this module stays pure
 * (no DOM, no imports) and can be imported from server code.
 */

/** Prefix of every file Mode saves for a hand-off: `mode-handoff-<title>.png`. */
export const HANDOFF_DOWNLOAD_PREFIX = 'mode-handoff-';

/** Whether a file name is one of Mode's own hand-off downloads (not a returned result). */
export function isOwnHandoffDownload(name: string): boolean {
  const base = name.replace(/^.*[\\/]/, '');
  return base.toLowerCase().startsWith(HANDOFF_DOWNLOAD_PREFIX);
}

/** `mode-handoff-new-flagstone-path.png` for a variation title (≤ 40 slug chars; "photo" when empty). */
export function handoffDownloadName(title: string, ext: 'png' | 'jpg' = 'png'): string {
  const slug =
    title
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 40)
      .replace(/^-+|-+$/g, '') || 'photo';
  return `${HANDOFF_DOWNLOAD_PREFIX}${slug}.${ext}`;
}
