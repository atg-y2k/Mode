/**
 * Hand-off preparation and import against the real store, pack and actions
 * (the engine's export / alignment and image encoding are faked; the
 * composite is the real pipeline): the run's target stays the one that was
 * pasted, imports use the pack the result came from, app switches can't
 * save a stale pack, and staging checks survive a reload.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyBrief, type DesignBrief, type Generation, type HandoffPack, type Photo, type PlannedVariation, type Project, type SceneMap } from '../../../../shared/types';
import type { ImageDataLike, Mask } from '../../../engine/types';

const W = 100;
const H = 80;
const PHOTO_RGB = [120, 130, 110];
const MODEL_RGB = [220, 20, 20];

/** Each export waits until the test resolves it. */
const exports: { app: string; target: Mask; resolve: (v: unknown) => void }[] = [];
/** What each import was given. */
const imports: { target: Mask; pack: { crop: HandoffPack['crop']; outW: number; outH: number }; composite: ImageDataLike }[] = [];
let insideUnchanged = false;
let importGate: Promise<void> | null = null;

vi.mock('../../../handoff', async (orig) => {
  const actual = await orig<typeof import('../../../handoff')>();
  const { runImport } = await import('../../../handoff/pipeline');
  return {
    ...actual,
    prepareHandoff: vi.fn((_img: ImageDataLike, target: Mask, opts: { app: string }) => new Promise((resolve) => exports.push({ app: opts.app, target, resolve }))),
    importHandoffResult: vi.fn(async (_photo: unknown, original: ImageDataLike, target: Mask, pack: Pick<HandoffPack, 'crop' | 'outW' | 'outH'>) => {
      if (importGate) await importGate;
      // The model redrew the whole frame in red.
      const data = new Uint8ClampedArray(pack.outW * pack.outH * 4);
      for (let i = 0; i < pack.outW * pack.outH; i++) data.set([...MODEL_RGB, 255], i * 4);
      const res = runImport(null, { original, target, crop: pack.crop, outW: pack.outW, outH: pack.outH, returned: { width: pack.outW, height: pack.outH, data } });
      imports.push({ target, pack: { crop: { ...pack.crop }, outW: pack.outW, outH: pack.outH }, composite: res.composite });
      return { ...res, insideCheck: { medianInside: insideUnchanged ? 0.5 : 40, medianOutside: 1, unchanged: insideUnchanged } };
    }),
  };
});
vi.mock('../../../state/runtime', async (orig) => {
  const actual = await orig<typeof import('../../../state/runtime')>();
  return {
    ...actual,
    loadPhotoImage: vi.fn(async (p: Photo) => {
      const d = new Uint8ClampedArray(p.width * p.height * 4);
      for (let i = 0; i < d.length; i += 4) d.set([...PHOTO_RGB, 255], i);
      return { width: p.width, height: p.height, data: d };
    }),
  };
});
vi.mock('../../../lib/imageImport', async (orig) => {
  const actual = await orig<typeof import('../../../lib/imageImport')>();
  return { ...actual, imageDataToBlob: vi.fn(async (_img: ImageDataLike, type = 'image/png') => new Blob(['x'], { type })) };
});
vi.mock('../composite', async (orig) => {
  const actual = await orig<typeof import('../composite')>();
  return { ...actual, thumbnailBlob: vi.fn(async () => new Blob(['t'], { type: 'image/jpeg' })) };
});

const db = await import('../../../state/persistence');
const { findPhoto, newDesign, useStore } = await import('../../../state/store');
const { acceptStaged, importInto, skipPlanned, switchPendingApp, OUTLINE_CHANGED_MESSAGE } = await import('./actions');
const { ensurePack, forgetRunCaches, reprepareRun, targetOutlineChanged } = await import('./pack');
const { freezeRunTarget } = await import('./target');
const { handoffSession, setHandoffSession } = await import('./session');
const { HANDOFF_LOG_KEY, recordHandoff, resetHandoffLogCache } = await import('./log');
const { TARGET_LOST_MESSAGE } = await import('../maskFromZones');

const square = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id,
  kind: 'walkway' as const,
  label: 'Walkway',
  description: '',
  polygon: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  editable: true,
});
const sceneWith = (...zones: ReturnType<typeof square>[]): SceneMap =>
  ({
    category: 'front-yard',
    summary: '',
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones,
    paths: [],
    keep: [],
    opportunities: [],
    createdAt: 0,
    model: 'test',
  }) as SceneMap;

const ref = (plannedId = 'a') => ({ photoId: 'pho', generationId: 'gen', plannedId });
const photo = () => findPhoto(useStore.getState().project, 'pho')!.photo;
const gen = () => photo().generations[0];
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function setup(opts: { planned: PlannedVariation[]; scene?: SceneMap; brief?: DesignBrief; frozen?: boolean; app?: 'chatgpt' | 'gemini' }): void {
  const brief = opts.brief ?? emptyBrief();
  const g: Generation = {
    id: 'gen',
    createdAt: 0,
    brief,
    mode: 'variations',
    plan: 'Plan',
    provider: 'ChatGPT',
    model: 'hand-off',
    variations: [],
    status: 'awaiting',
    renderMode: 'handoff',
    planned: opts.planned,
  };
  const design = newDesign('A');
  const ph: Photo = {
    id: 'pho',
    name: 'Front',
    imageId: 'img',
    thumbId: 'th',
    width: W,
    height: H,
    createdAt: 0,
    regions: [],
    generations: [g],
    designs: [design],
    activeDesignId: design.id,
    ...(opts.scene ? { scene: opts.scene } : {}),
  };
  // New runs freeze their target when they start (generate.ts startRun).
  if (opts.frozen) g.target = freezeRunTarget('gen', ph, brief);
  const project: Project = {
    id: 'prj',
    version: 1,
    name: 'T',
    createdAt: 0,
    updatedAt: 0,
    location: {},
    spaces: [{ id: 'spc', name: 'Front', type: 'front-yard', kind: 'exterior', photos: [ph], createdAt: 0 }],
    ideaBoard: [],
    assetList: [],
  };
  useStore.setState({
    project,
    selection: { spaceId: 'spc', photoId: 'pho', regionId: null, objectId: null, lightId: null },
    past: [],
    future: [],
    studio: { ...useStore.getState().studio, renderMode: 'handoff', handoffApp: opts.app ?? 'chatgpt', viewVariationId: null, gridGenerationId: null },
  });
  setHandoffSession({ active: null, staging: null, companion: 'open', extras: {}, jobs: {}, errors: {} });
}

const prepared = (app: string, target: Mask, crop = { x: 0, y: 0, w: W, h: H }, out = { w: 500, h: 400 }) => {
  let any = false;
  for (const v of target.data) if (v < 255) any = true;
  return {
    clean: new Blob(['c'], { type: 'image/jpeg' }),
    marked: new Blob(['m'], { type: 'image/png' }),
    crop,
    outW: out.w,
    outH: out.h,
    markerColor: any ? '#ff00ff' : '',
    markerColorName: any ? 'magenta' : '',
    ratio: '5:4',
    mode: 'full',
    coverage: 0.2,
    app,
  };
};

/** Prepares the item's pack, resolving the export the engine was asked for. */
async function preparePack(plannedId = 'a', app?: 'chatgpt' | 'gemini'): Promise<HandoffPack> {
  const p = ensurePack(ref(plannedId), app ? { app } : {});
  for (let i = 0; i < 50 && exports.length === 0; i++) await tick(2);
  const e = exports.shift()!;
  e.resolve(prepared(e.app, e.target));
  return p;
}

const px = (img: ImageDataLike, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
const coverage = (m: Mask) => m.data.reduce((n, v) => n + (v > 127 ? 1 : 0), 0) / m.data.length;
const sameMask = (a: Mask, b: Mask) => a.width === b.width && a.data.every((v, i) => v === b.data[i]);

beforeEach(() => {
  exports.length = 0;
  imports.length = 0;
  insideUnchanged = false;
  importGate = null;
  forgetRunCaches('gen');
  try {
    localStorage.removeItem(HANDOFF_LOG_KEY);
  } catch {
    // no localStorage in node
  }
  resetHandoffLogCache();
});

const walkBrief = (): DesignBrief => ({ ...emptyBrief(), prompt: 'flagstones', targetZoneIds: ['zone_old'] });
const returned = () => new Blob(['r'], { type: 'image/png' });

describe('the run keeps the target that was pasted (scene re-analysed between prepare and import)', () => {
  it('a new run composites against its frozen outline after a re-map gives the zones new ids', async () => {
    setup({ planned: [{ id: 'a', title: 'A', brief: 'Lay flagstones', status: 'awaiting-handoff' }], scene: sceneWith(square('zone_old', 10, 10, 40, 40)), brief: walkBrief(), frozen: true });
    const pack = await preparePack();
    expect(pack.markerColor).toBe('#ff00ff');
    useStore.getState().setScene('pho', sceneWith(square('zone_new', 10, 10, 40, 40))); // "Re-map scene": fresh ids
    forgetRunCaches('gen'); // a reload / LRU eviction
    expect(await importInto(ref(), returned())).toBe(true);
    expect(imports).toHaveLength(1);
    const target = imports[0].target;
    expect(coverage(target)).toBeGreaterThan(0.08);
    expect(coverage(target)).toBeLessThan(0.3);
    expect(target.data[25 * W + 25]).toBe(255); // the walk the user outlined
    expect(target.data[70 * W + 85]).toBe(0);
    expect(px(imports[0].composite, 85, 70)).toEqual(PHOTO_RGB); // outside the outline: the original photo
    expect(gen().planned![0].staged?.source.alignment?.outsideChanged).toBeGreaterThan(0.5); // the redraw outside was noticed (and dropped)
  });

  it('a run from an older save (no snapshot) uses the mask its first export froze, even after the scene changed', async () => {
    setup({ planned: [{ id: 'a', title: 'A', brief: 'Lay flagstones', status: 'awaiting-handoff' }], scene: sceneWith(square('zone_old', 10, 10, 40, 40)), brief: walkBrief() });
    const prepare = ensurePack(ref());
    for (let i = 0; i < 50 && exports.length === 0; i++) await tick(2);
    const exportedTarget = exports[0].target;
    exports.shift()!.resolve(prepared('chatgpt', exportedTarget));
    await prepare;
    expect(gen().handoffTarget).toMatchObject({ wholeImage: false });
    // The outline is moved (e.g. "Sharpen outlines"), then the page reloads.
    useStore.getState().setScene('pho', sceneWith(square('zone_old', 50, 30, 95, 75)));
    forgetRunCaches('gen');
    expect(await importInto(ref(), returned())).toBe(true);
    expect(sameMask(imports[0].target, exportedTarget)).toBe(true);
    expect(px(imports[0].composite, 85, 70)).toEqual(PHOTO_RGB);
  });

  it('an older run notices its outline changed since it was prepared and can be prepared again with the current one', async () => {
    setup({ planned: [{ id: 'a', title: 'A', brief: 'Lay flagstones', status: 'awaiting-handoff' }], scene: sceneWith(square('zone_old', 10, 10, 40, 40)), brief: walkBrief() });
    await preparePack();
    expect(gen().handoffTarget?.fingerprint).toBeTruthy();
    expect(targetOutlineChanged(photo(), gen())).toBe(false);
    useStore.getState().setScene('pho', sceneWith(square('zone_old', 50, 30, 95, 75)));
    expect(targetOutlineChanged(photo(), gen())).toBe(true);
    const frozen = gen().handoffTarget!.maskId;
    reprepareRun('pho', 'gen');
    expect(gen().handoffTarget).toBeUndefined();
    expect(gen().planned![0].handoff).toBeUndefined();
    await tick(20);
    expect(await db.getMask(frozen)).toBeUndefined();
    await preparePack();
    expect(targetOutlineChanged(photo(), gen())).toBe(false);
    // New runs keep their own outline by design: no note for them.
    expect(targetOutlineChanged(photo(), { ...gen(), target: { zones: [], paths: [] } })).toBe(false);
  });

  it('refuses (never a whole-image paste) when an older run’s areas are gone and nothing was frozen', async () => {
    const legacyPack: HandoffPack = {
      app: 'chatgpt',
      prompt: 'p',
      crop: { x: 0, y: 0, w: W, h: H },
      outW: 500,
      outH: 400,
      markerColor: '#ff00ff',
      cleanImageId: 'clean-legacy',
      markedImageId: 'marked-legacy',
      createdAt: 0,
    };
    await db.putBlob('clean-legacy', new Blob(['c']));
    await db.putBlob('marked-legacy', new Blob(['m']));
    setup({
      planned: [{ id: 'a', title: 'A', brief: 'Lay flagstones', status: 'awaiting-handoff', handoff: legacyPack }],
      scene: sceneWith(square('zone_old', 10, 10, 40, 40)),
      brief: walkBrief(),
    });
    useStore.getState().setScene('pho', sceneWith(square('zone_new', 10, 10, 40, 40)));
    expect(await importInto(ref(), returned())).toBe(false);
    expect(imports).toHaveLength(0);
    expect(handoffSession().errors.a).toBe(TARGET_LOST_MESSAGE);
    expect(gen().planned![0].status).toBe('awaiting-handoff');
  });

  it('refuses a pack drawn with an outline whose run now has none (it is prepared again)', async () => {
    const outlined: HandoffPack = {
      app: 'chatgpt',
      prompt: 'p',
      crop: { x: 0, y: 0, w: W, h: H },
      outW: 500,
      outH: 400,
      markerColor: '#ff00ff',
      cleanImageId: 'clean-o',
      markedImageId: 'marked-o',
      createdAt: 0,
    };
    await db.putBlob('clean-o', new Blob(['c']));
    await db.putBlob('marked-o', new Blob(['m']));
    setup({ planned: [{ id: 'a', title: 'A', brief: 'Paint it', status: 'awaiting-handoff', handoff: outlined }], brief: { ...emptyBrief(), prompt: 'Paint it' } });
    expect(await importInto(ref(), returned())).toBe(false);
    expect(handoffSession().errors.a).toBe(OUTLINE_CHANGED_MESSAGE);
    expect(gen().planned![0].handoff).toBeUndefined();
  });
});

describe('switching apps', () => {
  it('a result from an item already sent to ChatGPT is imported with the ChatGPT export after the switch to Gemini', async () => {
    setup({ planned: [{ id: 'a', title: 'A', brief: 'Lay flagstones', status: 'awaiting-handoff' }], scene: sceneWith(square('zone_old', 10, 10, 40, 40)), brief: walkBrief(), frozen: true });
    const p = ensurePack(ref());
    for (let i = 0; i < 50 && exports.length === 0; i++) await tick(2);
    const e = exports.shift()!;
    e.resolve(prepared('chatgpt', e.target, { x: 0, y: 4, w: 100, h: 72 }, { w: 600, h: 432 }));
    await p;
    recordHandoff('chatgpt', 'a'); // pasted into ChatGPT
    switchPendingApp('gemini'); // item 4 hit a limit → the waiting items move to Gemini
    expect(gen().planned![0].handoff).toBeUndefined();
    expect(gen().planned![0].handoffPrev).toMatchObject({ app: 'chatgpt', crop: { x: 0, y: 4, w: 100, h: 72 } });
    expect(await importInto(ref(), returned())).toBe(true);
    expect(exports).toHaveLength(0); // no Gemini export was prepared for it
    expect(imports[0].pack).toEqual({ crop: { x: 0, y: 4, w: 100, h: 72 }, outW: 600, outH: 432 });
    expect(gen().planned![0].staged?.source.app).toBe('chatgpt');
  });

  it('a second import while the first one prepares the pack is refused, and the item keeps its importing spinner', async () => {
    setup({ planned: [{ id: 'a', title: 'A', brief: 'Lay flagstones', status: 'awaiting-handoff' }], scene: sceneWith(square('zone_old', 10, 10, 40, 40)), brief: walkBrief(), frozen: true });
    const first = importInto(ref(), returned());
    for (let i = 0; i < 50 && exports.length === 0; i++) await tick(2);
    expect(handoffSession().jobs.a?.kind).toBe('importing');
    expect(await importInto(ref(), returned())).toBe(false);
    expect(handoffSession().jobs.a?.kind).toBe('importing');
    const e = exports.shift()!;
    e.resolve(prepared('chatgpt', e.target));
    await tick(10);
    expect(handoffSession().jobs.a === undefined || handoffSession().jobs.a.kind === 'importing').toBe(true);
    expect(await first).toBe(true);
    expect(handoffSession().jobs.a).toBeUndefined();
    expect(imports).toHaveLength(1);
  });

  it('switching while the photo is being prepared saves the pack for the new app (the old one is dropped)', async () => {
    setup({ planned: [{ id: 'a', title: 'A', brief: 'Lay flagstones', status: 'awaiting-handoff' }], scene: sceneWith(square('zone_old', 10, 10, 40, 40)), brief: walkBrief(), frozen: true, app: 'gemini' });
    const p1 = ensurePack(ref()); // companion opened: preparing for Gemini
    for (let i = 0; i < 50 && exports.length < 1; i++) await tick(2);
    switchPendingApp('chatgpt'); // "Use ChatGPT instead" while the spinner shows
    const p2 = ensurePack(ref()); // the companion's effect for the new app
    expect(p2).not.toBe(p1);
    for (let i = 0; i < 50 && exports.length < 2; i++) await tick(2);
    const gemini = exports.find((x) => x.app === 'gemini')!;
    const chatgpt = exports.find((x) => x.app === 'chatgpt')!;
    chatgpt.resolve(prepared('chatgpt', chatgpt.target));
    await tick(10);
    gemini.resolve(prepared('gemini', gemini.target));
    const [a, b] = await Promise.all([p1, p2]);
    expect(a.app).toBe('chatgpt');
    expect(b.app).toBe('chatgpt');
    const saved = gen().planned![0].handoff!;
    expect(saved.app).toBe('chatgpt');
    expect(handoffSession().errors.a).toBeUndefined();
    expect(handoffSession().jobs.a).toBeUndefined();
    // Only the ChatGPT export's images are kept.
    await tick(20);
    const all = await Promise.all([saved.cleanImageId, saved.markedImageId].map((id) => db.getBlob(id)));
    expect(all.every(Boolean)).toBe(true);
  });
});

describe('staging checks survive a reload', () => {
  it('an unchanged result stays flagged (and Accept asks first) after the session is gone; the review evidence is kept', async () => {
    insideUnchanged = true;
    setup({ planned: [{ id: 'a', title: 'A', brief: 'Lay flagstones', status: 'awaiting-handoff' }], scene: sceneWith(square('zone_old', 10, 10, 40, 40)), brief: walkBrief(), frozen: true, app: 'gemini' });
    await preparePack();
    expect(await importInto(ref(), returned())).toBe(true);
    setHandoffSession({ extras: {} }); // reload / project switch
    const staged = gen().planned![0].staged!;
    expect(staged.checks?.unchanged).toBe(true);
    expect(typeof staged.checks?.watermark).toBe('boolean');
    expect(staged.review?.blobs).toBeDefined();
    expect(staged.review?.changeMapId).toBeTruthy();
    expect(await db.getBlob(staged.review!.changeMapId!)).toBeTruthy();
    expect(acceptStaged(ref())).toBe(false);
    expect(gen().planned![0].status).toBe('staged');
    expect(acceptStaged(ref(), { force: true })).toBe(true);
    expect(gen().planned![0].status).toBe('done');
    await tick(20);
    expect(await db.getBlob(staged.review!.changeMapId!)).toBeUndefined();
  });
});

describe('finished items never get their exports back', () => {
  it('skipping while the photo is being prepared drops the late pack and its images', async () => {
    setup({ planned: [{ id: 'a', title: 'A', brief: 'Lay flagstones', status: 'awaiting-handoff' }], scene: sceneWith(square('zone_old', 10, 10, 40, 40)), brief: walkBrief(), frozen: true });
    const p = ensurePack(ref());
    for (let i = 0; i < 50 && exports.length === 0; i++) await tick(2);
    skipPlanned(ref());
    const e = exports.shift()!;
    e.resolve(prepared('chatgpt', e.target));
    await expect(p).rejects.toThrow(/finished/);
    expect(gen().planned![0].status).toBe('rejected');
    expect(gen().planned![0].handoff).toBeUndefined();
  });
});
