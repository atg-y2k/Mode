import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Generation, Photo, SceneMap } from '../../shared/types';
import { emptyBrief } from '../../shared/types';
import { newDesign, useStore } from './store';

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
