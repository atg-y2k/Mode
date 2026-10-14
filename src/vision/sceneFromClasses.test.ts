import { describe, expect, it } from 'vitest';
import type { Pt } from '../../shared/types';
import { ADE } from './ade20k';
import { pointInPolygon } from './prompts';
import { taskModels, taskUsesSegformer } from './models';
import {
  buildOfflineScene,
  CLIP_ONLY_CLASSES,
  CLIP_PROMPTS,
  classMapFromClip,
  componentLabels,
  kindGrid,
  offlineCategory,
  offlineMissing,
  offlineSceneCategory,
  offlineSummary,
  UNLABELED,
  zonesFromClasses,
  type ClipMaps,
} from './sceneFromClasses';
import type { ClassMap } from './scoring';

/**
 * A synthetic 200×150 front-of-house class map:
 * sky on top, a house block with a roof band, two windows and a door,
 * lawn on both sides of a path at the bottom, and a small neighbour house.
 */
function houseScene(): ClassMap {
  const W = 200;
  const H = 150;
  const labels = new Uint8Array(W * H);
  const paint = (x0: number, y0: number, x1: number, y1: number, c: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) labels[y * W + x] = c;
  };
  paint(0, 0, W, H, ADE.sky);
  paint(40, 30, 160, 95, ADE.house); // roof band 30..50, walls 50..95
  paint(55, 60, 75, 80, ADE.windowpane);
  paint(125, 60, 145, 80, ADE.windowpane);
  paint(92, 62, 108, 95, ADE.door);
  paint(0, 95, W, H, ADE.grass);
  paint(92, 95, 108, H, ADE.path);
  paint(2, 70, 22, 95, ADE.building); // neighbour, far left
  paint(162, 88, 199, 98, ADE.wall); // low garden wall, right
  paint(145, 22, 151, 30, ADE.building); // chimney sliver above the roof band
  return { width: W, height: H, labels };
}

const centroid = (poly: Pt[]) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });

describe('zonesFromClasses', () => {
  const photo = { width: 1600, height: 1200 }; // 8× the class map

  it('finds the main parts of a front-of-house photo with photo-px outlines', () => {
    const zones = zonesFromClasses(houseScene(), photo, false);
    const kinds = zones.map((z) => z.kind);
    expect(kinds).toContain('sky');
    expect(kinds).toContain('facade');
    expect(kinds).toContain('front-door');
    expect(kinds).toContain('walkway');
    expect(kinds).toContain('neighbor');
    expect(kinds.filter((k) => k === 'windows')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'lawn')).toHaveLength(2);
    expect(kinds).toContain('retaining-wall');
    // The chimney sliver is not a second facade.
    expect(kinds.filter((k) => k === 'facade')).toHaveLength(1);

    const sky = zones.find((z) => z.kind === 'sky')!;
    expect(sky.editable).toBe(false);
    expect(zones.find((z) => z.kind === 'facade')!.editable).toBe(true);

    // Lawns and windows get position labels.
    const lawnLabels = zones.filter((z) => z.kind === 'lawn').map((z) => z.label);
    expect(lawnLabels.sort()).toEqual(['Lawn — left', 'Lawn — right']);
    expect(zones.filter((z) => z.kind === 'windows').map((z) => z.label).sort()).toEqual(['Windows — left', 'Windows — right']);

    // Outlines are scaled to the photo and sit where the classes are.
    const door = zones.find((z) => z.kind === 'front-door')!;
    const c = centroid(door.polygon);
    expect(c.x).toBeGreaterThan(92 * 8);
    expect(c.x).toBeLessThan(108 * 8);
    for (const p of door.polygon) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(photo.width);
    }
    expect(pointInPolygon({ x: 100 * 8, y: 120 * 8 }, zones.find((z) => z.kind === 'walkway')!.polygon)).toBe(true);
    expect(door.description).toMatch(/Found on this device/);
  });

  it('uses CLIPSeg probabilities for roofs and driveways', () => {
    const classes = houseScene();
    const n = classes.width * classes.height;
    const roof = new Float32Array(n);
    for (let y = 30; y < 50; y++) for (let x = 40; x < 160; x++) roof[y * classes.width + x] = 0.9;
    // Spill onto the sky must not become roof.
    for (let y = 20; y < 30; y++) for (let x = 60; x < 140; x++) roof[y * classes.width + x] = 0.9;
    const clip: ClipMaps = { width: classes.width, height: classes.height, probs: { roof } };
    const zones = zonesFromClasses(classes, photo, false, clip);
    const r = zones.find((z) => z.kind === 'roof');
    expect(r).toBeDefined();
    const ys = r!.polygon.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(29 * 8);
    expect(Math.max(...ys)).toBeLessThanOrEqual(51 * 8);
  });

  it('calls a narrow strip under a high "driveway" probability a walkway, a wide one a driveway', () => {
    const classes = houseScene();
    const W = classes.width;
    const n = W * classes.height;
    const paint = (x0: number, y0: number, x1: number, y1: number, c: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) classes.labels[y * W + x] = c;
    };
    // A real drive on the right (70 px of 200 = 35%), and the 16 px walk to the door; CLIPSeg says "driveway" for both.
    paint(130, 100, 200, 150, ADE.road);
    const driveway = new Float32Array(n);
    for (let y = 95; y < 150; y++) for (let x = 92; x < 108; x++) driveway[y * W + x] = 0.9;
    for (let y = 100; y < 150; y++) for (let x = 130; x < 200; x++) driveway[y * W + x] = 0.9;
    const zones = zonesFromClasses(classes, photo, false, { width: W, height: classes.height, probs: { driveway } });
    const walk = zones.find((z) => z.kind === 'walkway');
    expect(walk).toBeDefined();
    expect(walk!.label).toBe('Walkway');
    expect(pointInPolygon({ x: 100 * 8, y: 120 * 8 }, walk!.polygon)).toBe(true);
    const drives = zones.filter((z) => z.kind === 'driveway');
    expect(drives).toHaveLength(1);
    expect(pointInPolygon({ x: 165 * 8, y: 125 * 8 }, drives[0].polygon)).toBe(true);
  });

  it('calls a wider drive-like strip that leads to the front door a walkway (not when it leads to a garage door)', () => {
    /** A 30 px (15%) strip under "driveway", starting at y0 (the door ends at y 95). */
    const strip = (y0: number, garage = false) => {
      const classes = houseScene();
      const W = classes.width;
      const paint = (x0: number, ya: number, x1: number, yb: number, c: number) => {
        for (let y = ya; y < yb; y++) for (let x = x0; x < x1; x++) classes.labels[y * W + x] = c;
      };
      if (garage) {
        paint(92, 62, 108, 95, ADE.house);
        paint(80, 72, 130, 95, ADE.door); // wider than tall: a garage door
      }
      paint(85, y0, 115, 150, ADE.sidewalk);
      const driveway = new Float32Array(W * classes.height);
      for (let y = y0; y < 150; y++) for (let x = 85; x < 115; x++) driveway[y * W + x] = 0.9;
      return zonesFromClasses(classes, photo, false, { width: W, height: classes.height, probs: { driveway } }).map((z) => z.kind);
    };
    expect(strip(95)).toContain('walkway');
    expect(strip(95)).not.toContain('driveway');
    // Off on its own (not reaching the door) it stays a drive.
    expect(strip(115)).toContain('driveway');
    expect(strip(95, true)).toContain('garage-door');
    expect(strip(95, true)).toContain('driveway');
  });

  describe('a "paved patio" (CLIPSeg) that is really the front walk', () => {
    /**
     * Steps below the door (y 95–101), then a paved part under "a paved
     * patio" from `y0` down to `y1`, `top` px wide at its far end and
     * `bottom` px at its near end (perspective), centred on the door.
     */
    const paved = ({ top, bottom, y1 = 150, y0 = 101, garage = false }: { top: number; bottom: number; y1?: number; y0?: number; garage?: boolean }) => {
      const classes = houseScene();
      const W = classes.width;
      const paint = (x0: number, ya: number, x1: number, yb: number, c: number) => {
        for (let y = ya; y < yb; y++) for (let x = x0; x < x1; x++) classes.labels[y * W + x] = c;
      };
      paint(92, 95, 108, 150, ADE.grass); // no other walk
      paint(88, 95, 112, 101, ADE.stairs);
      if (garage) paint(60, 101, 86, 115, ADE.door); // wider than tall, beside the paving: a garage door
      const patio = new Float32Array(W * classes.height);
      for (let y = y0; y < y1; y++) {
        const half = Math.round((top + ((bottom - top) * (y - y0)) / Math.max(1, y1 - 1 - y0)) / 2);
        for (let x = 100 - half; x < 100 + half; x++) {
          classes.labels[y * W + x] = ADE.path;
          patio[y * W + x] = 0.9;
        }
      }
      return zonesFromClasses(classes, photo, false, { width: W, height: classes.height, probs: { patio } });
    };

    it('a wide flagstone walk from the steps toward the street becomes the walkway', () => {
      // 28 → 44 px (14–22% of the frame), 49 rows: a strip receding to the steps.
      const zones = paved({ top: 28, bottom: 44 });
      expect(zones.map((z) => z.kind)).toContain('steps');
      const walk = zones.find((z) => z.kind === 'walkway');
      expect(walk?.label).toBe('Walkway');
      expect(pointInPolygon({ x: 100 * 8, y: 130 * 8 }, walk!.polygon)).toBe(true);
      expect(zones.map((z) => z.kind)).not.toContain('patio');
    });

    it('keeps a real patio: shallow, wide, off on its own or at a garage door', () => {
      // At the steps but wide and shallow (44 px across, 18 rows deep).
      expect(paved({ top: 44, bottom: 44, y1: 119 }).map((z) => z.kind)).toEqual(expect.arrayContaining(['patio', 'steps']));
      expect(paved({ top: 44, bottom: 44, y1: 119 }).map((z) => z.kind)).not.toContain('walkway');
      // At the steps but over a quarter of the frame wide.
      expect(paved({ top: 56, bottom: 64 }).map((z) => z.kind)).not.toContain('walkway');
      // Strip-shaped, but not reaching the steps or door.
      expect(paved({ top: 28, bottom: 44, y0: 112 }).map((z) => z.kind)).toContain('patio');
      expect(paved({ top: 28, bottom: 44, y0: 112 }).map((z) => z.kind)).not.toContain('walkway');
      // Touching a garage door too.
      const garage = paved({ top: 28, bottom: 44, garage: true }).map((z) => z.kind);
      expect(garage).toContain('garage-door');
      expect(garage).toContain('patio');
    });
  });

  it('maps interiors and ignores CLIPSeg there', () => {
    const W = 120;
    const H = 90;
    const labels = new Uint8Array(W * H).fill(ADE.wall);
    for (let y = 0; y < 15; y++) labels.fill(ADE.ceiling, y * W, y * W + W);
    for (let y = 65; y < H; y++) labels.fill(ADE.floor, y * W, y * W + W);
    for (let y = 40; y < 65; y++) labels.fill(ADE.cabinet, y * W + 10, y * W + 70);
    for (let y = 38; y < 40; y++) labels.fill(ADE.countertop, y * W + 10, y * W + 70);
    const classes = { width: W, height: H, labels };
    const zones = zonesFromClasses(classes, { width: 1200, height: 900 }, true);
    const kinds = new Set(zones.map((z) => z.kind));
    for (const k of ['wall', 'ceiling', 'floor', 'cabinetry', 'countertop'] as const) expect(kinds.has(k)).toBe(true);
    expect(offlineCategory(classes, true)).toBe('kitchen');
  });

  it('returns nothing for an empty class map', () => {
    expect(zonesFromClasses({ width: 0, height: 0, labels: new Uint8Array(0) }, photo, false)).toEqual([]);
  });
});

describe('componentLabels', () => {
  it('keeps the plain name for a dominant component and sides for the rest', () => {
    expect(componentLabels('Facade', [{ area: 1000, cx: 100 }, { area: 50, cx: 180 }], 200)).toEqual(['Facade', 'Facade — right']);
    expect(componentLabels('Lawn', [{ area: 500, cx: 30 }, { area: 400, cx: 170 }], 200)).toEqual(['Lawn — left', 'Lawn — right']);
    expect(componentLabels('Windows', [{ area: 10, cx: 10 }, { area: 10, cx: 20 }, { area: 10, cx: 190 }], 200)).toEqual([
      'Windows — left',
      'Windows — left 2',
      'Windows — right',
    ]);
    expect(componentLabels('Sky', [{ area: 10, cx: 10 }], 200)).toEqual(['Sky']);
  });
});

describe('kindGrid', () => {
  it('only lets CLIPSeg override compatible classes', () => {
    const classes: ClassMap = { width: 2, height: 1, labels: new Uint8Array([ADE.road, ADE.sky]) };
    const drive = new Float32Array([0.8, 0.8]);
    const { grid, kinds } = kindGrid(classes, false, { width: 2, height: 1, probs: { driveway: drive } });
    expect(kinds[grid[0] - 1]).toBe('driveway');
    expect(kinds[grid[1] - 1]).toBe('sky');
  });
});

describe('offlineSceneCategory', () => {
  it("keeps the user's space type; the class-mix guess only fills in a generic one", () => {
    expect(offlineSceneCategory('garden', 'front-exterior')).toBe('front-exterior');
    expect(offlineSceneCategory('garden', 'backyard')).toBe('backyard');
    expect(offlineSceneCategory('driveway', 'front-yard')).toBe('front-yard');
    expect(offlineSceneCategory('garden', 'other-exterior')).toBe('garden');
    expect(offlineSceneCategory('other-exterior', 'other-exterior')).toBe('other-exterior');
    expect(offlineSceneCategory('kitchen', 'other-interior')).toBe('kitchen');
    expect(offlineSceneCategory('kitchen', 'bathroom')).toBe('bathroom');
    // Never across inside / outside.
    expect(offlineSceneCategory('kitchen', 'other-exterior')).toBe('other-exterior');
  });

  it('a front-of-house class mix keeps "Front of house" even when it reads as a garden', () => {
    const W = 100;
    const H = 100;
    const labels = new Uint8Array(W * H).fill(ADE.grass);
    for (let i = 0; i < W * 30; i++) labels[i] = ADE.sky;
    for (let i = W * 30; i < W * 45; i++) labels[i] = ADE.house; // 15% house: below the front-of-house share
    const classes = { width: W, height: H, labels };
    expect(offlineCategory(classes, false)).toBe('front-yard');
    const scene = buildOfflineScene([], offlineSceneCategory(offlineCategory(classes, false), 'front-exterior'), true, 1, false);
    expect(scene.category).toBe('front-exterior');
  });
});

describe('buildOfflineScene', () => {
  it('wraps zones in a SceneMap with ids, summary and model', () => {
    const zones = zonesFromClasses(houseScene(), { width: 1600, height: 1200 }, false);
    const scene = buildOfflineScene(zones, 'front-exterior', true, 123);
    expect(scene.zones).toHaveLength(zones.length);
    expect(new Set(scene.zones.map((z) => z.id)).size).toBe(zones.length);
    expect(scene.zones.every((z) => z.source === 'ai' && z.id.startsWith('zone_'))).toBe(true);
    expect(scene.model).toMatch(/SegFormer-B2 \+ CLIPSeg/);
    expect(scene.createdAt).toBe(123);
    expect(scene.paths).toEqual([]);
    expect(scene.summary).toMatch(/without AI/);
    expect(offlineSummary([])).toMatch(/no clear areas/);
  });
});

describe('offlineSummary: what the free map did not find', () => {
  const zones = (...kinds: string[]) => kinds.map((kind) => ({ kind, editable: kind !== 'sky' }) as Parameters<typeof offlineSummary>[0][number]);

  it('a plain house front (lawn, facade, roof, walk, steps) names the four usual areas it missed and how to add them', () => {
    const found = zones('lawn', 'facade', 'roof', 'walkway', 'steps');
    expect(offlineMissing(found, 'front-exterior')).toEqual(['front door', 'porch', 'windows', 'planting beds']);
    expect(offlineSummary(found, 'front-exterior')).toBe(
      'Mapped on this device without AI: lawn, facade, roof, walkway, steps. Not found: front door, porch, windows, planting beds — use Tap to select to add them. No style or architecture notes — those need Claude.',
    );
    // No walk or drive either: the driveway is missing too.
    expect(offlineMissing(zones('lawn', 'facade'), 'front-yard')).toEqual(['front door', 'porch', 'windows', 'planting beds', 'driveway']);
  });

  it('says nothing missing when the usual areas are there', () => {
    const found = zones('front-door', 'porch', 'windows', 'planting-bed', 'driveway', 'lawn');
    expect(offlineSummary(found, 'front-exterior')).not.toMatch(/Not found/);
  });

  it('only expects what the kind of photo has', () => {
    expect(offlineMissing(zones('lawn', 'tree'), 'backyard')).toEqual(['planting beds']);
    expect(offlineMissing(zones('lawn', 'patio'), 'patio')).toEqual([]);
    expect(offlineMissing(zones('wall', 'floor'), 'living-room')).toEqual(['ceiling', 'windows', 'door']);
    expect(offlineMissing(zones('wall', 'floor', 'ceiling', 'window', 'door'), 'kitchen')).toEqual([]);
    // Without a category (older callers) the summary is unchanged.
    expect(offlineSummary(zones('lawn'))).toBe('Mapped on this device without AI: lawn. No style or architecture notes — those need Claude.');
  });
});

describe('CLIPSeg-only map (SegFormer licence declined)', () => {
  /** One probability plane per CLIP_ONLY_CLASSES entry, painted like houseScene(). */
  function clipPlanes(W: number, H: number, interior = false): Float32Array[] {
    const list = interior ? CLIP_ONLY_CLASSES.interior : CLIP_ONLY_CLASSES.exterior;
    const planes = list.map(() => new Float32Array(W * H).fill(0.05));
    const at = (prompt: string) => planes[list.findIndex((c) => c.prompt === prompt)];
    const paint = (plane: Float32Array, x0: number, y0: number, x1: number, y1: number, p: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) plane[y * W + x] = p;
    };
    if (interior) return planes;
    paint(at('the sky'), 0, 0, W, 30, 0.9);
    paint(at('the walls of a house'), 40, 50, 160, 95, 0.8);
    paint(at(CLIP_PROMPTS.roof), 40, 30, 160, 50, 0.85);
    paint(at('a window'), 55, 60, 75, 80, 0.9);
    paint(at(CLIP_PROMPTS.lawn), 0, 95, W, H, 0.85);
    paint(at('a garden path'), 92, 95, 108, H, 0.9);
    return planes;
  }

  it('labels each pixel with its most likely prompt above the threshold', () => {
    const list = CLIP_ONLY_CLASSES.exterior;
    const planes = list.map(() => new Float32Array(2).fill(0.1));
    planes[list.findIndex((c) => c.prompt === 'the sky')][0] = 0.9;
    planes[list.findIndex((c) => c.prompt === 'a tree')][0] = 0.6;
    const { classes, clip } = classMapFromClip(planes, list, 2, 1);
    expect(classes.labels[0]).toBe(ADE.sky);
    expect(classes.labels[1]).toBe(UNLABELED); // nothing reached the threshold
    expect(Object.keys(clip.probs).sort()).toEqual(['driveway', 'lawn', 'mulch', 'patio', 'roof']);
  });

  it('builds a usable exterior map (roof via the override, lawn, path, windows)', () => {
    const W = 200;
    const H = 150;
    const { classes, clip } = classMapFromClip(clipPlanes(W, H), CLIP_ONLY_CLASSES.exterior, W, H);
    const kinds = new Set(zonesFromClasses(classes, { width: 1600, height: 1200 }, false, clip).map((z) => z.kind));
    for (const k of ['sky', 'roof', 'facade', 'lawn', 'walkway', 'windows'] as const) expect(kinds.has(k), k).toBe(true);
    expect(offlineCategory(classes, false)).toBe('front-exterior');
  });

  it('names the model in the scene', () => {
    expect(buildOfflineScene([], 'front-exterior', true, 1, false).model).toBe('On-device (CLIPSeg, no AI)');
  });

  it('every prompt maps to a real ADE20K class', () => {
    for (const c of [...CLIP_ONLY_CLASSES.exterior, ...CLIP_ONLY_CLASSES.interior]) expect(ADE[c.ade], c.ade).toBeTypeOf('number');
    expect(() => classMapFromClip([], [{ prompt: 'x', ade: 'no such class' }], 1, 1)).toThrow(/Unknown ADE20K class/);
  });
});

describe('task models without SegFormer', () => {
  it('drops SegFormer and maps with CLIPSeg instead', () => {
    expect(taskModels('refine', true)).toEqual(['edgetam', 'segformer']);
    expect(taskModels('refine', false)).toEqual(['edgetam']);
    expect(taskModels('mapExterior', false)).toEqual(['clipseg', 'edgetam']);
    expect(taskModels('mapInterior', false)).toEqual(['clipseg', 'edgetam']);
    expect(taskModels('select', false)).toEqual(['edgetam']);
    expect(taskUsesSegformer('select')).toBe(false);
    expect(taskUsesSegformer('refine')).toBe(true);
  });
});
