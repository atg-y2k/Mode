import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthResponse } from '../../../shared/api';
import type { Photo, Project, SceneMap } from '../../../shared/types';

vi.mock('../../state/persistence', () => ({
  getBlob: vi.fn(async () => new Blob(['img'])),
  saveProject: vi.fn(async () => undefined),
  projectMeta: vi.fn((p: Project) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt, spaceCount: 0, photoCount: 0 })),
  listProjects: vi.fn(async () => []),
  loadLibrary: vi.fn(async () => []),
  requestPersistentStorage: vi.fn(async () => true),
  putBlob: vi.fn(async () => undefined),
  getMask: vi.fn(async () => undefined),
  putMask: vi.fn(async () => undefined),
  deleteBlobs: vi.fn(async () => undefined),
  deleteMasks: vi.fn(async () => undefined),
}));

vi.mock('../../lib/studio', () => ({
  analyzeScene: vi.fn(),
}));

const { analyzeScene } = await import('../../lib/studio');
const { useStore } = await import('../../state/store');
const { installAutoSceneAnalysis, requestSceneAnalysis, useSceneJobs } = await import('./sceneJobs');

const analyze = vi.mocked(analyzeScene);

const AI_ON: HealthResponse = {
  ok: true,
  ai: { enabled: true, model: 'claude' },
  imageProvider: { enabled: false, name: null, model: null },
};
const AI_OFF: HealthResponse = { ...AI_ON, ai: { enabled: false, model: null } };

function scene(zones = 3): SceneMap {
  return {
    category: 'front-yard',
    summary: 's',
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones: Array.from({ length: zones }, (_, i) => ({ id: `z${i}`, kind: 'lawn' as const, label: 'Lawn', description: '', polygon: [], editable: true })),
    paths: [],
    keep: [],
    opportunities: [],
    createdAt: 1,
    model: 'claude',
  };
}

let n = 0;
function photo(extra: Partial<Photo> = {}): Photo {
  n++;
  return {
    id: `pho_${n}`,
    name: `Photo ${n}`,
    imageId: `img_${n}`,
    thumbId: `thumb_${n}`,
    width: 800,
    height: 600,
    createdAt: Date.now(),
    regions: [],
    generations: [],
    designs: [],
    activeDesignId: '',
    ...extra,
  };
}

function project(id: string, photos: Photo[]): Project {
  return {
    id,
    version: 1,
    name: 'Home',
    createdAt: 1,
    updatedAt: 1,
    location: {},
    spaces: [{ id: 'spc_1', name: 'Front yard', type: 'front-yard', kind: 'exterior', photos, notes: 'keep the maple', createdAt: 1 }],
    ideaBoard: [],
    assetList: [],
  };
}

function addPhoto(p: Photo) {
  useStore.getState().mutateProject('Add photo', (d) => void d.spaces[0].photos.push(p), { history: false });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

installAutoSceneAnalysis();

describe('automatic scene mapping', () => {
  beforeEach(async () => {
    analyze.mockReset();
    useStore.setState({ project: null, health: AI_ON, toasts: [] });
    await flush();
  });

  it('maps newly added photos but not the ones the project opened with', async () => {
    const existing = photo();
    useStore.setState({ project: project('prj_a', [existing]) });
    analyze.mockResolvedValue(scene(4));
    const fresh = photo();
    addPhoto(fresh);
    await flush();
    await flush();
    expect(analyze).toHaveBeenCalledTimes(1);
    const [dims, , opts] = analyze.mock.calls[0];
    expect(dims).toMatchObject({ width: 800, height: 600 });
    expect(opts).toMatchObject({ spaceTypeHint: 'front-yard', notes: 'keep the maple' });
    const saved = useStore.getState().project!.spaces[0].photos.find((p) => p.id === fresh.id)!;
    expect(saved.scene?.zones).toHaveLength(4);
    expect(useSceneJobs.getState().jobs[fresh.id]).toBeUndefined();
  });

  it('skips photos that already have a scene map', async () => {
    useStore.setState({ project: project('prj_b', []) });
    addPhoto(photo({ scene: scene() }));
    await flush();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('does nothing when AI is off', async () => {
    useStore.setState({ project: project('prj_c', []), health: AI_OFF });
    addPhoto(photo());
    await flush();
    expect(analyze).not.toHaveBeenCalled();
    expect(requestSceneAnalysis('whatever')).toBe(false);
  });

  it('waits for the health check before deciding', async () => {
    useStore.setState({ project: project('prj_d', []), health: null });
    analyze.mockResolvedValue(scene());
    addPhoto(photo());
    await flush();
    expect(analyze).not.toHaveBeenCalled();
    useStore.setState({ health: AI_ON });
    await flush();
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('reports failures as a toast without touching the photo', async () => {
    useStore.setState({ project: project('prj_e', []) });
    analyze.mockRejectedValue(new Error('Upstream hiccup'));
    const p = photo();
    addPhoto(p);
    await flush();
    await flush();
    const toast = useStore.getState().toasts.find((t) => t.kind === 'error');
    expect(toast?.message).toContain('Upstream hiccup.');
    expect(useStore.getState().project!.spaces[0].photos[0].scene).toBeUndefined();
    expect(useSceneJobs.getState().jobs[p.id]).toBeUndefined();
  });

  it('drops results that arrive after the project was closed', async () => {
    useStore.setState({ project: project('prj_f', []) });
    let resolve!: (s: SceneMap) => void;
    analyze.mockReturnValue(new Promise<SceneMap>((r) => (resolve = r)));
    addPhoto(photo());
    await flush();
    expect(analyze).toHaveBeenCalledTimes(1);
    const signal = analyze.mock.calls[0][2]?.signal;
    useStore.setState({ project: project('prj_g', []) });
    expect(signal?.aborted).toBe(true);
    resolve(scene());
    await flush();
    expect(useStore.getState().project!.spaces[0].photos).toHaveLength(0);
    expect(useSceneJobs.getState().jobs).toEqual({});
  });

  it('re-maps on request (force) even when a scene exists', async () => {
    const p = photo({ scene: scene(1) });
    useStore.setState({ project: project('prj_h', [p]) });
    analyze.mockResolvedValue(scene(6));
    expect(requestSceneAnalysis(p.id, { force: true })).toBe(true);
    expect(requestSceneAnalysis(p.id, { force: true })).toBe(false); // already queued
    await flush();
    await flush();
    expect(useStore.getState().project!.spaces[0].photos[0].scene?.zones).toHaveLength(6);
  });
});
