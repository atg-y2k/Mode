/**
 * Errors for the Studio routes. Every failure leaves the server as an
 * ApiErrorBody ({ error: { code, message } }) with a matching HTTP status.
 * Messages are written for the homeowner and never include keys, stack traces
 * or raw upstream payloads.
 */
import type { ApiErrorBody, ApiErrorCode } from '../../shared/api';

const API_ERROR_CODES: readonly ApiErrorCode[] = [
  'bad_request',
  'ai_disabled',
  'image_provider_disabled',
  'refused',
  'rate_limited',
  'upstream_error',
  'payload_too_large',
  'internal',
];

/** 499 = client closed the request (nginx convention); only ever seen in logs. */
export const STATUS_CLIENT_CLOSED = 499;

export class StudioError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Seconds the client should wait before retrying (sets Retry-After). */
  readonly retryAfterSec: number | null;

  constructor(code: ApiErrorCode, message: string, status: number, opts: { retryAfterSec?: number | null } = {}) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.status = status;
    this.retryAfterSec = opts.retryAfterSec ?? null;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export const badRequest = (message: string, status = 400) => new StudioError('bad_request', message, status);

export const aiDisabled = () =>
  new StudioError(
    'ai_disabled',
    'AI features are turned off on this server. Set ANTHROPIC_API_KEY in .env and restart the server to enable them.',
    503,
  );

export const cancelled = () => new StudioError('bad_request', 'The request was cancelled.', STATUS_CLIENT_CLOSED);

const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{6,}/g, '[redacted]'], // Anthropic keys
  [/sk-[A-Za-z0-9_-]{16,}/g, '[redacted]'], // OpenAI-style keys
  [/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]'], // Google API keys
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[redacted]'],
  [/([?&](?:key|api_key|apikey|token)=)[^&\s]+/gi, '$1[redacted]'],
];

/** Removes anything that looks like a credential, collapses whitespace and truncates. */
export function redact(text: string, maxLength = 300): string {
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > maxLength ? `${out.slice(0, maxLength - 1)}…` : out;
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Converts anything thrown inside a Studio route into a StudioError. Errors
 * from the host app (e.g. its rate limiter or body limit) are recognised by
 * shape so their code and status survive; anything else becomes 'internal'.
 * Returns null for unknown errors so the caller can log them.
 */
export function asStudioError(err: unknown): StudioError | null {
  if (err instanceof StudioError) return err;
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: unknown; status?: unknown; message?: unknown; retryAfterSec?: unknown };
    if (isApiErrorCode(e.code) && typeof e.status === 'number' && typeof e.message === 'string') {
      return new StudioError(e.code, e.message, e.status, {
        retryAfterSec: typeof e.retryAfterSec === 'number' ? e.retryAfterSec : null,
      });
    }
    // Hono HTTPException (e.g. bodyLimit): status + message, no code.
    if (typeof e.status === 'number' && e.status >= 400 && e.status < 600 && (err as Error).name === 'HTTPException') {
      if (e.status === 413) return new StudioError('payload_too_large', 'The request is too large.', 413);
      return new StudioError(e.status >= 500 ? 'internal' : 'bad_request', redact(String(e.message ?? 'Request failed.')), e.status);
    }
  }
  return null;
}
