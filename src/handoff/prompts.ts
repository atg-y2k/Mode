/**
 * Hand-off prompts: the text the user pastes into ChatGPT or Gemini next to
 * the marked photo. Prompts are the product, so each app gets its own
 * "native language":
 *
 * - ChatGPT follows OpenAI's image-editing guide: label the image ("Image 1"),
 *   say it must stay the same photograph, one CHANGE confined to the marked
 *   area, an explicit KEEP list, camera / framing / ratio lock, a MATCH THE
 *   PHOTO line for light and colour, and "Do not change anything else".
 * - Gemini follows Google's semantic-masking template: it opens with
 *   "Using the provided photo of …, change only …" and continues as a
 *   narrative paragraph whose exclusions are phrased positively ("… stay
 *   exactly as they are").
 *
 * Both always: describe the area in words AND by the marker, keep named
 * scene elements (doors, windows, roofline, the driveway → door walk, lawn
 * outside the area, neighbors…), lock framing and ratio, match light and
 * white balance, and say the outline is only a selection marker to remove —
 * never to be turned into edging. Prompts stay ≤ ~1,800 characters so the
 * ChatGPT prefill link works.
 */
import { SPACE_TYPE_LABELS, spaceKindOf } from '../../shared/types';
import type { DesignBrief, ElementType, HandoffApp, Pt, SceneMap, ScenePath, SceneZone, ZoneKind } from '../../shared/types';
import { pointInPolygon } from '../engine/geometry';
import type { Rect } from './resample';

/** Hard ceiling for a hand-off prompt (URL-safe for the ChatGPT prefill link). */
export const MAX_PROMPT_CHARS = 1800;

export interface PromptContext {
  app: HandoffApp;
  /** The plan's model-neutral instruction for this variation. */
  instruction: string;
  /** Plain-language description of where the change goes ("the walkway in the lower center, from the driveway at left to the front door"). '' = the whole image. */
  areaText: string;
  /** Named things to keep (from scene zones outside the target + architecture keep-list). */
  keep: string[];
  /** Light description ("soft morning light from the left; shadows fall to the right"). */
  light: string;
  /** Short style label ("1950s ranch", "Craftsman bungalow"). */
  style: string;
  ratio: string;
  /** Marker colour name ("magenta"); '' when the export has no marker (whole-image runs). */
  markerColorName: string;
  strictness: NonNullable<DesignBrief['strictness']>;
  plantMaturity: DesignBrief['plantMaturity'];
  /** Roles of attached inspiration images, in order (Image 2, 3, …). */
  references: { role: string }[];
  interior: boolean;
  /** What the photo shows, lower case ("backyard", "kitchen"); refines the subject phrase. */
  place?: string;
  /** Extra hard requirements for the change ("It must still lead from the driveway to the front door."). */
  constraints?: string[];
  /** The change is about a door or window itself (keep "other" openings). Guessed from the change text when omitted. */
  openingsInTarget?: boolean;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Ensures terminal punctuation. */
function sentence(text: string): string {
  const t = clean(text);
  if (!t) return '';
  return /[.!?]["')\]]?$/.test(t) ? t : `${t}.`;
}

/** Lower-cases the first letter unless the word looks like an acronym or proper name in caps ("LED", "Craftsman" stays when asked). */
function lowerFirst(text: string): string {
  const t = clean(text);
  if (!t) return t;
  if (/^[A-Z]{2,}/.test(t)) return t;
  return t[0].toLowerCase() + t.slice(1);
}

function stripTrailingPunct(text: string): string {
  return clean(text).replace(/[\s.;,:!]+$/, '');
}

/** "the …" unless the phrase already starts with an article / possessive. */
function withArticle(phrase: string): string {
  const p = lowerFirst(stripTrailingPunct(phrase));
  if (!p) return p;
  return /^(the|a|an|my|our|their|its|every|all|both|each|this|these|those)\b/i.test(p) ? p : `the ${p}`;
}

/** Cuts at a word boundary to ≤ max chars, adding "…". */
function truncateWords(text: string, max: number): string {
  const t = clean(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(0, max - 1));
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:—–-]+$/, '')}…`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Sentences of a paragraph (keeps abbreviations like "in." / "e.g." / "1.5 ft" intact). */
export function splitSentences(text: string): string[] {
  return clean(text)
    .split(/(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Generic sentences of a plan instruction that the hand-off template already says (in the app's own
// phrasing). Specific requirements ("Keep the lavender low, under the sills", "keep the lamp post")
// are part of the change and stay.
const BOILERPLATE: RegExp[] = [
  /\b(camera (position|angle)|framing|aspect ratio|perspective and lens)\b/i,
  /\b(time of day|sun direction|daylight from the windows)\b/i,
  /\b(house|room|home)['’]s architecture\b/i,
  /\beverything (else|outside)\b/i,
  /^photo-?realistic\b/i,
  /^new (materials|finishes)\b[^.]*\b(sit|follow)\b/i,
  /^add no (text|people)/i,
  /^(do not|don't|never)\s+(crop|zoom|add (any )?(text|people))/i,
  /^(return|output) (one|a|the)\b/i,
  /^show (the )?plants\b/i,
  /^change only\b/i,
  /\bedges blend naturally\b/i,
];

/**
 * The CHANGE part of a plan instruction: drops the opening "Edit this photo
 * of …" sentence (keeping anything after a colon), keep/camera/realism and
 * plant-size boilerplate — the template restates those in the app's own
 * phrasing. Falls back to the whole instruction when nothing is left.
 */
export function changeFromInstruction(instruction: string): string {
  const sentences = splitSentences(instruction);
  const out: string[] = [];
  sentences.forEach((s, i) => {
    let t = s;
    if (i === 0 && /^(please\s+)?edit (this|the) (photo|image|picture)\b/i.test(t)) {
      const colon = t.indexOf(':');
      if (colon < 0) return;
      t = t.slice(colon + 1).trim();
      if (!t) return;
      t = t[0].toUpperCase() + t.slice(1);
    }
    if (BOILERPLATE.some((re) => re.test(t))) return;
    out.push(sentence(t));
  });
  const text = out.join(' ').trim();
  return text || sentence(instruction);
}

/** Fits a run of sentences into `max` chars, whole sentences first, then words. */
function fitSentences(text: string, max: number): string {
  const t = clean(text);
  if (t.length <= max) return t;
  const parts = splitSentences(t);
  let acc = '';
  for (const p of parts) {
    const next = acc ? `${acc} ${p}` : p;
    if (next.length > max) break;
    acc = next;
  }
  if (acc) return acc;
  return truncateWords(parts[0] ?? t, max);
}

// ---------------------------------------------------------------------------
// Subject, light, strictness, maturity
// ---------------------------------------------------------------------------

const HOUSE_NOUN = /\b(house|home|bungalow|cottage|cabin|villa|townhouse|townhome|farmhouse|duplex|building|condo|apartment|residence)$/i;
const ROOM_NOUN = /\b(room|kitchen|bath|bathroom|bedroom|office|hallway|entryway|basement|laundry|nursery|den|study|foyer|loft|space|suite)$/i;
const YARD_PLACES = /^(front yard|backyard|back yard|side yard|garden|patio|deck|pool area|driveway)$/i;

/** A style label short enough for the opening sentence: up to the first comma / "with", ≤ 6 words. */
function shortStyle(style: string): string {
  const head = stripTrailingPunct(style).split(/,|;|\s+with\s+|\s+—\s+|\s+-\s+|\(/i)[0].trim();
  return head.split(/\s+/).slice(0, 6).join(' ');
}

/** "my 1950s ranch house", "the backyard of my Craftsman bungalow", "my kitchen". */
export function subjectPhrase(style: string, interior: boolean, place?: string): string {
  const s = shortStyle(style);
  const pl = place ? lowerFirst(stripTrailingPunct(place)) : '';
  if (interior) {
    if (s && ROOM_NOUN.test(s)) return `my ${lowerFirstStyle(s)}`;
    const room = pl && !/^other/.test(pl) ? pl : 'room';
    return s ? `my ${lowerFirstStyle(s)} ${room}` : `my ${room}`;
  }
  const house = s ? (HOUSE_NOUN.test(s) ? s : `${s} house`) : 'house';
  if (pl && YARD_PLACES.test(pl)) return `the ${pl} of my ${house}`;
  return `my ${house}`;
}

/** Style words keep proper-noun capitals ("Craftsman"), but a leading generic adjective is lower-cased ("Mid-century" → "mid-century"). */
function lowerFirstStyle(style: string): string {
  return /^(Mid|Modern|Contemporary|Traditional|Transitional|Minimal|Rustic|Coastal|Industrial|Scandinavian|Bohemian|Farmhouse|Classic)\b/.test(style)
    ? lowerFirst(style)
    : style;
}

function defaultLight(interior: boolean): string {
  return interior
    ? 'the same daylight from the windows, the same lamps and the same shadows'
    : 'the same time of day, sun direction, shadows and weather';
}

const STRICTNESS: Record<HandoffApp, Record<PromptContext['strictness'], (interior: boolean) => string>> = {
  chatgpt: {
    strict: () => 'Change nothing beyond this request: same layout and extent, no extra objects, plants or decorations.',
    balanced: (i) => `Keep it realistic and in proportion with the ${i ? 'room' : 'house'}.`,
    creative: (i) => `You may refine details inside the outline (textures, plant mix, small accents) as long as they suit the ${i ? 'room' : 'house'}.`,
  },
  gemini: {
    strict: () => 'Make exactly this change and nothing more, keeping the same layout and extent without extra objects, plants or decorations.',
    balanced: (i) => `The result should look realistic and in proportion with the ${i ? 'room' : 'house'}.`,
    creative: (i) => `Within the outlined area you may refine the details (textures, plant mix, small accents) so it looks its best and suits the ${i ? 'room' : 'house'}.`,
  },
};

const STRICTNESS_WHOLE: Record<HandoffApp, Partial<Record<PromptContext['strictness'], (interior: boolean) => string>>> = {
  chatgpt: { creative: (i) => `You may refine details (textures, plant mix, small accents) as long as they suit the ${i ? 'room' : 'house'}.` },
  gemini: { creative: (i) => `You may refine the details (textures, plant mix, small accents) so it looks its best and suits the ${i ? 'room' : 'house'}.` },
};

const MATURITY: Record<DesignBrief['plantMaturity'], string> = {
  new: 'Plants look newly planted from nursery pots: small, with mulch showing between them.',
  established: 'Plants look about three years after planting: roughly two-thirds of their mature size, beds mostly filled.',
  mature: 'Plants are at their full mature size and natural form, never larger than the species really grows.',
};

const PLANT_WORDS =
  /\b(plant(s|ed|ing)?|shrubs?|perennials?|trees?|grass(es)?|flowers?|hedges?|boxwood|lavender|hostas?|ferns?|groundcover|vines?|roses?|hydrangeas?|salvia|catmint|nepeta|coneflowers?|daylil(y|ies)|hollies|holly|juniper|azaleas?|arborvitae|maple|dogwood|bulbs?|annuals?|succulents?|sedum|moss|clover|meadow|beds?)\b/i;

/** Whether the change text is about plants (so maturity wording applies). */
export function mentionsPlants(text: string): boolean {
  return PLANT_WORDS.test(text);
}

/** A change sentence acting on a door / window ("paint the front door navy", "add black shutters"). */
const OPENING_CHANGE = /\b(replace|paint|repaint|swap|change|add|install|remove|stain|refinish|new)\b[^.]{0,40}?\b(doors?|windows?|shutters?)\b/i;

const OPENING_KINDS = new Set<ZoneKind>(['front-door', 'garage-door', 'windows', 'door', 'window']);

const EDGING_WORDS = /\b(edg(e|es|ing)|border(s|ed)?|curb(s|ing)?|kerb|trim|outline)\b/i;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface Slots {
  subject: string;
  area: string;
  change: string;
  extras: string; // constraints + maturity + strictness
  keep: string[];
  light: string;
  ratio: string;
  color: string;
  refs: string[];
  interior: boolean;
  edgingInChange: boolean;
  openingsTargeted: boolean;
}

function refSentencesChatgpt(refs: string[]): string {
  return refs
    .map((role, i) => `Image ${i + 2} is only a reference for ${role}: copy its color and texture, not its layout, perspective, lighting or surroundings.`)
    .join(' ');
}

function refSentencesGemini(refs: string[]): string {
  return refs
    .map((role, i) => `Image ${i + 2} serves only as a reference for ${role}: use its color and texture, not its layout, perspective or surroundings.`)
    .join(' ');
}

function groundPhrase(interior: boolean): string {
  return interior
    ? 'new finishes follow the existing floor and wall planes with realistic contact shadows'
    : 'new materials sit naturally on the ground with realistic contact shadows';
}

function chatgptTemplate(s: Slots): string {
  const lines: string[] = [];
  const intro = `Edit the attached photo of ${s.subject} (Image 1). It must stay the same photograph.`;
  lines.push(s.refs.length ? `${intro} ${refSentencesChatgpt(s.refs)}` : intro);
  const changeBody = [s.change, s.extras].filter(Boolean).join(' ');
  if (s.color) lines.push(`CHANGE — only inside the ${s.color} outline (${s.area}): ${changeBody}`);
  else lines.push(`CHANGE: ${changeBody}`);
  const openings = s.interior
    ? `Do not add, remove or move any${s.openingsTargeted ? ' other' : ''} windows, doors or openings.`
    : `Do not add, remove or move any${s.openingsTargeted ? ' other' : ''} doors or windows.`;
  const keepList = s.keep.length ? joinList(s.keep) : s.interior ? "the room's walls, ceiling, windows and doors" : "the house's architecture, roofline, doors and windows";
  lines.push(`KEEP EXACTLY AS IS: ${keepList}${s.color ? ', and everything else outside the outline' : ''}. ${openings}`);
  lines.push(`Same camera position, lens, perspective and framing; same ${s.ratio} aspect ratio; do not crop, zoom, rotate, straighten or extend the image.`);
  lines.push(`MATCH THE PHOTO: ${s.light}; same white balance, exposure, contrast, sharpness and grain; ${groundPhrase(s.interior)}.`);
  if (s.color) {
    lines.push(
      `The ${s.color} outline is only a selection marker: remove it completely and do not add any border, edging or line along it${s.edgingInChange ? ' (the only edging is the one the change describes)' : ''}.`,
    );
  }
  lines.push('Do not change anything else.');
  return lines.join('\n');
}

function geminiTemplate(s: Slots): string {
  const paras: string[] = [];
  const changeBody = [s.change, s.extras].filter(Boolean).join(' ');
  const keepList = s.keep.length ? joinList(s.keep) : s.interior ? "the room's walls, ceiling, windows and doors" : "the house's architecture, roofline, doors and windows";
  const openings = s.interior
    ? `every${s.openingsTargeted ? ' other' : ''} window, door and opening stays where it is with the same size and shape`
    : `every${s.openingsTargeted ? ' other' : ''} door and window stays where it is with the same size and shape`;
  if (s.color) {
    paras.push(
      `Using the provided photo of ${s.subject}${s.refs.length ? ' (Image 1)' : ''}, change only ${s.area}, which is marked with a ${s.color} outline. ${changeBody} ` +
        `Keep everything else in the image exactly the same, preserving the original style, lighting and composition: leave ${keepList} untouched, ${openings}, and everything outside the outline remains exactly as it is.`,
    );
  } else {
    paras.push(
      `Using the provided photo of ${s.subject}${s.refs.length ? ' (Image 1)' : ''}, make this change: ${changeBody} ` +
        `Preserve the original style, lighting and composition: leave ${keepList} untouched, and ${openings}.`,
    );
  }
  paras.push(
    `Keep the same camera angle, framing and lens and the same ${s.ratio} aspect ratio, with the whole scene visible edge to edge and nothing cropped, zoomed or extended. ` +
      `The light should match the photo — ${s.light} — with the same color balance, exposure and sharpness, and ${groundPhrase(s.interior)}.` +
      (s.color
        ? ` The ${s.color} outline is only a selection marker: remove it completely, so the finished photo shows no outline, border or line where it was${s.edgingInChange ? ' (the only edging is the one the change describes)' : ''}.`
        : ''),
  );
  if (s.refs.length) paras.push(refSentencesGemini(s.refs));
  return paras.join('\n\n');
}

/**
 * App-specific prompt (ChatGPT: OpenAI's editing phrasing; Gemini: Google's
 * semantic-masking opening and a narrative paragraph with positively phrased
 * exclusions). Always: one change, area in words AND marker, keep list, same
 * framing / ratio, match light & white balance, and "the {color} outline is
 * only a selection marker — remove it and do not add any border, edging or
 * line along it". Strictness adjusts the latitude sentence; plant maturity
 * wording is added when the change involves plants. ≤ MAX_PROMPT_CHARS.
 */
export function buildHandoffPrompt(ctx: PromptContext): string {
  const color = clean(ctx.markerColorName);
  const whole = !color;
  const change = changeFromInstruction(ctx.instruction || 'Apply the requested design change');
  const extrasParts: string[] = [];
  for (const c of ctx.constraints ?? []) if (clean(c)) extrasParts.push(sentence(c));
  if (mentionsPlants(change) && (!ctx.interior || /\b(houseplants?|potted)\b/i.test(change))) extrasParts.push(MATURITY[ctx.plantMaturity]);
  const strict = whole ? STRICTNESS_WHOLE[ctx.app][ctx.strictness] : STRICTNESS[ctx.app][ctx.strictness];
  if (strict) extrasParts.push(strict(ctx.interior));
  const refs = ctx.references.slice(0, 3).map((r) => lowerFirst(stripTrailingPunct(r.role)) || 'the look');
  const base: Omit<Slots, 'change' | 'keep'> = {
    subject: subjectPhrase(ctx.style, ctx.interior, ctx.place),
    area: truncateWords(stripTrailingPunct(ctx.areaText) || 'the outlined area', 200),
    extras: extrasParts.join(' '),
    light: truncateWords(lowerFirst(stripTrailingPunct(ctx.light).replace(/\s*;\s*/g, ', ')) || defaultLight(ctx.interior), 180),
    ratio: clean(ctx.ratio) || 'original',
    color,
    refs,
    interior: ctx.interior,
    edgingInChange: EDGING_WORDS.test(change),
    openingsTargeted: ctx.openingsInTarget ?? OPENING_CHANGE.test(change),
  };
  const render = ctx.app === 'gemini' ? geminiTemplate : chatgptTemplate;
  let keep = ctx.keep.map((k) => stripTrailingPunct(k)).filter(Boolean);
  if (whole) keep = keep.map((k) => k.replace(/\s+(outside|beyond) the outline$/i, ''));
  keep = keep.filter((k, i) => keep.findIndex((o) => o.toLowerCase() === k.toLowerCase()) === i).map((k) => truncateWords(k, 90));

  let text = render({ ...base, change, keep });
  if (text.length <= MAX_PROMPT_CHARS) return text;
  // 1. Shorten the keep list (the composite protects everything outside anyway), keeping the first four.
  while (keep.length > 4 && text.length > MAX_PROMPT_CHARS) {
    keep = keep.slice(0, -1);
    text = render({ ...base, change, keep });
  }
  if (text.length <= MAX_PROMPT_CHARS) return text;
  // 2. Fit the change text into what is left, whole sentences first.
  const room = MAX_PROMPT_CHARS - (text.length - change.length);
  const fitted = fitSentences(change, Math.max(120, room));
  text = render({ ...base, change: fitted, keep });
  if (text.length <= MAX_PROMPT_CHARS) return text;
  // 3. Drop the extras, then shrink the keep list further.
  text = render({ ...base, extras: '', change: fitted, keep });
  while (keep.length > 1 && text.length > MAX_PROMPT_CHARS) {
    keep = keep.slice(0, -1);
    text = render({ ...base, extras: '', change: fitted, keep });
  }
  if (text.length <= MAX_PROMPT_CHARS) return text;
  const lastRoom = MAX_PROMPT_CHARS - (text.length - fitted.length);
  return render({ ...base, extras: '', change: truncateWords(fitted, Math.max(40, lastRoom)), keep });
}

// ---------------------------------------------------------------------------
// Scene → prompt context
// ---------------------------------------------------------------------------

const EXTERIOR_ORDER: ZoneKind[] = [
  'front-door',
  'windows',
  'garage-door',
  'roof',
  'facade',
  'trim',
  'porch',
  'steps',
  'columns',
  'walkway',
  'driveway',
  'sidewalk',
  'lawn',
  'planting-bed',
  'tree',
  'shrubs',
  'yard-border',
  'fence',
  'retaining-wall',
  'patio',
  'deck',
  'pool',
  'mailbox',
  'neighbor',
  'street',
];

const INTERIOR_ORDER: ZoneKind[] = [
  'window',
  'door',
  'ceiling',
  'wall',
  'accent-wall',
  'floor',
  'stairs',
  'fireplace',
  'built-ins',
  'cabinetry',
  'countertop',
  'backsplash',
  'light-fixture',
  'furniture',
  'rug',
];

/** Generic keep phrase per zone kind (used when a kind has several zones or no usable label). */
const KIND_PHRASE: Partial<Record<ZoneKind, string>> = {
  'front-door': 'the front door and its surround',
  windows: 'the windows',
  'garage-door': 'the garage door',
  roof: 'the roof and roofline',
  facade: "the house's walls, siding and colors",
  trim: 'the trim and gutters',
  porch: 'the porch',
  steps: 'the steps',
  columns: 'the columns',
  walkway: 'the walkway',
  driveway: 'the driveway',
  sidewalk: 'the public sidewalk',
  lawn: 'the lawn outside the outline',
  'planting-bed': 'the planting beds',
  tree: 'the existing trees',
  shrubs: 'the existing shrubs',
  'yard-border': 'the yard border',
  fence: 'the fence',
  'retaining-wall': 'the retaining wall',
  patio: 'the patio',
  deck: 'the deck',
  pool: 'the pool',
  mailbox: 'the mailbox',
  neighbor: 'the neighboring houses',
  street: 'the street',
  window: 'the windows and their trim',
  door: 'the doors and openings',
  ceiling: 'the ceiling and its height',
  wall: 'the walls and their color',
  'accent-wall': 'the accent wall',
  floor: 'the floor',
  stairs: 'the stairs',
  fireplace: 'the fireplace',
  'built-ins': 'the built-ins',
  cabinetry: 'the cabinets',
  countertop: 'the countertops',
  backsplash: 'the backsplash',
  'light-fixture': 'the light fixtures',
  furniture: 'the furniture',
  rug: 'the rug',
};

/** Kinds whose zone label reads well on its own as a keep item (single zone). */
const LABEL_KINDS = new Set<ZoneKind>(['front-door', 'garage-door', 'porch', 'steps', 'walkway', 'driveway', 'tree', 'fence', 'patio', 'deck', 'retaining-wall', 'fireplace', 'stairs', 'cabinetry', 'countertop', 'backsplash', 'built-ins']);

/** Words in a scene keep-list item that conflict with changing a zone of this kind. */
const KIND_CONFLICT: Partial<Record<ZoneKind, RegExp>> = {
  facade: /\b(facade|siding|brick|stucco|clapboard|shingles? siding|exterior (walls?|paint|color)|paint(ed)?)\b/i,
  roof: /\b(roof|shingles?|roofline)\b/i,
  'front-door': /\bfront door\b/i,
  'garage-door': /\bgarage door\b/i,
  windows: /\b(windows?|shutters?)\b/i,
  trim: /\btrim\b/i,
  porch: /\bporch\b/i,
  steps: /\b(steps|stairs?)\b/i,
  walkway: /\b(walkway|walk|path)\b/i,
  driveway: /\bdriveway\b/i,
  lawn: /\b(lawn|grass|turf)\b/i,
  'planting-bed': /\b(beds?|planting|foundation plant\w*)\b/i,
  shrubs: /\bshrubs?\b/i,
  fence: /\bfenc(e|ing)\b/i,
  patio: /\bpatio\b/i,
  deck: /\bdeck\b/i,
  wall: /\b(walls?|paint(ed)?)\b/i,
  'accent-wall': /\baccent wall\b/i,
  floor: /\b(floor(s|ing)?|carpet|hardwood)\b/i,
  ceiling: /\bceiling\b/i,
  cabinetry: /\bcabinet(s|ry)?\b/i,
  countertop: /\bcounter(top)?s?\b/i,
  backsplash: /\bbacksplash\b/i,
  fireplace: /\bfireplace\b/i,
  'light-fixture': /\b(light fixtures?|lights?|lamps?|chandeliers?|pendants?)\b/i,
};

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(points: readonly Pt[]): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

function pathBox(path: ScenePath): Box | null {
  const b = boxOf(path.points);
  if (!b) return null;
  const r = Math.max(1, path.widthPx / 2);
  return { x0: b.x0 - r, y0: b.y0 - r, x1: b.x1 + r, y1: b.y1 + r };
}

/** Frame size estimated from the scene geometry (zones usually tile the photo). */
function sceneFrame(scene: SceneMap): { width: number; height: number } {
  let w = 1;
  let h = 1;
  for (const z of scene.zones) for (const p of z.polygon) if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
    w = Math.max(w, p.x);
    h = Math.max(h, p.y);
  }
  for (const p of scene.paths) for (const q of p.points) if (Number.isFinite(q.x) && Number.isFinite(q.y)) {
    w = Math.max(w, q.x);
    h = Math.max(h, q.y);
  }
  return { width: w, height: h };
}

/** Share of the box inside the view, and the share of the view the box covers. */
function overlap(box: Box, view: Rect): { ofBox: number; ofView: number } {
  const ix = Math.max(0, Math.min(box.x1, view.x + view.w) - Math.max(box.x0, view.x));
  const iy = Math.max(0, Math.min(box.y1, view.y + view.h) - Math.max(box.y0, view.y));
  const inter = ix * iy;
  const area = Math.max(1, (box.x1 - box.x0) * (box.y1 - box.y0));
  return { ofBox: inter / area, ofView: inter / Math.max(1, view.w * view.h) };
}

/** Share of box `a` that lies inside box `b`. */
function insideShare(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return (ix * iy) / Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
}

/** Share of points sampled along a path's centerline that fall inside `polygon`. */
function shareOfRouteInside(path: Pick<ScenePath, 'points'>, polygon: readonly Pt[]): number {
  const pts = path.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pointInPolygon(pts[0], polygon) ? 1 : 0;
  let inside = 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    for (let k = 0; k < 10; k++) {
      const t = k / 10;
      total++;
      if (pointInPolygon({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }, polygon)) inside++;
    }
  }
  total++;
  if (pointInPolygon(pts[pts.length - 1], polygon)) inside++;
  return inside / total;
}

/** Significant words of a phrase (for matching keep-list items to visible zones). */
function keyWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP_WORDS.has(w));
}
const STOP_WORDS = new Set([
  ...['with', 'from', 'that', 'this', 'their', 'left', 'right', 'front', 'back', 'side', 'center', 'centre', 'middle', 'along', 'near', 'behind', 'there'],
  ...['existing', 'mature', 'large', 'small', 'tall', 'wide', 'narrow', 'house', 'home', 'keep', 'original', 'painted'],
  ...['black', 'white', 'gray', 'grey', 'brown', 'green', 'blue', 'cream', 'beige', 'navy', 'dark', 'light', 'pale', 'yellow', 'orange', 'purple', 'pink', 'silver', 'golden'],
]);

/** Ground zones a route (driveway → door) can run through. */
const ROUTE_KINDS = new Set<ZoneKind>(['walkway', 'driveway', 'steps', 'patio', 'sidewalk']);

function visibleIn(box: Box | null, view: Rect | null): boolean {
  if (!box || !view) return true;
  const o = overlap(box, view);
  return o.ofBox >= 0.15 || o.ofView >= 0.03;
}

/** "lower center", "upper left", "center" — where a box sits in the view. */
export function positionWords(box: Box, view: Rect): string {
  const cx = ((box.x0 + box.x1) / 2 - view.x) / view.w;
  const cy = ((box.y0 + box.y1) / 2 - view.y) / view.h;
  const wide = (box.x1 - box.x0) / view.w > 0.75;
  const v = cy < 0.36 ? 'upper' : cy > 0.64 ? 'lower' : '';
  if (wide) return v ? `across the ${v === 'upper' ? 'top' : 'bottom'}` : 'across the middle';
  const hz = cx < 0.36 ? 'left' : cx > 0.64 ? 'right' : 'center';
  if (!v) return hz === 'center' ? 'center' : `middle ${hz}`;
  return `${v} ${hz}`;
}

function routeWords(path: Pick<ScenePath, 'from' | 'to'>): string {
  const from = lowerFirst(stripTrailingPunct(path.from));
  const to = lowerFirst(stripTrailingPunct(path.to));
  if (from && to) return `from ${withArticle(from)} to ${withArticle(to)}`;
  return '';
}

const INTERIOR_ELEMENTS = new Set<ElementType>([
  'wall-paint',
  'flooring',
  'ceiling',
  'interior-lighting',
  'cabinets',
  'countertops',
  'backsplash',
  'furniture',
  'window-treatments',
  'decor',
  'fireplace',
]);

export interface SceneContextOptions {
  /** Photo region exported to the app (photo px) — position words and visibility are relative to it. */
  view?: Rect;
  /** Photo size; estimated from the scene geometry when omitted. */
  frame?: { width: number; height: number };
}

/**
 * Builds the PromptContext pieces from the scene map + brief for a target
 * (pure): area words with positions (relative to the exported view when
 * given), a prioritized KEEP list of named scene elements outside the target
 * and visible in the view (+ existing routes such as driveway → front door +
 * the scene's keep-list, minus items that conflict with the change), light
 * from scene.lighting, subject from the architecture, interior/exterior.
 */
export function promptContextFromScene(
  scene: SceneMap | undefined,
  brief: DesignBrief,
  targetZoneIds: string[],
  extras: Pick<PromptContext, 'app' | 'instruction' | 'ratio' | 'markerColorName' | 'references'>,
  opts: SceneContextOptions = {},
): PromptContext {
  const interior = scene
    ? spaceKindOf(scene.category) === 'interior'
    : brief.elements.length > 0 && brief.elements.every((e) => INTERIOR_ELEMENTS.has(e.type));
  const strictness = brief.strictness ?? 'balanced';
  const base: PromptContext = {
    ...extras,
    areaText: '',
    keep: [],
    light: defaultLight(interior),
    style: '',
    strictness,
    plantMaturity: brief.plantMaturity,
    interior,
    constraints: [],
  };
  if (!scene) {
    const whole = brief.scope === 'whole' || !extras.markerColorName;
    return { ...base, markerColorName: whole ? '' : extras.markerColorName, areaText: whole ? '' : 'the outlined area' };
  }

  const frame = opts.frame ?? sceneFrame(scene);
  const view: Rect = opts.view ?? { x: 0, y: 0, w: frame.width, h: frame.height };
  const zoneSet = new Set(scene.zones.map((z) => z.id));
  const elementPathIds = brief.elements.flatMap((e) => e.pathIds).filter((id) => scene.paths.some((p) => p.id === id));
  const hasTargets = targetZoneIds.some((id) => zoneSet.has(id)) || elementPathIds.length > 0;
  // No marker, whole scope or nothing targeted: a whole-image edit (the export has no outline).
  const whole = brief.scope === 'whole' || !extras.markerColorName || !hasTargets;

  const targetIds = new Set(whole ? [] : targetZoneIds);
  const targetZones = scene.zones.filter((z) => targetIds.has(z.id));
  const pathIds = new Set(whole ? [] : elementPathIds);
  const targetPaths = scene.paths.filter((p) => pathIds.has(p.id));
  const targetKinds = new Set(targetZones.map((z) => z.kind));
  if (targetPaths.length) targetKinds.add('walkway');

  // Area words.
  const areaParts: string[] = [];
  const constraints: string[] = [];
  const at = (box: Box | null) => {
    if (!box) return '';
    const where = positionWords(box, view);
    return where.startsWith('across') ? ` ${where}` : ` in the ${where}`;
  };
  for (const z of targetZones) {
    areaParts.push(`${withArticle(z.label || KIND_PHRASE[z.kind] || z.kind)}${at(boxOf(z.polygon))}`);
  }
  for (const p of targetPaths) {
    const route = routeWords(p);
    const label = p.label && !/→|->/.test(p.label) ? withArticle(p.label) : 'the path';
    areaParts.push(`${label}${at(pathBox(p))}${route ? `, ${route}` : ''}`);
    if (route) constraints.push(`It must still lead ${route}.`);
  }
  let areaText = '';
  if (!whole) {
    areaText = areaParts.length > 3 ? `${areaParts.slice(0, 3).join(', ')} and ${areaParts.length - 3} more area${areaParts.length > 4 ? 's' : ''}` : joinList(areaParts);
    if (!areaText) areaText = 'the outlined area';
  }

  // Keep list: routes first (driveway → door), then zones by kind priority, then the scene keep-list.
  const keep: string[] = [];
  const routeTargets = targetZones.filter((z) => ROUTE_KINDS.has(z.kind) && z.polygon.length >= 3);
  for (const p of scene.paths) {
    if (pathIds.has(p.id) || p.kind === 'suggested') continue;
    const box = pathBox(p);
    if (!visibleIn(box, view)) continue;
    const route = routeWords(p);
    if (!route) continue;
    // A route running through a walkway / driveway being redesigned is a requirement of the change, not a keep item.
    if (routeTargets.some((z) => shareOfRouteInside(p, z.polygon) >= 0.15)) constraints.push(`It must still lead ${route}.`);
    else keep.push(`the path ${route}`);
  }
  const targetPathBoxes = targetPaths.map(pathBox).filter((b): b is Box => !!b);
  // Kinds the change is about: the targets, or for whole-image edits the kinds the instruction names.
  const change = changeFromInstruction(extras.instruction || '');
  const conflictKinds = whole ? (Object.keys(KIND_CONFLICT) as ZoneKind[]).filter((k) => KIND_CONFLICT[k]?.test(change)) : [...targetKinds];
  const conflicts = conflictKinds.map((k) => KIND_CONFLICT[k]).filter((r): r is RegExp => !!r);
  const cropped = view.w * view.h < 0.9 * frame.width * frame.height;
  const visibleWords = new Set<string>();
  const order = interior ? INTERIOR_ORDER : EXTERIOR_ORDER;
  const byKind = new Map<ZoneKind, SceneZone[]>();
  for (const z of scene.zones) {
    if (targetIds.has(z.id)) continue;
    const box = boxOf(z.polygon);
    if (!visibleIn(box, view)) continue;
    // The walkway a targeted path redraws is part of the change.
    if (box && ROUTE_KINDS.has(z.kind) && targetPathBoxes.some((t) => insideShare(box, t) >= 0.5)) continue;
    for (const w of keyWords(`${z.label} ${z.description}`)) visibleWords.add(w);
    // Whole-image edits: don't ask to keep what the instruction changes.
    if (whole && conflictKinds.includes(z.kind)) continue;
    const list = byKind.get(z.kind) ?? [];
    list.push(z);
    byKind.set(z.kind, list);
  }
  for (const kind of order) {
    const zones = byKind.get(kind);
    if (!zones?.length) continue;
    const generic = KIND_PHRASE[kind];
    if (!generic) continue;
    const other = targetKinds.has(kind) && kind !== 'lawn';
    if (zones.length === 1 && LABEL_KINDS.has(kind) && zones[0].label && zones[0].label.length <= 60 && !other) {
      keep.push(withArticle(zones[0].label));
    } else if (other) {
      keep.push(generic.replace(/^(the|every) /, (m) => (m === 'every ' ? 'every other ' : 'the other ')));
    } else {
      keep.push(generic);
    }
  }
  for (const item of scene.keep.slice(0, 6)) {
    const t = stripTrailingPunct(item);
    if (!t || t.length > 80) continue;
    if (conflicts.some((re) => re.test(t))) continue;
    // In a crop, only name things that are actually in the picture (else the model may add them).
    if (cropped && !keyWords(t).some((w) => visibleWords.has(w))) continue;
    keep.push(withArticle(t));
  }

  const light = scene.lighting ? stripTrailingPunct(scene.lighting) : defaultLight(interior);
  const style = scene.architecture?.style || scene.style || '';
  const place = SPACE_TYPE_LABELS[scene.category]?.toLowerCase();

  const keepItems = (whole ? keep.map((k) => k.replace(/ outside the outline$/, '')) : keep).filter((k, i, all) => all.indexOf(k) === i);
  return {
    ...base,
    markerColorName: whole ? '' : extras.markerColorName,
    openingsInTarget: (whole ? conflictKinds : [...targetKinds]).some((k) => OPENING_KINDS.has(k)),
    areaText,
    keep: keepItems,
    light,
    style,
    place: place && !/^(front|back|side) of house$|^other/.test(place) ? place : undefined,
    constraints,
  };
}

// ---------------------------------------------------------------------------
// Fix prompts
// ---------------------------------------------------------------------------

/** One-line fixes the user can paste into the same chat ("Put back the window I had on the left…"). */
export const FIX_PROMPTS: { id: string; label: string; text: string; app?: HandoffApp; setting?: 'exterior' | 'interior' }[] = [
  {
    id: 'openings',
    label: 'Extra or moved window / door',
    text: 'Put every door and window back exactly as in my original photo: same number, size, shape, position and trim. Keep the rest of your edit.',
  },
  {
    id: 'framing',
    label: 'Cropped or zoomed',
    text: 'Show the whole photo at its original framing and zoom, edge to edge, with the same aspect ratio. Do not crop, zoom, rotate or extend it.',
  },
  {
    id: 'marker',
    label: 'Outline still visible',
    text: 'Remove the colored outline completely: no line, border or edging where it was. Keep everything else exactly the same.',
  },
  {
    id: 'color-cast',
    label: 'Color cast',
    text: "Remove the color cast: match my original photo's white balance, exposure and colors exactly. Keep everything else the same.",
  },
  {
    id: 'house-color',
    label: 'House color changed',
    text: 'Keep the house exactly as in my photo: the same siding, trim, roof and door colors and materials. Only the outlined area changes.',
    setting: 'exterior',
  },
  {
    id: 'room-changed',
    label: 'Room changed',
    text: 'Keep the room exactly as in my photo: the same walls, ceiling, windows, doors and furniture outside the outlined area.',
    setting: 'interior',
  },
  {
    id: 'invented',
    label: 'Invented houses / trees',
    text: 'Remove anything new outside the outlined area (extra trees, houses, structures or objects) and restore it exactly as in my original photo.',
    setting: 'exterior',
  },
  {
    id: 'too-much',
    label: 'Too much changed',
    text: 'Too much changed. Redo it changing only the area inside the outline; everything else must match my original photo exactly.',
  },
  {
    id: 'new-image',
    label: 'Made a new picture',
    text: 'Edit my uploaded photo itself instead of creating a new image: same house, same camera position, same framing.',
    app: 'chatgpt',
  },
  {
    id: 'new-image-gemini',
    label: 'Made a new picture',
    text: 'Using my uploaded photo itself, make only the requested change. Keep the same scene, camera position, framing and aspect ratio.',
    app: 'gemini',
  },
];

/**
 * The fix prompts that apply to an app and setting, with the marker colour
 * named ("Remove the magenta outline…") when known.
 */
export function fixPromptsFor(app: HandoffApp, interior: boolean, markerColorName = ''): { id: string; label: string; text: string }[] {
  const setting = interior ? 'interior' : 'exterior';
  return FIX_PROMPTS.filter((f) => (!f.app || f.app === app) && (!f.setting || f.setting === setting)).map((f) => ({
    id: f.id,
    label: f.label,
    text: markerColorName ? f.text.replace('colored outline', `${markerColorName} outline`) : f.text,
  }));
}
