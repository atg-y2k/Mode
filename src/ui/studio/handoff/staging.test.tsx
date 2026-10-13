// @vitest-environment jsdom
/**
 * Staging after a reload (the session's import extras are gone): the
 * wrong-image warning and Accept's confirmation come from the persisted
 * checks, and the "Changes outside" heatmap and the badge's area count come
 * back from the persisted review record.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo, PlannedVariation } from '../../../../shared/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const acceptStaged = vi.fn(() => true);
vi.mock('./actions', () => ({
  acceptStaged: (...a: unknown[]) => acceptStaged(...(a as [])),
  closeStaging: vi.fn(),
  rejectStaged: vi.fn(),
  retryStricter: vi.fn(),
  skipPlanned: vi.fn(),
  UNCHANGED_MESSAGE: 'This looks like your original or an older image — nothing changed in the area.',
}));
vi.mock('../actions', () => ({ openElement: vi.fn() }));
vi.mock('../hooks', () => ({ useBlobUrl: () => ({ url: null }), useElementSize: () => ({ width: 900, height: 700 }) }));
vi.mock('../../../state/persistence', () => ({ getBlob: vi.fn(async (id: string) => (id === 'map-1' ? new Blob(['png'], { type: 'image/png' }) : undefined)) }));
vi.mock('../../../lib/imageImport', () => ({
  blobToImageData: vi.fn(async () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) data.set([i * 10, i * 10, i * 10, 255], i * 4);
    return { width: 4, height: 4, data };
  }),
}));
const state: { project: unknown } = { project: null };
vi.mock('../../../state/store', () => {
  const useStore = (sel: (s: unknown) => unknown) => sel(state);
  (useStore as unknown as { getState: () => unknown }).getState = () => ({ ...state, notify: vi.fn() });
  return { useStore, findPhoto: () => ({ space: { kind: 'exterior' } }), findVariation: () => undefined };
});

import { StagingView } from './StagingView';
import { handoffSession, setHandoffSession } from './session';

const report = { inliers: 300, residualPx: 0.7, driftBefore: 6, driftAfter: 2, outsideChanged: 0.04, aligned: true };

function photoWith(staged: PlannedVariation['staged']): Photo {
  return {
    id: 'pho',
    name: 'Front',
    imageId: 'img',
    thumbId: 'th',
    width: 100,
    height: 80,
    createdAt: 0,
    regions: [],
    designs: [],
    activeDesignId: '',
    generations: [
      {
        id: 'gen',
        createdAt: 0,
        brief: { prompt: '', elements: [], plantMaturity: 'established', ideaItemIds: [], targetZoneIds: [], scope: 'zones' },
        mode: 'variations',
        plan: '',
        provider: 'ChatGPT',
        model: 'hand-off',
        variations: [],
        status: 'awaiting',
        renderMode: 'handoff',
        planned: [{ id: 'a', title: 'Flagstone', brief: 'b', status: 'staged', staged }],
      },
    ],
  };
}

async function render(photo: Photo): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<StagingView photo={photo} stagingRef={{ photoId: 'pho', generationId: 'gen', plannedId: 'a' }} />));
  await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
  return host;
}

beforeEach(() => {
  acceptStaged.mockClear();
  setHandoffSession({ extras: {}, staging: null });
  document.body.innerHTML = '';
});

describe('staging after a reload', () => {
  it('brings back the heatmap and the outside-area count from the saved review', async () => {
    const host = await render(
      photoWith({
        imageId: 's',
        thumbId: 't',
        source: { kind: 'handoff', app: 'chatgpt', alignment: report },
        checks: { unchanged: false },
        review: { changeMapId: 'map-1', blobs: [{ x: 1, y: 1, w: 5, h: 5, area: 25 }, { x: 50, y: 40, w: 9, h: 9, area: 81 }] },
      }),
    );
    expect(host.textContent).toContain('Model changed 2 areas outside');
    const heat = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Changes outside')) as HTMLButtonElement;
    expect(heat).toBeTruthy();
    expect(heat.disabled).toBe(false);
    const restored = handoffSession().extras.a;
    expect(restored.changeMap).toMatchObject({ width: 4, height: 4 });
    expect(Array.from(restored.changeMap.data.slice(0, 3))).toEqual([0, 10, 20]);
  });

  it('still warns about an unchanged image and asks before keeping it', async () => {
    const host = await render(
      photoWith({ imageId: 's', thumbId: 't', source: { kind: 'handoff', app: 'gemini', alignment: report }, checks: { unchanged: true, watermark: true }, review: { blobs: [] } }),
    );
    expect(host.textContent).toContain('This looks like your original or an older image');
    expect(host.textContent).toContain('Gemini sparkle');
    const accept = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Accept') as HTMLButtonElement;
    await act(async () => accept.click());
    expect(acceptStaged).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Keep an unchanged image?');
  });

  it('a result saved before the change map was kept shows the toggle disabled', async () => {
    const host = await render(photoWith({ imageId: 's', thumbId: 't', source: { kind: 'handoff', app: 'chatgpt', alignment: report } }));
    const heat = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Changes outside')) as HTMLButtonElement;
    expect(heat.disabled).toBe(true);
  });
});
