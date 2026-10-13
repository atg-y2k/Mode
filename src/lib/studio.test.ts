import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementDimensionDraft, RecommendResult, SceneResult } from '../../shared/api';
import type { ElementDimension } from '../../shared/types';

vi.mock('../assets/design', () => ({
  optionVisualFromDraft: (v: { kind: string; colors: string[] }) => (v.kind === 'color' ? { kind: 'color', hex: v.colors[0] } : undefined),
  mergeDimensions: (builtin: ElementDimension[], drafts: ElementDimensionDraft[]) => [...builtin, ...drafts.map((d) => ({ id: d.id, label: d.label, question: d.question, options: [] }))],
}));
vi.mock('./imageImport', () => ({
  blobToAIDataUrl: vi.fn(async () => 'data:image/jpeg;base64,/9j/AAAA'),
}));

const studio = await import('./studio');
const { ApiError } = await import('./api');
const imageImport = await import('./imageImport');

const photo = { width: 1000, height: 500 };

const result: SceneResult = {
  category: 'front-yard',
  summary: 'Front yard of a ranch.',
  viewpoint: 'Street',
  style: 'Ranch',
  boundaries: 'Sidewalk at the bottom.',
  lighting: 'Noon sun.',
  orientation: 'South',
  architecture: { style: 'Ranch', styleId: null, era: null, features: [], materials: [], proportions: 'One story', designLanguage: [], purpose: [] },
  zones: [
    {
      kind: 'lawn',
      label: 'Lawn',
      description: 'Grass',
      // counter-clockwise on screen, one point out of range, a duplicated closing point
      polygon: [
        { x: 0.1, y: 0.5 },
        { x: 0.1, y: 1.2 },
        { x: 0.6, y: 0.9 },
        { x: 0.6, y: 0.5 },
        { x: 0.1, y: 0.5 },
      ],
      editable: true,
      sun: 'part-sun',
    },
    { kind: 'street', label: 'Street', description: '', polygon: [{ x: 0, y: 0.9 }, { x: 1, y: 0.9 }, { x: 1, y: 1 }, { x: 0, y: 1 }], editable: true, sun: null },
    { kind: 'facade', label: 'Line', description: '', polygon: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }], editable: true, sun: null },
    { kind: 'roof', label: 'NaN', description: '', polygon: [{ x: Number.NaN, y: 0 }, { x: 0.5, y: 0.1 }, { x: 0.6, y: 0.2 }], editable: true, sun: null },
  ],
  paths: [
    { label: '', from: 'Driveway', to: 'Front door', description: 'Concrete', points: [{ x: 0.9, y: 0.95 }, { x: 0.5, y: 0.6 }], widthFraction: 0.05 },
    { label: 'Stub', from: 'a', to: 'b', description: '', points: [{ x: 0.2, y: 0.2 }], widthFraction: 0.05 },
  ],
  keep: ['Oak'],
  opportunities: ['Add a walk'],
};

describe('sceneFromResult', () => {
  it('converts to clamped photo px with fresh ids and clockwise polygons', () => {
    const scene = studio.sceneFromResult(result, photo, 'claude-opus-5-5');
    expect(scene.model).toBe('claude-opus-5-5');
    expect(scene.createdAt).toBeGreaterThan(0);
    expect(scene.zones.map((z) => z.kind)).toEqual(['lawn', 'street']);

    const lawn = scene.zones[0];
    expect(lawn.id).toMatch(/^zone_/);
    expect(lawn.sun).toBe('part-sun');
    expect(lawn.polygon).toHaveLength(4);
    expect(lawn.polygon.every((p) => p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 500)).toBe(true);
    expect(lawn.polygon).toContainEqual({ x: 100, y: 500 }); // y 1.2 clamped to the bottom edge
    expect(studio.polygonSignedArea(lawn.polygon)).toBeGreaterThan(0);

    expect(scene.zones[1].editable).toBe(false);
    expect(scene.zones[1].sun).toBeUndefined();
    expect(scene.zones[0].id).not.toBe(scene.zones[1].id);

    expect(scene.paths).toHaveLength(1);
    expect(scene.paths[0]).toMatchObject({ label: 'Driveway → Front door', kind: 'existing', widthPx: 50, points: [{ x: 900, y: 475 }, { x: 500, y: 300 }] });
    expect(scene.paths[0].id).toMatch(/^path_/);
    expect(scene.architecture.styleId).toBeUndefined();
    expect('era' in scene.architecture).toBe(false);
  });
});

describe('conversions', () => {
  it('turns drafts into dimensions with resolved visuals and feasibility', () => {
    const dims = studio.dimensionsFromDrafts([
      {
        id: 'plants',
        label: 'Plants',
        question: 'Which plants?',
        multiple: true,
        options: [
          {
            id: 'lavender',
            label: 'Lavender',
            description: 'Silver foliage',
            promptText: 'lavender',
            visual: { kind: 'color', pattern: null, colors: ['#8a7fb5'], unitWidthIn: null, unitHeightIn: null },
            rationale: ' Cottage classic ',
            feasibility: { rating: 'caution', reasons: ['Needs sharp drainage'] },
          },
          {
            id: 'hosta',
            label: 'Hosta',
            description: '',
            promptText: 'hostas',
            visual: { kind: 'none', pattern: null, colors: [], unitWidthIn: null, unitHeightIn: null },
            rationale: '',
            feasibility: null,
          },
        ],
      },
    ]);
    expect(dims[0].multiple).toBe(true);
    expect(dims[0].options[0]).toEqual({
      id: 'lavender',
      label: 'Lavender',
      description: 'Silver foliage',
      promptText: 'lavender',
      visual: { kind: 'color', hex: '#8a7fb5' },
      rationale: 'Cottage classic',
      feasibility: { rating: 'caution', reasons: ['Needs sharp drainage'] },
    });
    expect(dims[0].options[1]).toEqual({ id: 'hosta', label: 'Hosta', description: '', promptText: 'hostas' });
  });

  it('gives recommendations fresh ids and keeps only known zones', () => {
    const recs: RecommendResult = {
      recommendations: [{ title: 'Walk', prompt: 'Add a walk', why: 'Arrival', category: 'hardscape', targetZoneIds: ['z1', 'zx', 'z1'], elementType: null }],
    };
    const out = studio.recommendationsFromResult(recs, new Set(['z1']));
    expect(out[0].id).toMatch(/^rec_/);
    expect(out[0].targetZoneIds).toEqual(['z1']);
    expect('elementType' in out[0]).toBe(false);
  });

  it('builds climate profiles and prompt context', () => {
    const profile = studio.climateFromResult(
      { hardinessZone: '7a', summary: 'Humid.', lastFrost: 'mid-April', firstFrost: null, annualRainfallIn: 44, notes: ['Clay'] },
      123,
    );
    expect(profile).toEqual({ hardinessZone: '7a', summary: 'Humid.', lastFrost: 'mid-April', annualRainfallIn: 44, notes: ['Clay'], source: 'ai', updatedAt: 123 });
    expect(studio.locationForApi({ zip: ' 27514 ', climate: profile })).toEqual({ zip: '27514', hardinessZone: '7a', notes: null });
    expect(studio.locationForApi({})).toBeNull();
    const text = studio.climateSummaryText({ climate: profile });
    expect(text).toContain('USDA zone 7a.');
    expect(text).toContain('last mid-April, first unknown');
    expect(studio.climateSummaryText({})).toBeNull();
  });
});

describe('HTTP client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const store = new Map<string, string>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null });
    store.clear();
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  it('analyzeScene sends a downscaled photo with the token and converts the result', async () => {
    store.set('mode.apiToken', 'secret');
    // (a real server never sends NaN; JSON would turn it into null)
    const wire = { ...result, zones: result.zones.filter((z) => z.label !== 'NaN') };
    fetchMock.mockResolvedValueOnce(jsonResponse(wire, 200, { 'x-mode-model': 'claude-opus-5-5' }));
    const scene = await studio.analyzeScene(photo, new Blob(['x']), { spaceTypeHint: 'front-yard' });
    expect(imageImport.blobToAIDataUrl).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/studio/scene');
    expect((init?.headers as Record<string, string>)['x-mode-token']).toBe('secret');
    const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({ width: 1000, height: 500, spaceTypeHint: 'front-yard', notes: null, image: 'data:image/jpeg;base64,/9j/AAAA' });
    expect(scene.model).toBe('claude-opus-5-5');
    expect(scene.zones).toHaveLength(2);
  });

  it('throws ApiError with the server code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'refused', message: 'Claude declined.' } }, 422));
    const err = await studio.fetchClimate({ zip: '10001', hardinessZone: null, notes: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'refused', status: 422, message: 'Claude declined.' });
  });

  it('maps bare HTTP failures and malformed responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }));
    await expect(studio.fetchClimate({ zip: '10001', hardinessZone: null, notes: null })).rejects.toMatchObject({ code: 'network', status: 502 });
    fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    await expect(studio.fetchClimate({ zip: '10001', hardinessZone: null, notes: null })).rejects.toMatchObject({ code: 'internal' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(studio.fetchClimate({ zip: '10001', hardinessZone: null, notes: null })).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('validates requests locally before sending', async () => {
    const err = await studio
      .renderVariation({ image: 'not-a-data-url', mask: null, brief: 'x', references: [], provider: null, quality: 'standard' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'bad_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports caller cancellation as an aborted ApiError', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const pending = studio.planVariations(
      {
        image: 'data:image/jpeg;base64,/9j/AAAA',
        sceneSummary: '',
        zones: [],
        paths: [],
        location: null,
        climate: null,
        brief: { prompt: 'x', scope: 'whole', plantMaturity: 'new', targetZoneLabels: [], elements: [] },
        ideas: [],
        ideaImages: [],
        count: 1,
        compare: null,
        refine: null,
      },
      controller.signal,
    );
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).aborted).toBe(true);
  });

  it('merges tailored options into built-in dimensions when given', async () => {
    const draft = { id: 'edging', label: 'Edging', question: 'Edge?', multiple: false, options: [] };
    fetchMock.mockResolvedValue(jsonResponse({ dimensions: [draft], tips: ['tip'] }));
    const req = {
      elementType: 'pathway' as const,
      elementLabel: 'Walk',
      image: null,
      sceneSummary: '',
      zoneLabels: [],
      ideas: [],
      location: null,
      climate: null,
      existing: [],
      ask: null,
    };
    const builtin: ElementDimension[] = [{ id: 'material', label: 'Material', question: 'Which?', options: [] }];
    const merged = await studio.fetchElementOptions(req, undefined, builtin);
    expect(merged.dimensions.map((d) => d.id)).toEqual(['material', 'edging']);
    expect(merged.tips).toEqual(['tip']);
    expect(merged.drafts).toEqual([draft]);
  });

  it('downloads blobs and surfaces JSON errors for binary endpoints', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    const blob = await studio.studioGetBlob('/api/products/image?url=x', 1000);
    expect(blob.size).toBe(3);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'bad_request', message: 'Not an image.' } }, 400));
    await expect(studio.studioGetBlob('/api/products/image?url=y', 1000)).rejects.toMatchObject({ code: 'bad_request', message: 'Not an image.' });
  });
});
