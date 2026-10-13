// Types for the pure builders exported by build-frost-data.mjs (used by server/site/freezeTable.test.ts).
export const OUT_FILE: string;
export const NORMALS_ARCHIVE_URL: string;
export const FIELDS: Record<'lastSpring50' | 'lastSpringLate' | 'firstFall50' | 'firstFallEarly' | 'season50', string>;
export const ROW_FIELDS: string[];
export type FreezeRow = [string, number, number, string, string | null, string | null, string | null, string | null, number | null];
export function readTar(chunks: AsyncIterable<Buffer> | Iterable<Buffer>): AsyncGenerator<{ name: string; data: Buffer }>;
export function parseCsvLine(line: string): string[];
export function monthDay(raw: string | undefined): string | null;
export function stationRow(csvText: string): FreezeRow | null;
export function buildFreezeTable(entries: AsyncIterable<{ name: string; data: Buffer }> | Iterable<{ name: string; data: Buffer }>): Promise<{
  version: 1;
  source: string;
  license: string;
  fields: string[];
  notes: string;
  files: number;
  count: number;
  frostFree: number;
  stations: FreezeRow[];
}>;
