/**
 * Offline plant feasibility: can a plant realistically thrive in this spot?
 * Rules (in order of how often they decide the outcome):
 *   1. Hardiness — the property's USDA zone vs the plant's zone range
 *      (one zone outside = caution, two or more = poor).
 *   2. Light — the spot's sun vs the plant's sun list
 *      (one step off = caution, full sun ↔ shade = poor).
 *   3. Space — mature width vs the spot's span (√area).
 *   4. Water vs annual rainfall, deer pressure, invasiveness (cautions).
 * Interior evaluation (houseplants) ignores the zone and reads `sun` as window light.
 *
 * Invasiveness has two sources: a curated list with regional notes (always
 * available) and USGS US-RIIS v2.0 (src/site/invasives, ~4,900 plant names),
 * which loads in the background on first use in the browser. Rating stays
 * synchronous: until US-RIIS has loaded only the curated list applies.
 */
import type { AssetDef, PlantFeasibility, PlantInfo, ProjectLocation, SunExposure } from '../../../shared/types';
import { ensureInvasivesLoading, invasiveStatusSync, splitBotanicalNames, type Locality } from '../../site/invasives';
import type { PlantProfile } from './plants';

/** Deer pressure: the project's setting (low/medium/high) or a yes/no read from climate notes. */
export type DeerPressure = NonNullable<ProjectLocation['deerPressure']>;

export interface FeasibilityContext {
  /** USDA hardiness zone number of the property (e.g. parseZone('7a') → 7; 7.5 for "7b" is read as zone 7). */
  zone?: number;
  /** The zone as the user knows it ("7a"), used in messages; defaults to `zone`. */
  zoneLabel?: string;
  /** Sun exposure of the spot; for interiors, the window light (full = bright direct, part = bright indirect, shade = low light). */
  sun?: SunExposure;
  /** Size of the planting spot in square feet. */
  areaSqFt?: number;
  /** Annual rainfall (inches) from the climate profile. */
  annualRainfallIn?: number;
  /**
   * Deer pressure: 'low' | 'medium' | 'high' (Settings), or true / false when
   * read from climate notes (true = deer browse the area, rated like 'medium').
   * Undefined = unknown.
   */
  deerPressure?: boolean | DeerPressure;
  /** Where the plant goes. Default: exterior (indoor plants default to interior). */
  setting?: 'exterior' | 'interior';
  /** US-RIIS region of the property (from the ZIP); default the lower 48. */
  locality?: Locality;
}

type Level = 'ok' | 'info' | 'caution' | 'poor';
type CheckKind = 'setting' | 'zone' | 'sun' | 'size' | 'water' | 'deer' | 'invasive' | 'siting';

interface Check {
  kind: CheckKind;
  level: Level;
  text: string;
}

const LEVEL_RANK: Record<Level, number> = { ok: 0, info: 0, caution: 1, poor: 2 };
const SUN_RANK: Record<SunExposure, number> = { 'full-sun': 0, 'part-sun': 1, shade: 2 };
const SUN_LABEL: Record<SunExposure, string> = { 'full-sun': 'full sun', 'part-sun': 'part sun', shade: 'shade' };
const LIGHT_LABEL: Record<SunExposure, string> = {
  'full-sun': 'bright, direct light',
  'part-sun': 'bright indirect light',
  shade: 'low light',
};

/** Plants that are invasive or regulated in large parts of the US (botanical or common name). */
const INVASIVE: { re: RegExp; note: string }[] = [
  { re: /berberis thunbergii|japanese barberry/i, note: 'Japanese barberry is invasive across much of the East and Midwest (banned in some states)' },
  { re: /euonymus alatus|burning bush/i, note: 'Burning bush is invasive in the Northeast and Midwest (banned in some states)' },
  { re: /pyrus calleryana|bradford pear|callery pear/i, note: 'Callery (Bradford) pear is invasive in the East and South (banned in some states)' },
  { re: /nandina domestica|heavenly bamboo/i, note: 'Nandina spreads invasively in the Southeast and its berries are toxic to birds — choose fruitless cultivars' },
  { re: /lonicera (japonica|maackii|morrowii|tatarica)/i, note: 'Asian honeysuckles are invasive across much of the US' },
  { re: /hedera (helix|hibernica)|english ivy/i, note: 'English ivy is invasive in the Pacific Northwest and East and climbs into trees' },
  { re: /vinca (minor|major)|periwinkle/i, note: 'Periwinkle escapes into woodlands in many states' },
  { re: /ligustrum (sinense|japonicum|lucidum|vulgare|obtusifolium)|privet/i, note: 'Privet is invasive in the Southeast and mid-Atlantic' },
  { re: /wisteria (sinensis|floribunda)|chinese wisteria|japanese wisteria/i, note: 'Asian wisteria is invasive in the East — native American wisteria (W. frutescens) is the safe look-alike' },
  { re: /miscanthus sinensis|maiden ?grass/i, note: 'Maiden grass self-sows invasively in parts of the East and South — choose sterile cultivars' },
  { re: /buddleja davidii|buddleia davidii|butterfly bush/i, note: 'Butterfly bush is invasive in the Pacific Northwest and parts of the East — choose sterile cultivars' },
  { re: /pennisetum setaceum|cenchrus setaceus/i, note: 'Fountain grass (P. setaceum) is invasive in the Southwest, California and Hawaii' },
  { re: /lantana camara/i, note: 'Lantana camara is invasive in Florida, the Gulf Coast, California and Hawaii' },
  { re: /celastrus orbiculatus|oriental bittersweet/i, note: 'Oriental bittersweet is highly invasive in the East' },
  { re: /elaeagnus (umbellata|angustifolia|pungens)|russian olive|autumn olive/i, note: 'Autumn, Russian and thorny olive are invasive' },
  { re: /rosa multiflora|multiflora rose/i, note: 'Multiflora rose is a noxious weed in many states' },
  { re: /spiraea japonica/i, note: 'Japanese spirea escapes into natural areas in the East — native spireas are a safer choice' },
  { re: /acer platanoides|norway maple/i, note: 'Norway maple is invasive in the Northeast and Pacific Northwest' },
  { re: /ailanthus altissima|tree of heaven/i, note: 'Tree of heaven is a noxious invasive' },
  { re: /pachysandra terminalis/i, note: 'Japanese pachysandra spreads into woodlands in parts of the East' },
  { re: /ampelopsis (brevipedunculata|glandulosa)|porcelain ?berry/i, note: 'Porcelain berry is highly invasive in the East' },
  { re: /phyllostachys|pseudosasa japonica|running bamboo/i, note: 'Running bamboo spreads aggressively — it needs a deep root barrier' },
  { re: /imperata cylindrica|cogongrass|japanese blood grass/i, note: 'Cogongrass (incl. Japanese blood grass) is a federal noxious weed' },
  { re: /ilex crenata|japanese holly/i, note: 'Japanese holly escapes in parts of the mid-Atlantic — inkberry is a native look-alike' },
  { re: /iris pseudacorus|yellow flag iris/i, note: 'Yellow flag iris invades wetlands — avoid near ponds and streams' },
  { re: /lythrum salicaria|purple loosestrife/i, note: 'Purple loosestrife is a noxious weed' },
];

/** Names of invasive plants to steer away from (for AI prompts). */
export const INVASIVE_WATCHLIST = [
  'Japanese barberry', 'burning bush', 'Bradford/Callery pear', 'nandina (fruiting)', 'Asian honeysuckles', 'English ivy', 'periwinkle (vinca)',
  'privet', 'Asian wisteria', 'Miscanthus (fertile)', 'butterfly bush (fertile, PNW)', 'fountain grass (P. setaceum, Southwest)',
  'lantana (Florida/Gulf)', 'oriental bittersweet', 'Russian/autumn olive', 'multiflora rose', 'Norway maple', 'running bamboo',
  'Japanese pachysandra', 'yellow flag iris', 'purple loosestrife',
];

export function invasiveNote(botanical: string | undefined, name = ''): string | undefined {
  const text = `${botanical ?? ''} ${name}`;
  return INVASIVE.find((x) => x.re.test(text))?.note;
}

function fmtFt(ft: number): string {
  return ft < 10 ? String(Math.round(ft * 2) / 2) : String(Math.round(ft));
}

function zoneRange(info: PlantInfo): string {
  return info.zoneMin === info.zoneMax ? `zone ${info.zoneMin}` : `zones ${info.zoneMin}–${info.zoneMax}`;
}

function zoneChecks(info: PlantInfo, ctx: FeasibilityContext): Check[] {
  if (info.zoneMin === undefined && info.zoneMax === undefined) {
    return [{ kind: 'zone', level: 'info', text: 'No hardiness data — check the zone on the plant tag' }];
  }
  const min = info.zoneMin ?? 1;
  const max = info.zoneMax ?? 13;
  const range = zoneRange({ ...info, zoneMin: min, zoneMax: max });
  if (ctx.zone === undefined || !Number.isFinite(ctx.zone)) {
    return [{ kind: 'zone', level: 'info', text: `Rated ${range} — add your ZIP code to confirm it's hardy` }];
  }
  // half zones ("7b" read as 7.5 by some callers) belong to their whole zone
  const z = Math.floor(ctx.zone);
  const you = `you're zone ${ctx.zoneLabel ?? z}`;
  if (z >= min && z <= max) return [{ kind: 'zone', level: 'ok', text: `Hardy in ${range} ✓ (${you})` }];
  if (z === min - 1) {
    return [{ kind: 'zone', level: 'caution', text: `Borderline hardy: rated to zone ${min}, ${you} — needs a sheltered spot and winter mulch` }];
  }
  if (z < min) return [{ kind: 'zone', level: 'poor', text: `Not winter-hardy here: rated ${range}, ${you}` }];
  if (z === max + 1) {
    return [{ kind: 'zone', level: 'caution', text: `At the warm edge of its range (${range}; ${you}) — give it afternoon shade and steady water` }];
  }
  return [{ kind: 'zone', level: 'poor', text: `Too warm for it: rated ${range}, ${you}` }];
}

function sunCheck(info: PlantInfo, spot: SunExposure, indoorLight: boolean): Check {
  const ranks = info.sun.map((s) => SUN_RANK[s]);
  if (ranks.length === 0) return { kind: 'sun', level: 'info', text: 'No light data for this plant' };
  const r = SUN_RANK[spot];
  const label = indoorLight ? LIGHT_LABEL : SUN_LABEL;
  if (ranks.includes(r)) return { kind: 'sun', level: 'ok', text: `Suited to ${label[spot]} ✓` };
  const shadiest = Math.max(...ranks);
  const sunniest = Math.min(...ranks);
  if (r > shadiest) {
    // the spot is darker than the plant tolerates
    const far = r - shadiest >= 2;
    if (indoorLight) {
      const need = label[info.sun.find((s) => SUN_RANK[s] === shadiest) as SunExposure];
      return far
        ? { kind: 'sun', level: 'poor', text: `Needs ${need}; this spot is too dark` }
        : { kind: 'sun', level: 'caution', text: `Wants ${need}; it will grow slowly here` };
    }
    if (far) return { kind: 'sun', level: 'poor', text: 'Needs full sun (6+ h); this spot is shaded most of the day' };
    return shadiest === 0
      ? { kind: 'sun', level: 'caution', text: 'Wants full sun (6+ h); in part sun it flowers less and may sprawl' }
      : { kind: 'sun', level: 'caution', text: 'Needs 3–6 h of sun; in full shade it grows thin and flowers poorly' };
  }
  // the spot is sunnier than the plant tolerates; true shade plants (shade in
  // their range) scorch in full sun even when they tolerate part sun
  const far = sunniest - r >= 2 || (r === 0 && info.sun.includes('shade'));
  if (indoorLight) {
    return far
      ? { kind: 'sun', level: 'poor', text: 'Low-light plant — direct sun will scorch it' }
      : { kind: 'sun', level: 'caution', text: 'Prefers bright indirect light; keep it out of direct sun' };
  }
  if (far) return { kind: 'sun', level: 'poor', text: 'Shade plant — it will scorch in full sun' };
  return sunniest === 1
    ? { kind: 'sun', level: 'caution', text: 'Prefers part shade; in full sun give it afternoon shade and steady water' }
    : { kind: 'sun', level: 'caution', text: 'Shade plant — gentle morning sun only; afternoon sun will scorch it' };
}

function sizeCheck(info: PlantInfo, areaSqFt: number): Check | undefined {
  const w = info.matureWidthFt;
  if (!(w > 0) || !(areaSqFt > 0)) return undefined;
  const span = Math.sqrt(areaSqFt);
  const ratio = w / span;
  if (ratio <= 0.8) return { kind: 'size', level: 'ok', text: `Mature width ~${fmtFt(w)} ft fits this space (~${fmtFt(span)} ft across) ✓` };
  if (ratio <= 1.25) {
    return { kind: 'size', level: 'caution', text: `Mature width ~${fmtFt(w)} ft fills this ~${fmtFt(span)} ft space — one plant, or yearly pruning` };
  }
  return { kind: 'size', level: 'poor', text: `Grows ~${fmtFt(w)} ft wide; this space is only ~${fmtFt(span)} ft across — it will outgrow it` };
}

function waterCheck(info: PlantInfo, rain: number): Check | undefined {
  const r = Math.round(rain);
  if (info.water === 'high' && rain < 30) {
    return { kind: 'water', level: 'caution', text: `Thirsty plant; with ~${r} in of rain a year it needs regular irrigation` };
  }
  if (info.water === 'medium' && rain < 15) {
    return { kind: 'water', level: 'caution', text: `Needs summer watering in this dry climate (~${r} in of rain a year)` };
  }
  if (info.water === 'low' && rain < 20) return { kind: 'water', level: 'ok', text: 'Drought tolerant once established ✓' };
  if (info.water === 'low' && rain > 50 && !info.native && info.type !== 'grass' && info.type !== 'tree') {
    return { kind: 'water', level: 'caution', text: `Needs sharp drainage; with ~${r} in of rain a year plant it high, in gritty soil` };
  }
  return undefined;
}

/** true (deer noted in the climate profile) reads as medium pressure; false as low. */
function deerLevel(pressure: FeasibilityContext['deerPressure']): DeerPressure | undefined {
  if (pressure === true) return 'medium';
  if (pressure === false) return 'low';
  return pressure;
}

/**
 * Deer: with medium or high pressure, deer favorites get a caution (Rutgers-style:
 * prefer plants rated "rarely" or "seldom severely" damaged); low pressure skips
 * deer advice; unknown pressure only notes that deer browse the plant.
 */
function deerCheck(info: PlantInfo, pressure: FeasibilityContext['deerPressure']): Check | undefined {
  const lvl = deerLevel(pressure);
  if (lvl === 'low') return undefined;
  if (info.deerResistant === false) {
    if (lvl === 'high') {
      return { kind: 'deer', level: 'caution', text: 'Deer favorite and deer pressure is high here — it needs fencing or repellent; a deer-resistant plant is the easier choice' };
    }
    if (lvl === 'medium') return { kind: 'deer', level: 'caution', text: 'Deer favorite — protect it or choose a deer-resistant plant' };
    return { kind: 'deer', level: 'info', text: 'Browsed by deer where they are common' };
  }
  if (info.deerResistant === true && lvl) return { kind: 'deer', level: 'ok', text: 'Deer resistant ✓' };
  if (info.deerResistant === undefined && lvl === 'high') {
    return { kind: 'deer', level: 'info', text: 'Deer resistance not rated — check it (e.g. Rutgers deer ratings) before planting' };
  }
  return undefined;
}

/** Lawn grasses and lawn overseeding (they spread by design; the catalog gives them no mature width). */
function isTurf(info: PlantInfo): boolean {
  return (info.type === 'grass' || info.type === 'groundcover') && info.matureWidthFt === 0 && info.matureHeightFt < 1;
}

/**
 * Invasiveness: the curated list first (regional advice), then US-RIIS for the
 * property's region. Listed invasive / widespread invasive → caution (info for
 * lawn grasses, which are meant to spread: keep them out of beds). "Established"
 * (introduced but not invasive) adds nothing. When only some forms of a species
 * are listed, an info note says to check which form is sold.
 */
function invasiveChecks(info: PlantInfo, name: string, ctx: FeasibilityContext): Check[] {
  const curated = invasiveNote(info.botanical, name);
  if (curated) return [{ kind: 'invasive', level: 'caution', text: `Invasive risk: ${curated}` }];
  ensureInvasivesLoading();
  const turf = isTurf(info);
  const out: Check[] = [];
  for (const n of splitBotanicalNames(info.botanical)) {
    const v = invasiveStatusSync(n, ctx.locality ?? 'L48');
    if (!v?.note) continue;
    if (v.invasive) {
      out.push(
        turf
          ? { kind: 'invasive', level: 'info', text: `Spreads beyond the lawn: ${v.note} — keep a clean edge between lawn and beds` }
          : { kind: 'invasive', level: 'caution', text: `Invasive risk: ${v.note} — check your state's invasive plant list before planting` },
      );
    } else if (v.level === 0 && v.match?.match === 'infraspecific') {
      out.push({ kind: 'invasive', level: 'info', text: v.note });
    }
  }
  return out;
}

function sitingCheck(info: PlantInfo): Check | undefined {
  if (info.type !== 'tree' || !(info.matureHeightFt > 0)) return undefined;
  const w = info.matureWidthFt > 0 ? info.matureWidthFt : info.matureHeightFt / 2;
  if (info.matureHeightFt >= 30) {
    return {
      kind: 'siting',
      level: 'info',
      text: `Large tree (~${fmtFt(info.matureHeightFt)} ft): plant ${Math.max(20, Math.round(w / 2))}+ ft from the house, clear of overhead lines`,
    };
  }
  return { kind: 'siting', level: 'info', text: `Plant ${Math.max(8, Math.round(w / 2))}+ ft from the house (mature spread ~${fmtFt(w)} ft)` };
}

/** All checks for one plant in one spot. */
function evaluate(info: PlantInfo, name: string, ctx: FeasibilityContext): Check[] {
  const interior = ctx.setting === 'interior' || (ctx.setting === undefined && info.indoor);
  const out: Check[] = [];
  if (interior) {
    if (!info.indoor) out.push({ kind: 'setting', level: 'poor', text: "Outdoor plant — it won't thrive indoors" });
  } else if (info.indoor) {
    out.push(
      ctx.zone !== undefined && ctx.zone >= 10
        ? { kind: 'setting', level: 'ok', text: 'Can live outdoors year-round in zone 10+ ✓' }
        : { kind: 'setting', level: 'caution', text: 'Houseplant — outdoors only as a summer container; bring it in below 50 °F' },
    );
  } else {
    out.push(...zoneChecks(info, ctx));
  }
  if (ctx.sun) out.push(sunCheck(info, ctx.sun, interior && info.indoor));
  if (ctx.areaSqFt !== undefined) {
    const size = sizeCheck(info, ctx.areaSqFt);
    if (size) out.push(size);
  }
  if (!interior) {
    if (ctx.annualRainfallIn !== undefined && Number.isFinite(ctx.annualRainfallIn)) {
      const water = waterCheck(info, ctx.annualRainfallIn);
      if (water) out.push(water);
    }
    const deer = deerCheck(info, ctx.deerPressure);
    if (deer) out.push(deer);
    out.push(...invasiveChecks(info, name, ctx));
    const siting = sitingCheck(info);
    if (siting) out.push(siting);
  }
  return out;
}

function worstLevel(checks: Check[]): PlantFeasibility['rating'] {
  const worst = checks.reduce((m, c) => Math.max(m, LEVEL_RANK[c.level]), 0);
  return worst === 2 ? 'poor' : worst === 1 ? 'caution' : 'good';
}

/** Problems first (poor, caution), then confirmations (✓), then notes. */
function orderedReasons(checks: Check[]): string[] {
  const order: Level[] = ['poor', 'caution', 'ok', 'info'];
  return order.flatMap((lvl) => checks.filter((c) => c.level === lvl).map((c) => c.text));
}

function feasibilityOf(info: PlantInfo, name: string, ctx: FeasibilityContext): PlantFeasibility {
  const checks = evaluate(info, name, ctx);
  return { rating: worstLevel(checks), reasons: orderedReasons(checks) };
}

/**
 * Offline feasibility of a catalog plant for a spot: zone range vs the
 * property's zone, sun needs vs the zone's sun, mature width vs available area
 * (plus rainfall, deer pressure and invasiveness when known).
 */
export function plantFeasibility(plant: AssetDef, ctx: FeasibilityContext): PlantFeasibility {
  if (!plant.plant) {
    return { rating: 'caution', reasons: ['No plant data — check the hardiness zone, light and mature size on the tag'] };
  }
  return feasibilityOf(plant.plant, plant.name, ctx);
}

/** Feasibility of one built-in plant profile. */
export function profileFeasibility(profile: PlantProfile, ctx: FeasibilityContext): PlantFeasibility {
  return feasibilityOf(profile, profile.name, ctx);
}

/** "Boxwood 'Green Velvet'" → "Boxwood"; cultivar names may contain apostrophes ("Catmint 'Walker's Low'"). */
export function shortPlantName(name: string): string {
  return name
    .replace(/\s*'.*?'(?=\s|$|[,;)])/g, '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Feasibility of an option that implies several plants.
 * mode 'all' — the plants are used together: good only when every plant is
 * good; poor when at least half are poor; otherwise caution (with the
 * problem plants named). mode 'any' — alternatives for different conditions:
 * rated by the best-suited plant.
 */
export function paletteFeasibility(plants: PlantProfile[], mode: 'all' | 'any', ctx: FeasibilityContext): PlantFeasibility | undefined {
  if (plants.length === 0) return undefined;
  const evals = plants.map((p) => {
    const checks = evaluate(p, p.name, ctx);
    return { p, checks, rating: worstLevel(checks) };
  });
  const rank = { good: 0, caution: 1, poor: 2 } as const;
  const firstProblem = (checks: Check[]) =>
    checks.find((c) => c.level === 'poor')?.text ?? checks.find((c) => c.level === 'caution')?.text ?? '';
  const problemLines = (list: typeof evals) => list.map((e) => `${shortPlantName(e.p.name)}: ${firstProblem(e.checks)}`);

  if (mode === 'any') {
    const best = Math.min(...evals.map((e) => rank[e.rating]));
    const winners = evals.filter((e) => rank[e.rating] === best);
    const rating = (['good', 'caution', 'poor'] as const)[best];
    if (rating === 'good') {
      const ok = winners[0].checks.filter((c) => c.level === 'ok' && (c.kind === 'zone' || c.kind === 'sun')).map((c) => c.text);
      return { rating, reasons: [`Best fit here: ${listNames(winners.map((e) => shortPlantName(e.p.name)))} ✓`, ...ok] };
    }
    return { rating, reasons: problemLines(winners) };
  }

  const problems = evals.filter((e) => e.rating !== 'good');
  const poor = evals.filter((e) => e.rating === 'poor').length;
  const rating: PlantFeasibility['rating'] = problems.length === 0 ? 'good' : poor * 2 >= evals.length ? 'poor' : 'caution';
  const reasons = problemLines(problems.sort((a, b) => rank[b.rating] - rank[a.rating]));
  if (problems.length < evals.length) {
    const fine = evals.filter((e) => e.rating === 'good').map((e) => shortPlantName(e.p.name));
    const n = evals.length;
    if (problems.length === 0) {
      const all = (kind: CheckKind) => evals.every((e) => e.checks.some((c) => c.kind === kind && c.level === 'ok'));
      if (all('zone')) reasons.push(`All ${n} hardy in zone ${ctx.zoneLabel ?? ctx.zone} ✓`);
      else if (ctx.zone === undefined && evals.some((e) => e.checks.some((c) => c.kind === 'zone'))) {
        reasons.push('Add your ZIP code to confirm hardiness');
      }
      if (ctx.sun && all('sun')) reasons.push(`All suited to ${SUN_LABEL[ctx.sun]} ✓`);
      if (all('deer')) reasons.push('All deer resistant ✓');
      if (all('water')) reasons.push('Drought tolerant once established ✓');
      if (all('size')) reasons.push('Mature sizes fit the space ✓');
    } else {
      reasons.push(`${listNames(fine)} ${fine.length === 1 ? 'suits' : 'suit'} this spot ✓`);
    }
  }
  const notes = evals.flatMap((e) =>
    e.checks.filter((c) => c.level === 'info' && c.kind === 'deer').map((c) => `${shortPlantName(e.p.name)}: ${c.text.toLowerCase()}`),
  );
  return { rating, reasons: [...reasons, ...notes] };
}

/** Plain-language summary of the rules, embedded in AI prompts. */
export const FEASIBILITY_RULES: string[] = [
  "Hardiness: the property's USDA zone must be inside the plant's zone range; one zone colder = borderline (sheltered spot, winter mulch), two or more = not hardy; one zone warmer = stressed (afternoon shade, water), more = unsuitable (needs winter chill).",
  'Light: full sun = 6+ h direct sun, part sun = 3–6 h (ideally morning), shade = under 3 h. North-facing beds and spots under mature trees are usually shade; west- and south-facing walls are hot full sun.',
  'Space: mature width must fit the bed; center plants at least half their mature width from walls and paths and space them at their mature width so beds fill in by year 3 without shearing into boxes. Keep foundation shrubs below window sills at maturity.',
  'Trees: small trees (≤ 25 ft) 8–10+ ft from the house, medium 15–20 ft, large shade trees 20–30+ ft and away from sewer lines and overhead wires.',
  'Water: group plants by water need; drought-tolerant Mediterranean plants need sharp drainage in wet climates; thirsty plants need irrigation where rainfall is under ~30 in/yr.',
  'Deer: where deer are present favor deer-resistant plants (boxwood, lavender, catmint, ornamental grasses, ferns, hellebores) over hosta, arborvitae, yews, hydrangeas, roses and tulips; with high deer pressure suggest only plants deer rarely damage (Rutgers A/B ratings).',
  `Never suggest invasive plants: ${INVASIVE_WATCHLIST.join(', ')}. Prefer natives of the region where they fit the design. Plants the USGS US-RIIS register lists as invasive in the region (e.g. cherry laurel, Japanese maple, crape myrtle, star jasmine) self-seed beyond gardens in places — when one is central to a style, rate it caution, say so, and offer a native alternative.`,
  'Plant maturity in renderings: "new" = nursery sizes (1-gal perennials, 3–7 gal shrubs, 6–8 ft trees) with mulch visible between plants; "established" ≈ 3 years, perennials full, shrubs ~2/3 of mature size; "mature" = full mature size.',
];
