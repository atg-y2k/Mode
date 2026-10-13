import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_PATHS } from '../../shared/api';
import { API_TOKEN_STORAGE_KEY } from './api';
import { fetchDownloadedFile, fetchImageUrl, handoffWatchStatus, watchDownloads, type DownloadedFile } from './handoff';

type Call = { url: string; init: RequestInit | undefined };

function mockFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 0));

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onerror: ((e: Event) => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data: unknown, lastEventId = '') {
    this.readyState = FakeEventSource.OPEN;
    const event = new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  fail(closed: boolean) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.onerror?.(new Event('error'));
  }
}
const ES = FakeEventSource as unknown as typeof EventSource;
const lastSource = () => FakeEventSource.instances.at(-1) as FakeEventSource;

function stubToken(token: string | null) {
  const store = new Map<string, string>(token ? [[API_TOKEN_STORAGE_KEY, token]] : []);
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  stubToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetch helpers', () => {
  it('reads the watcher status with the access token header', async () => {
    stubToken('tok');
    const calls = mockFetch(() => json({ available: true, dir: '~/Downloads', on: false }));
    expect(await handoffWatchStatus()).toEqual({ available: true, dir: '~/Downloads' });
    expect(calls[0].url).toBe(API_PATHS.handoffWatch);
    expect((calls[0].init?.headers as Record<string, string>)['x-mode-token']).toBe('tok');
  });

  it('explains an old server, refused tokens and an unreachable server', async () => {
    mockFetch(() => new Response('Not found', { status: 404 }));
    await expect(handoffWatchStatus()).rejects.toThrow(/doesn't have the hand-off helpers/);
    mockFetch(() => json({ error: { code: 'unauthorized', message: 'The access token was not accepted.' } }, 401));
    await expect(handoffWatchStatus()).rejects.toMatchObject({ code: 'unauthorized', message: 'The access token was not accepted.', status: 401 });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(handoffWatchStatus()).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('downloads an announced file as a Blob', async () => {
    const calls = mockFetch(() => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }));
    const blob = await fetchDownloadedFile('abc_DEF-123');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(4);
    expect(calls[0].url).toBe(`${API_PATHS.handoffFile}?id=abc_DEF-123`);
    mockFetch(() => json({ error: { code: 'bad_request', message: 'That file is no longer available.' } }, 404));
    await expect(fetchDownloadedFile('gone')).rejects.toThrow('That file is no longer available.');
  });

  it('fetches dragged https image URLs through the server', async () => {
    const calls = mockFetch(() => new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } }));
    const blob = await fetchImageUrl('https://lh3.googleusercontent.com/x=s0');
    expect(blob.type).toBe('image/jpeg');
    expect(calls[0].url).toBe(API_PATHS.handoffFetchUrl);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ url: 'https://lh3.googleusercontent.com/x=s0' });
  });

  it('refuses non-https links without a request and passes server messages on', async () => {
    const calls = mockFetch(() => json({ error: { code: 'upstream_error', message: 'That image needs your sign-in to download (the site answered 403).' } }, 502));
    await expect(fetchImageUrl('http://example.com/a.png')).rejects.toMatchObject({ code: 'bad_request' });
    await expect(fetchImageUrl('blob:https://chatgpt.com/123')).rejects.toMatchObject({ code: 'bad_request' });
    await expect(fetchImageUrl('nonsense')).rejects.toThrow(/not a valid image link/);
    expect(calls).toHaveLength(0);
    await expect(fetchImageUrl('https://chatgpt.com/a.png')).rejects.toThrow(/sign-in.*403/);
  });

  it('reports cancellation as an aborted ApiError', async () => {
    mockFetch((_url, init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const c = new AbortController();
    const pending = fetchImageUrl('https://example.com/a.png', c.signal);
    c.abort();
    await expect(pending).rejects.toMatchObject({ aborted: true, name: 'AbortError' });
    await expect(fetchDownloadedFile('x', c.signal)).rejects.toMatchObject({ aborted: true });
  });
});

describe('watchDownloads', () => {
  function watchServer(opts: { on?: boolean; available?: boolean; fail?: Response } = {}) {
    return mockFetch((url, init) => {
      if (url === API_PATHS.handoffWatch && init?.method === 'POST') {
        if (opts.fail) return opts.fail.clone();
        const on = (JSON.parse(String(init.body)) as { on: boolean }).on;
        return json({ available: opts.available ?? true, dir: '~/Downloads', on });
      }
      if (url === API_PATHS.handoffWatch) return json({ available: opts.available ?? true, dir: '~/Downloads', on: opts.on ?? true });
      throw new Error(`unexpected ${url}`);
    });
  }

  it('turns watching on, then streams new files once each', async () => {
    stubToken('tok en');
    const calls = watchServer();
    const files: DownloadedFile[] = [];
    const onError = vi.fn();
    const stop = watchDownloads((f) => files.push(f), onError, { EventSource: ES });
    await flush();
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ on: true });
    const es = lastSource();
    expect(es.url).toBe(`${API_PATHS.handoffEvents}?token=tok+en`);
    es.emit('ready', { available: true, dir: '~/Downloads', on: true });
    es.emit('file', { id: 'a1', name: 'ChatGPT Image.png', size: 1234, mtime: 5 }, '1');
    es.emit('file', { id: 'a1', name: 'ChatGPT Image.png', size: 1234, mtime: 5 }, '1'); // replayed after a reconnect
    es.emit('file', 'not json', '2');
    es.emit('file', { id: 'b2', name: 'Gemini_Generated_Image.png', size: 99, mtime: 6 }, '3');
    expect(files.map((f) => f.id)).toEqual(['a1', 'b2']);
    expect(files[0]).toEqual({ id: 'a1', name: 'ChatGPT Image.png', size: 1234, mtime: 5 });

    stop();
    expect(es.readyState).toBe(FakeEventSource.CLOSED);
    await flush();
    const off = calls.at(-1);
    expect(JSON.parse(String(off?.init?.body))).toEqual({ on: false });
    expect(off?.init?.keepalive).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    stop(); // idempotent
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(2);
  });

  it('reports the server stopping (e.g. 30 minutes idle) once and closes the stream', async () => {
    const calls = watchServer();
    const onError = vi.fn();
    const stop = watchDownloads(() => undefined, onError, { EventSource: ES });
    await flush();
    const es = lastSource();
    es.emit('ready', { available: true, on: true });
    es.emit('stopped', { reason: 'idle', message: 'Stopped watching the Downloads folder after 30 minutes without activity.' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/30 minutes/);
    expect(es.readyState).toBe(FakeEventSource.CLOSED);
    stop();
    await flush();
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1); // no {on:false} after the server stopped
  });

  it('turns watching back on when a reconnect finds it off (server restarted)', async () => {
    const calls = watchServer();
    watchDownloads(() => undefined, vi.fn(), { EventSource: ES });
    await flush();
    const es = lastSource();
    es.fail(false); // browser reconnects by itself…
    es.emit('ready', { available: true, on: false }); // …to a fresh server
    await flush();
    expect(calls.filter((c) => c.init?.method === 'POST').map((c) => JSON.parse(String(c.init?.body)).on)).toEqual([true, true]);
  });

  it('re-creates a stream the browser gave up on, asking for missed files', async () => {
    const calls = watchServer();
    const files: string[] = [];
    watchDownloads((f) => files.push(f.id), vi.fn(), { EventSource: ES, retryDelayMs: 1 });
    await flush();
    const first = lastSource();
    first.emit('ready', { available: true, on: true });
    first.emit('file', { id: 'x', name: 'a.png', size: 1, mtime: 1 }, '7');
    first.fail(true); // HTTP error → CLOSED
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => c.url === API_PATHS.handoffWatch && c.init?.method === 'GET')).toBe(true);
    const second = lastSource();
    expect(second).not.toBe(first);
    expect(second.url).toBe(`${API_PATHS.handoffEvents}?since=7`);
    second.emit('file', { id: 'x', name: 'a.png', size: 1, mtime: 1 }, '7');
    second.emit('file', { id: 'y', name: 'b.png', size: 1, mtime: 2 }, '8');
    expect(files).toEqual(['x', 'y']);
  });

  it('keeps retrying while a dev proxy reports the server down (5xx), then fails on a refusal', async () => {
    let statusAnswer: () => Response = () => new Response('proxy error', { status: 502 });
    const calls = mockFetch((_url, init) => {
      if (init?.method === 'POST') return json({ available: true, on: true });
      return statusAnswer();
    });
    const onError = vi.fn();
    watchDownloads(() => undefined, onError, { EventSource: ES, retryDelayMs: 1 });
    await flush();
    lastSource().fail(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(onError).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(2);
    statusAnswer = () => json({ error: { code: 'unauthorized', message: 'The access token was not accepted.' } }, 401);
    lastSource().fail(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('The access token was not accepted.');
    expect(calls.filter((c) => c.init?.method !== 'POST')).toHaveLength(2);
  });

  it('gives up when the server stays unreachable past the reconnect window', async () => {
    watchServer();
    const onError = vi.fn();
    watchDownloads(() => undefined, onError, { EventSource: ES, reconnectWindowMs: 30 });
    await flush();
    const es = lastSource();
    es.fail(false);
    expect(onError).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 40));
    es.fail(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/Lost the connection/);
  });

  it('reports a server that cannot watch (no folder, refused) without opening a stream', async () => {
    watchServer({ fail: json({ error: { code: 'bad_request', message: 'This computer has no Downloads folder to watch.' } }, 409) });
    const onError = vi.fn();
    watchDownloads(() => undefined, onError, { EventSource: ES });
    await flush();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/no Downloads folder/);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('stopping before the server answered never opens a stream, and turns watching off after it', async () => {
    const calls = watchServer();
    const stop = watchDownloads(() => undefined, vi.fn(), { EventSource: ES });
    stop();
    for (let i = 0; i < 5; i++) await flush();
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(calls.map((c) => JSON.parse(String(c.init?.body)).on)).toEqual([true, false]);
  });

  it('throws right away when the browser has no EventSource', () => {
    vi.stubGlobal('EventSource', undefined);
    expect(() => watchDownloads(() => undefined)).toThrow(/live updates/);
  });
});
