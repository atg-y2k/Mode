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
 * In production the built web app is served from `config.staticDir` with an
 * SPA fallback to index.html.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import {
  API_PATHS,
  AnalyzeRequestSchema,
  AssetListRequestSchema,
  AssetListResultSchema,
  DesignSuggestionSchema,
  GenerateAssetRequestSchema,
  MAX_BODY_BYTES,
  RenderRequestSchema,
  SpaceAnalysisResultSchema,
  SuggestRequestSchema,
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
import type { ServerConfig } from './config';
import { parseImageDataUrl, toDataUrl, type ImageData64 } from './dataUrl';
import { ApiHttpError, STATUS_CLIENT_CLOSED, aiDisabled, badRequest, imageProviderDisabled, redact } from './errors';
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
  /** Clock for the rate limiter (tests). */
  now?: () => number;
}

type AppEnv = { Variables: { errorCode: string; note: string } };

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

function deadline(parent: AbortSignal, ms: number): Deadline {
  const timer = AbortSignal.timeout(ms);
  return { signal: AbortSignal.any([parent, timer]), timedOut: () => timer.aborted };
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function tokenMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
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
  let claudeService: ClaudeService | null = null;
  const claude = (): ClaudeService | null => {
    if (!aiEnabled) return null;
    claudeService ??= createClaudeService(deps.claude ?? createAnthropicClient(config), config.claudeModel);
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

  const clientKey = (c: Context<AppEnv>): string => {
    if (config.trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
      const real = c.req.header('x-real-ip')?.trim();
      if (real) return real;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
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

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (config.accessToken && c.req.path !== API_PATHS.health) {
      const token = c.req.header('x-mode-token');
      if (!token) {
        throw new ApiHttpError(
          'bad_request',
          'This Mode server requires an access token. Add it in Settings under "Server access token".',
          401,
        );
      }
      if (!tokenMatches(token, config.accessToken)) {
        throw new ApiHttpError(
          'bad_request',
          'The access token was not accepted. Check it in Settings under "Server access token".',
          401,
        );
      }
    }
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
        const planDeadline = deadline(d.signal, DEADLINES.photoPlan);
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
        const promptDeadline = deadline(d.signal, DEADLINES.renderPrompt);
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

  const knownApiPaths = new Set<string>(Object.values(API_PATHS));
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
      if (c.res.status === 200 && c.req.path.startsWith('/assets/')) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (c.res.status === 200) {
        c.header('Cache-Control', 'no-cache');
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
    if (err instanceof ApiHttpError) {
      apiErr = err;
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
