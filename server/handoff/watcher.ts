/**
 * Downloads-folder watcher for the manual hand-off (SPEC §5.3).
 *
 * While a hand-off is pending the user saves the ChatGPT / Gemini result to
 * their Downloads folder; Mode's local server notices the new image and the
 * page imports it. Nothing here talks to ChatGPT or Gemini — it only looks
 * at files the user saved.
 *
 * - Watches one folder, top level only, for NEW files (chokidar
 *   `ignoreInitial`), after the browser finished writing them
 *   (`awaitWriteFinish`). Only image file names are considered; partial
 *   downloads (.crdownload, .part, .download, .tmp…) and hidden files are
 *   ignored, as are empty placeholders (Firefox creates the final name with
 *   0 bytes, then renames the .part over it — that shows up as a change) and
 *   Mode's own hand-off photo downloads (`mode-handoff-*`).
 * - Each announced file gets a random opaque id; only announced ids map back
 *   to a path, so the file route can never be steered to other files.
 * - Watching runs only while asked: `start()` (POST {on:true}); it stops on
 *   `release()` (POST {on:false}) once no event stream is listening, a few
 *   seconds after the last event stream disconnects (or when none connects
 *   after a start), after 30 minutes without activity, or when the folder
 *   can't be watched any more.
 * - Subscribers (the SSE route) get `file` and `stopped` events; recent file
 *   events can be replayed by sequence number after a reconnect.
 */
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { watch as chokidarWatch } from 'chokidar';
import { sniffImageMime, type SniffedImageMime } from '../studio/util';

/** File extensions a returned image can have (browsers decode all of these). */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'] as const;
/** Suffixes browsers and download managers use while a file is still being written. */
export const PARTIAL_SUFFIXES = ['crdownload', 'part', 'partial', 'download', 'opdownload', 'tmp', 'temp'] as const;
/**
 * Mode's own hand-off photo downloads (src/ui/studio/handoff/Companion.tsx
 * saves `mode-handoff-<title>.png` when the clipboard is unavailable): saved
 * to the same folder while watching, they must not come back as "results".
 */
export const OWN_EXPORT_PREFIX = 'mode-handoff-';

export const WATCH_IDLE_MS = 30 * 60 * 1000;
/** Grace period after the last event stream disconnects (covers EventSource reconnects and page reloads). */
export const WATCH_GRACE_MS = 8_000;
/** Largest file announced / served (a 4K PNG is ~25 MB). */
export const MAX_ANNOUNCED_BYTES = 60 * 1024 * 1024;
/** Announced ids stay valid this long (the user may import a little later). */
export const ANNOUNCED_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ANNOUNCED = 200;
const REPLAY_BUFFER = 50;

export interface AnnouncedFile {
  /** Opaque token for /api/handoff/file. */
  id: string;
  name: string;
  size: number;
  /** Last modification, ms since epoch. */
  mtime: number;
}

export interface AnnouncedEntry extends AnnouncedFile {
  path: string;
  mime: SniffedImageMime;
  announcedAt: number;
}

export type StopReason = 'client' | 'idle' | 'no-listeners' | 'error' | 'shutdown';

export type WatchEvent =
  | { type: 'file'; seq: number; file: AnnouncedFile }
  | { type: 'stopped'; reason: StopReason; message: string };

export interface WatchStatus {
  /** Whether a folder exists that can be watched. */
  available: boolean;
  /** The folder for display ("~/Downloads"), or null. */
  dir: string | null;
  /** Whether watching is currently on. */
  on: boolean;
}

/** The part of chokidar's FSWatcher this module uses (test seam). */
export interface FsWatcherLike {
  on(event: 'add' | 'change', listener: (path: string) => void): unknown;
  on(event: 'error', listener: (err: unknown) => void): unknown;
  once(event: 'ready', listener: () => void): unknown;
  close(): Promise<void>;
}

export interface WatchFactoryOptions {
  /** Return true to skip a path. */
  ignored: (path: string) => boolean;
  stabilityMs: number;
  pollMs: number;
}

export type WatchFactory = (dir: string, opts: WatchFactoryOptions) => FsWatcherLike;

export const chokidarFactory: WatchFactory = (dir, opts) =>
  chokidarWatch(dir, {
    ignoreInitial: true,
    depth: 0,
    followSymlinks: false,
    ignorePermissionErrors: true,
    persistent: true,
    ignored: opts.ignored,
    awaitWriteFinish: { stabilityThreshold: opts.stabilityMs, pollInterval: opts.pollMs },
  }) as unknown as FsWatcherLike;

export interface DownloadsWatcherOptions {
  /** Absolute folder to watch; null = watching unavailable. */
  dir: string | null;
  idleMs?: number;
  graceMs?: number;
  /** awaitWriteFinish: how long the size must stay unchanged (default 1 s). */
  stabilityMs?: number;
  pollMs?: number;
  maxFileBytes?: number;
  /** Max time to wait for the initial scan (large folders), default 15 s. */
  readyTimeoutMs?: number;
  now?: () => number;
  watchFactory?: WatchFactory;
  log?: (line: string) => void;
}

/** True for a file name that may be a finished image download. */
export function isCandidateImageName(name: string): boolean {
  if (!name || name.startsWith('.') || name.endsWith('~')) return false;
  if (name.toLowerCase().startsWith(OWN_EXPORT_PREFIX)) return false;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  if ((PARTIAL_SUFFIXES as readonly string[]).includes(ext)) return false;
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/** "~/Downloads" style path for display (keeps the user name off the wire). */
export function displayPath(dir: string, home: string = homedir()): string {
  if (home && (dir === home || dir.startsWith(home + sep))) return `~${dir.slice(home.length)}`;
  return dir;
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The folder to watch: HANDOFF_WATCH_DIR (a leading "~" means the home
 * folder; relative paths resolve against the server's working directory)
 * or ~/Downloads when it exists. `warning` explains a configured folder that
 * doesn't exist.
 */
export function resolveWatchDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): {
  dir: string | null;
  warning: string | null;
} {
  const raw = env.HANDOFF_WATCH_DIR?.trim();
  if (raw) {
    const expanded = raw === '~' ? home : raw.startsWith('~/') || raw.startsWith('~\\') ? join(home, raw.slice(2)) : raw;
    const dir = resolve(expanded);
    if (isDirectory(dir)) return { dir, warning: null };
    return { dir: null, warning: `HANDOFF_WATCH_DIR="${raw}" is not a folder; the Downloads watcher is off.` };
  }
  if (!home) return { dir: null, warning: null };
  const downloads = join(home, 'Downloads');
  return { dir: isDirectory(downloads) ? downloads : null, warning: null };
}

function randomId(): string {
  return randomBytes(18).toString('base64url');
}

async function sniffFile(path: string): Promise<SniffedImageMime | null> {
  let fh;
  try {
    fh = await open(path, 'r');
    const head = Buffer.alloc(32);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    return sniffImageMime(head.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

const STOP_MESSAGES: Record<StopReason, string> = {
  client: 'Watching the Downloads folder was turned off.',
  idle: 'Stopped watching the Downloads folder after 30 minutes without activity. Turn it on again when you have a new image to bring back.',
  'no-listeners': 'Stopped watching the Downloads folder: no Mode window is listening.',
  error: "The Downloads folder can't be watched any more.",
  shutdown: 'The Mode server is shutting down.',
};

export class DownloadsWatcher {
  readonly dir: string | null;
  private readonly idleMs: number;
  private readonly graceMs: number;
  private readonly stabilityMs: number;
  private readonly pollMs: number;
  private readonly maxFileBytes: number;
  private readonly readyTimeoutMs: number;
  private readonly now: () => number;
  private readonly factory: WatchFactory;
  private readonly log: (line: string) => void;

  private fsw: FsWatcherLike | null = null;
  private starting: Promise<void> | null = null;
  /** Bumped on every start/stop so late callbacks from an old watcher are ignored. */
  private generation = 0;
  private lastActivity = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(e: WatchEvent) => void>();
  private readonly byId = new Map<string, AnnouncedEntry>();
  /** path → last announced size/mtime (a re-saved file with new content is announced again). */
  private readonly byPath = new Map<string, { size: number; mtime: number }>();
  private readonly recent: Extract<WatchEvent, { type: 'file' }>[] = [];
  private seq = 0;

  constructor(opts: DownloadsWatcherOptions) {
    this.dir = opts.dir ? resolve(opts.dir) : null;
    this.idleMs = opts.idleMs ?? WATCH_IDLE_MS;
    this.graceMs = opts.graceMs ?? WATCH_GRACE_MS;
    this.stabilityMs = opts.stabilityMs ?? 1_000;
    this.pollMs = opts.pollMs ?? 150;
    this.maxFileBytes = opts.maxFileBytes ?? MAX_ANNOUNCED_BYTES;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 15_000;
    this.now = opts.now ?? Date.now;
    this.factory = opts.watchFactory ?? chokidarFactory;
    this.log = opts.log ?? ((line) => console.log(line));
  }

  get on(): boolean {
    return this.fsw !== null;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Last event sequence number (for SSE ids). */
  get lastSeq(): number {
    return this.seq;
  }

  available(): boolean {
    return this.dir !== null && isDirectory(this.dir);
  }

  status(): WatchStatus {
    const available = this.available();
    return { available, dir: available && this.dir ? displayPath(this.dir) : null, on: this.on };
  }

  /** Starts watching (no-op when already on). Throws when the folder is missing or can't be watched. */
  async start(): Promise<void> {
    this.touch();
    if (this.fsw) return;
    if (this.starting) return this.starting;
    const dir = this.dir;
    if (!dir || !isDirectory(dir)) throw new Error('There is no Downloads folder to watch on this computer.');
    const generation = ++this.generation;
    this.starting = (async () => {
      const fsw = this.factory(dir, {
        ignored: (p) => resolve(p) !== dir && !isCandidateImageName(basename(p)),
        stabilityMs: this.stabilityMs,
        pollMs: this.pollMs,
      });
      fsw.on('add', (p) => void this.consider(p, generation));
      fsw.on('change', (p) => void this.consider(p, generation));
      fsw.on('error', (err) => {
        if (generation !== this.generation) return;
        this.log(`[handoff] watcher error: ${err instanceof Error ? err.message : String(err)}`);
        void this.stop('error');
      });
      await new Promise<void>((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out scanning the Downloads folder.')), this.readyTimeoutMs);
        timer.unref?.();
        fsw.once('ready', () => {
          clearTimeout(timer);
          resolveReady();
        });
      }).catch(async (err: unknown) => {
        await fsw.close().catch(() => undefined);
        throw err;
      });
      if (generation !== this.generation) {
        // stop() ran while the initial scan was in progress.
        await fsw.close().catch(() => undefined);
        return;
      }
      this.fsw = fsw;
      this.lastActivity = this.now();
      this.scheduleIdle();
      // A client that asked to watch but never connects its event stream (tab closed) doesn't keep it on.
      if (this.listeners.size === 0) this.scheduleGrace();
      this.log(`[handoff] watching ${displayPath(dir)} for returned images`);
    })();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  /**
   * A client no longer needs watching (POST {on:false}). Stops now unless
   * another event stream is still listening; then the last disconnect stops it.
   */
  async release(): Promise<void> {
    if (this.listeners.size === 0) await this.stop('client');
    else this.scheduleGrace();
  }

  /** Stops watching and tells every listener why (announced ids stay valid). */
  async stop(reason: StopReason): Promise<void> {
    this.generation++;
    this.clearTimers();
    const fsw = this.fsw;
    const wasOn = fsw !== null || this.starting !== null;
    this.fsw = null;
    if (fsw) await fsw.close().catch(() => undefined);
    if (wasOn) {
      this.emit({ type: 'stopped', reason, message: STOP_MESSAGES[reason] });
      if (this.dir) this.log(`[handoff] stopped watching ${displayPath(this.dir)} (${reason})`);
    }
  }

  /** Counts as activity for the idle timer (requests, connections, served files). */
  touch(): void {
    this.lastActivity = this.now();
  }

  /** Adds an event listener (one per open event stream). Returns the unsubscribe function. */
  subscribe(listener: (e: WatchEvent) => void): () => void {
    this.listeners.add(listener);
    this.touch();
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    return () => {
      if (!this.listeners.delete(listener)) return;
      if (this.listeners.size === 0 && this.on) this.scheduleGrace();
    };
  }

  /** File events after `seq` still in the replay buffer (for reconnecting streams). */
  eventsSince(seq: number): WatchEvent[] {
    return this.recent.filter((e) => e.seq > seq);
  }

  /** The announced file for an id, or null (unknown, expired). */
  lookup(id: string): AnnouncedEntry | null {
    this.prune();
    return this.byId.get(id) ?? null;
  }

  /** Stops watching and drops every listener (server shutdown, tests). */
  async close(): Promise<void> {
    await this.stop('shutdown');
    this.listeners.clear();
  }

  // ---- internals ----------------------------------------------------------

  private emit(event: WatchEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        this.log(`[handoff] listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async consider(path: string, generation: number): Promise<void> {
    if (generation !== this.generation || !this.dir) return;
    const abs = resolve(path);
    // Top level of the watched folder only, image names only.
    if (dirname(abs) !== this.dir || !isCandidateImageName(basename(abs))) return;
    let st;
    try {
      st = await lstat(abs);
    } catch {
      return; // removed again (renamed by the browser, cleaned up)
    }
    if (!st.isFile() || st.size === 0 || st.size > this.maxFileBytes) return;
    const mtime = Math.round(st.mtimeMs);
    const prev = this.byPath.get(abs);
    if (prev && prev.size === st.size && prev.mtime === mtime) return;
    const mime = await sniffFile(abs);
    if (!mime || generation !== this.generation) return;
    this.byPath.delete(abs); // re-insert last (Map order = recency) and keep the map bounded
    this.byPath.set(abs, { size: st.size, mtime });
    if (this.byPath.size > MAX_ANNOUNCED * 5) this.byPath.delete(this.byPath.keys().next().value as string);
    const entry: AnnouncedEntry = { id: randomId(), name: basename(abs), size: st.size, mtime, path: abs, mime, announcedAt: this.now() };
    this.byId.set(entry.id, entry);
    this.prune();
    const event = { type: 'file' as const, seq: ++this.seq, file: { id: entry.id, name: entry.name, size: entry.size, mtime: entry.mtime } };
    this.recent.push(event);
    if (this.recent.length > REPLAY_BUFFER) this.recent.splice(0, this.recent.length - REPLAY_BUFFER);
    this.touch();
    this.emit(event);
  }

  private prune(): void {
    const cutoff = this.now() - ANNOUNCED_TTL_MS;
    for (const [id, entry] of this.byId) {
      if (entry.announcedAt < cutoff || this.byId.size > MAX_ANNOUNCED) this.byId.delete(id);
      else break; // insertion order = announcement order
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const remaining = Math.max(0, this.lastActivity + this.idleMs - this.now());
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.fsw) return;
      if (this.now() - this.lastActivity >= this.idleMs) void this.stop('idle');
      else this.scheduleIdle();
    }, remaining + 50);
    this.idleTimer.unref?.();
  }

  private scheduleGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.listeners.size === 0 && this.on) void this.stop('no-listeners');
    }, this.graceMs);
    this.graceTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.idleTimer = null;
    this.graceTimer = null;
  }
}
