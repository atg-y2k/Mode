import { describe, expect, it } from 'vitest';
import type { Pt } from '../../shared/types';
import { ADE } from './ade20k';
import { pointInPolygon } from './prompts';
import { buildOfflineScene, componentLabels, kindGrid, offlineCategory, offlineSummary, zonesFromClasses, type ClipMaps } from './sceneFromClasses';
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
