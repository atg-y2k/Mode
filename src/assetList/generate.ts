/**
 * Rule-based asset list generation: walks every space → photo → ACTIVE design
 * and turns treatments, placed objects and lights into shopping-list rows.
 * Works fully offline; the AI endpoint can enrich the result afterwards.
 */
import type { AssetListDraft } from '../../shared/api';
import type { AssetDef, AssetListItem, MaterialDef, PaintColor, Project } from '../../shared/types';
import type { Mask } from '../engine/types';

export interface GenerateContext {
  project: Project;
  getMask(maskId: string): Mask | undefined;
  getAsset(id: string): AssetDef | undefined;
  getMaterial(id: string): MaterialDef | undefined;
  getPaint(id: string): PaintColor | undefined;
}

/**
 * Rows (source 'generated', status 'planned', locked false) with stable
 * `generatorKey`s, e.g. "paint:#5a6b7c:eggshell", "material:oak-wide-plank",
 * "asset:boxwood-green-velvet", "supplies:painting-kit".
 * - Paint: one row per color+finish across the project (areas summed, coats
 *   respected, quantity via paintToBuy, unit 'gal'), plus primer when needed,
 *   plus a painting-supplies row (rollers, brushes, tape, drop cloths).
 * - Materials: one row per material (sq ft with waste; mulch/gravel in cu yd/tons).
 * - Objects & light fixtures: one row per asset id with counts.
 * Unknown areas produce rows with quantity 0 and a note asking to calibrate.
 */
export declare function generateAssetList(ctx: GenerateContext): AssetListItem[];

/**
 * Regenerate semantics: keep every manual / ai / locked row; replace unlocked
 * generated rows by generatorKey (carrying over status, vendor, url, notes);
 * drop unlocked generated rows whose key is gone; append new keys.
 */
export declare function mergeGeneratedItems(existing: AssetListItem[], generated: AssetListItem[]): AssetListItem[];

/** Converts AI drafts to rows (source 'ai'), resolving spaceNames to space ids. */
export declare function draftsToItems(drafts: AssetListDraft[], project: Project): AssetListItem[];

/**
 * Human-readable design summary for AI prompts: per space/photo/active design,
 * regions with treatments (color names, hex, finish, material names) and
 * estimated areas, placed objects with counts, lights with kelvin, lighting look.
 */
export declare function designSummaryText(ctx: GenerateContext, options?: { photoId?: string }): string;
