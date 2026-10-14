// @vitest-environment node
import 'fake-indexeddb/auto';
import { clear, createStore, keys, set as idbSet } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetDef, Generation, IdeaItem, Photo, Project } from '../../shared/types';
import { createMask, encodeMaskRLE } from '../engine/mask';
import {
  INTERRUPTED,
  StaleWriteError,
  base64ToBytes,
  bytesToBase64,
  deleteBlobs,
  deleteMasks,
  deleteProject,
  exportProjectBundle,
  generationOwnedIds,
  getBlob,
  getMask,
  importProjectBundle,
  listProjects,
  loadLibrary,
  loadProject,
  loadProjectRecord,
  migrateProject,
  projectMeta,
  putBlob,
  putMask,
  referencedIds,
  saveLibrary,
  saveProject,
  storageErrorText,
  sweepUnreferenced,
  sweepWhenIdle,
} from './persistence';

const raw = {
  projects: createStore('mode-projects', 'projects'),
  meta: createStore('mode-project-meta', 'meta'),
  blobs: createStore('mode-blobs', 'blobs'),
  masks: createStore('mode-masks', 'masks'),
  library: createStore('mode-library', 'library'),
};

beforeEach(async () => {
  await Promise.all(Object.values(raw).map((s) => clear(s)));
});

function blob(text: string, type = 'image/jpeg'): Blob {
  return new Blob([text], { type });
}

function photo(id: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    name: `Photo ${id}`,
    imageId: `${id}-img`,
    thumbId: `${id}-thumb`,
    width: 8,
    height: 4,
    createdAt: 1,
    regions: [{ id: `${id}-r1`, name: 'Wall', surface: 'wall', maskId: `${id}-m1`, color: '#ff0000', createdAt: 1 }],
    generations: [],
    designs: [
      {
        id: `${id}-d1`,
        name: 'Option A',
        createdAt: 1,
        updatedAt: 1,
        treatments: {},
        hiddenRegionIds: [],
        objects: [],
        lights: [],
        lighting: { timeOfDay: 'day', exposure: 0, kelvin: 5500, ambient: 0.75, contrast: 0, saturation: 0 },
        aiRenders: [{ id: 'ren1', imageId: `${id}-render`, prompt: 'p', provider: 'openai', createdAt: 1 }],
      },
    ],
    activeDesignId: `${id}-d1`,
    ...extra,
  };
}

function generation(id: string, extra: Partial<Generation> = {}): Generation {
  return {
    id,
    createdAt: 1,
    brief: {
      prompt: 'warm path',
      elements: [
        {
          id: 'el1',
          type: 'pathway',
          label: 'Path',
          zoneIds: [],
          pathIds: [],
          choices: {},
          note: '',
          dimensions: [
            {
              id: 'material',
              label: 'Material',
              question: 'Which?',
              options: [{ id: 'o1', label: 'Mine', description: '', promptText: 'x', visual: { kind: 'image', imageId: `${id}-optimg` } }],
            },
          ],
        },
      ],
      plantMaturity: 'established',
      ideaItemIds: [],
      targetZoneIds: [],
      scope: 'zones',
    },
    mode: 'variations',
    plan: 'plan',
    provider: 'openai',
    model: 'gpt-image-1',
    variations: [{ id: `${id}-v1`, imageId: `${id}-vimg`, thumbId: `${id}-vthumb`, width: 8, height: 4, title: 't', brief: 'b', favorite: false, createdAt: 1 }],
    status: 'done',
    ...extra,
  };
}

const idea: IdeaItem = {
  id: 'idea1',
  kind: 'image',
  imageId: 'idea-img',
  thumbId: 'idea-thumb',
  title: 'Stone border',
  note: '',
  colors: ['#aabbcc'],
  spaceIds: [],
  active: true,
  createdAt: 1,
};

function project(id = 'prj_a', updatedAt = 100): Project {
  const p1 = photo('p1', {
    generations: [generation('g1')],
    scene: {
      category: 'front-yard',
      summary: '',
      viewpoint: '',
      style: '',
      boundaries: '',
      lighting: '',
      orientation: '',
      architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
      zones: [
        { id: 'z1', kind: 'lawn', label: 'Lawn', description: '', polygon: [], editable: true, maskId: 'p1-m1' },
        { id: 'z2', kind: 'walkway', label: 'Walk', description: '', polygon: [], editable: true, maskId: 'zone-mask' },
      ],
      paths: [],
      keep: [],
      opportunities: [],
      createdAt: 1,
      model: 'm',
    },
  });
  return {
    id,
    version: 1,
    name: 'Maple St',
    createdAt: 1,
    updatedAt,
    location: { zip: '02139' },
    spaces: [
      { id: 's1', name: 'Front yard', type: 'front-yard', kind: 'exterior', createdAt: 1, photos: [p1] },
      { id: 's2', name: 'Kitchen', type: 'kitchen', kind: 'interior', createdAt: 1, photos: [photo('p2')] },
    ],
    ideaBoard: [idea],
    assetList: [],
  };
}

/** Stores every blob / mask the sample project references, with recognizable content. */
async function seedPixels(p: Project): Promise<void> {
  const { blobIds, maskIds } = referencedIds(p);
  for (const id of blobIds) await putBlob(id, blob(`bytes of ${id}`));
  for (const id of maskIds) {
    const m = createMask(8, 4);
    m.data.fill(id.length * 10, 0, 5);
    m.data[31] = 255;
    await putMask(id, m);
  }
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

describe('referencedIds', () => {
  it('collects photos, thumbs, renders, variations, idea images, option images and region/zone masks (deduped)', () => {
    const { blobIds, maskIds } = referencedIds(project());
    expect(blobIds.sort()).toEqual(
      [
        'p1-img', 'p1-thumb', 'p1-render', 'g1-vimg', 'g1-vthumb', 'g1-optimg',
        'p2-img', 'p2-thumb', 'p2-render', 'idea-img', 'idea-thumb',
      ].sort(),
    );
    expect(maskIds.sort()).toEqual(['p1-m1', 'p2-m1', 'zone-mask'].sort());
  });

  it('works on frozen (immer) documents', () => {
    const p = deepFreeze(project());
    expect(() => referencedIds(p)).not.toThrow();
    expect(referencedIds(p).blobIds).toContain('idea-img');
  });

  it('includes what a run owns: its frozen target masks, the hand-off target and staged change maps (backups and cleanup)', () => {
    const p = project();
    const g = generation('h', {
      target: { zones: [{ id: 'z', label: 'Bed', kind: 'planting-bed', polygon: [], maskId: 'run-zone-copy' }], paths: [] },
      handoffTarget: { maskId: 'run-handoff-mask', wholeImage: false },
      planned: [
        {
          id: 'pv',
          title: 'T',
          brief: 'B',
          status: 'staged',
          staged: { imageId: 'st-img', thumbId: 'st-th', source: { kind: 'handoff', app: 'chatgpt' }, review: { changeMapId: 'st-map', blobs: [] } },
        },
      ],
    });
    p.spaces[0].photos[0].generations.push(g);
    const { blobIds, maskIds } = referencedIds(p);
    expect(blobIds).toEqual(expect.arrayContaining(['st-img', 'st-th', 'st-map']));
    expect(maskIds).toEqual(expect.arrayContaining(['run-zone-copy', 'run-handoff-mask']));
    // A run's own ids (deleting it) never include its brief's visuals, which the draft may share.
    const own = generationOwnedIds(g);
    expect(own.maskIds.sort()).toEqual(['run-handoff-mask', 'run-zone-copy']);
    expect(own.blobIds).toEqual(expect.arrayContaining(['st-img', 'st-th', 'st-map']));
    expect(own.blobIds).not.toContain('h-optimg');
  });

  it('a bundle round trip gives a run’s masks fresh ids with their pixels', async () => {
    const p = project();
    p.spaces[0].photos[0].generations.push(generation('h', { handoffTarget: { maskId: 'run-handoff-mask', wholeImage: false } }));
    await seedPixels(p);
    const { project: imported } = await importProjectBundle(await exportProjectBundle(p, []));
    const id = imported.spaces[0].photos[0].generations.find((x) => x.id === 'h')!.handoffTarget!.maskId;
    expect(id).not.toBe('run-handoff-mask');
    expect(await getMask(id)).toBeDefined();
  });
});

describe('projects', () => {
  it('saves, loads and lists through the meta index (newest first)', async () => {
    await saveProject(project('prj_old', 100));
    await saveProject({ ...project('prj_new', 200), name: 'Newer' });
    const list = await listProjects();
    expect(list.map((m) => m.id)).toEqual(['prj_new', 'prj_old']);
    expect(list[0]).toEqual({ id: 'prj_new', name: 'Newer', updatedAt: 200, createdAt: 1, spaceCount: 2, photoCount: 2, coverThumbId: 'p1-thumb' });
    const loaded = await loadProject('prj_old');
    expect(loaded).toEqual(project('prj_old', 100));
    expect(await loadProject('nope')).toBeUndefined();
  });

  it('projectMeta has no cover for projects without photos', () => {
    const p = { ...project(), spaces: [] };
    expect(projectMeta(p)).toEqual({ id: 'prj_a', name: 'Maple St', updatedAt: 100, createdAt: 1, spaceCount: 0, photoCount: 0 });
  });

  it('rebuilds missing meta records and drops orphans', async () => {
    await idbSet('legacy', { ...project('legacy', 50), ideaBoard: undefined }, raw.projects);
    await idbSet('ghost', { id: 'ghost', name: 'Gone', updatedAt: 1, createdAt: 1, spaceCount: 0, photoCount: 0 }, raw.meta);
    const list = await listProjects();
    expect(list.map((m) => m.id)).toEqual(['legacy']);
    expect(list[0].photoCount).toBe(2);
    // Second call is served from the index.
    expect((await listProjects()).map((m) => m.id)).toEqual(['legacy']);
  });

  it('deleteProject removes the document, meta, blobs and masks — but not library images or other projects', async () => {
    const a = project('prj_a');
    const b = { ...project('prj_b'), spaces: [], ideaBoard: [{ ...idea, id: 'other', imageId: 'b-img', thumbId: undefined }] };
    await Promise.all([saveProject(a), saveProject(b), seedPixels(a), putBlob('b-img', blob('b'))]);
    // A library asset that happens to use one of the project's images must survive.
    await saveLibrary([{ id: 'lib1', name: 'Lantern', category: 'lighting', source: 'user', aspect: 1, realHeightFt: 1, tags: [], imageId: 'idea-img' }]);
    await deleteProject('prj_a');
    expect(await loadProject('prj_a')).toBeUndefined();
    expect((await listProjects()).map((m) => m.id)).toEqual(['prj_b']);
    expect(await getBlob('p1-img')).toBeUndefined();
    expect(await getBlob('g1-vimg')).toBeUndefined();
    expect(await getBlob('g1-optimg')).toBeUndefined();
    expect(await getMask('zone-mask')).toBeUndefined();
    expect(await getBlob('idea-img')).toBeDefined();
    expect(await getBlob('b-img')).toBeDefined();
  });
});

describe('migrateProject', () => {
  it('cleans damaged hand-off entries so references can always be listed (and deleteProject cleans up)', async () => {
    const withPlanned = (planned: unknown) => {
      const doc = JSON.parse(JSON.stringify(project()));
      doc.spaces[0].photos[0].generations[0].planned = planned;
      return doc;
    };
    for (const planned of [[null, { id: 'x', handoff: 5 }], {}, [{ title: 'no id' }, 'str']]) {
      expect(() => referencedIds(migrateProject(withPlanned(planned)))).not.toThrow();
    }
    expect(migrateProject(withPlanned([null, { id: 'x', handoff: 5, staged: null }])).spaces[0].photos[0].generations[0].planned).toEqual([
      { id: 'x', status: 'pending' },
    ]);
    expect(migrateProject(withPlanned({})).spaces[0].photos[0].generations[0].planned).toEqual([]);
    expect('planned' in migrateProject(project()).spaces[0].photos[0].generations[0]).toBe(false);

    // Already stored that way: deleteProject still finds (and deletes) every blob.
    const p = project();
    await seedPixels(p);
    await idbSet(p.id, withPlanned([null]), raw.projects);
    await deleteProject(p.id);
    expect(await getBlob('p1-img')).toBeUndefined();
    expect(await getMask('zone-mask')).toBeUndefined();
  });

  it('drops idea scopes of deleted spaces; an idea left with none is turned off, not widened', () => {
    const doc = project();
    doc.ideaBoard = [
      { ...idea, id: 'gone-only', spaceIds: ['s-deleted'] },
      { ...idea, id: 'mixed', spaceIds: ['s-deleted', 's2'] },
      { ...idea, id: 'house', spaceIds: [] },
      { ...idea, id: 'off', spaceIds: ['s1'], active: false },
    ];
    const board = migrateProject(doc).ideaBoard;
    expect(board.map((it) => [it.id, it.spaceIds, it.active])).toEqual([
      ['gone-only', [], false],
      ['mixed', ['s2'], true],
      ['house', [], true],
      ['off', ['s1'], false],
    ]);
  });

  it('fills Studio fields missing from older saves without mutating the input', () => {
    const old = JSON.parse(JSON.stringify(project())) as Record<string, unknown> & Project;
    delete (old as Partial<Project>).ideaBoard;
    delete (old as Partial<Project>).assetList;
    for (const sp of old.spaces) for (const ph of sp.photos) delete (ph as Partial<Photo>).generations;
    const before = JSON.stringify(old);
    const p = migrateProject(old);
    expect(JSON.stringify(old)).toBe(before);
    expect(p.ideaBoard).toEqual([]);
    expect(p.assetList).toEqual([]);
    expect(p.spaces.every((s) => s.photos.every((ph) => Array.isArray(ph.generations) && ph.generations.length === 0))).toBe(true);
    expect(p.spaces[0].photos[0].scene?.zones).toHaveLength(2);
  });

  it('repairs designs, kinds and dangling active design ids', () => {
    const p = project();
    const broken = {
      ...p,
      spaces: [{ ...p.spaces[1], kind: undefined, photos: [{ ...p.spaces[1].photos[0], designs: [], activeDesignId: 'missing' }] }],
    };
    const m = migrateProject(broken);
    const ph = m.spaces[0].photos[0];
    expect(m.spaces[0].kind).toBe('interior');
    expect(ph.designs).toHaveLength(1);
    expect(ph.activeDesignId).toBe(ph.designs[0].id);
    expect(ph.designs[0].lighting.kelvin).toBe(5500);
  });

  it('settles runs left running by a previous page session', () => {
    const p = project();
    p.spaces[0].photos[0].generations = [
      generation('dead', { status: 'running' }),
      generation('empty', { status: 'running', variations: [], planned: [{ id: 'pv', title: 'T', brief: 'B', status: 'pending' }] }),
    ];
    const live = generation('live', { status: 'running', createdAt: Date.now() + 1000 });
    p.spaces[0].photos[0].generations.push(live);
    const gens = migrateProject(p).spaces[0].photos[0].generations;
    expect(gens.map((g) => g.status)).toEqual(['partial', 'failed', 'running']);
    expect(gens[1].error).toBe(INTERRUPTED);
  });

  it('drops runs a previous session left in planning or the review (no plan recorded, nothing rendered)', () => {
    const p = project();
    p.spaces[0].photos[0].generations = [generation('review', { status: 'running', variations: [] }), generation('kept', { status: 'done' })];
    const gens = migrateProject(p).spaces[0].photos[0].generations;
    expect(gens.map((g) => g.id)).toEqual(['kept']);
    // One that owns masks (frozen outline copies) is left for the Studio to remove together with them.
    const q = project();
    q.spaces[0].photos[0].generations = [
      generation('owns', { status: 'running', variations: [], target: { zones: [{ id: 'z', label: 'Bed', kind: 'planting-bed', polygon: [], maskId: 'msk_copy' }], paths: [] } }),
    ];
    expect(migrateProject(q).spaces[0].photos[0].generations.map((g) => [g.id, g.status])).toEqual([['owns', 'running']]);
  });

  it('maps unknown space types by kind and drops null scenes / drafts', () => {
    const p = project();
    const odd = {
      ...p,
      name: '  ',
      spaces: [{ ...p.spaces[0], type: 'gazebo', kind: 'exterior', photos: [{ ...p.spaces[0].photos[0], scene: null, draft: null }] }],
    };
    const m = migrateProject(odd);
    expect(m.name).toBe('My home');
    expect(m.spaces[0].type).toBe('other-exterior');
    expect(m.spaces[0].kind).toBe('exterior');
    expect('scene' in m.spaces[0].photos[0]).toBe(false);
    expect('draft' in m.spaces[0].photos[0]).toBe(false);
  });

  it('rejects non-projects', () => {
    expect(() => migrateProject(null)).toThrow();
    expect(() => migrateProject({ id: 'x' })).toThrow();
  });
});

describe('blobs, masks, library', () => {
  it('round-trips blobs and deletes them', async () => {
    await putBlob('a', blob('hello', 'image/png'));
    const b = await getBlob('a');
    expect(b?.type).toBe('image/png');
    expect(await b?.text()).toBe('hello');
    await deleteBlobs(['a', 'a', 'missing']);
    expect(await getBlob('a')).toBeUndefined();
  });

  it('stores masks RLE-encoded and decodes them losslessly', async () => {
    const m = createMask(300, 200);
    for (let i = 0; i < m.data.length; i++) m.data[i] = i % 7 === 0 ? 255 : i % 5 === 0 ? 128 : 0;
    await putMask('m', m);
    const back = await getMask('m');
    expect(back?.width).toBe(300);
    expect(back?.height).toBe(200);
    expect(back?.data).toEqual(m.data);

    const solid = createMask(1600, 1200);
    await putMask('solid', solid);
    const rec = (await import('idb-keyval')).get<{ rle: Uint8Array }>('solid', raw.masks);
    expect((await rec)!.rle.length).toBeLessThan(16);
    await deleteMasks(['m', 'solid']);
    expect(await getMask('m')).toBeUndefined();
  });

  it('ignores corrupt masks instead of throwing', async () => {
    await idbSet('bad', { width: 4, height: 4, rle: new Uint8Array([1, 0, 3]) }, raw.masks);
    expect(await getMask('bad')).toBeUndefined();
  });

  it('loads an empty library by default and round-trips assets', async () => {
    expect(await loadLibrary()).toEqual([]);
    const asset: AssetDef = { id: 'a1', name: 'Pot', category: 'decor', source: 'user', aspect: 0.8, realHeightFt: 2, tags: [] };
    await saveLibrary([asset]);
    expect(await loadLibrary()).toEqual([asset]);
  });
});

describe('base64', () => {
  it('round-trips arbitrary bytes, including large buffers', () => {
    for (const n of [0, 1, 2, 3, 100, 0x6000 + 1, 200_001]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 255;
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(base64ToBytes(b64)).toEqual(bytes);
    }
  });
});

describe('bundles', () => {
  const libAsset: AssetDef = { id: 'lib-lantern', name: 'Lantern', category: 'lighting', source: 'user', aspect: 0.5, realHeightFt: 1.5, tags: [], imageId: 'lib-img' };

  async function exportSample() {
    const p = project();
    await saveProject(p);
    await seedPixels(p);
    await putBlob('lib-img', blob('lantern png', 'image/png'));
    return { p, bundle: await exportProjectBundle(p, [libAsset]) };
  }

  it('exports valid JSON in the documented format', async () => {
    const { p, bundle } = await exportSample();
    expect(bundle.type).toBe('application/json');
    const json = JSON.parse(await bundle.text());
    expect(json.format).toBe('mode-project');
    expect(json.version).toBe(1);
    expect(json.project).toEqual(p);
    expect(json.library).toEqual([libAsset]);
    expect(Object.keys(json.blobs).sort()).toEqual([...referencedIds(p).blobIds, 'lib-img'].sort());
    expect(json.blobs['p1-img']).toBe(`data:image/jpeg;base64,${Buffer.from('bytes of p1-img').toString('base64')}`);
    expect(json.masks['zone-mask']).toMatchObject({ width: 8, height: 4 });
  });

  it('imports as a new project with remapped ids, intact pixels and merged library', async () => {
    const { p, bundle } = await exportSample();
    // Fresh device: wipe everything, then import.
    await Promise.all(Object.values(raw).map((s) => clear(s)));
    const { project: imp, library } = await importProjectBundle(bundle);
    expect(imp.id).not.toBe(p.id);
    expect(imp.name).toBe('Maple St');
    expect(await loadProject(imp.id)).toEqual(imp);
    expect((await listProjects()).map((m) => m.id)).toEqual([imp.id]);

    const ph = imp.spaces[0].photos[0];
    expect(ph.imageId).not.toBe('p1-img');
    expect(await (await getBlob(ph.imageId))?.text()).toBe('bytes of p1-img');
    expect(await (await getBlob(ph.generations[0].variations[0].thumbId))?.text()).toBe('bytes of g1-vthumb');
    const optVisual = ph.generations[0].brief.elements[0].dimensions[0].options[0].visual;
    expect(optVisual?.kind === 'image' && (await (await getBlob(optVisual.imageId))?.text())).toBe('bytes of g1-optimg');
    expect(await (await getBlob(imp.ideaBoard[0].imageId!))?.text()).toBe('bytes of idea-img');

    // Region and zone sharing one mask keep sharing the (new) id.
    expect(ph.scene!.zones[0].maskId).toBe(ph.regions[0].maskId);
    expect(ph.regions[0].maskId).not.toBe('p1-m1');
    const mask = await getMask(ph.regions[0].maskId);
    expect(mask?.data[31]).toBe(255);
    expect(mask?.data[0]).toBe('p1-m1'.length * 10);

    expect(library).toHaveLength(1);
    expect(library[0].imageId).not.toBe('lib-img');
    expect(await (await getBlob(library[0].imageId!))?.text()).toBe('lantern png');
    expect(await loadLibrary()).toEqual(library);
  });

  it('importing twice never collides and keeps the stored library copy', async () => {
    const { p, bundle } = await exportSample();
    await saveLibrary([libAsset]);
    const a = await importProjectBundle(bundle);
    const b = await importProjectBundle(bundle);
    expect(new Set([p.id, a.project.id, b.project.id]).size).toBe(3);
    expect(a.project.name).toBe('Maple St (imported)');
    const ra = referencedIds(a.project);
    const rb = referencedIds(b.project);
    const orig = referencedIds(p);
    const all = [...ra.blobIds, ...rb.blobIds, ...orig.blobIds];
    expect(new Set(all).size).toBe(all.length);
    expect(a.library).toEqual([libAsset]);
    expect(await loadLibrary()).toEqual([libAsset]);
    // The original's pixels are untouched.
    expect(await (await getBlob('p1-img'))?.text()).toBe('bytes of p1-img');
  });

  it('migrates old projects inside bundles', async () => {
    const old = JSON.parse(JSON.stringify(project()));
    delete old.ideaBoard;
    for (const sp of old.spaces) for (const ph of sp.photos) delete ph.generations;
    const file = new Blob([JSON.stringify({ format: 'mode-project', version: 1, project: old, blobs: {}, masks: {}, library: [] })]);
    const { project: imp } = await importProjectBundle(file);
    expect(imp.ideaBoard).toEqual([]);
    expect(imp.spaces[1].photos[0].generations).toEqual([]);
  });

  it('skips unreadable images and masks instead of failing the whole import', async () => {
    const p = project();
    const file = new Blob([
      JSON.stringify({
        format: 'mode-project',
        version: 1,
        project: p,
        blobs: { 'p1-img': 'not a data url', 'p1-thumb': 'data:image/jpeg;base64,AAAA' },
        masks: { 'p1-m1': { width: 8, height: 4, rle: 'AQAB' } },
        library: [{ id: 'broken' }],
      }),
    ]);
    const { project: imp, library } = await importProjectBundle(file);
    const ph = imp.spaces[0].photos[0];
    expect(await getBlob(ph.imageId)).toBeUndefined();
    expect((await getBlob(ph.thumbId))?.size).toBe(3);
    expect(await getMask(ph.regions[0].maskId)).toBeUndefined();
    expect(library).toEqual([]);
  });

  it('rejects files that are not valid backups with clear messages', async () => {
    await expect(importProjectBundle(new Blob([]))).rejects.toThrow(/empty/);
    await expect(importProjectBundle(new Blob(['{nope']))).rejects.toThrow(/not valid JSON/);
    await expect(importProjectBundle(new Blob([JSON.stringify({ hello: 1 })]))).rejects.toThrow(/isn't a Mode project backup/);
    await expect(importProjectBundle(new Blob([JSON.stringify({ format: 'mode-project', version: 9, project: {} })]))).rejects.toThrow(/newer version/);
    const p = project();
    (p.spaces[0].photos[0] as unknown as Record<string, unknown>).width = 'wide';
    await expect(importProjectBundle(new Blob([JSON.stringify({ format: 'mode-project', version: 1, project: p })]))).rejects.toThrow(
      /damaged.*project\.spaces\[0\]\.photos\[0\]\.width/,
    );
    expect(await listProjects()).toEqual([]);
  });

  it('rejects a damaged hand-off entry with the "damaged" message (not a TypeError)', async () => {
    const p = project();
    p.spaces[0].photos[0].generations[0].planned = [{ id: 'pl1', title: 't', brief: 'b', status: 'done' }, null as never];
    await expect(importProjectBundle(new Blob([JSON.stringify({ format: 'mode-project', version: 1, project: p })]))).rejects.toThrow(
      /damaged.*planned\[1\]/,
    );
    expect(await listProjects()).toEqual([]);
  });

  /** Makes every put into one object store fail like a full disk. */
  function failPuts(storeName: string): () => void {
    const proto = IDBObjectStore.prototype;
    const put = proto.put;
    proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === storeName) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.apply(this, args);
    };
    return () => void (proto.put = put);
  }

  for (const storeName of ['projects', 'meta']) {
    it(`rolls everything back when the ${storeName} write fails, so a retry starts clean`, async () => {
      const { bundle } = await exportSample();
      await Promise.all(Object.values(raw).map((s) => clear(s)));
      const prior: AssetDef[] = [{ ...libAsset, id: 'lib-other', name: 'Bench', imageId: undefined }];
      await saveLibrary(prior);
      const restore = failPuts(storeName);
      try {
        await expect(importProjectBundle(bundle)).rejects.toThrow(/out of storage space for Mode.*Settings → Storage/);
      } finally {
        restore();
      }
      expect(await loadLibrary()).toEqual(prior); // no entries pointing at deleted images
      expect(await listProjects()).toEqual([]);
      expect(await keys(raw.projects)).toEqual([]);
      expect(await keys(raw.blobs)).toEqual([]);
      expect(await keys(raw.masks)).toEqual([]);

      const { project: imp, library } = await importProjectBundle(bundle);
      expect((await listProjects()).map((m) => m.id)).toEqual([imp.id]);
      const lib = await loadLibrary();
      expect(lib.map((a) => a.id)).toEqual(['lib-other', 'lib-lantern']);
      expect(await getBlob(library[0].imageId!)).toBeDefined();
      expect(await getBlob(lib[1].imageId!)).toBeDefined();
    });
  }
});

describe('saving with a revision check (two tabs)', () => {
  it('counts saves and refuses a write from a copy older than the stored one', async () => {
    const p = project();
    expect(await saveProject(p)).toBe(1);
    const rec = await loadProjectRecord(p.id);
    expect(rec?.rev).toBe(1);
    expect(rec?.project).toEqual(p); // the counter is not part of the model
    expect(await saveProject({ ...p, name: 'Tab A' }, { expectedRev: 1 })).toBe(2);
    await expect(saveProject({ ...p, name: 'Tab B (stale)' }, { expectedRev: 1 })).rejects.toBeInstanceOf(StaleWriteError);
    expect((await loadProject(p.id))?.name).toBe('Tab A');
    expect((await listProjects())[0].name).toBe('Tab A');
  });

  it('refuses to bring back a project deleted elsewhere', async () => {
    const p = project();
    await saveProject(p);
    await deleteProject(p.id);
    await expect(saveProject(p, { expectedRev: 1 })).rejects.toBeInstanceOf(StaleWriteError);
    expect(await loadProject(p.id)).toBeUndefined();
    expect(await listProjects()).toEqual([]);
  });
});

describe('sweepUnreferenced', () => {
  const storedMask = () => ({ width: 8, height: 4, rle: encodeMaskRLE(createMask(8, 4)) });

  /** Leftovers from an earlier page session: written straight to the stores, not through putBlob / putMask. */
  async function seedEarlierSession(p: Project, extra: { blobs?: string[]; masks?: string[] } = {}) {
    const refs = referencedIds(p);
    for (const id of [...refs.blobIds, ...(extra.blobs ?? [])]) await idbSet(id, blob(id), raw.blobs);
    for (const id of [...refs.maskIds, ...(extra.masks ?? [])]) await idbSet(id, storedMask(), raw.masks);
  }

  it('deletes only blobs and masks that no project, the library or `keep` references', async () => {
    const p = project();
    await saveProject(p);
    await seedEarlierSession(p, { blobs: ['orphan-blob', 'lib-img', 'kept'], masks: ['orphan-mask'] });
    await saveLibrary([{ id: 'lib1', name: 'Lantern', category: 'lighting', source: 'user', aspect: 1, realHeightFt: 1, tags: [], imageId: 'lib-img' }]);
    await putBlob('written-now', blob('fresh')); // this session's put-then-save flows are never swept

    expect(await sweepUnreferenced(new Set(['kept']))).toEqual({ blobs: 1, masks: 1 });
    const blobs = (await keys(raw.blobs)).map(String);
    expect(blobs).not.toContain('orphan-blob');
    expect(blobs).toEqual(expect.arrayContaining([...referencedIds(p).blobIds, 'lib-img', 'kept', 'written-now']));
    const masks = (await keys(raw.masks)).map(String);
    expect(masks.sort()).toEqual([...referencedIds(p).maskIds].sort());
  });

  it('deletes nothing when a project document is unreadable', async () => {
    const p = project();
    await saveProject(p);
    await seedEarlierSession(p, { blobs: ['orphan-blob'] });
    await idbSet('broken', { id: 'broken', spaces: 'not a list' }, raw.projects);
    await expect(sweepUnreferenced()).rejects.toThrow(/Not a Mode project/);
    expect((await keys(raw.blobs)).map(String)).toContain('orphan-blob');
  });

  describe('sweepWhenIdle', () => {
    const nav = globalThis.navigator as Navigator & { locks?: unknown };
    afterEach(() => void Reflect.deleteProperty(nav, 'locks'));

    function fakeLocks(opts: { gcFree: boolean; held: string[] }) {
      Object.defineProperty(nav, 'locks', {
        configurable: true,
        value: {
          request: (_name: string, _o: unknown, cb: (lock: unknown) => unknown) => Promise.resolve(cb(opts.gcFree ? { name: 'mode-gc' } : null)),
          query: async () => ({ held: opts.held.map((name) => ({ name, mode: 'exclusive' })), pending: [] }),
        },
      });
    }

    it('skips without Web Locks (other tabs cannot be ruled out)', async () => {
      await idbSet('orphan-blob', blob('x'), raw.blobs);
      expect(await sweepWhenIdle()).toBeNull();
      expect((await keys(raw.blobs)).map(String)).toContain('orphan-blob');
    });

    it('skips while a tab has a project open, sweeps when idle', async () => {
      await idbSet('orphan-blob', blob('x'), raw.blobs);
      fakeLocks({ gcFree: false, held: [] });
      expect(await sweepWhenIdle()).toBeNull();
      fakeLocks({ gcFree: true, held: ['mode-project:prj_x'] });
      expect(await sweepWhenIdle()).toBeNull();
      expect((await keys(raw.blobs)).map(String)).toContain('orphan-blob');
      fakeLocks({ gcFree: true, held: [] });
      expect(await sweepWhenIdle()).toEqual({ blobs: 1, masks: 0 });
      expect(await keys(raw.blobs)).toEqual([]);
    });
  });
});

describe('storageErrorText', () => {
  it('says what to do when the browser is out of storage', () => {
    for (const err of [new DOMException('The quota has been exceeded.', 'QuotaExceededError'), new Error('QuotaExceededError: quota reached')]) {
      expect(storageErrorText(err)).toMatch(/^This browser is out of storage space for Mode\. .*Settings → Storage/);
    }
  });

  it('keeps other errors as they are', () => {
    expect(storageErrorText(new Error('Database closed'))).toBe('Database closed');
  });
});
