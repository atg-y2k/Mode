/**
 * Typed client for the Mode API server (see shared/api.ts). Validates responses
 * with the shared zod schemas and throws ApiError with the server's error code.
 *
 * - Sends the server access token from localStorage 'mode.apiToken' (header
 *   `x-mode-token`) when present.
 * - Every call has a timeout (analyze / suggest / asset list 180 s, render and
 *   asset generation 300 s) and accepts an AbortSignal for cancellation.
 * - Failures that never reached the server (offline, timeout, cancelled) use
 *   code 'network' with status 0; a cancelled call also has `aborted: true`
 *   and name 'AbortError'.
 */
import type { z } from 'zod';
import {
  API_PATHS,
  AnalyzeRequestSchema,
  ApiErrorBodySchema,
  AssetListRequestSchema,
  AssetListResultSchema,
  DesignSuggestionSchema,
  GenerateAssetRequestSchema,
  GeneratedAssetSchema,
  HealthResponseSchema,
  RenderRequestSchema,
  RenderResponseSchema,
  SpaceAnalysisResultSchema,
  SuggestRequestSchema,
} from '../../shared/api';
import type {
  AnalyzeRequest,
  ApiErrorCode,
  AssetListRequest,
  AssetListResult,
  DesignSuggestion,
  GenerateAssetRequest,
  GeneratedAsset,
  HealthResponse,
  RenderRequest,
  RenderResponse,
  SpaceAnalysisResult,
  SuggestRequest,
} from '../../shared/api';

/** localStorage key of the optional server access token (MODE_ACCESS_TOKEN on the server). */
export const API_TOKEN_STORAGE_KEY = 'mode.apiToken';
export const API_TOKEN_HEADER = 'x-mode-token';

/** Client-side timeouts in milliseconds. */
export const API_TIMEOUTS_MS = {
  health: 8_000,
  analyze: 180_000,
  suggest: 180_000,
  assetList: 180_000,
  generateAsset: 300_000,
  render: 300_000,
} as const;

export class ApiError extends Error {
  readonly code: ApiErrorCode | 'network';
  readonly status: number;
  /** True when the caller cancelled the request through its AbortSignal. */
  readonly aborted: boolean;

  constructor(code: ApiErrorCode | 'network', message: string, status: number, opts: { aborted?: boolean } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.aborted = opts.aborted ?? false;
    this.name = this.aborted ? 'AbortError' : 'ApiError';
  }
}

/** True for a request the caller cancelled (ApiError or a DOM AbortError). */
export function isAbortError(err: unknown): boolean {
  if (err instanceof ApiError) return err.aborted;
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

function readToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const token = localStorage.getItem(API_TOKEN_STORAGE_KEY)?.trim();
    return token ? token : null;
  } catch {
    return null; // storage blocked (privacy mode, sandboxed iframe)
  }
}

function cancelledError(): ApiError {
  return new ApiError('network', 'Request cancelled.', 0, { aborted: true });
}

interface RawResponse {
  status: number;
  ok: boolean;
  text: string;
}

async function send(
  path: string,
  init: { method: 'GET' | 'POST'; body?: string },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RawResponse> {
  if (signal?.aborted) throw cancelledError();

  // Manual signal plumbing: AbortSignal.any / .timeout are missing on older mobile Safari.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = readToken();
  if (token) headers[API_TOKEN_HEADER] = token;

  try {
    const res = await fetch(path, { method: init.method, headers, body: init.body, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch {
    if (signal?.aborted) throw cancelledError();
    if (timedOut) {
      throw new ApiError(
        'network',
        `The server took too long to respond (over ${Math.round(timeoutMs / 1000)} seconds). Please try again.`,
        0,
      );
    }
    throw new ApiError(
      'network',
      "Can't reach the Mode server. Check your connection and that the server is running, then try again.",
      0,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Error for a non-2xx response that didn't carry an ApiErrorBody (proxy, static host…). */
function errorForStatus(status: number): ApiError {
  if (status === 413) {
    return new ApiError('payload_too_large', 'The request is too large for the server. Try a smaller photo.', status);
  }
  if (status === 429) return new ApiError('rate_limited', 'Too many requests. Wait a minute and try again.', status);
  if (status === 401 || status === 403) {
    return new ApiError(
      'unauthorized',
      'The server refused the request. Check the server access token in Settings.',
      status,
    );
  }
  if (status === 404 || status >= 500) {
    return new ApiError(
      'network',
      `The Mode API server isn't responding (HTTP ${status}). Make sure it's running (npm run dev starts it with the app).`,
      status,
    );
  }
  return new ApiError('internal', `Unexpected response from the server (HTTP ${status}).`, status);
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => {
      const path = i.path.map(String).join('.');
      return path ? `${path}: ${i.message}` : i.message;
    })
    .join('; ');
}

async function postJson<Req extends z.ZodType, Res extends z.ZodType>(
  path: string,
  requestSchema: Req,
  req: z.input<Req>,
  responseSchema: Res,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<z.infer<Res>> {
  // Validate locally first: fails fast without uploading a photo for nothing.
  const checked = requestSchema.safeParse(req);
  if (!checked.success) {
    throw new ApiError('bad_request', `Invalid request. ${describeIssues(checked.error)}`, 0);
  }
  const raw = await send(path, { method: 'POST', body: JSON.stringify(checked.data) }, timeoutMs, signal);
  const json = parseJson(raw.text);

  if (!raw.ok) {
    const body = ApiErrorBodySchema.safeParse(json);
    if (body.success) throw new ApiError(body.data.error.code, body.data.error.message, raw.status);
    throw errorForStatus(raw.status);
  }

  const result = responseSchema.safeParse(json);
  if (!result.success) {
    throw new ApiError(
      'internal',
      "The server sent a response this version of Mode doesn't understand. Reload the page and try again.",
      raw.status,
    );
  }
  return result.data;
}

function offlineHealth(): HealthResponse {
  return {
    ok: false,
    ai: { enabled: false, model: null },
    imageProvider: { enabled: false, name: null, model: null },
  };
}

/** Never throws: returns a disabled health object when the server is unreachable. */
export async function getHealth(): Promise<HealthResponse> {
  try {
    const raw = await send(API_PATHS.health, { method: 'GET' }, API_TIMEOUTS_MS.health);
    if (!raw.ok) return offlineHealth();
    const parsed = HealthResponseSchema.safeParse(parseJson(raw.text));
    return parsed.success ? parsed.data : offlineHealth();
  } catch {
    return offlineHealth();
  }
}

export function analyzePhoto(req: AnalyzeRequest, signal?: AbortSignal): Promise<SpaceAnalysisResult> {
  return postJson(API_PATHS.analyze, AnalyzeRequestSchema, req, SpaceAnalysisResultSchema, API_TIMEOUTS_MS.analyze, signal);
}

export function suggestDesign(req: SuggestRequest, signal?: AbortSignal): Promise<DesignSuggestion> {
  return postJson(API_PATHS.suggest, SuggestRequestSchema, req, DesignSuggestionSchema, API_TIMEOUTS_MS.suggest, signal);
}

export function generateAssetListAI(req: AssetListRequest, signal?: AbortSignal): Promise<AssetListResult> {
  return postJson(
    API_PATHS.assetList,
    AssetListRequestSchema,
    req,
    AssetListResultSchema,
    API_TIMEOUTS_MS.assetList,
    signal,
  );
}

export function generateAsset(req: GenerateAssetRequest, signal?: AbortSignal): Promise<GeneratedAsset> {
  return postJson(
    API_PATHS.generateAsset,
    GenerateAssetRequestSchema,
    req,
    GeneratedAssetSchema,
    API_TIMEOUTS_MS.generateAsset,
    signal,
  );
}

export function renderAI(req: RenderRequest, signal?: AbortSignal): Promise<RenderResponse> {
  return postJson(API_PATHS.render, RenderRequestSchema, req, RenderResponseSchema, API_TIMEOUTS_MS.render, signal);
}
