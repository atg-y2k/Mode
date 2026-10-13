import { describe, expect, it } from 'vitest';
import type { Pt } from '../../shared/types';
import {
  applyHomography,
  computeHomography,
  distance,
  distanceToSegment,
  invertMat3,
  isConvexQuad,
  pointInPolygon,
  polygonArea,
  rotatePoint,
  solveLinearSystem,
  type Mat3,
} from './geometry';

function expectPt(actual: Pt, expected: Pt, digits = 6) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

const unitSquare: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('computeHomography', () => {
  const cases: [string, Pt[], Pt[]][] = [
    ['identity', unitSquare, unitSquare],
    ['translate+scale', unitSquare, unitSquare.map((p) => ({ x: 10 + 3 * p.x, y: -4 + 7 * p.y }))],
    [
      'perspective floor quad (photo pixels)',
      [
        { x: 0, y: 0 },
        { x: 144, y: 0 },
        { x: 144, y: 96 },
        { x: 0, y: 96 },
      ],
      [
        { x: 612.5, y: 803.25 },
        { x: 1011.75, y: 798 },
        { x: 1589.5, y: 1590.5 },
        { x: 20.25, y: 1588 },
      ],
    ],
    [
      'quad -> rectangle (inverse direction)',
      [
        { x: 412, y: 220 },
        { x: 1211, y: 260 },
        { x: 1180, y: 1020 },
        { x: 380, y: 1100 },
      ],
      unitSquare,
    ],
  ];

  it.each(cases)('maps the 4 points exactly: %s', (_name, src, dst) => {
    const H = computeHomography(src, dst);
    expect(H[8]).toBeCloseTo(1, 12);
    for (let i = 0; i < 4; i++) {
      const q = applyHomography(H, src[i]);
      const tol = 1e-7 * (1 + Math.hypot(dst[i].x, dst[i].y));
      expect(Math.abs(q.x - dst[i].x)).toBeLessThan(tol);
      expect(Math.abs(q.y - dst[i].y)).toBeLessThan(tol);
    }
    // the inverse maps back
    const inv = invertMat3(H);
    expect(inv).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const back = applyHomography(inv!, dst[i]);
      expect(Math.abs(back.x - src[i].x)).toBeLessThan(1e-6 * (1 + Math.abs(src[i].x)));
      expect(Math.abs(back.y - src[i].y)).toBeLessThan(1e-6 * (1 + Math.abs(src[i].y)));
    }
  });

  it('maps interior points consistently (center of the square -> diagonal intersection)', () => {
    const dst = [
      { x: 100, y: 100 },
      { x: 300, y: 120 },
      { x: 280, y: 400 },
      { x: 90, y: 300 },
    ];
    const H = computeHomography(unitSquare, dst);
    const c = applyHomography(H, { x: 0.5, y: 0.5 });
    // Diagonals of the quad intersect where the square's center lands.
    const [a, b, cc, d] = dst;
    const denom = (a.x - cc.x) * (b.y - d.y) - (a.y - cc.y) * (b.x - d.x);
    const t = ((a.x - b.x) * (b.y - d.y) - (a.y - b.y) * (b.x - d.x)) / denom;
    expectPt(c, { x: a.x + t * (cc.x - a.x), y: a.y + t * (cc.y - a.y) }, 6);
  });

  it('throws on degenerate input', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(() => computeHomography(collinear, unitSquare)).toThrow();
    expect(() => computeHomography(unitSquare, collinear)).toThrow();
    const dup = [unitSquare[0], unitSquare[0], unitSquare[2], unitSquare[3]];
    expect(() => computeHomography(dup, unitSquare)).toThrow();
    expect(() => computeHomography(unitSquare.slice(0, 3), unitSquare)).toThrow();
    expect(() => computeHomography([{ x: NaN, y: 0 }, ...unitSquare.slice(1)], unitSquare)).toThrow();
    const allSame = Array.from({ length: 4 }, () => ({ x: 5, y: 5 }));
    expect(() => computeHomography(allSame, unitSquare)).toThrow();
  });
});

describe('solveLinearSystem', () => {
  it('solves with pivoting (zero on the diagonal)', () => {
    const A = new Float64Array([0, 2, 1, 1, 1, 1, 2, 1, 0]);
    const b = new Float64Array([5, 4, 4]); // x = 1, y = 2, z = 1
    const x = solveLinearSystem(A, b, 3)!;
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(2, 12);
    expect(x[2]).toBeCloseTo(1, 12);
  });

  it('returns null for singular systems', () => {
    expect(solveLinearSystem(new Float64Array([1, 2, 2, 4]), new Float64Array([1, 2]), 2)).toBeNull();
    expect(solveLinearSystem(new Float64Array(4), new Float64Array(2), 2)).toBeNull();
  });
});

describe('invertMat3 / applyHomography', () => {
  it('inverts and returns null for singular matrices', () => {
    const m: Mat3 = [2, 1, 0, 0, 3, 1, 1, 0, 1];
    const inv = invertMat3(m)!;
    // m · inv = I
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += m[i * 3 + k] * inv[k * 3 + j];
        expect(s).toBeCloseTo(i === j ? 1 : 0, 12);
      }
    }
    expect(invertMat3([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
    expect(invertMat3([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(invertMat3([NaN, 0, 0, 0, 1, 0, 0, 0, 1])).toBeNull();
  });

  it('never returns NaN for points on the horizon line', () => {
    const H: Mat3 = [1, 0, 0, 0, 1, 0, 1, 0, 0]; // w = x
    const p = applyHomography(H, { x: 0, y: 3 });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe('polygons', () => {
  const concave: Pt[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 5, y: 4 },
    { x: 0, y: 10 },
  ];

  it('pointInPolygon (even-odd)', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, unitSquare)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, unitSquare)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 2 }, concave)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 8 }, concave)).toBe(false); // in the notch
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, unitSquare.slice(0, 2))).toBe(false);
  });

  it('polygonArea (shoelace, either winding)', () => {
    expect(polygonArea(unitSquare)).toBe(1);
    expect(polygonArea([...unitSquare].reverse())).toBe(1);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }])).toBe(6);
    expect(polygonArea(concave)).toBe(100 - 30);
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 1, y: 0 }])).toBe(0);
  });

  it('isConvexQuad', () => {
    expect(isConvexQuad(unitSquare)).toBe(true);
    expect(isConvexQuad([...unitSquare].reverse())).toBe(true);
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 4 }])).toBe(false); // concave
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(false); // bow-tie
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }])).toBe(false); // collinear
    expect(isConvexQuad(unitSquare.slice(0, 3))).toBe(false);
    expect(isConvexQuad([{ x: NaN, y: 0 }, ...unitSquare.slice(1)])).toBe(false);
  });
});

describe('points', () => {
  it('distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('rotatePoint turns clockwise on screen for positive degrees', () => {
    expectPt(rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90), { x: 0, y: 1 });
    expectPt(rotatePoint({ x: 3, y: 2 }, { x: 2, y: 2 }, 180), { x: 1, y: 2 });
    expectPt(rotatePoint({ x: 5, y: 7 }, { x: 1, y: 1 }, 360), { x: 5, y: 7 });
  });

  it('distanceToSegment', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distanceToSegment({ x: 5, y: 3 }, a, b)).toBe(3);
    expect(distanceToSegment({ x: -3, y: 4 }, a, b)).toBe(5);
    expect(distanceToSegment({ x: 13, y: -4 }, a, b)).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5); // zero-length segment
  });
});
