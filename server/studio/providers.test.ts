import { describe, expect, it } from 'vitest';
import {
  createGeminiProvider,
  createOpenAIProvider,
  createProvidersFromEnv,
  openAIModelAcceptsInputFidelity,
  parseGeminiImageResponse,
  parseOpenAIImageResponse,
} from './providers';
import { StudioError } from './errors';
import { PNG_1PX_B64 } from './testing';
import type { ImageEditRequest } from './providers';

const JPEG_B64 = '/9j/4AAQSkZJRgABAQ==';

const baseReq: ImageEditRequest = {
  image: { mime: 'image/jpeg', base64: JPEG_B64 },
  mask: { mime: 'image/png', base64: PNG_1PX_B64 },
  references: [{ mime: 'image/png', base64: PNG_1PX_B64 }],
  prompt: 'Edit this photo: new walk.',
  quality: 'draft',
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: FormData | string;
}

function capture(responses: (() => Response)[]): { fetch: typeof fetch; seen: Captured[] } {
  const seen: Captured[] = [];
  let i = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as FormData | string });
    return responses[Math.min(i++, responses.length - 1)]();
  }) as typeof fetch;
  return { fetch: impl, seen };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function expectStudioError(p: Promise<unknown>, code: string): Promise<StudioError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(StudioError);
    expect((err as StudioError).code).toBe(code);
    return err as StudioError;
  }
  throw new Error('expected an error');
}

describe('OpenAI provider', () => {
  it('posts a multipart edit with photo + references, mask and mapped quality', async () => {
    const net = capture([json({ data: [{ b64_json: PNG_1PX_B64 }] })]);
    const provider = createOpenAIProvider({ apiKey: 'sk-test', model: 'gpt-image-1', baseUrl: 'https://api.openai.com/v1', fetch: net.fetch });
    const out = await provider.edit(baseReq);
    expect(out).toEqual({ mime: 'image/png', base64: PNG_1PX_B64 });

    const { url, headers, body } = net.seen[0];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(headers.Authorization).toBe('Bearer sk-test');
    const form = body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.getAll('image[]')).toHaveLength(2);
    expect((form.getAll('image[]')[0] as File).type).toBe('image/jpeg');
    expect((form.get('mask') as File).type).toBe('image/png');
    expect(form.get('quality')).toBe('low');
    expect(form.get('size')).toBe('auto');
    expect(form.get('n')).toBe('1');
    expect(form.get('input_fidelity')).toBe('high');
    expect(form.get('prompt')).toBe(baseReq.prompt);
  });

  it('uses a single image field and no input_fidelity for mini models', async () => {
    const net = capture([json({ data: [{ b64_json: PNG_1PX_B64 }] })]);
    const provider = createOpenAIProvider({ apiKey: 'k', model: 'gpt-image-1-mini', baseUrl: 'https://x/v1', fetch: net.fetch });
    await provider.edit({ ...baseReq, references: [], quality: 'high' });
    const form = net.seen[0].body as FormData;
    expect(form.getAll('image')).toHaveLength(1);
    expect(form.get('input_fidelity')).toBeNull();
    expect(form.get('quality')).toBe('high');
  });

  it('retries without input_fidelity when the API rejects it, then stops sending it', async () => {
    const net = capture([
      json({ error: { message: "Unknown parameter: 'input_fidelity'.", param: 'input_fidelity', code: 'unknown_parameter' } }, 400),
      json({ data: [{ b64_json: PNG_1PX_B64 }] }),
      json({ data: [{ b64_json: PNG_1PX_B64 }] }),
    ]);
    const provider = createOpenAIProvider({ apiKey: 'k', model: 'gpt-image-1', baseUrl: 'https://x/v1', fetch: net.fetch });
    await provider.edit(baseReq);
    await provider.edit(baseReq);
    expect(net.seen).toHaveLength(3);
    expect((net.seen[0].body as FormData).get('input_fidelity')).toBe('high');
    expect((net.seen[1].body as FormData).get('input_fidelity')).toBeNull();
    expect((net.seen[2].body as FormData).get('input_fidelity')).toBeNull();
  });

  it('maps errors: rate limits, safety, keys', async () => {
    const limited = createOpenAIProvider({ apiKey: 'k', model: 'gpt-image-1', baseUrl: 'https://x/v1', fetch: capture([json({ error: { message: 'Rate limit reached' } }, 429)]).fetch });
    await expectStudioError(limited.edit(baseReq), 'rate_limited');

    const unsafe = createOpenAIProvider({
      apiKey: 'k',
      model: 'gpt-image-1',
      baseUrl: 'https://x/v1',
      fetch: capture([json({ error: { message: 'Your request was rejected by the safety system.', code: 'moderation_blocked' } }, 400)]).fetch,
    });
    await expectStudioError(unsafe.edit(baseReq), 'refused');

    const badKey = createOpenAIProvider({ apiKey: 'k', model: 'gpt-image-1', baseUrl: 'https://x/v1', fetch: capture([json({ error: { message: 'Incorrect API key' } }, 401)]).fetch });
    const err = await expectStudioError(badKey.edit(baseReq), 'upstream_error');
    expect(err.message).toContain('OPENAI_API_KEY');
  });

  it('parses responses and rejects empty ones', () => {
    expect(parseOpenAIImageResponse({ data: [{ b64_json: JPEG_B64 }], output_format: 'jpeg' }).mime).toBe('image/jpeg');
    expect(() => parseOpenAIImageResponse({ data: [] })).toThrow(StudioError);
  });

  it('knows which models accept input_fidelity', () => {
    expect(openAIModelAcceptsInputFidelity('gpt-image-1')).toBe(true);
    expect(openAIModelAcceptsInputFidelity('gpt-image-1.5')).toBe(true);
    expect(openAIModelAcceptsInputFidelity('gpt-image-1-mini')).toBe(false);
    expect(openAIModelAcceptsInputFidelity('dall-e-2')).toBe(false);
  });
});

describe('Gemini provider', () => {
  it('posts generateContent with the text first, then the photo and references', async () => {
    const net = capture([json({ candidates: [{ content: { parts: [{ text: 'Here you go' }, { inlineData: { mimeType: 'image/png', data: PNG_1PX_B64 } }] } }] })]);
    const provider = createGeminiProvider({ apiKey: 'AIza-test', model: 'gemini-2.5-flash-image', fetch: net.fetch });
    expect(provider.supportsMask).toBe(false);
    const out = await provider.edit(baseReq);
    expect(out).toEqual({ mime: 'image/png', base64: PNG_1PX_B64 });

    const { url, headers, body } = net.seen[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent');
    expect(headers['x-goog-api-key']).toBe('AIza-test');
    const parsed = JSON.parse(body as string) as {
      contents: { role: string; parts: { text?: string; inline_data?: { mime_type: string; data: string } }[] }[];
      generationConfig: { responseModalities: string[] };
    };
    expect(parsed.generationConfig.responseModalities).toEqual(['IMAGE']);
    const parts = parsed.contents[0].parts;
    expect(parsed.contents[0].role).toBe('user');
    expect(parts[0].text).toBe(baseReq.prompt);
    expect(parts[1].inline_data).toEqual({ mime_type: 'image/jpeg', data: JPEG_B64 });
    expect(parts[2].inline_data?.mime_type).toBe('image/png');
    expect(parts).toHaveLength(3);
  });

  it('parses snake_case parts and maps safety blocks to refused', async () => {
    expect(parseGeminiImageResponse({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/jpeg', data: JPEG_B64 } }] } }] }).mime).toBe('image/jpeg');
    expect(() => parseGeminiImageResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/safety/i);
    try {
      parseGeminiImageResponse({ candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }] });
    } catch (err) {
      expect((err as StudioError).code).toBe('refused');
    }
    try {
      parseGeminiImageResponse({ candidates: [{ content: { parts: [{ text: 'I cannot edit this.' }] }, finishReason: 'STOP' }] });
    } catch (err) {
      expect((err as StudioError).code).toBe('upstream_error');
      expect((err as StudioError).message).toContain('I cannot edit this.');
    }
  });

  it('maps HTTP errors', async () => {
    const limited = createGeminiProvider({ apiKey: 'k', model: 'm', fetch: capture([json({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }, 429)]).fetch });
    await expectStudioError(limited.edit(baseReq), 'rate_limited');
    const denied = createGeminiProvider({ apiKey: 'k', model: 'm', fetch: capture([json({ error: { code: 403, message: 'API key not valid', status: 'PERMISSION_DENIED' } }, 403)]).fetch });
    const err = await expectStudioError(denied.edit(baseReq), 'upstream_error');
    expect(err.message).toContain('GEMINI_API_KEY');
  });

  it('reports cancellation and network failures', async () => {
    const offline = createGeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expectStudioError(offline.edit(baseReq), 'upstream_error');
    const controller = new AbortController();
    controller.abort();
    const err = await expectStudioError(offline.edit({ ...baseReq, signal: controller.signal }), 'bad_request');
    expect(err.status).toBe(499);
  });
});

describe('createProvidersFromEnv', () => {
  it('configures providers from keys and picks the default', () => {
    const both = createProvidersFromEnv({ OPENAI_API_KEY: 'sk', GOOGLE_API_KEY: 'g', IMAGE_PROVIDER: 'gemini' });
    expect(both.providers.openai?.model).toBe('gpt-image-2.5-flare');
    expect(both.providers.gemini?.model).toBe('gemini-2.5-flash-image');
    expect(both.defaultProvider).toBe('gemini');

    const geminiOnly = createProvidersFromEnv({ GEMINI_API_KEY: 'g', GEMINI_IMAGE_MODEL: 'gemini-3-pro-image' });
    expect(geminiOnly.defaultProvider).toBe('gemini');
    expect(geminiOnly.providers.gemini?.model).toBe('gemini-3-pro-image');

    const missing = createProvidersFromEnv({ IMAGE_PROVIDER: 'openai' });
    expect(missing.defaultProvider).toBeNull();
    expect(missing.warnings[0]).toContain('OPENAI_API_KEY');

    const off = createProvidersFromEnv({ OPENAI_API_KEY: 'sk', IMAGE_PROVIDER: 'none' });
    expect(off.defaultProvider).toBeNull();
  });
});

describe('openAIQualityFor', () => {
  it('uses the GPT Image 2.5 scale for 2.5+ models and the 1.x scale otherwise', async () => {
    const { openAIQualityFor } = await import('./providers');
    expect(openAIQualityFor('gpt-image-2.5-flare', 'draft')).toBe('medium');
    expect(openAIQualityFor('gpt-image-2.5-sunburst', 'standard')).toBe('high');
    expect(openAIQualityFor('gpt-image-2.5-sunburst', 'high')).toBe('xhigh');
    expect(openAIQualityFor('gpt-image-1', 'high')).toBe('high');
    expect(openAIQualityFor('gpt-image-1-mini', 'draft')).toBe('low');
  });
});
