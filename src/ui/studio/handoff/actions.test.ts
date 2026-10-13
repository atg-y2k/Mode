import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyBrief, type Generation, type HandoffPack, type Photo, type PlannedVariation, type Project } from '../../../../shared/types';
import * as db from '../../../state/persistence';
import { findPhoto, newDesign, useStore } from '../../../state/store';
import { acceptStaged, installHandoffCleanup, rejectStaged, setDefaultHandoffApp, skipPlanned, switchPendingApp } from './actions';
import { HANDOFF_LOG_KEY, recordHandoff, resetHandoffLogCache } from './log';
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
  it('deleting a hand-off run removes its prepared and staged images', async () => {
    setup([
      { id: 'a', title: 'A', brief: 'a', status: 'awaiting-handoff', handoff: pack('a') },
      { id: 'b', title: 'B', brief: 'b', status: 'staged', handoff: pack('b'), staged: { imageId: 'staged-img', thumbId: 'staged-th', source: { kind: 'handoff', app: 'chatgpt' } } },
    ]);
    installHandoffCleanup();
    setHandoffSession({ staging: ref('b') });
    await useStore.getState().deleteGeneration('pho', 'gen');
    await new Promise((r) => setTimeout(r, 20));
    for (const id of ['clean-a', 'marked-a', 'clean-b', 'marked-b', 'staged-img', 'staged-th']) expect(await db.getBlob(id)).toBeUndefined();
    expect(handoffSession().staging).toBeNull();
  });
});
