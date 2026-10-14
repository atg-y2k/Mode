import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyBrief, type Generation, type HandoffPack, type Photo, type PlannedVariation, type Project } from '../../../../shared/types';
import * as db from '../../../state/persistence';
import { findPhoto, newDesign, useStore } from '../../../state/store';
import { acceptStaged, openRunHandoff, rejectStaged, setDefaultHandoffApp, skipPlanned, switchPendingApp } from './actions';
import { HANDOFF_LOG_KEY, recordHandoff, resetHandoffLogCache } from './log';
import { sweepFinishedPacks } from './pack';
import { handoffSession, setHandoffSession } from './session';

const pack = (id: string, app: HandoffPack['app'] = 'chatgpt'): HandoffPack => ({
  app,
  prompt: `prompt ${id}`,
  crop: { x: 0, y: 0, w: 100, h: 80 },
  outW: 1024,
  outH: 820,
  markerColor: '#ff00ff',
  cleanImageId: `clean-${id}`,
  markedImageId: `marked-${id}`,
  createdAt: 0,
});

const alignment = { inliers: 300, residualPx: 0.7, driftBefore: 6, driftAfter: 2, outsideChanged: 0.01, aligned: true };

function setup(planned: PlannedVariation[]): void {
  const g: Generation = {
    id: 'gen',
    createdAt: 0,
    brief: emptyBrief(),
    mode: 'variations',
    plan: 'Plan',
    provider: 'ChatGPT',
    model: 'hand-off',
    variations: [],
    status: 'awaiting',
    renderMode: 'handoff',
    planned,
  };
  const design = newDesign('Option A');
  const photo: Photo = {
    id: 'pho',
    name: 'Front',
    imageId: 'img',
    thumbId: 'th',
    width: 100,
    height: 80,
    createdAt: 0,
    regions: [],
    generations: [g],
    designs: [design],
    activeDesignId: design.id,
  };
  const project: Project = {
    id: 'prj',
    version: 1,
    name: 'Test',
    createdAt: 0,
    updatedAt: 0,
    location: {},
    spaces: [{ id: 'spc', name: 'Front', type: 'front-yard', kind: 'exterior', photos: [photo], createdAt: 0 }],
    ideaBoard: [],
    assetList: [],
  };
  useStore.setState({
    project,
    selection: { spaceId: 'spc', photoId: 'pho', regionId: null, objectId: null, lightId: null },
    past: [],
    future: [],
    studio: { ...useStore.getState().studio, viewVariationId: null, gridGenerationId: null, renderMode: 'handoff', handoffApp: 'chatgpt' },
  });
  setHandoffSession({ active: null, staging: null, companion: 'open', extras: {}, jobs: {}, errors: {} });
}

const gen = () => findPhoto(useStore.getState().project, 'pho')!.photo.generations[0];
const ref = (plannedId: string) => ({ photoId: 'pho', generationId: 'gen', plannedId });

beforeEach(async () => {
  try {
    localStorage.removeItem(HANDOFF_LOG_KEY);
  } catch {
    // no localStorage in node
  }
  resetHandoffLogCache();
  await db.putBlob('staged-img', new Blob(['s']));
  await db.putBlob('staged-th', new Blob(['t']));
  for (const id of ['a', 'b']) {
    await db.putBlob(`clean-${id}`, new Blob(['c']));
    await db.putBlob(`marked-${id}`, new Blob(['m']));
  }
});

describe('staging decisions', () => {
  it('Accept turns the staged result into a variation with its provenance and moves on', () => {
    setup([
      { id: 'a', title: 'Flagstone', brief: 'Lay flagstones', status: 'staged', handoff: pack('a'), staged: { imageId: 'staged-img', thumbId: 'staged-th', source: { kind: 'handoff', app: 'chatgpt', alignment } } },
      { id: 'b', title: 'Gravel', brief: 'Pea gravel', status: 'awaiting-handoff' },
    ]);
    setHandoffSession({ staging: ref('a'), active: ref('a') });
    acceptStaged(ref('a'));
    const g = gen();
    expect(g.variations).toHaveLength(1);
    expect(g.variations[0]).toMatchObject({ imageId: 'staged-img', thumbId: 'staged-th', title: 'Flagstone', brief: 'Lay flagstones', source: { kind: 'handoff', app: 'chatgpt', alignment } });
    expect(g.planned![0]).toMatchObject({ status: 'done', variationId: g.variations[0].id });
    expect(g.planned![0].staged).toBeUndefined();
    expect(g.status).toBe('awaiting');
    expect(useStore.getState().studio.viewVariationId).toBe(g.variations[0].id);
    expect(handoffSession().staging).toBeNull();
    expect(handoffSession().active).toMatchObject({ plannedId: 'b' });
  });

  it('Accept keeps you on the photo you are looking at: a hand-off waiting on another photo waits in the pill', () => {
    setup([
      { id: 'a', title: 'Wall paint · Soft sage', brief: 'Paint', status: 'staged', staged: { imageId: 'staged-img', thumbId: 'staged-th', source: { kind: 'handoff', app: 'chatgpt' } } },
    ]);
    // A second photo ("Living room") is on screen; the front yard has a hand-off still waiting.
    const living = structuredClone(useStore.getState().project!.spaces[0]);
    living.id = 'spc2';
    living.name = 'Living room';
    living.photos[0].id = 'pho2';
    useStore.getState().mutateProject(
      'x',
      (d) => {
        d.spaces[0].photos[0].generations[0].planned = [{ id: 'b', title: 'Flagstone walk', brief: 'Walk', status: 'awaiting-handoff' }];
        d.spaces.push(living);
      },
      { history: false },
    );
    useStore.setState({ selection: { spaceId: 'spc2', photoId: 'pho2', regionId: null, objectId: null, lightId: null } });
    const notify = vi.spyOn(useStore.getState(), 'notify');
    const here = { photoId: 'pho2', generationId: 'gen', plannedId: 'a' };
    setHandoffSession({ staging: here, active: here, companion: 'open' });
    expect(acceptStaged(here)).toBe(true);
    expect(useStore.getState().selection.photoId).toBe('pho2');
    expect(useStore.getState().studio.viewVariationId).toBe(findPhoto(useStore.getState().project, 'pho2')!.photo.generations[0].variations[0].id);
    expect(handoffSession()).toMatchObject({ active: null, companion: 'collapsed', staging: null });
    expect(notify).toHaveBeenLastCalledWith('“Wall paint · Soft sage” added to your variations. 1 hand-off waiting in “Front” — open it from the pill.', 'success');
    notify.mockRestore();
  });

  it('Accept moves a folded card on to the next item without unfolding it', () => {
    setup([
      { id: 'a', title: 'Flagstone', brief: 'Lay flagstones', status: 'staged', staged: { imageId: 'staged-img', thumbId: 'staged-th', source: { kind: 'handoff', app: 'chatgpt' } } },
      { id: 'b', title: 'Gravel', brief: 'Pea gravel', status: 'awaiting-handoff' },
    ]);
    setHandoffSession({ staging: ref('a'), active: ref('a'), companion: 'collapsed' });
    acceptStaged(ref('a'));
    expect(handoffSession()).toMatchObject({ active: ref('b'), companion: 'collapsed' });
  });

  it('Accept frees the item’s hand-off exports (marked PNG + clean JPEG)', async () => {
    setup([
      { id: 'a', title: 'Flagstone', brief: 'Lay flagstones', status: 'staged', handoff: pack('a'), staged: { imageId: 'staged-img', thumbId: 'staged-th', source: { kind: 'handoff', app: 'chatgpt', alignment } } },
      { id: 'b', title: 'Gravel', brief: 'Pea gravel', status: 'awaiting-handoff', handoff: pack('b') },
    ]);
    acceptStaged(ref('a'));
    expect(gen().planned![0].handoff).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(await db.getBlob('clean-a')).toBeUndefined();
    expect(await db.getBlob('marked-a')).toBeUndefined();
    // The accepted image itself and the other item's exports stay.
    expect(await db.getBlob('staged-img')).toBeDefined();
    expect(await db.getBlob('clean-b')).toBeDefined();
  });

  it('Skip frees the item’s hand-off exports too', async () => {
    setup([
      { id: 'a', title: 'Flagstone', brief: 'Lay flagstones', status: 'awaiting-handoff', handoff: pack('a') },
      { id: 'b', title: 'Gravel', brief: 'Pea gravel', status: 'awaiting-handoff', handoff: pack('b') },
    ]);
    skipPlanned(ref('a'));
    expect(gen().planned![0]).toMatchObject({ status: 'rejected' });
    expect(gen().planned![0].handoff).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(await db.getBlob('clean-a')).toBeUndefined();
    expect(await db.getBlob('marked-a')).toBeUndefined();
  });

  it('projects saved before that: finished items’ exports are swept once', async () => {
    setup([
      { id: 'a', title: 'Flagstone', brief: 'Lay flagstones', status: 'done', variationId: 'v', handoff: pack('a') },
      { id: 'b', title: 'Gravel', brief: 'Pea gravel', status: 'awaiting-handoff', handoff: pack('b') },
    ]);
    expect(sweepFinishedPacks()).toBe(1);
    expect(gen().planned![0].handoff).toBeUndefined();
    expect(gen().planned![1].handoff).toBeDefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(await db.getBlob('clean-a')).toBeUndefined();
    expect(await db.getBlob('clean-b')).toBeDefined();
    expect(sweepFinishedPacks()).toBe(0);
  });

  it('Reject discards the result and waits again; Skip leaves the variation out and finishes the run', async () => {
    setup([
      { id: 'a', title: 'Flagstone', brief: 'Lay flagstones', status: 'staged', staged: { imageId: 'staged-img', thumbId: 'staged-th', source: { kind: 'handoff', app: 'chatgpt' } } },
      { id: 'b', title: 'Gravel', brief: 'Pea gravel', status: 'done', variationId: 'gone' },
    ]);
    rejectStaged(ref('a'));
    expect(gen().planned![0].status).toBe('awaiting-handoff');
    expect(gen().planned![0].staged).toBeUndefined();
    expect(gen().status).toBe('awaiting');
    await new Promise((r) => setTimeout(r, 20));
    expect(await db.getBlob('staged-img')).toBeUndefined();

    skipPlanned(ref('a'));
    expect(gen().planned![0].status).toBe('rejected');
    expect(gen().status).toBe('done');
    expect(handoffSession().companion).toBe('closed');
  });
});

describe('switching apps', () => {
  it('moves every waiting item to the other app (packs prepared again) and relabels the run', async () => {
    setup([
      { id: 'a', title: 'A', brief: 'a', status: 'awaiting-handoff', handoff: pack('a') },
      { id: 'b', title: 'B', brief: 'b', status: 'awaiting-handoff' },
    ]);
    expect(switchPendingApp('gemini')).toBe(2);
    expect(useStore.getState().studio.handoffApp).toBe('gemini');
    expect(gen().planned!.every((p) => !p.handoff)).toBe(true);
    expect(gen().provider).toBe('Gemini');
    await new Promise((r) => setTimeout(r, 20));
    expect(await db.getBlob('clean-a')).toBeUndefined();
  });

  it('an item already sent keeps how its export was framed when the waiting items move to the other app', () => {
    setup([
      { id: 'a', title: 'A', brief: 'a', status: 'awaiting-handoff', handoff: pack('a') },
      { id: 'b', title: 'B', brief: 'b', status: 'awaiting-handoff', handoff: pack('b') },
    ]);
    recordHandoff('chatgpt', 'a');
    expect(switchPendingApp('gemini')).toBe(2);
    expect(gen().planned![0].handoff).toBeUndefined();
    expect(gen().planned![0].handoffPrev).toMatchObject({ app: 'chatgpt', crop: { x: 0, y: 0, w: 100, h: 80 }, outW: 1024, outH: 820, markerColor: '#ff00ff' });
    expect(gen().planned![1].handoffPrev).toBeUndefined();
  });

  it('the dock app only moves items that were not sent yet', () => {
    setup([
      { id: 'a', title: 'A', brief: 'a', status: 'awaiting-handoff', handoff: pack('a') },
      { id: 'b', title: 'B', brief: 'b', status: 'awaiting-handoff', handoff: pack('b') },
    ]);
    recordHandoff('chatgpt', 'a');
    setDefaultHandoffApp('gemini');
    expect(gen().planned![0].handoff?.app).toBe('chatgpt'); // already pasted into ChatGPT
    expect(gen().planned![1].handoff).toBeUndefined();
  });
});

describe('cleanup', () => {
  it('deleting a hand-off run removes its prepared and staged images (the store does it)', async () => {
    setup([
      { id: 'a', title: 'A', brief: 'a', status: 'awaiting-handoff', handoff: pack('a') },
      { id: 'b', title: 'B', brief: 'b', status: 'staged', handoff: pack('b'), staged: { imageId: 'staged-img', thumbId: 'staged-th', source: { kind: 'handoff', app: 'chatgpt' } } },
    ]);
    await useStore.getState().deleteGeneration('pho', 'gen');
    for (const id of ['clean-a', 'marked-a', 'clean-b', 'marked-b', 'staged-img', 'staged-th']) expect(await db.getBlob(id)).toBeUndefined();
  });
});

describe('the starting image of a pending hand-off', () => {
  it('cannot be deleted while the run waits for its result (finish or skip it first)', async () => {
    setup([{ id: 'a', title: 'A', brief: 'a', status: 'awaiting-handoff', handoff: pack('a') }]);
    const v = { id: 'v1', imageId: 'staged-img', thumbId: 'staged-th', width: 100, height: 80, title: 'Base take', brief: 'b', favorite: false, createdAt: 0 };
    useStore.getState().updateGeneration('pho', 'gen', (g) => {
      g.baseVariationId = 'v1';
    });
    useStore.getState().addGeneration('pho', { ...gen(), id: 'older', planned: [], baseVariationId: undefined, variations: [v], status: 'done' });
    expect(await useStore.getState().deleteVariation('pho', 'v1')).toBe(false);
    expect(findPhoto(useStore.getState().project, 'pho')!.photo.generations.some((g) => g.variations.some((x) => x.id === 'v1'))).toBe(true);
    expect(await db.getBlob('staged-img')).toBeDefined();
    skipPlanned(ref('a'));
    expect(await useStore.getState().deleteVariation('pho', 'v1')).toBe(true);
  });
});

describe('open a run from History (mode:open-handoff)', () => {
  it('opens the companion on the run’s first waiting item, else its staged one', () => {
    setup([
      { id: 'a', title: 'A', brief: 'a', status: 'staged', handoff: pack('a'), staged: { imageId: 'staged-img', thumbId: 'staged-th', source: { kind: 'handoff', app: 'chatgpt' } } },
      { id: 'b', title: 'B', brief: 'b', status: 'awaiting-handoff', handoff: pack('b') },
    ]);
    setHandoffSession({ companion: 'closed', active: null });
    expect(openRunHandoff('gen')).toBe(true);
    expect(handoffSession().active).toMatchObject({ plannedId: 'b' });
    expect(handoffSession().companion).toBe('open');
    expect(openRunHandoff('missing')).toBe(false);
  });
});
