// @vitest-environment jsdom
/**
 * The vision UI glue against the real store, with the model client mocked:
 * sharpening writes masks + outlines in one undo step, the Refine section
 * offers the right action, and Tap to select builds / keeps selections.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignBrief, Photo, Project, Pt, SceneMap, SceneZone } from '../../../shared/types';
import { buildHandoffPrompt, promptContextFromScene } from '../../handoff/prompts';
import { createMask } from '../../engine/mask';
import type { Mask } from '../../engine/types';

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

const W = 100;
const H = 80;

/** Rectangle mask at photo size. */
function rectMask(x0: number, y0: number, x1: number, y1: number): Mask {
  const m = createMask(W, H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m.data[y * W + x] = 255;
  return m;
}

const refineZonesDetailed = vi.fn();
const segmentClick = vi.fn();
const offlineSceneMap = vi.fn();
const idleStatus = { stage: 'idle' as const };
vi.mock('../index', async () => {
  const actual = await vi.importActual<typeof import('../index')>('../index');
  return {
    ...actual,
    refineZonesDetailed: (...a: unknown[]) => refineZonesDetailed(...a),
    segmentClick: (...a: unknown[]) => segmentClick(...a),
    offlineSceneMap: (...a: unknown[]) => offlineSceneMap(...a),
    prepareVision: async () => undefined,
    guessZoneKind: async () => 'lawn',
    cachedModels: async () => ({ edgetam: false, segformer: false, clipseg: false }),
    visionUnsupportedReason: () => null,
    visionBackend: () => ({ backend: 'wasm', f16: false }),
    getVisionStatus: () => idleStatus,
    onVisionStatus: () => () => undefined,
  };
});

const { useStore } = await import('../../state/store');
const runtime = await import('../../state/runtime');
const { applyRefinement, mapSceneOffline, sharpenableZones, useVisionJobs } = await import('./jobs');
const { segformerChoice, setSegformerChoice } = await import('../license');
const { RefineSection } = await import('./RefineSection');
const tap = await import('./tapSelect');

const zone = (id: string, kind: SceneZone['kind'], poly: [number, number][], extra: Partial<SceneZone> = {}): SceneZone => ({
  id,
  kind,
  label: id,
  description: '',
  polygon: poly.map(([x, y]) => ({ x, y })),
  editable: true,
  ...extra,
});

function scene(zones: SceneZone[]): SceneMap {
  return {
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
    model: 'test',
  };
}

function seed(sceneMap?: SceneMap, regions: Photo['regions'] = []) {
  const photo: Photo = {
    id: 'pho_1',
    name: 'House',
    imageId: 'img_1',
    thumbId: 'img_t',
    width: W,
    height: H,
    createdAt: 1,
    regions,
    generations: [],
    designs: [],
    activeDesignId: '',
    scene: sceneMap,
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
    health: { ok: true, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null } },
  });
}

const photo = () => useStore.getState().project!.spaces[0].photos[0];

beforeEach(() => {
  refineZonesDetailed.mockReset();
  segmentClick.mockReset();
  offlineSceneMap.mockReset();
  useVisionJobs.setState({ job: null, consent: null, outcomes: {}, errors: {} });
  // Most tests run with the SegFormer licence already decided; the consent tests reset it.
  setSegformerChoice('accepted');
  tap.stopTapSelect();
});
afterEach(() => cleanup());

describe('sharpening', () => {
  const lawn = zone('lawn', 'lawn', [[0, 40], [100, 40], [100, 80], [0, 80]]);
  const roof = zone('roof', 'roof', [[20, 0], [80, 0], [80, 30], [20, 30]]);

  it('lists zones without a precise mask, never hand-edited ones', () => {
    seed(scene([lawn, { ...roof, maskId: 'msk_hand' }, zone('door', 'front-door', [[40, 30], [50, 30], [50, 40]], { maskId: 'msk_old' })]), [
      { id: 'reg_1', name: 'Roof', surface: 'roof', maskId: 'msk_hand', color: '#fff', createdAt: 1 },
    ]);
    expect(sharpenableZones(photo()).map((z) => z.id)).toEqual(['lawn']);
    expect(sharpenableZones(photo(), true).map((z) => z.id)).toEqual(['lawn', 'door']);
    // A tapped selection (sketch + mask) is already exact; a lasso sketch without a mask is not.
    seed(scene([zone('tapped', 'other', [[0, 0], [9, 0], [9, 9]], { source: 'sketch', maskId: 'msk_t' }), zone('lasso', 'other', [[0, 0], [9, 0], [9, 9]], { source: 'sketch' })]));
    expect(sharpenableZones(photo(), true).map((z) => z.id)).toEqual(['lasso']);
  });

  it('writes masks and outlines in one undoable step and skips zones edited meanwhile', () => {
    seed(scene([lawn, roof]));
    const started = new Map<string, Pt[]>([
      ['lawn', photo().scene!.zones[0].polygon],
      ['roof', [{ x: 0, y: 0 }]], // pretend the roof was edited since the run started
    ]);
    const poly = [
      { x: 0, y: 42 },
      { x: 100, y: 42 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const results = new Map([
      ['lawn', { refined: true, mask: rectMask(0, 42, 100, 80), polygon: poly, agreement: 0.9, iou: 0.9, classShare: 1 }],
      ['roof', { refined: true, mask: rectMask(20, 0, 80, 30), polygon: poly, agreement: 0.9, iou: 0.9, classShare: 1 }],
    ]);
    const before = useStore.getState().past.length;
    expect(applyRefinement('pho_1', results, started)).toBe(1);
    const z = photo().scene!.zones;
    expect(z[0].maskId).toMatch(/^msk_/);
    expect(z[0].polygon).toEqual(poly);
    expect(runtime.getMask(z[0].maskId!)?.data[60 * W + 10]).toBe(255);
    expect(z[1].maskId).toBeUndefined();
    expect(useStore.getState().past.length).toBe(before + 1);
    act(() => useStore.getState().undo());
    expect(photo().scene!.zones[0].maskId).toBeUndefined();
  });
});

describe('RefineSection', () => {
  it('offers the offline map when Claude is off and nothing is mapped', () => {
    seed(undefined);
    render(<RefineSection photoId="pho_1" />);
    // One name for the free map everywhere (photo pill, Design panel, element cards, Scene panel).
    expect(screen.getByRole('button', { name: 'Map the scene' }).getAttribute('title')).toBe('On this device, free');
    expect(screen.getByText(/Free · private/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Map on this device/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sharpen outlines/ })).toBeNull();
    expect(screen.getByText(/Models & licenses/)).toBeTruthy();
  });

  it('sharpens the mapped zones and shows per-area agreement', async () => {
    const lawn = zone('lawn', 'lawn', [[0, 40], [100, 40], [100, 80], [0, 80]]);
    const door = zone('door', 'front-door', [[40, 20], [50, 20], [50, 38], [40, 38]]);
    seed(scene([lawn, door]));
    refineZonesDetailed.mockImplementation(async (_photoId: string, _img: unknown, zones: SceneZone[], opts: { onProgress?: (d: number, t: number) => void }) => {
      opts.onProgress?.(1, zones.length);
      return new Map([
        ['lawn', { refined: true, mask: rectMask(0, 41, 100, 80), polygon: [{ x: 0, y: 41 }, { x: 100, y: 41 }, { x: 100, y: 80 }, { x: 0, y: 80 }], agreement: 0.93, iou: 0.9, classShare: 1 }],
        ['door', { refined: false, agreement: 0.2, iou: 0.1, classShare: null }],
      ]);
    });
    render(<RefineSection photoId="pho_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sharpen outlines on this device (free)' }));
    await waitFor(() => expect(screen.getByText(/1 of 2 sharpened/)).toBeTruthy());
    expect(refineZonesDetailed).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Sharp')).toBeTruthy();
    expect(screen.getByText('Kept as drawn')).toBeTruthy();
    expect(photo().scene!.zones.find((z) => z.id === 'lawn')!.maskId).toBeTruthy();
    expect(photo().scene!.zones.find((z) => z.id === 'door')!.maskId).toBeUndefined();
    // One zone left without a mask: still offered.
    expect(screen.getByRole('button', { name: 'Sharpen outlines on this device (free)' })).toBeTruthy();
  });

  it('maps without AI and keeps the result', async () => {
    seed(undefined);
    offlineSceneMap.mockResolvedValue(
      scene([zone('zone_l', 'lawn', [[0, 40], [100, 40], [100, 80], [0, 80]]), zone('zone_sky', 'sky', [[0, 0], [100, 0], [100, 20], [0, 20]], { editable: false })]),
    );
    // Both outlines come back sharper; the sky isn't one of the areas the Scene panel lists.
    const sharp = (id: string) => [id, { refined: true, mask: rectMask(0, 41, 100, 80), polygon: [{ x: 1, y: 41 }, { x: 99, y: 41 }, { x: 99, y: 79 }], agreement: 0.9, iou: 0.9, classShare: 1 }] as const;
    refineZonesDetailed.mockResolvedValue(new Map([sharp('zone_l'), sharp('zone_sky')]));
    render(<RefineSection photoId="pho_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Map the scene' }));
    await waitFor(() => expect(photo().scene?.zones.map((z) => z.id)).toEqual(['zone_l', 'zone_sky']));
    await waitFor(() => expect(useVisionJobs.getState().job).toBeNull());
    expect(offlineSceneMap).toHaveBeenCalledWith('pho_1', expect.anything(), false, true);
    // Counts the areas the Scene panel lists (not the sky).
    expect(useStore.getState().toasts.at(-1)?.message).toBe('Mapped 1 area on this device and sharpened 1 — no AI used.');
    expect(await screen.findByText('The area has a precise outline.')).toBeTruthy();
  });
});

describe('on-device map category', () => {
  /** What CLIPSeg alone made of a front-of-house photo: a "garden" with the walk as a driveway (C5 maps). */
  function guessedGarden(): SceneMap {
    return {
      ...scene([zone('zone_drive', 'driveway', [[44, 50], [56, 50], [60, 80], [40, 80]], { label: 'Driveway' }), zone('zone_l', 'lawn', [[0, 50], [40, 50], [40, 80], [0, 80]])]),
      category: 'garden',
      model: 'On-device (CLIPSeg, no AI)',
    };
  }
  const mapIt = async () => {
    refineZonesDetailed.mockResolvedValue(new Map());
    await mapSceneOffline('pho_1');
    await waitFor(() => expect(useVisionJobs.getState().job).toBeNull());
  };

  it('keeps the space type the user chose, and the hand-off prompt names the house, not a garden', async () => {
    seed(undefined); // a "Front of house" space
    offlineSceneMap.mockResolvedValue(guessedGarden());
    await mapIt();
    const sc = photo().scene!;
    expect(sc.category).toBe('front-exterior');
    const brief: DesignBrief = { prompt: '', elements: [], plantMaturity: 'established', ideaItemIds: [], targetZoneIds: ['zone_drive'], scope: 'zones' };
    const ctx = promptContextFromScene(sc, brief, ['zone_drive'], { app: 'chatgpt', instruction: 'Lay bluestone.', ratio: '4:3', markerColorName: 'magenta', references: [] }, { frame: { width: W, height: H } });
    expect(ctx.place).toBeUndefined();
    const prompt = buildHandoffPrompt(ctx);
    expect(prompt).toContain('Edit the attached photo of my house (Image 1).');
    expect(prompt).not.toMatch(/garden/i);
  });

  it('keeps a specific type (backyard), reads it after the map, and uses the guess only for a generic type', async () => {
    seed(undefined);
    useStore.getState().updateSpace('spc_1', { type: 'backyard' });
    offlineSceneMap.mockResolvedValue(guessedGarden());
    await mapIt();
    expect(photo().scene!.category).toBe('backyard');

    // The type changed while the models ran: the map follows the space as it is now.
    seed(undefined);
    offlineSceneMap.mockImplementation(async () => {
      useStore.getState().updateSpace('spc_1', { type: 'side-yard' });
      return guessedGarden();
    });
    await mapIt();
    expect(photo().scene!.category).toBe('side-yard');

    seed(undefined);
    useStore.getState().updateSpace('spc_1', { type: 'other-exterior' });
    offlineSceneMap.mockResolvedValue(guessedGarden());
    await mapIt();
    expect(photo().scene!.category).toBe('garden');
  });
});

describe('SegFormer licence (C5)', () => {
  const lawn = zone('lawn', 'lawn', [[0, 40], [100, 40], [100, 80], [0, 80]]);

  it('asks before the first use, then sharpens without SegFormer when declined and remembers it', async () => {
    setSegformerChoice(null);
    seed(scene([lawn]));
    refineZonesDetailed.mockResolvedValue(new Map());
    render(<RefineSection photoId="pho_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sharpen outlines on this device (free)' }));
    // A plain choice first, the licence wording one click away; nothing downloads or runs yet.
    const card = await screen.findByRole('group', { name: 'One choice before the first download' });
    const describedBy = (b: HTMLElement) => document.getElementById(b.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
    // Each choice says what it downloads for this action (sharpening: EdgeTAM + SegFormer, or EdgeTAM alone).
    expect(describedBy(within(card).getByRole('button', { name: 'Sharper detection (58 MB download)' }))).toMatch(/^Free for personal, non-commercial use/);
    expect(describedBy(within(card).getByRole('button', { name: 'Standard detection (29 MB download)' }))).toMatch(/^No restrictions/);
    const details = within(card).getByText('Licence details').closest('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(within(card).getByText('Licence details'));
    expect(details.open).toBe(true);
    expect(within(details).getByText('Non-commercial, research or evaluation use only')).toBeTruthy();
    expect(within(details).getByRole('link', { name: /NVIDIA Source Code License for SegFormer/ })).toBeTruthy();
    expect(within(details).getByText(/§3\.3/)).toBeTruthy();
    expect(within(details).getByText(/CLIPSeg \(Apache-2\.0\)/)).toBeTruthy();
    expect(refineZonesDetailed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Standard detection/ }));
    await waitFor(() => expect(refineZonesDetailed).toHaveBeenCalledTimes(1));
    expect(refineZonesDetailed.mock.calls[0][3]).toMatchObject({ semantic: false });
    expect(segformerChoice()).toBe('declined');
    expect(localStorage.getItem('mode.vision.segformer')).toBe('declined');
    await waitFor(() => expect(useVisionJobs.getState().job).toBeNull());
    // Remembered: the next run doesn't ask again.
    fireEvent.click(screen.getByRole('button', { name: 'Sharpen outlines on this device (free)' }));
    await waitFor(() => expect(refineZonesDetailed).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/One choice before the first download/)).toBeNull();
    expect(screen.getByText(/Standard detection \(SegFormer off\)/)).toBeTruthy();
  });

  it('uses SegFormer once accepted', async () => {
    setSegformerChoice(null);
    seed(scene([lawn]));
    refineZonesDetailed.mockResolvedValue(new Map());
    render(<RefineSection photoId="pho_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sharpen outlines on this device (free)' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Sharper detection/ }));
    await waitFor(() => expect(refineZonesDetailed).toHaveBeenCalledTimes(1));
    expect(refineZonesDetailed.mock.calls[0][3]).toMatchObject({ semantic: true });
    expect(segformerChoice()).toBe('accepted');
  });

  it('parks a map started from the photo, opens the Scene panel, and maps with CLIPSeg only when declined', async () => {
    setSegformerChoice(null);
    seed(undefined);
    useStore.getState().setStudio({ panel: 'design' });
    offlineSceneMap.mockResolvedValue(scene([zone('zone_l', 'lawn', [[0, 40], [100, 40], [100, 80], [0, 80]])]));
    refineZonesDetailed.mockResolvedValue(new Map());
    await mapSceneOffline('pho_1');
    expect(offlineSceneMap).not.toHaveBeenCalled();
    expect(useVisionJobs.getState().consent).toEqual({ photoId: 'pho_1', action: 'map' });
    expect(useStore.getState().studio.panel).toBe('scene');
    render(<RefineSection photoId="pho_1" />);
    fireEvent.click(screen.getByRole('button', { name: /^Standard detection/ }));
    await waitFor(() => expect(offlineSceneMap).toHaveBeenCalledWith('pho_1', expect.anything(), false, false));
    await waitFor(() => expect(useVisionJobs.getState().job).toBeNull());
    expect(useVisionJobs.getState().consent).toBeNull();
  });

  it('brings the question into view and focuses it (not a choice) when parked from the photo', async () => {
    setSegformerChoice(null);
    seed(undefined);
    const scrolled = vi.fn();
    const had = Object.prototype.hasOwnProperty.call(Element.prototype, 'scrollIntoView');
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    try {
      render(<RefineSection photoId="pho_1" />);
      await act(async () => {
        await mapSceneOffline('pho_1');
      });
      const card = await screen.findByRole('group', { name: 'One choice before the first download' });
      await waitFor(() => expect(document.activeElement).toBe(card));
      expect(card.tabIndex).toBe(-1);
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
      expect(scrolled.mock.contexts[0]).toBe(card);
      // Tab reaches the choice without anything pre-selected.
      expect(document.activeElement).not.toBe(screen.getByRole('button', { name: /^Sharper detection/ }));
    } finally {
      if (had) Element.prototype.scrollIntoView = original;
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('indoors, standard detection is the larger download (it maps with CLIPSeg instead)', async () => {
    setSegformerChoice(null);
    seed(undefined);
    useStore.getState().updateSpace('spc_1', { type: 'kitchen' });
    await mapSceneOffline('pho_1');
    render(<RefineSection photoId="pho_1" />);
    expect(screen.getByRole('button', { name: 'Sharper detection (58 MB download)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Standard detection (170 MB download)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('Cancel drops the question without deciding or downloading', async () => {
    setSegformerChoice(null);
    seed(undefined);
    await mapSceneOffline('pho_1');
    render(<RefineSection photoId="pho_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useVisionJobs.getState().consent).toBeNull();
    expect(segformerChoice()).toBeNull();
    expect(offlineSceneMap).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Map the scene' })).toBeTruthy();
  });

  it('parks a re-map and replaces the existing map once answered', async () => {
    setSegformerChoice(null);
    seed(scene([zone('old', 'lawn', [[0, 40], [100, 40], [100, 80], [0, 80]]), zone('mine', 'other', [[0, 0], [9, 0], [9, 9]], { source: 'sketch' })]));
    offlineSceneMap.mockResolvedValue(scene([zone('zone_new', 'facade', [[20, 0], [80, 0], [80, 30], [20, 30]])]));
    refineZonesDetailed.mockResolvedValue(new Map());
    await mapSceneOffline('pho_1', { replace: true });
    expect(useVisionJobs.getState().consent).toEqual({ photoId: 'pho_1', action: 'remap' });
    render(<RefineSection photoId="pho_1" />);
    expect(screen.getByText(/Then Mode will map the scene again;/)).toBeTruthy();
    // Mapping a yard: standard detection maps with CLIPSeg + EdgeTAM, sharper adds SegFormer.
    expect(screen.getByRole('button', { name: 'Sharper detection (199 MB download)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Standard detection (170 MB download)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Sharper detection/ }));
    // The new map replaces the old one; the user's own sketch stays.
    await waitFor(() => expect(photo().scene!.zones.map((z) => z.id)).toEqual(['zone_new', 'mine']));
    await waitFor(() => expect(useVisionJobs.getState().job).toBeNull());
  });

  it('keeps a map that is already there unless asked to replace it', async () => {
    seed(scene([zone('old', 'lawn', [[0, 40], [100, 40], [100, 80], [0, 80]])]));
    offlineSceneMap.mockResolvedValue(scene([zone('zone_new', 'facade', [[20, 0], [80, 0], [80, 30], [20, 30]])]));
    refineZonesDetailed.mockResolvedValue(new Map());
    await mapSceneOffline('pho_1');
    expect(photo().scene!.zones.map((z) => z.id)).toEqual(['old']);
    await mapSceneOffline('pho_1', { replace: true });
    expect(photo().scene!.zones.map((z) => z.id)).toEqual(['zone_new']);
  });

  it('can be changed later under Models & licenses', () => {
    setSegformerChoice('accepted');
    seed(scene([lawn]));
    render(<RefineSection photoId="pho_1" />);
    expect(screen.getByText(/Sharper detection \(SegFormer, licence accepted\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop using it' }));
    expect(segformerChoice()).toBe('declined');
    fireEvent.click(screen.getByRole('button', { name: 'Ask me again' }));
    expect(segformerChoice()).toBeNull();
  });
});

describe('Tap to select', () => {
  async function ready() {
    seed(scene([zone('mine', 'other', [[0, 0], [30, 0], [30, 30], [0, 30]], { source: 'sketch' })]));
    await tap.startTapSelect(photo());
    expect(tap.useTapSelect.getState().phase).toBe('ready');
  }

  it('builds a selection from parts, negatives and undo', async () => {
    await ready();
    segmentClick.mockImplementation(async (_id: string, prompt: { positive: Pt[]; negative?: Pt[] }) => {
      const p = prompt.positive[0];
      const m = p.x > 50 ? rectMask(60, 40, 100, 80) : rectMask(0, 40, 40, 80);
      if (prompt.negative?.length) for (let y = 40; y < 60; y++) for (let x = 60; x < 100; x++) m.data[y * W + x] = 0;
      return { mask: m, score: 0.9, rank: 1, ranks: 3, ms: 40 };
    });
    tap.tapAt({ x: 80, y: 70 }, false);
    await waitFor(() => expect(tap.useTapSelect.getState().parts[0].mask).toBeTruthy());
    tap.tapAt({ x: 10, y: 70 }, false); // outside the first part → second part
    await waitFor(() => expect(tap.useTapSelect.getState().parts[1]?.mask).toBeTruthy());
    expect(tap.useTapSelect.getState().parts).toHaveLength(2);
    tap.tapAt({ x: 80, y: 50 }, true); // removes from the part under it
    await waitFor(() => expect(tap.useTapSelect.getState().parts[0].negative).toHaveLength(1));
    await waitFor(() => expect(tap.useTapSelect.getState().busy).toBe(0));
    expect(tap.selectionMask()!.data[50 * W + 80]).toBe(0);
    expect(tap.selectionMask()!.data[70 * W + 80]).toBe(255);
    tap.undoTap();
    expect(tap.useTapSelect.getState().parts[0].negative).toHaveLength(0);
    tap.undoTap();
    tap.undoTap();
    expect(tap.useTapSelect.getState().parts).toHaveLength(0);
  });

  it('keeps the selection as a targeted sketch zone with a precise mask', async () => {
    await ready();
    segmentClick.mockResolvedValue({ mask: rectMask(50, 50, 90, 75), score: 0.9, rank: 0, ranks: 3, ms: 40 });
    tap.tapAt({ x: 70, y: 60 }, false);
    await waitFor(() => expect(tap.useTapSelect.getState().busy).toBe(0));
    const id = await tap.keepSelection(undefined);
    const z = photo().scene!.zones.find((x) => x.id === id)!;
    expect(z.source).toBe('sketch');
    expect(z.kind).toBe('lawn');
    expect(z.label).toBe('Lawn (selected)');
    expect(runtime.getMask(z.maskId!)?.data[60 * W + 70]).toBe(255);
    expect(photo().draft?.targetZoneIds).toContain(id);
    expect(tap.useTapSelect.getState().parts).toHaveLength(0);
  });

  it('adds a touching selection to a sketched area', async () => {
    await ready();
    segmentClick.mockResolvedValue({ mask: rectMask(30, 0, 50, 30), score: 0.9, rank: 0, ranks: 3, ms: 40 });
    tap.tapAt({ x: 40, y: 10 }, false);
    await waitFor(() => expect(tap.useTapSelect.getState().busy).toBe(0));
    const touching = await tap.touchingSketchZones(photo(), tap.selectionMask()!);
    expect(touching.map((z) => z.id)).toEqual(['mine']);
    await tap.keepSelection(undefined, 'mine');
    const z = photo().scene!.zones.find((x) => x.id === 'mine')!;
    const m = runtime.getMask(z.maskId!)!;
    expect(m.data[10 * W + 10]).toBe(255);
    expect(m.data[10 * W + 45]).toBe(255);
    expect(photo().scene!.zones).toHaveLength(1);
  });

  it('cycles candidates by size on the last part', async () => {
    await ready();
    segmentClick.mockImplementation(async (_id: string, _p: unknown, opts: { rank?: number }) => ({
      mask: rectMask(0, 0, 10 + 20 * (opts.rank ?? 1), 10),
      score: 0.9,
      rank: opts.rank ?? 1,
      ranks: 3,
      ms: 40,
    }));
    tap.tapAt({ x: 5, y: 5 }, false);
    await waitFor(() => expect(tap.useTapSelect.getState().busy).toBe(0));
    expect(tap.canResize(1)).toBe(true);
    tap.resizeSelection(1);
    await waitFor(() => expect(tap.useTapSelect.getState().parts[0].rank).toBe(2));
    await waitFor(() => expect(tap.useTapSelect.getState().busy).toBe(0));
    expect(tap.canResize(1)).toBe(false);
    expect(segmentClick).toHaveBeenLastCalledWith('pho_1', expect.anything(), { rank: 2 });
  });
});
