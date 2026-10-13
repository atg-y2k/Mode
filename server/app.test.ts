import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ApiErrorBodySchema,
  DesignSuggestionSchema,
  GeneratedAssetSchema,
  HealthResponseSchema,
  MAX_BODY_BYTES,
  RenderResponseSchema,
  SpaceAnalysisResultSchema,
  type DesignSuggestion,
  type SpaceAnalysisResult,
} from '../shared/api';
import { ApiHttpError } from './errors';
import { boxPng, fakeClaude, fakeImageProvider, makeApp, postJson, tinyPngDataUrl } from './testing';

const IMAGE = tinyPngDataUrl();

const ANALYSIS: SpaceAnalysisResult = {
  spaceType: 'front-exterior',
  summary: 'A two-story colonial with a centered front door.',
  style: 'Traditional colonial',
  surfaces: [
    { surface: 'siding', description: 'Vinyl lap siding', currentColorHex: 'D8D2C4', condition: null },
    { surface: 'front-door', description: 'Six-panel door', currentColorHex: '#abc', condition: 'Faded' },
  ],
  lighting: { natural: 'Morning sun from the left', artificial: 'One porch light', issues: ['Dark entry at night'] },
  landscaping: { features: ['Lawn'], issues: ['Bare foundation beds'] },
  opportunities: ['Paint the front door a deep green'],
};

function suggestion(overrides: Partial<DesignSuggestion> = {}): DesignSuggestion {
  return {
    title: 'Sage & Cedar',
    concept: 'Warm greens and natural wood.',
    palette: [
      { role: 'siding', name: 'Sage', hex: '#8a9a7b', finish: 'satin', brandMatch: null },
      { role: 'door', name: 'Broken', hex: 'not-a-color', finish: 'gloss', brandMatch: null },
    ],
    regionTreatments: [
      { regionId: 'r1', kind: 'paint', hex: '#8A9A7B', colorName: 'Sage', finish: null, materialId: null, reason: 'Calm' },
      { regionId: 'r2', kind: 'material', hex: null, colorName: null, finish: null, materialId: 'made-up', reason: 'Nice' },
      { regionId: 'ghost', kind: 'paint', hex: '#ffffff', colorName: 'White', finish: 'satin', materialId: null, reason: 'x' },
    ],
    lighting: {
      timeOfDay: 'dusk',
      kelvin: 9000,
      fixtures: [
        {
          assetId: 'path-light-bronze',
          name: 'Path light',
          quantity: 4,
          kelvin: 2700,
          placement: 'Along the walk',
          positions: [{ x: 1.4, y: 0.8 }],
        },
        { assetId: 'boxwood-green-velvet', name: 'Wrong kind', quantity: 1, kelvin: 2700, placement: '', positions: [] },
      ],
    },
    plants: [
      {
        assetId: 'boxwood-green-velvet',
        name: 'Boxwood',
        botanical: 'Buxus',
        quantity: 3,
        placement: 'Foundation',
        why: 'Evergreen',
        positions: [{ x: 0.3, y: 0.85 }],
      },
    ],
    decor: [],
    assetList: [
      {
        name: 'Exterior paint',
        category: 'paint',
        quantity: 4,
        unit: 'gal',
        unitCostUsd: 62,
        specs: 'Satin',
        vendor: null,
        notes: '',
        hex: '8a9a7b',
        refId: null,
        spaceNames: [],
      },
    ],
    tips: ['Sample first'],
    estimatedBudget: { lowUsd: 2000, highUsd: 1500 },
    ...overrides,
  };
}

async function errorOf(res: Response) {
  const body = ApiErrorBodySchema.parse(await res.json());
  return body.error;
}

describe('GET /api/health', () => {
  it('reports AI and image provider as disabled by default', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body).toEqual({
      ok: true,
      ai: { enabled: false, model: null },
      imageProvider: { enabled: false, name: null, model: null },
      imageProviders: [],
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('reports the model and image provider when enabled', async () => {
    const { app } = makeApp(
      { aiEnabled: true, claudeModel: 'claude-opus-5-5' },
      { claude: fakeClaude({ output: {} }), imageProvider: fakeImageProvider() },
    );
    const body = HealthResponseSchema.parse(await (await app.request('/api/health')).json());
    expect(body.ai).toEqual({ enabled: true, model: 'claude-opus-5-5' });
    expect(body.imageProvider).toEqual({ enabled: true, name: 'fake', model: 'fake-image-1' });
  });

  it('lists configured image providers', async () => {
    const { app } = makeApp({
      imageProviders: [
        { id: 'openai', model: 'gpt-image-1', isDefault: false },
        { id: 'gemini', model: 'gemini-2.5-flash-image', isDefault: true },
      ],
    });
    const body = HealthResponseSchema.parse(await (await app.request('/api/health')).json());
    expect(body.imageProviders).toEqual([
      { id: 'openai', name: 'OpenAI', model: 'gpt-image-1', isDefault: false },
      { id: 'gemini', name: 'Google Gemini', model: 'gemini-2.5-flash-image', isDefault: true },
    ]);
  });

  it('logs one line per request', async () => {
    const { app, lines } = makeApp();
    await app.request('/api/health');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/GET \/api\/health 200 \d+ms$/);
  });
});

describe('request validation', () => {
  it('rejects an invalid body with 400 and an ApiErrorBody', async () => {
    const { app } = makeApp({ aiEnabled: true }, { claude: fakeClaude({ output: ANALYSIS }) });
    const res = await postJson(app, '/api/analyze', { image: 'not-a-data-url', spaceType: null, notes: null });
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe('bad_request');
    expect(err.message).toContain('image');
  });

  it('rejects malformed JSON', async () => {
    const { app } = makeApp();
    const res = await postJson(app, '/api/suggest', '{"image": ');
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toMatch(/valid JSON/);
  });

  it('validates before reporting AI as disabled', async () => {
    const { app } = makeApp();
    expect((await postJson(app, '/api/analyze', {})).status).toBe(400);
    const res = await postJson(app, '/api/analyze', { image: IMAGE, spaceType: null, notes: null });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('ai_disabled');
  });

  it('returns JSON errors for unknown endpoints and wrong methods', async () => {
    const { app } = makeApp();
    const unknown = await app.request('/api/nope');
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe('bad_request');
    const wrongMethod = await app.request('/api/analyze');
    expect(wrongMethod.status).toBe(405);
  });

  it('rejects bodies over MAX_BODY_BYTES with 413', async () => {
    const { app } = makeApp();
    const res = await postJson(app, '/api/asset-list', 'x'.repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('payload_too_large');
  });

  it('never leaks internal error details', async () => {
    const boom = fakeClaude({ error: new Error('secret sk-ant-api03-abcdefghijklmnop at /srv/x.ts:12') });
    const { app, lines } = makeApp({ aiEnabled: true }, { claude: boom });
    const res = await postJson(app, '/api/analyze', { image: IMAGE, spaceType: null, notes: null });
    expect(res.status).toBe(500);
    const err = await errorOf(res);
    expect(err.code).toBe('internal');
    expect(err.message).not.toContain('sk-ant');
    expect(lines.join('\n')).not.toContain('abcdefghijklmnop');
  });
});

describe('access token', () => {
  const token = 'correct horse battery staple';

  it('leaves /api/health open', async () => {
    const { app } = makeApp({ accessToken: token });
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('requires the x-mode-token header on other routes', async () => {
    const { app } = makeApp({ accessToken: token });
    const missing = await postJson(app, '/api/analyze', {});
    expect(missing.status).toBe(401);
    expect((await errorOf(missing)).message).toMatch(/access token/i);
    const wrong = await postJson(app, '/api/analyze', {}, { 'x-mode-token': 'nope' });
    expect(wrong.status).toBe(401);
    const right = await postJson(app, '/api/analyze', {}, { 'x-mode-token': token });
    expect(right.status).toBe(400); // passes auth, fails validation
  });
});

describe('rate limit', () => {
  it('limits AI calls per client IP and recovers after the window', async () => {
    let now = 1_000_000;
    const { app } = makeApp(
      { aiEnabled: true, rateLimitPer10Min: 2 },
      { claude: fakeClaude({ output: ANALYSIS }), now: () => now },
    );
    const body = { image: IMAGE, spaceType: null, notes: null };
    expect((await postJson(app, '/api/analyze', body)).status).toBe(200);
    // Invalid requests don't count.
    expect((await postJson(app, '/api/analyze', {})).status).toBe(400);
    expect((await postJson(app, '/api/analyze', body)).status).toBe(200);
    const limited = await postJson(app, '/api/analyze', body);
    expect(limited.status).toBe(429);
    expect((await errorOf(limited)).code).toBe('rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another client is unaffected.
    expect((await postJson(app, '/api/analyze', body, { 'x-forwarded-for': '198.51.100.2' })).status).toBe(200);
    now += 10 * 60 * 1000 + 1;
    expect((await postJson(app, '/api/analyze', body)).status).toBe(200);
  });

  it('does not count health checks', async () => {
    const { app } = makeApp({ rateLimitPer10Min: 1 });
    for (let i = 0; i < 5; i++) expect((await app.request('/api/health')).status).toBe(200);
  });
});

describe('POST /api/analyze', () => {
  it('sends a cached system prompt, the image before the text, and normalizes the result', async () => {
    const claude = fakeClaude({ output: ANALYSIS });
    const { app, lines } = makeApp({ aiEnabled: true, claudeModel: 'claude-opus-5-5' }, { claude });
    const res = await postJson(app, '/api/analyze', { image: IMAGE, spaceType: 'front-exterior', notes: 'North facing' });
    expect(res.status).toBe(200);
    const body = SpaceAnalysisResultSchema.parse(await res.json());
    expect(body.surfaces[0].currentColorHex).toBe('#d8d2c4');
    expect(body.surfaces[1].currentColorHex).toBe('#aabbcc');

    const { params } = claude.calls[0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.max_tokens).toBe(16000);
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.fallbacks).toBe('default');
    expect(params.output_config?.effort).toBe('medium');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(params).not.toHaveProperty('thinking');
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('tool_choice');
    const system = params.system as { type: string; text: string; cache_control?: unknown }[];
    expect(system).toHaveLength(1);
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0].text).toContain('boxwood-green-velvet');
    const content = params.messages[0].content as { type: string; text?: string }[];
    expect(content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(content[1].text).toContain('North facing');
    expect(lines[0]).toMatch(/claude:analyze/);
  });

  it('maps a refusal to 422 refused', async () => {
    const { app } = makeApp({ aiEnabled: true }, { claude: fakeClaude({ rawText: '', stopReason: 'refusal' }) });
    const res = await postJson(app, '/api/analyze', { image: IMAGE, spaceType: null, notes: null });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('refused');
  });

  it('maps a truncated answer to upstream_error', async () => {
    const { app } = makeApp({ aiEnabled: true }, { claude: fakeClaude({ rawText: '{"spaceType": "pa', stopReason: 'max_tokens' }) });
    const res = await postJson(app, '/api/analyze', { image: IMAGE, spaceType: null, notes: null });
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('upstream_error');
  });

  it('maps an unreadable answer to upstream_error', async () => {
    const { app } = makeApp({ aiEnabled: true }, { claude: fakeClaude({ output: { nope: true } }) });
    const res = await postJson(app, '/api/analyze', { image: IMAGE, spaceType: null, notes: null });
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('upstream_error');
  });

  it('repairs out-of-enum values instead of failing', async () => {
    const output = { ...ANALYSIS, spaceType: 'Front Exterior', surfaces: [{ ...ANALYSIS.surfaces[0], surface: 'walls' }] };
    const { app } = makeApp({ aiEnabled: true }, { claude: fakeClaude({ output }) });
    const res = await postJson(app, '/api/analyze', { image: IMAGE, spaceType: null, notes: null });
    expect(res.status).toBe(200);
    const body = SpaceAnalysisResultSchema.parse(await res.json());
    expect(body.spaceType).toBe('front-exterior');
    expect(body.surfaces[0].surface).toBe('wall');
  });
});

describe('SDK error mapping (real client, fake fetch)', () => {
  function sdkClient(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Anthropic({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: async () =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }),
    });
  }

  const cases: [number, string, number][] = [
    [429, 'rate_limited', 429],
    [401, 'upstream_error', 502],
    [404, 'upstream_error', 502],
    [400, 'upstream_error', 502],
    [500, 'upstream_error', 502],
    [529, 'upstream_error', 503],
  ];
  for (const [status, code, httpStatus] of cases) {
    it(`maps HTTP ${status} to ${code}`, async () => {
      const client = sdkClient(
        status,
        { type: 'error', error: { type: 'api_error', message: 'upstream says no' } },
        { 'retry-after': '7' },
      );
      const { app } = makeApp({ aiEnabled: true }, { claude: client });
      const res = await postJson(app, '/api/analyze', { image: IMAGE, spaceType: null, notes: null });
      expect(res.status).toBe(httpStatus);
      expect((await errorOf(res)).code).toBe(code);
      if (status === 429) expect(res.headers.get('retry-after')).toBe('7');
    });
  }

  it('maps connection failures to upstream_error', async () => {
    const client = new Anthropic({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const { app } = makeApp({ aiEnabled: true }, { claude: client });
    const res = await postJson(app, '/api/analyze', { image: IMAGE, spaceType: null, notes: null });
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('upstream_error');
  });

  it('parses a real structured-output response and detects refusals', async () => {
    const message = (stop_reason: string, text: string) => ({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: text ? [{ type: 'text', text }] : [],
      stop_reason,
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const ok = sdkClient(200, message('end_turn', JSON.stringify(ANALYSIS)));
    const res = await postJson(makeApp({ aiEnabled: true }, { claude: ok }).app, '/api/analyze', {
      image: IMAGE,
      spaceType: null,
      notes: null,
    });
    expect(res.status).toBe(200);

    // A refusal with partial (non-JSON) text must still map to 'refused'.
    const refused = sdkClient(200, message('refusal', '{"spaceType": "fr'));
    const res2 = await postJson(makeApp({ aiEnabled: true }, { claude: refused }).app, '/api/analyze', {
      image: IMAGE,
      spaceType: null,
      notes: null,
    });
    expect(res2.status).toBe(422);
    expect((await errorOf(res2)).code).toBe('refused');
  });
});

describe('POST /api/suggest', () => {
  const req = {
    image: IMAGE,
    spaceType: 'front-exterior',
    style: 'Craftsman',
    brief: 'Low maintenance',
    budgetUsd: 5000,
    location: { zip: '98103', hardinessZone: '8b', notes: null },
    regions: [
      { id: 'r1', name: 'Siding', surface: 'siding' },
      { id: 'r2', name: 'Walk', surface: 'path' },
    ],
  };

  it('uses high effort and cleans the suggestion against regions and the catalog', async () => {
    const claude = fakeClaude({ output: suggestion() });
    const { app } = makeApp({ aiEnabled: true }, { claude });
    const res = await postJson(app, '/api/suggest', req);
    expect(res.status).toBe(200);
    const body = DesignSuggestionSchema.parse(await res.json());
    expect(claude.calls[0].params.output_config?.effort).toBe('high');
    const text = (claude.calls[0].params.messages[0].content as { type: string; text?: string }[])[1].text ?? '';
    expect(text).toContain('id: r1');
    expect(text).toContain('8b');

    expect(body.regionTreatments.map((t) => t.regionId)).toEqual(['r1', 'r2']);
    expect(body.regionTreatments[0]).toMatchObject({ kind: 'paint', hex: '#8a9a7b', finish: 'satin' });
    expect(body.regionTreatments[1]).toMatchObject({ kind: 'none', materialId: null });
    expect(body.palette).toHaveLength(1);
    expect(body.lighting.kelvin).toBe(6500);
    expect(body.lighting.fixtures[0].assetId).toBe('path-light-bronze');
    expect(body.lighting.fixtures[0].positions[0]).toEqual({ x: 1, y: 0.8 });
    expect(body.lighting.fixtures[1].assetId).toBeNull();
    expect(body.plants[0].assetId).toBe('boxwood-green-velvet');
    expect(body.assetList[0].hex).toBe('#8a9a7b');
    expect(body.estimatedBudget).toEqual({ lowUsd: 1500, highUsd: 2000 });
  });
});

describe('POST /api/asset-list', () => {
  it('drops items that duplicate the existing list', async () => {
    const draft = suggestion().assetList[0];
    const claude = fakeClaude({
      output: {
        items: [draft, { ...draft, name: 'Paint roller kit', category: 'supplies', hex: null }],
        notes: ['Paint in mild weather'],
      },
    });
    const { app } = makeApp({ aiEnabled: true }, { claude });
    const res = await postJson(app, '/api/asset-list', {
      projectName: 'Home',
      location: null,
      budgetUsd: null,
      style: null,
      brief: null,
      designSummary: 'Front of house: siding painted Sage (#8a9a7b), 1200 sq ft.',
      existingItems: [{ name: 'Exterior Paint', category: 'paint', quantity: 4, unit: 'gal' }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { name: string }[]; notes: string[] };
    expect(body.items.map((i) => i.name)).toEqual(['Paint roller kit']);
    expect(body.notes).toEqual(['Paint in mild weather']);
    expect(claude.calls[0].params.output_config?.effort).toBe('medium');
    expect(claude.calls[0].params.messages[0].content).toHaveLength(1);
  });
});

describe('POST /api/generate-asset', () => {
  const meta = {
    name: 'Oakleaf Hydrangea',
    category: 'decor',
    subcategory: 'Shrub',
    description: 'A flowering shrub.',
    realHeightFt: 4,
    tags: ['Shrub', 'white'],
    costLowUsd: 60,
    costHighUsd: 35,
  };

  it('vector: sanitizes the SVG and computes the aspect', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" onload="alert(1)"><script>alert(1)</script>' +
      '<defs><radialGradient id="g"><stop offset="0" stop-color="#3a7"/></radialGradient></defs>' +
      '<ellipse cx="150" cy="250" rx="140" ry="150" fill="url(#g)"/></svg>';
    const claude = fakeClaude({ output: { ...meta, svg } });
    const { app } = makeApp({ aiEnabled: true }, { claude });
    const res = await postJson(app, '/api/generate-asset', { description: 'oakleaf hydrangea', category: 'plant', mode: 'vector' });
    expect(res.status).toBe(200);
    const body = GeneratedAssetSchema.parse(await res.json());
    expect(body.category).toBe('plant');
    expect(body.aspect).toBeCloseTo(0.75, 4);
    expect(body.image).toBeNull();
    expect(body.svg).not.toContain('script');
    expect(body.svg).not.toContain('onload');
    expect(body.svg).toContain('viewBox="0 0 300 400"');
    expect(body.costLowUsd).toBe(35);
    expect(body.costHighUsd).toBe(60);
    expect(body.tags).toEqual(['shrub', 'white']);
    expect(claude.calls[0].params.output_config?.effort).toBe('high');
  });

  it('vector: reports an unusable drawing as upstream_error', async () => {
    const claude = fakeClaude({ output: { ...meta, svg: 'I cannot draw that' } });
    const { app } = makeApp({ aiEnabled: true }, { claude });
    const res = await postJson(app, '/api/generate-asset', { description: 'a bench', category: 'furniture', mode: 'vector' });
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('upstream_error');
  });

  it('vector: requires AI', async () => {
    const { app } = makeApp();
    const res = await postJson(app, '/api/generate-asset', { description: 'a bench', category: 'furniture', mode: 'vector' });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('ai_disabled');
  });

  it('photo: requires an image provider', async () => {
    const { app } = makeApp({ aiEnabled: true }, { claude: fakeClaude({ output: {} }) });
    const res = await postJson(app, '/api/generate-asset', { description: 'a bench', category: 'furniture', mode: 'photo' });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('image_provider_disabled');
  });

  it('photo: works without Claude and trims transparent margins', async () => {
    const png = boxPng(100, 200, { x0: 30, y0: 50, x1: 70, y1: 150 });
    const provider = fakeImageProvider({ base64: Buffer.from(png).toString('base64') });
    const { app } = makeApp({}, { imageProvider: provider });
    const res = await postJson(app, '/api/generate-asset', {
      description: 'Tall 6 ft blue ceramic planter, glossy',
      category: 'decor',
      mode: 'photo',
    });
    expect(res.status).toBe(200);
    const body = GeneratedAssetSchema.parse(await res.json());
    expect(body.image).toMatch(/^data:image\/png;base64,/);
    expect(body.svg).toBeNull();
    expect(body.aspect).toBeCloseTo(44 / 104, 3);
    expect(body.realHeightFt).toBe(6);
    expect(provider.generations[0].transparent).toBe(true);
    expect(provider.generations[0].prompt).toContain('blue ceramic planter');
    expect(provider.generations[0].prompt).toMatch(/transparent background/i);
  });

  it('photo: uses Claude for metadata and the image prompt when available', async () => {
    const claude = fakeClaude({ output: { ...meta, imagePrompt: 'A lush oakleaf hydrangea in bloom', orientation: 'portrait' } });
    const provider = fakeImageProvider();
    const { app } = makeApp({ aiEnabled: true }, { claude, imageProvider: provider });
    const res = await postJson(app, '/api/generate-asset', { description: 'hydrangea', category: 'plant', mode: 'photo' });
    expect(res.status).toBe(200);
    const body = GeneratedAssetSchema.parse(await res.json());
    expect(body.name).toBe('Oakleaf Hydrangea');
    expect(provider.generations[0].orientation).toBe('portrait');
    expect(provider.generations[0].prompt).toContain('A lush oakleaf hydrangea in bloom');
  });
});

describe('POST /api/render', () => {
  const req = {
    image: IMAGE,
    mask: null,
    designSummary: 'Siding painted sage green; three boxwoods along the foundation.',
    instructions: 'Make it dusk',
    strength: 'balanced',
  };

  it('requires an image provider', async () => {
    const { app } = makeApp();
    const res = await postJson(app, '/api/render', req);
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('image_provider_disabled');
  });

  it('renders with a template prompt when AI is off', async () => {
    const provider = fakeImageProvider();
    const { app } = makeApp({}, { imageProvider: provider });
    const res = await postJson(app, '/api/render', { ...req, mask: IMAGE });
    expect(res.status).toBe(200);
    const body = RenderResponseSchema.parse(await res.json());
    expect(body.image).toMatch(/^data:image\/png;base64,/);
    expect(body.provider).toBe('fake/fake-image-1');
    expect(body.prompt).toContain('sage green');
    expect(body.prompt).toContain('Make it dusk');
    expect(provider.edits[0].mask?.mime).toBe('image/png');
    expect(provider.edits[0].image.mime).toBe('image/png');
  });

  it('uses Claude (low effort) to write the prompt', async () => {
    const claude = fakeClaude({ output: { prompt: 'Photo of a craftsman house at dusk with sage siding.' } });
    const provider = fakeImageProvider();
    const { app } = makeApp({ aiEnabled: true }, { claude, imageProvider: provider });
    const res = await postJson(app, '/api/render', req);
    expect(res.status).toBe(200);
    const body = RenderResponseSchema.parse(await res.json());
    expect(body.prompt).toBe('Photo of a craftsman house at dusk with sage siding.');
    expect(provider.edits[0].prompt).toBe(body.prompt);
    expect(claude.calls[0].params.output_config?.effort).toBe('low');
  });

  it('falls back to the template prompt when Claude fails', async () => {
    const claude = fakeClaude({ error: new ApiHttpError('upstream_error', 'overloaded', 503) });
    const provider = fakeImageProvider();
    const { app } = makeApp({ aiEnabled: true }, { claude, imageProvider: provider });
    const res = await postJson(app, '/api/render', req);
    expect(res.status).toBe(200);
    expect((await res.json()).prompt).toContain('photorealistic');
  });

  it('respects a refusal from Claude', async () => {
    const claude = fakeClaude({ rawText: '', stopReason: 'refusal' });
    const provider = fakeImageProvider();
    const { app } = makeApp({ aiEnabled: true }, { claude, imageProvider: provider });
    const res = await postJson(app, '/api/render', req);
    expect(res.status).toBe(422);
    expect(provider.edits).toHaveLength(0);
  });

  it('passes provider errors through', async () => {
    const provider = fakeImageProvider({ error: new ApiHttpError('rate_limited', 'slow down', 429, { retryAfterSec: 60 }) });
    const { app } = makeApp({}, { imageProvider: provider });
    const res = await postJson(app, '/api/render', req);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('rejects a non-PNG mask', async () => {
    const provider = fakeImageProvider();
    const { app } = makeApp({}, { imageProvider: provider });
    const res = await postJson(app, '/api/render', { ...req, mask: 'data:image/jpeg;base64,/9j/AAAA' });
    expect(res.status).toBe(400);
  });
});

describe('extraRoutes hook', () => {
  class StudioLikeError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
      readonly retryAfterSec: number | null = null,
    ) {
      super(message);
    }
  }

  function appWithExtras(overrides = {}) {
    return makeApp(
      { accessToken: 'tok', rateLimitPer10Min: 1, ...overrides },
      {
        extraRoutes: (app, ctx) => {
          app.post('/api/studio/scene', (c) => {
            ctx.consumeAiCall(c);
            ctx.noteForLog(c, 'studio:scene');
            return c.json({ ok: true, ai: ctx.claudeClient() !== null });
          });
          app.post('/api/studio/plan', () => {
            throw new StudioLikeError('upstream_error', 'Planner unavailable', 502, 30);
          });
        },
      },
    );
  }

  it('runs extra routes behind the shared middleware and rate limit', async () => {
    const { app, lines } = appWithExtras();
    expect((await postJson(app, '/api/studio/scene', {})).status).toBe(401);
    const ok = await postJson(app, '/api/studio/scene', {}, { 'x-mode-token': 'tok' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, ai: false });
    expect(lines.at(-1)).toContain('(studio:scene)');
    const limited = await postJson(app, '/api/studio/scene', {}, { 'x-mode-token': 'tok' });
    expect(limited.status).toBe(429);
  });

  it('maps errors that carry an API code and status to ApiErrorBody', async () => {
    const { app } = appWithExtras();
    const res = await postJson(app, '/api/studio/plan', {}, { 'x-mode-token': 'tok' });
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toEqual({ code: 'upstream_error', message: 'Planner unavailable' });
    expect(res.headers.get('retry-after')).toBe('30');
  });

  it('keeps unknown studio paths as JSON 404s when not registered', async () => {
    const { app } = makeApp();
    const res = await postJson(app, '/api/studio/scene', {});
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('bad_request');
  });
});

describe('static web app (production)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mode-static-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Mode</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log("mode")');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const { app } = makeApp({ staticDir: dir, production: true });

  it('serves index.html at /', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Mode</title>');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await app.request('/projects/abc');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('<title>Mode</title>');
  });

  it('serves hashed assets with long-lived caching', async () => {
    const res = await app.request('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('console.log');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('returns 404 for missing files instead of the app shell', async () => {
    const res = await app.request('/assets/missing.js');
    expect(res.status).toBe(404);
  });

  it('keeps the API working', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
    const unknown = await app.request('/api/unknown');
    expect(unknown.status).toBe(404);
    expect(ApiErrorBodySchema.safeParse(await unknown.json()).success).toBe(true);
  });
});
