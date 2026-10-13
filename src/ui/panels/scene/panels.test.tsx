// @vitest-environment jsdom
/**
 * Smoke tests for the Lighting and Library panels: render against a small
 * project, arm placements, use the inspectors and open the modals. Engine,
 * catalog and image modules are mocked so only the panels' own wiring runs.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetDef, Design, Photo, Project } from '../../../../shared/types';
import { DEFAULT_LIGHTING } from '../../../../shared/types';

const FIXTURES_MOCK: AssetDef[] = [
  {
    id: 'wall-lantern',
    name: 'Wall lantern',
    category: 'lighting',
    source: 'builtin',
    aspect: 0.6,
    realHeightFt: 1.5,
    tags: ['lantern'],
    art: { kind: 'fixture', form: 'wall-lantern', finish: '#222222' },
    cost: { low: 40, high: 90, unit: 'each' },
    light: { beam: 'down', kelvin: 2400, lumens: 450, reachFt: 10, emitterY: 0.5, indoor: false, outdoor: true },
  },
  {
    id: 'globe-pendant',
    name: 'Globe pendant',
    category: 'lighting',
    source: 'builtin',
    aspect: 0.8,
    realHeightFt: 1.2,
    tags: ['pendant'],
    art: { kind: 'fixture', form: 'pendant-globe', finish: '#b08d57' },
    light: { beam: 'down', kelvin: 2700, lumens: 800, reachFt: 8, emitterY: 0.7, indoor: true, outdoor: false },
  },
];
const PLANTS_MOCK: AssetDef[] = [
  {
    id: 'boxwood',
    name: 'Boxwood',
    category: 'plant',
    source: 'builtin',
    aspect: 1.1,
    realHeightFt: 3,
    tags: ['shrub'],
    art: { kind: 'plant', form: 'round-shrub', foliage: '#3f6b35', seed: 1 },
    cost: { low: 25, high: 45, unit: 'each' },
    plant: { botanical: 'Buxus', type: 'shrub', sun: ['full-sun', 'part-sun'], water: 'medium', zoneMin: 5, zoneMax: 8, matureHeightFt: 3, matureWidthFt: 3, evergreen: true, indoor: false },
  },
  {
    id: 'agave',
    name: 'Agave',
    category: 'plant',
    source: 'builtin',
    aspect: 1,
    realHeightFt: 2,
    tags: ['succulent'],
    art: { kind: 'plant', form: 'succulent-rosette', foliage: '#6c8a83', seed: 2 },
    plant: { type: 'succulent', sun: ['full-sun'], water: 'low', zoneMin: 9, zoneMax: 11, matureHeightFt: 2, matureWidthFt: 3, evergreen: true, indoor: false },
  },
];
const DECOR_MOCK: AssetDef[] = [
  { id: 'bench', name: 'Garden bench', category: 'furniture', source: 'builtin', aspect: 2, realHeightFt: 3, tags: [], art: { kind: 'decor', form: 'bench', color: '#8a5d3b' } },
];

vi.mock('../../../assets/catalog', () => {
  const all = [...PLANTS_MOCK, ...FIXTURES_MOCK, ...DECOR_MOCK];
  return {
    PLANTS: PLANTS_MOCK,
    FIXTURES: FIXTURES_MOCK,
    DECOR: DECOR_MOCK,
    BUILTIN_ASSETS: all,
    findAsset: (id: string, lib: readonly AssetDef[]) => all.find((a) => a.id === id) ?? lib.find((a) => a.id === id),
    searchAssets: (pool: readonly AssetDef[], q: string) => pool.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())),
    parseZone: (z: string | undefined | null) => (z ? Number.parseInt(z, 10) || undefined : undefined),
    getMaterial: () => undefined,
  };
});
vi.mock('../../../engine/assetImages', () => ({
  assetSvgDataUrl: (a: AssetDef) => (a.art || a.svg ? 'data:image/svg+xml,%3Csvg%2F%3E' : null),
  assetSvgMarkup: () => '<svg/>',
  getAssetImageUrl: async () => 'blob:mock',
  getAssetImage: async () => ({}),
  peekAssetImage: () => undefined,
  evictAssetImage: () => undefined,
}));
vi.mock('../../../assetList/area', () => ({
  pxPerFoot: () => 40,
  defaultObjectHeightPx: () => 120,
  regionAreaSqFt: () => ({ sqft: null, method: 'none' }),
}));
vi.mock('../../../lib/imageImport', () => {
  const img = (w: number, h: number, alpha = 255) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = alpha;
    return { width: w, height: h, data };
  };
  return {
    importImageFile: async () => ({ blob: new Blob(['x']), width: 40, height: 20, thumb: new Blob(['t']) }),
    blobToImageData: async () => img(40, 20),
    imageDataToBlob: async () => new Blob(['png'], { type: 'image/png' }),
    dataUrlToBlob: async () => new Blob(['png'], { type: 'image/png' }),
    downloadBlob: () => undefined,
  };
});
vi.mock('../../../lib/backgroundRemoval', () => ({
  removeBackground: (src: { width: number; height: number; data: Uint8ClampedArray }) => {
    const data = new Uint8ClampedArray(src.data);
    for (let i = 3; i < data.length; i += 8) data[i] = 0; // every other pixel becomes background
    return { width: src.width, height: src.height, data };
  },
  trimTransparent: (img: { width: number; height: number; data: Uint8ClampedArray }) => ({ ...img, width: img.width / 2, data: img.data.slice(0, img.data.length / 2) }),
  hasTransparency: (img: { data: Uint8ClampedArray }) => {
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 255) return true;
    return false;
  },
}));
const generateAssetMock = vi.fn();
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  generateAsset: (...args: unknown[]) => generateAssetMock(...args),
}));
vi.mock('../../../state/persistence', () => ({
  putBlob: async () => undefined,
  saveLibrary: async () => undefined,
  deleteBlobs: async () => undefined,
}));

type Store = typeof import('../../../state/store').useStore;
let useStore: Store;
let LightingPanel: typeof import('../LightingPanel').LightingPanel;
let LibraryPanel: typeof import('../LibraryPanel').LibraryPanel;

function makeProject(): Project {
  const design: Design = {
    id: 'dsg_1',
    name: 'Option A',
    createdAt: 1,
    updatedAt: 1,
    treatments: {},
    hiddenRegionIds: [],
    objects: [{ id: 'obj_1', assetId: 'boxwood', x: 100, y: 300, height: 120, rotation: 0, flipX: false, opacity: 1, shadow: true, z: 1 }],
    lights: [
      { id: 'lgt_1', assetId: 'wall-lantern', name: 'Wall lantern', x: 50, y: 60, beam: 'down', radius: 200, intensity: 1, kelvin: 2400, on: true, showFixture: true, fixtureSize: 40 },
    ],
    lighting: { ...DEFAULT_LIGHTING },
    aiRenders: [],
  };
  const photo: Photo = {
    id: 'pho_1',
    name: 'Front',
    imageId: 'img_1',
    thumbId: 'img_2',
    width: 1200,
    height: 800,
    createdAt: 1,
    regions: [],
    generations: [],
    designs: [design],
    activeDesignId: design.id,
  };
  return {
    id: 'prj_1',
    version: 1,
    name: 'Home',
    createdAt: 1,
    updatedAt: 1,
    location: { hardinessZone: '7a' },
    spaces: [{ id: 'spc_1', name: 'Front yard', type: 'front-yard', kind: 'exterior', photos: [photo], createdAt: 1 }],
    ideaBoard: [],
    assetList: [],
  };
}

const design = () => useStore.getState().project!.spaces[0].photos[0].designs[0];

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

beforeEach(async () => {
  // Fresh modules per test: the panels remember browsing state across tab switches.
  vi.resetModules();
  ({ useStore } = await import('../../../state/store'));
  ({ LightingPanel } = await import('../LightingPanel'));
  ({ LibraryPanel } = await import('../LibraryPanel'));
  useStore.setState({
    project: makeProject(),
    selection: { spaceId: 'spc_1', photoId: 'pho_1', regionId: null, objectId: null, lightId: null },
    library: [],
    mode: 'finetune',
    placement: null,
    tool: 'select',
    past: [],
    future: [],
    health: { ok: true, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null } },
  });
});

afterEach(() => cleanup());

describe('LightingPanel', () => {
  it('adjusts the scene look with undoable store edits', () => {
    render(<LightingPanel />);
    fireEvent.click(screen.getByRole('radio', { name: /Night/ }));
    expect(design().lighting.timeOfDay).toBe('night');
    fireEvent.change(screen.getByLabelText('Exposure'), { target: { value: '-1.5' } });
    expect(design().lighting.exposure).toBe(-1.5);
    fireEvent.change(screen.getByLabelText('Warmth'), { target: { value: '3200' } });
    expect(design().lighting.kelvin).toBe(3200);
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    expect(design().lighting).toEqual(DEFAULT_LIGHTING);
    expect(useStore.getState().past.length).toBeGreaterThan(0);
  });

  it('lists placed lights and toggles them', () => {
    render(<LightingPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Wall lantern' }));
    expect(design().lights[0].on).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Wall lantern.*Downlight/ }));
    expect(useStore.getState().selection.lightId).toBe('lgt_1');
  });

  it('inspects the selected light', () => {
    useStore.getState().select({ lightId: 'lgt_1' });
    render(<LightingPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Strip$/ }));
    expect(design().lights[0].beam).toBe('strip');
    expect(design().lights[0].x2).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /^4000/ }));
    expect(design().lights[0].kelvin).toBe(4000);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(design().lights).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(design().lights).toHaveLength(1);
  });

  it('arms fixture placements carrying the fixture light data', () => {
    render(<LightingPanel />);
    // Exterior space → outdoor fixtures only.
    expect(screen.queryByText('Globe pendant')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Wall lantern.*450 lm/ }));
    expect(useStore.getState().placement).toEqual({ kind: 'light', assetId: 'wall-lantern', name: 'Wall lantern', beam: 'down', kelvin: 2400 });
    expect(useStore.getState().tool).toBe('place');
    expect(screen.getByRole('status').textContent).toMatch(/the photo to place Wall lantern/);
    fireEvent.click(screen.getByRole('button', { name: /String lights/ }));
    expect(useStore.getState().placement).toMatchObject({ kind: 'light', beam: 'string' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useStore.getState().placement).toBeNull();
  });
});

describe('LibraryPanel', () => {
  it('browses, filters and arms plant placement', () => {
    render(<LibraryPanel />);
    expect(screen.getByText('Boxwood')).toBeTruthy();
    expect(screen.getByText('Agave')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Fits zone 7a/ }));
    expect(screen.queryByText('Agave')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Boxwood/ }));
    expect(useStore.getState().placement).toEqual({ kind: 'object', assetId: 'boxwood' });
    // Second tap disarms.
    fireEvent.click(screen.getByRole('button', { name: /^Boxwood/ }));
    expect(useStore.getState().placement).toBeNull();
  });

  it('points to other categories when a search finds nothing here', () => {
    render(<LibraryPanel />);
    fireEvent.change(screen.getByLabelText('Search plants and objects'), { target: { value: 'bench' } });
    expect(screen.getByText(/No plants match/)).toBeTruthy();
    const group = screen.getByText('Found in other categories:').closest('div')!.parentElement!;
    fireEvent.click(within(group).getByRole('button', { name: /Decor & furniture/ }));
    expect(screen.getByText('Garden bench')).toBeTruthy();
  });

  it('inspects the selected object', () => {
    useStore.getState().select({ objectId: 'obj_1' });
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Flip horizontally/ }));
    expect(design().objects[0].flipX).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Burgundy' }));
    expect(design().objects[0].tint).toBe('#7a2e35');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(design().objects).toHaveLength(2);
  });

  it('opens the info sheet and the add / generate modals', async () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'About Boxwood' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/a good fit for your zone 7a/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Place on photo/ }));
    expect(useStore.getState().placement).toEqual({ kind: 'object', assetId: 'boxwood' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add your own photo' }));
    expect(within(screen.getByRole('dialog')).getByText(/Choose a photo of the item/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Generate with AI \(AI is off\)/ }));
    const gen = screen.getByRole('dialog');
    expect(within(gen).getByText('Generating items needs a Claude key')).toBeTruthy();
    expect(within(gen).queryByText(/ANTHROPIC_API_KEY|\.env/)).toBeNull();
    expect((within(gen).getByRole('button', { name: /^Generate$/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => undefined);
  });

  it('edits and deletes my own assets', async () => {
    const mine: AssetDef = { id: 'ast_1', name: 'My urn', category: 'decor', source: 'user', aspect: 0.8, realHeightFt: 2, tags: [], imageId: 'img_9', createdAt: 5 };
    useStore.setState({ library: [mine] });
    useStore.getState().addObject({ assetId: 'ast_1', x: 10, y: 10, height: 50, rotation: 0, flipX: false, opacity: 1, shadow: true });
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^My assets/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Details, edit or delete My urn/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Edit/ }));
    const nameInput = within(screen.getByRole('dialog')).getByPlaceholderText(/Blue glazed planter/) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Terracotta urn' } });
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' }));
    });
    expect(useStore.getState().library[0].name).toBe('Terracotta urn');

    fireEvent.click(await screen.findByRole('button', { name: /Details, edit or delete Terracotta urn/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Delete/ }));
    expect(within(screen.getByRole('dialog')).getByText(/1 place it’s used/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    });
    expect(useStore.getState().library).toHaveLength(0);
    expect(design().objects.some((o) => o.assetId === 'ast_1')).toBe(false);
  });

  it('adds an uploaded photo with its background removed', async () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add your own photo' }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [new File(['x'], 'blue_planter.jpg', { type: 'image/jpeg' })] } });
    });
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByPlaceholderText(/Blue glazed planter/) as HTMLInputElement).value).toBe('Blue planter');
    // Let the debounced cut-out run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(within(dialog).getByRole('img', { name: 'Item with background removed' })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Background tolerance'), { target: { value: '30' } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 220));
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Save & place/ }));
    });
    const saved = useStore.getState().library[0];
    expect(saved).toMatchObject({ name: 'Blue planter', source: 'user', category: 'plant', aspect: 1 });
    expect(saved.imageId).toBeTruthy();
    expect(useStore.getState().placement).toEqual({ kind: 'object', assetId: saved.id });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('generates a vector item with AI and saves it', async () => {
    useStore.setState({ health: { ok: true, ai: { enabled: true, model: 'claude' }, imageProvider: { enabled: false, name: null, model: null } } });
    generateAssetMock.mockResolvedValueOnce({
      name: 'Teak bench',
      category: 'furniture',
      subcategory: 'bench',
      description: 'A teak garden bench.',
      realHeightFt: 3,
      tags: ['bench', 'teak'],
      costLowUsd: 200,
      costHighUsd: 400,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"></svg>',
      image: null,
      aspect: 2,
    });
    render(<LibraryPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Generate with AI' })[0]);
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('radio', { name: /Photo/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Describe the item/), { target: { value: 'teak garden bench' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^Generate$/ }));
    });
    expect(generateAssetMock).toHaveBeenCalledWith({ description: 'teak garden bench', category: 'plant', mode: 'vector' }, expect.any(AbortSignal));
    expect(within(screen.getByRole('dialog')).getByRole('img', { name: /Generated: Teak bench/ })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save to library' }));
    });
    const saved = useStore.getState().library[0];
    expect(saved).toMatchObject({ name: 'Teak bench', category: 'furniture', source: 'ai', aspect: 2, cost: { low: 200, high: 400, unit: 'each' } });
    expect(saved.svg).toContain('<svg');
    expect(saved.tags).toEqual(['furniture', 'ai-generated', 'bench', 'teak']);
  });
});
