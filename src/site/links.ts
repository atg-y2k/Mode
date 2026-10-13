/**
 * One-click verification links to native-plant finders and extension plant
 * databases. None of these sites has an API and some forbid automated access
 * (MoBot's terms), so Mode only builds URLs the user opens in a new tab —
 * no scraping, no prefetching.
 */
import { parseBotanical } from './invasives';
import { normalizeZip } from './zip';

export interface LinkOut {
  label: string;
  url: string;
  /** What the link checks — lets the UI group or pick icons. */
  kind?: 'native' | 'plant' | 'deer';
  /** One line for a tooltip. */
  description?: string;
}

/** Strips cultivar names and parentheticals: "Boxwood 'Green Velvet' (dwarf)" → "Boxwood". */
function shortName(name: string): string {
  return name
    .replace(/\s*['‘’"“”].*?(['‘’"“”]|$)/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const q = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');

/** One-click verification links (open in a new tab; no scraping). */
export function plantLinkOuts(opts: { zip?: string; botanical?: string; common?: string }): { label: string; url: string }[] {
  return plantLinks(opts);
}

/** plantLinkOuts with the extra `kind` / `description` fields. */
export function plantLinks(opts: { zip?: string; botanical?: string; common?: string }): LinkOut[] {
  const zip = normalizeZip(opts.zip);
  const parsed = parseBotanical(opts.botanical);
  // Search by species ("Berberis thunbergii") — cultivar names rarely match these databases.
  const sci = parsed ? `${parsed.genus[0].toUpperCase()}${parsed.genus.slice(1)} ${parsed.epithet}` : undefined;
  const common = opts.common ? shortName(opts.common) : '';
  const name = sci ?? (common || undefined);
  const links: LinkOut[] = [];
  if (zip) {
    links.push({
      label: 'Native plants for my ZIP (NWF)',
      url: `https://nativeplantfinder.nwf.org/Plants?zip=${zip}`,
      kind: 'native',
      description: 'National Wildlife Federation Native Plant Finder — natives ranked by the caterpillars they host',
    });
    links.push({
      label: 'Plants for birds (Audubon)',
      url: `https://www.audubon.org/native-plants/search?zipcode=${zip}`,
      kind: 'native',
      description: 'Audubon Native Plants Database — natives for birds near you, with local nurseries',
    });
  }
  if (name) {
    links.push({
      label: 'NC State Plant Toolbox',
      url: `https://plants.ces.ncsu.edu/find_a_plant/?q=${q(name)}`,
      kind: 'plant',
      description: 'Zones, light, size, and resistance to deer, drought and pests',
    });
    links.push({
      label: 'Missouri Botanical Garden',
      url: `https://www.missouribotanicalgarden.org/PlantFinder/PlantFinderSearchResults.aspx?basic=${encodeURIComponent(name)}`,
      kind: 'plant',
      description: 'MoBot Plant Finder — culture notes, problems and garden uses',
    });
  }
  // Rutgers' list is searched by common name or genus; without a plant, link the whole list.
  const deerKey = common || (parsed ? `${parsed.genus[0].toUpperCase()}${parsed.genus.slice(1)}` : '');
  if (zip || name) {
    links.push({
      label: 'Deer resistance (Rutgers)',
      url: deerKey ? `https://extension.rutgers.edu/deer-resistant-plants?keys=${q(deerKey)}` : 'https://extension.rutgers.edu/deer-resistant-plants',
      kind: 'deer',
      description: 'Rutgers NJAES landscape plants rated A (rarely damaged) to D (frequently damaged); Northeast ratings',
    });
  }
  return links;
}
