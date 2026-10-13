import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesignSuggestion } from '../../shared/api';
import {
  API_TOKEN_STORAGE_KEY,
  ApiError,
  analyzePhoto,
  generateAssetListAI,
  getHealth,
  isAbortError,
  renderAI,
  suggestDesign,
} from './api';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ANALYSIS = {
  spaceType: 'kitchen',
  summary: 'A kitchen.',
  style: 'Builder grade',
  surfaces: [],
  lighting: { natural: 'Window left', artificial: 'Recessed', issues: [] },
  landscaping: null,
  opportunities: ['Paint the cabinets'],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getHealth', () => {
  it('returns the server health', async () => {
    stubFetch(() =>
      json(200, { ok: true, ai: { enabled: true, model: 'claude-opus-5-5' }, imageProvider: { enabled: false, name: null, model: null } }),
    );
    const h = await getHealth();
    expect(h.ai).toEqual({ enabled: true, model: 'claude-opus-5-5' });
  });

  it('never throws: unreachable, error or garbage responses give a disabled health', async () => {
    const off = { ok: false, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null } };
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await getHealth()).toEqual(off);
    stubFetch(() => new Response('<html>502</html>', { status: 502 }));
    expect(await getHealth()).toEqual(off);
    stubFetch(() => json(200, { hello: 'world' }));
    expect(await getHealth()).toEqual(off);
  });
});

describe('POST helpers', () => {
  it('posts JSON, sends the access token and validates the response', async () => {
    const store = new Map([[API_TOKEN_STORAGE_KEY, ' tok-123 ']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null });
    const calls = stubFetch(() => json(200, ANALYSIS));
    const result = await analyzePhoto({ image: IMAGE, spaceType: 'kitchen', notes: null });
    expect(result.summary).toBe('A kitchen.');
    expect(calls[0].url).toBe('/api/analyze');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-mode-token']).toBe('tok-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ image: IMAGE, spaceType: 'kitchen', notes: null });
  });

  it('works when localStorage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    const calls = stubFetch(() => json(200, ANALYSIS));
    await analyzePhoto({ image: IMAGE, spaceType: null, notes: null });
    expect((calls[0].init.headers as Record<string, string>)['x-mode-token']).toBeUndefined();
  });

  it('throws ApiError with the server error code and status', async () => {
    stubFetch(() => json(503, { error: { code: 'ai_disabled', message: 'AI is off' } }));
    const err = await analyzePhoto({ image: IMAGE, spaceType: null, notes: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'ai_disabled', status: 503, message: 'AI is off', aborted: false });
  });

  it('maps non-JSON error responses by status', async () => {
    stubFetch(() => new Response('Payload Too Large', { status: 413 }));
    await expect(analyzePhoto({ image: IMAGE, spaceType: null, notes: null })).rejects.toMatchObject({
      code: 'payload_too_large',
    });
    stubFetch(() => new Response('', { status: 500 }));
    await expect(analyzePhoto({ image: IMAGE, spaceType: null, notes: null })).rejects.toMatchObject({
      code: 'network',
      status: 500,
    });
  });

  it('rejects responses that do not match the schema', async () => {
    stubFetch(() => json(200, { title: 'only a title' }));
    const req = {
      image: IMAGE,
      spaceType: 'backyard' as const,
      style: 'Modern',
      brief: null,
      budgetUsd: null,
      location: null,
      regions: [],
    };
    await expect(suggestDesign(req)).rejects.toMatchObject({ code: 'internal' });
  });

  it('validates the request before sending it', async () => {
    const calls = stubFetch(() => json(200, ANALYSIS));
    await expect(analyzePhoto({ image: 'not a data url', spaceType: null, notes: null })).rejects.toMatchObject({
      code: 'bad_request',
      status: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it('reports network failures', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      generateAssetListAI({
        projectName: 'P',
        location: null,
        budgetUsd: null,
        style: null,
        brief: null,
        designSummary: '',
        existingItems: [],
      }),
    ).rejects.toMatchObject({ code: 'network', status: 0, aborted: false });
  });

  it('cancels through the AbortSignal', async () => {
    stubFetch(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const controller = new AbortController();
    const pending = renderAI(
      { image: IMAGE, mask: null, designSummary: 'x', instructions: null, strength: 'subtle' },
      controller.signal,
    ).catch((e: unknown) => e);
    controller.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'network', aborted: true, name: 'AbortError' });
    expect(isAbortError(err)).toBe(true);

    const already = new AbortController();
    already.abort();
    await expect(analyzePhoto({ image: IMAGE, spaceType: null, notes: null }, already.signal)).rejects.toMatchObject({
      aborted: true,
    });
  });

  it('times out long calls', async () => {
    vi.useFakeTimers();
    stubFetch(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = analyzePhoto({ image: IMAGE, spaceType: null, notes: null }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(180_000);
    const err = await pending;
    expect(err).toMatchObject({ code: 'network', aborted: false });
    expect((err as Error).message).toMatch(/too long/);
  });

  it('accepts a full design suggestion', async () => {
    const suggestion: DesignSuggestion = {
      title: 'T',
      concept: 'C',
      palette: [],
      regionTreatments: [],
      lighting: { timeOfDay: 'day', kelvin: 5500, fixtures: [] },
      plants: [],
      decor: [],
      assetList: [],
      tips: [],
      estimatedBudget: { lowUsd: 0, highUsd: 0 },
    };
    stubFetch(() => json(200, suggestion));
    const out = await suggestDesign({
      image: IMAGE,
      spaceType: 'backyard',
      style: 'Modern',
      brief: null,
      budgetUsd: null,
      location: null,
      regions: [],
    });
    expect(out).toEqual(suggestion);
  });
});
