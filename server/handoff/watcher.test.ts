import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JPEG_BYTES, PNG_BYTES, fakeWatchFactory, waitFor } from './testing';
import { HANDOFF_DOWNLOAD_PREFIX, handoffDownloadName } from '../../src/handoff/filenames';
import {
  DownloadsWatcher,
  NO_FOLDER_REASON,
  OWN_EXPORT_PREFIX,
  WatchUnavailableError,
  displayPath,
  isCandidateImageName,
  permissionReason,
  resolveWatchDir,
  type WatchEvent,
} from './watcher';

let dir: string;
const watchers: DownloadsWatcher[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mode-handoff-'));
});

afterEach(async () => {
  await Promise.all(watchers.splice(0).map((w) => w.close()));
  rmSync(dir, { recursive: true, force: true });
});

function make(opts: Partial<ConstructorParameters<typeof DownloadsWatcher>[0]> = {}) {
  const w = new DownloadsWatcher({ dir, log: () => undefined, ...opts });
  watchers.push(w);
  return w;
}

function collect(w: DownloadsWatcher) {
  const events: WatchEvent[] = [];
  const unsubscribe = w.subscribe((e) => events.push(e));
  const files = () => events.flatMap((e) => (e.type === 'file' ? [e.file] : []));
  return { events, files, unsubscribe };
}

describe('isCandidateImageName', () => {
  it('accepts finished image downloads only', () => {
    for (const name of ['ChatGPT Image Oct 13, 2026, 10_01_22 AM.png', 'Gemini_Generated_Image_abc.png', 'photo.JPG', 'x.jpeg', 'x.webp', 'x.avif', 'x.gif']) {
      expect(isCandidateImageName(name), name).toBe(true);
    }
    for (const name of [
      'Unconfirmed 123456.crdownload',
      'house.png.crdownload',
      'house.png.part',
      'house.png.download',
      'house.png.tmp',
      '.com.google.Chrome.Xy12',
      '.hidden.png',
      'house.png~',
      'notes.txt',
      'scan.pdf',
      'archive.zip',
      'png',
      'house.heic',
      'mode-handoff-new-flagstone-path.png',
      'Mode-Handoff-photo (1).png',
    ]) {
      expect(isCandidateImageName(name), name).toBe(false);
    }
  });

  it("ignores exactly what the hand-off client saves (shared prefix)", () => {
    expect(OWN_EXPORT_PREFIX).toBe(HANDOFF_DOWNLOAD_PREFIX);
    expect(isCandidateImageName(handoffDownloadName('Curved flagstone path'))).toBe(false);
    expect(isCandidateImageName(handoffDownloadName('Front door', 'jpg'))).toBe(false);
    expect(isCandidateImageName('my-mode-handoff-result.png')).toBe(true);
  });
});

describe('resolveWatchDir / displayPath', () => {
  it('uses HANDOFF_WATCH_DIR, expanding ~, and warns when it is missing', () => {
    mkdirSync(join(dir, 'Saved'));
    expect(resolveWatchDir({ HANDOFF_WATCH_DIR: '~/Saved' }, dir)).toEqual({ dir: join(dir, 'Saved'), warning: null });
    expect(resolveWatchDir({ HANDOFF_WATCH_DIR: join(dir, 'Saved') }, '/nowhere')).toEqual({ dir: join(dir, 'Saved'), warning: null });
    const missing = resolveWatchDir({ HANDOFF_WATCH_DIR: '~/Nope' }, dir);
    expect(missing.dir).toBeNull();
    expect(missing.warning).toMatch(/HANDOFF_WATCH_DIR="~\/Nope" is not a folder/);
  });

  it('falls back to ~/Downloads only when it exists', () => {
    expect(resolveWatchDir({}, dir)).toEqual({ dir: null, warning: null });
    mkdirSync(join(dir, 'Downloads'));
    expect(resolveWatchDir({}, dir)).toEqual({ dir: join(dir, 'Downloads'), warning: null });
  });

  it('shows the home folder as ~', () => {
    expect(displayPath('/home/ann/Downloads', '/home/ann')).toBe('~/Downloads');
    expect(displayPath('/home/annie/Downloads', '/home/ann')).toBe('/home/annie/Downloads');
    expect(displayPath('/data/in', '/home/ann')).toBe('/data/in');
  });
});

describe('DownloadsWatcher (real folder)', () => {
  it('announces only new, finished image files with opaque ids', async () => {
    writeFileSync(join(dir, 'before.png'), PNG_BYTES);
    const w = make({ stabilityMs: 80, pollMs: 20 });
    const { files } = collect(w);
    await w.start();
    expect(w.status()).toMatchObject({ available: true, on: true });

    writeFileSync(join(dir, 'notes.txt'), 'hello');
    writeFileSync(join(dir, 'fake.png'), '<html>not an image</html>');
    writeFileSync(join(dir, 'Unconfirmed 1.crdownload'), PNG_BYTES);
    renameSync(join(dir, 'Unconfirmed 1.crdownload'), join(dir, 'ChatGPT Image.png'));
    writeFileSync(join(dir, 'Gemini_Generated_Image.jpg'), JPEG_BYTES);

    await waitFor(() => files().length >= 2);
    await new Promise((r) => setTimeout(r, 250)); // nothing else trickles in
    const names = files().map((f) => f.name).sort();
    expect(names).toEqual(['ChatGPT Image.png', 'Gemini_Generated_Image.jpg']);
    for (const f of files()) {
      expect(f.id).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(f.id).not.toContain(f.name);
      expect(f.size).toBeGreaterThan(0);
      expect(f.mtime).toBeGreaterThan(0);
      const entry = w.lookup(f.id);
      expect(entry?.path).toBe(join(dir, f.name));
      expect(entry?.mime).toBe(f.name.endsWith('.png') ? 'image/png' : 'image/jpeg');
    }
    expect(w.lookup('not-a-real-id-000000')).toBeNull();
  });

  it('waits for an empty placeholder to be filled (Firefox-style downloads)', async () => {
    const w = make({ stabilityMs: 80, pollMs: 20 });
    const { files } = collect(w);
    await w.start();
    writeFileSync(join(dir, 'result.png'), '');
    await new Promise((r) => setTimeout(r, 300));
    expect(files()).toHaveLength(0);
    writeFileSync(join(dir, 'result.png.part'), PNG_BYTES);
    renameSync(join(dir, 'result.png.part'), join(dir, 'result.png'));
    await waitFor(() => files().length === 1);
    expect(files()[0]).toMatchObject({ name: 'result.png', size: PNG_BYTES.length });
  });
});

describe('DownloadsWatcher lifecycle', () => {
  it('is unavailable without a folder', async () => {
    const w = new DownloadsWatcher({ dir: null, log: () => undefined });
    expect(w.status()).toEqual({ available: false, dir: null, on: false, reason: NO_FOLDER_REASON });
    await expect(w.start()).rejects.toThrow(/no Downloads folder/);
    const misconfigured = new DownloadsWatcher({ dir: null, missingReason: 'HANDOFF_WATCH_DIR="~/Nope" is not a folder.', log: () => undefined });
    expect(misconfigured.status().reason).toBe('HANDOFF_WATCH_DIR="~/Nope" is not a folder.');
  });

  it('reads a real folder fine with the default probe', () => {
    expect(make().status()).toEqual({ available: true, dir: displayPath(dir), on: false });
  });

  it('explains a folder macOS privacy settings keep it from reading (EPERM)', async () => {
    const eperm = () => {
      throw Object.assign(new Error(`EPERM: operation not permitted, opendir '${dir}'`), { code: 'EPERM' });
    };
    const factory = fakeWatchFactory();
    const mac = make({ probeDir: eperm, platform: 'darwin', watchFactory: factory });
    const status = mac.status();
    expect(status).toMatchObject({ available: false, dir: displayPath(dir), on: false });
    expect(status.reason).toBe(permissionReason(displayPath(dir), 'darwin'));
    expect(status.reason).toMatch(/System Settings → Privacy & Security → Files & Folders/);
    expect(status.reason).toMatch(/Full Disk Access/);
    expect(mac.available()).toBe(false);
    // start() refuses instead of watching silently (chokidar would ignore the permission error and see nothing).
    await expect(mac.start()).rejects.toBeInstanceOf(WatchUnavailableError);
    expect(factory.instances).toHaveLength(0);
    // Other systems: plain permission advice.
    const linux = make({ probeDir: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); }, platform: 'linux' });
    expect(linux.status().reason).toMatch(/isn't allowed to read .*permission denied/);
    expect(linux.status().reason).not.toMatch(/System Settings/);
    const odd = make({ probeDir: () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); } });
    expect(odd.status().reason).toMatch(/can't read .*\(EIO\)/);
  });

  it('a permission error while watching stops with the same advice', async () => {
    const factory = fakeWatchFactory();
    const w = make({ watchFactory: factory, platform: 'darwin' });
    const { events } = collect(w);
    await w.start();
    factory.instances[0].emit('error', Object.assign(new Error('EPERM: operation not permitted, scandir'), { code: 'EPERM' }));
    await waitFor(() => !w.on);
    expect(events.at(-1)).toMatchObject({ type: 'stopped', reason: 'error', message: permissionReason(displayPath(dir), 'darwin') });
  });

  it('release() stops at once when nobody listens, else after the last listener leaves', async () => {
    const factory = fakeWatchFactory();
    const w = make({ watchFactory: factory, graceMs: 30 });
    await w.start();
    await w.release();
    expect(w.on).toBe(false);
    expect(factory.instances[0].closed).toBe(true);

    await w.start();
    const a = collect(w);
    await w.release();
    expect(w.on).toBe(true); // a stream is still listening
    a.unsubscribe();
    await waitFor(() => !w.on);
    expect(factory.instances[1].closed).toBe(true);
  });

  it('stops when nobody connects an event stream after a start', async () => {
    const w = make({ watchFactory: fakeWatchFactory(), graceMs: 30 });
    await w.start();
    expect(w.on).toBe(true);
    await waitFor(() => !w.on);
  });

  it('a reconnecting listener within the grace period keeps watching', async () => {
    const w = make({ watchFactory: fakeWatchFactory(), graceMs: 60 });
    await w.start();
    collect(w).unsubscribe();
    const again = collect(w);
    await new Promise((r) => setTimeout(r, 120));
    expect(w.on).toBe(true);
    expect(again.events).toHaveLength(0);
  });

  it('stops after the idle period and tells listeners why', async () => {
    let now = 1_000_000;
    const w = make({ watchFactory: fakeWatchFactory(), idleMs: 40, now: () => now });
    const { events } = collect(w);
    await w.start();
    now += 39;
    await new Promise((r) => setTimeout(r, 70));
    expect(w.on).toBe(true); // activity clock not past the limit yet (timer re-armed)
    now += 10;
    await waitFor(() => !w.on, 1_000);
    expect(events.at(-1)).toMatchObject({ type: 'stopped', reason: 'idle' });
    expect((events.at(-1) as { message: string }).message).toMatch(/30 minutes/);
  });

  it('stops on a watcher error and ignores events from an old watcher', async () => {
    const factory = fakeWatchFactory();
    const w = make({ watchFactory: factory });
    const { events, files } = collect(w);
    await w.start();
    const first = factory.instances[0];
    first.emit('error', new Error('EMFILE'));
    await waitFor(() => !w.on);
    expect(events.at(-1)).toMatchObject({ type: 'stopped', reason: 'error' });
    writeFileSync(join(dir, 'late.png'), PNG_BYTES);
    first.emit('add', join(dir, 'late.png'));
    await new Promise((r) => setTimeout(r, 50));
    expect(files()).toHaveLength(0);
  });

  it('replays recent file events by sequence number and re-announces changed files', async () => {
    const factory = fakeWatchFactory();
    const w = make({ watchFactory: factory });
    const { files } = collect(w);
    await w.start();
    const fsw = factory.instances[0];
    writeFileSync(join(dir, 'a.png'), PNG_BYTES);
    fsw.fire('add', join(dir, 'a.png'));
    await waitFor(() => files().length === 1);
    fsw.fire('change', join(dir, 'a.png')); // same size + mtime: not again
    writeFileSync(join(dir, 'b.png'), PNG_BYTES);
    fsw.fire('add', join(dir, 'b.png'));
    await waitFor(() => files().length === 2);
    writeFileSync(join(dir, 'a.png'), Buffer.concat([PNG_BYTES, Buffer.alloc(10)]));
    fsw.fire('change', join(dir, 'a.png'));
    await waitFor(() => files().length === 3);
    expect(files().map((f) => f.name)).toEqual(['a.png', 'b.png', 'a.png']);
    expect(new Set(files().map((f) => f.id)).size).toBe(3);
    const seqs = w.eventsSince(0).map((e) => (e.type === 'file' ? e.seq : -1));
    expect(seqs).toEqual([1, 2, 3]);
    expect(w.eventsSince(2)).toHaveLength(1);
    // Paths outside the folder (or in sub-folders) never get announced.
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'c.png'), PNG_BYTES);
    fsw.emit('add', join(dir, 'sub', 'c.png'));
    await new Promise((r) => setTimeout(r, 50));
    expect(files()).toHaveLength(3);
  });
});
