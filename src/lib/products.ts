/**
 * Real store products (Home Depot, Lowe's, nurseries): search, import from a
 * pasted link, fetch the product image, and turn a product into a placeable
 * library asset. Talks to the API server (see shared/api.ts §Real store products).
 */
import type { ProductResult, ProductSearchRequest, ProductSearchResult } from '../../shared/api';
import type { AssetDef } from '../../shared/types';

/** AI web search limited to the requested stores. Throws ApiError (code 'ai_disabled' when AI is off). */
export declare function searchProducts(req: ProductSearchRequest, signal?: AbortSignal): Promise<ProductSearchResult>;

/**
 * Reads a pasted product link. Works without AI for pages with structured data;
 * `method: 'partial'` means some fields are missing and the user should fill them in.
 */
export declare function productFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<{ product: ProductResult; method: 'structured-data' | 'ai' | 'partial' }>;

/** Downloads a product image through the server (avoids CORS). */
export declare function fetchProductImage(imageUrl: string, signal?: AbortSignal): Promise<Blob>;

/**
 * Builds a library asset (source 'user') from a product. The caller stores the
 * cut-out image blob under `imageId` (store.addLibraryAsset(asset, blob)).
 * Category, realHeightFt (default by category when unknown), plant/light info
 * and ProductInfo are mapped from the product.
 */
export declare function productToAsset(product: ProductResult, image: { imageId: string; aspect: number }): AssetDef;
