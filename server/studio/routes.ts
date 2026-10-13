/**
 * Studio API routes (shared/api.ts §Studio and §Real store products):
 *
 *   POST /api/studio/scene             Claude vision: categorize + zones / paths / architecture
 *   POST /api/studio/climate           Claude: growing conditions for a ZIP / zone
 *   POST /api/studio/element-options   Claude: tailor an element's choice dimensions
 *   POST /api/studio/recommend         Claude vision: ideas from scene + idea board
 *   POST /api/studio/describe-idea     Claude vision: read an inspiration image
 *   POST /api/studio/plan              Claude: brief → N self-contained edit instructions
 *                                      (template plan when Claude isn't configured)
 *   POST /api/studio/render-variation  OpenAI / Gemini: one image from one instruction
 *   POST /api/products/search          Claude + web search on the chosen stores
 *   POST /api/products/from-url        SSRF-safe page read (structured data, Claude fallback)
 *   GET  /api/products/image?url=      SSRF-safe image proxy
 *
 * `registerStudioRoutes(app, deps)` is self-contained: it validates requests
 * with the shared zod schemas and answers every failure with an ApiErrorBody,
 * independent of the host app's error handler. Register it after the host's
 * auth / body-limit middleware and before any `/api/*` catch-all.
 */
import type { Context, Env, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import {
  API_PATHS,
  ClimateRequestSchema,
  ClimateResultSchema,
  DescribeIdeaRequestSchema,
  DescribeIdeaResultSchema,
  ElementOptionsRequestSchema,
  ElementOptionsResultSchema,
  MAX_BODY_BYTES,
  PlanRequestSchema,
  PlanResultSchema,
  ProductFromUrlRequestSchema,
  ProductSearchRequestSchema,
  RecommendRequestSchema,
  RecommendResultSchema,
  RenderVariationRequestSchema,
  SceneRequestSchema,
  SceneResultSchema,
  type HealthResponse,
  type ImageProviderId,
  type PlanResult,
  type RenderVariationResult,
} from '../../shared/api';
import { TEXTURE_PATTERNS, type AssetDef } from '../../shared/types';
import { createAnthropicClient, structured, type ClaudeUsage, type StudioClaude, type WebSearchToolType } from './claude';
import { StudioError, aiDisabled, asStudioError, badRequest, redact } from './errors';
import { catalogPlantsFromAssets, crossCheckOptions, crossCheckPlanPlants, propertyZone, targetedSun, type CatalogPlant } from './feasibility';
import { describeEditableRegion, decodePngAlpha, editableRegion } from './png';
import {
  cleanClimate,
  cleanDescribeIdea,
  cleanElementOptions,
  cleanRecommendations,
  cleanSceneResult,
  finalizePlan,
  variationCount,
} from './postprocess';
import { fetchProductImage, productFromUrl, searchProducts, type ProductDeps } from './products';
import {
  buildStudioSystemPrompt,
  climatePrompt,
  describeIdeaPrompt,
  elementOptionsPrompt,
  imageEditPrompt,
  MAX_PROMPT_CHARS,
  planPrompt,
  recommendPrompt,
  scenePrompt,
  templatePlan,
} from './prompts';
import { PROVIDER_NAMES, createProvidersFromEnv, type ImageProvider } from './providers';
import { createFetchTransport, type ResolveHost } from './ssrf';
import { base64ToBytes, deadline, parseImageDataUrl, toDataUrl, type Deadline, type ImageData64 } from './util';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

export interface StudioConfig {
  /** Claude model id (CLAUDE_MODEL). */
  model: string;
  /** Web search tool version for product search (default 'web_search_20260209'; older models need 'web_search_20250305'). */
  webSearchTool?: WebSearchToolType;
}

export interface StudioDeps {
  /** Claude client (`new Anthropic()` or a test fake). Omitted / null = AI disabled. */
  anthropic?: StudioClaude | null;
  config: StudioConfig;
  /** Configured image providers. */
  providers: Record<ImageProviderId, ImageProvider | undefined>;
  /** Provider used when a request doesn't name one (IMAGE_PROVIDER), or null. */
  defaultProvider: ImageProviderId | null;
  /**
   * Network for user-supplied URLs (pasted product links, product images,
   * page enrichment). Default: node http(s) with the DNS lookup pinned to
   * vetted public addresses. A fetch here gets the same checks except pinning.
   */
  fetch?: typeof fetch;
  /** DNS resolver for the SSRF host check (tests). */
  resolveHost?: ResolveHost;
  /** catalogSummaryForAI() text for the cached system prompt (memoized; must be stable). */
  catalogSummary?: () => string | Promise<string>;
  /** designKnowledgeForAI() text for the cached system prompt (memoized; must be stable). */
  designKnowledge?: () => string | Promise<string>;
  /** Architectural styles offered to the scene analysis (and used to validate `styleId`). */
  styles?: () => { id: string; name: string }[] | Promise<{ id: string; name: string }[]>;
  /** Catalog plants (curated zones / sun) used to cross-check the AI's plant feasibility ratings. */
  plants?: () => AssetDef[] | Promise<AssetDef[]>;
  /** Called before every Claude / image-provider call (wire the host's rate limiter here); throw to refuse. */
  beforeAiCall?: (c: Context) => void | Promise<void>;
  /** Token usage of each Claude call (for the host's request log). */
  onClaudeUsage?: (c: Context, usage: ClaudeUsage) => void;
  /** Diagnostics sink (default console.log). */
  log?: (line: string) => void;
}

/** Claude rejects images over 5 MB. */
const CLAUDE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Server-side deadlines; the web client waits a few seconds longer (src/lib/studio.ts, src/lib/products.ts). */
export const STUDIO_DEADLINES_MS = {
  scene: 175_000,
  plan: 175_000,
  recommend: 175_000,
  elementOptions: 115_000,
  climate: 85_000,
  describeIdea: 85_000,
  render: 295_000,
  productSearch: 175_000,
  productFromUrl: 85_000,
  productImage: 25_000,
} as const;

function formatIssues(error: z.ZodError): string {
  const parts = error.issues.slice(0, 4).map((issue) => {
    const path = issue.path.map(String).join('.');
    const message = issue.code === 'invalid_value' ? 'unsupported value' : issue.message.length > 160 ? `${issue.message.slice(0, 159)}…` : issue.message;
    return path ? `${path}: ${message}` : message;
  });
  const more = error.issues.length > 4 ? ` (and ${error.issues.length - 4} more)` : '';
  return `Invalid request. ${parts.join('; ')}${more}`;
}

/**
 * Parses and validates a JSON body. The Content-Type must be application/json
 * (as createApp's CSRF guard also requires): a cross-site page can only send
 * that after a CORS preflight, so a text/plain "simple request" from another
 * site never reaches a Claude or image-provider call.
 */
async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  if ((c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new StudioError('bad_request', 'Send the request body as JSON (Content-Type: application/json).', 415);
  }
  const length = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    throw new StudioError('payload_too_large', `The request is too large (limit ${Math.round(MAX_BODY_BYTES / (1024 * 1024))} MB). Try a smaller photo.`, 413);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('The request body must be valid JSON.');
  }
  const result = schema.safeParse(body);
  if (!result.success) throw badRequest(formatIssues(result.error));
  return result.data;
}

/**
 * Backstop for the prompt budget: prompts.ts caps every list, but a request
 * with very long entries could still add up. Refused before the rate limiter
 * counts it and before Claude sees it.
 */
function boundedPrompt(text: string): string {
  if (text.length > MAX_PROMPT_CHARS) {
    throw new StudioError('payload_too_large', 'This request has too much text for one AI call. Remove some ideas or zones and try again.', 413);
  }
  return text;
}

function claudeImage(dataUrl: string): ImageData64 {
  const image = parseImageDataUrl(dataUrl);
  if (image.base64.length > CLAUDE_MAX_IMAGE_BYTES) {
    throw new StudioError('payload_too_large', 'This image is too large for AI analysis (5 MB limit). Mode normally shrinks images automatically; try re-importing it.', 413);
  }
  return image;
}

/** imageProviders entry for /api/health. */
export function studioImageProviders(deps: Pick<StudioDeps, 'providers' | 'defaultProvider'>): NonNullable<HealthResponse['imageProviders']> {
  return (Object.keys(deps.providers) as ImageProviderId[])
    .filter((id) => deps.providers[id])
    .map((id) => {
      const p = deps.providers[id] as ImageProvider;
      return { id, name: p.name, model: p.model, isDefault: id === deps.defaultProvider };
    });
}

export function registerStudioRoutes<E extends Env>(app: Hono<E>, deps: StudioDeps): void {
  const log = deps.log ?? ((line: string) => console.log(line));
  const model = deps.config.model || DEFAULT_CLAUDE_MODEL;
  const claude = deps.anthropic ?? null;

  const requireClaude = (): StudioClaude => {
    if (!claude) throw aiDisabled();
    return claude;
  };

  const beforeAi = async (c: Context) => {
    await deps.beforeAiCall?.(c);
  };

  // ---- cached prompt context (memoized; retried when a source failed) -----

  let systemCache: Promise<string> | null = null;
  const studioSystem = (): Promise<string> => {
    if (systemCache) return systemCache;
    let failed = false;
    const load = async (name: string, fn: (() => string | Promise<string>) | undefined): Promise<string> => {
      if (!fn) return '';
      try {
        const text = await fn();
        return typeof text === 'string' ? text : '';
      } catch (err) {
        failed = true;
        log(`[studio] ${name} unavailable: ${redact(err instanceof Error ? err.message : String(err))}`);
        return '';
      }
    };
    const pending = (async () => {
      const [designKnowledge, catalogSummary] = await Promise.all([
        load('design knowledge', deps.designKnowledge),
        load('catalog summary', deps.catalogSummary),
      ]);
      return buildStudioSystemPrompt({ designKnowledge, catalogSummary });
    })();
    systemCache = pending;
    void pending.then(() => {
      if (failed) systemCache = null;
    });
    return pending;
  };

  let stylesCache: Promise<{ id: string; name: string }[]> | null = null;
  const styles = (): Promise<{ id: string; name: string }[]> => {
    stylesCache ??= (async () => {
      try {
        const list = (await deps.styles?.()) ?? [];
        return list.filter((s) => s && typeof s.id === 'string' && s.id.trim()).map((s) => ({ id: s.id.trim(), name: String(s.name ?? s.id) }));
      } catch (err) {
        stylesCache = null;
        log(`[studio] style list unavailable: ${redact(err instanceof Error ? err.message : String(err))}`);
        return [];
      }
    })();
    return stylesCache;
  };

  let plantsCache: Promise<CatalogPlant[]> | null = null;
  const catalogPlants = (): Promise<CatalogPlant[]> => {
    plantsCache ??= (async () => {
      try {
        return catalogPlantsFromAssets((await deps.plants?.()) ?? []);
      } catch (err) {
        plantsCache = null;
        log(`[studio] plant catalog unavailable: ${redact(err instanceof Error ? err.message : String(err))}`);
        return [];
      }
    })();
    return plantsCache;
  };

  const transport = deps.fetch ? createFetchTransport(deps.fetch) : undefined;
  const productDeps = (c: Context): ProductDeps => ({
    claude,
    model,
    transport,
    resolveHost: deps.resolveHost,
    webSearchTool: deps.config.webSearchTool,
    onUsage: (u) => deps.onClaudeUsage?.(c, u),
    log,
  });

  const callOptions = (c: Context, d: Deadline) => ({
    signal: d.signal,
    timedOut: d.timedOut,
    onUsage: (u: ClaudeUsage) => deps.onClaudeUsage?.(c, u),
  });

  const pickProvider = (requested: ImageProviderId | null): ImageProvider => {
    const id = requested ?? deps.defaultProvider;
    if (!id) {
      throw new StudioError(
        'image_provider_disabled',
        'Photoreal variations need an image provider. Set OPENAI_API_KEY or GEMINI_API_KEY in .env and restart the server.',
        503,
      );
    }
    const provider = deps.providers[id];
    if (!provider) {
      const key = id === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
      throw new StudioError(
        'image_provider_disabled',
        `${PROVIDER_NAMES[id]} isn't set up on this server. Add ${key} to .env and restart the server, or choose another provider in Settings.`,
        503,
      );
    }
    return provider;
  };

  // ---- error boundary -----------------------------------------------------

  const respondError = (c: Context, err: unknown): Response => {
    let e = asStudioError(err);
    if (!e) {
      log(`[studio] unexpected error on ${c.req.method} ${c.req.path}: ${redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err))}`);
      e = new StudioError('internal', 'Something went wrong on the server. Please try again.', 500);
    }
    if (e.retryAfterSec != null) c.header('Retry-After', String(e.retryAfterSec));
    c.header('Cache-Control', 'no-store');
    return c.json(e.toBody(), e.status as ContentfulStatusCode);
  };

  const route =
    (handler: (c: Context) => Promise<Response>) =>
    async (c: Context): Promise<Response> => {
      try {
        return await handler(c);
      } catch (err) {
        return respondError(c, err);
      }
    };

  const answeredBy = (c: Context, m: string) => c.header('X-Mode-Model', m);

  // ---- Studio -------------------------------------------------------------

  app.post(
    API_PATHS.scene,
    route(async (c) => {
      const req = await readJson(c, SceneRequestSchema);
      if (!(req.width > 0 && req.height > 0)) throw badRequest('Invalid request. width and height must be positive.');
      const client = requireClaude();
      const image = claudeImage(req.image);
      await beforeAi(c);
      const [system, styleList] = await Promise.all([studioSystem(), styles()]);
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.scene);
      const result = await structured(client, model, {
        task: 'scene',
        schema: SceneResultSchema,
        system,
        images: [image],
        text: scenePrompt(req, styleList),
        effort: 'high',
        ...callOptions(c, d),
      });
      answeredBy(c, result.model);
      return c.json(cleanSceneResult(result.data, styleList.length ? new Set(styleList.map((s) => s.id)) : null));
    }),
  );

  app.post(
    API_PATHS.climate,
    route(async (c) => {
      const req = await readJson(c, ClimateRequestSchema);
      if (!req.zip?.trim() && !req.hardinessZone?.trim()) throw badRequest('Enter a ZIP code or a USDA hardiness zone.');
      const client = requireClaude();
      await beforeAi(c);
      const system = await studioSystem();
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.climate);
      const result = await structured(client, model, {
        task: 'climate',
        schema: ClimateResultSchema,
        system,
        text: climatePrompt(req),
        effort: 'low',
        ...callOptions(c, d),
      });
      answeredBy(c, result.model);
      return c.json(cleanClimate(result.data));
    }),
  );

  app.post(
    API_PATHS.elementOptions,
    route(async (c) => {
      const req = await readJson(c, ElementOptionsRequestSchema);
      const client = requireClaude();
      const images = req.image ? [claudeImage(req.image)] : [];
      const text = boundedPrompt(elementOptionsPrompt(req, TEXTURE_PATTERNS));
      await beforeAi(c);
      const system = await studioSystem();
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.elementOptions);
      const result = await structured(client, model, {
        task: 'element-options',
        schema: ElementOptionsResultSchema,
        system,
        images,
        text,
        effort: 'medium',
        ...callOptions(c, d),
      });
      answeredBy(c, result.model);
      const plants = await catalogPlants();
      return c.json(crossCheckOptions(cleanElementOptions(result.data), { plants, zone: propertyZone(req.location, req.climate), sun: null }));
    }),
  );

  app.post(
    API_PATHS.recommend,
    route(async (c) => {
      const req = await readJson(c, RecommendRequestSchema);
      const client = requireClaude();
      const image = claudeImage(req.image);
      const text = boundedPrompt(recommendPrompt(req));
      await beforeAi(c);
      const system = await studioSystem();
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.recommend);
      const result = await structured(client, model, {
        task: 'recommend',
        schema: RecommendResultSchema,
        system,
        images: [image],
        text,
        effort: 'high',
        ...callOptions(c, d),
      });
      answeredBy(c, result.model);
      return c.json(cleanRecommendations(result.data, new Set(req.zones.map((z) => z.id))));
    }),
  );

  app.post(
    API_PATHS.describeIdea,
    route(async (c) => {
      const req = await readJson(c, DescribeIdeaRequestSchema);
      const client = requireClaude();
      const image = claudeImage(req.image);
      await beforeAi(c);
      const system = await studioSystem();
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.describeIdea);
      const result = await structured(client, model, {
        task: 'describe-idea',
        schema: DescribeIdeaResultSchema,
        system,
        images: [image],
        text: describeIdeaPrompt(req),
        effort: 'low',
        ...callOptions(c, d),
      });
      answeredBy(c, result.model);
      return c.json(cleanDescribeIdea(result.data));
    }),
  );

  app.post(
    API_PATHS.plan,
    route(async (c) => {
      const req = await readJson(c, PlanRequestSchema);
      if (req.compare) {
        const ids = req.compare.options.map((o) => o.id);
        if (ids.length < 1 || ids.length > 8) throw badRequest('Invalid request. compare.options must list 1–8 options.');
        if (new Set(ids).size !== ids.length) throw badRequest('Invalid request. compare.options ids must be unique.');
      }
      const count = variationCount(req);
      if (!claude) {
        // No Claude on this server: assemble the instructions from the brief itself.
        c.header('X-Mode-Plan-Source', 'template');
        return c.json(finalizePlan(templatePlan(req, count), req));
      }
      const images = [claudeImage(req.image), ...req.ideaImages.map(claudeImage)];
      const text = boundedPrompt(planPrompt(req, count));
      await beforeAi(c);
      const system = await studioSystem();
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.plan);
      const result = await structured(claude, model, {
        task: req.compare ? 'plan:compare' : 'plan',
        schema: PlanResultSchema,
        system,
        images,
        text,
        effort: 'high',
        ...callOptions(c, d),
      });
      const finalized = finalizePlan(result.data, req);
      const plan: PlanResult = {
        ...finalized,
        plants: crossCheckPlanPlants(finalized.plants, {
          plants: await catalogPlants(),
          zone: propertyZone(req.location, req.climate),
          sun: targetedSun(req),
        }),
      };
      if (!plan.variations.length) {
        throw new StudioError('upstream_error', 'Claude returned a plan without variations. Please try again.', 502);
      }
      answeredBy(c, result.model);
      c.header('X-Mode-Plan-Source', 'ai');
      return c.json(plan);
    }),
  );

  app.post(
    API_PATHS.renderVariation,
    route(async (c) => {
      const req = await readJson(c, RenderVariationRequestSchema);
      const image = parseImageDataUrl(req.image);
      const mask = req.mask ? parseImageDataUrl(req.mask) : null;
      if (mask && mask.mime !== 'image/png') {
        throw badRequest('The mask must be a PNG with transparency (transparent where the image may change).');
      }
      if (!req.brief.trim()) throw badRequest('Invalid request. brief: the instruction is empty.');
      const references = req.references.map(parseImageDataUrl);
      const provider = pickProvider(req.provider);
      await beforeAi(c);

      let regionText: string | null = null;
      if (mask && !provider.supportsMask) {
        const alpha = decodePngAlpha(base64ToBytes(mask.base64));
        const region = alpha ? editableRegion(alpha) : null;
        regionText = region ? describeEditableRegion(region) : null;
      }
      const prompt = imageEditPrompt(req.brief, {
        providerHonorsMask: provider.supportsMask,
        hasMask: mask != null,
        referenceCount: references.length,
        regionText,
      });
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.render);
      const out = await provider.edit({
        image,
        mask: provider.supportsMask ? mask : null,
        references,
        prompt,
        quality: req.quality,
        signal: d.signal,
      });
      const body: RenderVariationResult = { image: toDataUrl(out.mime, out.base64), provider: provider.id, model: provider.model };
      return c.json(body);
    }),
  );

  // ---- Real store products --------------------------------------------------

  app.post(
    API_PATHS.productSearch,
    route(async (c) => {
      const req = await readJson(c, ProductSearchRequestSchema);
      const client = requireClaude();
      await beforeAi(c);
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.productSearch);
      const result = await searchProducts(req, { ...productDeps(c), claude: client }, d.signal, d.timedOut);
      answeredBy(c, model);
      return c.json(result);
    }),
  );

  app.post(
    API_PATHS.productFromUrl,
    route(async (c) => {
      const req = await readJson(c, ProductFromUrlRequestSchema);
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.productFromUrl);
      const result = await productFromUrl(req.url, productDeps(c), d.signal, () => beforeAi(c), d.timedOut);
      return c.json(result);
    }),
  );

  const ImageQuerySchema = z.object({ url: z.string().url().max(2000) });

  app.get(
    API_PATHS.productImage,
    route(async (c) => {
      const parsed = ImageQuerySchema.safeParse({ url: c.req.query('url') });
      if (!parsed.success) throw badRequest('Invalid request. url: expected an http(s) image URL.');
      const d = deadline(c.req.raw.signal, STUDIO_DEADLINES_MS.productImage);
      const image = await fetchProductImage(parsed.data.url, productDeps(c), d.signal);
      c.header('Content-Type', image.mime);
      c.header('Cache-Control', 'private, max-age=86400');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Content-Security-Policy', "default-src 'none'; sandbox");
      return c.body(new Uint8Array(image.bytes));
    }),
  );
}

// ---------------------------------------------------------------------------
// From the environment
// ---------------------------------------------------------------------------

type EnvVars = Record<string, string | undefined>;

function envStr(env: EnvVars, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

/** Memoized loader for a value computed from a lazily imported module. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let cache: Promise<T> | null = null;
  return () => {
    cache ??= load().catch((err: unknown) => {
      cache = null;
      throw err;
    });
    return cache;
  };
}

/**
 * Studio dependencies from the environment:
 * ANTHROPIC_API_KEY (or MODE_AI=on to let the SDK find credentials; MODE_AI=off disables AI),
 * CLAUDE_MODEL (default claude-opus-5-5), IMAGE_PROVIDER (openai | gemini),
 * OPENAI_API_KEY, OPENAI_IMAGE_MODEL (default gpt-image-1), OPENAI_BASE_URL,
 * OPENAI_INPUT_FIDELITY (auto | high | off), GEMINI_API_KEY or GOOGLE_API_KEY,
 * GEMINI_IMAGE_MODEL (default gemini-2.5-flash-image), CLAUDE_WEB_SEARCH_TOOL
 * (web_search_20260209 | web_search_20250305).
 * Design knowledge, catalog summary and styles are imported lazily on first use.
 */
export function createStudioDepsFromEnv(env: EnvVars = process.env): StudioDeps & { warnings: string[] } {
  const apiKey = envStr(env, 'ANTHROPIC_API_KEY');
  const modeAi = envStr(env, 'MODE_AI')?.toLowerCase() ?? null;
  const aiOff = modeAi != null && ['0', 'false', 'off', 'no'].includes(modeAi);
  const aiOn = modeAi != null && ['1', 'true', 'on', 'yes'].includes(modeAi);
  const aiEnabled = !aiOff && (apiKey != null || aiOn);

  const { providers, defaultProvider, warnings } = createProvidersFromEnv(env);
  const toolRaw = envStr(env, 'CLAUDE_WEB_SEARCH_TOOL');
  const webSearchTool: WebSearchToolType | undefined =
    toolRaw === 'web_search_20250305' || toolRaw === 'web_search_20260209' ? toolRaw : undefined;
  if (toolRaw && !webSearchTool) warnings.push(`CLAUDE_WEB_SEARCH_TOOL="${toolRaw}" is not supported; using web_search_20260209.`);

  const design = lazy(() => import('../../src/assets/design/index'));
  const catalog = lazy(() => import('../../src/assets/catalog/index'));

  return {
    anthropic: aiEnabled ? createAnthropicClient(apiKey) : null,
    config: { model: envStr(env, 'CLAUDE_MODEL') ?? DEFAULT_CLAUDE_MODEL, webSearchTool },
    providers,
    defaultProvider,
    designKnowledge: async () => (await design()).designKnowledgeForAI(),
    catalogSummary: async () => (await catalog()).catalogSummaryForAI(),
    styles: async () => (await design()).ARCHITECTURAL_STYLES.map((s) => ({ id: s.id, name: s.name })),
    plants: async () => (await catalog()).PLANTS,
    warnings,
  };
}
