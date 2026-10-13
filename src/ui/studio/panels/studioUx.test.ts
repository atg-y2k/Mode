import { describe, expect, it, vi } from 'vitest';
import type { ElementType, Generation, ProjectLocation, Recommendation, SceneMap, SceneZone, Variation } from '../../../../shared/types';
import { elementsForSetting, getElementDef } from '../../../assets/design';
import { GROWTH_STOPS, formatHeight, growthAt, growthExamples, growthIndex, heightAt } from './growth';
import {
  OPEN_HANDOFF_EVENT,
  branchCounts,
  buildRunTree,
  filterRunTree,
  firstPendingPlanned,
  flattenRunTree,
  handoffCounts,
  handoffText,
  hasFavorites,
  provenanceOf,
  requestOpenHandoff,
} from './historyTree';
import { deerOf, formatHours, isPlantingElement, siteHeader, spotZones } from './siteHeader';
import { inferElementType, isInBrief, shortLabel, suggestedEdits, zonesMentioned } from './suggestedEdits';
import {
  azimuthFromText,
  bearingOf,
  clockFor,
  convexHull,
  directionText,
  facingFromHeading,
  footprint,
  formatMinutes,
  growingSeason,
  houseBox,
  litFaces,
  litSummary,
  looksAtHouse,
  minutesOf,
  resolveFacing,
  shadowPolygon,
  sideAzimuth,
  snapDeg,
  studyDate,
  sunAt,
  sunZones,
  zoneSide,
  zoneSunEstimates,
} from './sunStudy';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function zone(id: string, kind: SceneZone['kind'], label: string, poly = rect(0, 0, 10, 10), extra: Partial<SceneZone> = {}): SceneZone {
  return { id, kind, label, description: '', polygon: poly, editable: true, ...extra };
}

function scene(zones: SceneZone[], extra: Partial<SceneMap> = {}): SceneMap {
  return {
    category: 'front-yard',
    summary: '',
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones,
    paths: [],
    keep: [],
    opportunities: [],
    createdAt: 1,
    model: 'test',
    ...extra,
  };
}

// ---------------------------------------------------------------------------

describe('suggested edits', () => {
  const offeredExt = new Set(elementsForSetting('exterior').map((d) => d.type));
  const offeredInt = new Set(elementsForSetting('interior').map((d) => d.type));
  const kinds = (t: ElementType) => getElementDef(t).zoneKinds;

  it('infers the element an opportunity is about', () => {
    expect(inferElementType('Widen the entry walk to 5 ft', 'exterior', offeredExt)).toBe('pathway');
    expect(inferElementType('Add a layered planting bed along the foundation', 'exterior', offeredExt)).toBe('planting-bed');
    // A noun used as a modifier yields to the noun after it.
    expect(inferElementType('Add path lighting along the walk', 'exterior', offeredExt)).toBe('outdoor-lighting');
    expect(inferElementType('Steel bed edging to crisp up the lawn line', 'exterior', offeredExt)).toBe('border-edging');
    expect(inferElementType('Replace the dented garage door', 'exterior', offeredExt)).toBe('garage-door');
    expect(inferElementType('Paint the front door a deep green', 'exterior', offeredExt)).toBe('exterior-paint');
    expect(inferElementType('Brighter pendant lighting over the island', 'interior', offeredInt)).toBe('interior-lighting');
    expect(inferElementType('Repaint the walls a warm white', 'interior', offeredInt)).toBe('wall-paint');
    expect(inferElementType('Make it feel more welcoming', 'exterior', offeredExt)).toBeNull();
    // Only elements offered for the setting.
    expect(inferElementType('Add a fireplace', 'exterior', offeredExt)).toBeNull();
  });

  it('finds the zones an opportunity mentions, preferring the element kinds', () => {
    const zones = [zone('w', 'walkway', 'Front walk'), zone('l', 'lawn', 'Lawn by the walk'), zone('b', 'planting-bed', 'Foundation bed'), zone('s', 'sky', 'Sky', undefined, { editable: false })];
    expect(zonesMentioned('Widen the entry walk to 5 ft', zones, kinds('pathway'))).toEqual(['w']);
    expect(zonesMentioned('Widen the entry walk to 5 ft', zones)).toEqual(['w', 'l']);
    expect(zonesMentioned('Deepen the foundation beds', zones, kinds('planting-bed'))).toEqual(['b']);
    expect(zonesMentioned('Plant along the walkway', zones, kinds('planting-bed'))).toEqual(['w', 'l']);
    expect(zonesMentioned('Something about the sky', zones)).toEqual([]);
    // The zone matching most words wins ("foundation bed" vs any bed).
    const beds = [zone('f', 'planting-bed', 'Foundation bed'), zone('s', 'planting-bed', 'Side bed by the fence')];
    expect(zonesMentioned('Deepen the foundation bed to 6 ft', beds, kinds('planting-bed'))).toEqual(['f']);
    expect(zonesMentioned('Mulch all the beds', beds, kinds('planting-bed'))).toEqual(['f', 's']);
  });

  it('shortens long suggestions for chips', () => {
    expect(shortLabel('Widen the entry walk to 5 ft so two people can walk side by side')).toBe('Widen the entry walk to 5 ft');
    expect(shortLabel('Add warm path lights.')).toBe('Add warm path lights');
    const long = shortLabel('Replace the overgrown yews under the windows with low evergreen shrubs that stay below the sills');
    expect(long.length).toBeLessThanOrEqual(44);
    expect(long.endsWith('…')).toBe(true);
  });

  it('lists AI recommendations first, then opportunities, skipping duplicates and edits already in the brief', () => {
    const sc = scene([zone('w', 'walkway', 'Front walk'), zone('b', 'planting-bed', 'Foundation bed')], {
      opportunities: ['Widen the entry walk to 5 ft', 'Add a layered foundation bed', 'Add warm lantern light at the door', 'Curved bluestone walk'],
    });
    const recs: Recommendation[] = [
      { id: 'r1', title: 'Curved bluestone walk', prompt: 'Replace the straight walk with a curved bluestone path.', why: 'Softer arrival.', category: 'hardscape', targetZoneIds: ['w', 'gone'], elementType: 'pathway' },
      { id: 'r2', title: 'Interior thing', prompt: 'Add a fireplace.', why: '', category: 'interior', targetZoneIds: [], elementType: 'fireplace' },
    ];
    const edits = suggestedEdits({
      scene: sc,
      recommendations: recs,
      brief: { prompt: 'Add a layered foundation bed.' },
      setting: 'exterior',
      offered: offeredExt,
      zoneKindsOf: kinds,
    });
    expect(edits.map((e) => e.label)).toEqual(['Curved bluestone walk', 'Interior thing', 'Widen the entry walk to 5 ft', 'Add warm lantern light at the door']);
    expect(edits[0].source).toBe('ai');
    // Deleted zones and elements not offered here are dropped.
    expect(edits[0].rec.targetZoneIds).toEqual(['w']);
    expect(edits[1].rec.elementType).toBeUndefined();
    const widen = edits[2];
    expect(widen.source).toBe('scene');
    expect(widen.rec).toMatchObject({ prompt: 'Widen the entry walk to 5 ft', elementType: 'pathway', targetZoneIds: ['w'], category: 'hardscape' });
    expect(edits[3].rec.elementType).toBe('outdoor-lighting');
  });

  it('knows what is already in the brief', () => {
    expect(isInBrief({ prompt: 'Keep the maple.\nWiden the entry walk to 5 ft.' }, 'widen the entry walk to 5 ft')).toBe(true);
    expect(isInBrief({ prompt: '' }, 'Anything')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('plant growth', () => {
  it('maps the three stops to plantMaturity', () => {
    expect(GROWTH_STOPS.map((s) => s.label)).toEqual(['As planted', '~3 years', 'Mature']);
    expect(growthIndex('new')).toBe(0);
    expect(growthIndex('established')).toBe(1);
    expect(growthIndex('mature')).toBe(2);
    expect(growthAt(0)).toBe('new');
    expect(growthAt(1.4)).toBe('established');
    expect(growthAt(9)).toBe('mature');
  });

  it('estimates heights by plant type', () => {
    const shrub = { type: 'shrub' as const, matureHeightFt: 4 };
    expect(heightAt(shrub, 'new')).toBeCloseTo(1.2);
    expect(heightAt(shrub, 'established')).toBeCloseTo(2.4);
    expect(heightAt(shrub, 'mature')).toBe(4);
    const perennial = { type: 'perennial' as const, matureHeightFt: 3 };
    expect(heightAt(perennial, 'new')).toBeCloseTo(1.05);
    expect(heightAt(perennial, 'established')).toBe(3);
    const tree = { type: 'tree' as const, matureHeightFt: 30 };
    expect(heightAt(tree, 'new')).toBe(8);
    expect(heightAt(tree, 'established')).toBe(12.5);
    expect(heightAt(tree, 'mature')).toBe(30);
    // Never above the mature size.
    expect(heightAt({ type: 'shrub', matureHeightFt: 0.5 }, 'new')).toBe(0.5);
  });

  it('formats heights', () => {
    expect(formatHeight(0.4)).toBe('4 in');
    expect(formatHeight(1)).toBe('1 ft');
    expect(formatHeight(2.4)).toBe('2½ ft');
    expect(formatHeight(12.5)).toBe('13 ft');
    expect(formatHeight(0)).toBe('—');
  });

  it('gives example sizes for the chosen plant options, tallest first', () => {
    const def = getElementDef('planting-bed');
    const el = { type: 'planting-bed' as const, choices: { palette: ['evergreen-structure'] } };
    const ex = growthExamples(el, def.dimensions);
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.length).toBeLessThanOrEqual(2);
    for (const e of ex) {
      expect(e.heights).toHaveLength(3);
      expect(e.heights[0]).toBeLessThanOrEqual(e.heights[1]);
      expect(e.heights[1]).toBeLessThanOrEqual(e.heights[2]);
      expect(e.name).not.toMatch(/'/);
    }
    expect(growthExamples({ type: 'planting-bed', choices: {} }, def.dimensions)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('site header', () => {
  const loc: ProjectLocation = { zip: '20817', hardinessZone: '7a', deerPressure: 'high' };

  it('reads "Zone 7a · Part sun (5 h) · Deer: high"', () => {
    const h = siteHeader(loc, [{ sun: 'part-sun', sunHours: 5.2 }, { sun: 'part-sun', sunHours: 4.8 }]);
    expect(h.text).toBe('Zone 7a · Part sun (5 h) · Deer: high');
    expect(h.gaps).toEqual([]);
    expect(h.hours).toBeCloseTo(5);
  });

  it('lists what is missing', () => {
    const h = siteHeader({}, []);
    expect(h.zone).toBeNull();
    expect(h.sun).toBeNull();
    expect(h.deer).toBeNull();
    expect(h.gaps).toEqual(['zip', 'sun', 'deer']);
    // Sun without hours; deer from the AI climate notes; zone from the climate profile.
    const h2 = siteHeader({ climate: { hardinessZone: '6b', summary: '', notes: [], source: 'ai', updatedAt: 1 } }, [{ sun: 'shade' }], { deerPressure: true });
    expect(h2.text).toBe('Zone 6b · Shade · Deer: medium');
  });

  it('formats hours', () => {
    expect(formatHours(5.24)).toBe('5 h');
    expect(formatHours(0.4)).toBe('<1 h');
    expect(formatHours(2.5)).toBe('2½ h');
    expect(formatHours(7.6)).toBe('8 h');
  });

  it('decides which elements get the header', () => {
    const bed = getElementDef('planting-bed');
    expect(isPlantingElement({ type: 'planting-bed', choices: {} }, bed.dimensions, 'exterior')).toBe(true);
    expect(isPlantingElement({ type: 'planting-bed', choices: {} }, bed.dimensions, 'interior')).toBe(false);
    const dims = [{ id: 'edge', options: [{ id: 'plants', label: 'Plants', description: '', promptText: '', feasibility: { rating: 'good' as const, reasons: [] } }, { id: 'steel', label: 'Steel', description: '', promptText: '' }] }];
    expect(isPlantingElement({ type: 'border-edging', choices: { edge: ['steel'] } }, dims, 'exterior')).toBe(false);
    expect(isPlantingElement({ type: 'border-edging', choices: { edge: ['plants'] } }, dims, 'exterior')).toBe(true);
  });

  it('uses the element zones, else the brief targets, for the spot', () => {
    const sc = scene([zone('a', 'planting-bed', 'A', undefined, { sun: 'shade' }), zone('b', 'lawn', 'B', undefined, { sun: 'full-sun' }), zone('c', 'lawn', 'C')]);
    expect(spotZones({ zoneIds: ['a', 'c'] }, sc, ['b']).map((z) => z.id)).toEqual(['a']);
    expect(spotZones({ zoneIds: ['c'] }, sc, ['b']).map((z) => z.id)).toEqual(['b']);
  });

  it('shows the Settings deer pressure in the header, else the context', () => {
    expect(deerOf({ deerPressure: 'high' }, { deerPressure: false })).toBe('high');
    expect(deerOf({}, { deerPressure: true })).toBe('medium');
    expect(deerOf({}, {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('sun study', () => {
  const LAT = 39;
  const LON = -77;

  it('reads directions from the AI orientation text', () => {
    expect(azimuthFromText('Front faces roughly south-east')).toBe(135);
    expect(azimuthFromText('South-facing facade')).toBe(180);
    expect(azimuthFromText('Morning sun from the east; the front faces north')).toBe(0);
    expect(azimuthFromText('The house faces SW')).toBe(225);
    expect(azimuthFromText('e.g. unknown')).toBeNull();
    expect(azimuthFromText(undefined)).toBeNull();
  });

  it('resolves the facing: user > photo heading > AI', () => {
    const house = [zone('f', 'facade', 'Facade')];
    const sc = scene(house, { orientation: 'Faces south', facadeAzimuthDeg: 170, facadeAzimuthSource: 'ai' });
    // The camera looked north (heading 0) at the facade → it faces south.
    expect(resolveFacing(sc, { headingDeg: 10 })).toEqual({ deg: 190, source: 'photo', atHouse: true });
    expect(resolveFacing(sc, undefined)).toEqual({ deg: 170, source: 'ai', atHouse: true });
    expect(resolveFacing({ ...sc, facadeAzimuthDeg: 95, facadeAzimuthSource: 'user' }, { headingDeg: 10 })).toEqual({ deg: 95, source: 'user', atHouse: true });
    expect(resolveFacing(scene(house, { orientation: 'Faces south-west' }), {})).toEqual({ deg: 225, source: 'ai', atHouse: true });
    expect(resolveFacing(scene(house), {})).toBeNull();
    // A yard photographed from the house extends the way the camera looks.
    expect(resolveFacing(scene([zone('l', 'lawn', 'Back lawn')]), { headingDeg: 200 })).toMatchObject({ deg: 200, atHouse: false });
    expect(facingFromHeading(350, true)).toBe(170);
    expect(looksAtHouse(scene([zone('l', 'lawn', 'Lawn')]))).toBe(false);
  });

  it('places zones in front of or beside the house', () => {
    const zones = [
      zone('f', 'facade', 'Facade', rect(300, 100, 900, 400)),
      zone('front', 'lawn', 'Front lawn', rect(200, 450, 1000, 700)),
      zone('left', 'planting-bed', 'Side bed', rect(0, 300, 280, 600)),
      zone('right', 'lawn', 'Side lawn', rect(910, 300, 1200, 600)),
    ];
    const box = houseBox(zones);
    expect(box).toEqual({ minX: 300, minY: 100, maxX: 900, maxY: 400 });
    expect(zoneSide(zones[1], box)).toBe('front');
    expect(zoneSide(zones[2], box)).toBe('left');
    expect(zoneSide(zones[3], box)).toBe('right');
    expect(zoneSide(zones[1], null)).toBe('front');
    // South-facing house: the photo's left is west.
    expect(sideAzimuth(180, 'left')).toBe(270);
    expect(sideAzimuth(180, 'right')).toBe(90);
    expect(sideAzimuth(180, 'front')).toBe(180);
  });

  it('estimates sun per ground zone', () => {
    const zones = [
      zone('f', 'facade', 'Facade', rect(300, 100, 900, 400)),
      zone('front', 'planting-bed', 'Foundation bed', rect(300, 400, 900, 500), { sun: 'shade' }),
      zone('left', 'planting-bed', 'Side bed', rect(0, 300, 280, 600)),
      zone('porch', 'porch', 'Porch', rect(500, 300, 700, 400)),
      zone('tree', 'tree', 'Maple', rect(0, 0, 100, 100)),
    ];
    expect(sunZones(zones).map((z) => z.id)).toEqual(['front', 'left']);
    const south = zoneSunEstimates(scene(zones), 180, LAT, LON, 6);
    expect(south).toHaveLength(2);
    expect(south[0]).toMatchObject({ side: 'front', azimuthDeg: 180, exposure: 'full-sun', changed: true });
    expect(south[0].hours).toBeGreaterThanOrEqual(6);
    expect(south[1].azimuthDeg).toBe(270);
    const north = zoneSunEstimates(scene(zones), 0, LAT, LON, 12);
    expect(north[0].hours).toBeLessThan(south[0].hours);
    expect(north[0].monthHours).toBeLessThan(0.5);
    // Unchanged once written.
    const written = zones.map((z) => (z.id === 'front' ? { ...z, sun: south[0].exposure, sunHours: south[0].hours } : z));
    expect(zoneSunEstimates(scene(written), 180, LAT, LON, 6)[0].changed).toBe(false);
    expect(growingSeason(-30)).toContain(12);
    expect(growingSeason(40)).toContain(6);
  });

  it('builds study dates in local or solar time', () => {
    expect(clockFor(-77, 240)).toBe('local'); // EDT (UTC−4) near 77°W
    expect(clockFor(-122, 240)).toBe('solar'); // planning a West Coast house from the East
    const solarNoon = studyDate(6, 12 * 60, -75, 'solar');
    expect(solarNoon.toISOString()).toBe('2025-06-15T17:00:00.000Z');
    const local = studyDate(3, 9 * 60 + 30, 0, 'local');
    expect([local.getMonth(), local.getDate(), local.getHours(), local.getMinutes()]).toEqual([2, 15, 9, 30]);
    expect(minutesOf(solarNoon, -75, 'solar')).toBe(720);
    expect(minutesOf(local, 0, 'local')).toBe(570);
    expect(formatMinutes(570)).toBe('9:30 AM');
    expect(formatMinutes(0)).toBe('12:00 AM');
    expect(formatMinutes(13 * 60 + 5)).toBe('1:05 PM');
  });

  it('knows which faces the sun lights', () => {
    const noonJune = sunAt(LAT, LON, studyDate(6, 12 * 60, LON, 'solar'));
    expect(noonJune.up).toBe(true);
    expect(noonJune.azimuthDeg).toBeGreaterThan(160);
    const faces = litFaces(noonJune, 180);
    expect(faces.front).toBe(true);
    expect(faces.back).toBe(false);
    expect(litSummary(faces, noonJune)).toMatch(/^Sun on the front/);
    const high = { altitudeDeg: 70, azimuthDeg: 180, up: true };
    const behind = litFaces(high, 0);
    expect(behind).toEqual({ front: false, back: true, left: false, right: false });
    expect(litSummary(behind, high)).toBe('Sun behind the house — the front is in shade');
    expect(litSummary({ front: false, back: true, left: false, right: true }, high)).toBe('Sun on the right side; the front is in shade');
    // Afternoon sun in the south-west on a south-facing house: front and the photo's left (west) side.
    const pm = { altitudeDeg: 40, azimuthDeg: 240, up: true };
    expect(litFaces(pm, 180)).toEqual({ front: true, back: false, left: true, right: false });
    expect(litSummary(litFaces(pm, 180), pm)).toBe('Sun on the front and the left side');
    const night = sunAt(LAT, LON, studyDate(6, 0, LON, 'solar'));
    expect(litSummary(litFaces(night, 180), night)).toBe('The sun is down');
  });

  it('draws the plan: footprint, shadow, bearings', () => {
    const fp = footprint(50, 50, 20, 10, 90);
    // Facing east: the front edge (first two corners) is on the right.
    expect(fp[0].x).toBeCloseTo(55);
    expect(fp[1].x).toBeCloseTo(55);
    expect(fp[2].x).toBeCloseTo(45);
    const hull = convexHull([...rect(0, 0, 10, 10), { x: 5, y: 5 }]);
    expect(hull).toHaveLength(4);
    const sun = { altitudeDeg: 45, azimuthDeg: 180, up: true };
    const sh = shadowPolygon(rect(40, 40, 60, 60), sun, 10, 100);
    // Sun in the south → shadow extends north (up, smaller y) by 10.
    expect(Math.min(...sh.map((p) => p.y))).toBeCloseTo(30);
    expect(shadowPolygon(rect(40, 40, 60, 60), { ...sun, up: false }, 10, 100)).toEqual([]);
    expect(bearingOf(50, 50, 60, 50)).toBeCloseTo(90);
    expect(bearingOf(50, 50, 50, 40)).toBeCloseTo(0);
    expect(snapDeg(358)).toBe(0);
    expect(snapDeg(356)).toBe(355);
    expect(snapDeg(133)).toBe(135);
    expect(directionText(135)).toBe('south-east (135°)');
    expect(directionText(0)).toBe('north (0°)');
  });
});

// ---------------------------------------------------------------------------

function variation(id: string, extra: Partial<Variation> = {}): Variation {
  return { id, imageId: `img_${id}`, thumbId: `th_${id}`, width: 10, height: 10, title: id, brief: '', favorite: false, createdAt: 1, ...extra };
}

function run(id: string, variations: Variation[], extra: Partial<Generation> = {}): Generation {
  return {
    id,
    createdAt: 1,
    brief: { prompt: '', elements: [], plantMaturity: 'established', ideaItemIds: [], targetZoneIds: [], scope: 'zones' },
    mode: 'variations',
    plan: '',
    provider: 'openai',
    model: '',
    variations,
    status: 'done',
    ...extra,
  };
}

describe('history tree', () => {
  // Newest first, like photo.generations.
  const gens = [
    run('g4', [variation('d1', { favorite: true })], { baseVariationId: 'c1' }),
    run('g3', [variation('c1')], { baseVariationId: 'a1' }),
    run('g2', [variation('b1')], { baseVariationId: 'deleted' }),
    run('g1', [variation('a1'), variation('a2')]),
  ];

  it('nests runs under the variation they started from', () => {
    const tree = buildRunTree(gens);
    expect(tree.map((n) => n.run.id)).toEqual(['g2', 'g1']);
    expect(tree[0].baseMissing).toBe(true);
    expect(tree[0].base).toBeNull();
    const g1 = tree[1];
    expect(g1.children.map((n) => n.run.id)).toEqual(['g3']);
    expect(g1.children[0].base?.variation.id).toBe('a1');
    expect(g1.children[0].children[0].run.id).toBe('g4');
    expect(flattenRunTree(tree).map((r) => `${r.node.run.id}:${r.depth}`)).toEqual(['g2:0', 'g1:0', 'g3:1', 'g4:2']);
    expect(branchCounts(gens).get('a1')).toBe(1);
  });

  it('survives a corrupt cycle', () => {
    const cyc = [run('x', [variation('x1')], { baseVariationId: 'y1' }), run('y', [variation('y1')], { baseVariationId: 'x1' })];
    const flat = flattenRunTree(buildRunTree(cyc));
    expect(flat.map((r) => r.node.run.id).sort()).toEqual(['x', 'y']);
  });

  it('filters to favorites, keeping the branch that leads to them', () => {
    const filtered = filterRunTree(buildRunTree(gens), hasFavorites);
    const flat = flattenRunTree(filtered);
    expect(flat.map((r) => r.node.run.id)).toEqual(['g1', 'g3', 'g4']);
    expect(flat.map((r) => !!r.node.context)).toEqual([true, true, false]);
  });

  it('reads provenance and flags alignment problems', () => {
    expect(provenanceOf(undefined)).toEqual({ label: null, short: null, kind: null, warn: false });
    expect(provenanceOf({ kind: 'api' }).label).toBe('API');
    const ok = { inliers: 300, residualPx: 1, driftBefore: 4, driftAfter: 1, outsideChanged: 0.02, aligned: true };
    expect(provenanceOf({ kind: 'handoff', app: 'gemini', alignment: ok })).toMatchObject({ label: 'Gemini', warn: false });
    expect(provenanceOf({ kind: 'handoff', app: 'chatgpt', alignment: { ...ok, aligned: false } })).toMatchObject({ label: 'ChatGPT', short: 'GPT', warn: true });
    expect(provenanceOf({ kind: 'handoff', alignment: { ...ok, outsideChanged: 0.3 } }).warning).toMatch(/30%/);
    expect(provenanceOf({ kind: 'handoff', alignment: { ...ok, outsideChanged: 0.15 } }).warn).toBe(false);
  });

  it('counts pending hand-offs and opens the companion by event', () => {
    const g = run('h', [], {
      status: 'awaiting',
      planned: [
        { id: 'p1', title: '', brief: '', status: 'awaiting-handoff' },
        { id: 'p2', title: '', brief: '', status: 'awaiting-handoff' },
        { id: 'p3', title: '', brief: '', status: 'staged' },
        { id: 'p4', title: '', brief: '', status: 'done' },
      ],
    });
    const c = handoffCounts(g);
    expect(c).toEqual({ waiting: 2, staged: 1 });
    expect(handoffText(c)).toBe('Waiting for hand-off · 2 · 1 back to review');
    expect(handoffText({ waiting: 0, staged: 1 })).toBe('1 back to review');
    expect(handoffText({ waiting: 0, staged: 0 })).toBe('');
    const seen = vi.fn();
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    target.addEventListener(OPEN_HANDOFF_EVENT, (e) => seen((e as CustomEvent).detail));
    expect(requestOpenHandoff('h')).toBe(false);
    target.addEventListener(OPEN_HANDOFF_EVENT, (e) => e.preventDefault());
    expect(requestOpenHandoff('h')).toBe(true);
    vi.unstubAllGlobals();
    expect(seen).toHaveBeenCalledWith({ generationId: 'h' });
    expect(firstPendingPlanned(g)).toBe('p1');
    expect(firstPendingPlanned({ planned: [{ id: 'x', title: '', brief: '', status: 'staged' }] })).toBe('x');
    expect(firstPendingPlanned({})).toBeNull();
  });
});
