/**
 * Errors the API returns to clients. Every failure leaves the server as an
 * ApiErrorBody ({ error: { code, message } }) with a matching HTTP status;
 * messages are written for the person using the app and never include keys,
 * stack traces or raw upstream payloads.
 */
import type { ApiErrorBody, ApiErrorCode } from '../shared/api';

/** 499 = client closed the request (nginx convention); only ever seen in logs. */
export const STATUS_CLIENT_CLOSED = 499;

export class ApiHttpError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Seconds the client should wait before retrying (sets Retry-After). */
  readonly retryAfterSec: number | null;

  constructor(code: ApiErrorCode, message: string, status: number, opts: { retryAfterSec?: number | null } = {}) {
    super(message);
    this.name = 'ApiHttpError';
    this.code = code;
    this.status = status;
    this.retryAfterSec = opts.retryAfterSec ?? null;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export const badRequest = (message: string, status = 400) => new ApiHttpError('bad_request', message, status);

export const aiDisabled = () =>
  new ApiHttpError(
    'ai_disabled',
    'AI features are turned off on this server. Set ANTHROPIC_API_KEY in .env and restart the server to enable them — everything else in Mode works without AI.',
    503,
  );

export const imageProviderDisabled = () =>
  new ApiHttpError(
    'image_provider_disabled',
    'Photoreal images need an image provider. Set IMAGE_PROVIDER=openai and OPENAI_API_KEY in .env and restart the server.',
    503,
  );

export const cancelled = () => new ApiHttpError('bad_request', 'The request was cancelled.', STATUS_CLIENT_CLOSED);

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{6,}/g, // Anthropic keys
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style keys
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/** Removes anything that looks like a credential and collapses whitespace. */
export function redact(text: string, maxLength = 300): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > maxLength ? `${out.slice(0, maxLength - 1)}…` : out;
}

/** True when `signal` was aborted because of a timeout (AbortSignal.timeout). */
export function isTimeoutAbort(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  const reason: unknown = signal.reason;
  return typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'TimeoutError';
}
