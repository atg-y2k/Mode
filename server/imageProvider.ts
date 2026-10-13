/**
 * Image providers: photoreal edits of a design preview and cut-out asset
 * images. Only OpenAI's Images API is implemented; add another provider by
 * implementing `ImageProvider` and wiring it in `createImageProvider`.
 */
import type { ServerConfig } from './config';
import { extensionFor, sniffImageMime, toDataUrl, type ImageData64, type ImageMime } from './dataUrl';
import { ApiHttpError, cancelled, isTimeoutAbort, redact } from './errors';

export interface ImageResult {
  mime: ImageMime;
  base64: string;
}

export interface EditImageRequest {
  image: ImageData64;
  /** PNG; opaque = keep, transparent = may change. */
  mask: ImageData64 | null;
  prompt: string;
  signal?: AbortSignal;
}

export type ImageOrientation = 'portrait' | 'square' | 'landscape';

export interface GenerateImageRequest {
  prompt: string;
  /** Ask for a transparent background (PNG). */
  transparent: boolean;
  orientation: ImageOrientation;
  signal?: AbortSignal;
}

export interface ImageProvider {
  /** Short id, e.g. "openai". */
  readonly name: string;
  readonly model: string;
  editImage(req: EditImageRequest): Promise<ImageResult>;
  generateImage(req: GenerateImageRequest): Promise<ImageResult>;
}

export function imageResultToDataUrl(result: ImageResult): string {
  return toDataUrl(result.mime, result.base64);
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

export interface OpenAIImageProviderOptions {
  apiKey: string;
  model: string;
  /** e.g. https://api.openai.com/v1 (no trailing slash). */
  baseUrl: string;
  /** Per-request timeout (default 240 s). */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface OpenAIImagesResponse {
  data?: { b64_json?: string | null; url?: string | null }[];
  error?: { message?: string; code?: string | null; type?: string | null };
}

const SIZES: Record<ImageOrientation, string> = {
  portrait: '1024x1536',
  square: '1024x1024',
  landscape: '1536x1024',
};

function isGptImage(model: string): boolean {
  return model.startsWith('gpt-image');
}

/** `input_fidelity` is supported by gpt-image-1 (not by the mini variant). */
function supportsInputFidelity(model: string): boolean {
  return model === 'gpt-image-1' || (model.startsWith('gpt-image-1.') && !model.includes('mini'));
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(b64, 'base64');
  const out = new Uint8Array(decoded.length);
  out.set(decoded);
  return out;
}

function mapOpenAIError(status: number, body: OpenAIImagesResponse | null): ApiHttpError {
  const message = body?.error?.message ? redact(body.error.message, 220) : null;
  const code = `${body?.error?.code ?? ''} ${body?.error?.type ?? ''}`.toLowerCase();
  if (code.includes('moderation') || code.includes('content_policy') || code.includes('safety')) {
    return new ApiHttpError(
      'refused',
      "The image provider's safety system declined this image. Try different instructions or a different photo.",
      422,
    );
  }
  if (status === 401 || status === 403) {
    return new ApiHttpError(
      'upstream_error',
      "The image provider rejected the server's API key. Check OPENAI_API_KEY in .env and restart the server.",
      502,
    );
  }
  if (status === 429) {
    const quota = code.includes('quota') || code.includes('billing');
    return new ApiHttpError(
      'rate_limited',
      quota
        ? "The image provider account is out of credits or over its quota. Check the OpenAI account's billing."
        : 'The image provider is rate limiting requests right now. Wait a minute and try again.',
      429,
      { retryAfterSec: 60 },
    );
  }
  if (status === 404) {
    return new ApiHttpError('upstream_error', 'The image model is not available. Check OPENAI_IMAGE_MODEL and OPENAI_BASE_URL.', 502);
  }
  if (status >= 400 && status < 500) {
    return new ApiHttpError('upstream_error', `The image provider couldn't process this request${message ? `: ${message}` : '.'}`, 502);
  }
  return new ApiHttpError('upstream_error', `The image provider had a problem (HTTP ${status}). Please try again.`, 502);
}

export function createOpenAIImageProvider(opts: OpenAIImageProviderOptions): ImageProvider {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const model = opts.model;

  async function call(path: string, body: FormData | string, signal: AbortSignal | undefined): Promise<ImageResult> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}` };
    if (typeof body === 'string') headers['Content-Type'] = 'application/json';

    let res: Response;
    let text: string;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, { method: 'POST', headers, body, signal: combined });
      text = await res.text();
    } catch {
      const tooSlow = new ApiHttpError('upstream_error', 'The image provider took too long. Please try again.', 504);
      if (signal?.aborted) throw isTimeoutAbort(signal) ? tooSlow : cancelled();
      if (timeout.aborted) throw tooSlow;
      throw new ApiHttpError('upstream_error', "The server couldn't reach the image provider. Please try again.", 502);
    }

    let json: OpenAIImagesResponse | null = null;
    try {
      json = JSON.parse(text) as OpenAIImagesResponse;
    } catch {
      json = null;
    }
    if (!res.ok) throw mapOpenAIError(res.status, json);

    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) {
      throw new ApiHttpError('upstream_error', 'The image provider returned no image. Please try again.', 502);
    }
    const mime = sniffImageMime(base64ToBytes(b64.slice(0, 32))) ?? 'image/png';
    return { mime, base64: b64 };
  }

  return {
    name: 'openai',
    model,

    async editImage(req) {
      const form = new FormData();
      form.append('model', model);
      form.append(
        'image',
        new Blob([base64ToBytes(req.image.base64)], { type: req.image.mime }),
        `image.${extensionFor(req.image.mime)}`,
      );
      if (req.mask) {
        form.append('mask', new Blob([base64ToBytes(req.mask.base64)], { type: 'image/png' }), 'mask.png');
      }
      form.append('prompt', req.prompt);
      form.append('n', '1');
      if (isGptImage(model)) {
        form.append('size', 'auto');
        form.append('quality', 'high');
        if (supportsInputFidelity(model)) form.append('input_fidelity', 'high');
      } else {
        form.append('size', '1024x1024');
        form.append('response_format', 'b64_json');
      }
      return call('/images/edits', form, req.signal);
    },

    async generateImage(req) {
      const body: Record<string, unknown> = { model, prompt: req.prompt, n: 1 };
      if (isGptImage(model)) {
        body.size = SIZES[req.orientation];
        body.quality = 'high';
        if (req.transparent) {
          body.background = 'transparent';
          body.output_format = 'png';
        }
      } else {
        body.size = '1024x1024';
        body.response_format = 'b64_json';
      }
      return call('/images/generations', JSON.stringify(body), req.signal);
    },
  };
}

/** The provider configured in the environment, or null when disabled. */
export function createImageProvider(config: ServerConfig): ImageProvider | null {
  if (config.imageProvider === 'openai' && config.openaiApiKey) {
    return createOpenAIImageProvider({
      apiKey: config.openaiApiKey,
      model: config.openaiImageModel,
      baseUrl: config.openaiBaseUrl,
    });
  }
  return null;
}
