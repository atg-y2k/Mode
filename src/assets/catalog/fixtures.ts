/**
 * Built-in light fixtures (interior and exterior) with photometric defaults:
 * beam shape, color temperature, lumens of typical LED versions, how far the
 * light usefully reaches, and the usual mounting height. `emitterY` comes from
 * the art module (where each drawing's lamp sits), so glows line up with the
 * fixture art. Costs are typical 2026 US retail per fixture (string lights:
 * per ~48 ft strand; LED strips: per kit).
 *
 * Sizes: realHeightFt is the physical height of the drawn fixture; for wide,
 * flat fixtures (recessed trims, fans, tracks, strips) the familiar width is
 * given instead and the height derived from the art.
 */
import type { FixtureArt } from '../../../shared/art';
import type { AssetDef, LightInfo } from '../../../shared/types';
import { FIXTURE_EMITTER_Y } from '../art';
import { builtinAsset } from './helpers';

const BLACK = '#1f1f1f';
const BRASS = '#a8843f';
const BRONZE = '#4a3b2f';
const NICKEL = '#a7a9a6';
const WHITE_TRIM = '#f1f0ec';
const WARM_GLASS = '#f4e8c8';
const LINEN_SHADE = '#efe6d2';

interface FixtureEntry {
  id: string;
  name: string;
  subcategory: string;
  art: Omit<FixtureArt, 'kind'>;
  light: Omit<LightInfo, 'emitterY'>;
  size: { heightFt: number } | { widthFt: number };
  cost: [low: number, high: number];
  description: string;
  tags: string[];
}

const ENTRIES: FixtureEntry[] = [
  // -------------------------------------------------------------------------
  // Interior
  // -------------------------------------------------------------------------
  {
    id: 'recessed-downlight-6in',
    name: '6 in LED recessed downlight',
    subcategory: 'recessed',
    art: { form: 'recessed', finish: WHITE_TRIM },
    light: { beam: 'down', kelvin: 2700, lumens: 900, reachFt: 9, indoor: true, outdoor: false, mountHeightFt: 9 },
    size: { widthFt: 0.62 },
    cost: [15, 40],
    description: 'Slim canless wafer light — general lighting in a grid about 4–6 ft apart (ceiling height ÷ 2).',
    tags: ['recessed', 'can light', 'ceiling', 'general lighting', 'kitchen', 'living room', 'led', 'dimmable'],
  },
  {
    id: 'dome-pendant-black',
    name: 'Black metal dome pendant',
    subcategory: 'pendant',
    art: { form: 'pendant-dome', finish: BLACK },
    light: { beam: 'down', kelvin: 2700, lumens: 800, reachFt: 8, indoor: true, outdoor: false, mountHeightFt: 6.5 },
    size: { heightFt: 2 },
    cost: [90, 250],
    description: '16 in matte black dome on a cord — hang 30–36 in above an island or table, two or three in a row.',
    tags: ['pendant', 'kitchen', 'island', 'dining', 'industrial', 'modern farmhouse', 'black'],
  },
  {
    id: 'enamel-barn-pendant-white',
    name: 'White enamel barn pendant',
    subcategory: 'pendant',
    art: { form: 'pendant-dome', finish: '#f0efea' },
    light: { beam: 'down', kelvin: 2700, lumens: 800, reachFt: 8, indoor: true, outdoor: false, mountHeightFt: 6.5 },
    size: { heightFt: 2 },
    cost: [70, 200],
    description: 'Glossy white enamel warehouse shade — farmhouse kitchens, mudrooms and over a sink.',
    tags: ['pendant', 'kitchen', 'island', 'farmhouse', 'white', 'barn light'],
  },
  {
    id: 'globe-pendant-brass',
    name: 'Opal globe pendant (brass)',
    subcategory: 'pendant',
    art: { form: 'pendant-globe', finish: '#b08d4a', shade: '#f4efe6' },
    light: { beam: 'omni', kelvin: 2700, lumens: 800, reachFt: 8, indoor: true, outdoor: false, mountHeightFt: 6.5 },
    size: { heightFt: 2 },
    cost: [100, 350],
    description: 'Hand-blown opal glass globe with brass fittings — soft, glare-free all-around glow.',
    tags: ['pendant', 'globe', 'brass', 'mid-century', 'dining', 'entry', 'bedroom'],
  },
  {
    id: 'caged-pendant-bronze',
    name: 'Caged Edison pendant (bronze)',
    subcategory: 'pendant',
    art: { form: 'pendant-cage', finish: BRONZE },
    light: { beam: 'omni', kelvin: 2200, lumens: 450, reachFt: 6, indoor: true, outdoor: true, mountHeightFt: 7 },
    size: { heightFt: 1.8 },
    cost: [60, 180],
    description: 'Open wire cage around a warm filament bulb; damp-rated for covered porches as well as indoors.',
    tags: ['pendant', 'cage', 'edison', 'industrial', 'porch', 'rustic', 'bronze'],
  },
  {
    id: 'candle-chandelier-black',
    name: 'Candle chandelier (6-light, black)',
    subcategory: 'chandelier',
    art: { form: 'chandelier', finish: '#222222' },
    light: { beam: 'omni', kelvin: 2700, lumens: 1800, reachFt: 12, indoor: true, outdoor: false, mountHeightFt: 6.5 },
    size: { widthFt: 2.4 },
    cost: [250, 800],
    description: 'Six candelabra arms in matte black, about 29 in wide — dining tables (width ≈ table width − 12 in) and foyers.',
    tags: ['chandelier', 'dining', 'foyer', 'traditional', 'modern farmhouse', 'black'],
  },
  {
    id: 'plaster-uplight-sconce',
    name: 'Plaster uplight sconce',
    subcategory: 'sconce',
    art: { form: 'sconce-up', finish: '#e8e4dc' },
    light: { beam: 'up', kelvin: 2700, lumens: 600, reachFt: 6, indoor: true, outdoor: false, mountHeightFt: 5.5 },
    size: { heightFt: 1 },
    cost: [70, 220],
    description: 'Paintable plaster cone that washes the wall and ceiling with soft indirect light; mount about 66 in up.',
    tags: ['sconce', 'wall light', 'uplight', 'ambient', 'hallway', 'bedroom', 'living room', 'minimal'],
  },
  {
    id: 'brass-down-sconce',
    name: 'Brass downlight sconce',
    subcategory: 'sconce',
    art: { form: 'sconce-down', finish: BRASS },
    light: { beam: 'down', kelvin: 2700, lumens: 450, reachFt: 5, indoor: true, outdoor: false, mountHeightFt: 5.5 },
    size: { heightFt: 1 },
    cost: [80, 250],
    description: 'Brass shade aimed down for reading nooks, bedside walls and either side of a vanity mirror.',
    tags: ['sconce', 'wall light', 'brass', 'reading', 'bedroom', 'bath', 'vanity'],
  },
  {
    id: 'drum-flush-mount',
    name: 'Drum flush-mount ceiling light',
    subcategory: 'ceiling',
    art: { form: 'flush-mount', finish: NICKEL, shade: '#f3f1ec' },
    light: { beam: 'down', kelvin: 3000, lumens: 1500, reachFt: 10, indoor: true, outdoor: false, mountHeightFt: 8.5 },
    size: { widthFt: 1.33 },
    cost: [50, 180],
    description: '16 in fabric drum on a brushed-nickel base — bedrooms, hallways and rooms with 8 ft ceilings.',
    tags: ['ceiling', 'flush mount', 'bedroom', 'hallway', 'general lighting', 'nickel'],
  },
  {
    id: 'track-light-3-head',
    name: 'Track light (3 heads, black)',
    subcategory: 'track',
    art: { form: 'track', finish: BLACK },
    light: { beam: 'spot', kelvin: 3000, lumens: 1800, reachFt: 10, indoor: true, outdoor: false, mountHeightFt: 8.5 },
    size: { widthFt: 4 },
    cost: [80, 250],
    description: '4 ft track with three aimable LED heads — art walls, kitchens and sloped ceilings.',
    tags: ['track', 'accent', 'art lighting', 'kitchen', 'modern', 'gallery', 'black'],
  },
  {
    id: 'linen-floor-lamp',
    name: 'Linen-shade floor lamp (brass)',
    subcategory: 'lamp',
    art: { form: 'floor-lamp', finish: BRASS, shade: LINEN_SHADE },
    light: { beam: 'omni', kelvin: 2700, lumens: 800, reachFt: 8, indoor: true, outdoor: false },
    size: { heightFt: 5.3 },
    cost: [120, 400],
    description: 'Slim brass stem with a pleated linen drum — warm pools of light beside sofas and reading chairs.',
    tags: ['lamp', 'floor lamp', 'living room', 'reading', 'cozy', 'brass', 'layered lighting'],
  },
  {
    id: 'ceramic-table-lamp',
    name: 'Ceramic table lamp (ink blue)',
    subcategory: 'lamp',
    art: { form: 'table-lamp', finish: '#2b3a4f', shade: LINEN_SHADE },
    light: { beam: 'omni', kelvin: 2700, lumens: 450, reachFt: 6, indoor: true, outdoor: false },
    size: { heightFt: 2.3 },
    cost: [70, 250],
    description: 'Glazed gourd base with a linen shade — nightstands, consoles and side tables.',
    tags: ['lamp', 'table lamp', 'bedroom', 'living room', 'cozy', 'blue', 'layered lighting'],
  },
  {
    id: 'under-cabinet-led-strip',
    name: 'Under-cabinet LED light bar',
    subcategory: 'strip',
    art: { form: 'led-strip', finish: '#c0c2c4' },
    light: { beam: 'strip', kelvin: 3000, lumens: 900, reachFt: 3, indoor: true, outdoor: false, mountHeightFt: 4.5 },
    size: { widthFt: 3 },
    cost: [40, 150],
    description: 'Low-profile aluminum LED bars that wash counters and backsplashes; also toe-kick and cove lighting.',
    tags: ['led strip', 'under cabinet', 'kitchen', 'task lighting', 'cove', 'backsplash'],
  },
  {
    id: 'ceiling-fan-52',
    name: 'Ceiling fan with light (52 in)',
    subcategory: 'ceiling-fan',
    art: { form: 'ceiling-fan', finish: '#3a332d', shade: '#f1ece0' },
    light: { beam: 'down', kelvin: 3000, lumens: 1000, reachFt: 9, indoor: true, outdoor: true, mountHeightFt: 8.5 },
    size: { widthFt: 4.33 },
    cost: [150, 450],
    description: 'Oil-rubbed bronze fan with a frosted light kit; damp-rated versions suit covered porches.',
    tags: ['ceiling fan', 'bedroom', 'living room', 'porch', 'bronze', 'cooling'],
  },
  {
    id: 'stair-step-light',
    name: 'Recessed step light',
    subcategory: 'step-light',
    art: { form: 'step-light', finish: '#2b2b2b' },
    light: { beam: 'down', kelvin: 3000, lumens: 120, reachFt: 3, indoor: true, outdoor: true, mountHeightFt: 1.3 },
    size: { widthFt: 0.45 },
    cost: [40, 120],
    description: 'Louvered wall light set into stair stringers, deck risers or retaining walls to light each tread.',
    tags: ['step light', 'stairs', 'deck', 'retaining wall', 'safety', 'low voltage', 'landscape lighting'],
  },

  // -------------------------------------------------------------------------
  // Exterior
  // -------------------------------------------------------------------------
  {
    id: 'soffit-downlight-4in',
    name: '4 in soffit downlight (wet-rated)',
    subcategory: 'recessed',
    art: { form: 'recessed', finish: '#efeeea' },
    light: { beam: 'down', kelvin: 3000, lumens: 650, reachFt: 10, indoor: false, outdoor: true, mountHeightFt: 10 },
    size: { widthFt: 0.45 },
    cost: [20, 50],
    description: 'Small recessed lights in eaves and porch ceilings that graze the facade with even scallops of light.',
    tags: ['recessed', 'soffit', 'porch', 'eaves', 'facade', 'curb appeal', 'security'],
  },
  {
    id: 'coach-lantern-black',
    name: 'Coach wall lantern (black)',
    subcategory: 'wall-lantern',
    art: { form: 'wall-lantern', finish: '#1e1e1e', shade: '#f6ecd0' },
    light: { beam: 'omni', kelvin: 2700, lumens: 800, reachFt: 8, indoor: false, outdoor: true, mountHeightFt: 6 },
    size: { heightFt: 1.75 },
    cost: [50, 200],
    description: 'Classic seeded-glass lantern for either side of the front door — about 1/4 to 1/3 the door height.',
    tags: ['wall lantern', 'entry', 'front door', 'porch', 'garage', 'traditional', 'colonial', 'black'],
  },
  {
    id: 'carriage-lantern-bronze',
    name: 'Large carriage lantern (bronze)',
    subcategory: 'wall-lantern',
    art: { form: 'wall-lantern', finish: BRONZE, shade: '#f3e3bf' },
    light: { beam: 'omni', kelvin: 2700, lumens: 1000, reachFt: 10, indoor: false, outdoor: true, mountHeightFt: 6.5 },
    size: { heightFt: 2 },
    cost: [80, 260],
    description: '24 in oil-rubbed bronze lantern scaled for tall entries and flanking two-car garage doors.',
    tags: ['wall lantern', 'entry', 'garage', 'craftsman', 'traditional', 'bronze'],
  },
  {
    id: 'barn-sconce-galvanized',
    name: 'Gooseneck barn sconce (galvanized)',
    subcategory: 'sconce',
    art: { form: 'sconce-down', finish: '#9aa0a2' },
    light: { beam: 'down', kelvin: 3000, lumens: 800, reachFt: 8, indoor: true, outdoor: true, mountHeightFt: 7 },
    size: { heightFt: 1.1 },
    cost: [60, 180],
    description: 'Downward barn shade over doors, garages and signs — the modern farmhouse exterior staple.',
    tags: ['sconce', 'barn light', 'entry', 'garage', 'modern farmhouse', 'farmhouse', 'galvanized'],
  },
  {
    id: 'cylinder-uplight-sconce',
    name: 'Modern cylinder wall light',
    subcategory: 'sconce',
    art: { form: 'sconce-up', finish: '#2b2b2b' },
    light: { beam: 'up', kelvin: 3000, lumens: 500, reachFt: 8, indoor: true, outdoor: true, mountHeightFt: 7 },
    size: { heightFt: 1 },
    cost: [60, 200],
    description: 'Minimal black cylinder that grazes the siding with a crisp beam — contemporary entries and garages.',
    tags: ['sconce', 'wall light', 'modern', 'contemporary', 'entry', 'facade', 'black'],
  },
  {
    id: 'pagoda-path-light-black',
    name: 'Pagoda path light (black)',
    subcategory: 'path-light',
    art: { form: 'path-light', finish: BLACK },
    light: { beam: 'down', kelvin: 2700, lumens: 150, reachFt: 4, indoor: false, outdoor: true },
    size: { heightFt: 1.8 },
    cost: [35, 110],
    description: 'Low-voltage hat-top path light; stagger every 8–10 ft along walks and bed edges.',
    tags: ['path light', 'landscape lighting', 'walkway', 'low voltage', 'safety', 'black'],
  },
  {
    id: 'brass-path-light',
    name: 'Solid brass path light',
    subcategory: 'path-light',
    art: { form: 'path-light', finish: BRASS },
    light: { beam: 'down', kelvin: 2700, lumens: 200, reachFt: 4.5, indoor: false, outdoor: true },
    size: { heightFt: 2 },
    cost: [90, 180],
    description: 'Cast brass path light that weathers to a rich bronze patina; professional-grade landscape lighting.',
    tags: ['path light', 'landscape lighting', 'walkway', 'low voltage', 'brass', 'luxury'],
  },
  {
    id: 'led-bollard-bronze',
    name: 'LED bollard (bronze)',
    subcategory: 'bollard',
    art: { form: 'bollard', finish: '#3d332a' },
    light: { beam: 'down', kelvin: 3000, lumens: 400, reachFt: 6, indoor: false, outdoor: true },
    size: { heightFt: 2.5 },
    cost: [120, 400],
    description: 'Louvered 30 in post light for driveways, patios and modern walks; glare-free downward light.',
    tags: ['bollard', 'landscape lighting', 'driveway', 'walkway', 'modern', 'bronze'],
  },
  {
    id: 'brass-uplight-spot',
    name: 'Brass landscape spotlight',
    subcategory: 'uplight',
    art: { form: 'spotlight', finish: BRASS },
    light: { beam: 'spot', kelvin: 2700, lumens: 350, reachFt: 15, indoor: false, outdoor: true, mountHeightFt: 0.5 },
    size: { heightFt: 0.8 },
    cost: [60, 180],
    description: 'Stake-mounted bullet light aimed up into trees, columns and stone walls — the core of night curb appeal.',
    tags: ['spotlight', 'uplight', 'landscape lighting', 'trees', 'facade', 'low voltage', 'brass'],
  },
  {
    id: 'in-grade-well-light',
    name: 'In-grade well light',
    subcategory: 'uplight',
    art: { form: 'well-light', finish: '#2b2b2b' },
    light: { beam: 'up', kelvin: 3000, lumens: 450, reachFt: 15, indoor: false, outdoor: true, mountHeightFt: 0 },
    size: { widthFt: 0.6 },
    cost: [80, 250],
    description: 'Flush-to-ground uplight hidden in lawns and beds to wash facades and tree trunks with no visible fixture.',
    tags: ['well light', 'uplight', 'landscape lighting', 'facade', 'trees', 'hidden', 'modern'],
  },
  {
    id: 'led-flood-light',
    name: 'LED security flood light',
    subcategory: 'flood-light',
    art: { form: 'flood-light', finish: '#3a3a3a' },
    light: { beam: 'spot', kelvin: 4000, lumens: 2500, reachFt: 30, indoor: false, outdoor: true, mountHeightFt: 10 },
    size: { heightFt: 0.8 },
    cost: [40, 130],
    description: 'Twin-head motion-sensing flood for driveways, side yards and garages; aim down to avoid glare.',
    tags: ['flood light', 'security', 'motion sensor', 'driveway', 'garage', 'side yard'],
  },
  {
    id: 'cafe-string-lights',
    name: 'Café string lights (48 ft)',
    subcategory: 'string-lights',
    art: { form: 'string-lights', finish: BLACK },
    light: { beam: 'string', kelvin: 2200, lumens: 1200, reachFt: 8, indoor: false, outdoor: true, mountHeightFt: 9 },
    size: { widthFt: 12 },
    cost: [40, 120],
    description: 'Commercial-grade strand of 24 shatterproof LED bulbs — drape 8–10 ft high over patios and pergolas.',
    tags: ['string lights', 'bistro lights', 'patio', 'pergola', 'backyard', 'festive', 'entertaining'],
  },
  {
    id: 'post-lantern-black',
    name: 'Lamp post lantern (black)',
    subcategory: 'post-lantern',
    art: { form: 'post-lantern', finish: '#1e1e1e', shade: WARM_GLASS },
    light: { beam: 'omni', kelvin: 2700, lumens: 800, reachFt: 12, indoor: false, outdoor: true, mountHeightFt: 7 },
    size: { heightFt: 7.5 },
    cost: [150, 450],
    description: 'Traditional lantern on a 7 ft post at the walk or driveway entrance — a welcoming beacon from the street.',
    tags: ['post light', 'lamp post', 'driveway', 'walkway', 'traditional', 'colonial', 'curb appeal', 'black'],
  },
  {
    id: 'under-cap-led-strip',
    name: 'Hardscape LED strip (under wall caps)',
    subcategory: 'strip',
    art: { form: 'led-strip', finish: '#3a3a3a' },
    light: { beam: 'strip', kelvin: 2700, lumens: 500, reachFt: 3, indoor: false, outdoor: true, mountHeightFt: 2 },
    size: { widthFt: 4 },
    cost: [50, 150],
    description: 'Low-voltage linear lights tucked under seat-wall caps, stair treads and deck rails for a floating glow.',
    tags: ['led strip', 'hardscape lighting', 'seat wall', 'deck', 'stairs', 'low voltage', 'modern'],
  },
];

export const FIXTURES: AssetDef[] = ENTRIES.map((e) => {
  const art: FixtureArt = { kind: 'fixture', ...e.art };
  const light: LightInfo = { ...e.light, emitterY: FIXTURE_EMITTER_Y[art.form] };
  const base = {
    id: e.id,
    name: e.name,
    category: 'lighting' as const,
    subcategory: e.subcategory,
    art,
    tags: [...e.tags, ...(light.indoor ? ['indoor'] : []), ...(light.outdoor ? ['outdoor'] : [])],
    description: e.description,
    cost: { low: e.cost[0], high: e.cost[1], unit: 'each' as const },
    light,
  };
  return 'heightFt' in e.size
    ? builtinAsset({ ...base, realHeightFt: e.size.heightFt })
    : builtinAsset({ ...base, realWidthFt: e.size.widthFt });
});
