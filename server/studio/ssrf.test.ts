import { describe, expect, it } from 'vitest';
import {
  FetchFailure,
  SsrfError,
  checkPublicUrl,
  createSafeLookup,
  isPrivateAddress,
  safeFetch,
  type Transport,
  type TransportResponse,
} from './ssrf';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.1',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    '2002:c0a8:101::1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:93.184.216.34'])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('checkPublicUrl', () => {
  it.each([
    ['file:///etc/passwd', 'scheme'],
    ['ftp://example.com/', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['gopher://example.com/', 'scheme'],
    ['http://user:pw@example.com/', 'credentials'],
    ['http://example.com:8080/', 'port'],
    ['http://localhost/', 'host'],
    ['http://printer.local/', 'host'],
    ['http://intranet/', 'host'],
    ['http://127.0.0.1/', 'private-address'],
    ['http://2130706433/', 'private-address'],
    ['http://0x7f.1/', 'private-address'],
    ['http://[::1]/', 'private-address'],
    ['http://169.254.169.254/latest/meta-data', 'private-address'],
  ])('rejects %s (%s)', (url, reason) => {
    try {
      checkPublicUrl(url);
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(SsrfError);
      expect((err as SsrfError).reason).toBe(reason);
    }
  });

  it('accepts ordinary store links', () => {
    expect(checkPublicUrl('https://www.homedepot.com/p/123').hostname).toBe('www.homedepot.com');
    expect(checkPublicUrl('http://example.com:80/x').href).toBe('http://example.com/x');
  });
});

function response(status: number, body: string | Uint8Array | null, headers: Record<string, string> = {}): TransportResponse {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    status,
    headers: new Headers(headers),
    body: bytes
      ? (async function* () {
          // two chunks to exercise the size accounting
          const mid = Math.floor(bytes.length / 2);
          yield bytes.subarray(0, mid);
          yield bytes.subarray(mid);
        })()
      : null,
    cancel: () => undefined,
  };
}

function transport(map: Record<string, () => TransportResponse>): { transport: Transport; hits: string[] } {
  const hits: string[] = [];
  return {
    hits,
    transport: async (url) => {
      hits.push(url.href);
      const h = map[url.href];
      if (!h) throw new Error(`unexpected ${url.href}`);
      return h();
    },
  };
}

const publicDns = async () => ['93.184.216.34'];

describe('safeFetch', () => {
  it('fetches public pages and follows safe redirects', async () => {
    const t = transport({
      'https://shop.example.com/a': () => response(301, null, { location: '/b' }),
      'https://shop.example.com/b': () => response(200, '<html>ok</html>', { 'content-type': 'text/html; charset=utf-8' }),
    });
    const res = await safeFetch('https://shop.example.com/a', { accept: 'text/html', maxBytes: 1000, transport: t.transport, resolveHost: publicDns });
    expect(res.url).toBe('https://shop.example.com/b');
    expect(res.contentType).toBe('text/html');
    expect(res.body.toString()).toBe('<html>ok</html>');
  });

  it('refuses hosts resolving to private addresses before connecting', async () => {
    const t = transport({});
    await expect(
      safeFetch('https://rebind.example.com/', { accept: '*/*', maxBytes: 1000, transport: t.transport, resolveHost: async () => ['93.184.216.34', '10.0.0.5'] }),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(t.hits).toHaveLength(0);
  });

  it('refuses redirects into private networks or other schemes', async () => {
    const t = transport({
      'https://shop.example.com/a': () => response(302, null, { location: 'http://169.254.169.254/latest/meta-data' }),
      'https://shop.example.com/c': () => response(302, null, { location: 'file:///etc/passwd' }),
    });
    await expect(safeFetch('https://shop.example.com/a', { accept: '*/*', maxBytes: 1000, transport: t.transport, resolveHost: publicDns })).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetch('https://shop.example.com/c', { accept: '*/*', maxBytes: 1000, transport: t.transport, resolveHost: publicDns })).rejects.toBeInstanceOf(SsrfError);
  });

  it('caps redirects and body size', async () => {
    const loop = transport({ 'https://shop.example.com/loop': () => response(302, null, { location: '/loop' }) });
    await expect(
      safeFetch('https://shop.example.com/loop', { accept: '*/*', maxBytes: 1000, maxRedirects: 2, transport: loop.transport, resolveHost: publicDns }),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(loop.hits).toHaveLength(3);

    const big = transport({ 'https://shop.example.com/big': () => response(200, new Uint8Array(5000)) });
    const err = await safeFetch('https://shop.example.com/big', { accept: '*/*', maxBytes: 1000, transport: big.transport, resolveHost: publicDns }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect((err as FetchFailure).kind).toBe('too-large');
  });

  it('times out slow servers', async () => {
    const slow: Transport = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const err = await safeFetch('https://slow.example.com/', { accept: '*/*', maxBytes: 1000, timeoutMs: 30, transport: slow, resolveHost: publicDns }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect((err as FetchFailure).kind).toBe('timeout');
  });
});

describe('createSafeLookup (connection pinning)', () => {
  const run = (lookup: ReturnType<typeof createSafeLookup>, all: boolean) =>
    new Promise<{ err: unknown; address: unknown; family?: number }>((resolve) => {
      (lookup as unknown as (h: string, o: object, cb: (err: unknown, address?: unknown, family?: number) => void) => void)(
        'shop.example.com',
        { all },
        (err, address, family) => resolve({ err, address, family }),
      );
    });

  it('returns vetted public addresses', async () => {
    const one = await run(createSafeLookup(async () => ['93.184.216.34', '2606:4700::1']), false);
    expect(one).toEqual({ err: null, address: '93.184.216.34', family: 4 });
    const all = await run(createSafeLookup(async () => ['93.184.216.34', '2606:4700::1']), true);
    expect(all.address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1', family: 6 },
    ]);
  });

  it('fails the connection when any address is private', async () => {
    const res = await run(createSafeLookup(async () => ['127.0.0.1']), false);
    expect(res.err).toBeInstanceOf(SsrfError);
  });
});
