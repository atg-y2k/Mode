/**
 * Lazy access to the built-in catalog (src/assets/catalog) for prompts and id
 * validation. Loaded on the first AI request and memoized: the summary text
 * must stay byte-identical across calls so the system prompt is cached.
 */
import type { CatalogIndex } from './postprocess';

export interface CatalogAccess extends CatalogIndex {
  /** catalogSummaryForAI() output. */
  summary(): string;
}

let builtin: Promise<CatalogAccess> | null = null;

export function loadBuiltinCatalog(): Promise<CatalogAccess> {
  builtin ??= import('../src/assets/catalog/index')
    .then((mod): CatalogAccess => {
      const summary = mod.catalogSummaryForAI();
      if (typeof summary !== 'string' || !summary.trim()) throw new Error('catalogSummaryForAI() returned no text');
      return {
        summary: () => summary,
        isMaterial: (id) => mod.getMaterial(id) != null,
        assetCategory: (id) => mod.getBuiltinAsset(id)?.category,
      };
    })
    .catch((err: unknown) => {
      builtin = null; // retry on the next request
      throw err;
    });
  return builtin;
}
