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
import { isIP } from 'node:net';
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

/** Whether a Content-Type header names JSON (`application/json`, any parameters). */
export function isJsonContentType(header: string | null | undefined): boolean {
  return (header ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
}

/** The 415 for a body that isn't sent as JSON (a cross-site form or no-cors fetch can only send text/plain). */
export function notJsonError(): ApiHttpError {
  return new ApiHttpError('bad_request', 'Send the request body as JSON (Content-Type: application/json).', 415);
}

/**
 * Parses and validates a small JSON body (the host's bodyLimit middleware
 * already caps the size). The Content-Type must be application/json, so a
 * cross-site "simple" request (text/plain, no CORS preflight) never gets here
 * even on a server without createApp's CSRF guard.
 */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  if (!isJsonContentType(c.req.header('content-type'))) throw notJsonError();
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
 * The client address our trusted reverse proxy reported: the RIGHT-most
 * X-Forwarded-For entry (nginx's $proxy_add_x_forwarded_for, Caddy and
 * Traefik append the real peer to whatever the client sent, so every earlier
 * entry is client-chosen), else X-Real-IP. Only an IP address counts; anything
 * else (a name, "unknown", garbage) gives null so the caller falls back to the
 * socket.
 */
function forwardedClient(c: Context): string | null {
  const xff = c.req.header('x-forwarded-for');
  if (xff != null) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    const last = hops.length ? forwardedHost(hops[hops.length - 1]) : '';
    return isIP(last) ? last : null;
  }
  const real = forwardedHost(c.req.header('x-real-ip') ?? '');
  return isIP(real) ? real : null;
}

/**
 * The client's IP address: the socket's remote address or, behind a trusted
 * proxy (TRUST_PROXY), the address that proxy appended to X-Forwarded-For
 * (the right-most entry; see forwardedClient). null when unknown (e.g. tests
 * calling app.request()). Used for rate-limit keys — never as proof that a
 * request comes from this computer (see isLocalClient).
 */
export function clientAddress(c: Context, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = forwardedClient(c);
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

/** An address from a forwarding header without its port / brackets ("[::1]:5173" → "::1", "127.0.0.1:50000" → "127.0.0.1"). */
function forwardedHost(entry: string): string {
  const v = entry.trim().replace(/^"|"$/g, '');
  if (v.startsWith('[')) return v.slice(1, v.indexOf(']') > 0 ? v.indexOf(']') : undefined);
  // One colon = IPv4 (or a name) with a port; more = a bare IPv6 address.
  return (v.match(/:/g) ?? []).length === 1 ? v.slice(0, v.indexOf(':')) : v;
}

/** Right-most `for=` of a Forwarded header (RFC 7239), or null when there is none. */
function lastForwardedFor(header: string): string | null {
  const fors = header
    .split(',')
    .map((el) => el.split(';').map((p) => p.trim()).find((p) => /^for=/i.test(p)))
    .filter((p): p is string => !!p)
    .map((p) => forwardedHost(p.slice(4)));
  return fors.length ? fors[fors.length - 1] : null;
}

/**
 * Whether a request comes from a browser on this computer: the socket peer
 * must be loopback, and when a local proxy relayed the request — `npm run dev`
 * / `vite preview` proxy /api with `xfwd`, so X-Forwarded-For carries the real
 * peer — the address that proxy APPENDED (the right-most X-Forwarded-For
 * entry; earlier entries are whatever the client sent) must be loopback too.
 * A forwarding header that is present but empty or unparsable is refused;
 * Forwarded and X-Real-IP count the same way. Host and X-Forwarded-Host are
 * never trusted for this (Vite passes a client-supplied X-Forwarded-Host
 * through).
 *
 * Behind a remote reverse proxy (TRUST_PROXY) there is no way to tell: some
 * proxies pass a client's X-Forwarded-For through unchanged, so even the
 * right-most entry can be forged. Callers refuse those requests instead
 * (server/handoff/routes.ts: the watcher then needs MODE_ACCESS_TOKEN).
 */
export function isLocalClient(c: Context): boolean {
  if (!isLoopbackAddress(clientAddress(c, false))) return false;
  const xff = c.req.header('x-forwarded-for');
  if (xff !== undefined) {
    const entries = xff.split(',').map((s) => s.trim()).filter(Boolean);
    const last = entries[entries.length - 1];
    if (!last || !isLoopbackAddress(forwardedHost(last))) return false;
  }
  const forwarded = c.req.header('forwarded');
  if (forwarded !== undefined) {
    const last = lastForwardedFor(forwarded);
    if (!last || !isLoopbackAddress(last)) return false;
  }
  const real = c.req.header('x-real-ip');
  if (real !== undefined && !isLoopbackAddress(forwardedHost(real))) return false;
  return true;
}

/** True for 127.0.0.0/8, ::1 and IPv4-mapped loopback (::ffff:127.x.x.x). */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const a = address.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true;
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}
