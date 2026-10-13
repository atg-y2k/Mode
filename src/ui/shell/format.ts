/**
 * Small pure helpers used across the app shell (formatting, file names,
 * keyboard combos, input validation). DOM-free so they are unit-tested in node.
 */

/** "just now", "5 min ago", "yesterday", "3 days ago", "Mar 4", "Mar 4, 2024". */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < 45_000) return 'just now';
  if (diff < hour) {
    const m = Math.max(1, Math.round(diff / min));
    return `${m} min ago`;
  }
  if (diff < day) {
    const h = Math.round(diff / hour);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(diff / day);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** 0 → "0 B", 1536 → "1.5 KB", 12_345_678 → "11.8 MB". */
export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${units[i]}`;
}

/** "2 spaces", "1 photo". */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** File-name safe slug: "Front yard — Option A" → "front-yard-option-a". */
export function slugify(text: string, fallback = 'mode'): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** Joins non-empty parts into a file name: ["My home", "Kitchen"] + "jpg" → "my-home-kitchen.jpg". */
export function exportFileName(parts: (string | undefined | null)[], ext: string): string {
  const base = parts
    .filter((p): p is string => !!p && !!p.trim())
    .map((p) => slugify(p, ''))
    .filter(Boolean)
    .join('-');
  return `${(base || 'mode').slice(0, 120)}.${ext}`;
}

/** Error message as a sentence ("Network down" → "Network down."). */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const msg = raw.trim() || 'Something went wrong';
  return /[.!?…]$/.test(msg) ? msg : `${msg}.`;
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export interface KeyComboLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Undo / redo combos: Ctrl/Cmd+Z = undo, Shift+Ctrl/Cmd+Z = redo, Ctrl+Y = redo
 * (Cmd+Y too on macOS, where some apps use it). The platform modifier is Cmd
 * on macOS and Ctrl elsewhere.
 */
export function matchUndoRedo(e: KeyComboLike, mac: boolean): 'undo' | 'redo' | null {
  if (e.altKey) return null;
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (!mod) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}

/** True on macOS / iOS (Cmd is the shortcut modifier). */
export function isMacPlatform(nav: { platform?: string; userAgent?: string } | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  const p = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(p);
}

/** "⌘Z" on macOS, "Ctrl+Z" elsewhere. */
export function shortcutLabel(key: string, opts: { shift?: boolean; mac: boolean }): string {
  if (opts.mac) return `${opts.shift ? '⇧' : ''}⌘${key.toUpperCase()}`;
  return `Ctrl+${opts.shift ? 'Shift+' : ''}${key.toUpperCase()}`;
}

/** Elements with their own text editing / undo (inputs, textareas, contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as { tagName?: unknown }).tagName !== 'string') return false;
  const el = target as unknown as { tagName: string; isContentEditable?: boolean; type?: string };
  const tag = el.tagName.toLowerCase();
  if (el.isContentEditable) return true;
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (el.type ?? 'text').toLowerCase();
    // Buttons, checkboxes, sliders… don't edit text: let global shortcuts through.
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Location inputs
// ---------------------------------------------------------------------------

/** US ZIP or ZIP+4 ("20817", "20817-1234"). Empty is valid (optional field). */
export function isValidZip(zip: string): boolean {
  const z = zip.trim();
  return z === '' || /^\d{5}(-\d{4})?$/.test(z);
}

/** Normalizes a USDA hardiness zone: " 7A " → "7a"; returns null if it isn't one (1–13, optional a/b). */
export function normalizeZone(zone: string): string | null {
  const m = /^\s*(?:zone\s*)?(\d{1,2})\s*([ab])?\s*$/i.exec(zone);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 13) return null;
  return `${n}${(m[2] ?? '').toLowerCase()}`;
}
