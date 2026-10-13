/**
 * Real store products for the idea board:
 *
 * - search: Claude + web search restricted to the chosen stores' domains, then
 *   a structured extraction call; products survive only when their URL
 *   appeared in the search data (never invented), images/prices are completed
 *   from the product pages' structured data when possible.
 * - from-url: SSRF-safe fetch of a pasted link, JSON-LD Product / OpenGraph
 *   parsing, Claude reading the trimmed page text as a fallback, 'partial'
 *   when the site blocks us.
 * - image proxy: SSRF-safe image download (image/* only, ≤ 8 MB).
 */
import type {
  ProductFromUrlResponse,
  ProductResult,
  ProductSearchRequest,
  ProductSearchResult,
} from '../../shared/api';
import { ProductResultSchema, ProductSearchResultSchema } from '../../shared/api';
import type { AssetCategory, StoreKind } from '../../shared/types';
import { isToolVersionError, structured, webSearchTurn, type ClaudeUsage, type StudioClaude, type WebSearchToolType } from './claude';
import { StudioError } from './errors';
import { PRODUCT_SYSTEM_PROMPT, productExtractionPrompt, productPagePrompt, productSearchPrompt } from './prompts';
import { FetchFailure, SsrfError, safeFetch, type ResolveHost, type SafeFetchResult, type Transport } from './ssrf';
import { mapLimit, sniffImageMime, type SniffedImageMime } from './util';

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/** Reputable US online nurseries searched for kind 'nursery' (incl. native-plant specialists). */
export const NURSERY_DOMAINS: Record<string, string> = {
  'naturehills.com': 'Nature Hills Nursery',
  'fast-growing-trees.com': 'Fast Growing Trees',
  'monrovia.com': 'Monrovia',
  'provenwinners.com': 'Proven Winners',
  'springhillnursery.com': 'Spring Hill Nursery',
  'waysidegardens.com': 'Wayside Gardens',
  'highcountrygardens.com': 'High Country Gardens',
  'americanmeadows.com': 'American Meadows',
  'prairiemoon.com': 'Prairie Moon Nursery',
  'prairienursery.com': 'Prairie Nursery',
  'izelplants.com': 'Izel Native Plants',
  'gardengoodsdirect.com': 'Garden Goods Direct',
  'plantaddicts.com': 'Plant Addicts',
};

const STORE_DOMAINS: Record<Exclude<StoreKind, 'nursery' | 'other'>, Record<string, string>> = {
  'home-depot': { 'homedepot.com': 'The Home Depot' },
  lowes: { 'lowes.com': "Lowe's" },
};

const STORE_DISPLAY: Record<StoreKind, string> = {
  'home-depot': 'The Home Depot',
  lowes: "Lowe's",
  nursery: 'Online nurseries',
  other: 'Other stores',
};

/** Domains to search for the chosen stores; null = unrestricted ('other' chosen). */
export function allowedDomainsFor(stores: readonly StoreKind[]): string[] | null {
  if (stores.includes('other')) return null;
  const domains = new Set<string>();
  for (const s of stores) {
    const map = s === 'nursery' ? NURSERY_DOMAINS : STORE_DOMAINS[s as 'home-depot' | 'lowes'];
    Object.keys(map).forEach((d) => domains.add(d));
  }
  return [...domains];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Seller kind and display name for a product URL. */
export function storeForUrl(url: string): { storeKind: StoreKind; store: string } | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const [kind, map] of Object.entries(STORE_DOMAINS) as [StoreKind, Record<string, string>][]) {
    for (const [domain, name] of Object.entries(map)) if (matchDomain(host, domain)) return { storeKind: kind, store: name };
  }
  for (const [domain, name] of Object.entries(NURSERY_DOMAINS)) if (matchDomain(host, domain)) return { storeKind: 'nursery', store: name };
  return null;
}

/** Comparison key for URLs: host without www + path without trailing slash (query and hash ignored). */
export function urlKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTML parsing (JSON-LD Product, OpenGraph / meta tags)
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', reg: '®', trade: '™', deg: '°' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return attrs;
}

/** <meta property|name="…" content="…"> pairs (first occurrence wins), plus <title> as "title". */
export function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = parseAttributes(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (key && a.content != null && !(key in meta)) meta[key] = a.content.trim();
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title && !meta.title) meta.title = decodeEntities(title[1]).replace(/\s+/g, ' ').trim();
  return meta;
}

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1]
      .trim()
      .replace(/^<!--|-->$/g, '')
      .replace(/^\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>$/g, '')
      .trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      try {
        // Unescaped control characters inside strings are a common publisher bug.
        out.push(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')));
      } catch {
        /* unreadable block */
      }
    }
  }
  return out;
}

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function typesOf(node: JsonObject): string[] {
  const t = node['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^.*[/#]/, ''));
}

function findProductNode(root: unknown, depth = 0): JsonObject | null {
  if (depth > 6 || root == null) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const found = findProductNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(root)) return null;
  const types = typesOf(root);
  if (types.includes('Product') || types.includes('ProductGroup') || types.includes('IndividualProduct')) return root;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const found = findProductNode(root[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function text(v: unknown): string | null {
  if (typeof v === 'string') return decodeEntities(v).replace(/\s+/g, ' ').trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (isObject(v)) return text(v.name ?? v['@value']);
  return null;
}

function absoluteHttpUrl(value: string, base: string): string | null {
  try {
    const u = new URL(value, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function imageOf(v: unknown, base: string): string | null {
  if (typeof v === 'string') return absoluteHttpUrl(v.trim(), base);
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = imageOf(item, base);
      if (found) return found;
    }
    return null;
  }
  if (isObject(v)) return imageOf(v.url ?? v.contentUrl ?? v['@id'], base);
  return null;
}

function priceNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

interface OfferPrice {
  low: number;
  high: number;
  currency: string | null;
}

function offerPrice(v: unknown, depth = 0): OfferPrice | null {
  if (depth > 4 || v == null) return null;
  if (Array.isArray(v)) {
    const prices = v.map((o) => offerPrice(o, depth + 1)).filter((p): p is OfferPrice => p != null);
    if (!prices.length) return null;
    return { low: Math.min(...prices.map((p) => p.low)), high: Math.max(...prices.map((p) => p.high)), currency: prices[0].currency };
  }
  if (!isObject(v)) return null;
  const currency = text(v.priceCurrency);
  const low = priceNumber(v.lowPrice) ?? priceNumber(v.price);
  const high = priceNumber(v.highPrice) ?? low;
  if (low != null) return { low, high: high ?? low, currency };
  const spec = offerPrice(v.priceSpecification, depth + 1);
  if (spec) return { ...spec, currency: spec.currency ?? currency };
  return offerPrice(v.offers, depth + 1);
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Fields read from a product page (structured data and meta tags). */
export interface PageProduct {
  name: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  priceText: string | null;
  siteName: string | null;
  specs: string[];
  /** True when a JSON-LD Product was found. */
  structured: boolean;
}

/**
 * Role-like labels ("Homeowner:", "System:", "Assistant:"…) in store text. Page
 * text reaches the plan prompts through the idea board; prompts.ts frames it
 * as untrusted data, and this is defence in depth only.
 */
const ROLE_LABEL = /\b(homeowner|system|assistant|user|human|developer)\s*:/gi;

/** Store text for Mode: one line, role labels defused ("Homeowner:" → "Homeowner -"), at most `max` characters. */
export function storeText(value: string, max: number): string {
  const line = value
    .replace(/\s+/g, ' ')
    .replace(ROLE_LABEL, (_m, word: string) => `${word} -`)
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const SPEC_KEY_MAX = 40;
const SPEC_VALUE_MAX = 120;

export function parseProductPage(html: string, pageUrl: string): PageProduct {
  const meta = extractMeta(html);
  let node: JsonObject | null = null;
  for (const block of jsonLdBlocks(html)) {
    node = findProductNode(block);
    if (node) break;
  }

  let name = node ? text(node.name) : null;
  let brand = node ? text(node.brand) ?? text(node.manufacturer) : null;
  let description = node ? text(node.description) : null;
  let imageUrl = node ? imageOf(node.image, pageUrl) : null;
  let priceUsd: number | null = null;
  let priceText: string | null = null;
  const specs: string[] = [];

  if (node) {
    const offers = offerPrice(node.offers) ?? (Array.isArray(node.hasVariant) ? offerPrice(node.hasVariant.map((v) => (isObject(v) ? v.offers : null))) : null);
    if (offers && (!offers.currency || offers.currency.toUpperCase() === 'USD')) {
      priceUsd = offers.low;
      priceText = offers.high > offers.low ? `${usd(offers.low)}–${usd(offers.high)}` : usd(offers.low);
    }
    if (Array.isArray(node.additionalProperty)) {
      for (const p of node.additionalProperty) {
        if (!isObject(p)) continue;
        const k = text(p.name);
        const v = text(p.value);
        if (k && v) specs.push(`${storeText(k, SPEC_KEY_MAX)}: ${storeText(v, SPEC_VALUE_MAX)}`);
        if (specs.length >= 8) break;
      }
    }
    for (const key of ['size', 'color', 'material', 'height']) {
      const v = text(node[key]);
      if (v && specs.length < 8) specs.push(`${key[0].toUpperCase()}${key.slice(1)}: ${storeText(v, SPEC_VALUE_MAX)}`);
    }
  }

  name ??= meta['og:title'] ?? meta['twitter:title'] ?? meta.title ?? null;
  description ??= meta['og:description'] ?? meta.description ?? null;
  brand ??= meta['product:brand'] ?? meta['og:brand'] ?? null;
  imageUrl ??= [meta['og:image:secure_url'], meta['og:image'], meta['twitter:image'], meta['twitter:image:src']]
    .map((u) => (u ? absoluteHttpUrl(u, pageUrl) : null))
    .find((u): u is string => u != null) ?? null;
  if (priceUsd == null) {
    const amount = priceNumber(meta['product:price:amount'] ?? meta['og:price:amount']);
    const currency = (meta['product:price:currency'] ?? meta['og:price:currency'] ?? 'USD').toUpperCase();
    if (amount != null && currency === 'USD') {
      priceUsd = amount;
      priceText = usd(amount);
    }
  }

  return {
    name: name ? storeText(name, 200) || null : null,
    brand: brand ? storeText(brand, 120) || null : null,
    description: description ? storeText(description, 600) || null : null,
    imageUrl,
    priceUsd,
    priceText,
    siteName: meta['og:site_name'] ?? null,
    specs,
    structured: node != null && name != null,
  };
}

/** Visible text of a page (scripts, styles and tags removed), whitespace collapsed. */
export function pageText(html: string, maxChars = 24000): string {
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(body)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, maxChars);
}

/** Absolute http(s) image URLs on the page (meta images first), for Claude to choose from. */
export function pageImages(html: string, pageUrl: string, max = 20): string[] {
  const meta = extractMeta(html);
  const urls = new Set<string>();
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image']) {
    const u = meta[key] ? absoluteHttpUrl(meta[key], pageUrl) : null;
    if (u) urls.add(u);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (urls.size >= max) break;
    const a = parseAttributes(m[0]);
    const src = a['data-src'] ?? a.src;
    if (!src || src.startsWith('data:')) continue;
    if (/sprite|logo|icon|pixel|spacer|badge|rating/i.test(src)) continue;
    const u = absoluteHttpUrl(src, pageUrl);
    if (u) urls.add(u);
  }
  return [...urls].slice(0, max);
}

// ---------------------------------------------------------------------------
// Heuristics for pages read without AI
// ---------------------------------------------------------------------------

const CATEGORY_WORDS: [AssetCategory, RegExp][] = [
  ['lighting', /\b(light|lights|lighting|lamp|lantern|sconce|pendant|chandelier|fixture|led|bulb|spotlight|floodlight|uplight)\b/i],
  ['plant', /\b(plant|plants|tree|shrub|perennial|grass|hydrangea|boxwood|rose|hosta|fern|lavender|maple|arborvitae|evergreen|nursery|gallon pot|qt\.? pot|bare root|seeds?)\b/i],
  ['furniture', /\b(chair|chairs|table|sofa|bench|loveseat|ottoman|sectional|lounger|stool|dining set)\b/i],
  ['hardscape', /\b(paver|pavers|flagstone|stone|gravel|edging|brick|concrete|retaining|landscape block|stepping stone|mulch)\b/i],
  ['decor', /\b(planter|pot|rug|mirror|wall art|vase|pillow|cushion|fountain|birdbath|sculpture|decor)\b/i],
];

export function guessCategory(textToScan: string): AssetCategory {
  for (const [category, re] of CATEGORY_WORDS) if (re.test(textToScan)) return category;
  return 'other';
}

/** "/p/Hampton-Bay-12-Light-Bronze-Path-Light/301234567" → "Hampton Bay 12 Light Bronze Path Light". */
export function nameFromUrl(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').map((s) => decodeURIComponent(s));
    const best = segments
      .map((s) => s.replace(/\.(html?|aspx|php)$/i, ''))
      .filter((s) => /[a-z]/i.test(s) && /[-_ ]/.test(s))
      .sort((a, b) => b.length - a.length)[0];
    if (!best) return new URL(url).hostname.replace(/^www\./, '');
    return best
      .replace(/[-_]+/g, ' ')
      .replace(/\b\d{6,}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return 'Product';
  }
}

function plantFromText(t: string): ProductResult['plant'] {
  const zones = /zones?\s*:?\s*(\d{1,2})\s*[ab]?\s*(?:-|–|to|through)\s*(\d{1,2})/i.exec(t);
  const sun = /\b(full sun(?:\s*(?:to|\/|-)\s*part(?:ial)? (?:sun|shade))?|part(?:ial)? (?:sun|shade)|full shade|shade)\b/i.exec(t);
  const water = /\b(low|medium|moderate|high|average) water\b/i.exec(t);
  const size = /mature (?:size|height)\s*:?\s*([^.\n]{3,60})/i.exec(t);
  if (!zones && !sun && !size) return null;
  return {
    botanical: null,
    sun: sun ? sun[1].toLowerCase() : null,
    water: water ? water[1].toLowerCase() : null,
    zones: zones ? `${zones[1]}-${zones[2]}` : null,
    matureSize: size ? size[1].trim() : null,
  };
}

function lightFromText(t: string): ProductResult['light'] {
  const kelvin = /\b(\d{4})\s?k\b/i.exec(t);
  const lumens = /\b(\d{2,5})\s?(?:lumens|lm)\b/i.exec(t);
  const outdoor = /\b(outdoor|exterior|landscape|path|garden|wet location|weather)/i.test(t);
  const indoor = /\b(indoor|interior|ceiling|bathroom|kitchen|bedroom|dining)\b/i.test(t);
  return {
    kelvin: kelvin ? Number(kelvin[1]) : null,
    lumens: lumens ? Number(lumens[1]) : null,
    indoor: indoor || !outdoor,
    outdoor,
  };
}

/** A ProductResult from what could be read without AI. */
export function productFromPage(url: string, page: PageProduct | null): ProductResult {
  const store = storeForUrl(url);
  const host = hostOf(url) ?? 'store';
  const name = page?.name?.replace(/\s*[|–-]\s*(The Home Depot|Lowe'?s|Nature Hills.*)$/i, '').trim() || nameFromUrl(url);
  const scan = `${name} ${page?.description ?? ''} ${page?.specs.join(' ') ?? ''}`;
  const category = guessCategory(scan);
  return {
    name,
    brand: page?.brand ?? null,
    store: store?.store ?? page?.siteName ?? host,
    storeKind: store?.storeKind ?? 'other',
    url,
    imageUrl: page?.imageUrl ?? null,
    priceUsd: page?.priceUsd ?? null,
    priceText: page?.priceText ?? null,
    category,
    description: page?.description ?? '',
    realHeightFt: null,
    specs: page?.specs ?? [],
    plant: category === 'plant' ? plantFromText(scan) : null,
    light: category === 'lighting' ? lightFromText(scan) : null,
  };
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

export interface ProductDeps {
  claude: StudioClaude | null;
  model: string;
  /** Network for user-supplied URLs (default: SSRF-pinned node transport). */
  transport?: Transport;
  resolveHost?: ResolveHost;
  webSearchTool?: WebSearchToolType;
  onUsage?: (u: ClaudeUsage) => void;
  log?: (line: string) => void;
}

const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 10_000;
const ENRICH_TIMEOUT_MS = 6_000;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function fetchPage(url: string, deps: ProductDeps, signal: AbortSignal | undefined, timeoutMs = PAGE_TIMEOUT_MS): Promise<SafeFetchResult> {
  return safeFetch(url, {
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    maxBytes: PAGE_MAX_BYTES,
    timeoutMs,
    signal,
    transport: deps.transport,
    resolveHost: deps.resolveHost,
  });
}

function ssrfToStudio(err: SsrfError): StudioError {
  return new StudioError('bad_request', err.message, 400);
}

/** Collected search evidence: result URLs/titles, Claude's notes, code-execution output. */
export interface SearchEvidence {
  results: { url: string; title: string; pageAge: string | null }[];
  text: string;
  extra: string;
  /** urlKey → original URL for every URL that appeared in the search data. */
  seen: Map<string, string>;
}

const URL_RE = /https?:\/\/[^\s"'<>()\]\\]+/g;

/** Walks web-search turn blocks (results, cited text, dynamic-filtering output) and collects the evidence. */
export function collectSearchEvidence(blocks: readonly unknown[]): SearchEvidence {
  const results: SearchEvidence['results'] = [];
  const seen = new Map<string, string>();
  const texts: string[] = [];
  const extras: string[] = [];
  const remember = (url: string) => {
    const clean = url.replace(/[.,;:!?]+$/, '');
    const key = urlKey(clean);
    if (key && !seen.has(key)) seen.set(key, clean);
  };

  for (const block of blocks) {
    if (!isObject(block)) continue;
    const type = block.type;
    if (type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (!isObject(r) || typeof r.url !== 'string') continue;
        results.push({ url: r.url, title: typeof r.title === 'string' ? r.title : '', pageAge: typeof r.page_age === 'string' ? r.page_age : null });
        remember(r.url);
      }
    } else if (type === 'text' && typeof block.text === 'string') {
      let t = block.text;
      if (Array.isArray(block.citations)) {
        const cited = block.citations
          .filter(isObject)
          .map((c) => (typeof c.url === 'string' ? c.url : null))
          .filter((u): u is string => u != null);
        cited.forEach(remember);
        if (cited.length) t += ` [sources: ${[...new Set(cited)].join(' ')}]`;
      }
      texts.push(t);
    } else if (typeof type === 'string' && type.endsWith('code_execution_tool_result') && isObject(block.content)) {
      const stdout = block.content.stdout;
      if (typeof stdout === 'string' && stdout.trim()) {
        extras.push(stdout.slice(0, 20000));
        for (const m of stdout.matchAll(URL_RE)) remember(m[0]);
      }
    }
  }
  return { results, text: texts.join('\n').trim(), extra: extras.join('\n---\n'), seen };
}

/** Keeps products whose URL appeared in the search data (rewritten to that exact URL) on allowed domains. */
export function filterFoundProducts(
  products: ProductResult[],
  evidence: SearchEvidence,
  allowed: string[] | null,
  maxPriceUsd: number | null,
): ProductResult[] {
  const out: ProductResult[] = [];
  const used = new Set<string>();
  const evidenceText = `${evidence.text}\n${evidence.extra}`;
  for (const p of products) {
    const key = urlKey(p.url);
    const original = key ? evidence.seen.get(key) : undefined;
    if (!key || !original || used.has(key)) continue;
    const host = hostOf(original);
    if (!host || (allowed && !allowed.some((d) => matchDomain(host, d)))) continue;
    if (maxPriceUsd != null && p.priceUsd != null && p.priceUsd > maxPriceUsd) continue;
    used.add(key);
    const store = storeForUrl(original);
    // An image URL is kept only when it appeared in the research data (pages are enriched later).
    const imageUrl = p.imageUrl && evidenceText.includes(p.imageUrl) && /^https?:\/\//.test(p.imageUrl) ? p.imageUrl : null;
    out.push({
      ...p,
      url: original,
      imageUrl,
      store: store?.store ?? (p.store.trim() || host),
      storeKind: store?.storeKind ?? 'other',
      priceUsd: p.priceUsd != null && Number.isFinite(p.priceUsd) && p.priceUsd > 0 ? p.priceUsd : null,
      realHeightFt: p.realHeightFt != null && p.realHeightFt > 0 && p.realHeightFt < 200 ? p.realHeightFt : null,
      specs: p.specs.map((s) => s.trim()).filter(Boolean).slice(0, 8),
    });
  }
  return out;
}

/** Fills missing images / prices from the product pages' structured data (best effort, short timeouts). */
async function enrichFromPages(products: ProductResult[], deps: ProductDeps, signal: AbortSignal | undefined): Promise<ProductResult[]> {
  const targets = products.map((p, i) => ({ p, i })).filter(({ p }) => !p.imageUrl || p.priceUsd == null).slice(0, 8);
  const updated = [...products];
  await mapLimit(targets, 4, async ({ p, i }) => {
    if (signal?.aborted) return;
    try {
      const page = await fetchPage(p.url, deps, signal, ENRICH_TIMEOUT_MS);
      if (page.status < 200 || page.status >= 300 || !page.contentType.includes('html')) return;
      const info = parseProductPage(page.body.toString('utf8'), page.url);
      updated[i] = {
        ...p,
        imageUrl: p.imageUrl ?? info.imageUrl,
        priceUsd: p.priceUsd ?? info.priceUsd,
        priceText: p.priceText ?? info.priceText,
        brand: p.brand ?? info.brand,
      };
    } catch {
      /* stores often block automated requests; keep what the search found */
    }
  });
  return updated;
}

export async function searchProducts(
  req: ProductSearchRequest,
  deps: ProductDeps & { claude: StudioClaude },
  signal: AbortSignal | undefined,
  timedOut?: () => boolean,
): Promise<ProductSearchResult> {
  const allowed = allowedDomainsFor(req.stores);
  const storeNames = req.stores.map((s) => STORE_DISPLAY[s]);
  const base = {
    system: PRODUCT_SYSTEM_PROMPT,
    text: productSearchPrompt(req, storeNames),
    effort: 'medium' as const,
    signal,
    timedOut,
    onUsage: deps.onUsage,
  };

  let turn;
  const toolType = deps.webSearchTool ?? 'web_search_20260209';
  try {
    turn = await webSearchTurn(deps.claude, deps.model, { ...base, task: 'products:search', toolType, maxUses: 6, allowedDomains: allowed });
  } catch (err) {
    if (!isToolVersionError(err) || toolType === 'web_search_20250305') throw err;
    deps.log?.('[mode] web_search_20260209 rejected; retrying with web_search_20250305');
    turn = await webSearchTurn(deps.claude, deps.model, {
      ...base,
      task: 'products:search',
      toolType: 'web_search_20250305',
      maxUses: 6,
      allowedDomains: allowed,
    });
  }

  const evidence = collectSearchEvidence(turn.blocks);
  const today = new Date().toISOString().slice(0, 10);
  if (!evidence.seen.size) {
    return {
      products: [],
      notes: [evidence.text ? evidence.text.slice(0, 300) : 'No matching product pages were found at the selected stores. Try a broader search or another store.'],
    };
  }

  const extracted = await structured(deps.claude, deps.model, {
    task: 'products:extract',
    schema: ProductSearchResultSchema,
    system: PRODUCT_SYSTEM_PROMPT,
    text: productExtractionPrompt(req, evidence, today),
    effort: 'medium',
    signal,
    timedOut,
    onUsage: deps.onUsage,
  });

  const found = filterFoundProducts(extracted.data.products, evidence, allowed, req.maxPriceUsd);
  const products = await enrichFromPages(found.slice(0, 12), deps, signal);
  const notes = extracted.data.notes.map((n) => n.trim()).filter(Boolean).slice(0, 4);
  if (!notes.some((n) => /price/i.test(n))) notes.push(`Prices and availability as found on ${today}; check the store for current details.`);
  return { products, notes };
}

export async function productFromUrl(
  rawUrl: string,
  deps: ProductDeps,
  signal: AbortSignal | undefined,
  beforeAiCall: () => Promise<void>,
  timedOut?: () => boolean,
): Promise<ProductFromUrlResponse> {
  let page: SafeFetchResult | null = null;
  try {
    page = await fetchPage(rawUrl, deps, signal);
  } catch (err) {
    if (err instanceof SsrfError) throw ssrfToStudio(err);
    if (err instanceof FetchFailure && err.kind === 'aborted') throw new StudioError('bad_request', 'The request was cancelled.', 499);
    // Timeouts, oversize pages and network errors: return what the URL itself tells us.
    page = null;
  }

  const finalUrl = page?.url ?? rawUrl;
  const usable = page && page.status >= 200 && page.status < 300 && /html|xml/.test(page.contentType);
  if (!page || !usable) {
    if (page && (page.status === 404 || page.status === 410)) {
      throw new StudioError('bad_request', `That page doesn't exist (HTTP ${page.status}). Check the link.`, 400);
    }
    return { product: productFromPage(finalUrl, null), method: 'partial' };
  }

  const html = page.body.toString('utf8');
  const parsed = parseProductPage(html, finalUrl);
  if (parsed.structured) return { product: productFromPage(finalUrl, parsed), method: 'structured-data' };

  if (deps.claude) {
    await beforeAiCall();
    const meta = Object.entries(extractMeta(html))
      .filter(([k]) => /^(og:|product:|twitter:|title$|description$)/.test(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const images = pageImages(html, finalUrl);
    const result = await structured(deps.claude, deps.model, {
      task: 'products:from-url',
      schema: ProductResultSchema,
      system: PRODUCT_SYSTEM_PROMPT,
      text: productPagePrompt({ url: finalUrl, meta, text: pageText(html), images }),
      effort: 'low',
      signal,
      timedOut,
      onUsage: deps.onUsage,
    });
    const store = storeForUrl(finalUrl);
    const p = result.data;
    return {
      product: {
        ...p,
        url: finalUrl,
        imageUrl: p.imageUrl && images.includes(p.imageUrl) ? p.imageUrl : (parsed.imageUrl ?? images[0] ?? null),
        store: store?.store ?? (p.store.trim() || parsed.siteName || hostOf(finalUrl) || 'Store'),
        storeKind: store?.storeKind ?? p.storeKind,
        priceUsd: p.priceUsd != null && p.priceUsd > 0 ? p.priceUsd : null,
      },
      method: 'ai',
    };
  }
  return { product: productFromPage(finalUrl, parsed), method: 'partial' };
}

const PROXY_IMAGE_TYPES = new Set<SniffedImageMime>(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/** Downloads a product image (SSRF-safe, ≤ 8 MB, raster images only). */
export async function fetchProductImage(
  rawUrl: string,
  deps: Pick<ProductDeps, 'transport' | 'resolveHost'>,
  signal: AbortSignal | undefined,
): Promise<{ mime: SniffedImageMime; bytes: Buffer }> {
  let res: SafeFetchResult;
  try {
    res = await safeFetch(rawUrl, {
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
      maxBytes: IMAGE_MAX_BYTES,
      timeoutMs: 15_000,
      signal,
      transport: deps.transport,
      resolveHost: deps.resolveHost,
    });
  } catch (err) {
    if (err instanceof SsrfError) throw ssrfToStudio(err);
    if (err instanceof FetchFailure) {
      if (err.kind === 'too-large') throw new StudioError('payload_too_large', 'That image is larger than 8 MB.', 413);
      if (err.kind === 'aborted') throw new StudioError('bad_request', 'The request was cancelled.', 499);
      throw new StudioError('upstream_error', err.kind === 'timeout' ? 'The store took too long to send the image.' : "Couldn't download the image from the store.", 502);
    }
    throw err;
  }
  if (res.status < 200 || res.status >= 300) {
    throw new StudioError('upstream_error', `The store refused the image download (HTTP ${res.status}).`, 502);
  }
  // The bytes decide (CDNs often label images binary/octet-stream); SVG and anything else is refused.
  const sniffed = sniffImageMime(res.body.subarray(0, 32));
  if (!sniffed || !PROXY_IMAGE_TYPES.has(sniffed)) {
    throw new StudioError('bad_request', 'That link is not a JPEG, PNG, WebP, GIF or AVIF image.', 400);
  }
  return { mime: sniffed, bytes: res.body };
}
