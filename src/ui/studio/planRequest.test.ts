import { describe, expect, it } from 'vitest';
import { PlanRequestSchema } from '../../../shared/api';
import {
  emptyBrief,
  type DesignBrief,
  type ElementDef,
  type ElementDimension,
  type ElementSpec,
  type IdeaItem,
  type ProjectLocation,
  type SceneMap,
} from '../../../shared/types';
import type { FeasibilityContext } from '../../assets/design';
import {
  buildPlanRequest,
  climateText,
  ideasForBrief,
  pathDescription,
  resolveCompare,
  sceneSummaryText,
  swapOptionInBrief,
  type PlanKnowledge,
} from './planRequest';

const IMAGE = 'data:image/jpeg;base64,AAAA';

const scene: SceneMap = {
  category: 'front-yard',
  summary: 'Two-story brick colonial seen from the street.',
  viewpoint: 'From the curb at eye level',
  style: 'Traditional',
  boundaries: 'Lawn ends at the public sidewalk.',
  lighting: 'Morning sun from the left',
  orientation: 'Front faces south-east',
  architecture: {
    style: 'Center-hall Colonial Revival',
    era: '1930s',
    features: ['symmetrical facade', 'gabled portico'],
    materials: ['red brick'],
    proportions: 'Two-story mass',
    designLanguage: ['symmetry', 'direct entry walk'],
    purpose: ['guests arrive from the driveway'],
  },
  zones: [
    { id: 'z-bed', kind: 'planting-bed', label: 'Front bed', description: 'Mulched bed with old yews', polygon: [], editable: true, sun: 'shade' },
    { id: 'z-walk', kind: 'walkway', label: 'Concrete walk', description: 'Narrow 3 ft concrete', polygon: [], editable: true },
    { id: 'z-sky', kind: 'sky', label: 'Sky', description: '', polygon: [], editable: false },
  ],
  paths: [
    { id: 'p1', label: 'Driveway → door', from: 'driveway', to: 'front door', description: '3 ft concrete', points: [], widthPx: 40, kind: 'existing' },
    { id: 'p2', label: 'Sketched path', from: '', to: '', description: '', points: [], widthPx: 40, kind: 'sketch' },
  ],
  keep: ['mature oak'],
  opportunities: ['wider walk'],
  createdAt: 0,
  model: 'test',
};

const plantsDim: ElementDimension = {
  id: 'plants',
  label: 'Plant palette',
  question: 'Which plants?',
  multiple: true,
  options: [
    { id: 'lavender', label: 'Lavender & roses', description: '', promptText: 'lavender and shrub roses' },
    { id: 'ferns', label: 'Ferns & hostas', description: '', promptText: 'ferns and hostas' },
    { id: 'ai-opt', label: 'AI pick', description: '', promptText: 'heuchera', feasibility: { rating: 'good', reasons: ['AI says fine'] } },
  ],
};
const stoneDim: ElementDimension = {
  id: 'stone-size',
  label: 'Stone size',
  question: 'What size stones?',
  options: [
    { id: 'large', label: 'Large flagstone', description: '', promptText: 'large 18-24 in flagstones' },
    { id: 'small', label: 'Small cobbles', description: '', promptText: 'small 4 in cobbles' },
    { id: 'gravel', label: 'Pea gravel', description: '', promptText: '3/8 in pea gravel' },
  ],
};

const bed: ElementSpec = {
  id: 'el-bed',
  type: 'planting-bed',
  label: 'Front bed',
  zoneIds: ['z-bed'],
  pathIds: [],
  dimensions: [plantsDim],
  choices: { plants: ['lavender', 'ai-opt'] },
  note: 'keep the oak',
};
const walk: ElementSpec = {
  id: 'el-walk',
  type: 'pathway',
  label: '',
  zoneIds: ['z-walk'],
  pathIds: ['p1', 'missing'],
  dimensions: [stoneDim],
  choices: { 'stone-size': ['large'], width: ['w5'] },
  note: '',
};

const pathwayDef: ElementDef = {
  type: 'pathway',
  label: 'Pathway',
  description: '',
  icon: 'Footprints',
  setting: 'exterior',
  zoneKinds: ['walkway'],
  dimensions: [
    stoneDim,
    { id: 'width', label: 'Width', question: 'How wide?', options: [{ id: 'w5', label: '5 ft', description: '', promptText: '5 ft wide' }] },
  ],
};

const calls: FeasibilityContext[] = [];
const knowledge: PlanKnowledge = {
  getElementDef: (type) => (type === 'pathway' ? pathwayDef : { ...pathwayDef, type, label: 'Planting bed', dimensions: [] }),
  guidanceFor: (type) =>
    type === 'pathway'
      ? {
          type,
          purpose: 'Lead guests clearly to the door.',
          rulesOfThumb: ['Primary walks 4–5 ft wide', 'Avoid zig-zags', 'Landing at the door', 'Fourth rule'],
          relateToArchitecture: [],
        }
      : undefined,
  getTheme: (id) =>
    id === 'cottage'
      ? {
          id,
          name: 'Cottage garden',
          setting: 'exterior',
          purpose: 'Abundant, romantic planting',
          description: '',
          principles: [],
          palette: [],
          materials: [],
          plants: [],
          lighting: [],
          suits: [],
          promptHint: 'loose layered cottage planting',
        }
      : undefined,
  optionFeasibility: (_type, _dim, optionId, ctx) => {
    calls.push(ctx);
    if (optionId === 'lavender') return { rating: 'poor', reasons: ['Lavender needs full sun; this bed is shade'] };
    if (optionId === 'ferns') return { rating: 'good', reasons: ['Shade lovers ✓'] };
    return undefined;
  },
  feasibilityContext: (location, zones, setting) => ({
    setting,
    ...(location?.hardinessZone ? { zone: 7, zoneLabel: location.hardinessZone } : {}),
    ...(zones[0]?.sun ? { sun: zones[0].sun } : {}),
  }),
};

const location: ProjectLocation = { zip: '22301', hardinessZone: '7a' };

function brief(patch: Partial<DesignBrief> = {}): DesignBrief {
  return { ...emptyBrief(), prompt: '  Make the entry welcoming  ', elements: [bed, walk], targetZoneIds: ['z-bed', 'gone'], ...patch };
}

const idea = (patch: Partial<IdeaItem>): IdeaItem => ({
  id: 'i',
  kind: 'note',
  title: 'Idea',
  note: '',
  colors: [],
  spaceIds: [],
  active: true,
  createdAt: 0,
  ...patch,
});

describe('sceneSummaryText', () => {
  it('covers summary, architecture, zones with sun, paths and keep-list', () => {
    const text = sceneSummaryText(scene);
    expect(text).toContain('Front yard');
    expect(text).toContain('Center-hall Colonial Revival (1930s)');
    expect(text).toContain('Front bed (planting-bed, shade)');
    expect(text).toContain('Sky (sky, context)');
    expect(text).toContain('Driveway → door');
    expect(text).toContain('Keep: mature oak');
  });

  it('stays within the request limit', () => {
    const big = { ...scene, opportunities: Array.from({ length: 2000 }, (_, i) => `opportunity ${i}`) };
    expect(sceneSummaryText(big).length).toBeLessThanOrEqual(8000);
  });
});

describe('buildPlanRequest', () => {
  const base = {
    image: IMAGE,
    ideaImages: [IMAGE, IMAGE, IMAGE, IMAGE],
    scene,
    setting: 'exterior' as const,
    spaceLabel: 'Front yard',
    ideas: [
      idea({ kind: 'theme', themeId: 'cottage', title: 'Cottage' }),
      idea({ kind: 'image', title: 'Stone walk', aiDescription: 'Bluestone walk', note: 'love the edging', colors: ['#aabbcc'] }),
    ],
    location,
    count: 9,
  };

  it('assembles a valid request from the brief, scene and idea board', () => {
    const req = buildPlanRequest({ ...base, brief: brief() }, knowledge);
    expect(() => PlanRequestSchema.parse(req)).not.toThrow();
    expect(req.count).toBe(6);
    expect(req.ideaImages).toHaveLength(3);
    expect(req.brief.prompt).toBe('Make the entry welcoming');
    expect(req.brief.targetZoneLabels).toEqual(['Front bed']);
    expect(req.zones.find((z) => z.id === 'z-bed')?.sun).toBe('shade');
    expect(req.zones.find((z) => z.id === 'z-walk')?.sun).toBeNull();
    expect(req.paths.find((p) => p.id === 'p2')?.description).toMatch(/Drawn by the homeowner/);
    expect(req.climate).toMatch(/7a/);

    const [bedReq, walkReq] = req.brief.elements;
    expect(bedReq.where).toEqual(['Front bed']);
    expect(bedReq.choices).toEqual([{ dimension: 'Plant palette', options: ['lavender and shrub roses', 'heuchera'] }]);
    // Plant feasibility rides along with the element, rated for the bed's sun.
    expect(bedReq.note).toContain('keep the oak');
    expect(bedReq.note).toContain('USDA 7a, shade');
    expect(bedReq.note).toContain('Lavender & roses — poor: Lavender needs full sun');
    expect(bedReq.note).toContain('AI pick — good');
    expect(calls.some((c) => c.sun === 'shade' && c.zone === 7)).toBe(true);

    // Empty label falls back to the element name; built-in dimension referenced only by choices is resolved.
    expect(walkReq.label).toBe('Pathway');
    expect(walkReq.where).toEqual(['Concrete walk', 'Driveway → door']);
    expect(walkReq.choices).toEqual([
      { dimension: 'Stone size', options: ['large 18-24 in flagstones'] },
      { dimension: 'Width', options: ['5 ft wide'] },
    ]);

    expect(req.ideas[0]).toContain('loose layered cottage planting');
    expect(req.ideas[1]).toContain('Bluestone walk');
    expect(req.ideas[1]).toContain('love the edging');
    // Element guidance grounds the plan (purpose + up to 3 rules of thumb).
    expect(req.sceneSummary).toContain('Lead guests clearly to the door.');
    expect(req.sceneSummary).not.toContain('Fourth rule');
    expect(req.compare).toBeNull();
    expect(req.refine).toBeNull();
  });

  it('compare runs drop the compared dimension from the choices and list the options', () => {
    const b = brief();
    const compare = resolveCompare(
      b,
      { elementId: 'el-walk', dimensionId: 'stone-size', optionIds: ['large', 'small', 'large', 'nope', 'gravel'] },
      knowledge,
    )!;
    expect(compare.options.map((o) => o.id)).toEqual(['large', 'small', 'gravel']);
    const req = buildPlanRequest({ ...base, brief: b, compare }, knowledge);
    expect(() => PlanRequestSchema.parse(req)).not.toThrow();
    expect(req.count).toBe(3);
    expect(req.compare?.elementLabel).toBe('Pathway');
    expect(req.compare?.dimensionLabel).toBe('Stone size');
    expect(req.compare?.options.map((o) => o.promptText)).toEqual(['large 18-24 in flagstones', 'small 4 in cobbles', '3/8 in pea gravel']);
    expect(req.brief.elements[1].choices).toEqual([{ dimension: 'Width', options: ['5 ft wide'] }]);
  });

  it('rates compared plant options too', () => {
    const b = brief();
    const compare = resolveCompare(b, { elementId: 'el-bed', dimensionId: 'plants', optionIds: ['lavender', 'ferns'] }, knowledge)!;
    const req = buildPlanRequest({ ...base, brief: b, compare }, knowledge);
    expect(req.brief.elements[0].choices).toEqual([]);
    expect(req.brief.elements[0].note).toContain('Ferns & hostas — good');
    expect(req.brief.elements[0].note).toContain('Lavender & roses — poor');
  });

  it('skips plant checks and climate indoors and handles a missing scene', () => {
    const req = buildPlanRequest(
      { ...base, scene: undefined, setting: 'interior', brief: brief(), refine: { title: 'V1', brief: 'Edit…', feedback: null } },
      knowledge,
    );
    expect(() => PlanRequestSchema.parse(req)).not.toThrow();
    expect(req.climate).toBeNull();
    expect(req.brief.elements[0].note).toBe('keep the oak');
    expect(req.brief.elements[0].where).toEqual([]);
    expect(req.sceneSummary).toContain('No scene map yet');
    expect(req.zones).toEqual([]);
    expect(req.refine).toEqual({ title: 'V1', brief: 'Edit…', feedback: null });
  });

  it('resolveCompare returns null when the element or dimension is gone', () => {
    expect(resolveCompare(brief(), { elementId: 'x', dimensionId: 'stone-size', optionIds: [] }, knowledge)).toBeNull();
    expect(resolveCompare(brief(), { elementId: 'el-walk', dimensionId: 'x', optionIds: [] }, knowledge)).toBeNull();
  });
});

describe('helpers', () => {
  it('ideasForBrief uses explicit picks, else active items for the space', () => {
    const board = [
      idea({ id: 'a', active: true, spaceIds: [] }),
      idea({ id: 'b', active: false, spaceIds: [] }),
      idea({ id: 'c', active: true, spaceIds: ['other'] }),
      idea({ id: 'd', active: true, spaceIds: ['s1'] }),
    ];
    expect(ideasForBrief(board, { ...emptyBrief(), ideaItemIds: ['b', 'zz'] }, 's1').map((i) => i.id)).toEqual(['b']);
    expect(ideasForBrief(board, emptyBrief(), 's1').map((i) => i.id)).toEqual(['a', 'd']);
  });

  it('climateText falls back to the hardiness zone', () => {
    expect(climateText({ hardinessZone: '6b' })).toMatch(/6b/);
    expect(climateText({})).toBeNull();
    expect(climateText({ climate: { hardinessZone: '8a', summary: 'Hot summers.', notes: ['clay soil'], source: 'ai', updatedAt: 0 } })).toMatch(
      /8a.*Hot summers.*clay soil/,
    );
  });

  it('pathDescription describes routes', () => {
    expect(pathDescription(scene.paths[0])).toBe('driveway → front door. 3 ft concrete');
  });

  it('swapOptionInBrief replaces the sibling wording', () => {
    expect(
      swapOptionInBrief(
        'Lay large 18-24 in flagstones to the door.',
        { promptText: 'large 18-24 in flagstones' },
        { promptText: 'small 4 in cobbles' },
        'Stone size',
      ),
    ).toBe('Lay small 4 in cobbles to the door.');
    expect(swapOptionInBrief('Lay a path.', undefined, { promptText: 'pea gravel' }, 'Stone size')).toBe(
      'Lay a path. For the stone size, use pea gravel instead.',
    );
  });
});
