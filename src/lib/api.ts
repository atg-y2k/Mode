/**
 * Typed client for the Mode API server (see shared/api.ts). Validates responses
 * with the shared zod schemas and throws ApiError with the server's error code.
 */
import type {
  AnalyzeRequest,
  ApiErrorCode,
  AssetListRequest,
  AssetListResult,
  DesignSuggestion,
  GenerateAssetRequest,
  GeneratedAsset,
  HealthResponse,
  RenderRequest,
  RenderResponse,
  SpaceAnalysisResult,
  SuggestRequest,
} from '../../shared/api';

export declare class ApiError extends Error {
  readonly code: ApiErrorCode | 'network';
  readonly status: number;
  constructor(code: ApiErrorCode | 'network', message: string, status: number);
}

/** Never throws: returns a disabled health object when the server is unreachable. */
export declare function getHealth(): Promise<HealthResponse>;
export declare function analyzePhoto(req: AnalyzeRequest, signal?: AbortSignal): Promise<SpaceAnalysisResult>;
export declare function suggestDesign(req: SuggestRequest, signal?: AbortSignal): Promise<DesignSuggestion>;
export declare function generateAssetListAI(req: AssetListRequest, signal?: AbortSignal): Promise<AssetListResult>;
export declare function generateAsset(req: GenerateAssetRequest, signal?: AbortSignal): Promise<GeneratedAsset>;
export declare function renderAI(req: RenderRequest, signal?: AbortSignal): Promise<RenderResponse>;
