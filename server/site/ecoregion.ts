/**
 * US EPA Level III ecoregion for a point (public domain ArcGIS REST service of
 * the EPA Office of Research and Development; no key). Optional context for
 * plant advice ("Northern Piedmont"); the site profile simply omits it when
 * the service is down or the point is outside the mapped area.
 */
export const EPA_ECOREGION_URL =
  'https://geodata.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer/11/query';

export function ecoregionUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    geometry: `${lon.toFixed(6)},${lat.toFixed(6)}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'US_L3NAME',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${EPA_ECOREGION_URL}?${params.toString()}`;
}

/** Thrown for ArcGIS error payloads (they arrive with HTTP 200). */
export class EcoregionFormatError extends Error {}

/** The Level III name, or null when the point isn't in any ecoregion polygon. */
export function parseEcoregion(json: unknown): string | null {
  if (!json || typeof json !== 'object') throw new EcoregionFormatError('The EPA ecoregion service sent an unexpected answer.');
  const o = json as { error?: { message?: unknown }; features?: unknown };
  if (o.error) throw new EcoregionFormatError(`The EPA ecoregion service failed: ${String(o.error.message ?? 'error')}`);
  if (!Array.isArray(o.features)) throw new EcoregionFormatError('The EPA ecoregion service sent no features.');
  for (const f of o.features) {
    const name = (f as { attributes?: { US_L3NAME?: unknown } } | null)?.attributes?.US_L3NAME;
    if (typeof name === 'string' && name.trim()) return name.trim().replace(/\s+/g, ' ');
  }
  return null;
}
