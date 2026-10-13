/**
 * Client for the server's hand-off helpers: watch the Downloads folder for a
 * returned image while a hand-off is pending (Server-Sent Events), fetch a
 * detected file, and fetch an image URL dragged in from the ChatGPT/Gemini tab.
 *
 * Conventions shared with src/lib/api.ts: the optional server access token
 * from localStorage 'mode.apiToken' goes in the `x-mode-token` header; failures
 * throw ApiError (code 'network' + status 0 when the server wasn't reached,
 * `aborted: true` when the caller cancelled). EventSource can't send headers,
 * and the long-lived token must never travel in a URL (proxies and dev
 * servers log URLs), so with a token set each event-stream connection first
 * fetches a single-use, 60-second ticket (POST /api/handoff/events-ticket,
 * with the header) and opens the stream with `?ticket=`.
 */
import { API_PATHS, ApiErrorBodySchema } from '../../shared/api';
import { API_TOKEN_HEADER, API_TOKEN_STORAGE_KEY, ApiError } from './api';

export interface DownloadedFile {
  /** Opaque token for /api/handoff/file. */
  id: string;
  name: string;
  size: number;
  mtime: number;
}

/** Client-side timeouts in milliseconds. */
export const HANDOFF_TIMEOUTS_MS = {
  status: 8_000,
  watch: 20_000,
  file: 60_000,
  fetchUrl: 45_000,
} as const;

/**
 * How long the event stream may stay disconnected (server restarting, laptop
 * waking up) before watching is reported as stopped.
 */
export const WATCH_RECONNECT_WINDOW_MS = 90_000;

function readToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(API_TOKEN_STORAGE_KEY)?.trim() || null;
  } catch {
    return null; // storage blocked (privacy mode, sandboxed iframe)
  }
}

const cancelled = () => new ApiError('network', 'Request cancelled.', 0, { aborted: true });

function errorFor(status: number, body: unknown, what: string): ApiError {
  const parsed = ApiErrorBodySchema.safeParse(body);
  if (parsed.success) return new ApiError(parsed.data.error.code, parsed.data.error.message, status);
  if (status === 404) {
    return new ApiError('network', "This Mode server doesn't have the hand-off helpers yet — update and restart it.", status);
  }
  if (status === 401 || status === 403) {
    return new ApiError('unauthorized', 'The server refused the request. Check the server access token in Settings.', status);
  }
  if (status === 413) return new ApiError('payload_too_large', `${what} is too large.`, status);
  if (status === 429) return new ApiError('rate_limited', 'Too many requests. Wait a minute and try again.', status);
  return new ApiError('network', `${what} failed (HTTP ${status}). Make sure the Mode server is running, then try again.`, status);
}

/** A successful response whose body is read once, still under the request's timeout and cancellation. */
interface OkBody {
  blob(): Promise<Blob>;
  json(): Promise<unknown>;
}

/** fetch with the token header, a timeout and caller cancellation; non-2xx → ApiError. */
async function request(
  path: string,
  init: { method: 'GET' | 'POST'; json?: unknown; accept: string; keepalive?: boolean },
  timeoutMs: number,
  what: string,
  signal?: AbortSignal,
): Promise<OkBody> {
  if (signal?.aborted) throw cancelled();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const release = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
  const failure = (fallback: ApiError) =>
    signal?.aborted ? cancelled() : timedOut ? new ApiError('network', `${what} took too long. Please try again.`, 0) : fallback;

  const headers: Record<string, string> = { Accept: init.accept };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const token = readToken();
  if (token) headers[API_TOKEN_HEADER] = token;
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      signal: controller.signal,
      keepalive: init.keepalive,
    });
  } catch {
    release();
    throw failure(new ApiError('network', "Can't reach the Mode server. Check that it's running, then try again.", 0));
  }
  if (!res.ok) {
    let body: unknown;
    try {
      body = JSON.parse(await res.text());
    } catch {
      body = undefined;
    } finally {
      release();
    }
    throw errorFor(res.status, body, what);
  }
  // The timer keeps running while the body downloads (a big PNG over Wi-Fi).
  const read = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch {
      throw failure(new ApiError('network', `${what} was interrupted. Please try again.`, 0));
    } finally {
      release();
    }
  };
  return { blob: () => read(() => res.blob()), json: () => read(() => res.json() as Promise<unknown>) };
}

/** Whether the server can watch a folder (and which). */
export async function handoffWatchStatus(signal?: AbortSignal): Promise<{ available: boolean; dir: string | null }> {
  const res = await request(API_PATHS.handoffWatch, { method: 'GET', accept: 'application/json' }, HANDOFF_TIMEOUTS_MS.status, 'Checking the Downloads watcher', signal);
  const body = (await res.json()) as { available?: unknown; dir?: unknown } | null;
  return {
    available: body?.available === true,
    dir: typeof body?.dir === 'string' && body.dir ? body.dir : null,
  };
}

async function setWatching(on: boolean, opts: { keepalive?: boolean; signal?: AbortSignal } = {}): Promise<{ available: boolean; on: boolean }> {
  const res = await request(
    API_PATHS.handoffWatch,
    { method: 'POST', json: { on }, accept: 'application/json', keepalive: opts.keepalive },
    HANDOFF_TIMEOUTS_MS.watch,
    on ? 'Starting the Downloads watcher' : 'Stopping the Downloads watcher',
    opts.signal,
  );
  const body = (await res.json()) as { available?: unknown; on?: unknown } | null;
  return { available: body?.available === true, on: body?.on === true };
}

/**
 * A single-use ticket (valid for 60 s) that lets this browser open the event
 * stream once: EventSource can't send the x-mode-token header.
 */
export async function fetchEventsTicket(signal?: AbortSignal): Promise<string> {
  const res = await request(
    API_PATHS.handoffEventsTicket,
    { method: 'POST', json: {}, accept: 'application/json' },
    HANDOFF_TIMEOUTS_MS.status,
    'Connecting to the Downloads watcher',
    signal,
  );
  const body = (await res.json()) as { ticket?: unknown } | null;
  if (typeof body?.ticket !== 'string' || !body.ticket) {
    throw new ApiError('network', "This Mode server doesn't have the hand-off helpers yet — update and restart it.", 404);
  }
  return body.ticket;
}

function parseFile(data: string): DownloadedFile | null {
  try {
    const o = JSON.parse(data) as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string') return null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return { id: o.id, name: o.name, size: num(o.size), mtime: num(o.mtime) };
  } catch {
    return null;
  }
}

function parseObject(data: string): Record<string, unknown> {
  try {
    const o = JSON.parse(data) as unknown;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Test seam: the EventSource constructor to use. */
export interface WatchOptions {
  EventSource?: typeof EventSource;
  reconnectWindowMs?: number;
  /** Delay before re-creating a stream the browser gave up on (ms, doubled per attempt). */
  retryDelayMs?: number;
}

/**
 * Starts watching (server side) and calls `onFile` for each new image that
 * appears after now. Returns a stop function (also stops server-side watching).
 *
 * `onError` is called at most once, when watching has stopped for good: the
 * server stopped it (30 minutes without activity, folder gone), the server has
 * no folder to watch, the access token was refused, or the server stayed
 * unreachable for WATCH_RECONNECT_WINDOW_MS. Short disconnects are retried
 * silently and files announced meanwhile are replayed, each id at most once.
 * Throws synchronously when this browser has no EventSource.
 */
export function watchDownloads(onFile: (f: DownloadedFile) => void, onError?: (err: Error) => void, opts: WatchOptions = {}): () => void {
  const ES = opts.EventSource ?? (typeof EventSource === 'undefined' ? undefined : EventSource);
  if (!ES) throw new Error("This browser can't receive live updates from the Mode server.");
  const reconnectWindowMs = opts.reconnectWindowMs ?? WATCH_RECONNECT_WINDOW_MS;
  const retryDelayMs = opts.retryDelayMs ?? 2_000;

  let stopped = false;
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the stream started failing (null while connected). */
  let failingSince: number | null = null;
  let manualRetries = 0;
  /** Last file event id seen, so a re-created stream replays what it missed. */
  let lastSeq = -1;
  let restarting: Promise<unknown> | null = null;
  const seen = new Set<string>();

  const closeSource = () => {
    source?.close();
    source = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const fail = (err: Error) => {
    if (stopped) return;
    stopped = true;
    closeSource();
    onError?.(err);
  };

  /** Server watching is off although we want it (server restarted): turn it on again. */
  const restart = () => {
    restarting ??= setWatching(true)
      .then((st) => {
        if (!st.available) fail(new Error('This computer has no Downloads folder to watch.'));
      })
      .catch((err: unknown) => fail(err instanceof Error ? err : new Error(String(err))))
      .finally(() => {
        restarting = null;
      });
  };

  const lostConnection = () =>
    new Error('Lost the connection to the Mode server, so the Downloads folder is no longer watched. Turn it on again once the server is running.');

  const retryLater = () => {
    const delay = Math.min(retryDelayMs * 2 ** manualRetries++, 30_000);
    retryTimer = setTimeout(() => void connect(), delay);
  };

  /** A failed request while (re)connecting: keep trying while the server is down (within the window), give up on a refusal. */
  const retryOrFail = (err: unknown) => {
    if (stopped) return;
    failingSince ??= Date.now();
    if (Date.now() - failingSince > reconnectWindowMs) {
      fail(lostConnection());
      return;
    }
    // Server down or restarting (no answer, or a dev proxy's 5xx): keep trying; refusals end it.
    if (err instanceof ApiError && err.code === 'network' && (err.status === 0 || err.status >= 500)) retryLater();
    else fail(err instanceof Error ? err : new Error(String(err)));
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    const params = new URLSearchParams();
    if (readToken()) {
      // A fresh single-use ticket per connection (the token itself stays out of the URL).
      let ticket: string;
      try {
        ticket = await fetchEventsTicket();
      } catch (err) {
        retryOrFail(err);
        return;
      }
      if (stopped) return;
      params.set('ticket', ticket);
    }
    if (lastSeq >= 0) params.set('since', String(lastSeq));
    const query = params.toString();
    const es = new ES(query ? `${API_PATHS.handoffEvents}?${query}` : API_PATHS.handoffEvents);
    source = es;

    es.addEventListener('ready', (e) => {
      failingSince = null;
      manualRetries = 0;
      const st = parseObject((e as MessageEvent<string>).data);
      if (st.available === false) fail(new Error('This computer has no Downloads folder to watch.'));
      else if (st.on === false) restart();
    });
    es.addEventListener('file', (e) => {
      const msg = e as MessageEvent<string>;
      const seq = Number(msg.lastEventId);
      if (Number.isInteger(seq) && seq > lastSeq) lastSeq = seq;
      const file = parseFile(msg.data);
      if (!file || seen.has(file.id)) return;
      seen.add(file.id);
      onFile(file);
    });
    es.addEventListener('stopped', (e) => {
      const d = parseObject((e as MessageEvent<string>).data);
      fail(new Error(typeof d.message === 'string' && d.message ? d.message : 'Watching the Downloads folder stopped.'));
    });
    es.onerror = () => {
      if (stopped || source !== es) return;
      failingSince ??= Date.now();
      if (Date.now() - failingSince > reconnectWindowMs) {
        fail(lostConnection());
        return;
      }
      // CONNECTING: the browser retries by itself (with a ticket that is used
      // up, so a token-guarded server answers 401 and the stream goes CLOSED).
      // CLOSED: an HTTP error (or a non-stream answer) — find out why, then
      // re-create the stream with a fresh ticket, or give up.
      if (es.readyState !== ES.CLOSED) return;
      closeSource();
      handoffWatchStatus().then(
        (st) => {
          if (stopped) return;
          if (!st.available) {
            fail(new Error('This computer has no Downloads folder to watch.'));
            return;
          }
          retryLater();
        },
        retryOrFail,
      );
    };
  };

  const started = setWatching(true).then(
    (st) => {
      if (stopped) return;
      if (!st.available) fail(new Error('This computer has no Downloads folder to watch.'));
      else void connect();
    },
    (err: unknown) => fail(err instanceof Error ? err : new Error(String(err))),
  );

  return () => {
    if (stopped) return;
    stopped = true;
    closeSource();
    // After the {on:true} answer, so the two can't cross. The server keeps
    // watching while another window's stream is still listening.
    void started.finally(() => setWatching(false, { keepalive: true }).catch(() => undefined));
  };
}

export async function fetchDownloadedFile(id: string, signal?: AbortSignal): Promise<Blob> {
  const res = await request(
    `${API_PATHS.handoffFile}?id=${encodeURIComponent(id)}`,
    { method: 'GET', accept: 'image/*' },
    HANDOFF_TIMEOUTS_MS.file,
    'Reading the downloaded image',
    signal,
  );
  return res.blob();
}

/** Server-side fetch of a dragged image URL (https only, SSRF-guarded, image/* ≤ 15 MB). */
export async function fetchImageUrl(url: string, signal?: AbortSignal): Promise<Blob> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ApiError('bad_request', 'That is not a valid image link.', 0);
  }
  if (parsed.protocol !== 'https:') {
    throw new ApiError('bad_request', 'Only https image links can be imported. Download the image, then drop or paste the file.', 0);
  }
  const res = await request(
    API_PATHS.handoffFetchUrl,
    { method: 'POST', json: { url: parsed.href }, accept: 'image/*' },
    HANDOFF_TIMEOUTS_MS.fetchUrl,
    'Downloading the image',
    signal,
  );
  return res.blob();
}
