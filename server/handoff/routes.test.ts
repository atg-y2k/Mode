import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_PATHS, ApiErrorBodySchema } from '../../shared/api';
import { createApp } from '../app';
import { testConfig } from '../config';
import { registerHandoffRoutes, type HandoffDeps } from './routes';
import { JPEG_BYTES, PNG_BYTES, fakeWatchFactory, waitFor, type FakeFsWatcher } from './testing';
import { DownloadsWatcher } from './watcher';

let dir: string;
let watcher: DownloadsWatcher;
let factory: ReturnType<typeof fakeWatchFactory>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mode-handoff-routes-'));
  factory = fakeWatchFactory();
  watcher = new DownloadsWatcher({ dir, watchFactory: factory, graceMs: 30, log: () => undefined });
});

afterEach(async () => {
  await watcher.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeApp(overrides: Partial<HandoffDeps> = {}) {
  const app = new Hono();
  registerHandoffRoutes(app, { watcher, accessTokenRequired: false, isLocalRequest: () => true, log: () => undefined, ...overrides });
  return app;
}

const post = (app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

/** Reads SSE frames from a streaming response body. */
function sseReader(res: Response) {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(timeoutMs = 2_000): Promise<{ event?: string; data?: string; id?: string; retry?: string; comment?: string } | null> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const split = buffer.indexOf('\n\n');
        if (split >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const out: Record<string, string> = {};
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) out.comment = line.slice(1).trim();
            else {
              const i = line.indexOf(':');
              out[line.slice(0, i)] = line.slice(i + 1).trim();
            }
          }
          return out;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('sse: timed out');
        const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), remaining))]);
        if (chunk === null) throw new Error('sse: timed out');
        if (chunk.done) return null;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

const fsw = (): FakeFsWatcher => factory.instances.at(-1) as FakeFsWatcher;

async function dropFile(name: string, bytes: Buffer) {
  writeFileSync(join(dir, name), bytes);
  fsw().fire('add', join(dir, name));
}

describe('watch status and on/off', () => {
  it('reports availability, starts and stops watching', async () => {
    const app = makeApp();
    expect(await (await app.request(API_PATHS.handoffWatch)).json()).toMatchObject({ available: true, on: false });
    const on = await post(app, API_PATHS.handoffWatch, { on: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ available: true, on: true });
    expect(watcher.on).toBe(true);
    const off = await post(app, API_PATHS.handoffWatch, { on: false });
    expect(await off.json()).toMatchObject({ on: false });
    expect(fsw().closed).toBe(true);
  });

  it('says how to grant access when macOS blocks the Downloads folder (EPERM)', async () => {
    let listed = 0;
    const blocked = new DownloadsWatcher({
      dir,
      watchFactory: factory,
      platform: 'darwin',
      probeDir: () => {
        listed++;
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      },
      log: () => undefined,
    });
    const app = new Hono();
    registerHandoffRoutes(app, { watcher: blocked, accessTokenRequired: false, isLocalRequest: () => true, log: () => undefined });
    // The passive GET doesn't list the folder: macOS asks for Downloads access only once the user turns watching on.
    const status = (await (await app.request(API_PATHS.handoffWatch)).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ available: true, on: false });
    expect(listed).toBe(0);
    const res = await post(app, API_PATHS.handoffWatch, { on: true });
    expect(res.status).toBe(409);
    expect(ApiErrorBodySchema.parse(await res.json()).error.message).toMatch(/System Settings → Privacy & Security → Files & Folders/);
    expect(listed).toBe(1);
    expect(blocked.on).toBe(false);
    expect(factory.instances).toHaveLength(0);
    // Turning it off again doesn't list it either.
    expect(await (await post(app, API_PATHS.handoffWatch, { on: false })).json()).toMatchObject({ on: false });
    expect(listed).toBe(1);
    await blocked.close();
  });

  it('validates the body and refuses other methods', async () => {
    const app = makeApp();
    const bad = await post(app, API_PATHS.handoffWatch, { on: 'yes' });
    expect(bad.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await bad.json()).error.code).toBe('bad_request');
    const put = await app.request(API_PATHS.handoffWatch, { method: 'PUT' });
    expect(put.status).toBe(405);
    expect((await app.request(API_PATHS.handoffFetchUrl)).status).toBe(405);
  });

  it('explains a missing Downloads folder', async () => {
    rmSync(dir, { recursive: true, force: true });
    const app = makeApp();
    const status = (await (await app.request(API_PATHS.handoffWatch)).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ available: false, dir: null, on: false });
    expect(status.reason).toMatch(/doesn't exist any more.*HANDOFF_WATCH_DIR/);
    const res = await post(app, API_PATHS.handoffWatch, { on: true });
    expect(res.status).toBe(409);
    expect(ApiErrorBodySchema.parse(await res.json()).error.message).toMatch(/HANDOFF_WATCH_DIR/);
  });

  it('keeps the watcher to this computer unless an access token guards the server', async () => {
    const remote = makeApp({ isLocalRequest: () => false });
    const remoteStatus = (await (await remote.request(API_PATHS.handoffWatch)).json()) as Record<string, unknown>;
    expect(remoteStatus).toMatchObject({ available: false, dir: null, on: false });
    expect(remoteStatus.reason).toMatch(/computer running Mode/);
    for (const res of [
      await post(remote, API_PATHS.handoffWatch, { on: true }),
      await remote.request(API_PATHS.handoffEvents),
      await remote.request(`${API_PATHS.handoffFile}?id=${'a'.repeat(24)}`),
    ]) {
      expect(res.status).toBe(403);
      expect(ApiErrorBodySchema.parse(await res.json()).error.message).toMatch(/computer running Mode/);
    }
    expect(watcher.on).toBe(false);
    const tokenServer = makeApp({ isLocalRequest: () => false, accessTokenRequired: true });
    expect((await post(tokenServer, API_PATHS.handoffWatch, { on: true })).status).toBe(200);
  });

  it('uses the socket address by default: loopback only', async () => {
    const app = makeApp({ isLocalRequest: undefined });
    const env = (address: string) => ({ incoming: { socket: { remoteAddress: address } } });
    const local = await app.request(API_PATHS.handoffWatch, {}, env('::ffff:127.0.0.1'));
    expect(await local.json()).toMatchObject({ available: true });
    const lan = await app.request(API_PATHS.handoffWatch, {}, env('192.168.1.20'));
    expect(await lan.json()).toMatchObject({ available: false });
    const unknown = await app.request(API_PATHS.handoffWatch);
    expect(await unknown.json()).toMatchObject({ available: false });
  });
});

describe('events stream and announced files', () => {
  it('streams ready + file events, then serves only announced files', async () => {
    const app = makeApp();
    await post(app, API_PATHS.handoffWatch, { on: true });
    const res = await app.request(API_PATHS.handoffEvents);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const sse = sseReader(res);
    const ready = await sse.next();
    expect(ready?.event).toBe('ready');
    expect(ready?.retry).toBe('3000');
    expect(JSON.parse(ready?.data ?? '{}')).toMatchObject({ available: true, on: true });

    await dropFile('ChatGPT Image.png', PNG_BYTES);
    const file = await sse.next();
    expect(file?.event).toBe('file');
    expect(file?.id).toBe('1');
    const announced = JSON.parse(file?.data ?? '{}') as { id: string; name: string; size: number; mtime: number };
    expect(announced).toMatchObject({ name: 'ChatGPT Image.png', size: PNG_BYTES.length });
    expect(Object.keys(announced).sort()).toEqual(['id', 'mtime', 'name', 'size']); // no paths on the wire

    const bytes = await app.request(`${API_PATHS.handoffFile}?id=${announced.id}`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toBe('image/png');
    expect(bytes.headers.get('content-length')).toBe(String(PNG_BYTES.length));
    expect(Buffer.from(await bytes.arrayBuffer()).equals(PNG_BYTES)).toBe(true);

    // A JPEG saved with a .png name is served as what it is.
    await dropFile('odd.png', JPEG_BYTES);
    const odd = JSON.parse((await sse.next())?.data ?? '{}') as { id: string };
    expect((await app.request(`${API_PATHS.handoffFile}?id=${odd.id}`)).headers.get('content-type')).toBe('image/jpeg');

    // Files that were never announced, or ids that look like paths, are refused.
    writeFileSync(join(dir, 'secret.png'), PNG_BYTES);
    for (const id of ['secret.png', '../secret.png', 'x'.repeat(24), '']) {
      const r = await app.request(`${API_PATHS.handoffFile}?id=${encodeURIComponent(id)}`);
      expect(r.status).toBe(404);
      expect(ApiErrorBodySchema.parse(await r.json()).error.code).toBe('bad_request');
    }
    await sse.cancel();
  });

  it('reports a deleted announced file clearly', async () => {
    const app = makeApp();
    await post(app, API_PATHS.handoffWatch, { on: true });
    const events: string[] = [];
    watcher.subscribe((e) => e.type === 'file' && events.push(e.file.id));
    await dropFile('gone.png', PNG_BYTES);
    const id = await waitFor(() => events[0]);
    rmSync(join(dir, 'gone.png'));
    const res = await app.request(`${API_PATHS.handoffFile}?id=${id}`);
    expect(res.status).toBe(404);
    expect(ApiErrorBodySchema.parse(await res.json()).error.message).toMatch(/moved or deleted/);
  });

  it('sends stopped and ends the stream when watching stops', async () => {
    const app = makeApp();
    await post(app, API_PATHS.handoffWatch, { on: true });
    const sse = sseReader(await app.request(API_PATHS.handoffEvents));
    await sse.next();
    await watcher.stop('idle');
    const stopped = await sse.next();
    expect(stopped?.event).toBe('stopped');
    expect(JSON.parse(stopped?.data ?? '{}')).toMatchObject({ reason: 'idle' });
    expect(await sse.next()).toBeNull();
  });

  it('stops watching shortly after the last stream disconnects', async () => {
    const app = makeApp();
    await post(app, API_PATHS.handoffWatch, { on: true });
    const sse = sseReader(await app.request(API_PATHS.handoffEvents));
    await sse.next();
    // {on:false} from this tab doesn't cut off a stream that is still connected…
    await post(app, API_PATHS.handoffWatch, { on: false });
    expect(watcher.on).toBe(true);
    // …the disconnect does (after the grace period).
    await sse.cancel();
    await waitFor(() => !watcher.on);
  });

  it('replays missed file events after a reconnect (Last-Event-ID or ?since=)', async () => {
    const app = makeApp();
    await post(app, API_PATHS.handoffWatch, { on: true });
    const keep = watcher.subscribe(() => undefined); // keeps watching while no stream is open
    await dropFile('one.png', PNG_BYTES);
    await dropFile('two.png', PNG_BYTES);
    await waitFor(() => watcher.lastSeq === 2);
    const viaHeader = sseReader(await app.request(API_PATHS.handoffEvents, { headers: { 'Last-Event-ID': '1' } }));
    expect((await viaHeader.next())?.event).toBe('ready');
    const replayed = await viaHeader.next();
    expect(replayed?.id).toBe('2');
    expect(JSON.parse(replayed?.data ?? '{}').name).toBe('two.png');
    await viaHeader.cancel();
    const viaQuery = sseReader(await app.request(`${API_PATHS.handoffEvents}?since=0`));
    await viaQuery.next();
    expect((await viaQuery.next())?.id).toBe('1');
    expect((await viaQuery.next())?.id).toBe('2');
    await viaQuery.cancel();
    keep();
  });

  it('tells a stream when watching is off (e.g. after a server restart)', async () => {
    const app = makeApp();
    const sse = sseReader(await app.request(API_PATHS.handoffEvents));
    const ready = await sse.next();
    expect(JSON.parse(ready?.data ?? '{}')).toMatchObject({ available: true, on: false });
    await sse.cancel();
  });

  it('sends keepalive comments while idle', async () => {
    const app = makeApp({ keepaliveMs: 20 });
    await post(app, API_PATHS.handoffWatch, { on: true });
    const sse = sseReader(await app.request(API_PATHS.handoffEvents));
    await sse.next();
    expect((await sse.next())?.comment).toBe('keepalive');
    await sse.cancel();
  });
});

describe('access token for the event stream (single-use tickets)', () => {
  const TOKEN = 's3cret-token';
  function tokenApp() {
    const lines: string[] = [];
    let now = 1_000_000;
    const app = createApp({
      config: testConfig({ accessToken: TOKEN }),
      claude: null,
      imageProvider: null,
      log: (line) => lines.push(line),
      now: () => now,
      extraRoutes: (api) => {
        registerHandoffRoutes(api, { watcher, accessTokenRequired: true, log: () => undefined });
      },
    });
    const ticket = async (headers: Record<string, string> = { 'x-mode-token': TOKEN }) => {
      const res = await app.request(API_PATHS.handoffEventsTicket, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
      return { res, ticket: res.ok ? ((await res.json()) as { ticket: string }).ticket : null };
    };
    return { app, lines, ticket, advance: (ms: number) => (now += ms) };
  }

  it('issues tickets only with the header, as unguessable, uncached strings', async () => {
    const { ticket } = tokenApp();
    expect((await ticket({})).res.status).toBe(401);
    expect((await ticket({ 'x-mode-token': 'wrong' })).res.status).toBe(401);
    const a = await ticket();
    expect(a.res.status).toBe(200);
    expect(a.res.headers.get('cache-control')).toBe('no-store');
    expect(a.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits, base64url
    const b = await ticket();
    expect(b.ticket).not.toBe(a.ticket);
  });

  it('opens the stream once per ticket; reused, expired, unknown tickets and ?token= get 401', async () => {
    const { app, ticket, advance } = tokenApp();
    const { ticket: t1 } = await ticket();
    const ok = await app.request(`${API_PATHS.handoffEvents}?ticket=${t1}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/text\/event-stream/);
    await ok.body?.cancel();
    // Single use: the browser's own auto-reconnect replays the URL and is refused.
    expect((await app.request(`${API_PATHS.handoffEvents}?ticket=${t1}`)).status).toBe(401);

    const { ticket: t2 } = await ticket();
    advance(60_001);
    expect((await app.request(`${API_PATHS.handoffEvents}?ticket=${t2}`)).status).toBe(401);

    expect((await app.request(`${API_PATHS.handoffEvents}?ticket=${'A'.repeat(43)}`)).status).toBe(401);
    expect((await app.request(`${API_PATHS.handoffEvents}?ticket=`)).status).toBe(401);
    expect((await app.request(API_PATHS.handoffEvents)).status).toBe(401);
    // The long-lived token is never accepted in a URL.
    expect((await app.request(`${API_PATHS.handoffEvents}?token=${TOKEN}`)).status).toBe(401);
    expect((await app.request(`${API_PATHS.handoffWatch}?token=${TOKEN}`)).status).toBe(401);
    // The header still works on the stream.
    const header = await app.request(API_PATHS.handoffEvents, { headers: { 'x-mode-token': TOKEN } });
    expect(header.status).toBe(200);
    await header.body?.cancel();
  });

  it('only opens GET /api/handoff/events: other paths and methods refuse a ticket', async () => {
    const { app, ticket } = tokenApp();
    const { ticket: t } = await ticket();
    expect((await app.request(`${API_PATHS.handoffWatch}?ticket=${t}`)).status).toBe(401);
    expect((await app.request(`${API_PATHS.handoffFile}?id=${'a'.repeat(20)}&ticket=${t}`)).status).toBe(401);
    expect((await app.request(`${API_PATHS.handoffEvents}?ticket=${t}`, { method: 'POST' })).status).toBe(401);
    expect((await app.request(`${API_PATHS.handoffEventsTicket}?ticket=${t}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    // Still valid for the stream itself (unused so far).
    const ok = await app.request(`${API_PATHS.handoffEvents}?ticket=${t}`);
    expect(ok.status).toBe(200);
    await ok.body?.cancel();
  });

  it('lets a header win, keeps ?since= working next to ?ticket= and keeps secrets out of the log', async () => {
    const { app, lines, ticket } = tokenApp();
    const { ticket: t } = await ticket();
    // A header, when sent, is what counts (a wrong one is not rescued by a valid ticket).
    expect((await app.request(`${API_PATHS.handoffEvents}?ticket=${t}`, { headers: { 'x-mode-token': 'nope' } })).status).toBe(401);
    const replay = await app.request(`${API_PATHS.handoffEvents}?since=0&ticket=${t}`);
    expect(replay.status).toBe(200);
    await replay.body?.cancel();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain(t);
  });

  it('keeps at most 64 outstanding tickets (oldest evicted)', async () => {
    const { app, ticket } = tokenApp();
    const first = (await ticket()).ticket;
    for (let i = 0; i < 64; i++) await ticket();
    expect((await app.request(`${API_PATHS.handoffEvents}?ticket=${first}`)).status).toBe(401);
  });
});

describe('fetch-url', () => {
  const PUBLIC_IP = '93.184.216.34';
  function urlApp(handler: (url: string) => Response | Promise<Response>) {
    const calls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      return handler(url);
    }) as typeof fetch;
    const app = makeApp({ fetchUrl: { fetch: fakeFetch, resolveHost: async () => [PUBLIC_IP] } });
    return { app, calls };
  }

  it('returns the image bytes with the sniffed type', async () => {
    const { app } = urlApp(() => new Response(PNG_BYTES, { headers: { 'content-type': 'application/octet-stream' } }));
    const res = await post(app, API_PATHS.handoffFetchUrl, { url: 'https://lh3.googleusercontent.com/abc=s0' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it('refuses non-https links, private hosts and https→http redirects', async () => {
    const { app, calls } = urlApp((url) =>
      url.includes('redirect') ? new Response(null, { status: 302, headers: { location: 'http://cdn.example.com/a.png' } }) : new Response(PNG_BYTES),
    );
    for (const url of ['http://example.com/a.png', 'ftp://example.com/a.png', 'https://127.0.0.1/a.png', 'https://localhost/a.png', 'https://10.0.0.2/x.png']) {
      const res = await post(app, API_PATHS.handoffFetchUrl, { url });
      expect(res.status, url).toBe(400);
      expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe('bad_request');
    }
    const redirected = await post(app, API_PATHS.handoffFetchUrl, { url: 'https://example.com/redirect' });
    expect(redirected.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await redirected.json()).error.message).toMatch(/https/);
    expect(calls).toEqual(['https://example.com/redirect']);
  });

  it('explains 401/403 (needs the sign-in) and other upstream failures', async () => {
    const { app } = urlApp((url) => new Response('no', { status: url.includes('403') ? 403 : url.includes('401') ? 401 : 404 }));
    for (const code of [401, 403]) {
      const res = await post(app, API_PATHS.handoffFetchUrl, { url: `https://chatgpt.com/backend/${code}.png` });
      expect(res.status).toBe(502);
      const body = ApiErrorBodySchema.parse(await res.json());
      expect(body.error.code).toBe('upstream_error');
      expect(body.error.message).toMatch(new RegExp(`sign-in.*${code}`));
    }
    const missing = await post(app, API_PATHS.handoffFetchUrl, { url: 'https://example.com/404.png' });
    expect(ApiErrorBodySchema.parse(await missing.json()).error.message).toMatch(/HTTP 404/);
  });

  it('refuses SVG / HTML and images over 15 MB', async () => {
    const svg = urlApp(() => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'content-type': 'image/svg+xml' } }));
    const r1 = await post(svg.app, API_PATHS.handoffFetchUrl, { url: 'https://example.com/a.svg' });
    expect(r1.status).toBe(400);
    const big = urlApp(() => new Response(new Uint8Array(15 * 1024 * 1024 + 10)));
    const r2 = await post(big.app, API_PATHS.handoffFetchUrl, { url: 'https://example.com/huge.png' });
    expect(r2.status).toBe(413);
    expect(ApiErrorBodySchema.parse(await r2.json()).error.code).toBe('payload_too_large');
  });

  it('validates the body', async () => {
    const { app } = urlApp(() => new Response(PNG_BYTES));
    expect((await post(app, API_PATHS.handoffFetchUrl, {})).status).toBe(400);
    expect((await post(app, API_PATHS.handoffFetchUrl, { url: 'not a url' })).status).toBe(400);
  });
});
