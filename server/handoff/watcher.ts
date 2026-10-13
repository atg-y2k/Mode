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
 *   Mode's own hand-off photo downloads (`mode-handoff-*`, the prefix the
 *   hand-off client saves under: src/handoff/filenames.ts).
 * - Before watching, the folder is listed once: on macOS ~/Downloads is
 *   privacy-protected (TCC) and an app without the "Files & Folders"
 *   permission gets EPERM — chokidar would then watch silently and see
 *   nothing. Turning watching on then fails with a `reason` explaining where
 *   to grant access. Listing the folder is also what makes macOS ask for that
 *   access, so status checks never list it: only turning watching on does.
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
import { opendirSync, statSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { watch as chokidarWatch } from 'chokidar';
// Pure module (no DOM): the hand-off client names its downloads with this prefix.
import { HANDOFF_DOWNLOAD_PREFIX, isOwnHandoffDownload } from '../../src/handoff/filenames';
import { sniffImageMime, type SniffedImageMime } from '../studio/util';

/** File extensions a returned image can have (browsers decode all of these). */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'] as const;
/** Suffixes browsers and download managers use while a file is still being written. */
export const PARTIAL_SUFFIXES = ['crdownload', 'part', 'partial', 'download', 'opdownload', 'tmp', 'temp'] as const;
/**
 * Mode's own hand-off photo downloads (the hand-off companion saves
 * `mode-handoff-<title>.png` when the clipboard is unavailable): saved to the
 * same folder while watching, they must not come back as "results".
 */
export const OWN_EXPORT_PREFIX = HANDOFF_DOWNLOAD_PREFIX;

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
  /** When not available: why, and how to fix it (e.g. no folder; whether it can be read is only checked when watching is turned on). */
  reason?: string;
}

/** Opens the folder like a watcher would (throws ENOENT, EPERM, EACCES…). */
export type DirProbe = (dir: string) => void;

/** Lists one entry of the folder: on macOS this is what a missing "Files & Folders" permission refuses. */
export const probeDirReadable: DirProbe = (dir) => {
  const handle = opendirSync(dir);
  try {
    handle.readSync();
  } finally {
    handle.closeSync();
  }
};

export const NO_FOLDER_REASON =
  'This computer has no Downloads folder to watch. Set HANDOFF_WATCH_DIR in .env to the folder your browser saves to, then restart the server.';

/** Why the folder can't be read, with the fix for this platform. */
export function permissionReason(shown: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    return `macOS is blocking Mode from reading ${shown}. Open System Settings → Privacy & Security → Files & Folders and turn on "Downloads Folder" for the app that runs the Mode server (Terminal, iTerm, VS Code…), or add that app under Full Disk Access. Then quit and reopen that app and restart Mode.`;
  }
  return `The Mode server isn't allowed to read ${shown} (permission denied). Give the account that runs the server read access to it, or set HANDOFF_WATCH_DIR in .env to another folder and restart the server.`;
}

/** Thrown by start() when the folder can't be watched; the message says why (safe to show). */
export class WatchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatchUnavailableError';
  }
}

const errorCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : undefined;
const isPermissionError = (err: unknown): boolean => {
  const code = errorCode(err);
  return code === 'EPERM' || code === 'EACCES';
};

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
  /** Checks the folder can be listed (tests inject EPERM). Default: probeDirReadable. */
  probeDir?: DirProbe;
  /** Platform for the permission advice (tests). Default: process.platform. */
  platform?: NodeJS.Platform;
  /** Why `dir` is null, when known (e.g. HANDOFF_WATCH_DIR is not a folder). */
  missingReason?: string | null;
}

/** True for a file name that may be a finished image download. */
export function isCandidateImageName(name: string): boolean {
  if (!name || name.startsWith('.') || name.endsWith('~')) return false;
  if (isOwnHandoffDownload(name)) return false;
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

/** 'denied' = the folder can't even be looked at (macOS privacy protection): it exists, the probe explains. */
function dirState(dir: string): 'dir' | 'missing' | 'denied' {
  try {
    return statSync(dir).isDirectory() ? 'dir' : 'missing';
  } catch (err) {
    return isPermissionError(err) ? 'denied' : 'missing';
  }
}

/** A folder worth trying to watch: a directory, or one the OS won't let us look at yet (permission advice follows). */
const watchable = (dir: string) => dirState(dir) !== 'missing';

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
    if (watchable(dir)) return { dir, warning: null };
    return { dir: null, warning: `HANDOFF_WATCH_DIR="${raw}" is not a folder; the Downloads watcher is off.` };
  }
  if (!home) return { dir: null, warning: null };
  const downloads = join(home, 'Downloads');
  return { dir: watchable(downloads) ? downloads : null, warning: null };
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

export const STOP_MESSAGES: Record<StopReason, string> = {
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
  private readonly probeDir: DirProbe;
  private readonly platform: NodeJS.Platform;
  private readonly missingReason: string | null;

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
  private pending: Promise<void> = Promise.resolve();

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
    this.probeDir = opts.probeDir ?? probeDirReadable;
    this.platform = opts.platform ?? process.platform;
    this.missingReason = opts.missingReason ?? null;
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
    return this.unavailableReason() === null;
  }

  /**
   * Null when the folder can be watched; otherwise why not, worded for the
   * user (no folder, folder gone, or no permission — on macOS: which privacy
   * setting to change). `probe: false` skips listing the folder (no macOS
   * privacy prompt), so a folder that exists counts as watchable.
   */
  unavailableReason(probe = true): string | null {
    const dir = this.dir;
    if (!dir) return this.missingReason ?? NO_FOLDER_REASON;
    const shown = displayPath(dir);
    const state = dirState(dir);
    if (state === 'denied') return permissionReason(shown, this.platform);
    if (state === 'missing') {
      return `${shown} doesn't exist any more. Set HANDOFF_WATCH_DIR in .env to the folder your browser saves to, then restart the server.`;
    }
    if (!probe) return null;
    try {
      this.probeDir(dir);
      return null;
    } catch (err) {
      if (isPermissionError(err)) return permissionReason(shown, this.platform);
      return `The Mode server can't read ${shown} (${errorCode(err) ?? 'unknown error'}). Check the folder, or set HANDOFF_WATCH_DIR in .env to another one and restart the server.`;
    }
  }

  /**
   * For status checks: never lists the folder (on macOS that asks the user for
   * Downloads access before they turned watching on). start() lists it and
   * says why it can't watch.
   */
  status(): WatchStatus {
    const reason = this.unavailableReason(false);
    const shown = this.dir && watchable(this.dir) ? displayPath(this.dir) : null;
    return reason === null ? { available: true, dir: shown, on: this.on } : { available: false, dir: shown, on: this.on, reason };
  }

  /** Starts watching (no-op when already on). Throws WatchUnavailableError when the folder is missing or can't be read. */
  async start(): Promise<void> {
    this.touch();
    if (this.fsw) return;
    if (this.starting) return this.starting;
    const dir = this.dir;
    const reason = this.unavailableReason();
    if (!dir || reason) throw new WatchUnavailableError(reason ?? NO_FOLDER_REASON);
    const generation = ++this.generation;
    this.starting = (async () => {
      const fsw = this.factory(dir, {
        ignored: (p) => resolve(p) !== dir && !isCandidateImageName(basename(p)),
        stabilityMs: this.stabilityMs,
        pollMs: this.pollMs,
      });
      // One file at a time, in event order: downloads are announced in the order they finished.
      const enqueue = (p: string) => {
        this.pending = this.pending.then(() => this.consider(p, generation)).catch(() => undefined);
      };
      fsw.on('add', enqueue);
      fsw.on('change', enqueue);
      fsw.on('error', (err) => {
        if (generation !== this.generation) return;
        this.log(`[handoff] watcher error: ${err instanceof Error ? err.message : String(err)}`);
        void this.stop('error', isPermissionError(err) ? permissionReason(displayPath(dir), this.platform) : undefined);
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

  /** Stops watching and tells every listener why (announced ids stay valid). `message` overrides the default wording. */
  async stop(reason: StopReason, message?: string): Promise<void> {
    this.generation++;
    this.clearTimers();
    const fsw = this.fsw;
    const wasOn = fsw !== null || this.starting !== null;
    this.fsw = null;
    if (fsw) await fsw.close().catch(() => undefined);
    if (wasOn) {
      this.emit({ type: 'stopped', reason, message: message ?? STOP_MESSAGES[reason] });
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
