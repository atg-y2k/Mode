/** Test doubles for the hand-off server modules (no real folders watched unless a test asks). */
import { EventEmitter } from 'node:events';
import type { FsWatcherLike, WatchFactory, WatchFactoryOptions } from './watcher';

/** 1×1 PNG, JPEG and WebP headers (enough for the byte sniffer). */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0xff, 0xd9]);

/** A controllable stand-in for chokidar: tests emit 'add' / 'change' / 'error' themselves. */
export class FakeFsWatcher extends EventEmitter implements FsWatcherLike {
  closed = false;
  constructor(
    readonly dir: string,
    readonly opts: WatchFactoryOptions,
  ) {
    super();
    queueMicrotask(() => this.emit('ready'));
  }
  async close(): Promise<void> {
    this.closed = true;
    this.removeAllListeners();
  }
  /** Emits like chokidar would, honouring the `ignored` filter. */
  fire(event: 'add' | 'change', path: string): void {
    if (!this.opts.ignored(path)) this.emit(event, path);
  }
}

export function fakeWatchFactory(): WatchFactory & { instances: FakeFsWatcher[] } {
  const instances: FakeFsWatcher[] = [];
  const create: WatchFactory = (dir, opts) => {
    const w = new FakeFsWatcher(dir, opts);
    instances.push(w);
    return w;
  };
  return Object.assign(create, { instances });
}

/** Polls `check` until it returns a truthy value (or throws after `timeoutMs`). */
export async function waitFor<T>(check: () => T | Promise<T>, timeoutMs = 4_000, intervalMs = 20): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
