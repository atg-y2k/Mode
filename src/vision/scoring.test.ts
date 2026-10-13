import { describe, expect, it } from 'vitest';
import type { Pt } from '../../shared/types';
import { createMask } from '../engine/mask';
import type { Mask } from '../engine/types';
import {
  agreementLevel,
  candidateScore,
  classAgreement,
  cleanMask,
  clipToPolygonMargin,
  maskArea,
  maskIoU,
  masksTouch,
  rasterizePolygon,
  zoneAgreement,
  type ClassMap,
} from './scoring';

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function fill(m: Mask, x0: number, y0: number, x1: number, y1: number, v = 255) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m.data[y * m.width + x] = v;
}

describe('maskIoU', () => {
  it('measures overlap of the covered pixels', () => {
    const a = rasterizePolygon(100, 100, rect(0, 0, 50, 100));
    const b = rasterizePolygon(100, 100, rect(25, 0, 50, 100));
    expect(maskArea(a)).toBe(5000);
    expect(maskIoU(a, b)).toBeCloseTo(2500 / 7500, 5);
    expect(maskIoU(a, a)).toBe(1);
    expect(maskIoU(createMask(10, 10), createMask(10, 10))).toBe(0);
  });

  it('can be limited to a box and rejects size mismatches', () => {
    const a = rasterizePolygon(100, 100, rect(0, 0, 50, 100));
    const b = rasterizePolygon(100, 100, rect(25, 0, 50, 100));
    expect(maskIoU(a, b, { x: 25, y: 0, w: 25, h: 100 })).toBe(1);
    expect(() => maskIoU(a, createMask(5, 5))).toThrow();
  });
});

describe('classAgreement', () => {
  it('samples the class map at its own resolution', () => {
    // 4×2 class map: left half class 9 (grass), right half class 6 (road).
    const classes: ClassMap = { width: 4, height: 2, labels: new Uint8Array([9, 9, 6, 6, 9, 9, 6, 6]) };
    const lawn = rasterizePolygon(400, 200, rect(0, 0, 200, 200));
    expect(classAgreement(lawn, classes, new Set([9]))).toBe(1);
    const wide = rasterizePolygon(400, 200, rect(0, 0, 300, 200));
    expect(classAgreement(wide, classes, new Set([9]))).toBeCloseTo(2 / 3, 5);
    expect(classAgreement(createMask(400, 200), classes, new Set([9]))).toBeNull();
    expect(classAgreement(lawn, classes, new Set())).toBeNull();
  });
});

describe('candidate choice', () => {
  it('prefers the candidate matching the outline over a confident "whole house"', () => {
    const roof = candidateScore({ iou: 0.78, classShare: 0.9, modelScore: 0.86 });
    const house = candidateScore({ iou: 0.35, classShare: 0.95, modelScore: 0.97 });
    expect(roof).toBeGreaterThan(house);
    expect(candidateScore({ iou: 0.8, classShare: null, modelScore: 0.5 })).toBeCloseTo(0.74, 5);
  });

  it('rates agreement 0..1 with levels', () => {
    expect(zoneAgreement(0.9, 1)).toBe(1);
    expect(zoneAgreement(0.425, null)).toBe(0.5);
    expect(zoneAgreement(0, 0)).toBe(0);
    expect(agreementLevel(0.8)).toBe('high');
    expect(agreementLevel(0.6)).toBe('medium');
    expect(agreementLevel(0.2)).toBe('low');
  });
});

describe('cleanMask', () => {
  it('drops specks and fills pinholes but keeps real holes', () => {
    const m = createMask(200, 200);
    fill(m, 20, 20, 180, 180);
    fill(m, 60, 60, 63, 63, 0); // pinhole (9 px)
    fill(m, 100, 100, 140, 140, 0); // window-sized hole (1600 px)
    fill(m, 2, 2, 5, 5); // speck
    cleanMask(m);
    expect(m.data[3 * 200 + 3]).toBe(0);
    expect(m.data[61 * 200 + 61]).toBe(255);
    expect(m.data[120 * 200 + 120]).toBe(0);
    expect(m.data[100 * 200 + 50]).toBe(255);
  });

  it('keeps a lone small component (it is the largest)', () => {
    const m = createMask(50, 50);
    fill(m, 10, 10, 13, 13);
    cleanMask(m);
    expect(maskArea(m)).toBe(9);
  });
});

describe('clip and touch', () => {
  it('clips a leaking mask to a margin around the outline', () => {
    const m = createMask(300, 100);
    fill(m, 0, 0, 300, 100);
    clipToPolygonMargin(m, rect(100, 20, 50, 50), 10);
    expect(m.data[50 * 300 + 120]).toBe(255);
    expect(m.data[50 * 300 + 155]).toBe(255);
    expect(m.data[50 * 300 + 200]).toBe(0);
    expect(m.data[5 * 300 + 120]).toBe(0);
  });

  it('detects masks that touch within a gap', () => {
    const a = rasterizePolygon(100, 100, rect(0, 0, 40, 100));
    const b = rasterizePolygon(100, 100, rect(42, 0, 40, 100));
    const c = rasterizePolygon(100, 100, rect(60, 0, 40, 100));
    expect(masksTouch(a, b, 3)).toBe(true);
    expect(masksTouch(a, c, 3)).toBe(false);
  });
});
