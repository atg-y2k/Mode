// @vitest-environment jsdom
/**
 * Integration smoke tests for the Studio panels: each renders against a
 * seeded project and its main actions reach the store / run orchestration.
 * Network calls, image decoding, persistence and the run pipeline are mocked;
 * the design knowledge base, brief operations and store are real.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductResult } from '../../../../shared/api';
import { DEFAULT_LIGHTING, type Generation, type Photo, type Project, type Recommendation, type SceneMap } from '../../../../shared/types';

// Whole panels render here; leave room for slow CI machines.
vi.setConfig({ testTimeout: 30_000 });

vi.mock('../../../assets/catalog', () => ({
  PLANTS: [],
  FIXTURES: [],
  DECOR: [],
  BUILTIN_ASSETS: [],
  findAsset: () => undefined,
  getMaterial: () => undefined,
}));
vi.mock('../../../engine/assetImages', () => ({ evictAssetImage: () => undefined }));
vi.mock('../../../lib/imageImport', () => {
  const img = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 120;
      data[i + 1] = 150;
      data[i + 2] = 90;
      data[i + 3] = 255;
    }
    return { width: w, height: h, data };
  };
  return {
    importImageFile: async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 40, height: 20, thumb: new Blob(['t'], { type: 'image/jpeg' }) }),
    blobToImageData: async () => img(16, 16),
    blobToAIDataUrl: async () => 'data:image/jpeg;base64,AAAA',
    downloadBlob: () => undefined,
  };
});
vi.mock('../../../state/persistence', () => ({
  putBlob: async () => undefined,
  getBlob: async () => new Blob(['img'], { type: 'image/jpeg' }),
  deleteBlobs: async () => undefined,
  putMask: async () => undefined,
  getMask: async () => undefined,
  deleteMasks: async () => undefined,
  saveLibrary: async () => undefined,
  saveProject: async () => undefined,
  projectMeta: (p: Project) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt, spaceCount: 0, photoCount: 0 }),
}));

const startRun = vi.fn(async () => 'gen_new');
const cancelRun = vi.fn();
vi.mock('../generate', () => ({
  startRun: (...args: unknown[]) => (startRun as (...a: unknown[]) => Promise<string>)(...args),
  cancelRun: (...args: unknown[]) => cancelRun(...args),
  generationBlocker: () => null,
  sceneSummaryText: () => 'Front yard of a colonial.',
}));
const requestSceneAnalysis = vi.fn(() => true);
vi.mock('../../shell/sceneJobs', () => ({
  requestSceneAnalysis: (...args: unknown[]) => (requestSceneAnalysis as (...a: unknown[]) => boolean)(...args),
  useSceneJob: () => undefined,
}));

const fetchRecommendations = vi.fn();
const fetchElementOptions = vi.fn();
const describeIdea = vi.fn(async () => ({ title: 'Stone walk', description: 'Bluestone path with lavender.', styleTags: ['cottage'] }));
vi.mock('../../../lib/studio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/studio')>()),
  fetchRecommendations: (...args: unknown[]) => fetchRecommendations(...args),
  fetchElementOptions: (...args: unknown[]) => fetchElementOptions(...args),
  describeIdea: (...args: unknown[]) => (describeIdea as (...a: unknown[]) => unknown)(...args),
  fetchClimate: async () => ({ hardinessZone: '7a', summary: 'Humid subtropical.', notes: [], source: 'ai', updatedAt: 1 }),
}));

const PRODUCT: ProductResult = {
  name: 'Bobo Hydrangea',
  brand: 'Proven Winners',
  store: 'Nature Hills Nursery',
  storeKind: 'nursery',
  url: 'https://www.naturehills.com/bobo-hydrangea',
  imageUrl: 'https://img.example.com/bobo.jpg',
  priceUsd: 39.99,
  priceText: null,
  category: 'plant',
  description: 'Dwarf panicle hydrangea with white blooms.',
  realHeightFt: 3,
  specs: ['Zones 3-8', '2 gal'],
  plant: { botanical: 'Hydrangea paniculata', sun: 'Full sun to part shade', water: null, zones: '3-8', matureSize: '3 ft' },
  light: null,
};
const searchProducts = vi.fn(async () => ({ products: [PRODUCT], notes: ['Prices checked today.'] }));
const productFromUrl = vi.fn(async () => ({ product: PRODUCT, method: 'structured-data' as const }));
vi.mock('../../../lib/products', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/products')>()),
  searchProducts: (...args: unknown[]) => (searchProducts as (...a: unknown[]) => unknown)(...args),
  productFromUrl: (...args: unknown[]) => (productFromUrl as (...a: unknown[]) => unknown)(...args),
  fetchProductImage: async () => new Blob(['p'], { type: 'image/jpeg' }),
}));

type Store = typeof import('../../../state/store').useStore;
let useStore: Store;
let panels: {
  DesignPanel: typeof import('./DesignPanel').DesignPanel;
  ScenePanel: typeof import('./ScenePanel').ScenePanel;
  IdeasPanel: typeof import('./IdeasPanel').IdeasPanel;
  SuggestionsPanel: typeof import('./SuggestionsPanel').SuggestionsPanel;
  HistoryPanel: typeof import('./HistoryPanel').HistoryPanel;
  ShopModal: typeof import('./ShopModal').ShopModal;
};

function scene(): SceneMap {
  return {
    category: 'front-yard',
    summary: 'Two-story colonial seen from the street.',
    viewpoint: 'From the sidewalk',
    style: 'Colonial',
    boundaries: 'Lawn ends at the sidewalk',
    lighting: 'Morning sun from the left',
    orientation: 'Faces south-east',
    architecture: {
      style: 'Center-hall Colonial Revival',
      era: '1930s',
      features: ['Symmetrical facade'],
      materials: ['Red brick'],
      proportions: 'Two-story mass',
      designLanguage: ['Keep symmetry'],
      purpose: ['Main entry from the driveway'],
    },
    zones: [
      { id: 'z_walk', kind: 'walkway', label: 'Front walk', description: 'Concrete walk', polygon: [{ x: 100, y: 500 }, { x: 300, y: 500 }, { x: 300, y: 700 }, { x: 100, y: 700 }], editable: true, sun: 'full-sun' },
      { id: 'z_lawn', kind: 'lawn', label: 'Front lawn', description: 'Patchy lawn', polygon: [{ x: 400, y: 500 }, { x: 900, y: 500 }, { x: 900, y: 780 }, { x: 400, y: 780 }], editable: true, sun: 'part-sun' },
      { id: 'z_sky', kind: 'sky', label: 'Sky', description: '', polygon: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 100 }], editable: false },
    ],
    paths: [{ id: 'p_main', label: 'Driveway → front door', from: 'driveway', to: 'front door', description: '3 ft concrete', points: [{ x: 200, y: 780 }, { x: 600, y: 420 }], widthPx: 60, kind: 'existing' }],
    keep: ['Mature maple'],
    opportunities: ['Widen the entry walk to 5 ft'],
    createdAt: 1,
    model: 'claude-test',
  };
}

function generation(): Generation {
  return {
    id: 'gen_1',
    createdAt: Date.now() - 60_000,
    brief: { prompt: 'Curved bluestone walk', elements: [], plantMaturity: 'established', ideaItemIds: [], targetZoneIds: ['z_walk'], scope: 'zones' },
    mode: 'variations',
    plan: 'Replace the straight walk with a curved bluestone path; keep the house as is.',
    plantNotes: [{ name: 'Lavender', botanical: 'Lavandula angustifolia', rating: 'caution', notes: ['Needs sharp drainage'], alternative: 'Catmint' }],
    provider: 'openai',
    model: 'gpt-image-1',
    variations: [
      { id: 'var_1', imageId: 'img_v1', thumbId: 'img_t1', width: 1200, height: 800, title: 'Curved bluestone', brief: 'b1', favorite: true, createdAt: 2 },
      { id: 'var_2', imageId: 'img_v2', thumbId: 'img_t2', width: 1200, height: 800, title: 'Wide flagstone', brief: 'b2', favorite: false, createdAt: 3 },
    ],
    status: 'done',
  };
}

function makeProject(withScene = true): Project {
  const photo: Photo = {
    id: 'pho_1',
    name: 'Front',
    imageId: 'img_1',
    thumbId: 'img_2',
    width: 1200,
    height: 800,
    createdAt: 1,
    regions: [],
    generations: [generation()],
    designs: [{ id: 'dsg_1', name: 'Option A', createdAt: 1, updatedAt: 1, treatments: {}, hiddenRegionIds: [], objects: [], lights: [], lighting: { ...DEFAULT_LIGHTING }, aiRenders: [] }],
    activeDesignId: 'dsg_1',
    ...(withScene ? { scene: scene() } : {}),
  };
  return {
    id: 'prj_1',
    version: 1,
    name: 'Home',
    createdAt: 1,
    updatedAt: 1,
    location: { zip: '20817', hardinessZone: '7a' },
    spaces: [{ id: 'spc_1', name: 'Front yard', type: 'front-yard', kind: 'exterior', photos: [photo], createdAt: 1 }],
    ideaBoard: [{ id: 'idea_1', kind: 'note', title: 'No thorny plants', note: 'Kids play here', colors: [], spaceIds: [], active: true, createdAt: 1 }],
    assetList: [],
  };
}

const photo = () => useStore.getState().project!.spaces[0].photos[0];
const draft = () => photo().draft!;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  window.matchMedia ??= ((q: string) => ({ matches: q.includes('min-width'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  URL.createObjectURL ??= () => 'blob:mock';
  URL.revokeObjectURL ??= () => undefined;
});

beforeEach(async () => {
  vi.resetModules();
  startRun.mockClear();
  requestSceneAnalysis.mockClear();
  ({ useStore } = await import('../../../state/store'));
  panels = {
    DesignPanel: (await import('./DesignPanel')).DesignPanel,
    ScenePanel: (await import('./ScenePanel')).ScenePanel,
    IdeasPanel: (await import('./IdeasPanel')).IdeasPanel,
    SuggestionsPanel: (await import('./SuggestionsPanel')).SuggestionsPanel,
    HistoryPanel: (await import('./HistoryPanel')).HistoryPanel,
    ShopModal: (await import('./ShopModal')).ShopModal,
  };
  useStore.setState({
    project: makeProject(),
    selection: { spaceId: 'spc_1', photoId: 'pho_1', regionId: null, objectId: null, lightId: null },
    mode: 'studio',
    past: [],
    future: [],
    health: {
      ok: true,
      ai: { enabled: true, model: 'claude' },
      imageProvider: { enabled: true, name: 'openai', model: 'gpt-image-1' },
      imageProviders: [{ id: 'openai', name: 'OpenAI', model: 'gpt-image-1', isDefault: true }],
    },
  });
});

afterEach(() => cleanup());

describe('DesignPanel', () => {
  it('composes a brief from elements and generates', async () => {
    render(<panels.DesignPanel />);
    expect(screen.getByText('Design brief')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pathway' }));
    expect(draft().elements).toHaveLength(1);
    const el = draft().elements[0];
    // Expanded with its questions and zones / paths preselected from the scene.
    expect(screen.getByText('What size stones?')).toBeTruthy();
    expect(el.zoneIds).toEqual(['z_walk']);
    expect(el.pathIds).toEqual(['p_main']);

    // Pick an option.
    fireEvent.click(screen.getByRole('radio', { name: /Small cobbles/ }));
    expect(draft().elements[0].choices['stone-size']).toEqual(['small-cobbles']);

    // Prompt + generate.
    fireEvent.change(screen.getByLabelText('Describe the changes you want'), { target: { value: 'Warm, welcoming entry' } });
    expect(draft().prompt).toBe('Warm, welcoming entry');
    fireEvent.click(screen.getByRole('button', { name: /Generate 3 variations/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith({ photoId: 'pho_1', mode: 'variations' }));
  });

  it('compares options of one question on the photo', async () => {
    render(<panels.DesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pathway' }));
    const sizeQuestion = screen.getByText('What size stones?').closest('section') as HTMLElement;
    fireEvent.click(within(sizeQuestion).getByRole('button', { name: /Compare/ }));
    const start = within(sizeQuestion).getByRole('button', { name: /Compare 4 on my photo/ });
    fireEvent.click(start);
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    const call = (startRun.mock.calls[0] as unknown[])[0] as { mode: string; compare: { dimensionId: string; optionIds: string[] } };
    expect(call.mode).toBe('compare');
    expect(call.compare.dimensionId).toBe('stone-size');
    expect(call.compare.optionIds).toHaveLength(4);
  });

  it('targets areas, sets plant maturity and toggles inspiration', () => {
    render(<panels.DesignPanel />);
    const areas = screen.getByText('Areas that may change').closest('section') as HTMLElement;
    fireEvent.click(within(areas).getByRole('button', { name: 'Front lawn' }));
    expect(draft().targetZoneIds).toEqual(['z_lawn']);
    fireEvent.click(screen.getByRole('radio', { name: 'Mature' }));
    expect(draft().plantMaturity).toBe('mature');
    fireEvent.click(screen.getByRole('button', { name: /No thorny plants/ }));
    expect(draft().ideaItemIds).toEqual(['__none__']);
  });

  it('tailors an element with AI and shows the tips', async () => {
    fetchElementOptions.mockImplementationOnce(async (_req: unknown, _signal: unknown, builtin: { id: string }[]) => ({
      dimensions: [...builtin, { id: 'mood', label: 'Mood', question: 'What mood?', options: [{ id: 'calm', label: 'Calm', description: 'Quiet', promptText: 'calm' }] }],
      tips: ['Match the brick steps'],
      drafts: [],
    }));
    render(<panels.DesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pathway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tailor options' }));
    expect(await screen.findByText('Match the brick steps')).toBeTruthy();
    expect(screen.getByText('What mood?')).toBeTruthy();
    expect(draft().elements[0].choices.mood).toEqual([]);
  });
});

describe('ScenePanel', () => {
  it('shows the map and edits zones', async () => {
    useStore.getState().updateDraft('pho_1', (b) => void b.targetZoneIds.push('z_walk'));
    render(<panels.ScenePanel />);
    expect(screen.getByText('Center-hall Colonial Revival')).toBeTruthy();
    expect(screen.getByText('Mature maple')).toBeTruthy();
    // Target toggle.
    fireEvent.click(screen.getByRole('button', { name: 'Add to the areas that may change' }));
    expect(draft().targetZoneIds).toEqual(['z_walk', 'z_lawn']);
    // Opportunity → brief.
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(draft().prompt).toContain('Widen the entry walk');
    // Delete a zone: removed from the scene and the brief.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Front walk' }));
    expect(photo().scene!.zones.map((z) => z.id)).toEqual(['z_lawn', 'z_sky']);
    expect(draft().targetZoneIds).toEqual(['z_lawn']);
  });

  it('refines a zone outline as a Fine-tune surface sharing its mask', async () => {
    const runtime = await import('../../../state/runtime');
    render(<panels.ScenePanel />);
    const lawnRow = screen.getByRole('button', { name: /Rename area: Front lawn/ }).closest('li') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(lawnRow).getByRole('button', { name: /Refine outline/ }));
    });
    const s = useStore.getState();
    expect(s.mode).toBe('finetune');
    expect(s.panel).toBe('surfaces');
    const region = photo().regions[0];
    expect(region.surface).toBe('lawn');
    expect(s.selection.regionId).toBe(region.id);
    expect(photo().scene!.zones.find((z) => z.id === 'z_lawn')!.maskId).toBe(region.maskId);
    const mask = runtime.getMask(region.maskId)!;
    expect(mask.data[600 * 1200 + 600]).toBe(255);
    expect(mask.data[100 * 1200 + 100]).toBe(0);
  });

  it('offers to map a photo without a scene', () => {
    useStore.setState({ project: makeProject(false) });
    render(<panels.ScenePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Map the scene' }));
    expect(requestSceneAnalysis).toHaveBeenCalledWith('pho_1', { force: false });
  });
});

describe('IdeasPanel', () => {
  it('adds notes and product links, and edits items', async () => {
    render(<panels.IdeasPanel />);
    expect(screen.getByText('No thorny plants')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Note/ }));
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Pollinators' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });
    expect(useStore.getState().project!.ideaBoard.map((i) => i.title)).toContain('Pollinators');

    fireEvent.change(screen.getByLabelText(/Product link/), { target: { value: 'naturehills.com/bobo-hydrangea' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    await waitFor(() => expect(useStore.getState().project!.ideaBoard.some((i) => i.kind === 'product')).toBe(true));
    expect(productFromUrl).toHaveBeenCalledWith('https://naturehills.com/bobo-hydrangea', expect.anything());
    const product = useStore.getState().project!.ideaBoard.find((i) => i.kind === 'product')!;
    expect(product.product?.store).toBe('Nature Hills Nursery');
    expect(product.imageId).toBeTruthy();
    expect(product.colors.length).toBeGreaterThan(0);

    // Active toggle on the note.
    const noteCard = screen.getByRole('button', { name: /Rename idea: No thorny plants/ }).closest('li') as HTMLElement;
    fireEvent.click(within(noteCard).getByRole('switch'));
    expect(useStore.getState().project!.ideaBoard.find((i) => i.id === 'idea_1')!.active).toBe(false);
  });

  it('adds a design theme', async () => {
    render(<panels.IdeasPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Design theme/ }));
    const dialog = await screen.findByRole('dialog');
    const addButtons = within(dialog).getAllByRole('button', { name: 'Add' });
    await act(async () => {
      fireEvent.click(addButtons[0]);
    });
    expect(useStore.getState().project!.ideaBoard.some((i) => i.kind === 'theme' && i.themeId)).toBe(true);
  });
});

describe('SuggestionsPanel', () => {
  it('fetches suggestions and adds one to the brief or generates it', async () => {
    const rec: Recommendation = {
      id: 'rec_1',
      title: 'Curved entry walk',
      prompt: 'Replace the straight walk with a gently curved 5 ft bluestone path.',
      why: 'Softens the symmetrical facade.',
      category: 'hardscape',
      targetZoneIds: ['z_walk'],
      elementType: 'pathway',
    };
    fetchRecommendations.mockResolvedValueOnce([rec]);
    render(<panels.SuggestionsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Get suggestions' }));
    expect(await screen.findByText('Curved entry walk')).toBeTruthy();
    expect(photo().recommendations?.items).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add to brief' }));
    expect(draft().prompt).toContain('gently curved');
    expect(draft().elements[0].type).toBe('pathway');
    expect(draft().targetZoneIds).toEqual(['z_walk']);

    fireEvent.click(screen.getByRole('button', { name: /Generate now/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    const call = (startRun.mock.calls[0] as unknown[])[0] as { brief: { prompt: string; elements: unknown[] } };
    expect(call.brief.prompt).toBe(rec.prompt);
    expect(call.brief.elements).toHaveLength(1);
  });
});

describe('HistoryPanel', () => {
  it('lists runs with plan, plant check and actions', async () => {
    render(<panels.HistoryPanel />);
    expect(screen.getByText(/curved bluestone path; keep the house/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Plant check/ }));
    expect(screen.getByText('Lavandula angustifolia')).toBeTruthy();
    expect(screen.getByText('Catmint')).toBeTruthy();

    // Favorites filter keeps only the starred variation.
    fireEvent.click(screen.getByRole('radio', { name: /favorites/ }));
    expect(screen.queryByTitle('Wide flagstone')).toBeNull();
    expect(screen.getByTitle('Curved bluestone')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Re-run/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    expect(((startRun.mock.calls[0] as unknown[])[0] as { brief: { prompt: string } }).brief.prompt).toBe('Curved bluestone walk');

    fireEvent.click(screen.getByRole('button', { name: /Edit brief/ }));
    expect(draft().prompt).toBe('Curved bluestone walk');
    expect(useStore.getState().studio.panel).toBe('design');
  });

  it('deletes a run after confirmation', async () => {
    render(<panels.HistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete run' }));
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete run' }));
    });
    expect(photo().generations).toHaveLength(0);
  });
});

describe('ShopModal', () => {
  it('searches stores and adds a product to the idea board', async () => {
    render(<panels.ShopModal />);
    act(() => useStore.getState().openShop({ query: 'hydrangea', category: 'plant' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Search stores/ }));
    expect(await within(dialog).findByText('Bobo Hydrangea')).toBeTruthy();
    expect(searchProducts).toHaveBeenCalledWith(expect.objectContaining({ query: 'hydrangea', category: 'plant', stores: ['home-depot', 'lowes', 'nursery'] }), expect.anything());
    expect(within(dialog).getByText(/fits your zone 7a/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Add to idea board/ }));
    });
    await waitFor(() => expect(useStore.getState().project!.ideaBoard.some((i) => i.product?.url === PRODUCT.url)).toBe(true));
    expect(within(dialog).getByRole('button', { name: /On your board/ })).toBeTruthy();
  });
});
