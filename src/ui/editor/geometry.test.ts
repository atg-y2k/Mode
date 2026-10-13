import { describe, expect, it } from 'vitest';
import {
  angleFromAnchor,
  bytesDifferInRect,
  clipRect,
  constrainAngle,
  directionDeg,
  distToSegment,
  formatFeet,
  hitObject,
  isConvexQuad,
  lineRadiusKnob,
  normalizeDeg,
  objectCorners,
  pointInPolygon,
  polygonArea,
  quadFromRect,
  rotateHandlePos,
  scaledHeight,
  segmentRect,
  snapAngle,
  spotAngleKnob,
  toFeet,
  toLocal,
  toWorld,
  unionRect,
  applyMat3,
} from './geometry';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('object frames', () => {
  const obj = { x: 100, y: 200, height: 50, rotation: 0 };

  it('anchors the rect at the base center', () => {
    const [tl, tr, br, bl] = objectCorners(obj, 0.8, 1);
    expect(tl).toEqual({ x: 80, y: 150 });
    expect(tr).toEqual({ x: 120, y: 150 });
    expect(br).toEqual({ x: 120, y: 200 });
    expect(bl).toEqual({ x: 80, y: 200 });
  });

  it('respects the anchorY of the art', () => {
    const [tl, , br] = objectCorners(obj, 1, 0.9);
    close(tl.y, 155);
    close(br.y, 205);
  });

  it('rotates about the anchor', () => {
    const r = { ...obj, rotation: 90 };
    const [tl] = objectCorners(r, 1, 1);
    // local (-25, -50) rotated 90° clockwise -> (50, -25)
    close(tl.x, 150);
    close(tl.y, 175);
    const back = toLocal(toWorld({ x: 3, y: -7 }, r), r);
    close(back.x, 3);
    close(back.y, -7);
  });

  it('hit tests inside the rotated rect only', () => {
    const r = { ...obj, rotation: 45 };
    expect(hitObject({ x: 100, y: 190 }, r, 1, 1)).toBe(true);
    expect(hitObject({ x: 60, y: 140 }, r, 1, 1)).toBe(false);
    expect(hitObject({ x: 100, y: 201 }, obj, 1, 1)).toBe(false);
    expect(hitObject({ x: 100, y: 201 }, obj, 1, 1, 2)).toBe(true);
  });

  it('places the rotation handle above the top center', () => {
    const p = rotateHandlePos(obj, 1, 1, 20);
    expect(p).toEqual({ x: 100, y: 130 });
  });

  it('measures angles clockwise from straight up', () => {
    const a = { x: 0, y: 0 };
    close(angleFromAnchor(a, { x: 0, y: -10 }), 0);
    close(angleFromAnchor(a, { x: 10, y: 0 }), 90);
    close(angleFromAnchor(a, { x: -10, y: 0 }), -90);
    close(Math.abs(angleFromAnchor(a, { x: 0, y: 10 })), 180);
  });

  it('scales height by the distance ratio to the anchor', () => {
    expect(scaledHeight({ x: 0, y: 0 }, { x: 0, y: -10 }, { x: 0, y: -20 }, 40, 4, 1000)).toBe(80);
    expect(scaledHeight({ x: 0, y: 0 }, { x: 0, y: -10 }, { x: 0, y: 0 }, 40, 4, 1000)).toBe(4);
  });
});

describe('angles', () => {
  it('normalizes into (-180, 180]', () => {
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(720)).toBe(0);
  });
  it('snaps to steps or gently to right angles', () => {
    expect(snapAngle(22, true)).toBe(15);
    expect(snapAngle(23, true)).toBe(30);
    expect(snapAngle(88.5, false)).toBe(90);
    expect(snapAngle(80, false)).toBe(80);
  });
  it('constrains a segment to 45° steps keeping its length', () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    close(p.x, Math.hypot(10, 1));
    close(p.y, 0);
  });
  it('direction degrees use 0 = right, 90 = down', () => {
    close(directionDeg({ x: 0, y: 0 }, { x: 0, y: 5 }), 90);
  });
});

describe('light handles', () => {
  it('puts the radius knob of a line light perpendicular to its middle', () => {
    const k = lineRadiusKnob({ x: 0, y: 0, x2: 100, y2: 0, beam: 'strip', radius: 30 });
    close(k.x, 50);
    close(k.y, 30);
  });
  it('aims the spot knob along the angle', () => {
    const k = spotAngleKnob({ x: 10, y: 10, beam: 'spot', radius: 100, angle: 0 });
    close(k.x, 55);
    close(k.y, 10);
  });
  it('distance to segment', () => {
    close(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
    close(distToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  });
});

describe('quads & polygons', () => {
  it('builds clockwise quads from rects and detects convexity', () => {
    const q = quadFromRect({ x: 0, y: 0, w: 10, h: 5 });
    expect(isConvexQuad(q)).toBe(true);
    const bow = [q[0], q[2], q[1], q[3]];
    expect(isConvexQuad(bow)).toBe(false);
    const flat = [q[0], q[0], q[1], q[2]];
    expect(isConvexQuad(flat)).toBe(false);
  });
  it('point in polygon and area', () => {
    const sq = quadFromRect({ x: 0, y: 0, w: 10, h: 10 });
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
    expect(polygonArea(sq)).toBe(100);
  });
  it('applies homographies', () => {
    const translate = [1, 0, 5, 0, 1, -2, 0, 0, 1];
    expect(applyMat3(translate, { x: 1, y: 1 })).toEqual({ x: 6, y: -1 });
    const projective = [2, 0, 0, 0, 2, 0, 0, 0, 2];
    expect(applyMat3(projective, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });
});

describe('dirty rects', () => {
  it('covers thick segments and unions', () => {
    const r = segmentRect({ x: 10.5, y: 20 }, { x: 4, y: 30.2 }, 3);
    expect(r).toEqual({ x: 1, y: 17, w: 13, h: 17 });
    expect(unionRect(null, r)).toBe(r);
    expect(unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 5, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 6, h: 6 });
  });
  it('clips to the image', () => {
    expect(clipRect({ x: -5, y: -5, w: 10, h: 10 }, 100, 100)).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    expect(clipRect({ x: 200, y: 0, w: 10, h: 10 }, 100, 100)).toBeNull();
  });
  it('compares bytes inside a rect only', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    b[15] = 1;
    expect(bytesDifferInRect(a, b, 4, { x: 0, y: 0, w: 2, h: 2 })).toBe(false);
    expect(bytesDifferInRect(a, b, 4, { x: 2, y: 2, w: 2, h: 2 })).toBe(true);
  });
});

describe('lengths', () => {
  it('converts units to feet', () => {
    close(toFeet(80, 'in'), 80 / 12);
    close(toFeet(1, 'm'), 3.280839895);
    close(toFeet(30.48, 'cm'), 1, 1e-6);
  });
  it('formats feet and inches', () => {
    expect(formatFeet(80 / 12)).toBe('6′ 8″');
    expect(formatFeet(8)).toBe('8′');
    expect(formatFeet(0.5)).toBe('6″');
    expect(formatFeet(11.99)).toBe('12′');
    expect(formatFeet(42.34)).toBe('42.3 ft');
    expect(formatFeet(0)).toBe('—');
  });
});
