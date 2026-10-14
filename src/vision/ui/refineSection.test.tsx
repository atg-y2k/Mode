// @vitest-environment jsdom
/**
 * RefineSection's "Last run" summary after an on-device map: it counts the
 * same areas as "All N areas have precise outlines" (not the sky), explains
 * the badges without mentioning an AI outline, and shows the double-check
 * note only for the labels actually shown. The model client is mocked.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo, Project, SceneMap, SceneZone } from '../../../shared/types';

const idleStatus = { stage: 'idle' as const };
vi.mock('../index', async () => {
  const actual = await vi.importActual<typeof import('../index')>('../index');
  return {
    ...actual,
    cachedModels: async () => ({ edgetam: true, segformer: true, clipseg: true }),
    visionUnsupportedReason: () => null,
    visionBackend: () => ({ backend: 'wasm', f16: false }),
    getVisionStatus: () => idleStatus,
    onVisionStatus: () => () => undefined,
  };
});

const { useStore } = await import('../../state/store');
const { useVisionJobs } = await import('./jobs');
const { setSegformerChoice } = await import('../license');
const { RefineSection } = await import('./RefineSection');
type ZoneOutcome = import('./jobs').ZoneOutcome;

const zone = (id: string, kind: SceneZone['kind'], extra: Partial<SceneZone> = {}): SceneZone => ({
  id,
  kind,
  label: id,
  description: '',
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  editable: true,
  maskId: `msk_${id}`,
  ...extra,
});

function seed(zones: SceneZone[]) {
  const scene: SceneMap = {
    category: 'front-exterior',
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
    createdAt: 1,
    model: 'on-device',
  };
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
    scene,
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
    health: { ok: true, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null } },
  });
}

const outcome = (zoneId: string, agreement: number, refined = true): ZoneOutcome => ({ zoneId, label: zoneId, refined, agreement });

beforeEach(() => {
  setSegformerChoice('accepted');
  useVisionJobs.setState({ job: null, consent: null, outcomes: {}, errors: {} });
});
afterEach(() => cleanup());

describe('RefineSection last-run summary', () => {
  it('counts the listed areas only, like "All N areas have precise outlines"', () => {
    seed([zone('lawn', 'lawn'), zone('roof', 'roof'), zone('sky', 'sky', { editable: false }), zone('street', 'street')]);
    useVisionJobs.setState({
      outcomes: { pho_1: { at: 1, items: [outcome('lawn', 0.9), outcome('roof', 0.92), outcome('sky', 0.95), outcome('street', 0.9)] } },
    });
    render(<RefineSection photoId="pho_1" />);
    expect(screen.getByText('All 2 areas have precise outlines.')).toBeTruthy();
    expect(screen.getByText(/Last run: 2 of 2 sharpened/)).toBeTruthy();
    expect(screen.queryByText('sky')).toBeNull();
    expect(screen.queryByText('street')).toBeNull();
  });

  it('explains agreement without an AI outline, and skips the double-check note when all are Sharp', () => {
    seed([zone('lawn', 'lawn'), zone('roof', 'roof')]);
    useVisionJobs.setState({ outcomes: { pho_1: { at: 1, items: [outcome('lawn', 0.9), outcome('roof', 0.8)] } } });
    render(<RefineSection photoId="pho_1" />);
    expect(screen.getByText(/how well each sharpened outline agrees with the first outline/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/AI outline/);
    expect(screen.getAllByText('Sharp')).toHaveLength(2);
    expect(screen.queryByText(/may have grabbed a neighbour/)).toBeNull();
  });

  it('names only the labels shown in the double-check note', () => {
    seed([zone('lawn', 'lawn'), zone('roof', 'roof'), zone('path', 'walkway')]);
    useVisionJobs.setState({ outcomes: { pho_1: { at: 1, items: [outcome('lawn', 0.9), outcome('roof', 0.6), outcome('path', 0.1, false)] } } });
    const { unmount } = render(<RefineSection photoId="pho_1" />);
    expect(screen.getByText('Check')).toBeTruthy();
    expect(screen.getByText(/^“Check” areas may have grabbed a neighbour/)).toBeTruthy();
    unmount();

    // Only an "Unsure" area: the note doesn't talk about "Check" areas that aren't there.
    useVisionJobs.setState({ outcomes: { pho_1: { at: 1, items: [outcome('lawn', 0.9), outcome('roof', 0.3)] } } });
    render(<RefineSection photoId="pho_1" />);
    expect(screen.queryByText('Check')).toBeNull();
    expect(screen.getByText(/^“Unsure” areas may have grabbed a neighbour/)).toBeTruthy();
  });
});
