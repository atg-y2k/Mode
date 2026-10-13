/**
 * SSRF-safe outbound fetches for user-supplied URLs (pasted product links and
 * product images).
 *
 * - http/https only, default ports only, no credentials in the URL, no
 *   "localhost"-style names.
 * - Every address the host resolves to must be public: loopback, private,
 *   link-local, CGNAT, multicast, reserved, documentation and IPv6 equivalents
 *   (incl. IPv4-mapped / NAT64 / 6to4 embeddings) are refused.
 * - The default transport (node:http/https) connects through a `lookup` hook
 *   that performs that check, so the connection is pinned to a vetted address
 *   (no DNS-rebinding window between the check and the connect).
 * - Redirects are followed manually (each hop re-checked), total time and body
 *   size are capped, compressed bodies are capped after decompression.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';

export type SsrfErrorReason = 'scheme' | 'credentials' | 'port' | 'host' | 'private-address' | 'dns' | 'redirect';

export class SsrfError extends Error {
  readonly reason: SsrfErrorReason;
  constructor(reason: SsrfErrorReason, message: string) {
    super(message);
    this.name = 'SsrfError';
    this.reason = reason;
  }
}

export type FetchFailureKind = 'timeout' | 'too-large' | 'network' | 'aborted';

export class FetchFailure extends Error {
  readonly kind: FetchFailureKind;
  constructor(kind: FetchFailureKind, message: string) {
    super(message);
    this.name = 'FetchFailure';
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** Expands an IPv6 address to 8 16-bit groups (handles "::" and an embedded dotted IPv4 tail). */
function ipv6Groups(ip: string): number[] | null {
  let addr = ip.split('%')[0].toLowerCase();
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    if (p.some((n) => n > 255)) return null;
    addr = `${addr.slice(0, -dotted[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** True for any address a server-side fetch must never reach. Unparseable input counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip.split('%')[0]);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family !== 6) return true;
  const g = ipv6Groups(ip);
  if (!g) return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true; // :: and ::1
    return isPrivateAddress(v4FromGroups(g[6], g[7]));
  }
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(v4FromGroups(g[6], g[7]));
  // 6to4 (2002:aabb:ccdd::/48) embeds an IPv4 address.
  if (g[0] === 0x2002) return isPrivateAddress(v4FromGroups(g[1], g[2]));
  const canonical = g.map((x) => x.toString(16)).join(':');
  return blocked.check(canonical, 'ipv6');
}

// ---------------------------------------------------------------------------
// URL checks
// ---------------------------------------------------------------------------

const BLOCKED_HOST_SUFFIXES = ['localhost', '.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp'];

/** Validates scheme, port, credentials and host name; IP literals must be public. Returns the parsed URL. */
export function checkPublicUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = typeof raw === 'string' ? new URL(raw) : raw;
  } catch {
    throw new SsrfError('host', 'That is not a valid web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('scheme', 'Only http and https links are supported.');
  }
  if (url.username || url.password) throw new SsrfError('credentials', 'Links with a user name or password are not supported.');
  if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) {
    throw new SsrfError('port', 'Links to non-standard ports are not supported.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new SsrfError('host', 'That link has no host name.');
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(literal)) {
    if (isPrivateAddress(literal)) throw new SsrfError('private-address', 'Links to private or local network addresses are not allowed.');
    return url;
  }
  if (!host.includes('.') || BLOCKED_HOST_SUFFIXES.some((s) => host === s.replace(/^\./, '') || host.endsWith(s))) {
    throw new SsrfError('host', 'Links to local network names are not allowed.');
  }
  return url;
}

/** Resolves a host to its addresses (all families). */
export type ResolveHost = (hostname: string) => Promise<string[]>;

export const resolveWithDns: ResolveHost = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses.map((a) => a.address));
    });
  });

/** Resolves `hostname` and fails unless every address is public. */
export async function assertPublicHost(hostname: string, resolve: ResolveHost = resolveWithDns): Promise<string[]> {
  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (isIP(literal)) {
    if (isPrivateAddress(literal)) throw new SsrfError('private-address', 'Links to private or local network addresses are not allowed.');
    return [literal];
  }
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new SsrfError('dns', `Couldn't find the website "${hostname}".`);
  }
  if (!addresses.length) throw new SsrfError('dns', `Couldn't find the website "${hostname}".`);
  if (addresses.some(isPrivateAddress)) {
    throw new SsrfError('private-address', 'Links to private or local network addresses are not allowed.');
  }
  return addresses;
}

/**
 * `lookup` hook for node:net: resolves with the system resolver and refuses
 * private addresses, so the socket connects only to a vetted address.
 */
export function createSafeLookup(resolve: ResolveHost = resolveWithDns): LookupFunction {
  return ((hostname: string, options: { all?: boolean; family?: number | string }, callback: (...args: unknown[]) => void) => {
    assertPublicHost(hostname, resolve).then(
      (addresses) => {
        const wantFamily = options.family === 6 || options.family === 'IPv6' ? 6 : options.family === 4 || options.family === 'IPv4' ? 4 : 0;
        const list: LookupAddress[] = addresses
          .map((address) => ({ address, family: isIP(address) }))
          .filter((a) => wantFamily === 0 || a.family === wantFamily);
        if (!list.length) {
          callback(Object.assign(new Error(`No suitable address for ${hostname}`), { code: 'ENOTFOUND' }));
          return;
        }
        if (options.all) callback(null, list);
        else callback(null, list[0].address, list[0].family);
      },
      (err: unknown) => callback(err),
    );
  }) as LookupFunction;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

export interface TransportResponse {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array> | null;
  /** Releases the connection when the body is not read to the end. */
  cancel(): void;
}

export type Transport = (url: URL, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<TransportResponse>;

function decompressed(res: http.IncomingMessage): Readable {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase().trim();
  if (encoding === 'gzip' || encoding === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return res.pipe(zlib.createInflate());
  if (encoding === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

/** node:http(s) transport whose DNS lookups go through `createSafeLookup` (connection pinned to a public address). */
export function createNodeTransport(resolve: ResolveHost = resolveWithDns): Transport {
  const lookup = createSafeLookup(resolve);
  return (url, init) =>
    new Promise<TransportResponse>((resolvePromise, reject) => {
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(
        url,
        { method: 'GET', headers: { ...init.headers, 'accept-encoding': 'gzip, deflate, br' }, lookup, signal: init.signal },
        (res) => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
            else headers.set(key, value);
          }
          const body = decompressed(res);
          body.on('error', () => undefined); // surfaced by the reader
          resolvePromise({
            status: res.statusCode ?? 0,
            headers,
            body: body as AsyncIterable<Uint8Array>,
            cancel: () => {
              res.destroy();
              body.destroy();
            },
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
}

async function* readerIterable(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Transport over a fetch implementation (tests, or hosts that provide their own
 * fetch). Redirects stay manual; DNS is still checked up front by safeFetch but
 * cannot be pinned, so production uses the node transport.
 */
export function createFetchTransport(fetchImpl: typeof fetch): Transport {
  return async (url, init) => {
    const res = await fetchImpl(url.href, { method: 'GET', headers: init.headers, redirect: 'manual', signal: init.signal });
    return {
      status: res.status,
      headers: res.headers,
      body: res.body ? readerIterable(res.body) : null,
      cancel: () => {
        res.body?.cancel().catch(() => undefined);
      },
    };
  };
}

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

export interface SafeFetchOptions {
  /** Accept header. */
  accept: string;
  maxBytes: number;
  /** Total time for all hops and the body (default 10 s). */
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  transport?: Transport;
  /** Resolver used for the up-front host check (default: system DNS). */
  resolveHost?: ResolveHost;
  userAgent?: string;
}

export interface SafeFetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  headers: Headers;
  /** Lowercased media type without parameters, e.g. "text/html". */
  contentType: string;
  body: Buffer;
}

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; ModeHomeStudio/1.0; product link preview)';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function readCapped(body: AsyncIterable<Uint8Array> | null, maxBytes: number, cancel: () => void): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      cancel();
      throw new FetchFailure('too-large', `The response is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
    }
    chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return Buffer.concat(chunks, total);
}

/**
 * GET a user-supplied URL safely. Throws SsrfError for refused targets and
 * FetchFailure for timeouts, oversize bodies and network errors. Non-2xx
 * responses are returned (status set) so callers can decide what "blocked" means.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const transport = opts.transport ?? createNodeTransport(opts.resolveHost);
  const maxRedirects = opts.maxRedirects ?? 4;
  let url = checkPublicUrl(rawUrl);

  const fail = (err: unknown): never => {
    if (err instanceof SsrfError || err instanceof FetchFailure) throw err;
    const cause = (err as { cause?: unknown } | null)?.cause;
    if (cause instanceof SsrfError) throw cause;
    if (timeout.aborted) throw new FetchFailure('timeout', 'The website took too long to respond.');
    if (opts.signal?.aborted) throw new FetchFailure('aborted', 'The request was cancelled.');
    throw new FetchFailure('network', "Couldn't connect to the website.");
  };

  for (let hop = 0; ; hop++) {
    try {
      await assertPublicHost(url.hostname, opts.resolveHost);
    } catch (err) {
      return fail(err);
    }
    let res: TransportResponse;
    try {
      res = await transport(url, {
        headers: {
          accept: opts.accept,
          'accept-language': 'en-US,en;q=0.9',
          'user-agent': opts.userAgent ?? DEFAULT_USER_AGENT,
        },
        signal,
      });
    } catch (err) {
      return fail(err);
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      res.cancel();
      const location = res.headers.get('location');
      if (!location) throw new FetchFailure('network', 'The website sent a redirect without a target.');
      if (hop >= maxRedirects) throw new SsrfError('redirect', 'The link redirects too many times.');
      try {
        url = checkPublicUrl(new URL(location, url));
      } catch (err) {
        return fail(err);
      }
      continue;
    }

    let body: Buffer;
    try {
      body = await readCapped(res.body, opts.maxBytes, res.cancel);
    } catch (err) {
      return fail(err);
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return { url: url.href, status: res.status, headers: res.headers, contentType, body };
  }
}
