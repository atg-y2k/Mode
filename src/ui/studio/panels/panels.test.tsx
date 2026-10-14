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
import { NO_DEVICE_MAP_REASON } from './aiErrors';

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
  generationOwnedIds: () => ({ blobIds: [], maskIds: [] }),
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

// The vision module's on-device tools are mounted by the Scene panel; their own tests cover them.
vi.mock('../../../vision/ui/RefineSection', () => ({
  RefineSection: ({ photoId }: { photoId: string }) => <div data-testid="refine-section">{photoId}</div>,
}));
// The free on-device map (used without a Claude key): whether this browser can run it, and the call.
const vision = { supported: true };
const AI_OFF = { ok: true, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null } };
const mapSceneOffline = vi.fn(async () => undefined);
vi.mock('../../../vision/ui/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../vision/ui/jobs')>()),
  canMapOnDevice: () => vision.supported,
  mapSceneOffline: (...args: unknown[]) => (mapSceneOffline as (...a: unknown[]) => Promise<void>)(...args),
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
let useStudioUI: typeof import('../ui').useStudioUI;
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
  mapSceneOffline.mockClear();
  vision.supported = true;
  // Like the real queue: Claude mapping only starts when AI is on.
  requestSceneAnalysis.mockImplementation(() => useStore.getState().health?.ai.enabled === true);
  // ZIP → zone + centre without fetching public/data/zones.json (or phzmapi.org) in tests.
  (await import('../../../site/zip')).setZipTable({ '20817': ['7a', 38.99, -77.15] });
  ({ useStore } = await import('../../../state/store'));
  ({ useStudioUI } = await import('../ui'));
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
    // One variation by default (each is its own hand-off when there is no image key).
    fireEvent.click(screen.getByRole('button', { name: /Generate 1 variation$/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith({ photoId: 'pho_1', mode: 'variations' }));
  });

  it('says a wider or curvier path gets room on the lawn beside it, and drops the note for the old footprint', () => {
    render(<panels.DesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pathway' }));
    // Defaults keep the walk's route and width: nothing beside it changes.
    expect(screen.queryByText(/Room to curve and widen/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Gentle curveOne soft, wide arc/ }));
    expect(screen.getByText(/Room to curve and widen: the lawn alongside the walk may change too/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /StraightDirect, formal line/ }));
    expect(screen.getByRole('radio', { name: /Keep currentSame width as the walk today/ }).getAttribute('aria-checked')).toBe('true');
    expect(draft().elements[0].choices.width).toEqual(['keep-width']);
    expect(screen.queryByText(/Room to curve and widen/)).toBeNull();
  });

  // The lawn moved in the photo (x0..x1); the walk is at x 100–300.
  const withLawnAt = (x0: number, x1: number) => {
    const p = makeProject();
    p.spaces[0].photos[0].scene!.zones[1].polygon = [{ x: x0, y: 500 }, { x: x1, y: 500 }, { x: x1, y: 780 }, { x: x0, y: 780 }];
    useStore.setState({ project: p });
  };
  const clearWhere = async (targetZoneIds: string[]) => {
    const { editBrief } = await import('./actions');
    act(() =>
      editBrief('pho_1', (b) => {
        b.elements[0].zoneIds = [];
        b.elements[0].pathIds = [];
        b.targetZoneIds = targetZoneIds;
      }),
    );
  };

  it('a Pathway with no "Where" of its own and the walk and lawn picked on the photo: the lawn is room enough', async () => {
    withLawnAt(300, 900);
    render(<panels.DesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pathway' }));
    fireEvent.click(screen.getByRole('radio', { name: /Gentle curveOne soft, wide arc/ }));
    await clearWhere(['z_walk', 'z_lawn']);
    expect(screen.getByText(/Room to curve and widen: the lawn alongside the walk may change too/)).toBeTruthy();
    expect(screen.queryByText(/wider or curvier than the area that may change/)).toBeNull();
  });

  it('letting the lawn change for a Pathway with no "Where" keeps the walk it grows from', async () => {
    withLawnAt(700, 1100);
    render(<panels.DesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pathway' }));
    fireEvent.click(screen.getByRole('radio', { name: /Gentle curveOne soft, wide arc/ }));
    await clearWhere(['z_walk']);
    expect(screen.getByText(/wider or curvier than the area that may change/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Let the lawn beside it change' }));
    expect(draft().elements[0].zoneIds).toEqual(['z_walk', 'z_lawn']);
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
    const areas = screen.getByText('Areas to change').closest('section') as HTMLElement;
    fireEvent.click(within(areas).getByRole('button', { name: 'Front lawn' }));
    expect(draft().targetZoneIds).toEqual(['z_lawn']);
    fireEvent.change(screen.getByRole('slider', { name: 'Show new plants as' }), { target: { value: '2' } });
    expect(draft().plantMaturity).toBe('mature');
    fireEvent.click(screen.getByRole('button', { name: 'As planted' }));
    expect(draft().plantMaturity).toBe('new');
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

  it('a planting bed is offered only ground to go on, can be outlined on the photo, and borrows the lawn’s sun', async () => {
    useStore.getState().mutateProject(
      'x',
      (d) => {
        // An on-device map: house, roof, a tree and the lawn — no planting bed found.
        d.spaces[0].photos[0].scene!.zones.push(
          { id: 'z_roof', kind: 'roof', label: 'Roof', description: '', polygon: [{ x: 0, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 200 }], editable: true },
          { id: 'z_facade', kind: 'facade', label: 'Facade', description: '', polygon: [{ x: 0, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 450 }], editable: true },
          { id: 'z_tree', kind: 'tree', label: 'Tree', description: '', polygon: [{ x: 900, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 400 }], editable: true },
        );
      },
      { history: false },
    );
    render(<panels.DesignPanel />);
    if (!screen.queryByRole('button', { name: 'Planting bed' })) fireEvent.click(screen.getByRole('button', { name: /^Show all/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Planting bed' }));
    const el = draft().elements[0];
    expect(el.type).toBe('planting-bed');
    const card = document.querySelector(`[data-element-id="${el.id}"]`) as HTMLElement;
    // Where: ground only — never the roof, the facade or a tree.
    for (const name of ['Roof', 'Facade', 'Tree']) expect(within(card).queryByRole('button', { name })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Front lawn' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Front walk' })).toBeTruthy();
    // The header borrows the lawn's sun and says so.
    expect(within(card).getByRole('group', { name: /^Plant ratings are for: Zone 7a · Part sun \(from the lawn\)/ })).toBeTruthy();

    // "Outline the planting bed on the photo" arms the lasso for this element…
    fireEvent.click(within(card).getByRole('button', { name: 'Outline the planting bed on the photo' }));
    expect(useStore.getState().studio).toMatchObject({ sketch: 'area', showZones: true, activeElementId: el.id });
    // …and the finished outline becomes the bed's own area (a planting bed, not a general target).
    const { addSketchedArea } = await import('../actions');
    const p = photo();
    let id: string | null = null;
    act(() => {
      id = addSketchedArea(p, useStore.getState().project!.spaces[0], [{ x: 420, y: 520 }, { x: 600, y: 520 }, { x: 600, y: 600 }, { x: 420, y: 600 }], { elementId: el.id });
    });
    expect(id).toBeTruthy();
    expect(draft().elements[0].zoneIds).toEqual([id]);
    expect(draft().targetZoneIds).not.toContain(id);
    expect(photo().scene!.zones.find((z) => z.id === id)).toMatchObject({ kind: 'planting-bed', label: 'Sketched area', source: 'sketch' });
    expect(useStore.getState().toasts.at(-1)?.message).toBe('Sketched area added to “Planting bed”.');
    expect(within(card).getByRole('button', { name: 'Sketched area' }).getAttribute('aria-pressed')).toBe('true');
    // An element that already has its areas: a later outline is a general target as before.
    act(() => {
      addSketchedArea(photo(), useStore.getState().project!.spaces[0], [{ x: 700, y: 520 }, { x: 800, y: 520 }, { x: 800, y: 600 }], { elementId: el.id });
    });
    expect(draft().elements[0].zoneIds).toHaveLength(1);
    expect(draft().targetZoneIds).toHaveLength(1);
  });

  it('says calmly that the whole photo may change until it is mapped (no warning colour)', () => {
    useStore.setState({ project: makeProject(false) });
    render(<panels.DesignPanel />);
    const note = screen.getByText('Whole photo may change — map the scene to pick areas.');
    expect(note.className).toContain('text-muted');
    expect(note.closest('[class*="warning"]')).toBeNull();
  });

  it('without a Claude key, offers tailoring as an optional extra (no setup details, no warning)', async () => {
    useStore.setState({ health: { ok: true, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null } } });
    const { useShellUI } = await import('../../shell/shellUI');
    render(<panels.DesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pathway' }));
    expect(screen.getByText(/^Optional: with a Claude key, Mode picks options that suit this house/)).toBeTruthy();
    expect(screen.queryByText(/ANTHROPIC_API_KEY|Needs AI|\.env/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tailor options' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'How to add a Claude key' }));
    expect(useShellUI.getState()).toMatchObject({ settingsOpen: true, settingsTab: 'server' });
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

  it('questions the space type after a Claude map, never after an on-device guess', () => {
    // Claude read the photo as a backyard while the space is a front yard: offer to change the space type.
    useStore.getState().updateScene('pho_1', (sc) => void (sc.category = 'backyard'), {});
    render(<panels.ScenePanel />);
    expect(screen.getByText(/Mode reads this photo as a/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make “Front yard” a backyard' })).toBeTruthy();
    cleanup();
    // The on-device map guesses from the class mix alone (CLIPSeg without SegFormer): no nagging.
    useStore.getState().updateScene(
      'pho_1',
      (sc) => {
        sc.category = 'garden';
        sc.model = 'On-device (CLIPSeg, no AI)';
      },
      {},
    );
    render(<panels.ScenePanel />);
    expect(screen.queryByText(/Mode reads this photo as a/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Make “Front yard” a/ })).toBeNull();
  });

  it('without a Claude key, offers one clear way to map: on this device', () => {
    useStore.setState({ project: makeProject(false), health: AI_OFF });
    render(<panels.ScenePanel />);
    const onDevice = screen.getByTestId('refine-section');
    expect(screen.getAllByTestId('refine-section')).toHaveLength(1);
    // No contradicting "needs AI" block with a disabled button next to it.
    expect(screen.queryByText('Map this photo')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Map the scene' })).toBeNull();
    expect(screen.queryByText(/Turn on AI|AI features are off|ANTHROPIC_API_KEY/)).toBeNull();
    // The key stays reachable, after the on-device map, as optional information.
    const note = screen.getByText(/^Optional: with a Claude key/);
    expect(onDevice.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How to add a Claude key' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('without a key and without on-device support, keeps the calm explanation', () => {
    vision.supported = false;
    useStore.setState({ project: makeProject(false), health: AI_OFF });
    render(<panels.ScenePanel />);
    const onDevice = screen.getByTestId('refine-section');
    const title = screen.getByText('Map this photo');
    expect(onDevice.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Map the scene' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Map the scene with a Claude key')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How to add a Claude key' })).toBeTruthy();
    expect(screen.queryByText(/Turn on AI|ANTHROPIC_API_KEY/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('re-maps on this device without a Claude key', async () => {
    useStore.setState({ health: AI_OFF });
    render(<panels.ScenePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Re-map' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/maps the photo again on this device/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Re-map' }));
    });
    expect(mapSceneOffline).toHaveBeenCalledWith('pho_1', { replace: true });
    expect(requestSceneAnalysis).toHaveBeenCalledWith('pho_1', { force: true });
  });

  it('offers to map a photo without a scene', () => {
    useStore.setState({ project: makeProject(false) });
    render(<panels.ScenePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Map the scene' }));
    expect(requestSceneAnalysis).toHaveBeenCalledWith('pho_1', { force: false });
  });
});

describe('Map the scene without a Claude key', () => {
  const toasts = () => useStore.getState().toasts;
  beforeEach(() => useStore.setState({ project: makeProject(false), health: AI_OFF }));

  it('maps on this device from the Design panel, the element’s “Where” and the Suggest tab — no key error', async () => {
    const design = render(<panels.DesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pathway' }));
    const buttons = screen.getAllByRole('button', { name: 'Map the scene' });
    expect(buttons).toHaveLength(2); // Areas to change + the Pathway's Where
    for (const b of buttons) {
      await act(async () => {
        fireEvent.click(b);
      });
    }
    design.unmount();
    render(<panels.SuggestionsPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Map the scene' }));
    });
    expect(mapSceneOffline).toHaveBeenCalledTimes(3);
    expect(mapSceneOffline).toHaveBeenCalledWith('pho_1', { replace: false });
    expect(toasts().filter((t) => t.kind === 'error')).toEqual([]);
    expect(toasts().map((t) => t.message).join(' ')).not.toMatch(/ANTHROPIC_API_KEY|AI features are off/);
  });

  it('maps on this device when the server can’t be reached either', async () => {
    useStore.setState({ health: { ...AI_OFF, ok: false } });
    const { mapScene } = await import('./actions');
    await mapScene('pho_1');
    expect(mapSceneOffline).toHaveBeenCalledWith('pho_1', { replace: false });
  });

  it('explains calmly when this browser can’t map on the device', async () => {
    vision.supported = false;
    const { mapScene } = await import('./actions');
    await mapScene('pho_1');
    expect(mapSceneOffline).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toMatchObject({ kind: 'info', message: NO_DEVICE_MAP_REASON });
  });

  it('shows the on-device map in progress instead of the button', async () => {
    const { useVisionJobs } = await import('../../../vision/ui/jobs');
    useVisionJobs.setState({ job: { photoId: 'pho_1', kind: 'map', phase: 'mapping', done: 0, total: 0 } });
    try {
      const design = render(<panels.DesignPanel />);
      fireEvent.click(screen.getByRole('button', { name: 'Pathway' }));
      expect(screen.queryByRole('button', { name: 'Map the scene' })).toBeNull();
      expect(screen.getByText(/^Mapping the scene… you can pick areas/)).toBeTruthy();
      expect(screen.getByText(/^Mapping the scene… areas to choose from/)).toBeTruthy();
      design.unmount();
      render(<panels.SuggestionsPanel />);
      expect(screen.queryByRole('button', { name: 'Map the scene' })).toBeNull();
      expect(screen.getByText(/^Mapping the scene… suggestions/)).toBeTruthy();
    } finally {
      useVisionJobs.setState({ job: null });
    }
  });

  it('doesn’t start twice while the device is busy', async () => {
    const { useVisionJobs } = await import('../../../vision/ui/jobs');
    useVisionJobs.setState({ job: { photoId: 'pho_1', kind: 'map', phase: 'mapping', done: 0, total: 0 } });
    try {
      const { mapScene } = await import('./actions');
      await mapScene('pho_1');
      expect(mapSceneOffline).not.toHaveBeenCalled();
      expect(toasts().at(-1)).toMatchObject({ kind: 'info', message: expect.stringMatching(/^Already working on this photo/) });
      // Sharpening this photo isn't a map: a re-map clicked meanwhile says it didn't start.
      useVisionJobs.setState({ job: { photoId: 'pho_1', kind: 'sharpen', phase: 'sharpening', done: 0, total: 3 } });
      await mapScene('pho_1', true);
      expect(mapSceneOffline).not.toHaveBeenCalled();
      expect(toasts().at(-1)).toMatchObject({ kind: 'info', message: 'Sharpening this photo’s outlines on this device — map it again when that finishes.' });
    } finally {
      useVisionJobs.setState({ job: null });
    }
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
    fireEvent.click(screen.getByRole('radio', { name: /Favorites/ }));
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

// ---------------------------------------------------------------------------
// Borrowed Studio UX (SPEC §5.6)
// ---------------------------------------------------------------------------

/** Edits the seeded project before a panel renders. */
function seed(edit: (p: Project) => void) {
  const p = makeProject();
  edit(p);
  useStore.setState({ project: p });
}

const FACADE = { id: 'z_facade', kind: 'facade' as const, label: 'Brick facade', description: '', polygon: [{ x: 50, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 480 }, { x: 50, y: 480 }], editable: true };

describe('Suggested edits', () => {
  it('adds a scene opportunity or an AI suggestion to the brief in one click', () => {
    seed((p) => {
      p.spaces[0].photos[0].recommendations = {
        createdAt: 1,
        items: [{ id: 'rec_1', title: 'Lantern light at the door', prompt: 'Add a pair of warm 2700K lanterns beside the front door.', why: 'Welcoming at night.', category: 'lighting', targetZoneIds: [], elementType: 'outdoor-lighting' }],
      };
    });
    render(<panels.DesignPanel />);
    expect(screen.getByRole('region', { name: 'Suggested edits' })).toBeTruthy();
    // Opportunity: element + areas inferred from its words.
    fireEvent.click(screen.getByRole('button', { name: 'Add to brief: Widen the entry walk to 5 ft' }));
    expect(draft().prompt).toBe('Widen the entry walk to 5 ft');
    expect(draft().elements.map((e) => e.type)).toEqual(['pathway']);
    expect(draft().targetZoneIds).toEqual(['z_walk']);
    expect(screen.queryByRole('button', { name: 'Add to brief: Widen the entry walk to 5 ft' })).toBeNull();
    // AI suggestion.
    fireEvent.click(screen.getByRole('button', { name: 'Add to brief: Lantern light at the door' }));
    expect(draft().elements.map((e) => e.type)).toEqual(['pathway', 'outdoor-lighting']);
    expect(draft().prompt).toContain('warm 2700K lanterns');
    // Nothing left to suggest.
    expect(screen.queryByRole('region', { name: 'Suggested edits' })).toBeNull();
  });
});

describe('Planting elements', () => {
  it('show the site header and the plant growth slider', () => {
    seed((p) => {
      p.location.deerPressure = 'high';
      const lawn = p.spaces[0].photos[0].scene!.zones.find((z) => z.id === 'z_lawn')!;
      lawn.sunHours = 4.8;
      p.spaces[0].photos[0].draft = { prompt: '', elements: [], plantMaturity: 'established', ideaItemIds: [], targetZoneIds: ['z_lawn'], scope: 'zones' };
    });
    render(<panels.DesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Planting bed' }));
    const el = draft().elements[0];
    expect(el.type).toBe('planting-bed');
    const header = screen.getByRole('group', { name: /^Plant ratings are for:/ });
    expect(header.getAttribute('aria-label')).toBe('Plant ratings are for: Zone 7a · Part sun (5 h) · Deer: high');
    // The element's slider and the brief's slider share the brief's plant maturity.
    fireEvent.change(screen.getByRole('slider', { name: 'Show these plants as' }), { target: { value: '0' } });
    expect(draft().plantMaturity).toBe('new');
    expect((screen.getByRole('slider', { name: 'Show new plants as' }) as HTMLInputElement).value).toBe('0');
    // Rough heights for the chosen plants.
    expect(screen.getAllByRole('list', { name: 'Rough plant heights at each stage' }).length).toBeGreaterThan(0);
  });

  it('link to Settings when the ZIP is missing', async () => {
    seed((p) => {
      p.location = {};
    });
    const { useShellUI } = await import('../../shell/shellUI');
    render(<panels.DesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Planting bed' }));
    const header = screen.getByRole('group', { name: /^Plant ratings are for:/ });
    fireEvent.click(within(header).getByRole('button', { name: 'Add ZIP' }));
    expect(useShellUI.getState()).toMatchObject({ settingsOpen: true, settingsTab: 'project' });
    expect(within(header).getByRole('button', { name: 'Deer?' })).toBeTruthy();
  });
});

describe('Sun & orientation', () => {
  it('estimates sun per area from the photo heading and writes it to the zones', () => {
    seed((p) => {
      p.location = { zip: '20817', hardinessZone: '7a', lat: 38.99, lon: -77.15 };
      const ph = p.spaces[0].photos[0];
      // The camera looked north at the house, so the front faces south.
      ph.capture = { headingDeg: 0 };
      ph.scene!.zones.unshift(FACADE);
    });
    render(<panels.ScenePanel />);
    const card = screen.getByText('Sun & orientation').closest('section') as HTMLElement;
    expect(within(card).getByText('south (180°)')).toBeTruthy();
    expect(within(card).getByText("From your photo's compass heading")).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /Update sun on areas \(2\)/ }));
    const zones = photo().scene!.zones;
    for (const id of ['z_walk', 'z_lawn']) {
      const z = zones.find((x) => x.id === id)!;
      expect(z.sun).toBe('full-sun');
      expect(z.sunHours).toBeGreaterThanOrEqual(6);
    }
    expect(photo().scene!.facadeAzimuthDeg).toBe(180);
    expect(photo().scene!.facadeAzimuthSource).toBe('photo');
    expect(within(card).getByRole('button', { name: 'Areas are up to date' })).toBeTruthy();

    // Turning the dial (keyboard) stores the user's direction; the photo's heading can be restored.
    fireEvent.keyDown(within(card).getByRole('slider', { name: /Which way the photographed side faces/ }), { key: 'ArrowRight' });
    expect(photo().scene!.facadeAzimuthDeg).toBe(185);
    expect(photo().scene!.facadeAzimuthSource).toBe('user');
    expect(within(card).getByText('Set by you')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /Use the photo's heading/ }));
    expect(photo().scene!.facadeAzimuthSource).toBeUndefined();
  });

  it('uses the AI orientation and the ZIP centre when nothing better is known', async () => {
    render(<panels.ScenePanel />);
    const card = screen.getByText('Sun & orientation').closest('section') as HTMLElement;
    // "Faces south-east" from the scene map; coordinates from the ZIP table.
    expect(within(card).getByText('south-east (135°)')).toBeTruthy();
    expect(await within(card).findByRole('button', { name: /Update sun on areas/ })).toBeTruthy();
    expect(within(card).getByRole('slider', { name: 'Time of day' })).toBeTruthy();
  });

  it('asks for a ZIP without coordinates', async () => {
    seed((p) => {
      p.location = {};
    });
    const { useShellUI } = await import('../../shell/shellUI');
    render(<panels.ScenePanel />);
    const card = screen.getByText('Sun & orientation').closest('section') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Add ZIP' }));
    expect(useShellUI.getState()).toMatchObject({ settingsOpen: true, settingsTab: 'project' });
  });

  it('mounts the on-device refine tools', () => {
    render(<panels.ScenePanel />);
    expect(screen.getByTestId('refine-section').textContent).toBe('pho_1');
    cleanup();
    useStore.setState({ project: makeProject(false) });
    render(<panels.ScenePanel />);
    expect(screen.getByTestId('refine-section').textContent).toBe('pho_1');
  });
});

describe('Branching history', () => {
  function seedTree() {
    seed((p) => {
      const ph = p.spaces[0].photos[0];
      ph.generations[0].variations[0].source = {
        kind: 'handoff',
        app: 'chatgpt',
        alignment: { inliers: 12, residualPx: 4, driftBefore: 8, driftAfter: 5, outsideChanged: 0.05, aligned: false },
      };
      ph.generations[0].variations[1].source = { kind: 'api', model: 'gpt-image-1' };
      ph.generations.unshift({
        ...generation(),
        id: 'gen_2',
        createdAt: Date.now(),
        baseVariationId: 'var_1',
        plan: 'Add lanterns to the curved walk.',
        status: 'awaiting',
        renderMode: 'handoff',
        provider: 'ChatGPT',
        model: 'hand-off',
        variations: [],
        plantNotes: [],
        planned: [
          { id: 'pl_1', title: 'Lanterns A', brief: 'a', status: 'awaiting-handoff' },
          { id: 'pl_2', title: 'Lanterns B', brief: 'b', status: 'awaiting-handoff' },
        ],
      });
    });
  }

  it('nests runs under the variation they started from', () => {
    seedTree();
    render(<panels.HistoryPanel />);
    expect(screen.getByText('Original photo')).toBeTruthy();
    const branchPlan = screen.getByText('Add lanterns to the curved walk.');
    const parentRun = screen.getByText(/curved bluestone path; keep the house/).closest('li') as HTMLElement;
    // The branched run sits inside its parent run's list item.
    expect(parentRun.contains(branchPlan)).toBe(true);
    expect(within(branchPlan.closest('article') as HTMLElement).getByText('“Curved bluestone”')).toBeTruthy();
  });

  it('shows provenance and alignment, and branches from a variation', () => {
    seedTree();
    render(<panels.HistoryPanel />);
    expect(screen.getByTitle(/^ChatGPT: Rough fit/).textContent).toBe('GPT');
    expect(screen.getByTitle(/^ChatGPT: Rough fit/).getAttribute('title')).not.toMatch(/matching features|\d/);
    expect(screen.getByTitle('Made with API').textContent).toBe('API');
    expect(screen.getByText(/Alignment needs a look: Rough fit/)).toBeTruthy();
    // Viewing a variation does not make it the next run's starting image.
    fireEvent.click(screen.getByTitle('Wide flagstone'));
    expect(useStore.getState().studio.viewVariationId).toBe('var_2');
    expect(useStudioUI.getState().baseVariationId).toBeNull();
    expect(screen.getByText('The next run starts from the original photo.')).toBeTruthy();
    // Branching does (and shows it).
    fireEvent.click(screen.getByRole('button', { name: 'Branch from Wide flagstone' }));
    expect(useStore.getState().studio.viewVariationId).toBe('var_2');
    expect(useStudioUI.getState().baseVariationId).toBe('var_2');
    expect(screen.getByText('Branching from “Wide flagstone”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use original' }));
    expect(useStore.getState().studio.viewVariationId).toBeNull();
    expect(useStudioUI.getState().baseVariationId).toBeNull();
  });

  it('opens the hand-off companion for runs waiting on hand-offs', async () => {
    seedTree();
    const { useHandoffSession } = await import('../handoff/session');
    const seen = vi.fn();
    // A listener that takes the event over (preventDefault): nothing else happens.
    const onOpen = (e: Event) => {
      seen((e as CustomEvent).detail);
      e.preventDefault();
    };
    window.addEventListener('mode:open-handoff', onOpen);
    try {
      render(<panels.HistoryPanel />);
      expect(screen.getByText('Waiting for hand-off · 2')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Continue hand-off' }));
      expect(seen).toHaveBeenCalledWith({ generationId: 'gen_2' });
      expect(useHandoffSession.getState().active).toBeNull();
    } finally {
      window.removeEventListener('mode:open-handoff', onOpen);
    }
    // Nobody listening: the run's first waiting item opens in the companion directly.
    fireEvent.click(screen.getByRole('button', { name: 'Continue hand-off' }));
    expect(useHandoffSession.getState().active).toEqual({ photoId: 'pho_1', generationId: 'gen_2', plannedId: 'pl_1' });
  });

  it('filters to favorites, keeping the branch that leads to them', () => {
    seedTree();
    useStore.getState().updateGeneration('pho_1', 'gen_1', (g) => {
      g.variations[0].favorite = false;
    });
    useStore.getState().updateGeneration('pho_1', 'gen_2', (g) => {
      g.variations.push({ id: 'var_3', imageId: 'i3', thumbId: 't3', width: 10, height: 10, title: 'Lanterns', brief: '', favorite: true, createdAt: 4 });
    });
    render(<panels.HistoryPanel />);
    fireEvent.click(screen.getByRole('radio', { name: /Favorites/ }));
    expect(screen.getByTitle('Lanterns')).toBeTruthy();
    expect(screen.getByText(/No favorites in this run/)).toBeTruthy();
    expect(screen.queryByTitle('Wide flagstone')).toBeNull();
  });
});
