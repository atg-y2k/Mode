/**
 * Introduced & invasive plants from USGS US-RIIS v2.0 (CC0), bundled as
 * public/data/invasives.json by scripts/build-site-data.mjs.
 *
 * US-RIIS is national/regional: one status per locality — the lower 48 states
 * (L48), Alaska (AK), Hawaii (HI). Its categories describe how far a species
 * has spread on its own, not whether a state regulates it:
 *   1 established (C3)        reproduces outside cultivation;
 *   2 invasive (D2)           self-sustaining populations far from where it was introduced;
 *   3 widespread invasive (E) spreads across many sites and habitats.
 *
 * Matching normalizes scientific names (cultivar names, authors, "ssp."/"subsp.",
 * "var.", hybrid "×"/"x" markers) and resolves synonyms listed by US-RIIS
 * ("Pennisetum setaceum" → Cenchrus setaceus). A cultivar or variety of a
 * listed species inherits the species' status.
 *
 * The data loads once per page; `findInvasive` / `invasiveStatusSync` are
 * synchronous and return null until it has loaded (feasibility rating stays
 * synchronous). Nothing runs at import time, so Node (the server imports the
 * design knowledge) never fetches.
 */
import { canFetchRelative, fetchDataJson } from './data';

export type Locality = 'L48' | 'AK' | 'HI';
/** 0 = not listed, 1 = established, 2 = invasive, 3 = widespread invasive. */
export type RiisLevel = 0 | 1 | 2 | 3;

export const LOCALITY_NAMES: Record<Locality, string> = { L48: 'the lower 48 states', AK: 'Alaska', HI: 'Hawaii' };
export const RIIS_LEVEL_LABELS: Record<RiisLevel, string> = {
  0: 'not listed',
  1: 'established (introduced, not invasive)',
  2: 'invasive',
  3: 'widespread invasive',
};
export const RIIS_SOURCE = 'USGS US-RIIS v2.0';

/** Shape of public/data/invasives.json. */
export interface InvasivesData {
  rows: [name: string, common: string, status: string, synonyms?: string][];
  source?: string;
  generated?: string;
}

/** A US-RIIS entry matched to a queried name. */
export interface InvasiveMatch {
  /** Accepted name in US-RIIS, e.g. "Cenchrus setaceus". */
  name: string;
  common: string;
  status: Record<Locality, RiisLevel>;
  /**
   * exact — the name itself; synonym — a synonym US-RIIS lists; species — the
   * query is a variety/subspecies/cultivar of the listed species;
   * infraspecific — only a variety/subspecies of the queried species is listed.
   */
  match: 'exact' | 'synonym' | 'species' | 'infraspecific';
  /** The query as parsed, e.g. "Berberis thunbergii var. atropurpurea". */
  query: string;
}

export interface InvasiveVerdict {
  /** True when listed invasive (D2) or widespread invasive (E) in the locality. */
  invasive: boolean;
  /** US-RIIS level in the locality (worst listed form for an infraspecific match). */
  level: RiisLevel;
  note?: string;
  match?: InvasiveMatch;
}

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

export interface ParsedName {
  genus: string;
  epithet: string;
  rank?: 'subsp.' | 'var.' | 'f.';
  infra?: string;
  /** "genus epithet[ rank infra]" in lower case — the lookup key. */
  key: string;
  /** "genus epithet". */
  binomial: string;
  /** Display form: "Genus epithet[ rank infra]". */
  display: string;
}

const RANKS: Record<string, ParsedName['rank']> = {
  ssp: 'subsp.',
  'ssp.': 'subsp.',
  subsp: 'subsp.',
  'subsp.': 'subsp.',
  subspecies: 'subsp.',
  var: 'var.',
  'var.': 'var.',
  variety: 'var.',
  f: 'f.',
  'f.': 'f.',
  fo: 'f.',
  'fo.': 'f.',
  forma: 'f.',
};
const HYBRID = new Set(['x', '×']);
const NOT_EPITHET = new Set(['sp', 'sp.', 'spp', 'spp.', 'species', 'cv', 'cv.', 'hybrid', 'hybrids', 'and', 'or', 'syn', 'syn.']);

/**
 * Parses a scientific name into genus + species epithet (+ one infraspecific
 * rank). Ignores cultivar names ('Green Velvet'), trade names in capitals,
 * author citations and parenthetical notes. Null for anything that isn't at
 * least "Genus species" (e.g. "Miscanthus spp.", common names).
 */
export function parseBotanical(name: string | null | undefined): ParsedName | null {
  if (typeof name !== 'string') return null;
  const cleaned = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(['‘’"“”]).*?(['‘’"“”]|$)/g, ' ') // 'Cultivar' / "Cultivar"
    .replace(/\([^)]*\)?/g, ' ') // (syn. …), (micro types), (L.) authors
    .replace(/\b(cv|cultivar)\.?\s+\S+/gi, ' ')
    .replace(/×/g, ' × ')
    .trim();
  const tokens = cleaned.split(/[\s,;]+/).filter(Boolean);
  let i = 0;
  if (HYBRID.has(tokens[i]?.toLowerCase())) i++; // nothogenus marker: "× Cupressocyparis"
  const genus = tokens[i++];
  if (!genus || !/^[a-z][a-z-]+$/i.test(genus)) return null;
  if (HYBRID.has(tokens[i]?.toLowerCase())) i++; // hybrid species: "Mentha × piperita", "Mentha X piperita"
  const epithet = tokens[i++]?.toLowerCase();
  if (!epithet || !/^[a-z][a-z-]+$/.test(epithet) || NOT_EPITHET.has(epithet)) return null;
  // Optional infraspecific rank anywhere after the epithet (authors may sit in between).
  let rank: ParsedName['rank'];
  let infra: string | undefined;
  for (; i < tokens.length - 1; i++) {
    const r = RANKS[tokens[i].toLowerCase()];
    const next = tokens[i + 1].toLowerCase();
    if (r && /^[a-z][a-z-]+$/.test(next)) {
      rank = r;
      infra = next;
      break;
    }
  }
  const g = genus.toLowerCase();
  const binomial = `${g} ${epithet}`;
  const key = rank ? `${binomial} ${rank} ${infra}` : binomial;
  const display = `${g[0].toUpperCase()}${g.slice(1)} ${epithet}${rank ? ` ${rank} ${infra}` : ''}`;
  return { genus: g, epithet, rank, infra, key, binomial, display };
}

/**
 * Splits strings that name several plants — "Festuca arundinacea + Poa
 * pratensis", "Zoysia japonica / Cynodon dactylon", "Festuca rubra, F.
 * trachyphylla, F. ovina" — into separate names, expanding abbreviated genera.
 */
export function splitBotanicalNames(text: string | null | undefined): string[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const stripped = text.replace(/\([^)]*\)/g, ' ');
  const parts = stripped
    .split(/\s*(?:\+|\/|,|;|&|\band\b|\bor\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let lastGenus = '';
  for (const p of parts) {
    const abbr = /^([A-Z])\.\s*(.+)$/.exec(p);
    let name = p;
    if (abbr && lastGenus && lastGenus[0].toUpperCase() === abbr[1]) name = `${lastGenus} ${abbr[2]}`;
    const genus = /^[×x]?\s*([A-Z][a-z-]+)/.exec(name)?.[1];
    if (genus) lastGenus = genus;
    out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Index & loading
// ---------------------------------------------------------------------------

interface Entry {
  name: string;
  common: string;
  status: Record<Locality, RiisLevel>;
}

interface Index {
  /** Normalized key → entry (+ whether it was reached through a synonym). */
  byKey: Map<string, { entry: Entry; synonym: boolean }>;
  /** Binomial → listed varieties/subspecies of it. */
  infraByBinomial: Map<string, Entry[]>;
  size: number;
}

let index: Index | null = null;
let loading: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function level(ch: string | undefined): RiisLevel {
  const n = Number(ch);
  return n === 1 || n === 2 || n === 3 ? n : 0;
}

function buildIndex(data: InvasivesData): Index {
  const byKey: Index['byKey'] = new Map();
  const infraByBinomial: Index['infraByBinomial'] = new Map();
  const synonyms: [string, Entry][] = [];
  for (const row of data.rows) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
    const [name, common, status, syn] = row;
    const entry: Entry = {
      name,
      common: typeof common === 'string' ? common : '',
      status: { L48: level(status?.[0]), AK: level(status?.[1]), HI: level(status?.[2]) },
    };
    const parsed = parseBotanical(name);
    if (!parsed) continue;
    byKey.set(parsed.key, { entry, synonym: false });
    if (parsed.rank) {
      const list = infraByBinomial.get(parsed.binomial) ?? [];
      list.push(entry);
      infraByBinomial.set(parsed.binomial, list);
    }
    if (typeof syn === 'string' && syn) for (const s of syn.split('|')) synonyms.push([s, entry]);
  }
  // Accepted names win over synonyms that collide with them.
  for (const [s, entry] of synonyms) {
    const parsed = parseBotanical(s);
    if (parsed && !byKey.has(parsed.key)) byKey.set(parsed.key, { entry, synonym: true });
  }
  return { byKey, infraByBinomial, size: data.rows.length };
}

/** Validates the JSON shape (throws on anything unexpected). */
export function parseInvasivesData(json: unknown): InvasivesData {
  const rows = (json as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('invasives.json: missing rows.');
  return json as InvasivesData;
}

/** Installs data directly (tests, or a caller that already fetched it). Null clears it. */
export function setInvasivesData(data: InvasivesData | null): void {
  index = data ? buildIndex(data) : null;
  loading = null;
  if (index) for (const fn of listeners) fn();
}

/** True once the US-RIIS list is in memory. */
export function invasivesReady(): boolean {
  return index !== null;
}

/** Number of plant names loaded (0 until loaded). */
export function invasivesCount(): number {
  return index?.size ?? 0;
}

/** Runs `fn` when the list finishes loading (returns an unsubscribe function). */
export function onInvasivesLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Loads public/data/invasives.json once (concurrent calls share the request).
 * Resolves false when it can't be loaded (offline before first load, Node);
 * a later call retries.
 */
export function loadInvasives(): Promise<boolean> {
  if (index) return Promise.resolve(true);
  if (loading) return loading;
  if (!canFetchRelative()) return Promise.resolve(false);
  loading = fetchDataJson('invasives.json')
    .then((json) => {
      setInvasivesData(parseInvasivesData(json));
      return true;
    })
    .catch(() => {
      loading = null;
      return false;
    });
  return loading;
}

/** Starts loading in the background when running in a page (no-op in Node or when loaded). */
export function ensureInvasivesLoading(): void {
  if (!index && !loading && canFetchRelative()) void loadInvasives();
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * The US-RIIS entry for a scientific name (synchronous; null when not listed,
 * unparseable, or the list hasn't loaded yet — see invasivesReady()).
 */
export function findInvasive(botanical: string | null | undefined): InvasiveMatch | null {
  if (!index) return null;
  const parsed = parseBotanical(botanical);
  if (!parsed) return null;
  const hit = index.byKey.get(parsed.key);
  if (hit) return { ...hit.entry, match: hit.synonym ? 'synonym' : 'exact', query: parsed.display };
  if (parsed.rank) {
    const species = index.byKey.get(parsed.binomial);
    if (species) return { ...species.entry, match: 'species', query: parsed.display };
  }
  const forms = index.infraByBinomial.get(parsed.binomial);
  if (forms?.length) {
    // The most widespread listed form, reported per locality.
    const worst = forms.reduce((a, b) => (b.status.L48 > a.status.L48 ? b : a));
    return { ...worst, match: 'infraspecific', query: parsed.display };
  }
  return null;
}

function label(m: InvasiveMatch): string {
  return m.common ? `${m.common} (${m.name})` : m.name;
}

/** Plain-language verdict for one match in one locality. */
export function describeInvasive(m: InvasiveMatch, locality: Locality = 'L48'): InvasiveVerdict {
  const lvl = m.status[locality];
  const where = LOCALITY_NAMES[locality];
  if (m.match === 'infraspecific') {
    // Only a variety/subspecies is listed — not a verdict on the whole species.
    if (lvl < 2) return { invasive: false, level: 0, match: m };
    return {
      invasive: false,
      level: 0,
      match: m,
      note: `${m.name} (a form of this species) is listed as ${RIIS_LEVEL_LABELS[lvl]} in ${where} by ${RIIS_SOURCE} — check which form you buy`,
    };
  }
  if (lvl >= 2) {
    const listed = `listed as ${lvl === 3 ? 'a widespread invasive' : 'invasive'} in ${where}`;
    const note =
      m.match === 'species'
        ? `${m.query} is a form of ${label(m)}, which is ${listed} (${RIIS_SOURCE})`
        : `${label(m)} is ${listed} (${RIIS_SOURCE}${m.match === 'synonym' ? `; also known as ${m.query}` : ''})`;
    return { invasive: true, level: lvl, match: m, note };
  }
  if (lvl === 1) {
    return { invasive: false, level: 1, match: m, note: `Introduced and established in ${where}, not listed as invasive (${RIIS_SOURCE})` };
  }
  const elsewhere = (Object.keys(m.status) as Locality[]).filter((l) => l !== locality && m.status[l] >= 2);
  return {
    invasive: false,
    level: 0,
    match: m,
    note: elsewhere.length
      ? `Not listed in ${where}; invasive in ${elsewhere.map((l) => LOCALITY_NAMES[l]).join(' and ')} (${RIIS_SOURCE})`
      : undefined,
  };
}

/**
 * Synchronous status: null until the list has loaded or when the name isn't a
 * parseable scientific name; `{ invasive: false }` when it isn't listed.
 */
export function invasiveStatusSync(botanical: string | null | undefined, locality: Locality = 'L48'): InvasiveVerdict | null {
  if (!index || !parseBotanical(botanical)) return null;
  const m = findInvasive(botanical);
  return m ? describeInvasive(m, locality) : { invasive: false, level: 0 };
}

/**
 * True when the scientific name (or a synonym / genus+species prefix) is
 * flagged invasive in the locality (default: the lower 48). Loads the list on
 * first use. Null when the list can't be loaded or the name can't be parsed.
 */
export async function invasiveStatus(
  botanical: string,
  locality: Locality = 'L48',
): Promise<{ invasive: boolean; note?: string } | null> {
  await loadInvasives();
  const v = invasiveStatusSync(botanical, locality);
  if (!v) return null;
  return v.note ? { invasive: v.invasive, note: v.note } : { invasive: v.invasive };
}
