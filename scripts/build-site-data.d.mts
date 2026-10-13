// Types for the pure builders exported by build-site-data.mjs (used by src/site/buildSiteData.test.ts).
export const PHZM_URL: string;
export const RIIS_ITEM_URL: string;
export const RIIS_STATUS: Record<string, 1 | 2 | 3>;
export const LOCALITIES: ['L48', 'AK', 'HI'];
export function readZipEntry(zip: Buffer, name: string): Buffer;
export function parseCsv(text: string): string[][];
export function buildZones(all: unknown): {
  source: string;
  count: number;
  skipped: number;
  zips: Record<string, [string, number, number]>;
  [key: string]: unknown;
};
export function buildInvasives(csvText: string): {
  source: string;
  license: string;
  count: number;
  sourceRows: number;
  rows: [string, string, string, string?][];
  [key: string]: unknown;
};
