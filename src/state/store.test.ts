import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Generation, IdeaItem, Photo, SceneMap } from '../../shared/types';
import { emptyBrief } from '../../shared/types';
import * as db from './persistence';
import * as runtime from './runtime';
import { newDesign, useStore } from './store';

// Test hooks into storage: hold blob writes at a gate (to switch projects mid-add),
// record the ids written, make project saves fail.
const io = vi.hoisted(() => ({
  gate: Promise.resolve() as Promise<void>,
  written: [] as string[],
  failSaves: false,
}));

vi.mock('./persistence', async (importOriginal) => {
  const real = await importOriginal<typeof import('./persistence')>();
  return {
    ...real,
    putBlob: async (id: string, blob: Blob) => {
      io.written.push(id);
      await io.gate;
      return real.putBlob(id, blob);
    },
    saveProject: async (...args: Parameters<typeof real.saveProject>) => {
      if (io.failSaves) throw Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' });
      return real.saveProject(...args);
    },
  };
});

// Photo import decodes images in a browser; here it returns fixed pixels.
vi.mock('../lib/imageImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/imageImport')>()),
  importImageFile: async () => ({ blob: new Blob(['full']), thumb: new Blob(['thumb']), width: 40, height: 30 }),
}));

function deferred() {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Longer than the save debounce: the autosave (and the cleanup after it) has run. */
const afterAutosave = () => wait(700);

afterEach(() => {
  io.gate = Promise.resolve();
  io.written = [];
  io.failSaves = false;
});

function photo(id: string): Photo {
  const d = newDesign('Option A');
  return {
    id,
    name: id,
    imageId: `img-${id}`,
    thumbId: `thumb-${id}`,
    width: 100,
    height: 80,
    createdAt: 0,
    regions: [],
    generations: [],
    designs: [d],
    activeDesignId: d.id,
  };
}

function generation(id: string): Generation {
  return {
    id,
    createdAt: 0,
    brief: emptyBrief(),
    mode: 'variations',
    plan: 'plan',
    provider: 'openai',
    model: 'm',
    variations: [],
    status: 'done',
  };
}

function scene(zones: SceneMap['zones'], paths: SceneMap['paths'] = []): SceneMap {
  return {
    category: 'front-yard',
    summary: 's',
    viewpoint: 'v',
    style: 'st',
    boundaries: 'b',
    lighting: 'l',
    orientation: 'o',
    architecture: { style: 'x', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones,
    paths,
    keep: [],
    opportunities: [],
    createdAt: 0,
    model: 'test',
  };
}

const zone = (id: string, extra: Partial<SceneMap['zones'][number]> = {}) => ({
  id,
  kind: 'lawn' as const,
  label: id,
  description: '',
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  editable: true,
  ...extra,
});

beforeEach(async () => {
  await useStore.getState().createProject('Test');
  const spaceId = useStore.getState().addSpace('front-yard');
  useStore.getState().mutateProject('seed', (d) => void d.spaces.find((s) => s.id === spaceId)!.photos.push(photo('p1')), {
    history: false,
  });
  useStore.getState().selectPhoto('p1');
  useStore.setState({ past: [], future: [] });
});

const currentPhoto = () => useStore.getState().project!.spaces[0].photos[0];

describe('history', () => {
  it('keeps non-undoable changes (generations) when undoing an earlier edit', () => {
    const s = useStore.getState();
    s.updateDraft('p1', (b) => void (b.prompt = 'curved flagstone path'));
    s.addGeneration('p1', generation('g1'));
    expect(currentPhoto().generations).toHaveLength(1);

    useStore.getState().undo();
    expect(currentPhoto().draft?.prompt ?? '').toBe('');
    expect(currentPhoto().generations.map((g) => g.id)).toEqual(['g1']);

    useStore.getState().redo();
    expect(currentPhoto().draft?.prompt).toBe('curved flagstone path');
    expect(currentPhoto().generations.map((g) => g.id)).toEqual(['g1']);
  });

  it('keeps a photo uploaded after the edit being undone', () => {
    const s = useStore.getState();
    s.updateSpace(s.project!.spaces[0].id, { name: 'Front' });
    s.mutateProject('Add photo', (d) => void d.spaces[0].photos.push(photo('p2')), { history: false });
    useStore.getState().undo();
    expect(useStore.getState().project!.spaces[0].photos.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('setScene', () => {
  it('keeps user sketches when the scene is re-analyzed', () => {
    const s = useStore.getState();
    s.setScene('p1', scene([zone('lawn')]));
    s.updateScene('p1', (sc) => {
      sc.zones.push(zone('sk', { kind: 'other', label: 'Sketched area 1', source: 'sketch' }));
      sc.paths.push({ id: 'path-sk', label: 'Sketched path', from: 'a', to: 'b', description: '', points: [], widthPx: 8, kind: 'sketch' });
    });

    useStore.getState().setScene('p1', scene([zone('lawn2')], []));
    const sc = currentPhoto().scene!;
    expect(sc.zones.map((z) => z.id)).toEqual(['lawn2', 'sk']);
    expect(sc.paths.map((p) => p.id)).toEqual(['path-sk']);
  });
});

const idea = (extra: Partial<IdeaItem> = {}): Omit<IdeaItem, 'id' | 'createdAt'> => ({
  kind: 'note',
  title: 'idea',
  note: '',
  colors: [],
  spaceIds: [],
  active: true,
  ...extra,
});

const photoIds = (spaceId: string) => useStore.getState().project!.spaces.find((x) => x.id === spaceId)?.photos.map((p) => p.id);

describe('undo barrier: a non-undoable change is never undone away', () => {
  it('"Add space" stops being undoable once a photo and a run landed in the space', () => {
    const s = useStore.getState();
    const spaceId = s.addSpace('backyard');
    s.mutateProject('Add photo', (d) => void d.spaces.find((x) => x.id === spaceId)!.photos.push(photo('p9')), { history: false });
    s.addGeneration('p9', generation('g9'));
    expect(useStore.getState().past.map((e) => e.label)).not.toContain('Add space');

    useStore.getState().undo();
    useStore.getState().updateProjectInfo({ name: 'Renamed' }); // clears redo
    const sp = useStore.getState().project!.spaces.find((x) => x.id === spaceId);
    expect(sp?.photos.map((p) => p.id)).toEqual(['p9']);
    expect(sp?.photos[0].generations.map((g) => g.id)).toEqual(['g9']);
  });

  it('keeps edits made after the photo undoable', () => {
    const s = useStore.getState();
    const spaceId = s.addSpace('backyard');
    s.mutateProject('Add photo', (d) => void d.spaces.find((x) => x.id === spaceId)!.photos.push(photo('p9')), { history: false });
    useStore.getState().renamePhoto('p9', 'Patio');
    expect(useStore.getState().past.map((e) => e.label)).toEqual(['Rename photo']);

    useStore.getState().undo();
    const ph = () => useStore.getState().project!.spaces.find((x) => x.id === spaceId)!.photos[0];
    expect(ph().name).toBe('p9');
    useStore.getState().undo(); // nothing older to undo: the space and photo stay
    expect(photoIds(spaceId)).toEqual(['p9']);
    useStore.getState().redo();
    expect(ph().name).toBe('Patio');
  });

  it('undoing "Add space" of an empty space moves the selection off it', () => {
    const first = useStore.getState().project!.spaces[0].id;
    const spaceId = useStore.getState().addSpace('backyard');
    expect(useStore.getState().selection.spaceId).toBe(spaceId);
    useStore.getState().undo();
    expect(useStore.getState().project!.spaces.map((x) => x.id)).toEqual([first]);
    expect(useStore.getState().selection).toMatchObject({ spaceId: first, photoId: 'p1' });
  });
});

describe('pixel cleanup when undo history is thrown away', () => {
  it('reclaims a deleted surface mask when the project closes', async () => {
    const regionId = useStore.getState().addRegion('wall')!;
    const maskId = currentPhoto().regions[0].maskId;
    await runtime.flushMasks();
    expect(await db.getMask(maskId)).toBeTruthy();
    useStore.getState().deleteRegion(regionId);
    await useStore.getState().closeProject();
    expect(await db.getMask(maskId)).toBeUndefined();
  });

  it('reclaims what only an undone step referenced once a new edit clears redo', async () => {
    useStore.getState().addRegion('wall');
    const maskId = currentPhoto().regions[0].maskId;
    await runtime.flushMasks();
    useStore.getState().undo();
    useStore.getState().renamePhoto('p1', 'Front');
    await afterAutosave();
    expect(await db.getMask(maskId)).toBeUndefined();
  });

  it('redo before closing still restores the surface with its mask', async () => {
    useStore.getState().addRegion('wall');
    const maskId = currentPhoto().regions[0].maskId;
    await runtime.flushMasks();
    useStore.getState().undo();
    await afterAutosave();
    expect(await db.getMask(maskId)).toBeTruthy();
    useStore.getState().redo();
    expect(currentPhoto().regions.map((r) => r.maskId)).toEqual([maskId]);
    const pid = useStore.getState().project!.id;
    await useStore.getState().closeProject();
    expect(await db.getMask(maskId)).toBeTruthy();
    expect((await db.loadProject(pid))!.spaces[0].photos[0].regions.map((r) => r.maskId)).toEqual([maskId]);
  });

  it('a photo uploaded into a new space survives undo, and deleteProject reclaims its pixels', async () => {
    const pid = useStore.getState().project!.id;
    const spaceId = useStore.getState().addSpace('kitchen');
    await db.putBlob('img-pu', new Blob(['x']));
    await db.putBlob('thumb-pu', new Blob(['t']));
    useStore.getState().mutateProject('Add photo', (d) => void d.spaces.find((x) => x.id === spaceId)!.photos.push(photo('pu')), { history: false });
    useStore.getState().undo();
    expect(photoIds(spaceId)).toEqual(['pu']);
    await useStore.getState().closeProject();
    await useStore.getState().deleteProject(pid);
    expect(await db.getBlob('img-pu')).toBeUndefined();
    expect(await db.getBlob('thumb-pu')).toBeUndefined();
  });

  it('reclaims the AI renders of a deleted design option', async () => {
    const dsg = useStore.getState().addDesign('B')!;
    await db.putBlob('render-1', new Blob(['r']));
    useStore.getState().mutateProject('AI render', (d) => {
      d.spaces[0].photos[0].designs.find((x) => x.id === dsg)!.aiRenders.unshift({ id: 'rnd1', imageId: 'render-1', prompt: '', provider: '', createdAt: 0 });
    }, { history: false });
    useStore.getState().deleteDesign(dsg);
    await useStore.getState().closeProject();
    expect(await db.getBlob('render-1')).toBeUndefined();
  });

  it('never deletes pixels the library still uses', async () => {
    await db.putBlob('lib-img', new Blob(['l']));
    useStore.setState({ library: [{ id: 'asset1', name: 'Pot', category: 'decor', aspect: 1, realHeightFt: 1, imageId: 'lib-img' } as never] });
    useStore.getState().mutateProject('Add render', (d) => {
      d.spaces[0].photos[0].designs[0].aiRenders.unshift({ id: 'r', imageId: 'lib-img', prompt: '', provider: '', createdAt: 0 });
    });
    useStore.getState().undo();
    useStore.getState().renamePhoto('p1', 'x');
    await useStore.getState().closeProject();
    expect(await db.getBlob('lib-img')).toBeTruthy();
    useStore.setState({ library: [] });
  });
});

describe('switching projects', () => {
  it('flushes the pending save of the open project before opening another', async () => {
    const aId = useStore.getState().project!.id;
    useStore.getState().updateProjectInfo({ name: 'A renamed' }); // autosave is 500 ms away
    await useStore.getState().createProject('B');
    expect(useStore.getState().project!.name).toBe('B');
    expect((await db.loadProject(aId))?.name).toBe('A renamed');
    await afterAutosave();
    expect((await db.loadProject(aId))?.name).toBe('A renamed');
  });

  it('also when the other project is imported from a backup', async () => {
    const aId = useStore.getState().project!.id;
    const bundle = await db.exportProjectBundle(useStore.getState().project!, []);
    useStore.getState().updateProjectInfo({ name: 'A renamed' });
    await useStore.getState().importProject(bundle);
    expect(useStore.getState().project!.id).not.toBe(aId);
    await afterAutosave();
    expect((await db.loadProject(aId))?.name).toBe('A renamed');
  });
});

describe('async adds stay in the project (and space) they started in', () => {
  it('drops an idea whose images finish storing after another project opened', async () => {
    const gate = deferred();
    io.gate = gate.promise;
    const pending = useStore.getState().addIdeaItem(idea({ kind: 'image', title: 'from A' }), { image: new Blob(['i']), thumb: new Blob(['t']) });
    await useStore.getState().createProject('B');
    gate.open();
    expect(await pending).toBeNull();
    expect(useStore.getState().project!.ideaBoard).toEqual([]);
    expect(io.written).toHaveLength(2);
    for (const id of io.written) expect(await db.getBlob(id)).toBeUndefined();
  });

  it('stops a photo import when another project opens, without adding to it', async () => {
    const spaceId = useStore.getState().project!.spaces[0].id;
    const gate = deferred();
    io.gate = gate.promise;
    const pending = useStore.getState().addPhotos(spaceId, [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')]);
    await useStore.getState().createProject('B');
    gate.open();
    expect(await pending).toEqual([]);
    expect(useStore.getState().project!.spaces).toEqual([]);
    expect(io.written).toHaveLength(2); // the second file was never imported
    for (const id of io.written) expect(await db.getBlob(id)).toBeUndefined();
    expect(useStore.getState().toasts.some((t) => t.kind === 'error' && /closed before the photos finished/.test(t.message))).toBe(true);
  });

  it('reports nothing added when the space is deleted mid-import', async () => {
    const spaceId = useStore.getState().addSpace('backyard');
    const gate = deferred();
    io.gate = gate.promise;
    const pending = useStore.getState().addPhotos(spaceId, [new File(['a'], 'a.jpg')]);
    await useStore.getState().deleteSpace(spaceId);
    gate.open();
    expect(await pending).toEqual([]);
    expect(useStore.getState().project!.spaces.flatMap((x) => x.photos.map((p) => p.id))).toEqual(['p1']);
    for (const id of io.written) expect(await db.getBlob(id)).toBeUndefined();
    expect(useStore.getState().selection.photoId).toBe('p1');
  });

  it('still adds photos normally', async () => {
    const spaceId = useStore.getState().project!.spaces[0].id;
    const ids = await useStore.getState().addPhotos(spaceId, [new File(['a'], 'a.jpg')]);
    expect(ids).toHaveLength(1);
    expect(photoIds(spaceId)).toEqual(['p1', ids[0]]);
    expect(useStore.getState().selection.photoId).toBe(ids[0]);
  });
});

describe('deletes remove pixels only after the document without them is saved', () => {
  it('deletePhoto', async () => {
    const pid = useStore.getState().project!.id;
    await db.putBlob('img-p1', new Blob(['x']));
    await db.putBlob('thumb-p1', new Blob(['t']));
    await useStore.getState().deletePhoto('p1');
    // Nothing waits on the debounce: the document is already saved without the photo.
    expect((await db.loadProject(pid))!.spaces[0].photos).toEqual([]);
    expect(await db.getBlob('img-p1')).toBeUndefined();
    expect(await db.getBlob('thumb-p1')).toBeUndefined();
  });

  it('keeps the pixels when that save fails', async () => {
    const pid = useStore.getState().project!.id;
    await afterAutosave();
    await db.putBlob('img-p1', new Blob(['x']));
    io.failSaves = true;
    await useStore.getState().deletePhoto('p1');
    expect((await db.loadProject(pid))!.spaces[0].photos.map((p) => p.id)).toEqual(['p1']);
    expect(await db.getBlob('img-p1')).toBeTruthy();
    expect(useStore.getState().saveState).toBe('error');
  });

  it('deleteVariation and deleteGeneration', async () => {
    const pid = useStore.getState().project!.id;
    const v = { id: 'v1', imageId: 'vimg', thumbId: 'vthumb', width: 10, height: 10, title: 't', brief: 'b', favorite: false, createdAt: 1 };
    const v2 = { ...v, id: 'v2', imageId: 'vimg2', thumbId: 'vthumb2' };
    for (const id of ['vimg', 'vthumb', 'vimg2', 'vthumb2']) await db.putBlob(id, new Blob([id]));
    useStore.getState().addGeneration('p1', { ...generation('g1'), variations: [v, v2] });
    expect(await useStore.getState().deleteVariation('p1', 'v1')).toBe(true);
    expect((await db.loadProject(pid))!.spaces[0].photos[0].generations[0].variations.map((x) => x.id)).toEqual(['v2']);
    expect(await db.getBlob('vimg')).toBeUndefined();
    await useStore.getState().deleteGeneration('p1', 'g1');
    expect((await db.loadProject(pid))!.spaces[0].photos[0].generations).toEqual([]);
    expect(await db.getBlob('vimg2')).toBeUndefined();
  });
});

describe('deleteSpace and the idea board', () => {
  it('turns off ideas scoped only to the deleted space and keeps other scopes', async () => {
    const gone = useStore.getState().project!.spaces[0].id;
    const other = useStore.getState().addSpace('backyard');
    const only = (await useStore.getState().addIdeaItem(idea({ title: 'no thorny plants', spaceIds: [gone] })))!;
    const both = (await useStore.getState().addIdeaItem(idea({ title: 'warm lanterns', spaceIds: [gone, other] })))!;
    const house = (await useStore.getState().addIdeaItem(idea({ title: 'whole house' })))!;
    await useStore.getState().deleteSpace(gone);
    const board = new Map(useStore.getState().project!.ideaBoard.map((it) => [it.id, it]));
    expect(board.get(only)).toMatchObject({ spaceIds: [], active: false });
    expect(board.get(both)).toMatchObject({ spaceIds: [other], active: true });
    expect(board.get(house)).toMatchObject({ spaceIds: [], active: true });
  });
});
