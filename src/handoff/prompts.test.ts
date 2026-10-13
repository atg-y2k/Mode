import { describe, expect, it } from 'vitest';
import type { DesignBrief, SceneMap, SceneZone } from '../../shared/types';
import { CHATGPT_URL, GEMINI_APP_URL, MAX_DEEPLINK_PROMPT_CHARS, chatgptDeepLink } from './deeplinks';
import {
  FIX_PROMPTS,
  MAX_PROMPT_CHARS,
  buildHandoffPrompt,
  changeFromInstruction,
  fixPromptsFor,
  mentionsPlants,
  positionWords,
  promptContextFromScene,
  splitSentences,
  subjectPhrase,
  type PromptContext,
} from './prompts';

const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const zone = (id: string, kind: SceneZone['kind'], label: string, poly: SceneZone['polygon']): SceneZone => ({
  id,
  kind,
  label,
  description: '',
  polygon: poly,
  editable: true,
});

const scene: SceneMap = {
  category: 'front-exterior',
  summary: 'Street view of a 1950s brick ranch',
  viewpoint: 'street',
  style: 'Ranch',
  boundaries: '',
  lighting: 'Soft morning sun from the left; shadows fall to the right',
  orientation: 'front faces south-east',
  architecture: { style: '1950s ranch', features: [], materials: ['red brick'], proportions: '', designLanguage: [], purpose: [] },
  zones: [
    zone('door', 'front-door', 'Black front door with sidelights', box(760, 420, 840, 600)),
    zone('win1', 'windows', 'Left windows', box(300, 430, 500, 540)),
    zone('win2', 'windows', 'Right windows', box(1000, 430, 1200, 540)),
    zone('roof', 'roof', 'Hip roof', box(150, 250, 1450, 400)),
    zone('facade', 'facade', 'Red brick facade', box(150, 400, 1450, 640)),
    zone('walk', 'walkway', 'Concrete walkway to front door', [
      { x: 760, y: 640 },
      { x: 840, y: 640 },
      { x: 900, y: 1000 },
      { x: 700, y: 1000 },
    ]),
    zone('drive', 'driveway', 'Asphalt driveway', box(1100, 700, 1600, 1200)),
    zone('lawn', 'lawn', 'Front lawn', box(0, 650, 1200, 1200)),
    zone('bed', 'planting-bed', 'Foundation bed left of door', box(200, 600, 740, 700)),
    zone('tree', 'tree', 'Mature maple at left', box(0, 100, 250, 800)),
    { ...zone('nb', 'neighbor', 'Neighbor house', box(1450, 300, 1600, 650)), editable: false },
    { ...zone('sky', 'sky', 'Sky', box(0, 0, 1600, 250)), editable: false },
  ],
  paths: [
    {
      id: 'route',
      label: 'Driveway → front door',
      from: 'driveway',
      to: 'front door',
      description: '',
      points: [
        { x: 1150, y: 900 },
        { x: 860, y: 860 },
        { x: 800, y: 640 },
      ],
      widthPx: 90,
      kind: 'existing',
    },
  ],
  keep: ['the mature maple at left', 'the red brick', 'the black shutters'],
  opportunities: [],
  createdAt: 0,
  model: 'test',
};
const FRAME = { width: 1600, height: 1200 };

const brief = (patch: Partial<DesignBrief> = {}): DesignBrief => ({
  prompt: '',
  elements: [],
  plantMaturity: 'established',
  ideaItemIds: [],
  targetZoneIds: [],
  scope: 'zones',
  ...patch,
});

const PATH_INSTRUCTION =
  "Edit this photo of a 1950s red-brick ranch seen from the street. Replace the narrow concrete walkway with a 5 ft wide path of large irregular bluestone flagstones (18–24 in) with 1 in gravel joints, laid in a gentle curve. Plant Hidcote lavender, 18 in apart, along both sides. Show plants about three years after planting. Keep the camera position, framing, perspective and lens exactly the same. Keep the house's architecture — roofline, windows, doors, trim, siding and colors — and everything outside the described areas exactly as it is. Photorealistic. New materials sit on the existing ground plane with correct perspective; edges blend naturally into the untouched surroundings. Add no text, people or vehicles.";

function ctx(patch: Partial<PromptContext> = {}): PromptContext {
  return {
    app: 'chatgpt',
    instruction: 'Replace the concrete walkway with large irregular bluestone flagstones (18–24 in) with gravel joints.',
    areaText: 'the walkway in the lower center, from the driveway at left to the front door',
    keep: ['the front door', 'the windows', 'the lawn outside the outline', 'the neighboring houses'],
    light: 'soft morning light from the left; shadows fall to the right',
    style: '1950s ranch',
    ratio: '3:2',
    markerColorName: 'magenta',
    strictness: 'balanced',
    plantMaturity: 'established',
    references: [],
    interior: false,
    ...patch,
  };
}

const CHATGPT_REQUIRED = [
  'Edit the attached photo of my 1950s ranch house (Image 1). It must stay the same photograph.',
  'CHANGE — only inside the magenta outline (the walkway in the lower center, from the driveway at left to the front door): Replace the concrete walkway',
  'KEEP EXACTLY AS IS: the front door, the windows, the lawn outside the outline and the neighboring houses, and everything else outside the outline.',
  'Do not add, remove or move any doors or windows.',
  'Same camera position, lens, perspective and framing; same 3:2 aspect ratio; do not crop, zoom, rotate, straighten or extend the image.',
  'MATCH THE PHOTO: soft morning light from the left, shadows fall to the right; same white balance, exposure, contrast, sharpness and grain;',
  'The magenta outline is only a selection marker: remove it completely and do not add any border, edging or line along it.',
  'Do not change anything else.',
];

describe('buildHandoffPrompt — ChatGPT (OpenAI phrasing)', () => {
  it('contains every required section in order', () => {
    const p = buildHandoffPrompt(ctx());
    let at = -1;
    for (const phrase of CHATGPT_REQUIRED) {
      const i = p.indexOf(phrase);
      expect(i, phrase).toBeGreaterThan(at);
      at = i;
    }
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });

  it('strictness changes the latitude sentence', () => {
    expect(buildHandoffPrompt(ctx({ strictness: 'strict' }))).toContain('Change nothing beyond this request');
    expect(buildHandoffPrompt(ctx({ strictness: 'balanced' }))).toContain('Keep it realistic and in proportion with the house.');
    const creative = buildHandoffPrompt(ctx({ strictness: 'creative' }));
    expect(creative).toContain('You may refine details inside the outline');
    expect(creative).not.toContain('Change nothing beyond');
  });

  it('adds plant maturity wording only when the change involves plants', () => {
    const planting = ctx({ instruction: 'Plant a border of Hidcote lavender 18 in apart along the walk.' });
    expect(buildHandoffPrompt({ ...planting, plantMaturity: 'new' })).toContain('newly planted from nursery pots');
    expect(buildHandoffPrompt({ ...planting, plantMaturity: 'established' })).toContain('about three years after planting');
    expect(buildHandoffPrompt({ ...planting, plantMaturity: 'mature' })).toContain('full mature size');
    expect(buildHandoffPrompt(ctx())).not.toMatch(/three years|nursery pots|mature size/);
  });

  it('names reference images by role (Image 2 = reference only)', () => {
    const p = buildHandoffPrompt(ctx({ references: [{ role: 'Stone color and texture' }, { role: 'planting style' }] }));
    expect(p).toContain('Image 2 is only a reference for stone color and texture: copy its color and texture, not its layout, perspective, lighting or surroundings.');
    expect(p).toContain('Image 3 is only a reference for planting style');
  });

  it('allows the described edging when the change asks for it', () => {
    const p = buildHandoffPrompt(ctx({ instruction: 'Edge the bed with a low steel edging strip.' }));
    expect(p).toContain('(the only edging is the one the change describes)');
  });

  it('says "other" doors/windows when the change is about one', () => {
    const p = buildHandoffPrompt(ctx({ instruction: 'Paint the front door deep navy.', areaText: 'the front door in the center' }));
    expect(p).toContain('Do not add, remove or move any other doors or windows.');
    // A door named only as a location doesn't count.
    expect(buildHandoffPrompt(ctx({ instruction: 'Lay bluestone on the walk up to the front door.' }))).toContain('Do not add, remove or move any doors or windows.');
    expect(buildHandoffPrompt(ctx({ openingsInTarget: true }))).toContain('any other doors');
  });

  it('interior wording', () => {
    const p = buildHandoffPrompt(ctx({ interior: true, style: 'Mid-century modern', place: 'living room', instruction: 'Replace the carpet with wide white-oak planks.', keep: [] }));
    expect(p).toContain('Edit the attached photo of my mid-century modern living room (Image 1).');
    expect(p).toContain('windows, doors or openings');
    expect(p).toContain('new finishes follow the existing floor and wall planes');
    expect(p).toContain('proportion with the room');
  });

  it('whole-image runs drop every outline reference', () => {
    const p = buildHandoffPrompt(ctx({ markerColorName: '', areaText: '' }));
    expect(p).not.toMatch(/outline|marker/i);
    expect(p).toContain('CHANGE: Replace the concrete walkway');
  });
});

describe('buildHandoffPrompt — Gemini (semantic masking, narrative)', () => {
  it("opens with Google's sentence and keeps exclusions positive", () => {
    const p = buildHandoffPrompt(ctx({ app: 'gemini', markerColorName: 'cyan' }));
    expect(p.startsWith('Using the provided photo of my 1950s ranch house, change only the walkway in the lower center, from the driveway at left to the front door, which is marked with a cyan outline.')).toBe(true);
    expect(p).toContain('Keep everything else in the image exactly the same, preserving the original style, lighting and composition: leave the front door, the windows, the lawn outside the outline and the neighboring houses untouched');
    expect(p).toContain('every door and window stays where it is with the same size and shape');
    expect(p).toContain('the same 3:2 aspect ratio, with the whole scene visible edge to edge and nothing cropped, zoomed or extended');
    expect(p).toContain('The light should match the photo — soft morning light from the left, shadows fall to the right — with the same color balance');
    expect(p).toContain('The cyan outline is only a selection marker: remove it completely');
    // Narrative, not a bulleted list.
    expect(p).not.toMatch(/KEEP EXACTLY|MATCH THE PHOTO|^- /m);
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });

  it('strictness and references in Gemini wording', () => {
    expect(buildHandoffPrompt(ctx({ app: 'gemini', strictness: 'strict' }))).toContain('Make exactly this change and nothing more');
    expect(buildHandoffPrompt(ctx({ app: 'gemini', strictness: 'creative' }))).toContain('Within the outlined area you may refine the details');
    expect(buildHandoffPrompt(ctx({ app: 'gemini', references: [{ role: 'x' }] }))).toMatch(/^Using the provided photo of my 1950s ranch house \(Image 1\), change only/);
    expect(buildHandoffPrompt(ctx({ app: 'gemini', references: [{ role: 'the paver color' }] }))).toContain(
      'Image 2 serves only as a reference for the paver color: use its color and texture, not its layout, perspective or surroundings.',
    );
  });

  it('yards get "the backyard of my …" subjects', () => {
    expect(buildHandoffPrompt(ctx({ app: 'gemini', place: 'backyard', style: 'Craftsman bungalow' }))).toMatch(/^Using the provided photo of the backyard of my Craftsman bungalow,/);
  });
});

describe('length limit', () => {
  it('stays ≤ 1,800 chars with a huge instruction and keep list, keeping the required phrases', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} adds more lavender, salvia and boxwood detail along the walk with exact spacing.`).join(' ');
    const keep = Array.from({ length: 20 }, (_, i) => `the named scene element number ${i + 1}`);
    for (const app of ['chatgpt', 'gemini'] as const) {
      for (const strictness of ['strict', 'balanced', 'creative'] as const) {
        const p = buildHandoffPrompt(ctx({ app, instruction: long, keep, strictness, references: [{ role: 'stone' }] }));
        expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
        expect(p).toContain('Sentence 1 adds');
        expect(p).toContain('outline is only a selection marker');
        expect(p).toContain('aspect ratio');
        expect(p).toContain('the named scene element number 1');
        expect(p).toContain('Image 2');
      }
    }
  });

  it('cuts a single giant sentence at a word boundary', () => {
    const giant = `Replace the walkway with ${'very '.repeat(600)}large flagstones.`;
    const p = buildHandoffPrompt(ctx({ instruction: giant }));
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(p).toContain('Replace the walkway with very');
    expect(p).toContain('…');
  });
});

describe('changeFromInstruction', () => {
  it('keeps the change sentences and drops the boilerplate the template restates', () => {
    const c = changeFromInstruction(PATH_INSTRUCTION);
    expect(c.startsWith('Replace the narrow concrete walkway')).toBe(true);
    expect(c).toContain('Plant Hidcote lavender');
    expect(c).not.toMatch(/Edit this photo|camera position|Photorealistic|Add no text|three years|blend naturally|Keep the house/);
  });
  it('keeps specific requirements that start with "Keep" or "Leave"', () => {
    const c = changeFromInstruction(
      'Edit this photo of a ranch. Plant lavender along the walk. Keep the lavender low, under the window sills. Leave a 6 in mulch strip along the edge. Keep the existing lamp post exactly where it is. Keep the same time of day and sun direction.',
    );
    expect(c).toBe('Plant lavender along the walk. Keep the lavender low, under the window sills. Leave a 6 in mulch strip along the edge. Keep the existing lamp post exactly where it is.');
  });
  it('keeps what follows "Edit this photo:"', () => {
    expect(changeFromInstruction('Edit this photo: paint the door red.')).toBe('Paint the door red.');
  });
  it('falls back to the whole instruction', () => {
    expect(changeFromInstruction('Keep everything.')).toBe('Keep everything.');
  });
  it('splits sentences without breaking "18 in." style abbreviations or decimals', () => {
    expect(splitSentences('Use 1.5 in. gravel joints and 18 in. slabs. Then plant.')).toEqual(['Use 1.5 in. gravel joints and 18 in. slabs.', 'Then plant.']);
  });
});

describe('promptContextFromScene', () => {
  const extras = { app: 'chatgpt' as const, instruction: PATH_INSTRUCTION, ratio: '16:9', markerColorName: 'magenta', references: [] };

  it('describes the target with its position, and keeps named things outside it', () => {
    const c = promptContextFromScene(scene, brief({ targetZoneIds: ['walk'], strictness: 'strict' }), ['walk'], extras, { frame: FRAME });
    expect(c.areaText).toBe('the concrete walkway to front door in the lower center');
    expect(c.keep).toContain('the black front door with sidelights');
    expect(c.keep).toContain('the windows');
    expect(c.keep).toContain('the roof and roofline');
    expect(c.keep).toContain('the lawn outside the outline');
    expect(c.keep).toContain('the neighboring houses');
    expect(c.keep).toContain('the mature maple at left');
    expect(c.keep.join(' ')).not.toMatch(/concrete walkway/);
    expect(c.keep.join(' ')).not.toMatch(/sky/i);
    // The driveway → door route runs through the walkway being redesigned: a requirement, not a keep item.
    expect(c.constraints).toContain('It must still lead from the driveway to the front door.');
    expect(c.keep.join(' ')).not.toMatch(/path from the driveway/);
    expect(c.light).toBe('Soft morning sun from the left; shadows fall to the right');
    expect(c.style).toBe('1950s ranch');
    expect(c.strictness).toBe('strict');
    expect(c.plantMaturity).toBe('established');
    expect(c.interior).toBe(false);
    expect(c.markerColorName).toBe('magenta');
    const p = buildHandoffPrompt(c);
    expect(p).toContain('It must still lead from the driveway to the front door.');
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });

  it('keeps the driveway → door route when the change is elsewhere', () => {
    const c = promptContextFromScene(scene, brief({ targetZoneIds: ['bed'] }), ['bed'], extras, { frame: FRAME });
    expect(c.keep[0]).toBe('the path from the driveway to the front door');
    expect(c.keep).toContain('the concrete walkway to front door');
    expect(c.areaText).toBe('the foundation bed left of door in the middle left');
  });

  it('a crop view: positions relative to the crop, only visible things kept', () => {
    const view = { x: 400, y: 500, w: 800, h: 450 };
    const c = promptContextFromScene(scene, brief({ targetZoneIds: ['walk'] }), ['walk'], extras, { view, frame: FRAME });
    expect(c.areaText).toBe('the concrete walkway to front door in the lower center');
    expect(c.keep.join(' ')).not.toMatch(/maple|neighboring|roof|shutters/);
    expect(c.keep).toContain('the red brick'); // the brick facade is in view
  });

  it('drops scene keep-items that conflict with the target', () => {
    const c = promptContextFromScene(scene, brief({ targetZoneIds: ['facade'] }), ['facade'], { ...extras, instruction: 'Paint the brick a soft white.' }, { frame: FRAME });
    expect(c.keep.join(' ')).not.toMatch(/brick|walls, siding/);
    expect(c.keep).toContain('the black front door with sidelights');
  });

  it('whole-image runs: no area, no marker, and nothing the instruction changes in the keep list', () => {
    const c = promptContextFromScene(
      scene,
      brief({ scope: 'whole' }),
      [],
      { ...extras, instruction: 'Edit this photo: paint the brick facade soft white and the front door navy.', markerColorName: 'bright' },
      { frame: FRAME },
    );
    expect(c.markerColorName).toBe('');
    expect(c.areaText).toBe('');
    expect(c.keep.join(' ')).not.toMatch(/brick|black front door|walls/);
    expect(c.keep).toContain('the lawn');
    expect(c.keep).toContain('the path from the driveway to the front door');
    expect(c.openingsInTarget).toBe(true);
    expect(buildHandoffPrompt(c)).not.toMatch(/outline/);
  });

  it('no targets at all also means a whole-image prompt', () => {
    const c = promptContextFromScene(scene, brief(), [], extras, { frame: FRAME });
    expect(c.markerColorName).toBe('');
  });

  it('targeted paths: route words and a connection requirement', () => {
    const b = brief({ elements: [{ id: 'e', type: 'pathway', label: 'Walk', zoneIds: [], pathIds: ['route'], dimensions: [], choices: {}, note: '' }] });
    const c = promptContextFromScene(scene, b, [], extras, { frame: FRAME });
    expect(c.areaText).toMatch(/^the path in the lower (center|right), from the driveway to the front door$/);
    expect(c.constraints).toEqual(['It must still lead from the driveway to the front door.']);
    // The walkway zone the path redraws is not "kept".
    expect(c.keep.join(' ')).not.toMatch(/walkway/);
  });

  it('interior scenes', () => {
    const room: SceneMap = {
      ...scene,
      category: 'living-room',
      lighting: '',
      architecture: { ...scene.architecture, style: 'Mid-century modern' },
      zones: [zone('floor', 'floor', 'Beige carpet', box(0, 700, 1600, 1200)), zone('w', 'window', 'Picture window', box(500, 200, 1100, 600)), zone('wall', 'wall', 'Walls', box(0, 0, 1600, 700))],
      paths: [],
      keep: [],
    };
    const c = promptContextFromScene(room, brief({ targetZoneIds: ['floor'] }), ['floor'], { ...extras, instruction: 'Replace the carpet with white oak.' }, { frame: FRAME });
    expect(c.interior).toBe(true);
    expect(c.place).toBe('living room');
    expect(c.keep).toEqual(['the windows and their trim', 'the walls and their color']);
    expect(c.light).toMatch(/daylight from the windows/);
    expect(buildHandoffPrompt(c)).toContain('Edit the attached photo of my mid-century modern living room (Image 1).');
  });

  it('works without a scene', () => {
    const c = promptContextFromScene(undefined, brief(), [], extras);
    expect(c.areaText).toBe('the outlined area');
    expect(buildHandoffPrompt(c)).toContain('only inside the magenta outline (the outlined area)');
  });
});

describe('helpers', () => {
  it('subjectPhrase', () => {
    expect(subjectPhrase('1950s ranch', false)).toBe('my 1950s ranch house');
    expect(subjectPhrase('Craftsman bungalow', false)).toBe('my Craftsman bungalow');
    expect(subjectPhrase('', false, 'front yard')).toBe('the front yard of my house');
    expect(subjectPhrase('', true, 'kitchen')).toBe('my kitchen');
    expect(subjectPhrase('Farmhouse kitchen', true, 'kitchen')).toBe('my farmhouse kitchen');
    expect(subjectPhrase('Center-hall Colonial Revival, side-gabled with a symmetrical facade', false)).toBe('my Center-hall Colonial Revival house');
  });
  it('positionWords', () => {
    const view = { x: 0, y: 0, w: 100, h: 100 };
    expect(positionWords({ x0: 40, y0: 70, x1: 60, y1: 90 }, view)).toBe('lower center');
    expect(positionWords({ x0: 0, y0: 0, x1: 20, y1: 20 }, view)).toBe('upper left');
    expect(positionWords({ x0: 45, y0: 45, x1: 55, y1: 55 }, view)).toBe('center');
    expect(positionWords({ x0: 0, y0: 80, x1: 100, y1: 100 }, view)).toBe('across the bottom');
  });
  it('mentionsPlants', () => {
    expect(mentionsPlants('a border of lavender')).toBe(true);
    expect(mentionsPlants('paint the door navy')).toBe(false);
  });
});

describe('FIX_PROMPTS', () => {
  it('cover the common failures with short, unique, pasteable lines', () => {
    const ids = FIX_PROMPTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['openings', 'framing', 'marker', 'color-cast', 'house-color', 'invented']) expect(ids).toContain(id);
    for (const f of FIX_PROMPTS) {
      expect(f.label.length).toBeGreaterThan(3);
      expect(f.text.length).toBeGreaterThan(30);
      expect(f.text.length).toBeLessThan(220);
    }
  });
  it('filter by app and setting and name the marker colour', () => {
    const g = fixPromptsFor('gemini', false, 'cyan');
    expect(g.find((f) => f.id === 'marker')?.text).toContain('Remove the cyan outline');
    expect(g.some((f) => f.id === 'new-image')).toBe(false);
    expect(g.some((f) => f.id === 'new-image-gemini')).toBe(true);
    expect(g.some((f) => f.id === 'room-changed')).toBe(false);
    expect(fixPromptsFor('chatgpt', true).some((f) => f.id === 'house-color')).toBe(false);
  });
});

describe('deep links', () => {
  it('prefills ChatGPT with the encoded prompt', () => {
    const url = chatgptDeepLink('Edit the photo — keep the door & windows.\nSame 3:2 ratio.');
    expect(url).toBe(`${CHATGPT_URL}?prompt=${encodeURIComponent('Edit the photo — keep the door & windows.\nSame 3:2 ratio.')}`);
    expect(new URL(url!).searchParams.get('prompt')).toBe('Edit the photo — keep the door & windows.\nSame 3:2 ratio.');
  });
  it('adds temporary-chat when asked', () => {
    const url = chatgptDeepLink('hello', { temporary: true })!;
    expect(new URL(url).searchParams.get('temporary-chat')).toBe('true');
    expect(url.startsWith('https://chatgpt.com/?prompt=hello')).toBe(true);
  });
  it('returns null for empty or too-long prompts', () => {
    expect(chatgptDeepLink('   ')).toBeNull();
    expect(chatgptDeepLink('x'.repeat(MAX_DEEPLINK_PROMPT_CHARS + 1))).toBeNull();
    expect(chatgptDeepLink('x'.repeat(MAX_DEEPLINK_PROMPT_CHARS))).not.toBeNull();
    // Every real prompt fits.
    expect(chatgptDeepLink(buildHandoffPrompt(ctx({ instruction: 'word '.repeat(800) })))).not.toBeNull();
  });
  it('Gemini opens the app (no prefill)', () => {
    expect(GEMINI_APP_URL).toBe('https://gemini.google.com/app');
  });
});
