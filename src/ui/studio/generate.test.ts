import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthResponse } from '../../../shared/api';
import { emptyBrief, type DesignBrief, type Generation, type Photo, type Project, type SceneMap } from '../../../shared/types';
import { createImageDataLike } from '../../engine/types';
import { createMask } from '../../engine/mask';
import * as db from '../../state/persistence';
import * as runtime from '../../state/runtime';
import { findPhoto, newDesign, useStore } from '../../state/store';
import { INTERRUPTED, buildTargetMask, cancelRun, generationBlocker, recoverInterruptedRuns, retryVariation, startRun, withStrictness } from './generate';
import { declineReview, registerReviewHost, submitReview, useReview } from './handoff/review';
import { handoffSession, setHandoffSession } from './handoff/session';

// Node has no image decoding: stand-ins for the browser codecs used by runs.
vi.mock('../../lib/imageImport', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/imageImport')>();
  return {
    ...orig,
    blobToAIDataUrl: async () => 'data:image/jpeg;base64,AAAA',
    blobToDataUrl: async () => 'data:image/jpeg;base64,AAAA',
    imageDataToBlob: async () => new Blob(['img'], { type: 'image/jpeg' }),
    dataUrlToBlob: async () => new Blob(['img'], { type: 'image/png' }),
  };
});
vi.mock('./composite', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./composite')>();
  return {
    ...orig,
    compositeVariation: async (_blob: Blob, base: { width: number; height: number }) => createImageDataLike(base.width, base.height),
    thumbnailBlob: async () => new Blob(['thumb'], { type: 'image/jpeg' }),
  };
});

const W = 120;
const H = 90;

const HEALTHY: HealthResponse = {
  ok: true,
  ai: { enabled: true, model: 'claude-opus-5-5' },
  imageProvider: { enabled: true, name: 'OpenAI', model: 'gpt-image-1' },
  imageProviders: [{ id: 'openai', name: 'OpenAI', model: 'gpt-image-1', isDefault: true }],
};

const scene: SceneMap = {
  category: 'front-yard',
  summary: 'House',
  viewpoint: '',
  style: '',
  boundaries: '',
  lighting: '',
  orientation: '',
  architecture: { style: 'Colonial', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
  zones: [
    {
      id: 'bed',
      kind: 'planting-bed',
      label: 'Bed',
      description: '',
      polygon: [
        { x: 10, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 80 },
        { x: 10, y: 80 },
      ],
      editable: true,
      sun: 'full-sun',
      maskId: 'msk_bed',
    },
  ],
  paths: [],
  keep: [],
  opportunities: [],
  createdAt: 0,
  model: 'test',
};

function gen(id: string, status: Generation['status'], variations = 0): Generation {
  return {
    id,
    createdAt: 0,
    brief: emptyBrief(),
    mode: 'variations',
    plan: '',
    provider: 'openai',
    model: 'gpt-image-1',
    status,
    variations: Array.from({ length: variations }, (_, i) => ({
      id: `${id}-v${i}`,
      imageId: `img-${id}-${i}`,
      thumbId: `th-${id}-${i}`,
      width: W,
      height: H,
      title: `V${i}`,
      brief: 'b',
      favorite: false,
      createdAt: i,
    })),
  };
}

function setup(draft: DesignBrief | undefined, generations: Generation[] = []): Photo {
  const design = newDesign('Option A');
  const photo: Photo = {
    id: 'pho',
    name: 'Front',
    imageId: 'img-photo-missing',
    thumbId: 'th-photo',
    width: W,
    height: H,
    createdAt: 0,
    regions: [],
    scene,
    draft,
    generations,
    designs: [design],
    activeDesignId: design.id,
  };
  const project: Project = {
    id: 'prj',
    version: 1,
    name: 'Test',
    createdAt: 0,
    updatedAt: 0,
    location: { hardinessZone: '7a' },
    spaces: [{ id: 'spc', name: 'Front', type: 'front-yard', kind: 'exterior', photos: [photo], createdAt: 0 }],
    ideaBoard: [],
    assetList: [],
  };
  useStore.setState({
    project,
    selection: { spaceId: 'spc', photoId: 'pho', regionId: null, objectId: null, lightId: null },
    health: HEALTHY,
    runs: {},
    past: [],
    future: [],
    studio: { ...useStore.getState().studio, viewVariationId: null, gridGenerationId: null, variationCount: 3, provider: null, renderMode: 'api', handoffApp: 'chatgpt' },
  });
  return photo;
}

const NO_PROVIDERS: HealthResponse = { ...HEALTHY, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null }, imageProviders: [] };

/** Photo pixels "in storage" + a fake API: plan (template) and render endpoints. */
function fakeBackend(opts: { failRender?: boolean } = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(runtime, 'loadPhotoImage').mockResolvedValue(createImageDataLike(W, H, { r: 120, g: 140, b: 90 }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      calls.push({ path, body });
      if (path === '/api/studio/plan') {
        const count = body.count as number;
        const json = {
          plan: 'Lavender drifts in the bed; the house stays as it is.',
          plants: [],
          variations: Array.from({ length: count }, (_, i) => ({ title: `Take ${i + 1}`, brief: `Edit the bed: take ${i + 1}.`, optionId: null })),
        };
        return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Mode-Plan-Source': 'template' } });
      }
      if (path === '/api/studio/render-variation') {
        if (opts.failRender) return new Response(JSON.stringify({ error: { code: 'upstream_error', message: 'Provider timed out.' } }), { status: 502 });
        return new Response(JSON.stringify({ image: 'data:image/png;base64,AAAA', provider: 'openai', model: 'gpt-image-1' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

const currentPhoto = () => findPhoto(useStore.getState().project, 'pho')!.photo;

describe('recoverInterruptedRuns', () => {
  it('marks runs a previous session left running as interrupted', () => {
    setup(undefined, [gen('a', 'running', 2), gen('b', 'running'), gen('c', 'done', 1)]);
    expect(recoverInterruptedRuns()).toBe(2);
    const gens = currentPhoto().generations;
    expect(gens.map((g) => g.status)).toEqual(['partial', 'partial', 'done']);
    expect(gens[0].error).toBe(INTERRUPTED);
    expect(gens[0].variations).toHaveLength(2);
    expect(gens[2].error).toBeUndefined();
    expect(recoverInterruptedRuns()).toBe(0);
  });
});

describe('generationBlocker', () => {
  it('explains what is missing', () => {
    expect(generationBlocker({ health: null })).toBeNull();
    expect(generationBlocker({ health: HEALTHY })).toBeNull();
    expect(generationBlocker({ health: { ...HEALTHY, ok: false } })).toMatch(/server/);
    expect(generationBlocker({ health: NO_PROVIDERS }, 'api')).toMatch(/OPENAI_API_KEY or GEMINI_API_KEY/);
  });

  it('never asks for an image provider in hand-off mode (and API mode falls back to hand-off without one)', () => {
    expect(generationBlocker({ health: NO_PROVIDERS }, 'handoff')).toBeNull();
    expect(generationBlocker({ health: NO_PROVIDERS, studio: { renderMode: 'api' } })).toBeNull();
    expect(generationBlocker({ health: { ...NO_PROVIDERS, ok: false } }, 'handoff')).toMatch(/server/);
  });
});

describe('startRun', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('refuses an empty brief, an unknown compare target and a missing provider', async () => {
    setup(emptyBrief());
    await expect(startRun({ photoId: 'pho', mode: 'variations' })).rejects.toThrow(/Describe what you would like to change/);
    await expect(startRun({ photoId: 'nope', mode: 'variations' })).rejects.toThrow(/no longer in this project/);
    await expect(startRun({ photoId: 'pho', mode: 'compare', compare: { elementId: 'x', dimensionId: 'y', optionIds: ['a', 'b'] } })).rejects.toThrow(
      /no longer in the brief/,
    );
    await expect(startRun({ photoId: 'pho', mode: 'variations', feedback: 'wider' })).rejects.toThrow(/variation to refine/);
    useStore.setState({ health: NO_PROVIDERS });
    await expect(startRun({ photoId: 'pho', mode: 'variations', brief: { ...emptyBrief(), prompt: 'x' }, renderMode: 'api' })).rejects.toThrow(/OPENAI_API_KEY/);
    expect(currentPhoto().generations).toHaveLength(0);
  });

  it('creates a running generation, opens it in the grid, and cancelling an empty run removes it', async () => {
    setup({ ...emptyBrief(), prompt: 'Lavender in the bed', targetZoneIds: ['bed'] });
    const id = await startRun({ photoId: 'pho', mode: 'variations', count: 2 });
    const g = currentPhoto().generations[0];
    expect(g.id).toBe(id);
    expect(g.status).toBe('running');
    expect(g.brief.prompt).toBe('Lavender in the bed');
    expect(useStore.getState().runs[id]).toMatchObject({ stage: 'planning', total: 2, done: 0 });
    expect(useStore.getState().studio.gridGenerationId).toBe(id);
    cancelRun(id);
    await vi.waitFor(() => expect(currentPhoto().generations).toHaveLength(0));
    expect(useStore.getState().runs[id]).toBeUndefined();
    expect(useStore.getState().studio.gridGenerationId).toBeNull();
  });

  it('records a failure on the run when it cannot proceed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setup({ ...emptyBrief(), prompt: 'Lavender in the bed', targetZoneIds: ['bed'] });
    const id = await startRun({ photoId: 'pho', mode: 'variations', count: 1, showGrid: false });
    expect(useStore.getState().studio.gridGenerationId).toBeNull();
    // The photo's pixels are not in storage in this test: the run fails with a readable error.
    await vi.waitFor(() => expect(currentPhoto().generations[0].status).toBe('failed'));
    const g = currentPhoto().generations.find((x) => x.id === id)!;
    expect(g.error).toMatch(/missing from storage/);
    expect(useStore.getState().runs[id]).toBeUndefined();
  });
});

describe('hand-off runs', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    setHandoffSession({ active: null, companion: 'closed' });
    await db.putBlob('img-photo', new Blob(['photo'], { type: 'image/jpeg' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const draft = { ...emptyBrief(), prompt: 'Lavender in the bed', targetZoneIds: ['bed'] };

  it('plans (template plan without Claude), then waits for the user with one planned item per variation', async () => {
    setup(draft);
    const p = currentPhoto();
    useStore.getState().mutateProject('x', (d) => void (d.spaces[0].photos[0].imageId = 'img-photo'), { history: false });
    useStore.setState({ health: NO_PROVIDERS, studio: { ...useStore.getState().studio, renderMode: 'handoff', handoffApp: 'gemini' } });
    const calls = fakeBackend();
    const id = await startRun({ photoId: p.id, mode: 'variations', count: 2 });
    expect(useStore.getState().studio.gridGenerationId).toBeNull();
    await vi.waitFor(() => expect(currentPhoto().generations[0].status).toBe('awaiting'));
    const g = currentPhoto().generations[0];
    expect(g.id).toBe(id);
    expect(g.renderMode).toBe('handoff');
    expect(g.provider).toBe('Gemini');
    expect(g.plan).toMatch(/Lavender/);
    expect(g.planned?.map((x) => [x.title, x.brief, x.status])).toEqual([
      ['Take 1', 'Edit the bed: take 1.', 'awaiting-handoff'],
      ['Take 2', 'Edit the bed: take 2.', 'awaiting-handoff'],
    ]);
    expect(useStore.getState().runs[id]).toBeUndefined();
    expect(handoffSession().active).toEqual({ photoId: 'pho', generationId: id, plannedId: g.planned![0].id });
    expect(handoffSession().companion).toBe('open');
    // Only the plan was requested — nothing is rendered through an API.
    expect(calls.map((c) => c.path)).toEqual(['/api/studio/plan']);
  });

  it('waits for the review: edited instructions are used, removed ones dropped; declining removes the run', async () => {
    setup(draft);
    useStore.getState().mutateProject('x', (d) => void (d.spaces[0].photos[0].imageId = 'img-photo'), { history: false });
    useStore.setState({ health: NO_PROVIDERS, studio: { ...useStore.getState().studio, renderMode: 'handoff' } });
    fakeBackend();
    const unregister = registerReviewHost();
    try {
      const id = await startRun({ photoId: 'pho', mode: 'variations', count: 3 });
      expect(useReview.getState().current).toMatchObject({ generationId: id, stage: 'planning', renderMode: 'handoff', count: 3 });
      await vi.waitFor(() => expect(useReview.getState().current?.stage).toBe('ready'));
      const review = useReview.getState().current!;
      expect(review.planSource).toBe('template');
      expect(review.items).toHaveLength(3);
      expect(currentPhoto().generations[0].status).toBe('running');
      submitReview(id, [{ ...review.items![0], brief: 'Only lavender, 3 ft drifts.' }, review.items![2]]);
      await vi.waitFor(() => expect(currentPhoto().generations[0].status).toBe('awaiting'));
      expect(currentPhoto().generations[0].planned?.map((x) => x.brief)).toEqual(['Only lavender, 3 ft drifts.', 'Edit the bed: take 3.']);
      expect(useReview.getState().current).toBeNull();

      const id2 = await startRun({ photoId: 'pho', mode: 'variations', count: 1 });
      await vi.waitFor(() => expect(useReview.getState().current?.stage).toBe('ready'));
      declineReview(id2);
      cancelRun(id2);
      await vi.waitFor(() => expect(currentPhoto().generations.map((g) => g.id)).toEqual([id]));
    } finally {
      unregister();
    }
  });

  it('API runs record their plan, and a failed variation can be retried after a reload', async () => {
    setup(draft);
    useStore.getState().mutateProject('x', (d) => void (d.spaces[0].photos[0].imageId = 'img-photo'), { history: false });
    fakeBackend({ failRender: true });
    const id = await startRun({ photoId: 'pho', mode: 'variations', count: 1, showGrid: false });
    await vi.waitFor(() => expect(currentPhoto().generations[0].status).toBe('failed'));
    let g = currentPhoto().generations[0];
    expect(g.renderMode).toBe('api');
    expect(g.planned).toEqual([expect.objectContaining({ title: 'Take 1', status: 'failed', error: expect.stringMatching(/timed out/) })]);

    // "Reload": the live run state is gone; the recorded plan is enough to retry without planning again.
    const key = g.planned![0].id;
    const calls = fakeBackend();
    await retryVariation(id, key);
    await vi.waitFor(() => expect(currentPhoto().generations[0].status).toBe('done'));
    g = currentPhoto().generations[0];
    expect(g.planned?.[0]).toMatchObject({ status: 'done', variationId: g.variations[0].id });
    expect(g.variations[0]).toMatchObject({ title: 'Take 1', brief: 'Edit the bed: take 1.', source: { kind: 'api' } });
    expect(calls.map((c) => c.path)).toEqual(['/api/studio/render-variation']);
  });
});

describe('withStrictness', () => {
  it('adds the strictness sentence for the image API (balanced adds nothing)', () => {
    expect(withStrictness(' Lay flagstones. ', undefined, false)).toBe('Lay flagstones.');
    expect(withStrictness('Lay flagstones.', 'balanced', false)).toBe('Lay flagstones.');
    expect(withStrictness('Lay flagstones.', 'strict', false)).toMatch(/^Lay flagstones\. Change nothing beyond this request/);
    expect(withStrictness('Paint the walls.', 'creative', true)).toMatch(/suit the room\.$/);
  });
});

describe('buildTargetMask', () => {
  it('uses the refined zone mask when loaded, else the outline; null for whole-image briefs', () => {
    const photo = setup(undefined);
    const brief = { ...emptyBrief(), targetZoneIds: ['bed'] };
    const fromPolygon = buildTargetMask(photo, brief)!;
    expect(fromPolygon.data[65 * W + 30]).toBe(255);
    expect(fromPolygon.data[10 * W + 100]).toBe(0);

    const refined = createMask(W, H);
    for (let y = 5; y < 20; y++) for (let x = 90; x < 110; x++) refined.data[y * W + x] = 255;
    runtime.setMask('msk_bed', refined);
    const fromMask = buildTargetMask(photo, brief)!;
    expect(fromMask.data[10 * W + 100]).toBe(255);
    expect(fromMask.data[65 * W + 30]).toBe(0);

    expect(buildTargetMask(photo, { ...brief, scope: 'whole' })).toBeNull();
    runtime.forgetMasks(['msk_bed']);
  });
});
