/**
 * Mode API server (Hono). `createApp(deps)` builds the whole app so tests can
 * inject a fake Claude client, a fake image provider and a catalog summary,
 * and run without network access or keys.
 *
 * Routes (see shared/api.ts):
 *   GET  /api/health          AI + image provider status (never needs a token)
 *   POST /api/analyze         Claude vision: describe a photo of a space
 *   POST /api/suggest         Claude vision: propose a full design option
 *   POST /api/asset-list      Claude: complete & price the shopping list
 *   POST /api/generate-asset  Claude SVG drawing, or image-provider cut-out photo
 *   POST /api/render          Claude edit prompt + image-provider photoreal render
 *   POST /api/handoff/events-ticket  single-use ticket for the hand-off event stream
 *
 * Every request must name this server in its Host header (DNS-rebinding
 * guard, see isAllowedHostName), and every /api request other than GET / HEAD
 * / OPTIONS must be same-origin JSON (CSRF guard, see checkSameOriginJson).
 * In production the built web app is served from `config.staticDir` with an
 * SPA fallback to index.html, cross-origin isolated (COOP same-origin + COEP
 * credentialless on HTML and JS) so in-browser vision models can use threads.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { hostname as machineHostname } from 'node:os';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import {
  API_PATHS,
  AnalyzeRequestSchema,
  ApiErrorBodySchema,
  AssetListRequestSchema,
  AssetListResultSchema,
  DesignSuggestionSchema,
  GenerateAssetRequestSchema,
  MAX_BODY_BYTES,
  RenderRequestSchema,
  SpaceAnalysisResultSchema,
  SuggestRequestSchema,
  type ApiErrorCode,
  type GenerateAssetRequest,
  type GeneratedAsset,
  type HealthResponse,
  type RenderResponse,
} from '../shared/api';
import { loadBuiltinCatalog, type CatalogAccess } from './catalog';
import {
  createAnthropicClient,
  createClaudeService,
  type ClaudeClientLike,
  type ClaudeService,
  type ClaudeUsage,
  type StructuredCall,
} from './claude';
import { IMAGE_PROVIDER_LABELS, type ServerConfig } from './config';
import { parseImageDataUrl, toDataUrl, type ImageData64 } from './dataUrl';
import { ApiHttpError, STATUS_CLIENT_CLOSED, aiDisabled, badRequest, imageProviderDisabled, redact } from './errors';
import { clientAddress, isJsonContentType, notJsonError } from './handoff/http';
import { createImageProvider, type ImageProvider } from './imageProvider';
import { trimTransparentPng } from './png';
import {
  postprocessAnalysis,
  postprocessAssetList,
  postprocessAssetMeta,
  postprocessSuggestion,
  type CatalogIndex,
} from './postprocess';
import {
  analyzePrompt,
  assetListPrompt,
  buildSystemPrompt,
  fallbackAssetMeta,
  photoAssetImagePrompt,
  photoAssetPlanPrompt,
  renderPromptRequest,
  suggestPrompt,
  templateRenderPrompt,
  vectorAssetPrompt,
} from './prompts';
import { createRateLimiter } from './rateLimit';
import { PhotoAssetPlanSchema, RenderPromptSchema, VectorAssetOutputSchema } from './schemas';
import { MAX_SVG_BYTES, SvgSanitizeError, sanitizeSvg } from './svgSanitize';

export interface AppDeps {
  config: ServerConfig;
  /**
   * Claude client (an Anthropic SDK instance or a test fake). Omitted: created
   * from the config when AI is enabled. `null`: AI disabled.
   */
  claude?: ClaudeClientLike | null;
  /** Omitted: created from the config. `null`: no image provider. */
  imageProvider?: ImageProvider | null;
  /** Catalog summary text for the system prompt (tests); ids are then not validated. */
  catalogSummary?: string;
  /** Full catalog access (summary + id validation). Default: src/assets/catalog, loaded lazily. */
  catalog?: CatalogAccess;
  /** Sink for the one-line-per-request log (default console.log). */
  log?: (line: string) => void;
  /** Clock (ms) for the rate limiter and event-stream tickets (tests). */
  now?: () => number;
  /** This computer's host name for the Host check (default os.hostname(); tests). */
  machineName?: string;
  /**
   * Registers additional routes (e.g. the Studio API) after the shared /api
   * middleware (access token, body limit, logging) and before the /api 404
   * and static fallbacks.
   */
  extraRoutes?: (app: Hono<AppEnv>, ctx: RouteContext) => void;
}

export type AppEnv = { Variables: { errorCode: string; note: string } };

/** Shared services handed to `extraRoutes`. */
export interface RouteContext {
  config: ServerConfig;
  log: (line: string) => void;
  /** Counts one AI call against the client's rate limit; throws a 429 ApiHttpError when over it. */
  consumeAiCall: (c: Context<AppEnv>) => void;
  /** The Claude client in use (lazily created), or null when AI is off. */
  claudeClient: () => ClaudeClientLike | null;
  /** Adds a note (e.g. token usage) to this request's log line. */
  noteForLog: (c: Context<AppEnv>, note: string) => void;
}

const API_ERROR_CODES = new Set<string>(ApiErrorBodySchema.shape.error.shape.code.options);

/** Errors from other server modules that carry an API error code and status (duck-typed). */
function toApiHttpError(err: unknown): ApiHttpError | null {
  if (err instanceof ApiHttpError) return err;
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; status?: unknown; message?: unknown; retryAfterSec?: unknown };
  if (typeof e.code !== 'string' || !API_ERROR_CODES.has(e.code)) return null;
  if (typeof e.status !== 'number' || e.status < 400 || e.status > 599) return null;
  return new ApiHttpError(e.code as ApiErrorCode, typeof e.message === 'string' ? e.message : 'Request failed.', e.status, {
    retryAfterSec: typeof e.retryAfterSec === 'number' ? e.retryAfterSec : null,
  });
}

/** Claude rejects images over 5 MB. */
const CLAUDE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/** Server-side deadlines; the web client waits slightly longer (src/lib/api.ts). */
const DEADLINES = {
  analyze: 175_000,
  suggest: 175_000,
  assetList: 175_000,
  generateAsset: 295_000,
  photoPlan: 90_000,
  render: 295_000,
  renderPrompt: 60_000,
} as const;

interface Deadline {
  signal: AbortSignal;
  timedOut: () => boolean;
}

/** A time limit chained to the request (or to an outer deadline). */
function deadline(parent: AbortSignal | Deadline, ms: number): Deadline {
  const timer = AbortSignal.timeout(ms);
  if (parent instanceof AbortSignal) {
    return { signal: AbortSignal.any([parent, timer]), timedOut: () => timer.aborted };
  }
  return { signal: AbortSignal.any([parent.signal, timer]), timedOut: () => timer.aborted || parent.timedOut() };
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function tokenMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

/**
 * Event-stream tickets. The browser's EventSource can't send request headers,
 * and the long-lived MODE_ACCESS_TOKEN must not travel in a URL (proxies and
 * dev servers log URLs). So the client POSTs /api/handoff/events-ticket with
 * the x-mode-token header and opens GET /api/handoff/events?ticket=… with the
 * answer: 256 random bits, valid once, for 60 s, and only for that stream.
 * Tickets are stored by their SHA-256, so the raw secret is never compared.
 */
const EVENTS_TICKET_TTL_MS = 60_000;
const EVENTS_TICKET_MAX = 64;

// ---- Host check (DNS rebinding) ---------------------------------------------

/** A host name as the Host check compares it: lower case, no IPv6 brackets, no trailing dot. */
export function normalizeHostName(name: string): string {
  return name.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.+$/, '');
}

/** A MODE_ALLOWED_HOSTS entry: "name" matches exactly, ".name" matches name and every subdomain (Vite's allowedHosts). */
function matchesHostEntry(name: string, entry: string): boolean {
  return entry.startsWith('.') ? name === entry.slice(1) || name.endsWith(entry) : name === entry;
}

function inAllowedHosts(name: string, allowedHosts: string[] | true): boolean {
  return Array.isArray(allowedHosts) && allowedHosts.some((entry) => matchesHostEntry(name, entry));
}

function isLoopbackName(name: string): boolean {
  if (name === 'localhost' || name.endsWith('.localhost') || name === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

/**
 * Whether this server answers to `rawName`, the host name of the request URL
 * (built from the Host header). This is the DNS-rebinding guard: a web page on
 * attacker.example whose DNS answer flips to 127.0.0.1 or a LAN address is
 * "same-origin" with this server in the victim's browser, and the browser
 * still sends Host: attacker.example. Allowed:
 * - IP addresses (phones on the LAN; an IP literal can't be rebound);
 * - localhost and *.localhost;
 * - this computer's name, and that name + ".local" (mDNS);
 * - HOST, when it is a name;
 * - MODE_ALLOWED_HOSTS entries (reverse proxies, public domains), or anything
 *   when it is "*".
 * Only the Host header counts — never X-Forwarded-Host, even with TRUST_PROXY.
 */
export function isAllowedHostName(rawName: string, config: Pick<ServerConfig, 'host' | 'allowedHosts'>, machineName: string): boolean {
  if (config.allowedHosts === true) return true;
  const name = normalizeHostName(rawName);
  if (!name) return false;
  if (isIP(name) !== 0) return true;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  const machine = normalizeHostName(machineName);
  if (machine && (name === machine || name === `${machine}.local`)) return true;
  const host = config.host ? normalizeHostName(config.host) : '';
  if (host && name === host) return true;
  return inAllowedHosts(name, config.allowedHosts);
}

/** The host name of the request URL (from the Host header), '' when it can't be read. */
function requestHostName(c: Context): string {
  try {
    return new URL(c.req.url).hostname;
  } catch {
    return '';
  }
}

// ---- CSRF guard ----------------------------------------------------------------

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const crossSiteRefused = () => new ApiHttpError('unauthorized', 'Cross-site requests are not allowed.', 403);

/**
 * Whether an Origin header (sent by browsers that send no Sec-Fetch-Site) is
 * this app: the same host as the request, the host the Vite dev proxy was
 * reached on (X-Forwarded-Host from its `xfwd`; a cross-site page can't add
 * that header without a CORS preflight, which fails), a loopback origin on any
 * port (the Vite dev server on :5173 proxying to :8787), or a
 * MODE_ALLOWED_HOSTS name. "null" and anything unparsable are refused.
 */
function originAllowed(c: Context, origin: string, allowedHosts: string[] | true): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const originHost = url.host.toLowerCase();
  let requestHost = '';
  try {
    requestHost = new URL(c.req.url).host.toLowerCase();
  } catch {
    /* unreadable request URL: compare against the other rules only */
  }
  if (requestHost && originHost === requestHost) return true;
  const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
  if (forwardedHost && originHost === forwardedHost) return true;
  const name = normalizeHostName(url.hostname);
  return isLoopbackName(name) || inAllowedHosts(name, allowedHosts);
}

/**
 * CSRF guard for state-changing /api requests (every method but GET, HEAD and
 * OPTIONS). Without it any web page could POST text/plain "simple requests"
 * (no CORS preflight) that spend the user's AI credits or toggle the
 * Downloads watcher.
 * 1. Sec-Fetch-Site, when sent, must be same-origin or none (so cross-site
 *    and same-site are refused). The app's own requests — directly or
 *    through the Vite dev proxy — are same-origin.
 * 2. Without it, an Origin header must be this app (originAllowed).
 * 3. The body must be declared as application/json: a cross-site page can only
 *    send that after a CORS preflight, which this server never answers.
 */
export function checkSameOriginJson(c: Context, allowedHosts: string[] | true): void {
  const site = c.req.header('sec-fetch-site')?.trim().toLowerCase();
  if (site) {
    if (site !== 'same-origin' && site !== 'none') throw crossSiteRefused();
  } else {
    const origin = c.req.header('origin');
    if (origin !== undefined && !originAllowed(c, origin, allowedHosts)) throw crossSiteRefused();
  }
  if (!isJsonContentType(c.req.header('content-type'))) throw notJsonError();
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} min`;
}

function formatIssues(error: z.ZodError): string {
  const parts = error.issues.slice(0, 4).map((issue) => {
    const path = issue.path.map(String).join('.');
    const message =
      issue.code === 'invalid_value'
        ? 'unsupported value'
        : issue.message.length > 160
          ? `${issue.message.slice(0, 159)}…`
          : issue.message;
    return path ? `${path}: ${message}` : message;
  });
  const more = error.issues.length > 4 ? ` (and ${error.issues.length - 4} more)` : '';
  return `Invalid request. ${parts.join('; ')}${more}`;
}

function usageNote(u: ClaudeUsage): string {
  const parts = [`claude:${u.task}`, `stop=${u.stopReason ?? '-'}`];
  if (u.inputTokens != null) parts.push(`in=${u.inputTokens}`);
  if (u.cacheReadTokens) parts.push(`cached=${u.cacheReadTokens}`);
  if (u.outputTokens != null) parts.push(`out=${u.outputTokens}`);
  parts.push(`${(u.ms / 1000).toFixed(1)}s`);
  return parts.join(' ');
}

/**
 * Cross-origin isolation for the production web app. With these two headers
 * on the page (and on its scripts, which include the vision / alignment
 * workers) the browser sets `crossOriginIsolated`, so SharedArrayBuffer is
 * available and ONNX Runtime (src/vision/worker.ts) runs WASM with several
 * threads instead of one.
 *
 * - COOP same-origin: windows Mode opens (ChatGPT / Gemini tabs, opened with
 *   noopener anyway) don't share a browsing context group with it.
 * - COEP credentialless (not require-corp): cross-origin no-cors loads still
 *   work, just without cookies — e.g. product photos on store CDNs — and CORS
 *   fetches (Hugging Face model files) are unaffected. Everything else the app
 *   loads is same-origin (/assets, /api images, bundled fonts), which COEP
 *   never blocks.
 *
 * Only documents and scripts need them; images, styles, wasm and /api answers
 * are left alone. The Vite dev server does not send them (single-threaded
 * WASM in development).
 */
export const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
} as const;

/** HTML documents and JavaScript (page scripts, module and worker scripts). */
function isDocumentOrScript(contentType: string | null): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml' || type === 'text/javascript' || type === 'application/javascript';
}

function hasFileExtension(path: string): boolean {
  const last = path.split('/').pop() ?? '';
  return /\.[A-Za-z0-9]{1,8}$/.test(last);
}

export function createApp(deps: AppDeps) {
  const { config } = deps;
  const log = deps.log ?? ((line: string) => console.log(line));
  const app = new Hono<AppEnv>();

  // ---- dependencies -------------------------------------------------------

  const aiEnabled = config.aiEnabled && deps.claude !== null;
  let claudeClient: ClaudeClientLike | null = null;
  const getClaudeClient = (): ClaudeClientLike | null => {
    if (!aiEnabled) return null;
    claudeClient ??= deps.claude ?? createAnthropicClient(config);
    return claudeClient;
  };
  let claudeService: ClaudeService | null = null;
  const claude = (): ClaudeService | null => {
    const client = getClaudeClient();
    if (!client) return null;
    claudeService ??= createClaudeService(client, config.claudeModel);
    return claudeService;
  };
  const requireClaude = (): ClaudeService => {
    const service = claude();
    if (!service) throw aiDisabled();
    return service;
  };

  const imageProvider = deps.imageProvider === undefined ? createImageProvider(config) : deps.imageProvider;
  const requireImageProvider = (): ImageProvider => {
    if (!imageProvider) throw imageProviderDisabled();
    return imageProvider;
  };

  let catalogPromise: Promise<{ system: string; index: CatalogIndex | null }> | null = null;
  const catalogContext = () => {
    catalogPromise ??= (async () => {
      if (deps.catalog) return { system: buildSystemPrompt(deps.catalog.summary()), index: deps.catalog };
      if (deps.catalogSummary != null) return { system: buildSystemPrompt(deps.catalogSummary), index: null };
      const builtin = await loadBuiltinCatalog();
      return { system: buildSystemPrompt(builtin.summary()), index: builtin };
    })().catch((err: unknown) => {
      catalogPromise = null;
      log(`[mode] catalog failed to load: ${redact(err instanceof Error ? err.message : String(err))}`);
      throw new ApiHttpError('internal', "The design catalog couldn't be loaded on the server. Please try again.", 500);
    });
    return catalogPromise;
  };

  const limiter = createRateLimiter({ limit: config.rateLimitPer10Min, windowMs: RATE_WINDOW_MS, now: deps.now });

  /** Rate-limit key: the socket address, or the address our trusted proxy appended (right-most X-Forwarded-For). */
  const clientKey = (c: Context<AppEnv>): string => clientAddress(c, config.trustProxy) ?? 'unknown';

  // ---- event-stream tickets (see EVENTS_TICKET_TTL_MS) -----------------------

  const clock = deps.now ?? Date.now;
  /** sha256(ticket) hex → expiry time; Map order = issue order. */
  const eventTickets = new Map<string, number>();
  const issueEventsTicket = (): string => {
    const now = clock();
    for (const [key, expiresAt] of eventTickets) if (expiresAt <= now) eventTickets.delete(key);
    while (eventTickets.size >= EVENTS_TICKET_MAX) {
      const oldest = eventTickets.keys().next();
      if (oldest.done) break;
      eventTickets.delete(oldest.value);
    }
    const ticket = randomBytes(32).toString('base64url');
    eventTickets.set(sha256(ticket).toString('hex'), now + EVENTS_TICKET_TTL_MS);
    return ticket;
  };
  /** A valid ticket on GET /api/handoff/events; the ticket is used up either way. */
  const eventStreamTicket = (c: Context): boolean => {
    if (c.req.path !== API_PATHS.handoffEvents || c.req.method !== 'GET') return false;
    const ticket = c.req.query('ticket');
    if (!ticket) return false;
    const key = sha256(ticket).toString('hex');
    const expiresAt = eventTickets.get(key);
    eventTickets.delete(key);
    return expiresAt !== undefined && expiresAt > clock();
  };

  const consumeAiCall = (c: Context<AppEnv>): void => {
    const decision = limiter.consume(clientKey(c));
    if (!decision.ok) {
      throw new ApiHttpError(
        'rate_limited',
        `You've reached this server's limit of ${decision.limit} AI requests per 10 minutes. Try again in ${formatWait(decision.retryAfterSec)}.`,
        429,
        { retryAfterSec: decision.retryAfterSec },
      );
    }
    if (Number.isFinite(decision.remaining)) c.header('X-RateLimit-Remaining', String(decision.remaining));
  };

  const readBody = async <S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> => {
    if (!isJsonContentType(c.req.header('content-type'))) throw notJsonError();
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw badRequest('The request body must be valid JSON.');
    }
    const result = schema.safeParse(body);
    if (!result.success) throw badRequest(formatIssues(result.error));
    return result.data;
  };

  const claudeImage = (dataUrl: string): ImageData64 => {
    const image = parseImageDataUrl(dataUrl);
    if (image.base64.length > CLAUDE_MAX_IMAGE_BYTES) {
      throw new ApiHttpError(
        'payload_too_large',
        'This photo is too large for AI analysis (5 MB limit). Mode normally shrinks photos automatically; try re-importing it.',
        413,
      );
    }
    return image;
  };

  const callOptions = (c: Context<AppEnv>, d: Deadline): Pick<StructuredCall<z.ZodType>, 'signal' | 'timedOut' | 'onUsage'> => ({
    signal: d.signal,
    timedOut: d.timedOut,
    onUsage: (u) => c.set('note', usageNote(u)),
  });

  // ---- middleware ---------------------------------------------------------

  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    const ms = Math.round(performance.now() - started);
    const code = c.get('errorCode');
    const note = c.get('note');
    log(
      `${new Date().toISOString()} ${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms${code ? ` ${code}` : ''}${note ? ` (${note})` : ''}`,
    );
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
  });

  // DNS-rebinding guard: every request (API, health, static files) must name this server.
  const machineName = deps.machineName ?? machineHostname();
  app.use('*', async (c, next) => {
    const name = requestHostName(c);
    if (isAllowedHostName(name, config, machineName)) return next();
    const message = `This Mode server does not answer to the host name "${normalizeHostName(name).slice(0, 255)}". To reach it under that name (reverse proxy, public domain), add it to MODE_ALLOWED_HOSTS.`;
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) throw new ApiHttpError('unauthorized', message, 403);
    c.set('errorCode', 'unauthorized');
    c.header('Cache-Control', 'no-store');
    return c.text(message, 403);
  });

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (config.accessToken && c.req.path !== API_PATHS.health) {
      // The token travels only in the header; EventSource streams use a single-use ticket instead.
      const token = c.req.header('x-mode-token');
      if (token) {
        if (!tokenMatches(token, config.accessToken)) {
          throw new ApiHttpError(
            'unauthorized',
            'The access token was not accepted. Check it in Settings under "Server access token".',
            401,
          );
        }
      } else if (!eventStreamTicket(c)) {
        throw new ApiHttpError(
          'unauthorized',
          'This Mode server requires an access token. Add it in Settings under "Server access token".',
          401,
        );
      }
    }
    if (!SAFE_METHODS.has(c.req.method)) checkSameOriginJson(c, config.allowedHosts);
    await next();
  });

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new ApiHttpError(
          'payload_too_large',
          `The request is too large (limit ${Math.round(MAX_BODY_BYTES / (1024 * 1024))} MB). Try a smaller photo.`,
          413,
        );
      },
    }),
  );

  // ---- routes -------------------------------------------------------------

  app.get(API_PATHS.health, (c) => {
    const body: HealthResponse = {
      ok: true,
      ai: { enabled: aiEnabled, model: aiEnabled ? config.claudeModel : null },
      imageProvider: imageProvider
        ? { enabled: true, name: imageProvider.name, model: imageProvider.model }
        : { enabled: false, name: null, model: null },
      imageProviders: config.imageProviders.map((p) => ({
        id: p.id,
        name: IMAGE_PROVIDER_LABELS[p.id],
        model: p.model,
        isDefault: p.isDefault,
      })),
    };
    return c.json(body);
  });

  app.post(API_PATHS.analyze, async (c) => {
    const req = await readBody(c, AnalyzeRequestSchema);
    const service = requireClaude();
    const image = claudeImage(req.image);
    consumeAiCall(c);
    const { system } = await catalogContext();
    const d = deadline(c.req.raw.signal, DEADLINES.analyze);
    const result = await service.structured({
      task: 'analyze',
      schema: SpaceAnalysisResultSchema,
      system,
      images: [image],
      text: analyzePrompt(req),
      effort: 'medium',
      ...callOptions(c, d),
    });
    return c.json(postprocessAnalysis(result, req));
  });

  app.post(API_PATHS.suggest, async (c) => {
    const req = await readBody(c, SuggestRequestSchema);
    const service = requireClaude();
    const image = claudeImage(req.image);
    consumeAiCall(c);
    const { system, index } = await catalogContext();
    const d = deadline(c.req.raw.signal, DEADLINES.suggest);
    const result = await service.structured({
      task: 'suggest',
      schema: DesignSuggestionSchema,
      system,
      images: [image],
      text: suggestPrompt(req),
      effort: 'high',
      ...callOptions(c, d),
    });
    return c.json(postprocessSuggestion(result, req, index));
  });

  app.post(API_PATHS.assetList, async (c) => {
    const req = await readBody(c, AssetListRequestSchema);
    const service = requireClaude();
    consumeAiCall(c);
    const { system, index } = await catalogContext();
    const d = deadline(c.req.raw.signal, DEADLINES.assetList);
    const result = await service.structured({
      task: 'asset-list',
      schema: AssetListResultSchema,
      system,
      text: assetListPrompt(req),
      effort: 'medium',
      ...callOptions(c, d),
    });
    return c.json(postprocessAssetList(result, req, index));
  });

  const generateVectorAsset = async (c: Context<AppEnv>, req: GenerateAssetRequest): Promise<GeneratedAsset> => {
    const service = requireClaude();
    consumeAiCall(c);
    const { system } = await catalogContext();
    const d = deadline(c.req.raw.signal, DEADLINES.generateAsset);
    const out = await service.structured({
      task: 'generate-asset:vector',
      schema: VectorAssetOutputSchema,
      system,
      text: vectorAssetPrompt(req),
      effort: 'high',
      ...callOptions(c, d),
    });
    let sanitized;
    try {
      sanitized = sanitizeSvg(out.svg, { maxBytes: MAX_SVG_BYTES });
    } catch (err) {
      if (err instanceof SvgSanitizeError) {
        throw new ApiHttpError('upstream_error', `Claude's drawing couldn't be used (${err.message}) Please try again.`, 502);
      }
      throw err;
    }
    const { svg: _svg, ...meta } = out;
    return {
      ...postprocessAssetMeta(meta, req),
      svg: sanitized.svg,
      image: null,
      aspect: Math.round(sanitized.aspect * 10_000) / 10_000,
    };
  };

  const generatePhotoAsset = async (c: Context<AppEnv>, req: GenerateAssetRequest): Promise<GeneratedAsset> => {
    const provider = requireImageProvider();
    consumeAiCall(c);
    const d = deadline(c.req.raw.signal, DEADLINES.generateAsset);

    let plan = fallbackAssetMeta(req);
    let objectPrompt = req.description;
    const service = claude();
    if (service) {
      try {
        const { system } = await catalogContext();
        const planDeadline = deadline(d, DEADLINES.photoPlan);
        const out = await service.structured({
          task: 'generate-asset:photo',
          schema: PhotoAssetPlanSchema,
          system,
          text: photoAssetPlanPrompt(req),
          effort: 'medium',
          ...callOptions(c, planDeadline),
        });
        const { imagePrompt, orientation, ...meta } = out;
        plan = { ...postprocessAssetMeta(meta, req), orientation };
        if (imagePrompt.trim()) objectPrompt = imagePrompt;
      } catch (err) {
        // A refusal or a cancelled request ends here; other failures fall back to the description.
        if (!(err instanceof ApiHttpError) || err.code === 'refused' || err.status === STATUS_CLIENT_CLOSED) throw err;
        log(`[mode] photo asset plan failed (${err.code}); using the description as the prompt`);
      }
    }

    const result = await provider.generateImage({
      prompt: photoAssetImagePrompt(objectPrompt),
      transparent: true,
      orientation: plan.orientation,
      signal: d.signal,
    });
    let base64 = result.base64;
    let aspect = plan.orientation === 'portrait' ? 2 / 3 : plan.orientation === 'landscape' ? 3 / 2 : 1;
    if (result.mime === 'image/png') {
      const trimmed = trimTransparentPng(Buffer.from(result.base64, 'base64'));
      if (trimmed.width > 0 && trimmed.height > 0) aspect = trimmed.width / trimmed.height;
      if (trimmed.trimmed) base64 = Buffer.from(trimmed.bytes).toString('base64');
    }
    const { orientation: _orientation, ...meta } = plan;
    return {
      ...postprocessAssetMeta(meta, req),
      svg: null,
      image: toDataUrl(result.mime, base64),
      aspect: Math.round(aspect * 10_000) / 10_000,
    };
  };

  app.post(API_PATHS.generateAsset, async (c) => {
    const req = await readBody(c, GenerateAssetRequestSchema);
    const asset = req.mode === 'vector' ? await generateVectorAsset(c, req) : await generatePhotoAsset(c, req);
    return c.json(asset);
  });

  app.post(API_PATHS.render, async (c) => {
    const req = await readBody(c, RenderRequestSchema);
    const image = parseImageDataUrl(req.image);
    const mask = req.mask ? parseImageDataUrl(req.mask) : null;
    if (mask && mask.mime !== 'image/png') {
      throw badRequest('The render mask must be a PNG with transparency (transparent where the image may change).');
    }
    const provider = requireImageProvider();
    consumeAiCall(c);
    const d = deadline(c.req.raw.signal, DEADLINES.render);

    let prompt = templateRenderPrompt(req);
    const service = claude();
    // Claude sees the preview to write a scene-specific prompt (skipped for oversize images).
    if (service && image.base64.length <= CLAUDE_MAX_IMAGE_BYTES) {
      try {
        const { system } = await catalogContext();
        const promptDeadline = deadline(d, DEADLINES.renderPrompt);
        const out = await service.structured({
          task: 'render-prompt',
          schema: RenderPromptSchema,
          system,
          images: [image],
          text: renderPromptRequest(req),
          effort: 'low',
          ...callOptions(c, promptDeadline),
        });
        if (out.prompt.trim()) prompt = out.prompt.trim();
      } catch (err) {
        if (!(err instanceof ApiHttpError) || err.code === 'refused' || err.status === STATUS_CLIENT_CLOSED) throw err;
        log(`[mode] render prompt via Claude failed (${err.code}); using the template prompt`);
      }
    }

    const result = await provider.editImage({ image, mask, prompt, signal: d.signal });
    const body: RenderResponse = {
      image: toDataUrl(result.mime, result.base64),
      prompt,
      provider: `${provider.name}/${provider.model}`,
    };
    return c.json(body);
  });

  // Authenticated by the x-mode-token header (the /api middleware above); see EVENTS_TICKET_TTL_MS.
  app.post(API_PATHS.handoffEventsTicket, (c) => c.json({ ticket: issueEventsTicket() }));

  deps.extraRoutes?.(app, {
    config,
    log,
    consumeAiCall,
    claudeClient: getClaudeClient,
    noteForLog: (c, note) => c.set('note', note),
  });

  // Wrong method on one of the routes above gets 405; everything else 404.
  const knownApiPaths = new Set<string>([
    API_PATHS.health,
    API_PATHS.analyze,
    API_PATHS.suggest,
    API_PATHS.assetList,
    API_PATHS.generateAsset,
    API_PATHS.render,
    API_PATHS.handoffEventsTicket,
  ]);
  app.all('/api/*', (c) => {
    if (knownApiPaths.has(c.req.path)) throw new ApiHttpError('bad_request', `${c.req.method} is not supported here.`, 405);
    throw new ApiHttpError('bad_request', `Unknown API endpoint: ${c.req.path}`, 404);
  });

  // ---- static web app (production) ----------------------------------------

  if (config.staticDir) {
    const root = config.staticDir;
    app.use('*', async (c, next) => {
      await next();
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return;
      if (c.req.path.startsWith('/api/')) return;
      if (c.res.status === 200 && c.req.path.startsWith('/assets/')) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (c.res.status === 200) {
        c.header('Cache-Control', 'no-cache');
      }
      // Cross-origin isolation (multi-threaded ONNX Runtime), see CROSS_ORIGIN_ISOLATION_HEADERS.
      if (isDocumentOrScript(c.res.headers.get('content-type'))) {
        for (const [name, value] of Object.entries(CROSS_ORIGIN_ISOLATION_HEADERS)) c.header(name, value);
      }
    });
    app.use('*', serveStatic({ root }));
    const indexHtml = serveStatic({ root, path: 'index.html' });
    app.get('*', async (c, next) => {
      // Client-side routes get the app shell; missing files stay 404s.
      if (hasFileExtension(c.req.path)) return next();
      return indexHtml(c, next);
    });
  }

  app.notFound((c) =>
    c.text(
      config.staticDir
        ? 'Not found'
        : 'Mode API server. In development, open the web app from Vite (http://localhost:5173).',
      404,
    ),
  );

  // ---- errors -------------------------------------------------------------

  app.onError((err, c) => {
    let apiErr: ApiHttpError;
    const known = toApiHttpError(err);
    if (known) {
      apiErr = known;
    } else if (err instanceof HTTPException) {
      apiErr =
        err.status === 413
          ? new ApiHttpError('payload_too_large', 'The request is too large.', 413)
          : new ApiHttpError(err.status >= 500 ? 'internal' : 'bad_request', redact(err.message) || 'Request failed.', err.status);
    } else {
      log(`[mode] unexpected error on ${c.req.method} ${c.req.path}: ${redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err))}`);
      apiErr = new ApiHttpError('internal', 'Something went wrong on the server. Please try again.', 500);
    }
    c.set('errorCode', apiErr.code);
    if (apiErr.retryAfterSec != null) c.header('Retry-After', String(apiErr.retryAfterSec));
    c.header('Cache-Control', 'no-store');
    return c.json(apiErr.toBody(), apiErr.status as ContentfulStatusCode);
  });

  return app;
}

export type ModeApp = ReturnType<typeof createApp>;
