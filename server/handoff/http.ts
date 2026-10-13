/**
 * Small route helpers shared by the server extras (server/handoff, server/site):
 * JSON body validation with zod, an error boundary that answers every failure
 * with an ApiErrorBody, a 405 for known paths hit with the wrong method, and
 * the client address / loopback checks used to keep the Downloads watcher
 * on this computer.
 *
 * Errors use ApiHttpError (server/errors.ts) so they look exactly like the
 * main API's; anything else that escapes a handler becomes a logged 500.
 */
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Env, Handler, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { ApiErrorBodySchema, type ApiErrorCode } from '../../shared/api';
import { ApiHttpError, redact } from '../errors';

const API_ERROR_CODES = new Set<string>(ApiErrorBodySchema.shape.error.shape.code.options);

/** Recognises ApiHttpError and look-alikes from other server modules (code + status). */
export function asApiHttpError(err: unknown): ApiHttpError | null {
  if (err instanceof ApiHttpError) return err;
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; status?: unknown; message?: unknown; retryAfterSec?: unknown };
  if (typeof e.code !== 'string' || !API_ERROR_CODES.has(e.code)) return null;
  if (typeof e.status !== 'number' || e.status < 400 || e.status > 599) return null;
  return new ApiHttpError(e.code as ApiErrorCode, typeof e.message === 'string' ? e.message : 'Request failed.', e.status, {
    retryAfterSec: typeof e.retryAfterSec === 'number' ? e.retryAfterSec : null,
  });
}

export function errorResponse(c: Context, err: unknown, log: (line: string) => void, tag: string): Response {
  let e = asApiHttpError(err);
  if (!e) {
    log(`[${tag}] unexpected error on ${c.req.method} ${c.req.path}: ${redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err))}`);
    e = new ApiHttpError('internal', 'Something went wrong on the server. Please try again.', 500);
  }
  if (e.retryAfterSec != null) c.header('Retry-After', String(e.retryAfterSec));
  c.header('Cache-Control', 'no-store');
  return c.json(e.toBody(), e.status as ContentfulStatusCode);
}

/** Wraps a handler so every failure leaves as an ApiErrorBody (independent of the host's onError). */
export function guarded<E extends Env>(
  log: (line: string) => void,
  tag: string,
  handler: (c: Context<E>) => Response | Promise<Response>,
): Handler<E> {
  return async (c) => {
    try {
      return await handler(c);
    } catch (err) {
      return errorResponse(c, err, log, tag);
    }
  };
}

function formatIssues(error: z.ZodError): string {
  const parts = error.issues.slice(0, 4).map((issue) => {
    const path = issue.path.map(String).join('.');
    const message = issue.message.length > 160 ? `${issue.message.slice(0, 159)}…` : issue.message;
    return path ? `${path}: ${message}` : message;
  });
  const more = error.issues.length > 4 ? ` (and ${error.issues.length - 4} more)` : '';
  return `Invalid request. ${parts.join('; ')}${more}`;
}

/** Parses and validates a small JSON body (the host's bodyLimit middleware already caps the size). */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiHttpError('bad_request', 'The request body must be valid JSON.', 400);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiHttpError('bad_request', formatIssues(result.error), 400);
  return result.data;
}

/** Answers 405 for any other method on `path` (registered after the real handlers). */
export function methodNotAllowed<E extends Env>(app: Hono<E>, path: string, allowed: string[]): void {
  app.all(path, (c) => {
    c.header('Allow', allowed.join(', '));
    c.header('Cache-Control', 'no-store');
    return c.json(new ApiHttpError('bad_request', `${c.req.method} is not supported here.`, 405).toBody(), 405);
  });
}

/**
 * The client's IP address: the socket's remote address, or the first
 * X-Forwarded-For / X-Real-IP entry when the server sits behind a trusted
 * proxy. null when unknown (e.g. tests calling app.request()).
 */
export function clientAddress(c: Context, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
    const real = c.req.header('x-real-ip')?.trim();
    if (real) return real;
  }
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

/** True for 127.0.0.0/8, ::1 and IPv4-mapped loopback (::ffff:127.x.x.x). */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const a = address.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true;
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}
