/** Totals and exports (CSV, printable HTML) for the asset list. */
import type { AssetListCategory, AssetListItem, Project } from '../../shared/types';

export interface AssetListTotals {
  count: number;
  /** Sum of quantity × unitCost over rows with a cost. */
  total: number;
  byCategory: Record<AssetListCategory, number>;
  /** Rows without a unit cost. */
  unpriced: number;
}

export declare function assetListTotals(items: readonly AssetListItem[]): AssetListTotals;

/** RFC 4180 CSV with header: Category,Item,Specs,Quantity,Unit,Unit cost,Line total,Spaces,Status,Vendor,Link,Notes */
export declare function assetListToCSV(items: readonly AssetListItem[], project: Project): string;

/** Self-contained printable HTML document (inline CSS), grouped by category with subtotals and swatches. */
export declare function assetListToPrintHTML(items: readonly AssetListItem[], project: Project): string;

/** A row parsed from user CSV input (before ids / timestamps are assigned). */
export type ParsedAssetRow = Omit<AssetListItem, 'id' | 'createdAt' | 'spaceIds' | 'source' | 'locked'>;

/**
 * Parses a user-supplied CSV (e.g. exported from a spreadsheet) into rows.
 * Header names are matched case-insensitively and loosely: item/name, category,
 * qty/quantity, unit, unit cost/price/cost, specs/description, vendor/store,
 * link/url, notes, status. Unknown categories map to 'other'; missing quantity = 1.
 * Also accepts this app's own CSV export. Throws Error('…') if no name column is found.
 */
export declare function parseAssetListCSV(text: string): ParsedAssetRow[];
