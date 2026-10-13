import { describe, expect, it } from 'vitest';
import { emptyBrief, type DesignBrief, type SceneMap, type ScenePath, type SceneZone } from '../../../shared/types';
import { createMask } from '../../engine/mask';
import { newElementSpec } from '../../assets/design';
import {
  blendRadii,
  briefTargetIds,
  footprintRoom,
  growChoice,
  maskForBrief,
  maskForRunTarget,
  maskFromTargets,
  pathHalfWidthAt,
  rasterizePath,
  runTargetLost,
  sceneForRun,
  snapshotRunTarget,
  targetFingerprint,
} from './maskFromZones';

const W = 200;
const H = 160;

const square = (id: string, x: number, y: number, s: number, extra: Partial<SceneZone> = {}): SceneZone => ({
  id,
  kind: 'planting-bed',
  label: id,
  description: '',
  polygon: [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ],
  editable: true,
  ...extra,
});

const path = (id: string, points: { x: number; y: number }[], widthPx: number): ScenePath => ({
  id,
  label: id,
  from: '',
  to: '',
  description: '',
  points,
  widthPx,
  kind: 'sketch',
});

function scene(zones: SceneZone[], paths: ScenePath[] = []): SceneMap {
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
    paths,
    keep: [],
    opportunities: [],
    createdAt: 0,
    model: 'test',
  };
}

const at = (m: { width: number; data: Uint8Array }, x: number, y: number) => m.data[y * m.width + x];

describe('briefTargetIds', () => {
  it('unions brief targets with element zones/paths and drops unknown ids', () => {
    const sc = scene(
      [square('a', 0, 0, 10), square('b', 20, 0, 10)],
      [
        path(
          'p',
          [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
          4,
        ),
      ],
    );
    const brief: DesignBrief = {
      ...emptyBrief(),
      targetZoneIds: ['a', 'gone'],
      elements: [{ id: 'e', type: 'pathway', label: 'Walk', zoneIds: ['b', 'a'], pathIds: ['p', 'nope'], dimensions: [], choices: {}, note: '' }],
    };
    expect(briefTargetIds(brief, sc)).toEqual({ zoneIds: ['a', 'b'], pathIds: ['p'] });
    expect(briefTargetIds(brief, undefined)).toEqual({ zoneIds: [], pathIds: [] });
  });
});

describe('maskFromTargets', () => {
  it('covers zone polygons, grows and feathers the edge', () => {
    const m = maskFromTargets(W, H, [square('a', 50, 40, 60)], [], { grow: 4, feather: 4 });
    expect(m).not.toBeNull();
    const mask = m!;
    expect(at(mask, 80, 70)).toBe(255); // center
    expect(at(mask, 5, 5)).toBe(0); // far away untouched
    expect(at(mask, 47, 70)).toBeGreaterThan(0); // grown past the outline
    // Feathered: some partial coverage exists along the boundary.
    let partial = 0;
    for (let x = 30; x < 60; x++) {
      const v = at(mask, x, 70);
      if (v > 0 && v < 255) partial++;
    }
    expect(partial).toBeGreaterThan(1);
  });

  it('returns null when nothing is targeted', () => {
    expect(maskFromTargets(W, H, [], [])).toBeNull();
    expect(maskFromTargets(W, H, [{ ...square('a', 0, 0, 10), polygon: [] }], [])).toBeNull();
  });

  it('prefers a refined zone mask over the polygon', () => {
    const refined = createMask(W, H);
    for (let y = 100; y < 120; y++) for (let x = 150; x < 170; x++) refined.data[y * W + x] = 255;
    const m = maskFromTargets(W, H, [square('a', 0, 0, 40, { maskId: 'r' })], [], { getMask: () => refined, grow: 0, feather: 0 })!;
    expect(at(m, 160, 110)).toBe(255);
    expect(at(m, 20, 20)).toBe(0);
    // Mask of the wrong size or not loaded → polygon.
    const fallback = maskFromTargets(W, H, [square('a', 0, 0, 40, { maskId: 'r' })], [], { getMask: () => undefined, grow: 0, feather: 0 })!;
    expect(at(fallback, 20, 20)).toBe(255);
  });

  it('buffers paths, wider at the near (lower) end', () => {
    const p = path(
      'walk',
      [
        { x: 100, y: 150 },
        { x: 100, y: 60 },
      ],
      30,
    );
    expect(pathHalfWidthAt(p, 150, H)).toBeCloseTo(15);
    expect(pathHalfWidthAt(p, 60, H)).toBeLessThan(15);
    const m = createMask(W, H);
    rasterizePath(m, p, H);
    expect(at(m, 100, 150)).toBe(255);
    expect(at(m, 112, 148)).toBe(255); // within near half-width
    expect(at(m, 112, 62)).toBe(0); // the far end is narrower
    expect(at(m, 100, 62)).toBe(255);
  });

  it('blend radii scale with the photo', () => {
    expect(blendRadii(1600, 1200)).toEqual({ grow: 10, feather: 13 });
    expect(blendRadii(100, 80).grow).toBeGreaterThanOrEqual(2);
  });
});

describe('maskForBrief', () => {
  const sc = scene([square('a', 50, 40, 60)]);
  it('is null for whole-image scope or no targets', () => {
    expect(maskForBrief({ width: W, height: H }, sc, { ...emptyBrief(), targetZoneIds: ['a'], scope: 'whole' })).toBeNull();
    expect(maskForBrief({ width: W, height: H }, sc, emptyBrief())).toBeNull();
    expect(maskForBrief({ width: W, height: H }, undefined, { ...emptyBrief(), targetZoneIds: ['a'] })).toBeNull();
  });
  it('covers the targeted zone', () => {
    const m = maskForBrief({ width: W, height: H }, sc, { ...emptyBrief(), targetZoneIds: ['a'] })!;
    expect(m.width).toBe(W);
    expect(at(m, 80, 70)).toBe(255);
  });
});

describe('pathBandOutline', () => {
  it('outlines a band that tapers toward the far end', async () => {
    const { pathBandOutline } = await import('./maskFromZones');
    const outline = pathBandOutline(
      {
        points: [
          { x: 100, y: 150 },
          { x: 100, y: 60 },
        ],
        widthPx: 30,
      },
      H,
    );
    expect(outline.length).toBeGreaterThan(4);
    const near = outline.filter((p) => Math.abs(p.y - 150) < 0.01).map((p) => p.x);
    const far = outline.filter((p) => Math.abs(p.y - 60) < 0.01).map((p) => p.x);
    expect(Math.max(...near) - Math.min(...near)).toBeCloseTo(30);
    expect(Math.max(...far) - Math.min(...far)).toBeLessThan(30);
    expect(pathBandOutline({ points: [{ x: 1, y: 1 }], widthPx: 10 }, H)).toEqual([]);
  });
});

describe('run targets (frozen when a run starts)', () => {
  const bed = square('bed', 20, 20, 40);
  const brief: DesignBrief = { ...emptyBrief(), targetZoneIds: ['bed'] };

  it('keep the run’s area when the scene is re-mapped, cleared or the zone deleted', () => {
    const sc = scene([bed, square('lawn', 100, 100, 40, { kind: 'lawn' })]);
    const target = snapshotRunTarget(brief, sc, { width: W, height: H })!;
    expect(target.zones.map((z) => z.id)).toEqual(['bed']);
    const before = maskForBrief({ width: W, height: H }, sc, brief)!;
    const frozen = maskForRunTarget({ width: W, height: H }, target)!;
    expect(Array.from(frozen.data)).toEqual(Array.from(before.data));
    // Re-map with fresh ids: the live brief resolves nothing any more…
    const remapped = scene([{ ...bed, id: 'bed-new' }]);
    expect(maskForBrief({ width: W, height: H }, remapped, brief)).toBeNull();
    // …the run keeps its own area.
    expect(Array.from(maskForRunTarget({ width: W, height: H }, target)!.data)).toEqual(Array.from(before.data));
  });

  it('runs from older saves whose areas are gone are "lost" (never a whole-image edit)', () => {
    const sc = scene([bed]);
    expect(runTargetLost({ brief }, sc)).toBe(false);
    expect(runTargetLost({ brief }, scene([{ ...bed, id: 'bed-new' }]))).toBe(true);
    expect(runTargetLost({ brief }, undefined)).toBe(true);
    // Not lost: a frozen snapshot, a whole-image brief, or a brief that never named areas.
    expect(runTargetLost({ brief, target: { zones: [], paths: [] } }, undefined)).toBe(false);
    expect(runTargetLost({ brief: { ...brief, scope: 'whole' } }, undefined)).toBe(false);
    expect(runTargetLost({ brief: emptyBrief() }, undefined)).toBe(false);
  });

  it('the prompt scene puts the frozen zones back under their own ids and drops their re-mapped twins', () => {
    const target = snapshotRunTarget(brief, scene([bed]))!;
    const live = scene([{ ...bed, id: 'bed-new' }, square('lawn', 100, 100, 40, { kind: 'lawn', label: 'Lawn' })]);
    const s = sceneForRun(live, { target })!;
    expect(s.zones.map((z) => z.id).sort()).toEqual(['bed', 'lawn']);
    expect(briefTargetIds(brief, s).zoneIds).toEqual(['bed']);
  });

  it('fingerprints change with the outline', () => {
    const a = targetFingerprint(brief, scene([bed]));
    expect(targetFingerprint(brief, scene([bed]))).toBe(a);
    expect(targetFingerprint(brief, scene([square('bed', 22, 20, 40)]))).not.toBe(a);
    expect(targetFingerprint(brief, scene([{ ...bed, maskId: 'msk' }]))).not.toBe(a);
  });
});

describe('footprint room (a wider or curvier path needs ground beside the old one)', () => {
  const PW = 400;
  const PH = 300;
  const size = { width: PW, height: PH };
  const rect = (id: string, kind: SceneZone['kind'], x0: number, y0: number, x1: number, y1: number): SceneZone => ({
    id,
    kind,
    label: id,
    description: '',
    polygon: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    editable: true,
  });
  const walkScene = (): SceneMap => ({
    ...scene([
      rect('house', 'facade', 0, 0, PW, 120),
      rect('steps', 'steps', 180, 120, 220, 150),
      rect('walk', 'walkway', 185, 150, 215, PH),
      rect('lawn', 'lawn', 0, 150, PW, PH),
    ]),
  });
  const pathway = (choices?: Record<string, string[]>) => {
    const el = newElementSpec('pathway', walkScene());
    return { ...el, choices: { ...el.choices, ...choices } };
  };

  it('the default Pathway (gentle curve, 5 ft) may change the lawn about one walk width to each side — never the house or steps', () => {
    const el = pathway();
    expect(el.zoneIds).toEqual(['walk']);
    expect(growChoice(el)).toBe(true);
    const brief: DesignBrief = { ...emptyBrief(), elements: [el] };
    const m = maskForBrief(size, walkScene(), brief)!;
    expect(at(m, 200, 250)).toBe(255); // the walk
    // Lawn about one walk width (30 px) to each side.
    expect(at(m, 185 - 22, 250)).toBe(255);
    expect(at(m, 215 + 22, 250)).toBeGreaterThan(200);
    expect(at(m, 185 - 45, 250)).toBe(0);
    expect(at(m, 120, 250)).toBe(0); // far lawn stays
    expect(at(m, 60, 60)).toBe(0); // the house
    expect(at(m, 200, 128)).toBe(0); // the steps
    const room = footprintRoom(walkScene(), brief, size)!;
    expect(room.empty).toBe(false);
    expect(room.room?.zones.map((z) => z.id)).toEqual(['lawn']);
  });

  it('straight + keep-width: unchanged from the walk outline alone', () => {
    const brief: DesignBrief = { ...emptyBrief(), elements: [pathway({ shape: ['straight'], width: ['keep-width'] })] };
    expect(growChoice(brief.elements[0])).toBe(false);
    const plain = maskFromTargets(PW, PH, [walkScene().zones[2]], [])!;
    expect(Array.from(maskForBrief(size, walkScene(), brief)!.data)).toEqual(Array.from(plain.data));
    expect(footprintRoom(walkScene(), brief, size)).toBeNull();
  });

  it('flags a grown choice with no ground beside it (the UI warns it will be clipped)', () => {
    const noLawn = { ...walkScene(), zones: walkScene().zones.filter((z) => z.id !== 'lawn') };
    const brief: DesignBrief = { ...emptyBrief(), elements: [{ ...pathway(), zoneIds: ['walk'] }] };
    expect(footprintRoom(noLawn, brief, size)).toMatchObject({ empty: true, room: null });
  });

  it('is frozen with the run (a re-mapped lawn does not change it)', () => {
    const brief: DesignBrief = { ...emptyBrief(), elements: [pathway()] };
    const target = snapshotRunTarget(brief, walkScene(), size)!;
    expect(target.room?.zones.map((z) => z.id)).toEqual(['lawn']);
    const frozen = maskForRunTarget(size, target)!;
    expect(Array.from(frozen.data)).toEqual(Array.from(maskForBrief(size, walkScene(), brief)!.data));
  });
});
