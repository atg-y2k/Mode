/**
 * USDA NRCS Soil Data Access (SSURGO, public domain, no key): the soil map
 * unit under a point and a planting-relevant summary of it.
 *
 * One POST to https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest with
 * a fixed SQL template. The map unit comes from SDA's documented point
 * function SDA_Get_Mukey_from_intersection_with_WktWgs84('point(lon lat)');
 * the query returns every component of that map unit with its horizons that
 * start in the top 30 cm. Coordinates are numbers formatted by this module —
 * nothing user-typed reaches the SQL.
 *
 * Summary rules:
 * - mapUnit: the map unit name ("Glenelg silt loam, 8 to 15 percent slopes").
 * - Properties come from the dominant component (largest share); when that is
 *   a miscellaneous area without data (e.g. "Urban land") the largest other
 *   MAJOR component with data is used; minor inclusions never speak for the lot.
 * - drainage: drainage class, lower case ("well drained"); hydroGroup: A–D or dual ("B/D").
 * - ph (1:1 water) and clayPct: depth-weighted means over 0–30 cm (the
 *   planting root zone), from horizons that report them.
 * - disturbed: the map unit or one of its major components is Urban land,
 *   Udorthents, Arents, made / cut-and-fill land, pits or dumps — the survey
 *   says little about a built-on lot, so a soil test is the better guide.
 */
import type { SiteProfile } from '../../shared/types';

export const SDA_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
/** Depth (cm) of the root zone summarised for pH and clay. */
export const ROOT_ZONE_CM = 30;

const DISTURBED_RE = /\b(urban land|udorthents?|arents|made land|cut and fill|fill land|pits|dumps|landfill)\b/i;

/** The fixed SQL for a point (lat/lon must be finite; they are formatted to 6 decimals). */
export function soilQuery(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new RangeError('soilQuery: invalid coordinates');
  }
  const point = `point(${lon.toFixed(6)} ${lat.toFixed(6)})`;
  return [
    'SELECT mu.mukey, mu.muname, c.cokey, c.compname, c.compkind, c.comppct_r, c.majcompflag, c.drainagecl, c.hydgrp,',
    'h.hzdept_r, h.hzdepb_r, h.ph1to1h2o_r, h.claytotal_r',
    'FROM mapunit AS mu',
    'INNER JOIN component AS c ON c.mukey = mu.mukey',
    `LEFT OUTER JOIN chorizon AS h ON h.cokey = c.cokey AND h.hzdept_r < ${ROOT_ZONE_CM}`,
    `WHERE mu.mukey IN (SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${point}'))`,
    'ORDER BY mu.mukey, c.comppct_r DESC, c.cokey, h.hzdept_r',
  ].join(' ');
}

/** Request body for SDA (JSON with a header row of column names). */
export function soilRequestBody(lat: number, lon: number): string {
  return JSON.stringify({ query: soilQuery(lat, lon), format: 'JSON+COLUMNNAME' });
}

export interface SdaRow {
  mukey: string;
  muname: string;
  cokey: string;
  compname: string;
  compkind: string | null;
  comppct: number | null;
  major: boolean;
  drainage: string | null;
  hydgrp: string | null;
  top: number | null;
  bottom: number | null;
  ph: number | null;
  clay: number | null;
}

/** Thrown when SDA answers with something that isn't its table format. */
export class SdaFormatError extends Error {}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Parses SDA's {"Table": [[columns…], [row…]…]} (an empty object = no map unit at the point). */
export function parseSdaResponse(json: unknown): SdaRow[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new SdaFormatError('Soil Data Access sent an unexpected answer.');
  const table = (json as { Table?: unknown }).Table;
  if (table === undefined) return [];
  if (!Array.isArray(table) || table.length === 0 || !Array.isArray(table[0])) throw new SdaFormatError('Soil Data Access sent an unexpected table.');
  const columns = (table[0] as unknown[]).map((c) => String(c).toLowerCase());
  const col = (name: string) => columns.indexOf(name);
  const required = ['mukey', 'muname', 'cokey', 'compname'];
  if (required.some((r) => col(r) < 0)) throw new SdaFormatError('Soil Data Access left out expected columns.');
  const at = (row: unknown[], name: string): unknown => (col(name) >= 0 ? row[col(name)] : null);
  const rows: SdaRow[] = [];
  for (const raw of table.slice(1)) {
    if (!Array.isArray(raw)) continue;
    const mukey = str(at(raw, 'mukey'));
    const cokey = str(at(raw, 'cokey'));
    if (!mukey || !cokey) continue;
    rows.push({
      mukey,
      muname: str(at(raw, 'muname')) ?? '',
      cokey,
      compname: str(at(raw, 'compname')) ?? '',
      compkind: str(at(raw, 'compkind')),
      comppct: num(at(raw, 'comppct_r')),
      major: str(at(raw, 'majcompflag'))?.toLowerCase() === 'yes',
      drainage: str(at(raw, 'drainagecl')),
      hydgrp: str(at(raw, 'hydgrp')),
      top: num(at(raw, 'hzdept_r')),
      bottom: num(at(raw, 'hzdepb_r')),
      ph: num(at(raw, 'ph1to1h2o_r')),
      clay: num(at(raw, 'claytotal_r')),
    });
  }
  return rows;
}

interface Component {
  name: string;
  kind: string | null;
  pct: number;
  major: boolean;
  drainage: string | null;
  hydgrp: string | null;
  horizons: { top: number; bottom: number; ph: number | null; clay: number | null }[];
}

/** Depth-weighted mean of `pick` over 0..ROOT_ZONE_CM, from horizons that report it; null when none do. */
function rootZoneMean(horizons: Component['horizons'], pick: (h: Component['horizons'][number]) => number | null): number | null {
  let sum = 0;
  let weight = 0;
  for (const h of horizons) {
    const value = pick(h);
    if (value === null) continue;
    const thickness = Math.min(h.bottom, ROOT_ZONE_CM) - Math.max(h.top, 0);
    if (thickness <= 0) continue;
    sum += value * thickness;
    weight += thickness;
  }
  return weight > 0 ? sum / weight : null;
}

const hasData = (c: Component) =>
  c.drainage !== null || c.hydgrp !== null || c.horizons.some((h) => h.ph !== null || h.clay !== null);

/** The soil summary for the first map unit in `rows`, or null when there is none (no survey, open water offshore). */
export function summarizeSoil(rows: readonly SdaRow[]): NonNullable<SiteProfile['soil']> | null {
  if (rows.length === 0) return null;
  const mukey = rows[0].mukey;
  const unit = rows.filter((r) => r.mukey === mukey);
  const mapUnit = unit[0].muname || 'Unnamed soil map unit';

  const components: Component[] = [];
  const byKey = new Map<string, Component>();
  for (const r of unit) {
    let c = byKey.get(r.cokey);
    if (!c) {
      c = { name: r.compname, kind: r.compkind, pct: r.comppct ?? 0, major: r.major, drainage: r.drainage, hydgrp: r.hydgrp, horizons: [] };
      byKey.set(r.cokey, c);
      components.push(c);
    }
    if (r.top !== null && r.bottom !== null && r.bottom > r.top) c.horizons.push({ top: r.top, bottom: r.bottom, ph: r.ph, clay: r.clay });
  }
  components.sort((a, b) => b.pct - a.pct);

  const disturbed = DISTURBED_RE.test(mapUnit) || components.some((c) => c.major && DISTURBED_RE.test(c.name));
  const dominant = components[0];
  const source = dominant && hasData(dominant) ? dominant : components.find((c) => c.major && hasData(c));

  const soil: NonNullable<SiteProfile['soil']> = { mapUnit };
  if (source) {
    if (source.drainage) soil.drainage = source.drainage.toLowerCase();
    const ph = rootZoneMean(source.horizons, (h) => h.ph);
    if (ph !== null && ph >= 0 && ph <= 14) soil.ph = Math.round(ph * 10) / 10;
    const clay = rootZoneMean(source.horizons, (h) => h.clay);
    if (clay !== null && clay >= 0 && clay <= 100) soil.clayPct = Math.round(clay);
    if (source.hydgrp) soil.hydroGroup = source.hydgrp;
  }
  soil.disturbed = disturbed;
  return soil;
}
