/**
 * POST /api/handoff/fetch-url: downloads an image the user dragged in from
 * the ChatGPT / Gemini tab (the drop often carries only the image's URL).
 * The browser can't fetch it itself (CORS), so the server does — for public
 * https URLs only:
 * - every hop must be https (the transport refuses http redirects too) and
 *   pass the SSRF guard in server/studio/ssrf.ts (public addresses only,
 *   connection pinned to the vetted address);
 * - the bytes must be a JPEG, PNG, WebP, GIF or AVIF image (sniffed; SVG and
 *   anything else is refused) of at most 15 MB;
 * - 401 / 403 means the image needs the user's login cookies, which a server
 *   fetch never has: the message says to copy or download it instead.
 */
import { ApiHttpError } from '../errors';
import {
  FetchFailure,
  SsrfError,
  createFetchTransport,
  createNodeTransport,
  safeFetch,
  type ResolveHost,
  type Transport,
} from '../studio/ssrf';
import { sniffImageMime, type SniffedImageMime } from '../studio/util';

export const FETCH_URL_MAX_BYTES = 15 * 1024 * 1024;
export const FETCH_URL_TIMEOUT_MS = 25_000;
const IMAGE_TYPES = new Set<SniffedImageMime>(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const USER_AGENT = 'Mozilla/5.0 (compatible; ModeHomeStudio/1.0; image import)';

export interface FetchUrlDeps {
  /** Network for tests (DNS is still checked up front but not pinned). Default: pinned node http(s). */
  fetch?: typeof fetch;
  /** DNS resolver for the SSRF host check (tests). */
  resolveHost?: ResolveHost;
}

/** Wraps a transport so every hop (including redirects) must be https. */
export function httpsOnly(transport: Transport): Transport {
  return (url, init) => {
    if (url.protocol !== 'https:') {
      return Promise.reject(new SsrfError('scheme', 'Only https image links can be imported.'));
    }
    return transport(url, init);
  };
}

const LOGIN_HINT = 'Use Copy image or Download in ChatGPT / Gemini, then paste or drop the file into Mode.';

/** Fetches an https image URL safely. Throws ApiHttpError with a message for the person using Mode. */
export async function fetchImageFromUrl(
  rawUrl: string,
  deps: FetchUrlDeps = {},
  signal?: AbortSignal,
): Promise<{ mime: SniffedImageMime; bytes: Buffer; url: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new ApiHttpError('bad_request', 'That is not a valid image link.', 400);
  }
  if (parsed.protocol !== 'https:') {
    throw new ApiHttpError(
      'bad_request',
      parsed.protocol === 'http:' ? 'Only https image links can be imported.' : `“${parsed.protocol}” links can't be fetched by the server. ${LOGIN_HINT}`,
      400,
    );
  }
  const base = deps.fetch ? createFetchTransport(deps.fetch) : createNodeTransport(deps.resolveHost);
  let res;
  try {
    res = await safeFetch(parsed.href, {
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
      maxBytes: FETCH_URL_MAX_BYTES,
      timeoutMs: FETCH_URL_TIMEOUT_MS,
      signal,
      transport: httpsOnly(base),
      resolveHost: deps.resolveHost,
      userAgent: USER_AGENT,
    });
  } catch (err) {
    if (err instanceof SsrfError) {
      throw new ApiHttpError('bad_request', err.reason === 'scheme' ? 'Only https image links can be imported.' : err.message, 400);
    }
    if (err instanceof FetchFailure) {
      if (err.kind === 'too-large') throw new ApiHttpError('payload_too_large', 'That image is larger than 15 MB.', 413);
      if (err.kind === 'aborted') throw new ApiHttpError('bad_request', 'The request was cancelled.', 499);
      throw new ApiHttpError(
        'upstream_error',
        err.kind === 'timeout' ? 'The image took too long to download.' : `Couldn't download that image. ${LOGIN_HINT}`,
        502,
      );
    }
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiHttpError(
      'upstream_error',
      `That image needs your sign-in to download (the site answered ${res.status}). ${LOGIN_HINT}`,
      502,
    );
  }
  if (res.status < 200 || res.status >= 300) {
    throw new ApiHttpError('upstream_error', `The site refused the image download (HTTP ${res.status}). ${LOGIN_HINT}`, 502);
  }
  // The bytes decide: CDNs often label images application/octet-stream; SVG and HTML are refused.
  const mime = sniffImageMime(res.body.subarray(0, 32));
  if (!mime || !IMAGE_TYPES.has(mime)) {
    throw new ApiHttpError('bad_request', 'That link is not a JPEG, PNG, WebP, GIF or AVIF image.', 400);
  }
  return { mime, bytes: res.body, url: res.url };
}
