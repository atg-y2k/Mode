/**
 * Typed client for the Studio endpoints (shared/api.ts §Studio) plus the
 * conversions between the AI's normalized coordinates / drafts and the app's
 * domain types. Throws ApiError (from ./api) on failure.
 *
 * - Sends the server access token from localStorage 'mode.apiToken' (header
 *   `x-mode-token`) when present.
 * - Every call has a timeout combined with the caller's AbortSignal; a call the
 *   caller cancelled rejects with an ApiError whose `aborted` is true.
 * - Requests and responses are validated with the shared zod schemas.
 */
import type { z } from 'zod';
import {
  API_PATHS,
  ApiErrorBodySchema,
  ClimateRequestSchema,
  ClimateResultSchema,
  DescribeIdeaRequestSchema,
  DescribeIdeaResultSchema,
  ElementOptionsRequestSchema,
  ElementOptionsResultSchema,
  PlanRequestSchema,
  PlanResultSchema,
  RecommendRequestSchema,
  RecommendResultSchema,
  RenderVariationRequestSchema,
  RenderVariationResultSchema,
  SceneRequestSchema,
  SceneResultSchema,
} from '../../shared/api';
import type {
  ClimateRequest,
  DescribeIdeaResult,
  ElementDimensionDraft,
  ElementOptionsRequest,
  ElementOptionsResult,
  PlanRequest,
  PlanResult,
  RecommendRequest,
  RecommendResult,
  RenderVariationRequest,
  RenderVariationResult,
  SceneResult,
} from '../../shared/api';
import { newId } from '../../shared/ids';
import {
  CONTEXT_ZONE_KINDS,
  type ClimateProfile,
  type ElementDimension,
  type ElementOption,
  type Photo,
  type ProjectLocation,
  type Pt,
  type Recommendation,
  type SceneMap,
  type ScenePath,
  type SceneZone,
  type SpaceType,
} from '../../shared/types';
import { mergeDimensions, optionVisualFromDraft } from '../assets/design';
import { ApiError } from './api';
import { blobToAIDataUrl } from './imageImport';

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const TOKEN_STORAGE_KEY = 'mode.apiToken';
const TOKEN_HEADER = 'x-mode-token';

/** Client-side timeouts (the server's deadlines are a few seconds shorter). */
export const STUDIO_TIMEOUTS_MS = {
  scene: 180_000,
  plan: 180_000,
  recommend: 180_000,
  elementOptions: 120_000,
  climate: 90_000,
  describeIdea: 90_000,
  render: 300_000,
  productSearch: 180_000,
  productFromUrl: 90_000,
  productImage: 90_000,
} as const;

function readToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)?.trim();
    return token ? token : null;
  } catch {
    return null; // storage blocked (privacy mode, sandboxed iframe)
  }
}

const cancelledError = () => new ApiError('network', 'Request cancelled.', 0, { aborted: true });

/** Error for a non-2xx response without an ApiErrorBody (proxy, static host, server down…). */
function errorForStatus(status: number): ApiError {
  if (status === 413) return new ApiError('payload_too_large', 'The request is too large for the server. Try a smaller photo.', status);
  if (status === 429) return new ApiError('rate_limited', 'Too many requests. Wait a minute and try again.', status);
  if (status === 401 || status === 403) {
    return new ApiError('bad_request', 'The server refused the request. Check the server access token in Settings.', status);
  }
  if (status === 404 || status >= 500) {
    return new ApiError(
      'network',
      `The Mode API server isn't responding (HTTP ${status}). Make sure it's running (npm run dev starts it with the app).`,
      status,
    );
  }
  return new ApiError('internal', `Unexpected response from the server (HTTP ${status}).`, status);
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => {
      const path = i.path.map(String).join('.');
      return path ? `${path}: ${i.message}` : i.message;
    })
    .join('; ');
}

/**
 * fetch with the access token, a timeout and the caller's signal. Resolves
 * with the Response for any HTTP status; network failures become ApiError
 * 'network' (status 0).
 */
async function send(
  path: string,
  init: { method: 'GET' | 'POST'; body?: string; accept: string },
  timeoutMs: number,
  signal: AbortSignal | undefined,
  read: (res: Response) => Promise<unknown>,
): Promise<{ res: Response; payload: unknown }> {
  if (signal?.aborted) throw cancelledError();
  // Manual signal plumbing: AbortSignal.any / .timeout are missing on older mobile Safari.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  const headers: Record<string, string> = { Accept: init.accept };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = readToken();
  if (token) headers[TOKEN_HEADER] = token;

  try {
    const res = await fetch(path, { method: init.method, headers, body: init.body, signal: controller.signal });
    const payload = await read(res);
    return { res, payload };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (signal?.aborted) throw cancelledError();
    if (timedOut) {
      throw new ApiError('network', `The server took too long to respond (over ${Math.round(timeoutMs / 1000)} seconds). Please try again.`, 0);
    }
    throw new ApiError('network', "Can't reach the Mode server. Check your connection and that the server is running, then try again.", 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function throwForResponse(res: Response, json: unknown): never {
  const body = ApiErrorBodySchema.safeParse(json);
  if (body.success) throw new ApiError(body.data.error.code, body.data.error.message, res.status);
  throw errorForStatus(res.status);
}

/** POSTs a validated request and validates the JSON response. Exported for src/lib/products.ts. */
export async function studioPost<Req extends z.ZodType, Res extends z.ZodType>(
  path: string,
  requestSchema: Req,
  req: z.input<Req>,
  responseSchema: Res,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ data: z.infer<Res>; headers: Headers }> {
  // Validate locally first: fails fast without uploading a photo for nothing.
  const checked = requestSchema.safeParse(req);
  if (!checked.success) throw new ApiError('bad_request', `Invalid request. ${describeIssues(checked.error)}`, 0);
  const { res, payload } = await send(
    path,
    { method: 'POST', body: JSON.stringify(checked.data), accept: 'application/json' },
    timeoutMs,
    signal,
    readJsonBody,
  );
  if (!res.ok) throwForResponse(res, payload);
  const result = responseSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiError('internal', "The server sent a response this version of Mode doesn't understand. Reload the page and try again.", res.status);
  }
  return { data: result.data, headers: res.headers };
}

/** GETs a binary resource (errors still arrive as ApiErrorBody JSON). Exported for src/lib/products.ts. */
export async function studioGetBlob(path: string, timeoutMs: number, signal?: AbortSignal): Promise<Blob> {
  const { res, payload } = await send(path, { method: 'GET', accept: 'image/*,application/json;q=0.5' }, timeoutMs, signal, (r) =>
    r.ok ? r.blob() : readJsonBody(r),
  );
  if (!res.ok) throwForResponse(res, payload);
  return payload as Blob;
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

const clamp = (n: number, min: number, max: number) => (n < min ? min : n > max ? max : n);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Normalized (0..1) point → photo px, clamped to the photo. Null for non-finite input. */
export function normToPx(p: { x: number; y: number }, photo: Pick<Photo, 'width' | 'height'>): Pt | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: round1(clamp(p.x, 0, 1) * photo.width), y: round1(clamp(p.y, 0, 1) * photo.height) };
}

function toPxList(points: readonly { x: number; y: number }[], photo: Pick<Photo, 'width' | 'height'>): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const q = normToPx(p, photo);
    if (!q) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - q.x) < 0.5 && Math.abs(last.y - q.y) < 0.5) continue;
    out.push(q);
  }
  return out;
}

/** Shoelace area in screen space (y down): positive = clockwise as seen on screen. */
export function polygonSignedArea(points: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Converts the AI result (normalized coords) into a SceneMap in photo px with fresh ids. */
export function sceneFromResult(result: SceneResult, photo: Pick<Photo, 'width' | 'height'>, model: string): SceneMap {
  const zones: SceneZone[] = [];
  for (const z of result.zones) {
    let polygon = toPxList(z.polygon, photo);
    if (polygon.length > 2) {
      const first = polygon[0];
      const last = polygon[polygon.length - 1];
      if (Math.abs(first.x - last.x) < 0.5 && Math.abs(first.y - last.y) < 0.5) polygon = polygon.slice(0, -1);
    }
    if (polygon.length < 3) continue;
    const area = polygonSignedArea(polygon);
    if (Math.abs(area) < 1) continue; // degenerate (all points on a line)
    if (area < 0) polygon.reverse();
    const zone: SceneZone = {
      id: newId('zone'),
      kind: z.kind,
      label: z.label.trim() || 'Area',
      description: z.description.trim(),
      polygon,
      editable: CONTEXT_ZONE_KINDS.includes(z.kind) ? false : z.editable,
    };
    if (z.sun) zone.sun = z.sun;
    zones.push(zone);
  }

  const paths: ScenePath[] = [];
  for (const p of result.paths) {
    const points = toPxList(p.points, photo);
    if (points.length < 2) continue;
    const widthFraction = Number.isFinite(p.widthFraction) ? clamp(p.widthFraction, 0, 1) : 0.05;
    paths.push({
      id: newId('path'),
      label: p.label.trim() || `${p.from} → ${p.to}`,
      from: p.from,
      to: p.to,
      description: p.description,
      points,
      widthPx: Math.max(2, Math.round(widthFraction * photo.width)),
      kind: 'existing',
    });
  }

  const a = result.architecture;
  return {
    category: result.category,
    summary: result.summary,
    viewpoint: result.viewpoint,
    style: result.style,
    boundaries: result.boundaries,
    lighting: result.lighting,
    orientation: result.orientation,
    architecture: {
      style: a.style,
      ...(a.styleId ? { styleId: a.styleId } : {}),
      ...(a.era ? { era: a.era } : {}),
      features: a.features,
      materials: a.materials,
      proportions: a.proportions,
      designLanguage: a.designLanguage,
      purpose: a.purpose,
    },
    zones,
    paths,
    keep: result.keep,
    opportunities: result.opportunities,
    createdAt: Date.now(),
    model,
  };
}

/** AI drafts → ElementDimension (option visuals resolved; plant feasibility kept). */
export function dimensionsFromDrafts(drafts: readonly ElementDimensionDraft[]): ElementDimension[] {
  return drafts
    .map((d): ElementDimension => {
      const options = d.options.map((o): ElementOption => {
        const option: ElementOption = { id: o.id, label: o.label, description: o.description, promptText: o.promptText };
        const visual = optionVisualFromDraft(o.visual);
        if (visual) option.visual = visual;
        if (o.rationale.trim()) option.rationale = o.rationale.trim();
        if (o.feasibility) option.feasibility = { rating: o.feasibility.rating, reasons: o.feasibility.reasons };
        return option;
      });
      const dim: ElementDimension = { id: d.id, label: d.label, question: d.question, options };
      if (d.multiple) dim.multiple = true;
      return dim;
    })
    .filter((d) => d.options.length > 0);
}

export function climateFromResult(result: z.infer<typeof ClimateResultSchema>, now = Date.now()): ClimateProfile {
  const profile: ClimateProfile = {
    hardinessZone: result.hardinessZone,
    summary: result.summary,
    notes: result.notes,
    source: 'ai',
    updatedAt: now,
  };
  if (result.lastFrost) profile.lastFrost = result.lastFrost;
  if (result.firstFrost) profile.firstFrost = result.firstFrost;
  if (result.annualRainfallIn != null) profile.annualRainfallIn = result.annualRainfallIn;
  return profile;
}

/** Recommendations with fresh ids; target zones limited to `zoneIds`. */
export function recommendationsFromResult(result: RecommendResult, zoneIds: ReadonlySet<string>): Recommendation[] {
  return result.recommendations.map((r) => {
    const rec: Recommendation = {
      id: newId('rec'),
      title: r.title,
      prompt: r.prompt,
      why: r.why,
      category: r.category,
      targetZoneIds: [...new Set(r.targetZoneIds.filter((id) => zoneIds.has(id)))],
    };
    if (r.elementType) rec.elementType = r.elementType;
    return rec;
  });
}

/** The project's location in the API's shape (null when nothing is known). */
export function locationForApi(location: ProjectLocation | undefined | null): PlanRequest['location'] {
  if (!location) return null;
  const zip = location.zip?.trim() || null;
  const hardinessZone = location.hardinessZone?.trim() || location.climate?.hardinessZone?.trim() || null;
  const notes = location.notes?.trim() || null;
  return zip || hardinessZone || notes ? { zip, hardinessZone, notes } : null;
}

/** One-paragraph climate summary for prompts (null when the project has no climate profile). */
export function climateSummaryText(location: ProjectLocation | undefined | null): string | null {
  const c = location?.climate;
  if (!c) return null;
  const parts = [`USDA zone ${c.hardinessZone}.`, c.summary.trim()];
  if (c.lastFrost || c.firstFrost) parts.push(`Frost: last ${c.lastFrost ?? 'unknown'}, first ${c.firstFrost ?? 'unknown'}.`);
  if (c.annualRainfallIn != null) parts.push(`About ${c.annualRainfallIn} in of rain a year.`);
  if (c.notes.length) parts.push(`Notes: ${c.notes.join('; ')}.`);
  return parts.filter(Boolean).join(' ').slice(0, 4000);
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** Categorize the photo and map zones / paths / architecture. `image` is the photo (any size; downscaled for AI). */
export async function analyzeScene(
  photo: Pick<Photo, 'width' | 'height'>,
  image: Blob,
  opts: { spaceTypeHint?: SpaceType | null; notes?: string | null; signal?: AbortSignal } = {},
): Promise<SceneMap> {
  if (opts.signal?.aborted) throw cancelledError();
  const dataUrl = await blobToAIDataUrl(image);
  const { data, headers } = await studioPost(
    API_PATHS.scene,
    SceneRequestSchema,
    { image: dataUrl, width: photo.width, height: photo.height, spaceTypeHint: opts.spaceTypeHint ?? null, notes: opts.notes ?? null },
    SceneResultSchema,
    STUDIO_TIMEOUTS_MS.scene,
    opts.signal,
  );
  return sceneFromResult(data, photo, headers.get('x-mode-model') ?? 'claude');
}

/** Growing conditions for a ZIP / zone (AI knowledge). */
export async function fetchClimate(req: ClimateRequest, signal?: AbortSignal): Promise<ClimateProfile> {
  const { data } = await studioPost(API_PATHS.climate, ClimateRequestSchema, req, ClimateResultSchema, STUDIO_TIMEOUTS_MS.climate, signal);
  return climateFromResult(data);
}

/**
 * Tailored choice dimensions for an element (AI), already converted to
 * ElementDimension (visuals resolved). Pass the element's current dimensions
 * as `builtin` to get them merged (AI options first, new dimensions appended);
 * `drafts` carries the raw AI output for callers that merge themselves.
 */
export async function fetchElementOptions(
  req: ElementOptionsRequest,
  signal?: AbortSignal,
  builtin?: ElementDimension[],
): Promise<{ dimensions: ElementDimension[]; tips: string[]; drafts: ElementOptionsResult['dimensions'] }> {
  const { data } = await studioPost(
    API_PATHS.elementOptions,
    ElementOptionsRequestSchema,
    req,
    ElementOptionsResultSchema,
    STUDIO_TIMEOUTS_MS.elementOptions,
    signal,
  );
  const dimensions = builtin ? mergeDimensions(builtin, data.dimensions) : dimensionsFromDrafts(data.dimensions);
  return { dimensions, tips: data.tips, drafts: data.dimensions };
}

/** Recommendations with fresh ids (targetZoneIds filtered to the zones sent). */
export async function fetchRecommendations(req: RecommendRequest, signal?: AbortSignal): Promise<Recommendation[]> {
  const { data } = await studioPost(API_PATHS.recommend, RecommendRequestSchema, req, RecommendResultSchema, STUDIO_TIMEOUTS_MS.recommend, signal);
  return recommendationsFromResult(data, new Set(req.zones.map((z) => z.id)));
}

/** Reads an inspiration image (downscaled for AI). */
export async function describeIdea(image: Blob, note: string | null, signal?: AbortSignal): Promise<DescribeIdeaResult> {
  if (signal?.aborted) throw cancelledError();
  const dataUrl = await blobToAIDataUrl(image, 1024);
  const { data } = await studioPost(
    API_PATHS.describeIdea,
    DescribeIdeaRequestSchema,
    { image: dataUrl, note: note?.trim() ? note.trim().slice(0, 2000) : null },
    DescribeIdeaResultSchema,
    STUDIO_TIMEOUTS_MS.describeIdea,
    signal,
  );
  return data;
}

export async function planVariations(req: PlanRequest, signal?: AbortSignal): Promise<PlanResult> {
  const { data } = await studioPost(API_PATHS.plan, PlanRequestSchema, req, PlanResultSchema, STUDIO_TIMEOUTS_MS.plan, signal);
  return data;
}

export async function renderVariation(req: RenderVariationRequest, signal?: AbortSignal): Promise<RenderVariationResult> {
  const { data } = await studioPost(
    API_PATHS.renderVariation,
    RenderVariationRequestSchema,
    req,
    RenderVariationResultSchema,
    STUDIO_TIMEOUTS_MS.render,
    signal,
  );
  return data;
}
