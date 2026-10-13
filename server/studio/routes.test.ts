import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { PlanRequest, PlanResult, SceneResult } from '../../shared/api';
import type { StudioClaudeMessage } from './claude';
import { StudioError } from './errors';
import { registerStudioRoutes, studioImageProviders, type StudioDeps } from './routes';
import { PNG_1PX_B64, encodeRgbaPng, fakeClaude, fakeFetch, fakeProvider, structuredMessage, type ParseParams } from './testing';

const JPEG_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const PNG_URL = `data:image/png;base64,${PNG_1PX_B64}`;

function makeApp(over: Partial<StudioDeps> = {}) {
  const app = new Hono();
  const logs: string[] = [];
  registerStudioRoutes(app, {
    config: { model: 'claude-opus-5-5' },
    providers: { openai: undefined, gemini: undefined },
    defaultProvider: null,
    designKnowledge: () => 'KNOWLEDGE-TEXT',
    catalogSummary: () => 'CATALOG-TEXT',
    styles: () => [{ id: 'colonial-revival', name: 'Colonial Revival' }],
    log: (l) => logs.push(l),
    ...over,
  });
  return { app, logs };
}

function post(app: Hono, path: string, body: unknown) {
  return app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const sceneData: SceneResult = {
  category: 'front-exterior',
  summary: 'A brick Colonial seen from the street.',
  viewpoint: 'From the curb at eye level.',
  style: 'Traditional',
  boundaries: 'Lawn ends at the public sidewalk.',
  lighting: 'Morning sun from the left.',
  orientation: 'Likely faces south-east.',
  architecture: {
    style: 'Center-hall Colonial Revival',
    styleId: 'colonial-revival',
    era: '1930s',
    features: ['Symmetrical facade'],
    materials: ['Red brick'],
    proportions: 'Two stories, about 40 ft wide.',
    designLanguage: ['Keep the symmetry'],
    purpose: ['Guests arrive from the street'],
  },
  zones: [
    {
      kind: 'lawn',
      label: 'Front lawn',
      description: 'Patchy grass.',
      // counter-clockwise on screen → must come back clockwise
      polygon: [
        { x: 0.1, y: 0.6 },
        { x: 0.1, y: 0.9 },
        { x: 0.5, y: 0.9 },
        { x: 0.5, y: 0.6 },
      ],
      editable: true,
      sun: 'full-sun',
    },
    {
      kind: 'sky',
      label: 'Sky',
      description: 'Blue sky.',
      polygon: [
        { x: 0, y: 0 },
        { x: 1.4, y: 0 },
        { x: 1, y: 0.2 },
        { x: 0, y: 0.2 },
      ],
      editable: true,
      sun: 'full-sun',
    },
    { kind: 'facade', label: 'Too few points', description: '', polygon: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }], editable: true, sun: null },
    {
      kind: 'front-door',
      label: 'Front door',
      description: 'Black six-panel door.',
      polygon: [
        { x: 0.45, y: 0.3 },
        { x: 0.55, y: 0.3 },
        { x: 0.55, y: 0.5 },
        { x: 0.45, y: 0.5 },
      ],
      editable: true,
      sun: 'shade',
    },
  ],
  paths: [
    { label: 'Driveway → door', from: 'driveway', to: 'front door', description: 'Concrete, 3 ft.', points: [{ x: 0.8, y: 0.95 }, { x: 0.5, y: 0.7 }], widthFraction: 0.04 },
    { label: 'Broken', from: 'a', to: 'b', description: '', points: [{ x: 0.5, y: 0.5 }], widthFraction: 0.02 },
  ],
  keep: ['Mature maple'],
  opportunities: ['Widen the walk'],
};

const sceneRequest = { image: JPEG_URL, width: 1600, height: 1200, spaceTypeHint: null, notes: null };

describe('POST /api/studio/scene', () => {
  it('rejects invalid requests with bad_request', async () => {
    const { client } = fakeClaude(() => new Error('should not be called'));
    const { app } = makeApp({ anthropic: client });
    const res = await post(app, '/api/studio/scene', { width: 10 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('bad_request');
    expect(body.error.message).toMatch(/image/);
  });

  it('rejects non-JSON bodies', async () => {
    const { app } = makeApp({ anthropic: fakeClaude(() => new Error('no')).client });
    const res = await app.request('/api/studio/scene', { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(400);
  });

  it('answers ai_disabled without a Claude client', async () => {
    const { app } = makeApp();
    const res = await post(app, '/api/studio/scene', sceneRequest);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ai_disabled');
  });

  it('calls Claude as specified and cleans the scene', async () => {
    const fake = fakeClaude((params) =>
      structuredMessage(params, {
        ...sceneData,
        zones: [...sceneData.zones, { ...sceneData.zones[0], kind: 'Walk', label: 'Front lawn' }],
        architecture: { ...sceneData.architecture },
      }),
    );
    const { app } = makeApp({ anthropic: fake.client });
    const res = await post(app, '/api/studio/scene', sceneRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-mode-model')).toBe('claude-opus-5-5');
    const body = (await res.json()) as SceneResult;

    const call = fake.calls[0] as ParseParams & { fallbacks?: unknown };
    expect(call.model).toBe('claude-opus-5-5');
    expect(call.max_tokens).toBe(16000);
    expect(call.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(call.fallbacks).toBe('default');
    expect(call.output_config?.effort).toBe('high');
    expect(call.output_config?.format?.type).toBe('json_schema');
    expect('thinking' in call).toBe(false);
    expect('temperature' in call).toBe(false);
    expect('tool_choice' in call).toBe(false);
    const system = call.system as { text: string; cache_control?: { type: string } }[];
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0].text).toContain('KNOWLEDGE-TEXT');
    expect(system[0].text).toContain('CATALOG-TEXT');
    const content = call.messages[0].content as { type: string; text?: string }[];
    expect(content[0].type).toBe('image');
    expect(content[content.length - 1].type).toBe('text');
    expect(content[content.length - 1].text).toContain('colonial-revival (Colonial Revival)');

    // degenerate zones / paths dropped, enum repaired, labels unique
    expect(body.zones.map((z) => z.kind)).toEqual(['lawn', 'sky', 'front-door', 'walkway']);
    expect(body.zones[3].label).toBe('Front lawn (2)');
    expect(body.paths).toHaveLength(1);
    // clockwise on screen (positive shoelace area with y down)
    const lawn = body.zones[0].polygon;
    expect(lawn[0]).toEqual({ x: 0.5, y: 0.6 });
    // context zones are never editable and have no sun; coordinates clamped
    expect(body.zones[1].editable).toBe(false);
    expect(body.zones[1].sun).toBeNull();
    expect(Math.max(...body.zones[1].polygon.map((p) => p.x))).toBe(1);
    // sun only for ground zones
    expect(body.zones[2].sun).toBeNull();
    expect(body.architecture.styleId).toBe('colonial-revival');
  });

  it('drops a styleId that is not in the style list', async () => {
    const fake = fakeClaude((params) => structuredMessage(params, { ...sceneData, architecture: { ...sceneData.architecture, styleId: 'made-up' } }));
    const { app } = makeApp({ anthropic: fake.client });
    const body = (await (await post(app, '/api/studio/scene', sceneRequest)).json()) as SceneResult;
    expect(body.architecture.styleId).toBeNull();
  });

  it('maps a refusal to refused (422)', async () => {
    const fake = fakeClaude((params) => structuredMessage(params, "I can't help with that.", 'refusal'));
    const { app } = makeApp({ anthropic: fake.client });
    const res = await post(app, '/api/studio/scene', sceneRequest);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('refused');
  });

  it('maps truncation and unreadable output to upstream_error', async () => {
    const truncated = makeApp({ anthropic: fakeClaude((p) => structuredMessage(p, '{"category":', 'max_tokens')).client });
    const r1 = await post(truncated.app, '/api/studio/scene', sceneRequest);
    expect(r1.status).toBe(502);
    expect(((await r1.json()) as { error: { code: string } }).error.code).toBe('upstream_error');

    const garbage = makeApp({ anthropic: fakeClaude((p) => structuredMessage(p, '{"nope": true}')).client });
    const r2 = await post(garbage.app, '/api/studio/scene', sceneRequest);
    expect(r2.status).toBe(502);
  });

  it('maps SDK rate limits to rate_limited with Retry-After', async () => {
    const err = new Anthropic.RateLimitError(429, { error: { message: 'slow down' } }, 'rate limited', new Headers({ 'retry-after': '12' }));
    const { app } = makeApp({ anthropic: fakeClaude(() => err).client });
    const res = await post(app, '/api/studio/scene', sceneRequest);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('12');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('runs the host rate limiter hook and keeps its error code', async () => {
    const hostError = Object.assign(new Error('Too many AI requests.'), { code: 'rate_limited', status: 429, retryAfterSec: 30 });
    const fake = fakeClaude((p) => structuredMessage(p, sceneData));
    const { app } = makeApp({
      anthropic: fake.client,
      beforeAiCall: () => {
        throw hostError;
      },
    });
    const res = await post(app, '/api/studio/scene', sceneRequest);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(fake.calls).toHaveLength(0);
  });

  it('retries the knowledge load when a source failed', async () => {
    let n = 0;
    const fake = fakeClaude((p) => structuredMessage(p, sceneData));
    const { app, logs } = makeApp({
      anthropic: fake.client,
      designKnowledge: () => {
        n++;
        if (n === 1) throw new Error('not ready');
        return 'LOADED-KNOWLEDGE';
      },
    });
    await post(app, '/api/studio/scene', sceneRequest);
    await post(app, '/api/studio/scene', sceneRequest);
    expect(logs.some((l) => l.includes('design knowledge unavailable'))).toBe(true);
    expect((fake.calls[1].system as { text: string }[])[0].text).toContain('LOADED-KNOWLEDGE');
  });
});

describe('POST /api/studio/climate', () => {
  it('needs a ZIP or a zone', async () => {
    const { app } = makeApp({ anthropic: fakeClaude(() => new Error('no')).client });
    const res = await post(app, '/api/studio/climate', { zip: null, hardinessZone: null, notes: null });
    expect(res.status).toBe(400);
  });

  it('uses low effort and normalizes the zone', async () => {
    const fake = fakeClaude((p) =>
      structuredMessage(p, { hardinessZone: 'Zone 7A', summary: 'Humid subtropical.', lastFrost: 'mid-April', firstFrost: null, annualRainfallIn: 44.44, notes: ['Clay soils'] }),
    );
    const { app } = makeApp({ anthropic: fake.client });
    const res = await post(app, '/api/studio/climate', { zip: '27514', hardinessZone: null, notes: null });
    const body = (await res.json()) as { hardinessZone: string; annualRainfallIn: number };
    expect(fake.calls[0].output_config?.effort).toBe('low');
    expect(body.hardinessZone).toBe('7a');
    expect(body.annualRainfallIn).toBe(44.4);
  });
});

describe('POST /api/studio/element-options', () => {
  it('cleans ids, colors and visuals', async () => {
    const fake = fakeClaude((p) =>
      structuredMessage(p, {
        dimensions: [
          {
            id: 'Stone Size',
            label: 'Stone size',
            question: 'What size stones?',
            multiple: false,
            options: [
              { id: 'large', label: 'Large slabs', description: '18–24 in', promptText: 'large bluestone slabs', visual: { kind: 'texture', pattern: 'flagstone', colors: ['#7A8B99', 'zzz', '#abc'], unitWidthIn: 20, unitHeightIn: 18 }, rationale: 'Suits the Colonial', feasibility: null },
              { id: 'large', label: 'Large pavers', description: '', promptText: 'large pavers', visual: { kind: 'texture', pattern: null, colors: [], unitWidthIn: null, unitHeightIn: null }, rationale: '', feasibility: null },
              { id: 'x', label: '', description: '', promptText: 'nothing', visual: { kind: 'none', pattern: null, colors: [], unitWidthIn: null, unitHeightIn: null }, rationale: '', feasibility: null },
            ],
          },
        ],
        tips: ['Keep primary walks 4–5 ft wide'],
      }),
    );
    const { app } = makeApp({ anthropic: fake.client });
    const res = await post(app, '/api/studio/element-options', {
      elementType: 'pathway',
      elementLabel: 'Front walk',
      image: null,
      sceneSummary: 'A Colonial',
      zoneLabels: ['Front walk'],
      ideas: [],
      location: null,
      climate: null,
      existing: [{ id: 'stone-size', label: 'Stone size', optionLabels: ['Large'] }],
      ask: null,
    });
    expect(res.status).toBe(200);
    expect(fake.calls[0].output_config?.effort).toBe('medium');
    const body = (await res.json()) as { dimensions: { id: string; options: { id: string; visual: { kind: string; colors: string[] } }[] }[] };
    expect(body.dimensions[0].id).toBe('stone-size');
    expect(body.dimensions[0].options.map((o) => o.id)).toEqual(['large', 'large-2']);
    expect(body.dimensions[0].options[0].visual.colors).toEqual(['#7a8b99', '#aabbcc']);
    expect(body.dimensions[0].options[1].visual.kind).toBe('none');
  });
});

describe('POST /api/studio/recommend', () => {
  it('keeps only zone ids that were sent', async () => {
    const fake = fakeClaude((p) =>
      structuredMessage(p, {
        recommendations: [
          { title: 'Bluestone walk', prompt: 'Replace the walk', why: 'Suits the brick', category: 'hardscape', targetZoneIds: ['z1', 'ghost'], elementType: 'pathway' },
        ],
      }),
    );
    const { app } = makeApp({ anthropic: fake.client });
    const res = await post(app, '/api/studio/recommend', {
      image: JPEG_URL,
      sceneSummary: 'A Colonial',
      zones: [{ id: 'z1', kind: 'walkway', label: 'Walk' }],
      ideas: [],
      location: null,
      climate: null,
      focus: null,
    });
    const body = (await res.json()) as { recommendations: { targetZoneIds: string[] }[] };
    expect(fake.calls[0].output_config?.effort).toBe('high');
    expect(body.recommendations[0].targetZoneIds).toEqual(['z1']);
  });
});

describe('POST /api/studio/describe-idea', () => {
  it('describes with low effort', async () => {
    const fake = fakeClaude((p) => structuredMessage(p, { title: ' Cottage walk ', description: 'Flagstones and lavender.', styleTags: ['Cottage', 'cottage', 'stone'] }));
    const { app } = makeApp({ anthropic: fake.client });
    const res = await post(app, '/api/studio/describe-idea', { image: JPEG_URL, note: 'love the lavender' });
    const body = (await res.json()) as { title: string; styleTags: string[] };
    expect(fake.calls[0].output_config?.effort).toBe('low');
    expect(body.title).toBe('Cottage walk');
    expect(body.styleTags).toEqual(['cottage', 'stone']);
  });
});

const planRequest: PlanRequest = {
  image: JPEG_URL,
  sceneSummary: 'Brick Colonial, concrete walk.',
  zones: [{ id: 'z1', kind: 'walkway', label: 'Front walk', description: 'Concrete 3 ft', sun: 'full-sun' }],
  paths: [{ id: 'p1', label: 'Driveway → door', description: 'Concrete' }],
  location: { zip: '27514', hardinessZone: '7b', notes: null },
  climate: 'Humid subtropical.',
  brief: {
    prompt: 'A welcoming walk',
    scope: 'zones',
    plantMaturity: 'established',
    targetZoneLabels: ['Front walk'],
    elements: [
      {
        type: 'pathway',
        label: 'Front walk',
        where: ['Front walk'],
        choices: [
          { dimension: 'Material', options: ['bluestone'] },
          { dimension: 'Stone size', options: ['large flagstones 18–24 in'] },
        ],
        note: '',
      },
    ],
  },
  ideas: [],
  ideaImages: [],
  count: 3,
  compare: null,
  refine: null,
};

const compareOptions = [
  { id: 'large', label: 'Large flagstone', promptText: 'large flagstones 18–24 in' },
  { id: 'medium', label: 'Medium pavers', promptText: 'medium pavers 12–16 in' },
  { id: 'cobble', label: 'Small cobbles', promptText: 'small cobbles 4 in' },
];

describe('POST /api/studio/plan', () => {
  it('passes compare options through in order, one variation each', async () => {
    const fake = fakeClaude((p) =>
      structuredMessage(p, {
        plan: 'Compare stone sizes.',
        plants: [{ name: 'Lavender', botanical: 'Lavandula', rating: 'good', notes: ['Zones 5–9 ✓'], alternative: null }],
        variations: [
          { title: 'Medium pavers', brief: 'Edit this photo: lay medium pavers 12–16 in along the walk.', optionId: 'medium' },
          { title: 'Large flagstone', brief: 'Edit this photo: lay large flagstones 18–24 in along the walk.', optionId: 'large' },
        ],
      } satisfies PlanResult),
    );
    const { app } = makeApp({ anthropic: fake.client });
    const res = await post(app, '/api/studio/plan', {
      ...planRequest,
      compare: { elementLabel: 'Front walk', dimensionLabel: 'Stone size', options: compareOptions },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-mode-plan-source')).toBe('ai');
    const body = (await res.json()) as PlanResult;
    expect(body.variations.map((v) => v.optionId)).toEqual(['large', 'medium', 'cobble']);
    expect(body.variations[0].brief).toContain('large flagstones');
    // the missing option reuses a sibling's brief with only the option wording swapped
    expect(body.variations[2].brief).toBe('Edit this photo: lay small cobbles 4 in along the walk.');
    expect(body.variations[2].title).toBe('Small cobbles');
    expect(body.plants[0].name).toBe('Lavender');

    const call = fake.calls[0];
    expect(call.output_config?.effort).toBe('high');
    const text = (call.messages[0].content as { type: string; text?: string }[]).at(-1)?.text ?? '';
    expect(text).toContain('id cobble');
    expect(text).toContain('compare run');
  });

  it('cross-checks plant ratings against the catalog for the property zone', async () => {
    const fake = fakeClaude((p) =>
      structuredMessage(p, {
        plan: 'Tropical border.',
        plants: [{ name: 'Bougainvillea', botanical: 'Bougainvillea glabra', rating: 'good', notes: ['Vivid'], alternative: null }],
        variations: [{ title: 'Tropical', brief: 'Edit this photo.', optionId: null }],
      }),
    );
    const { app } = makeApp({
      anthropic: fake.client,
      plants: () => [
        {
          id: 'bougainvillea',
          name: 'Bougainvillea',
          category: 'plant',
          source: 'builtin',
          aspect: 1,
          realHeightFt: 6,
          tags: [],
          plant: { botanical: 'Bougainvillea glabra', type: 'vine', sun: ['full-sun'], water: 'low', zoneMin: 9, zoneMax: 11, matureHeightFt: 15, matureWidthFt: 8, evergreen: true, indoor: false },
        },
      ],
    });
    const body = (await (await post(app, '/api/studio/plan', { ...planRequest, count: 1 })).json()) as PlanResult;
    expect(body.plants[0].rating).toBe('poor');
    expect(body.plants[0].notes.at(-1)).toContain('zone 7b');
  });

  it('limits normal runs to the requested count and nulls optionIds', async () => {
    const fake = fakeClaude((p) =>
      structuredMessage(p, {
        plan: 'Three takes.',
        plants: [],
        variations: Array.from({ length: 5 }, (_, i) => ({ title: `Take ${i + 1}`, brief: `Edit this photo ${i + 1}.`, optionId: 'x' })),
      }),
    );
    const { app } = makeApp({ anthropic: fake.client });
    const body = (await (await post(app, '/api/studio/plan', planRequest)).json()) as PlanResult;
    expect(body.variations).toHaveLength(3);
    expect(body.variations.every((v) => v.optionId === null)).toBe(true);
  });

  it('puts idea images after the base photo and before the text', async () => {
    const fake = fakeClaude((p) => structuredMessage(p, { plan: 'x', plants: [], variations: [{ title: 't', brief: 'b', optionId: null }] }));
    const { app } = makeApp({ anthropic: fake.client });
    await post(app, '/api/studio/plan', { ...planRequest, count: 1, ideaImages: [PNG_URL, PNG_URL] });
    const content = fake.calls[0].messages[0].content as { type: string; source?: { media_type: string } }[];
    expect(content.map((b) => b.type)).toEqual(['image', 'image', 'image', 'text']);
    expect(content[0].source?.media_type).toBe('image/jpeg');
  });

  it('falls back to a template plan when Claude is not configured', async () => {
    const { app } = makeApp();
    const res = await post(app, '/api/studio/plan', planRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-mode-plan-source')).toBe('template');
    const body = (await res.json()) as PlanResult;
    expect(body.variations).toHaveLength(3);
    for (const v of body.variations) {
      expect(v.brief).toContain('large flagstones 18–24 in');
      expect(v.brief).toContain('Keep the camera position');
    }
    expect(new Set(body.variations.map((v) => v.brief)).size).toBe(3);
  });

  it('template compare plans vary only the compared option', async () => {
    const { app } = makeApp();
    const body = (await (
      await post(app, '/api/studio/plan', { ...planRequest, compare: { elementLabel: 'Front walk', dimensionLabel: 'Stone size', options: compareOptions } })
    ).json()) as PlanResult;
    expect(body.variations.map((v) => v.optionId)).toEqual(['large', 'medium', 'cobble']);
    expect(body.variations[1].brief).toContain('medium pavers 12–16 in');
    expect(body.variations[1].brief).not.toContain('large flagstones');
    expect(body.variations[1].brief.replace('medium pavers 12–16 in', 'X')).toBe(body.variations[2].brief.replace('small cobbles 4 in', 'X'));
  });

  it('rejects duplicate compare option ids', async () => {
    const { app } = makeApp();
    const res = await post(app, '/api/studio/plan', {
      ...planRequest,
      compare: { elementLabel: 'Walk', dimensionLabel: 'Size', options: [compareOptions[0], compareOptions[0]] },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/studio/render-variation', () => {
  const mask = encodeRgbaPng(8, 8, (x, y) => (y >= 4 && x < 4 ? 0 : 255)).toString('base64');
  const renderReq = { image: JPEG_URL, mask: `data:image/png;base64,${mask}`, brief: 'Edit this photo: new walk.', references: [PNG_URL], provider: null, quality: 'standard' };

  it('uses the default provider and passes the mask to OpenAI', async () => {
    const openai = fakeProvider('openai', true);
    const { app } = makeApp({ providers: { openai, gemini: undefined }, defaultProvider: 'openai' });
    const res = await post(app, '/api/studio/render-variation', renderReq);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { image: string; provider: string; model: string };
    expect(body).toEqual({ image: `data:image/png;base64,${PNG_1PX_B64}`, provider: 'openai', model: 'gpt-image-1' });
    expect(openai.calls[0].mask?.mime).toBe('image/png');
    expect(openai.calls[0].references).toHaveLength(1);
    expect(openai.calls[0].quality).toBe('standard');
    expect(openai.calls[0].prompt).toContain('The first image is the homeowner');
    expect(openai.calls[0].prompt).toContain('new walk');
  });

  it('honours the requested provider; Gemini gets the region in words instead of a mask', async () => {
    const openai = fakeProvider('openai', true);
    const gemini = fakeProvider('gemini', false);
    const { app } = makeApp({ providers: { openai, gemini }, defaultProvider: 'openai' });
    const res = await post(app, '/api/studio/render-variation', { ...renderReq, provider: 'gemini' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { provider: string }).provider).toBe('gemini');
    expect(openai.calls).toHaveLength(0);
    expect(gemini.calls[0].mask).toBeNull();
    expect(gemini.calls[0].prompt).toContain('The area you may change covers about 25%');
    expect(gemini.calls[0].prompt).toContain('lower left');
    expect(gemini.calls[0].prompt).toContain('same framing');
  });

  it('answers image_provider_disabled for unconfigured providers', async () => {
    const { app } = makeApp({ providers: { openai: fakeProvider('openai', true), gemini: undefined }, defaultProvider: 'openai' });
    const res = await post(app, '/api/studio/render-variation', { ...renderReq, provider: 'gemini' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('image_provider_disabled');
    expect(body.error.message).toContain('GEMINI_API_KEY');

    const none = makeApp();
    const r2 = await post(none.app, '/api/studio/render-variation', renderReq);
    expect(r2.status).toBe(503);
  });

  it('requires a PNG mask', async () => {
    const { app } = makeApp({ providers: { openai: fakeProvider('openai', true), gemini: undefined }, defaultProvider: 'openai' });
    const res = await post(app, '/api/studio/render-variation', { ...renderReq, mask: JPEG_URL });
    expect(res.status).toBe(400);
  });

  it('maps provider errors to ApiErrorBody', async () => {
    const openai = fakeProvider('openai', true, async () => {
      throw new StudioError('refused', 'Declined by the safety system.', 422);
    });
    const { app } = makeApp({ providers: { openai, gemini: undefined }, defaultProvider: 'openai' });
    const res = await post(app, '/api/studio/render-variation', renderReq);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('refused');
  });
});

describe('studioImageProviders', () => {
  it('lists configured providers with the default flagged', () => {
    expect(
      studioImageProviders({ providers: { openai: fakeProvider('openai', true), gemini: fakeProvider('gemini', false) }, defaultProvider: 'gemini' }),
    ).toEqual([
      { id: 'openai', name: 'OpenAI', model: 'gpt-image-1', isDefault: false },
      { id: 'gemini', name: 'Google Gemini', model: 'gemini-2.5-flash-image', isDefault: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const publicResolver = async () => ['93.184.216.34'];

describe('POST /api/products/from-url', () => {
  it.each([
    'http://127.0.0.1/admin',
    'http://10.0.0.7/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'http://localhost/',
  ])('refuses %s without fetching', async (url) => {
    const net = fakeFetch({});
    const { app } = makeApp({ fetch: net.fetch, resolveHost: publicResolver });
    const res = await post(app, '/api/products/from-url', { url });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
    expect(net.requested).toHaveLength(0);
  });

  it('refuses hosts that resolve to private addresses', async () => {
    const net = fakeFetch({});
    const { app } = makeApp({ fetch: net.fetch, resolveHost: async () => ['192.168.1.20'] });
    const res = await post(app, '/api/products/from-url', { url: 'https://shop.example.com/p/lamp' });
    expect(res.status).toBe(400);
    expect(net.requested).toHaveLength(0);
  });

  it('refuses redirects to private addresses', async () => {
    const net = fakeFetch({
      'https://shop.example.com/p/lamp': () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8787/api/health' } }),
    });
    const { app } = makeApp({ fetch: net.fetch, resolveHost: publicResolver });
    const res = await post(app, '/api/products/from-url', { url: 'https://shop.example.com/p/lamp' });
    expect(res.status).toBe(400);
    expect(net.requested).toEqual(['https://shop.example.com/p/lamp']);
  });

  it('reads JSON-LD product data without AI', async () => {
    const url = 'https://www.homedepot.com/p/Hampton-Bay-Bronze-Path-Light/312345678';
    const html = `<!doctype html><html><head><title>Path Light - The Home Depot</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},
      {"@type":"Product","name":"Hampton Bay 10-Lumen Bronze LED Path Light","brand":{"@type":"Brand","name":"Hampton Bay"},
      "image":["/images/path-light.jpg"],"description":"Low voltage path light, 3000K.",
      "offers":{"@type":"AggregateOffer","lowPrice":"24.97","highPrice":"29.97","priceCurrency":"USD"}}]}</script>
      </head><body>hello</body></html>`;
    const net = fakeFetch({ [url]: () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) });
    const { app } = makeApp({ fetch: net.fetch, resolveHost: publicResolver });
    const res = await post(app, '/api/products/from-url', { url });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { method: string; product: Record<string, unknown> };
    expect(body.method).toBe('structured-data');
    expect(body.product).toMatchObject({
      name: 'Hampton Bay 10-Lumen Bronze LED Path Light',
      brand: 'Hampton Bay',
      store: 'The Home Depot',
      storeKind: 'home-depot',
      url,
      imageUrl: 'https://www.homedepot.com/images/path-light.jpg',
      priceUsd: 24.97,
      priceText: '$24.97–$29.97',
      category: 'lighting',
    });
  });

  it("returns 'partial' when the store blocks the request", async () => {
    const url = 'https://www.lowes.com/pd/Style-Selections-Black-Planter/1000123456';
    const net = fakeFetch({ [url]: () => new Response('Access denied', { status: 403 }) });
    const { app } = makeApp({ fetch: net.fetch, resolveHost: publicResolver });
    const body = (await (await post(app, '/api/products/from-url', { url })).json()) as { method: string; product: { name: string; storeKind: string } };
    expect(body.method).toBe('partial');
    expect(body.product.name).toBe('Style Selections Black Planter');
    expect(body.product.storeKind).toBe('lowes');
  });

  it('reports missing pages but degrades server errors to partial', async () => {
    const missing = 'https://www.lowes.com/pd/Gone/1';
    const broken = 'https://www.lowes.com/pd/Broken-Planter/2';
    const net = fakeFetch({ [missing]: () => new Response('nope', { status: 404 }), [broken]: () => new Response('oops', { status: 500 }) });
    const { app } = makeApp({ fetch: net.fetch, resolveHost: publicResolver });
    expect((await post(app, '/api/products/from-url', { url: missing })).status).toBe(400);
    const body = (await (await post(app, '/api/products/from-url', { url: broken })).json()) as { method: string };
    expect(body.method).toBe('partial');
  });

  it('falls back to Claude reading the page text', async () => {
    const url = 'https://www.naturehills.com/limelight-hydrangea';
    const html = `<html><head><meta property="og:image" content="https://cdn.naturehills.com/limelight.jpg"><title>Limelight</title></head>
      <body><h1>Limelight Hydrangea</h1><p>Zones 3-9. Full sun to part shade.</p><img src="/img/limelight-2.jpg"></body></html>`;
    const net = fakeFetch({ [url]: () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }) });
    const fake = fakeClaude((p) =>
      structuredMessage(p, {
        name: 'Limelight Hydrangea',
        brand: null,
        store: 'Nature Hills',
        storeKind: 'other',
        url: 'https://evil.example.com/',
        imageUrl: 'https://made-up.example.com/x.jpg',
        priceUsd: 39.95,
        priceText: '$39.95',
        category: 'plant',
        description: 'Panicle hydrangea.',
        realHeightFt: 2,
        specs: ['Zones 3-9'],
        plant: { botanical: 'Hydrangea paniculata', sun: 'Full sun to part shade', water: 'medium', zones: '3-9', matureSize: '6-8 ft' },
        light: null,
      }),
    );
    const { app } = makeApp({ anthropic: fake.client, fetch: net.fetch, resolveHost: publicResolver });
    const body = (await (await post(app, '/api/products/from-url', { url })).json()) as { method: string; product: Record<string, unknown> };
    expect(body.method).toBe('ai');
    expect(body.product.url).toBe(url);
    expect(body.product.imageUrl).toBe('https://cdn.naturehills.com/limelight.jpg');
    expect(body.product.storeKind).toBe('nursery');
    expect(body.product.store).toBe('Nature Hills Nursery');
    const text = (fake.calls[0].messages[0].content as { text?: string }[]).at(-1)?.text ?? '';
    expect(text).toContain('Limelight Hydrangea');
    expect(text).toContain('https://www.naturehills.com/img/limelight-2.jpg');
  });
});

describe('GET /api/products/image', () => {
  it('proxies raster images', async () => {
    const png = Buffer.from(PNG_1PX_B64, 'base64');
    const net = fakeFetch({ 'https://images.example.com/a.png': () => new Response(png, { headers: { 'content-type': 'image/png' } }) });
    const { app } = makeApp({ fetch: net.fetch, resolveHost: publicResolver });
    const res = await app.request(`/api/products/image?url=${encodeURIComponent('https://images.example.com/a.png')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
  });

  it('rejects non-images, private targets and oversize files', async () => {
    const net = fakeFetch({
      'https://images.example.com/page': () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
      'https://images.example.com/huge.jpg': () =>
        new Response(new Uint8Array(9 * 1024 * 1024).fill(0xff), { headers: { 'content-type': 'image/jpeg' } }),
    });
    const { app } = makeApp({ fetch: net.fetch, resolveHost: publicResolver });
    const html = await app.request(`/api/products/image?url=${encodeURIComponent('https://images.example.com/page')}`);
    expect(html.status).toBe(400);
    const local = await app.request(`/api/products/image?url=${encodeURIComponent('http://10.0.0.1/a.png')}`);
    expect(local.status).toBe(400);
    const huge = await app.request(`/api/products/image?url=${encodeURIComponent('https://images.example.com/huge.jpg')}`);
    expect(huge.status).toBe(413);
    const missing = await app.request('/api/products/image');
    expect(missing.status).toBe(400);
  });
});

describe('POST /api/products/search', () => {
  const searchReq = { query: 'low voltage path lights', category: 'lighting', stores: ['home-depot', 'lowes'], maxPriceUsd: 60, location: null, context: null };
  const hdUrl = 'https://www.homedepot.com/p/Hampton-Bay-Path-Light/123';
  const lowesUrl = 'https://www.lowes.com/pd/Portfolio-Path-Light/456';

  function searchReply(p: ParseParams, n: number): StudioClaudeMessage {
    if (n === 1) {
      return {
        stop_reason: 'pause_turn',
        model: p.model,
        content: [
          { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'path lights' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srv_1',
            content: [{ type: 'web_search_result', url: hdUrl, title: 'Hampton Bay Path Light', page_age: null, encrypted_content: 'enc' }],
          },
        ],
      };
    }
    if (n === 2) {
      return {
        stop_reason: 'end_turn',
        model: p.model,
        content: [
          {
            type: 'text',
            text: 'Found two good options.',
            citations: [{ type: 'web_search_result_location', url: lowesUrl, title: 'Portfolio Path Light', cited_text: '$39.98', encrypted_index: 'x' }],
          },
        ],
      };
    }
    const product = (url: string, name: string, price: number | null) => ({
      name,
      brand: null,
      store: 'Store',
      storeKind: 'other',
      url,
      imageUrl: null,
      priceUsd: price,
      priceText: price ? `$${price}` : null,
      category: 'lighting',
      description: 'Path light.',
      realHeightFt: 1.5,
      specs: ['3000K'],
      plant: null,
      light: { kelvin: 3000, lumens: 100, indoor: false, outdoor: true },
    });
    return structuredMessage(p, {
      products: [
        product('https://homedepot.com/p/Hampton-Bay-Path-Light/123/?utm_source=x', 'Hampton Bay Path Light', 24.98),
        product(lowesUrl, 'Portfolio Path Light', 39.98),
        product('https://www.homedepot.com/p/Invented-Light/999', 'Invented light', 10),
        product(hdUrl, 'Duplicate', 20),
      ],
      notes: ['Stock varies by region.'],
    });
  }

  const searchClaude = () => fakeClaude(searchReply);

  it('searches the chosen stores, resumes pause_turn, and keeps only URLs from the results', async () => {
    const fake = searchClaude();
    const page = `<html><head><meta property="og:image" content="https://images.homedepot.com/light.jpg"></head></html>`;
    const net = fakeFetch({
      [hdUrl]: () => new Response(page, { headers: { 'content-type': 'text/html' } }),
      [lowesUrl]: () => new Response('blocked', { status: 403 }),
    });
    const { app } = makeApp({ anthropic: fake.client, fetch: net.fetch, resolveHost: publicResolver });
    const res = await post(app, '/api/products/search', searchReq);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: { url: string; storeKind: string; store: string; imageUrl: string | null }[]; notes: string[] };

    const tool = (fake.calls[0].tools as { type: string; allowed_domains?: string[]; max_uses?: number }[])[0];
    expect(tool.type).toBe('web_search_20260209');
    expect(tool.allowed_domains).toEqual(['homedepot.com', 'lowes.com']);
    expect(tool.max_uses).toBe(6);
    expect(fake.calls[0].output_config?.format).toBeUndefined();
    // continuation re-sends the paused assistant turn without an extra user message
    expect(fake.calls[1].messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect((fake.calls[1].messages[1].content as { type: string }[]).map((b) => b.type)).toEqual(['server_tool_use', 'web_search_tool_result']);
    // extraction is a structured call without tools
    expect(fake.calls[2].output_config?.format).toBeDefined();
    expect(fake.calls[2].tools).toBeUndefined();

    expect(body.products.map((p) => p.url)).toEqual([hdUrl, lowesUrl]);
    expect(body.products[0]).toMatchObject({ storeKind: 'home-depot', store: 'The Home Depot', imageUrl: 'https://images.homedepot.com/light.jpg' });
    expect(body.products[1]).toMatchObject({ storeKind: 'lowes', imageUrl: null });
    expect(body.notes.some((n) => /prices/i.test(n))).toBe(true);
  });

  it('falls back to the basic web search tool when the newer one is rejected', async () => {
    const rejected = new Anthropic.BadRequestError(
      400,
      { error: { message: 'tools.0: web_search_20260209 is not supported for this model' } },
      'bad request',
      new Headers(),
    );
    const fake = fakeClaude((p, n) => (n === 1 ? rejected : searchReply(p, n - 1)));
    const { app } = makeApp({ anthropic: fake.client, fetch: fakeFetch({}).fetch, resolveHost: publicResolver });
    const res = await post(app, '/api/products/search', searchReq);
    expect(res.status).toBe(200);
    const toolType = (i: number) => (fake.calls[i].tools as { type: string }[])[0].type;
    expect(toolType(0)).toBe('web_search_20260209');
    expect(toolType(1)).toBe('web_search_20250305');
    expect(((await res.json()) as { products: unknown[] }).products).toHaveLength(2);
  });

  it('requires AI', async () => {
    const { app } = makeApp();
    const res = await post(app, '/api/products/search', searchReq);
    expect(res.status).toBe(503);
  });
});
