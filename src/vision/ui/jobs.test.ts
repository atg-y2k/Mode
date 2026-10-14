// @vitest-environment jsdom
/**
 * "Map on this device" when only the sharpening step fails (e.g. the network
 * drops while its model downloads): the map is already saved, so the message
 * says so and points to "Sharpen outlines" instead of "Couldn't map the scene".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo, Project, SceneMap, SceneZone } from '../../../shared/types';

vi.mock('../../state/persistence', () => ({
  putBlob: async () => undefined,
  getBlob: async () => new Blob(['img'], { type: 'image/jpeg' }),
  deleteBlobs: async () => undefined,
  putMask: async () => undefined,
  getMask: async () => undefined,
  deleteMasks: async () => undefined,
  saveLibrary: async () => undefined,
  saveProject: async () => undefined,
  photoReferencedIds: () => ({ blobIds: [], maskIds: [] }),
  projectMeta: (p: Project) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt, spaceCount: 0, photoCount: 0 }),
}));
vi.mock('../../lib/imageImport', () => ({
  blobToImageData: async () => ({ width: 100, height: 80, data: new Uint8ClampedArray(100 * 80 * 4) }),
  importImageFile: async () => {
    throw new Error('not used');
  },
  downloadBlob: () => undefined,
}));

const refineZonesDetailed = vi.fn();
const offlineSceneMap = vi.fn();
vi.mock('../index', async () => {
  const actual = await vi.importActual<typeof import('../index')>('../index');
  return {
    ...actual,
    refineZonesDetailed: (...a: unknown[]) => refineZonesDetailed(...a),
    offlineSceneMap: (...a: unknown[]) => offlineSceneMap(...a),
    visionUnsupportedReason: () => null,
  };
});

const { useStore } = await import('../../state/store');
const { VisionError } = await import('../index');
const { mapSceneOffline, useVisionJobs } = await import('./jobs');
const { setSegformerChoice } = await import('../license');

const zone = (id: string, kind: SceneZone['kind'], poly: [number, number][]): SceneZone => ({
  id,
  kind,
  label: id,
  description: '',
  polygon: poly.map(([x, y]) => ({ x, y })),
  editable: true,
});

function mappedScene(): SceneMap {
  return {
    category: 'front-exterior',
    summary: 'Mapped on this device.',
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones: [
      zone('zone_lawn', 'lawn', [[0, 50], [100, 50], [100, 80], [0, 80]]),
      zone('zone_facade', 'facade', [[20, 10], [80, 10], [80, 50], [20, 50]]),
      zone('zone_sky', 'sky', [[0, 0], [100, 0], [100, 10], [0, 10]]),
    ],
    paths: [],
    keep: [],
    opportunities: [],
    createdAt: 1,
    model: 'On-device (test)',
  };
}

function seed() {
  const photo: Photo = {
    id: 'pho_1',
    name: 'House',
    imageId: 'img_1',
    thumbId: 'img_t',
    width: 100,
    height: 80,
    createdAt: 1,
    regions: [],
    generations: [],
    designs: [],
    activeDesignId: '',
  };
  const project: Project = {
    id: 'prj_1',
    version: 1,
    name: 'Test',
    createdAt: 1,
    updatedAt: 1,
    location: {},
    spaces: [{ id: 'spc_1', name: 'Front', type: 'front-exterior', kind: 'exterior', photos: [photo], createdAt: 1 }],
    ideaBoard: [],
    assetList: [],
  };
  useStore.setState({
    project,
    selection: { spaceId: 'spc_1', photoId: 'pho_1', regionId: null, objectId: null, lightId: null },
    past: [],
    future: [],
    toasts: [],
  });
}

const photo = () => useStore.getState().project!.spaces[0].photos[0];
const toasts = () => useStore.getState().toasts.map((t) => ({ kind: t.kind, message: t.message }));

beforeEach(() => {
  refineZonesDetailed.mockReset();
  offlineSceneMap.mockReset();
  useVisionJobs.setState({ job: null, consent: null, outcomes: {}, errors: {} });
  setSegformerChoice('accepted');
  seed();
});

describe('mapSceneOffline when the sharpening step fails', () => {
  it('keeps the saved map and says the outlines can be sharpened later', async () => {
    offlineSceneMap.mockResolvedValue(mappedScene());
    refineZonesDetailed.mockRejectedValue(
      new VisionError('Could not download the model — check the internet connection (models are only downloaded once).', 'network'),
    );
    await mapSceneOffline('pho_1');
    expect(photo().scene?.zones.map((z) => z.id)).toEqual(['zone_lawn', 'zone_facade', 'zone_sky']);
    expect(toasts()).toEqual([
      {
        kind: 'info',
        message:
          "Mapped 2 areas on this device, but the outlines couldn't be sharpened. Could not download the model — check the internet connection (models are only downloaded once). Use “Sharpen outlines” in the Scene panel later.",
      },
    ]);
    // No error in the Scene panel: the map worked.
    expect(useVisionJobs.getState().errors.pho_1).toBeUndefined();
    expect(useVisionJobs.getState().job).toBeNull();
  });

  it('still reports a failed map as one', async () => {
    offlineSceneMap.mockRejectedValue(new VisionError('Could not download the model — check the internet connection (models are only downloaded once).', 'network'));
    await mapSceneOffline('pho_1');
    expect(photo().scene).toBeUndefined();
    expect(toasts()[0]).toMatchObject({ kind: 'error', message: expect.stringMatching(/^Couldn't map the scene on this device: Could not download/) });
    expect(useVisionJobs.getState().errors.pho_1).toMatch(/Could not download/);
  });

  it('says nothing when the sharpening was cancelled', async () => {
    offlineSceneMap.mockResolvedValue(mappedScene());
    refineZonesDetailed.mockRejectedValue(new VisionError('Cancelled', 'cancelled'));
    await mapSceneOffline('pho_1');
    expect(photo().scene?.zones).toHaveLength(3);
    expect(toasts()).toEqual([]);
    expect(useVisionJobs.getState().errors.pho_1).toBeUndefined();
  });

  it('reports the sharpened count when everything works', async () => {
    offlineSceneMap.mockResolvedValue(mappedScene());
    refineZonesDetailed.mockResolvedValue(new Map());
    await mapSceneOffline('pho_1');
    expect(toasts()).toEqual([{ kind: 'success', message: 'Mapped 2 areas on this device — no AI used.' }]);
  });
});
