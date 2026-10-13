/**
 * Manual hand-off helper routes (shared/api.ts §Manual hand-off helpers):
 *
 *   GET  /api/handoff/watch       → { available, dir, on }
 *   POST /api/handoff/watch       { on: boolean } → { available, dir, on }
 *   GET  /api/handoff/events      Server-Sent Events while watching:
 *                                   `ready`   { available, dir, on }  (first event)
 *                                   `file`    { id, name, size, mtime } (id: = sequence number)
 *                                   `stopped` { reason, message }     (stream ends)
 *                                 Reconnects replay missed `file` events (Last-Event-ID or ?since=).
 *                                 EventSource can't send headers, so ?token= carries the access
 *                                 token for this endpoint only (see eventStreamToken.ts).
 *   GET  /api/handoff/file?id=    bytes of an announced image (correct Content-Type)
 *   POST /api/handoff/fetch-url   { url } → image bytes (https only, SSRF-guarded, ≤ 15 MB)
 *
 * The Downloads watcher exposes new files from the user's own folder, so
 * unless the server has an access token (MODE_ACCESS_TOKEN) it only answers
 * requests from this computer: a phone or another device on the network gets
 * `available: false` / 403. Register after the host's auth / body-limit
 * middleware and before any `/api/*` catch-all.
 */
import { lstat, open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Context, Env, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { API_PATHS } from '../../shared/api';
import { ApiHttpError } from '../errors';
import { fetchImageFromUrl, type FetchUrlDeps } from './fetchUrl';
import { clientAddress, guarded, isLoopbackAddress, methodNotAllowed, readJson } from './http';
import { DownloadsWatcher, resolveWatchDir, type WatchEvent, type WatchStatus } from './watcher';

/** SSE comment sent this often so proxies keep the stream open. */
export const SSE_KEEPALIVE_MS = 25_000;
/** EventSource reconnect delay announced to the browser. */
export const SSE_RETRY_MS = 3_000;

export interface HandoffDeps {
  /** The watcher (created from the environment by createHandoffDepsFromEnv). */
  watcher: DownloadsWatcher;
  /**
   * True when the server requires an access token (MODE_ACCESS_TOKEN): then
   * token-holding devices on the network may use the watcher too.
   */
  accessTokenRequired: boolean;
  /** Use X-Forwarded-For / X-Real-IP for the client address (TRUST_PROXY). */
  trustProxy?: boolean;
  /** Overrides the "is this request from this computer?" check (tests). */
  isLocalRequest?: (c: Context) => boolean;
  /** Network / DNS seams for fetch-url (tests). */
  fetchUrl?: FetchUrlDeps;
  keepaliveMs?: number;
  log?: (line: string) => void;
}

const WatchRequestSchema = z.object({ on: z.boolean() });
const FetchUrlRequestSchema = z.object({ url: z.string().trim().min(1).max(8_000) });
const FileQuerySchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

const REMOTE_REFUSED =
  'The Downloads watcher only works in a browser on the computer running Mode (or set MODE_ACCESS_TOKEN on the server to allow your other devices).';

export function registerHandoffRoutes<E extends Env>(app: Hono<E>, deps: HandoffDeps): void {
  const log = deps.log ?? ((line: string) => console.log(line));
  const { watcher } = deps;
  const keepaliveMs = deps.keepaliveMs ?? SSE_KEEPALIVE_MS;
  const route = <T extends (c: Context<E>) => Response | Promise<Response>>(handler: T) => guarded<E>(log, 'handoff', handler);

  /** Requests the watcher may serve: from this computer, or any device when an access token guards the server. */
  const mayWatch = (c: Context): boolean => {
    if (deps.accessTokenRequired) return true;
    if (deps.isLocalRequest) return deps.isLocalRequest(c);
    return isLoopbackAddress(clientAddress(c, deps.trustProxy ?? false));
  };
  const requireWatchAccess = (c: Context): void => {
    if (!mayWatch(c)) throw new ApiHttpError('unauthorized', REMOTE_REFUSED, 403);
  };
  const statusFor = (c: Context): WatchStatus => (mayWatch(c) ? watcher.status() : { available: false, dir: null, on: false });

  // ---- watch status / on-off ---------------------------------------------

  app.get(
    API_PATHS.handoffWatch,
    route((c) => c.json(statusFor(c))),
  );

  app.post(
    API_PATHS.handoffWatch,
    route(async (c) => {
      const { on } = await readJson(c, WatchRequestSchema);
      requireWatchAccess(c);
      if (!on) {
        await watcher.release();
        return c.json(watcher.status());
      }
      if (!watcher.available()) {
        throw new ApiHttpError(
          'bad_request',
          'This computer has no Downloads folder to watch. Set HANDOFF_WATCH_DIR in .env to the folder your browser saves to, then restart the server.',
          409,
        );
      }
      try {
        await watcher.start();
      } catch (err) {
        log(`[handoff] could not start watching: ${err instanceof Error ? err.message : String(err)}`);
        throw new ApiHttpError('internal', "The Downloads folder couldn't be watched. Check that the server can read it, then try again.", 500);
      }
      return c.json(watcher.status());
    }),
  );
  methodNotAllowed(app, API_PATHS.handoffWatch, ['GET', 'POST']);

  // ---- events (SSE) ---------------------------------------------------------

  app.get(
    API_PATHS.handoffEvents,
    route((c) => {
      requireWatchAccess(c);
      // Last-Event-ID (browser reconnect) or ?since= (stream re-created by the client): replay what was missed.
      const lastIdRaw = (c.req.header('last-event-id') || c.req.query('since') || '').trim();
      const lastId = /^\d{1,15}$/.test(lastIdRaw) ? Number(lastIdRaw) : Number.NaN;
      return streamSSE(c, async (stream) => {
        const queue: WatchEvent[] = [];
        let wake: (() => void) | null = null;
        let closed = false;
        const nudge = () => {
          const w = wake;
          wake = null;
          w?.();
        };
        const unsubscribe = watcher.subscribe((event) => {
          queue.push(event);
          nudge();
        });
        const onAbort = () => {
          closed = true;
          nudge();
        };
        stream.onAbort(onAbort);
        c.req.raw.signal.addEventListener('abort', onAbort, { once: true });
        try {
          await stream.writeSSE({ event: 'ready', data: JSON.stringify(watcher.status()), retry: SSE_RETRY_MS });
          if (Number.isInteger(lastId) && lastId >= 0) queue.unshift(...watcher.eventsSince(lastId));
          while (!closed && !stream.aborted) {
            if (queue.length === 0) {
              let timer: ReturnType<typeof setTimeout> | undefined;
              const timedOut = await new Promise<boolean>((resolve) => {
                wake = () => resolve(false);
                timer = setTimeout(() => resolve(true), keepaliveMs);
              });
              clearTimeout(timer);
              wake = null;
              if (timedOut && !closed) await stream.write(': keepalive\n\n');
              continue;
            }
            const event = queue.shift() as WatchEvent;
            if (event.type === 'file') {
              await stream.writeSSE({ event: 'file', id: String(event.seq), data: JSON.stringify(event.file) });
            } else {
              await stream.writeSSE({ event: 'stopped', data: JSON.stringify({ reason: event.reason, message: event.message }) });
              break; // the client closes its EventSource on `stopped`
            }
          }
        } finally {
          unsubscribe();
          c.req.raw.signal.removeEventListener('abort', onAbort);
        }
      });
    }),
  );
  methodNotAllowed(app, API_PATHS.handoffEvents, ['GET']);

  // ---- announced files -------------------------------------------------------

  app.get(
    API_PATHS.handoffFile,
    route(async (c) => {
      requireWatchAccess(c);
      const id = FileQuerySchema.safeParse(c.req.query('id') ?? '');
      const entry = id.success ? watcher.lookup(id.data) : null;
      if (!entry) {
        throw new ApiHttpError('bad_request', 'That file is no longer available. Drop or paste the image instead.', 404);
      }
      // Re-check the file at serve time: still a regular file (not swapped for a symlink), same image type.
      const fh = await open(entry.path, 'r').catch(() => null);
      if (!fh) throw new ApiHttpError('bad_request', `“${entry.name}” was moved or deleted. Drop or paste the image instead.`, 404);
      let handedOff = false;
      try {
        const st = await fh.stat();
        const link = await lstat(entry.path).catch(() => null);
        if (!st.isFile() || !link?.isFile() || st.size === 0) {
          throw new ApiHttpError('bad_request', `“${entry.name}” is not a usable image file any more.`, 404);
        }
        watcher.touch();
        // autoClose: the stream closes the file handle when it ends or the client goes away.
        const stream = fh.createReadStream({ start: 0, end: st.size - 1, autoClose: true });
        handedOff = true;
        c.header('Content-Type', entry.mime);
        c.header('Content-Length', String(st.size));
        c.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(entry.name)}`);
        c.header('Cache-Control', 'no-store');
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Content-Security-Policy', "default-src 'none'; sandbox");
        return c.body(Readable.toWeb(stream) as ReadableStream<Uint8Array>, 200);
      } finally {
        if (!handedOff) await fh.close().catch(() => undefined);
      }
    }),
  );
  methodNotAllowed(app, API_PATHS.handoffFile, ['GET']);

  // ---- dragged image URLs ------------------------------------------------------

  app.post(
    API_PATHS.handoffFetchUrl,
    route(async (c) => {
      const { url } = await readJson(c, FetchUrlRequestSchema);
      const signal = c.req.raw.signal;
      const image = await fetchImageFromUrl(url, deps.fetchUrl, signal);
      c.header('Content-Type', image.mime);
      c.header('Cache-Control', 'no-store');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Content-Security-Policy', "default-src 'none'; sandbox");
      return c.body(new Uint8Array(image.bytes), 200);
    }),
  );
  methodNotAllowed(app, API_PATHS.handoffFetchUrl, ['POST']);
}

/**
 * Hand-off dependencies from the environment: HANDOFF_WATCH_DIR (default
 * ~/Downloads when it exists), MODE_ACCESS_TOKEN (lets token-holding devices
 * on the network use the watcher) and TRUST_PROXY.
 */
export function createHandoffDepsFromEnv(env: Record<string, string | undefined> = process.env): HandoffDeps & { warnings: string[] } {
  const { dir, warning } = resolveWatchDir(env);
  const trust = env.TRUST_PROXY?.trim().toLowerCase();
  return {
    watcher: new DownloadsWatcher({ dir }),
    accessTokenRequired: Boolean(env.MODE_ACCESS_TOKEN?.trim()),
    trustProxy: trust === 'true' || trust === '1' || trust === 'yes' || trust === 'on',
    warnings: warning ? [warning] : [],
  };
}
