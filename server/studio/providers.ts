/**
 * Image providers for Studio variations: OpenAI Images (edits endpoint, mask +
 * reference images) and Google Gemini image generation (generateContent with
 * inline image parts). Both return the provider's image as is; the client
 * resizes it to the photo and composites it inside the target mask.
 */
import type { ImageProviderId } from '../../shared/api';
import { StudioError, cancelled, redact } from './errors';
import { base64ToBytes, extensionFor, sniffImageMime, type ImageData64, type ImageMime } from './util';

export type ImageQuality = 'draft' | 'standard' | 'high';

export interface ImageEditRequest {
  /** The photo to edit. */
  image: ImageData64;
  /** PNG, same size as `image`: opaque = keep, transparent = may change. Null = whole image. */
  mask: ImageData64 | null;
  /** Inspiration images (materials, plants, colors), at most 3. */
  references: ImageData64[];
  /** Complete instruction text (see prompts.imageEditPrompt). */
  prompt: string;
  quality: ImageQuality;
  signal?: AbortSignal;
}

export interface ImageResult {
  mime: ImageMime;
  base64: string;
}

export interface ImageProvider {
  readonly id: ImageProviderId;
  /** Display name, e.g. "OpenAI". */
  readonly name: string;
  readonly model: string;
  /** Whether the provider honours `mask` itself (otherwise the prompt must describe the region). */
  readonly supportsMask: boolean;
  edit(req: ImageEditRequest): Promise<ImageResult>;
}

export const PROVIDER_NAMES: Record<ImageProviderId, string> = { openai: 'OpenAI', gemini: 'Google Gemini' };

const DEFAULT_TIMEOUT_MS = 240_000;

interface HttpResult {
  status: number;
  json: unknown;
}

/** POST with a per-request timeout combined with the caller's signal; maps network failures. */
async function post(
  doFetch: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; body: FormData | string },
  timeoutMs: number,
  signal: AbortSignal | undefined,
  providerName: string,
): Promise<HttpResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  let text: string;
  try {
    res = await doFetch(url, { method: 'POST', headers: init.headers, body: init.body, signal: combined });
    text = await res.text();
  } catch {
    const tooSlow = new StudioError('upstream_error', `${providerName} took too long to create the image. Please try again.`, 504);
    if (signal?.aborted) {
      const reason: unknown = signal.reason;
      const isTimeout = typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'TimeoutError';
      throw isTimeout ? tooSlow : cancelled();
    }
    if (timeout.aborted) throw tooSlow;
    throw new StudioError('upstream_error', `The server couldn't reach ${providerName}. Please try again.`, 502);
  }
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function toImageResult(b64: string, declaredMime: string | null | undefined): ImageResult {
  const sniffed = sniffImageMime(base64ToBytes(b64.slice(0, 64)));
  const mime: ImageMime =
    sniffed === 'image/png' || sniffed === 'image/jpeg' || sniffed === 'image/webp'
      ? sniffed
      : declaredMime === 'image/jpeg' || declaredMime === 'image/webp'
        ? declaredMime
        : 'image/png';
  return { mime, base64: b64 };
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  /** e.g. https://api.openai.com/v1 (no trailing slash). */
  baseUrl: string;
  /**
   * `input_fidelity=high` keeps faces/architecture closer to the input. 'auto'
   * sends it for models known to accept it and retries without it when the API
   * rejects the parameter; 'high' always sends it; 'off' never does.
   */
  inputFidelity?: 'auto' | 'high' | 'off';
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface OpenAIImagesResponse {
  data?: { b64_json?: string | null; url?: string | null }[];
  output_format?: string;
  error?: { message?: string; code?: string | null; type?: string | null; param?: string | null };
}

const OPENAI_QUALITY: Record<ImageQuality, string> = { draft: 'low', standard: 'medium', high: 'high' };

function isGptImageModel(model: string): boolean {
  return model.startsWith('gpt-image') || model.startsWith('chatgpt-image');
}

/** Models documented to accept `input_fidelity` (gpt-image-1 and its full-size successors, not the mini variants). */
export function openAIModelAcceptsInputFidelity(model: string): boolean {
  return /^gpt-image-1(?:\.\d+)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
}

export function mapOpenAIError(status: number, body: OpenAIImagesResponse | null): StudioError {
  const message = body?.error?.message ?? '';
  const code = `${body?.error?.code ?? ''} ${body?.error?.type ?? ''}`.toLowerCase();
  if (/moderation|content_policy|safety/.test(code) || /safety system|moderation|content policy/i.test(message)) {
    return new StudioError(
      'refused',
      "OpenAI's safety system declined this image. Try different instructions or a different photo.",
      422,
    );
  }
  if (status === 401 || status === 403) {
    return new StudioError('upstream_error', "OpenAI rejected the server's API key. Check OPENAI_API_KEY in .env and restart the server.", 502);
  }
  if (status === 429) {
    const quota = /quota|billing/.test(code) || /quota|billing/i.test(message);
    return new StudioError(
      'rate_limited',
      quota
        ? "The OpenAI account is out of credits or over its quota. Check the account's billing."
        : 'OpenAI is rate limiting image requests right now. Wait a minute and try again.',
      429,
      { retryAfterSec: 60 },
    );
  }
  if (status === 404) {
    return new StudioError('upstream_error', 'The OpenAI image model is not available. Check OPENAI_IMAGE_MODEL and OPENAI_BASE_URL.', 502);
  }
  if (status >= 400 && status < 500) {
    const detail = message ? `: ${redact(message, 220)}` : '.';
    return new StudioError('upstream_error', `OpenAI couldn't process this image request${detail}`, 502);
  }
  return new StudioError('upstream_error', `OpenAI had a problem creating the image (HTTP ${status}). Please try again.`, 502);
}

/** Pulls the image out of an Images API response. */
export function parseOpenAIImageResponse(json: unknown): ImageResult {
  const body = (json ?? {}) as OpenAIImagesResponse;
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new StudioError('upstream_error', 'OpenAI returned no image. Please try again.', 502);
  const declared = body.output_format ? `image/${body.output_format === 'jpg' ? 'jpeg' : body.output_format}` : null;
  return toImageResult(b64, declared);
}

function rejectsInputFidelity(status: number, json: unknown): boolean {
  if (status !== 400) return false;
  const err = (json as OpenAIImagesResponse | null)?.error;
  return err?.param === 'input_fidelity' || /input_fidelity/i.test(err?.message ?? '');
}

export function createOpenAIProvider(opts: OpenAIProviderOptions): ImageProvider {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = opts.model;
  const gptImage = isGptImageModel(model);
  const fidelityMode = opts.inputFidelity ?? 'auto';
  // Learned at runtime: the API rejected input_fidelity for this model.
  let fidelityRejected = false;

  const blob = (img: ImageData64) => new Blob([base64ToBytes(img.base64)], { type: img.mime });

  function buildForm(req: ImageEditRequest, withFidelity: boolean): FormData {
    const form = new FormData();
    form.append('model', model);
    if (gptImage) {
      // image[] = the photo first, then the references; the mask applies to the first image.
      const images = [req.image, ...req.references.slice(0, 3)];
      const field = images.length > 1 ? 'image[]' : 'image';
      images.forEach((img, i) => form.append(field, blob(img), `${i === 0 ? 'photo' : `reference-${i}`}.${extensionFor(img.mime)}`));
    } else {
      // Legacy (dall-e-2): one square PNG, no references.
      form.append('image', blob(req.image), `photo.${extensionFor(req.image.mime)}`);
    }
    if (req.mask) form.append('mask', blob(req.mask), 'mask.png');
    form.append('prompt', req.prompt);
    form.append('n', '1');
    if (gptImage) {
      form.append('size', 'auto');
      form.append('quality', OPENAI_QUALITY[req.quality]);
      if (withFidelity) form.append('input_fidelity', 'high');
    } else {
      form.append('size', '1024x1024');
      form.append('response_format', 'b64_json');
    }
    return form;
  }

  return {
    id: 'openai',
    name: PROVIDER_NAMES.openai,
    model,
    supportsMask: true,
    async edit(req) {
      const wantFidelity =
        gptImage && !fidelityRejected && (fidelityMode === 'high' || (fidelityMode === 'auto' && openAIModelAcceptsInputFidelity(model)));
      const url = `${opts.baseUrl}/images/edits`;
      const headers = { Authorization: `Bearer ${opts.apiKey}` };
      let res = await post(doFetch, url, { headers, body: buildForm(req, wantFidelity) }, timeoutMs, req.signal, 'OpenAI');
      if (wantFidelity && fidelityMode === 'auto' && rejectsInputFidelity(res.status, res.json)) {
        fidelityRejected = true;
        res = await post(doFetch, url, { headers, body: buildForm(req, false) }, timeoutMs, req.signal, 'OpenAI');
      }
      if (res.status < 200 || res.status >= 300) throw mapOpenAIError(res.status, res.json as OpenAIImagesResponse | null);
      return parseOpenAIImageResponse(res.json);
    },
  };
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiProviderOptions {
  apiKey: string;
  /** e.g. 'gemini-2.5-flash-image'. */
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface GeminiInlineData {
  mimeType?: string;
  mime_type?: string;
  data?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

const GEMINI_SAFETY_REASONS = new Set([
  'SAFETY',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'IMAGE_PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
  'IMAGE_RECITATION',
]);

const geminiRefused = () =>
  new StudioError('refused', "Gemini's safety filters declined this image. Try different instructions or a different photo.", 422);

export function mapGeminiError(status: number, body: GeminiResponse | null): StudioError {
  const message = body?.error?.message ?? '';
  const state = body?.error?.status ?? '';
  if (status === 429 || state === 'RESOURCE_EXHAUSTED') {
    const quota = /quota|billing/i.test(message);
    return new StudioError(
      'rate_limited',
      quota
        ? 'The Gemini API key is over its quota. Check the Google AI Studio / Cloud billing for this key.'
        : 'Gemini is rate limiting image requests right now. Wait a minute and try again.',
      429,
      { retryAfterSec: 60 },
    );
  }
  if (status === 401 || status === 403 || state === 'PERMISSION_DENIED' || state === 'UNAUTHENTICATED' || /api key/i.test(message)) {
    return new StudioError('upstream_error', "Gemini rejected the server's API key. Check GEMINI_API_KEY in .env and restart the server.", 502);
  }
  if (status === 404 || state === 'NOT_FOUND') {
    return new StudioError('upstream_error', 'The Gemini image model is not available. Check GEMINI_IMAGE_MODEL in .env.', 502);
  }
  if (/safety|blocked|prohibited/i.test(message)) return geminiRefused();
  if (status >= 400 && status < 500) {
    const detail = message ? `: ${redact(message, 220)}` : '.';
    return new StudioError('upstream_error', `Gemini couldn't process this image request${detail}`, 502);
  }
  return new StudioError('upstream_error', `Gemini had a problem creating the image (HTTP ${status}). Please try again.`, 502);
}

/** Pulls the first image out of a generateContent response (camelCase or snake_case parts). */
export function parseGeminiImageResponse(json: unknown): ImageResult {
  const body = (json ?? {}) as GeminiResponse;
  if (body.promptFeedback?.blockReason) throw geminiRefused();
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) return toImageResult(inline.data, inline.mimeType ?? inline.mime_type);
  }
  if (candidate?.finishReason && GEMINI_SAFETY_REASONS.has(candidate.finishReason)) throw geminiRefused();
  const said = parts.map((p) => p.text ?? '').join(' ').trim();
  throw new StudioError(
    'upstream_error',
    said ? `Gemini returned no image (it said: "${redact(said, 160)}"). Please try again.` : 'Gemini returned no image. Please try again.',
    502,
  );
}

export function createGeminiProvider(opts: GeminiProviderOptions): ImageProvider {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = opts.model.replace(/^models\//, '');
  const base = (opts.baseUrl ?? GEMINI_BASE_URL).replace(/\/+$/, '');

  return {
    id: 'gemini',
    name: PROVIDER_NAMES.gemini,
    model,
    supportsMask: false,
    async edit(req) {
      // No mask support: the prompt describes the editable region and the client composites the result.
      const images = [req.image, ...req.references.slice(0, 3)];
      const body = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: req.prompt },
              ...images.map((img) => ({ inline_data: { mime_type: img.mime, data: img.base64 } })),
            ],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE'] },
      };
      const res = await post(
        doFetch,
        `${base}/models/${encodeURIComponent(model)}:generateContent`,
        { headers: { 'x-goog-api-key': opts.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        timeoutMs,
        req.signal,
        'Gemini',
      );
      if (res.status < 200 || res.status >= 300) throw mapGeminiError(res.status, res.json as GeminiResponse | null);
      return parseGeminiImageResponse(res.json);
    },
  };
}

// ---------------------------------------------------------------------------
// From the environment
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

function envStr(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

export interface ProvidersFromEnv {
  providers: Record<ImageProviderId, ImageProvider | undefined>;
  defaultProvider: ImageProviderId | null;
  warnings: string[];
}

/**
 * OPENAI_API_KEY (+ OPENAI_IMAGE_MODEL, OPENAI_BASE_URL, OPENAI_INPUT_FIDELITY),
 * GEMINI_API_KEY or GOOGLE_API_KEY (+ GEMINI_IMAGE_MODEL), IMAGE_PROVIDER picks
 * the default among the configured ones (else OpenAI, then Gemini).
 */
export function createProvidersFromEnv(env: Env = process.env, fetchImpl?: typeof fetch): ProvidersFromEnv {
  const warnings: string[] = [];
  const providers: Record<ImageProviderId, ImageProvider | undefined> = { openai: undefined, gemini: undefined };

  const openaiKey = envStr(env, 'OPENAI_API_KEY');
  if (openaiKey) {
    const fidelityRaw = envStr(env, 'OPENAI_INPUT_FIDELITY')?.toLowerCase() ?? 'auto';
    const inputFidelity = fidelityRaw === 'high' || fidelityRaw === 'on' ? 'high' : fidelityRaw === 'off' || fidelityRaw === 'low' ? 'off' : 'auto';
    providers.openai = createOpenAIProvider({
      apiKey: openaiKey,
      model: envStr(env, 'OPENAI_IMAGE_MODEL') ?? DEFAULT_OPENAI_IMAGE_MODEL,
      baseUrl: (envStr(env, 'OPENAI_BASE_URL') ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, ''),
      inputFidelity,
      fetch: fetchImpl,
    });
  }
  const geminiKey = envStr(env, 'GEMINI_API_KEY') ?? envStr(env, 'GOOGLE_API_KEY');
  if (geminiKey) {
    providers.gemini = createGeminiProvider({
      apiKey: geminiKey,
      model: envStr(env, 'GEMINI_IMAGE_MODEL') ?? DEFAULT_GEMINI_IMAGE_MODEL,
      fetch: fetchImpl,
    });
  }

  const wanted = envStr(env, 'IMAGE_PROVIDER')?.toLowerCase() ?? null;
  let defaultProvider: ImageProviderId | null = null;
  if (wanted === 'openai' || wanted === 'gemini') {
    if (providers[wanted]) defaultProvider = wanted;
    else warnings.push(`IMAGE_PROVIDER=${wanted} but its API key is not set (${wanted === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'}).`);
  } else if (wanted && wanted !== 'none' && wanted !== 'off') {
    warnings.push(`IMAGE_PROVIDER="${wanted}" is not supported (use openai or gemini).`);
  }
  if (wanted !== 'none' && wanted !== 'off') {
    defaultProvider ??= providers.openai ? 'openai' : providers.gemini ? 'gemini' : null;
  }
  return { providers, defaultProvider, warnings };
}
