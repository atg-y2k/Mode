// @vitest-environment node
/**
 * Two tabs on one project (each tab = a fresh copy of the store module, sharing
 * IndexedDB and a fake Web Locks manager): one tab saves, the other is
 * read-only until it takes over; a copy older than the stored one never
 * overwrites it; a read-only tab never deletes pixels.
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as db from './persistence';
import type { useStore as UseStore } from './store';

type Mode = 'exclusive' | 'shared';
type Held = { mode: Mode; abort: (e: unknown) => void };

/** Enough of the Web Locks API for the store: modes, ifAvailable, steal, query. */
class FakeLocks {
  private held = new Map<string, Held[]>();
  private waiting: (() => boolean)[] = [];

  request(name: string, a: unknown, b?: unknown): Promise<unknown> {
    const opts = (typeof a === 'function' ? {} : a) as { mode?: Mode; ifAvailable?: boolean; steal?: boolean };
    const cb = (typeof a === 'function' ? a : b) as (lock: unknown) => unknown;
    const mode = opts.mode ?? 'exclusive';
    return new Promise((resolve, reject) => {
      const grant = (): boolean => {
        let cur = this.held.get(name) ?? [];
        if (opts.steal) {
          for (const h of cur) h.abort(new DOMException('The lock was stolen', 'AbortError'));
          cur = [];
        }
        if (cur.length && !(mode === 'shared' && cur.every((h) => h.mode === 'shared'))) return false;
        const entry: Held = { mode, abort: reject };
        this.held.set(name, [...cur, entry]);
        Promise.resolve()
          .then(() => cb({ name, mode }))
          .then(
            (v) => (this.release(name, entry), resolve(v)),
            (e) => (this.release(name, entry), reject(e)),
          );
        return true;
      };
      if (grant()) return;
      if (opts.ifAvailable) {
        Promise.resolve()
          .then(() => cb(null))
          .then(resolve, reject);
        return;
      }
      this.waiting.push(grant);
    });
  }

  private release(name: string, entry: Held) {
    this.held.set(name, (this.held.get(name) ?? []).filter((h) => h !== entry));
    this.waiting = this.waiting.filter((grant) => !grant());
  }

  async query() {
    return { held: [...this.held].flatMap(([name, hs]) => hs.map((h) => ({ name, mode: h.mode }))), pending: [] };
  }
}

const nav = globalThis.navigator as Navigator & { locks?: unknown };
beforeAll(() => void Object.defineProperty(nav, 'locks', { configurable: true, value: new FakeLocks() }));
afterAll(() => void Reflect.deleteProperty(nav, 'locks'));

/** A fresh store module: what another browser tab would have. */
async function openTab(): Promise<typeof UseStore> {
  vi.resetModules();
  return (await import('./store')).useStore;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const afterAutosave = () => wait(700);
const storedName = async (id: string) => (await db.loadProject(id))?.name;

describe('two tabs on one project', () => {
  it('only one tab saves; the other is read-only until it takes over', async () => {
    const a = await openTab();
    const id = await a.getState().createProject('House');
    expect(a.getState().readOnly).toBeNull();

    const b = await openTab();
    await b.getState().openProject(id);
    expect(b.getState().readOnly).toBe('other-tab');

    b.getState().updateProjectInfo({ name: 'from B' });
    await afterAutosave();
    expect(await storedName(id)).toBe('House');

    a.getState().updateProjectInfo({ name: 'from A' });
    await afterAutosave();
    expect(await storedName(id)).toBe('from A');

    // B takes over: it continues from what A saved, and A stops saving.
    await b.getState().takeOver();
    expect(b.getState().readOnly).toBeNull();
    expect(b.getState().project!.name).toBe('from A');
    await wait(0);
    expect(a.getState().readOnly).toBe('other-tab');

    a.getState().updateProjectInfo({ name: 'A again' });
    b.getState().updateProjectInfo({ name: 'B now' });
    await afterAutosave();
    expect(await storedName(id)).toBe('B now');

    // Closing releases the lock: the next tab to open it may save.
    await b.getState().closeProject();
    const c = await openTab();
    await c.getState().openProject(id);
    expect(c.getState().readOnly).toBeNull();
    await c.getState().closeProject();
    await a.getState().closeProject();
  });

  it('a copy older than the stored document stops saving instead of overwriting it', async () => {
    const a = await openTab();
    const id = await a.getState().createProject('Cottage');
    // Saved elsewhere without this tab's lock (e.g. renamed from another tab's project list).
    const stored = (await db.loadProject(id))!;
    await db.saveProject({ ...stored, name: 'Renamed elsewhere' });

    a.getState().updateProjectInfo({ name: 'Stale edit' });
    await afterAutosave();
    expect(await storedName(id)).toBe('Renamed elsewhere');
    expect(a.getState().readOnly).toBe('stale');

    await a.getState().takeOver();
    expect(a.getState().readOnly).toBeNull();
    expect(a.getState().project!.name).toBe('Renamed elsewhere');
    a.getState().updateProjectInfo({ name: 'After reload' });
    await afterAutosave();
    expect(await storedName(id)).toBe('After reload');
    await a.getState().closeProject();
  });

  it('a read-only tab never deletes pixels the saving tab still uses', async () => {
    const a = await openTab();
    const id = await a.getState().createProject('Barn');
    const spaceId = a.getState().addSpace('kitchen');
    await db.putBlob('img-shared', new Blob(['x']));
    a.getState().mutateProject('Add photo', (d) => {
      const design = { id: 'd1', name: 'A', createdAt: 0, updatedAt: 0, treatments: {}, hiddenRegionIds: [], objects: [], lights: [], lighting: { timeOfDay: 'day', exposure: 0, kelvin: 5500, ambient: 0.75, contrast: 0, saturation: 0 }, aiRenders: [] } as never;
      d.spaces.find((x) => x.id === spaceId)!.photos.push({ id: 'ph', name: 'ph', imageId: 'img-shared', thumbId: 'img-shared', width: 4, height: 4, createdAt: 0, regions: [], generations: [], designs: [design], activeDesignId: 'd1' });
    }, { history: false });
    await afterAutosave();

    const b = await openTab();
    await b.getState().openProject(id);
    expect(b.getState().readOnly).toBe('other-tab');
    await b.getState().deletePhoto('ph');
    await b.getState().deleteSpace(spaceId);
    await b.getState().closeProject();
    expect(await db.getBlob('img-shared')).toBeDefined();
    expect((await db.loadProject(id))!.spaces[0].photos.map((p) => p.id)).toEqual(['ph']);
    await a.getState().closeProject();
  });
});
