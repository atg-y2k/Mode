import { describe, expect, it } from 'vitest';
import { analysisSize, logitsToCoverage, logitsToLabels, logitsToProbs } from './resample';

describe('logitsToCoverage', () => {
  it('maps the sign of the logits to coverage with a soft edge', () => {
    // 4×4 logits: left half +5, right half -5.
    const logits = new Float32Array(16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) logits[y * 4 + x] = x < 2 ? 5 : -5;
    const out = logitsToCoverage(logits, 4, 4, 40, 20);
    expect(out[10 * 40 + 2]).toBe(255);
    expect(out[10 * 40 + 37]).toBe(0);
    // The 128 boundary sits at the middle of the frame.
    expect(out[10 * 40 + 19]).toBeGreaterThanOrEqual(128);
    expect(out[10 * 40 + 20]).toBeLessThan(128);
    // A few pixels of ramp, not a hard step.
    const ramp = Array.from(out.subarray(10 * 40, 11 * 40)).filter((v) => v > 0 && v < 255).length;
    expect(ramp).toBeGreaterThan(0);
    expect(ramp).toBeLessThan(10);
  });

  it('reads a plane at an offset (later candidates)', () => {
    const logits = new Float32Array(8);
    logits.fill(-3, 0, 4);
    logits.fill(3, 4, 8);
    expect(logitsToCoverage(logits, 2, 2, 4, 4, 4).every((v) => v === 255)).toBe(true);
    expect(logitsToCoverage(logits, 2, 2, 4, 4, 0).every((v) => v === 0)).toBe(true);
  });
});

describe('logitsToLabels', () => {
  it('upsamples per-class logits and takes the argmax', () => {
    // 3 classes on a 2×2 grid: class 0 top-left, class 2 bottom-right, class 1 elsewhere.
    const C = 3;
    const logits = new Float32Array(C * 4);
    const set = (c: number, x: number, y: number, v: number) => (logits[c * 4 + y * 2 + x] = v);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) set(1, x, y, 1);
    set(0, 0, 0, 5);
    set(2, 1, 1, 5);
    const labels = logitsToLabels(logits, C, 2, 2, 8, 8);
    expect(labels[0]).toBe(0);
    expect(labels[7 * 8 + 7]).toBe(2);
    expect(labels[0 * 8 + 7]).toBe(1);
    expect(labels[7 * 8 + 0]).toBe(1);
  });
});

describe('logitsToProbs / analysisSize', () => {
  it('applies a sigmoid', () => {
    const p = logitsToProbs(new Float32Array([0, 0, 0, 0]), 2, 2, 3, 3);
    expect(p[4]).toBeCloseTo(0.5, 6);
  });

  it('keeps the aspect ratio and never upscales', () => {
    expect(analysisSize(1600, 1200)).toEqual({ width: 512, height: 384 });
    expect(analysisSize(300, 200)).toEqual({ width: 300, height: 200 });
  });
});
