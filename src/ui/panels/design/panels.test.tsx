// @vitest-environment jsdom
/**
 * Smoke tests for the Surfaces, Paint and Materials panels against the real
 * store: add a surface, outline operations, rename / retype / hide / delete,
 * pick paints (catalog, custom, eyedropper, apply to all) and materials.
 * Catalog, persistence and image modules are mocked.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Design, MaterialDef, PaintColor, Photo, Project, SurfaceKind } from '../../../../shared/types';
import { DEFAULT_LIGHTING } from '../../../../shared/types';

const PAINTS_MOCK: PaintColor[] = [
  { id: 'p-linen', name: 'Soft Linen', hex: '#eee6d8', family: 'white', collection: 'Warm whites', tags: [] },
  { id: 'p-cream', name: 'Morning Cream', hex: '#f1e7cf', family: 'white', collection: 'Warm whites', tags: [] },
  { id: 'p-sage', name: 'Garden Sage', hex: '#9caf88', family: 'green', collection: 'Greens', tags: [] },
  { id: 'p-navy', name: 'Harbor Navy', hex: '#24344d', family: 'blue', collection: 'Blues', tags: ['door'] },
];
const tex = (pattern: MaterialDef['texture']['pattern']) => ({ pattern, colors: ['#8a6a4a', '#6a4a2a'], unitWidthIn: 7.5, unitHeightIn: 72, variation: 0.4, seed: 1 });
const MATERIALS_MOCK: MaterialDef[] = [
  { id: 'oak', name: 'White Oak Planks', category: 'flooring', surfaces: ['floor'], texture: tex('wood-planks'), cost: { low: 4, high: 8, unit: 'sqft' }, description: 'Wide oak', tags: ['wood'] },
  { id: 'pavers', name: 'Brick Pavers', category: 'hardscape', surfaces: ['patio', 'path'], texture: tex('stone-pavers'), cost: { low: 3, high: 6, unit: 'sqft' }, description: 'Clay pavers', tags: [] },
  { id: 'sod', name: 'Tall Fescue Lawn', category: 'ground-cover', surfaces: ['lawn'], texture: tex('grass'), cost: { low: 0.5, high: 1, unit: 'sqft' }, description: 'Lush lawn', tags: [] },
];

vi.mock('../../../assets/catalog', () => ({
  PAINT_COLORS: PAINTS_MOCK,
  MATERIALS: MATERIALS_MOCK,
  PLANTS: [],
  FIXTURES: [],
  DECOR: [],
  BUILTIN_ASSETS: [],
  findAsset: () => undefined,
  getPaint: (id: string) => PAINTS_MOCK.find((p) => p.id === id),
  getMaterial: (id: string) => MATERIALS_MOCK.find((m) => m.id === id),
  materialsForSurface: (s: SurfaceKind) => MATERIALS_MOCK.filter((m) => m.surfaces.includes(s)),
  searchPaints: (q: string, family?: string) =>
    PAINTS_MOCK.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && (!family || p.family === family)),
  nearestPaints: (_hex: string, n = 5) => PAINTS_MOCK.slice(0, n).map((paint, i) => ({ paint, deltaE: 1.5 + i * 3 })),
  parseZone: () => undefined,
}));
vi.mock('../../../engine/textures', () => ({
  textureSwatch: (_spec: unknown, size: number) => ({ width: size, height: size, data: new Uint8ClampedArray(size * size * 4) }),
}));
vi.mock('../../../engine/assetImages', () => ({ evictAssetImage: () => undefined }));
vi.mock('../../../lib/imageImport', () => ({
  importImageFile: async () => ({ blob: new Blob(['x']), width: 40, height: 20, thumb: new Blob(['t']) }),
  blobToImageData: async () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
  downloadBlob: () => undefined,
}));
vi.mock('../../../state/persistence', () => ({
  getMask: async () => undefined,
  putMask: async () => undefined,
  putBlob: async () => undefined,
  deleteBlobs: async () => undefined,
  deleteMasks: async () => undefined,
  saveProject: async () => undefined,
  saveLibrary: async () => undefined,
  projectMeta: (p: Project) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt, spaceCount: 0, photoCount: 0 }),
}));

type Store = typeof import('../../../state/store').useStore;
let useStore: Store;
let runtime: typeof import('../../../state/runtime');
let SurfacesPanel: typeof import('../SurfacesPanel').SurfacesPanel;
let PaintPanel: typeof import('../PaintPanel').PaintPanel;
let MaterialsPanel: typeof import('../MaterialsPanel').MaterialsPanel;

const W = 40;
const H = 20;

function makeProject(kind: 'interior' | 'exterior' = 'interior'): Project {
  const design: Design = {
    id: 'dsg_1',
    name: 'Option A',
    createdAt: 1,
    updatedAt: 1,
    treatments: {},
    hiddenRegionIds: [],
    objects: [],
    lights: [],
    lighting: { ...DEFAULT_LIGHTING },
    aiRenders: [],
  };
  const photo: Photo = {
    id: 'pho_1',
    name: 'Living',
    imageId: 'img_1',
    thumbId: 'img_2',
    width: W,
    height: H,
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
    location: {},
    spaces: [
      kind === 'interior'
        ? { id: 'spc_1', name: 'Living room', type: 'living-room', kind: 'interior', photos: [photo], createdAt: 1 }
        : { id: 'spc_1', name: 'Backyard', type: 'backyard', kind: 'exterior', photos: [photo], createdAt: 1 },
    ],
    ideaBoard: [],
    assetList: [],
  };
}

const photo = () => useStore.getState().project!.spaces[0].photos[0];
const design = () => photo().designs[0];

/** Adds a region through the store and fills part of its mask. */
function addRegion(surface: SurfaceKind, filled = true): string {
  const id = useStore.getState().addRegion(surface)!;
  const r = photo().regions.find((x) => x.id === id)!;
  if (filled) {
    const m = runtime.getMask(r.maskId)!;
    m.data.fill(255, 0, W * 5);
  }
  return id;
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

beforeEach(async () => {
  vi.resetModules();
  ({ useStore } = await import('../../../state/store'));
  runtime = await import('../../../state/runtime');
  ({ SurfacesPanel } = await import('../SurfacesPanel'));
  ({ PaintPanel } = await import('../PaintPanel'));
  ({ MaterialsPanel } = await import('../MaterialsPanel'));
  useStore.setState({
    project: makeProject(),
    selection: { spaceId: 'spc_1', photoId: 'pho_1', regionId: null, objectId: null, lightId: null },
    mode: 'finetune',
    tool: 'select',
    pickedColor: null,
    past: [],
    future: [],
  });
});

afterEach(() => {
  cleanup();
});

describe('SurfacesPanel', () => {
  it('shows an empty state without a photo', () => {
    useStore.setState({ selection: { spaceId: null, photoId: null, regionId: null, objectId: null, lightId: null } });
    render(<SurfacesPanel />);
    expect(screen.getByText('No photo open')).toBeTruthy();
  });

  it('guides the first surface: add → selected + smart brush', async () => {
    render(<SurfacesPanel />);
    expect(screen.getByText('Start here')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add surface: Wall' }));
    const s = useStore.getState();
    expect(photo().regions).toHaveLength(1);
    expect(s.selection.regionId).toBe(photo().regions[0].id);
    expect(s.tool).toBe('smart-brush');
    expect(s.toasts.at(-1)?.message).toMatch(/brush over the wall/i);
    expect(await screen.findByText(/Nothing outlined yet/)).toBeTruthy();
    // Picking another outline tool goes through the store.
    fireEvent.click(screen.getByRole('button', { name: /^Wand/ }));
    expect(useStore.getState().tool).toBe('wand');
    expect(screen.getByRole('switch', { name: /Connected areas only/ })).toBeTruthy();
  });

  it('orders exterior surfaces first for yards', () => {
    useStore.setState({ project: makeProject('exterior') });
    render(<SurfacesPanel />);
    const tiles = screen.getAllByRole('button', { name: /^Add surface:/ });
    expect(tiles[0].getAttribute('aria-label')).toBe('Add surface: Lawn');
  });

  it('runs mask operations as undoable steps', async () => {
    const id = addRegion('wall', false);
    render(<SurfacesPanel />);
    const maskId = photo().regions[0].maskId;
    await screen.findByText(/Nothing outlined yet/);
    expect((screen.getByRole('button', { name: /Clear/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Select all/ }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(runtime.getMask(maskId)!.data.every((v) => v === 255)).toBe(true);
    expect(useStore.getState().past.at(-1)).toMatchObject({ kind: 'mask', label: 'Select whole photo' });
    await waitFor(() => expect(screen.getByText(/Covers/)).toBeTruthy(), { timeout: 1500 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Invert/ }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(runtime.getMask(maskId)!.data.every((v) => v === 0)).toBe(true);
    act(() => useStore.getState().undo());
    expect(runtime.getMask(maskId)!.data.every((v) => v === 255)).toBe(true);
    expect(useStore.getState().selection.regionId).toBe(id);
  });

  it('renames, retypes, hides and deletes surfaces', async () => {
    const id = addRegion('wall');
    useStore.getState().setTreatment(id, { type: 'paint', hex: '#24344d', finish: 'eggshell', coats: 2, strength: 1 });
    render(<SurfacesPanel />);
    const list = screen.getByRole('list', { name: 'Surfaces in this photo' });

    // Inline rename (double-click the name).
    fireEvent.doubleClick(within(list).getByRole('button', { name: 'Wall' }));
    const input = within(list).getByRole('textbox', { name: 'Surface name' });
    fireEvent.change(input, { target: { value: 'Back wall' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(photo().regions[0].name).toBe('Back wall');

    // Changing the type keeps a custom name.
    fireEvent.change(within(list).getByRole('combobox', { name: 'Surface type' }), { target: { value: 'accent-wall' } });
    expect(photo().regions[0]).toMatchObject({ surface: 'accent-wall', name: 'Back wall' });

    // Hide toggle.
    fireEvent.click(within(list).getByRole('button', { name: 'Hide finish on Back wall' }));
    expect(design().hiddenRegionIds).toEqual([id]);

    // Delete with confirmation.
    fireEvent.click(within(list).getByRole('button', { name: 'Delete Back wall' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete surface' }));
    expect(photo().regions).toHaveLength(0);
    expect(design().treatments[id]).toBeUndefined();
  });

  it('edits the perspective plane size and area override', async () => {
    const id = addRegion('floor');
    useStore.getState().updateRegion(id, { plane: { quad: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] } }, {});
    render(<SurfacesPanel />);
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '0.5' } });
    expect(photo().regions[0].plane?.widthFt).toBe(0.5);
    fireEvent.change(screen.getByLabelText(/^Depth/), { target: { value: '12' } });
    expect(photo().regions[0].plane?.heightFt).toBe(12);
    fireEvent.change(screen.getByLabelText(/Area override/), { target: { value: '140' } });
    expect(photo().regions[0].areaSqFtOverride).toBe(140);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(photo().regions[0].plane).toBeUndefined();
  });
});

describe('PaintPanel', () => {
  it('asks for a surface first and lists existing ones', () => {
    addRegion('wall');
    useStore.getState().select({ regionId: null });
    render(<PaintPanel />);
    expect(screen.getByText('Choose a surface')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Surfaces in this photo' });
    fireEvent.click(within(list).getByRole('button', { name: /Wall/ }));
    expect(useStore.getState().selection.regionId).toBe(photo().regions[0].id);
    expect(screen.getByRole('combobox', { name: 'Surface' })).toBeTruthy();
  });

  it('applies catalog colors with surface defaults and edits finish / strength', () => {
    const id = addRegion('trim');
    render(<PaintPanel />);
    expect(screen.getByText('No paint yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Garden Sage, #9CAF88' }));
    expect(design().treatments[id]).toMatchObject({ type: 'paint', paintId: 'p-sage', hex: '#9caf88', finish: 'semi-gloss', coats: 2, strength: 1 });
    expect(screen.getAllByText('Garden Sage').length).toBeGreaterThan(0);
    expect(screen.getByRole('meter', { name: 'Light reflectance value' })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Gloss' }));
    expect(design().treatments[id]).toMatchObject({ finish: 'gloss' });
    fireEvent.change(screen.getByLabelText('Strength'), { target: { value: '60' } });
    expect(design().treatments[id]).toMatchObject({ strength: 0.6 });

    // Picking another color keeps the finish.
    fireEvent.click(screen.getByRole('button', { name: 'Harbor Navy, #24344D' }));
    expect(design().treatments[id]).toMatchObject({ paintId: 'p-navy', finish: 'gloss', strength: 0.6 });

    fireEvent.click(screen.getByRole('button', { name: 'Remove paint' }));
    expect(design().treatments[id]).toBeUndefined();
  });

  it('filters the fan deck by collection and search', () => {
    addRegion('wall');
    render(<PaintPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Greens' }));
    expect(screen.queryByRole('button', { name: 'Soft Linen, #EEE6D8' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Garden Sage, #9CAF88' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All colors' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hue: Blues' }));
    expect(screen.getByRole('button', { name: 'Harbor Navy, #24344D' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Garden Sage, #9CAF88' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Any hue' }));
    fireEvent.change(screen.getByLabelText('Search colors'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No colors match/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'Soft Linen, #EEE6D8' })).toBeTruthy();
  });

  it('applies to every surface of the same type as one undo step', () => {
    const a = addRegion('wall');
    const b = addRegion('wall');
    const c = addRegion('wall');
    useStore.getState().select({ regionId: a });
    render(<PaintPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Garden Sage, #9CAF88' }));
    const before = useStore.getState().past.length;
    fireEvent.click(screen.getByRole('button', { name: /Apply to all 2 other wall surfaces/ }));
    for (const id of [a, b, c]) expect(design().treatments[id]).toMatchObject({ paintId: 'p-sage' });
    expect(useStore.getState().past.length).toBe(before + 1);
    // Used-in-project lists the color once with its usage count.
    const used = screen.getByRole('list', { name: 'Colors used in this project' });
    expect(within(used).getByText('3 surfaces')).toBeTruthy();
  });

  it('applies a custom color with brand and code', () => {
    const id = addRegion('wall');
    render(<PaintPanel />);
    fireEvent.change(screen.getByLabelText('Hex'), { target: { value: '#123ABC' } });
    fireEvent.change(screen.getByLabelText('Color name'), { target: { value: 'Ink' } });
    fireEvent.change(screen.getByLabelText('Brand'), { target: { value: 'Acme Paints' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'AP-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom color' }));
    expect(design().treatments[id]).toEqual({ type: 'paint', hex: '#123abc', colorName: 'Ink', brand: 'Acme Paints', code: 'AP-12', finish: 'eggshell', coats: 2, strength: 1 });
    expect(screen.getByText('Acme Paints · AP-12')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Hex'), { target: { value: 'oops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom color' }));
    expect(screen.getByRole('alert').textContent).toMatch(/hex color/);
  });

  it('runs the eyedropper flow', () => {
    const id = addRegion('wall');
    render(<PaintPanel />);
    fireEvent.click(screen.getByRole('button', { name: /From photo|Pick a color from the photo/ }));
    expect(useStore.getState().tool).toBe('eyedropper');
    act(() => useStore.getState().setPickedColor('#a1b2c3'));
    expect(screen.getByText('Picked from the photo')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Closest library colors' })).getAllByRole('button')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Use #A1B2C3' }));
    expect(design().treatments[id]).toMatchObject({ type: 'paint', hex: '#a1b2c3', colorName: 'Picked color' });
    expect(useStore.getState().pickedColor).toBeNull();
    expect(useStore.getState().tool).toBe('select');
  });
});

describe('MaterialsPanel', () => {
  it('suggests materials for the surface, applies and adjusts them', () => {
    const id = addRegion('floor');
    render(<MaterialsPanel />);
    expect(screen.getByRole('button', { name: /White Oak Planks/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Brick Pavers/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /White Oak Planks/ }));
    expect(design().treatments[id]).toEqual({ type: 'material', materialId: 'oak', scale: 1, rotation: 0, strength: 1 });
    // Horizontal surface without a plane: perspective prompt.
    expect(screen.getByText('Make it recede realistically')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '45°' }));
    expect(design().treatments[id]).toMatchObject({ rotation: 45 });
    fireEvent.change(screen.getByLabelText('Strength'), { target: { value: '80' } });
    expect(design().treatments[id]).toMatchObject({ strength: 0.8 });
    expect(screen.getByText(/Each plank ≈ 7.5 × 72 in/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(design().treatments[id]).toEqual({ type: 'material', materialId: 'oak', scale: 1, rotation: 0, strength: 1 });

    // Show all reveals materials for other surfaces.
    fireEvent.click(screen.getByRole('switch', { name: /Show all/ }));
    fireEvent.click(screen.getByRole('button', { name: /Brick Pavers/ }));
    expect(design().treatments[id]).toMatchObject({ materialId: 'pavers' });

    fireEvent.click(screen.getByRole('button', { name: 'Remove material' }));
    expect(design().treatments[id]).toBeUndefined();
  });

  it('offers paint when no material suits the surface', () => {
    addRegion('trim');
    render(<MaterialsPanel />);
    expect(screen.getByText(/No materials are typical/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a paint color' }));
    expect(useStore.getState().panel).toBe('paint');
  });
});
