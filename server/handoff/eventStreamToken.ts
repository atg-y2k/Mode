/**
 * Access token for the hand-off event stream.
 *
 * The browser's EventSource cannot send request headers, so the client puts
 * the server access token in the URL (`/api/handoff/events?token=…`). The
 * host app's auth middleware (server/app.ts) only reads the `x-mode-token`
 * header and runs before any extra route, so this adapter wraps the app's
 * `fetch`: for GET requests to the events path that carry `?token=` and no
 * header, it moves the token into the header and drops it from the URL (so it
 * never reaches logs). The host middleware then performs its usual
 * timing-safe comparison. Every other path ignores `?token=`.
 *
 * Call it once, after the app is built (inside `extraRoutes` is fine: the
 * server reads `app.fetch` afterwards). Wraps `app.request` too, since Hono's
 * `request()` dispatches through `this.fetch`.
 */
import type { Env, Hono } from 'hono';
import { API_PATHS } from '../../shared/api';

export const EVENT_STREAM_TOKEN_PARAM = 'token';
const TOKEN_HEADER = 'x-mode-token';

/** The request with `?token=` moved into the x-mode-token header, or the request unchanged. */
export function moveEventStreamToken(request: Request): Request {
  if (request.method !== 'GET' && request.method !== 'HEAD') return request;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return request;
  }
  if (url.pathname !== API_PATHS.handoffEvents || !url.searchParams.has(EVENT_STREAM_TOKEN_PARAM)) return request;
  const token = url.searchParams.get(EVENT_STREAM_TOKEN_PARAM) ?? '';
  url.searchParams.delete(EVENT_STREAM_TOKEN_PARAM);
  const headers = new Headers(request.headers);
  // A header, when present, wins (fetch-based clients); the query is only a fallback for EventSource.
  if (!headers.has(TOKEN_HEADER) && token) headers.set(TOKEN_HEADER, token);
  return new Request(url, { method: request.method, headers, signal: request.signal });
}

/** Installs the adapter on `app` (idempotent). */
export function acceptEventStreamToken<E extends Env>(app: Hono<E>): void {
  const marked = app as Hono<E> & { __modeEventToken?: true };
  if (marked.__modeEventToken) return;
  marked.__modeEventToken = true;
  const original = app.fetch;
  const wrapped: typeof app.fetch = (request, ...rest) => original(moveEventStreamToken(request), ...rest);
  app.fetch = wrapped;
}
