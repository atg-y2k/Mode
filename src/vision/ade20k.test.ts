import { describe, expect, it } from 'vitest';
import { ZONE_KINDS } from '../../shared/types';
import { ADE, ADE20K_LABELS, classesForZone, guessCategory, zoneKindForClass, ZONE_KIND_CLASSES } from './ade20k';

const shares = (entries: Record<string, number>) => {
  const s = new Float64Array(256);
  for (const [k, v] of Object.entries(entries)) s[ADE[k]] = v;
  return s;
};

describe('ADE20K vocabulary', () => {
  it('has the 150 SegFormer classes in model order', () => {
    expect(ADE20K_LABELS).toHaveLength(150);
    expect(ADE.wall).toBe(0);
    expect(ADE.sky).toBe(2);
    expect(ADE.windowpane).toBe(8);
    expect(ADE.grass).toBe(9);
    expect(ADE.house).toBe(25);
    expect(ADE.path).toBe(52);
    expect(ADE.countertop).toBe(70);
    expect(ADE['swimming pool']).toBe(109);
    expect(ADE.flag).toBe(149);
  });

  it('only references valid class ids and known zone kinds', () => {
    for (const [kind, list] of Object.entries(ZONE_KIND_CLASSES)) {
      expect(ZONE_KINDS).toContain(kind);
      for (const id of list ?? []) expect(id).toBeLessThan(150);
    }
  });
});

describe('class → zone kind', () => {
  it('maps exterior classes', () => {
    expect(zoneKindForClass(ADE.grass, false)).toBe('lawn');
    expect(zoneKindForClass(ADE.building, false)).toBe('facade');
    expect(zoneKindForClass(ADE.house, false)).toBe('facade');
    expect(zoneKindForClass(ADE.windowpane, false)).toBe('windows');
    expect(zoneKindForClass(ADE.door, false)).toBe('front-door');
    expect(zoneKindForClass(ADE.path, false)).toBe('walkway');
    expect(zoneKindForClass(ADE.road, false)).toBe('street');
    expect(zoneKindForClass(ADE.tree, false)).toBe('tree');
    expect(zoneKindForClass(ADE.plant, false)).toBe('planting-bed');
    expect(zoneKindForClass(ADE.sky, false)).toBe('sky');
    expect(zoneKindForClass(ADE.person, false)).toBeNull();
    expect(zoneKindForClass(999, false)).toBeNull();
  });

  it('maps interior classes', () => {
    expect(zoneKindForClass(ADE.wall, true)).toBe('wall');
    expect(zoneKindForClass(ADE.floor, true)).toBe('floor');
    expect(zoneKindForClass(ADE.ceiling, true)).toBe('ceiling');
    expect(zoneKindForClass(ADE.cabinet, true)).toBe('cabinetry');
    expect(zoneKindForClass(ADE.countertop, true)).toBe('countertop');
    expect(zoneKindForClass(ADE.windowpane, true)).toBe('window');
    expect(zoneKindForClass(ADE.sofa, true)).toBe('furniture');
    expect(zoneKindForClass(ADE.chandelier, true)).toBe('light-fixture');
    expect(zoneKindForClass(ADE.grass, true)).toBeNull();
  });

  it('knows which classes support a zone', () => {
    expect(classesForZone('lawn').has(ADE.grass)).toBe(true);
    expect(classesForZone('lawn').has(ADE.road)).toBe(false);
    expect(classesForZone('roof').has(ADE.house)).toBe(true);
    expect(classesForZone('other').size).toBe(0);
  });
});

describe('guessCategory', () => {
  it('reads interiors from their furniture', () => {
    expect(guessCategory(shares({ wall: 0.3, cabinet: 0.15, countertop: 0.05, floor: 0.2 }), true)).toBe('kitchen');
    expect(guessCategory(shares({ wall: 0.4, bed: 0.2, floor: 0.2 }), true)).toBe('bedroom');
    expect(guessCategory(shares({ wall: 0.4, sofa: 0.1, floor: 0.2 }), true)).toBe('living-room');
    expect(guessCategory(shares({ wall: 0.9 }), true)).toBe('other-interior');
  });

  it('reads exteriors from the building / yard / paving mix', () => {
    expect(guessCategory(shares({ house: 0.35, sky: 0.2, grass: 0.2 }), false)).toBe('front-exterior');
    expect(guessCategory(shares({ grass: 0.4, tree: 0.2, house: 0.1 }), false)).toBe('front-yard');
    expect(guessCategory(shares({ grass: 0.5, tree: 0.3 }), false)).toBe('garden');
    expect(guessCategory(shares({ 'swimming pool': 0.1, floor: 0.3 }), false)).toBe('pool-area');
    expect(guessCategory(shares({ road: 0.5, house: 0.1 }), false)).toBe('driveway');
    expect(guessCategory(shares({ sky: 0.9 }), false)).toBe('other-exterior');
  });
});
