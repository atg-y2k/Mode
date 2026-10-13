import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthResponse } from '../../../shared/api';
import { emptyBrief, type DesignBrief, type Generation, type Photo, type Project, type SceneMap } from '../../../shared/types';
import { createMask } from '../../engine/mask';
import * as runtime from '../../state/runtime';
import { findPhoto, newDesign, useStore } from '../../state/store';
import { INTERRUPTED, buildTargetMask, cancelRun, generationBlocker, recoverInterruptedRuns, startRun } from './generate';

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
    studio: { ...useStore.getState().studio, viewVariationId: null, gridGenerationId: null, variationCount: 3, provider: null },
  });
  return photo;
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
    expect(generationBlocker({ health: { ...HEALTHY, imageProvider: { enabled: false, name: null, model: null }, imageProviders: [] } })).toMatch(
      /OPENAI_API_KEY or GEMINI_API_KEY/,
    );
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
    useStore.setState({ health: { ...HEALTHY, imageProvider: { enabled: false, name: null, model: null }, imageProviders: [] } });
    await expect(startRun({ photoId: 'pho', mode: 'variations', brief: { ...emptyBrief(), prompt: 'x' } })).rejects.toThrow(/image provider/);
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
