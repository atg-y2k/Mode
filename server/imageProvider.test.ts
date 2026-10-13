import { describe, expect, it } from 'vitest';
import { ApiHttpError } from './errors';
import { createImageProvider, createOpenAIImageProvider } from './imageProvider';
import { testConfig } from './config';
import { tinyPngBase64 } from './testing';

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: unknown, captured: Captured[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const OK = { data: [{ b64_json: tinyPngBase64() }] };
const IMAGE = { mime: 'image/jpeg' as const, base64: '/9j/4AAQSkZJRgABAQ==' };
const MASK = { mime: 'image/png' as const, base64: tinyPngBase64() };

describe('OpenAI image provider', () => {
  it('posts a multipart edit with model, image, mask, prompt and quality settings', async () => {
    const captured: Captured[] = [];
    const provider = createOpenAIImageProvider({
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      baseUrl: 'https://api.example.test/v1',
      fetch: fakeFetch(200, OK, captured),
    });
    const result = await provider.editImage({ image: IMAGE, mask: MASK, prompt: 'Make it photoreal' });
    expect(result.mime).toBe('image/png');
    expect(result.base64).toBe(OK.data[0].b64_json);

    const { url, init } = captured[0];
    expect(url).toBe('https://api.example.test/v1/images/edits');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.get('prompt')).toBe('Make it photoreal');
    expect(form.get('size')).toBe('auto');
    expect(form.get('quality')).toBe('high');
    expect(form.get('input_fidelity')).toBe('high');
    const image = form.get('image') as File;
    expect(image.type).toBe('image/jpeg');
    expect(image.name).toBe('image.jpg');
    expect((form.get('mask') as File).type).toBe('image/png');
  });

  it('requests a transparent PNG for generated assets', async () => {
    const captured: Captured[] = [];
    const provider = createOpenAIImageProvider({
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      baseUrl: 'https://api.example.test/v1',
      fetch: fakeFetch(200, OK, captured),
    });
    await provider.generateImage({ prompt: 'A planter', transparent: true, orientation: 'portrait' });
    expect(captured[0].url).toBe('https://api.example.test/v1/images/generations');
    const body = JSON.parse(String(captured[0].init.body));
    expect(body).toMatchObject({ model: 'gpt-image-1', background: 'transparent', output_format: 'png', size: '1024x1536' });
  });

  const errorCases: [number, unknown, string][] = [
    [400, { error: { message: 'Your request was rejected by the safety system.', code: 'moderation_blocked' } }, 'refused'],
    [429, { error: { message: 'Rate limit reached', type: 'requests' } }, 'rate_limited'],
    [401, { error: { message: 'Incorrect API key provided: sk-abc***' } }, 'upstream_error'],
    [500, 'oops', 'upstream_error'],
  ];
  for (const [status, body, code] of errorCases) {
    it(`maps HTTP ${status} to ${code}`, async () => {
      const provider = createOpenAIImageProvider({
        apiKey: 'sk-test',
        model: 'gpt-image-1',
        baseUrl: 'https://x.test',
        fetch: fakeFetch(status, body),
      });
      const err = await provider.editImage({ image: IMAGE, mask: null, prompt: 'p' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiHttpError);
      expect((err as ApiHttpError).code).toBe(code);
      expect((err as ApiHttpError).message).not.toContain('sk-');
    });
  }

  it('maps network failures and missing images to upstream_error', async () => {
    const offline = createOpenAIImageProvider({
      apiKey: 'k',
      model: 'gpt-image-1',
      baseUrl: 'https://x.test',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(offline.generateImage({ prompt: 'p', transparent: true, orientation: 'square' })).rejects.toMatchObject({
      code: 'upstream_error',
      status: 502,
    });
    const empty = createOpenAIImageProvider({ apiKey: 'k', model: 'gpt-image-1', baseUrl: 'https://x.test', fetch: fakeFetch(200, { data: [] }) });
    await expect(empty.generateImage({ prompt: 'p', transparent: true, orientation: 'square' })).rejects.toMatchObject({
      code: 'upstream_error',
    });
  });

  it('reports a timeout as upstream_error 504', async () => {
    const slow = createOpenAIImageProvider({
      apiKey: 'k',
      model: 'gpt-image-1',
      baseUrl: 'https://x.test',
      timeoutMs: 20,
      fetch: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })) as typeof fetch,
    });
    await expect(slow.generateImage({ prompt: 'p', transparent: false, orientation: 'square' })).rejects.toMatchObject({
      code: 'upstream_error',
      status: 504,
    });
  });
});

describe('createImageProvider', () => {
  it('is null unless IMAGE_PROVIDER=openai with a key', () => {
    expect(createImageProvider(testConfig())).toBeNull();
    const provider = createImageProvider(testConfig({ imageProvider: 'openai', openaiApiKey: 'k' }));
    expect(provider?.name).toBe('openai');
    expect(provider?.model).toBe('gpt-image-2.5-flare');
  });
});
