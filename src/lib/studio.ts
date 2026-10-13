/**
 * Typed client for the Studio endpoints (shared/api.ts §Studio) plus the
 * conversions between the AI's normalized coordinates / drafts and the app's
 * domain types. Throws ApiError (from ./api) on failure.
 */
import type {
  ClimateRequest,
  DescribeIdeaResult,
  ElementOptionsRequest,
  PlanRequest,
  PlanResult,
  RecommendRequest,
  RenderVariationRequest,
  RenderVariationResult,
  SceneResult,
} from '../../shared/api';
import type {
  ClimateProfile,
  ElementDimension,
  Photo,
  Recommendation,
  SceneMap,
  SpaceType,
} from '../../shared/types';

/** Categorize the photo and map zones / paths / architecture. `image` is the photo (any size; downscaled for AI). */
export declare function analyzeScene(
  photo: Pick<Photo, 'width' | 'height'>,
  image: Blob,
  opts?: { spaceTypeHint?: SpaceType | null; notes?: string | null; signal?: AbortSignal },
): Promise<SceneMap>;

/** Converts the AI result (normalized coords) into a SceneMap in photo px with fresh ids. */
export declare function sceneFromResult(result: SceneResult, photo: Pick<Photo, 'width' | 'height'>, model: string): SceneMap;

/** Growing conditions for a ZIP / zone (AI knowledge). */
export declare function fetchClimate(req: ClimateRequest, signal?: AbortSignal): Promise<ClimateProfile>;

/** Tailored choice dimensions for an element (AI), already converted to ElementDimension (visuals resolved). */
export declare function fetchElementOptions(
  req: ElementOptionsRequest,
  signal?: AbortSignal,
): Promise<{ dimensions: ElementDimension[]; tips: string[] }>;

/** Recommendations with fresh ids (targetZoneIds filtered to the zones sent). */
export declare function fetchRecommendations(req: RecommendRequest, signal?: AbortSignal): Promise<Recommendation[]>;

/** Reads an inspiration image (downscaled for AI). */
export declare function describeIdea(image: Blob, note: string | null, signal?: AbortSignal): Promise<DescribeIdeaResult>;

export declare function planVariations(req: PlanRequest, signal?: AbortSignal): Promise<PlanResult>;

export declare function renderVariation(req: RenderVariationRequest, signal?: AbortSignal): Promise<RenderVariationResult>;
