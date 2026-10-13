// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DECOR_FORMS, FIXTURE_FORMS, PLANT_FORMS, type ArtResult, type ArtSpec, type PlantArt } from '../../../shared/art';
import { FIXTURE_EMITTER_Y, artSize, renderArt, tintArt } from './index';
import { renderPlant } from './plants';
import { PathW, leafPath, smoothClosed } from './svg';
import { hexToHsl, makeRng, mix, normHex, normalizeSeed, tone, transferTint } from './util';

const parser = new DOMParser();

/** Every form with a handful of variations that exercise optional fields. */
function allSpecs(): ArtSpec[] {
  const specs: ArtSpec[] = [];
  for (const form of PLANT_FORMS) {
    specs.push({ kind: 'plant', form, foliage: '#4f7a3a', seed: 1 });
    specs.push({ kind: 'plant', form, foliage: '#7a2f2a', foliage2: '#b4553c', flower: '#f2f0e6', trunk: '#4a3b33', density: 0, seed: 2 });
    specs.push({ kind: 'plant', form, foliage: '#6f8f5b', flower: '#7b62b8', pot: '#b8643f', density: 1, seed: 3 });
  }
  for (const form of FIXTURE_FORMS) {
    specs.push({ kind: 'fixture', form, finish: '#1f1f1f' });
    specs.push({ kind: 'fixture', form, finish: '#b08d57', shade: '#f6f1e4' });
  }
  for (const form of DECOR_FORMS) {
    for (let seed = 0; seed < 4; seed++) specs.push({ kind: 'decor', form, color: '#8a6a4f', color2: seed % 2 ? '#3d6b8a' : undefined, seed });
  }
  return specs;
}

function label(spec: ArtSpec): string {
  return `${spec.kind}:${spec.form}:${JSON.stringify(spec)}`;
}

function checkResult(spec: ArtSpec, r: ArtResult): void {
  const name = label(spec);
  const { svg } = r;
  expect(svg.startsWith('<svg '), name).toBe(true);
  expect(svg.endsWith('</svg>'), name).toBe(true);
  expect(Number.isInteger(r.width) && r.width > 0, name).toBe(true);
  expect(Number.isInteger(r.height) && r.height > 0, name).toBe(true);
  expect(r.width, name).toBeLessThanOrEqual(1000);
  expect(r.height, name).toBeLessThanOrEqual(1000);
  expect(svg, name).toContain(`width="${r.width}" height="${r.height}" viewBox="0 0 `);
  // The viewBox keeps the same proportions as the intrinsic size.
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  expect(vb, name).not.toBeNull();
  const [vw, vh] = [Number(vb![1]), Number(vb![2])];
  expect(vw > 0 && vh > 0, name).toBe(true);
  expect(Math.abs(r.width / r.height - vw / vh) / (vw / vh), name).toBeLessThan(0.01);
  // Crisp when rasterized at the natural size.
  expect(Math.max(r.width, r.height), name).toBeGreaterThanOrEqual(360);
  expect(r.anchorY, name).toBeGreaterThan(0.5);
  expect(r.anchorY, name).toBeLessThanOrEqual(1);
  expect(svg, name).not.toMatch(/NaN|undefined|Infinity|null|\[object/);
  expect(svg, name).not.toMatch(/<text|<image|<script|<foreignObject|xlink:href="http/);
  expect(svg.split('<svg').length - 1, name).toBe(1);
  // Strokes stay hairline-ish.
  for (const m of svg.matchAll(/stroke-width="([\d.]+)"/g)) expect(Number(m[1]), name).toBeLessThanOrEqual(1.5);
  // Well-formed XML that a browser would accept.
  const xml = parser.parseFromString(svg, 'image/svg+xml');
  expect(xml.getElementsByTagName('parsererror').length, name).toBe(0);
  expect(xml.documentElement.nodeName, name).toBe('svg');
  // Ids are unique and every reference resolves.
  const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size, name).toBe(ids.length);
  const idSet = new Set(ids);
  for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(idSet.has(m[1]), `${name} → #${m[1]}`).toBe(true);
  for (const m of svg.matchAll(/href="#([^"]+)"/g)) expect(idSet.has(m[1]), `${name} → #${m[1]}`).toBe(true);
}

describe('renderArt', () => {
  const specs = allSpecs();

  it('renders every plant, fixture and decor form as valid standalone SVG', () => {
    const seen = new Set<string>();
    for (const spec of specs) {
      checkResult(spec, renderArt(spec));
      seen.add(`${spec.kind}:${spec.form}`);
    }
    expect(seen.size).toBe(PLANT_FORMS.length + FIXTURE_FORMS.length + DECOR_FORMS.length);
  });

  it('artSize matches renderArt without drawing', () => {
    for (const spec of specs) {
      const r = renderArt(spec);
      expect(artSize(spec), label(spec)).toEqual({ width: r.width, height: r.height, anchorY: r.anchorY });
    }
    const odd = { kind: 'mystery' } as unknown as ArtSpec;
    const r = renderArt(odd);
    expect(artSize(odd)).toEqual({ width: r.width, height: r.height, anchorY: r.anchorY });
  });

  it('keeps output reasonably small', () => {
    for (const spec of specs) expect(renderArt(spec).svg.length, label(spec)).toBeLessThan(160_000);
  });

  it('is deterministic per spec (independent of the cache)', () => {
    for (const form of PLANT_FORMS) {
      const spec: PlantArt = { kind: 'plant', form, foliage: '#4f7a3a', flower: '#e7a3c4', seed: 7 };
      const a = renderPlant(spec, 'p-', 12345);
      const b = renderPlant({ ...spec }, 'p-', 12345);
      expect(a.svg).toBe(b.svg);
    }
    for (const spec of specs.slice(0, 40)) expect(renderArt({ ...spec } as ArtSpec).svg).toBe(renderArt(spec).svg);
  });

  it('varies organic shapes with the seed', () => {
    for (const form of PLANT_FORMS) {
      const a = renderArt({ kind: 'plant', form, foliage: '#4f7a3a', seed: 1 });
      const b = renderArt({ kind: 'plant', form, foliage: '#4f7a3a', seed: 2 });
      expect(a.svg, form).not.toBe(b.svg);
      // Proportions depend only on the form (and pot), never on the seed.
      expect(a.width / a.height, form).toBeCloseTo(b.width / b.height, 6);
    }
  });

  it('prefixes def ids with a per-spec hash so documents can be combined', () => {
    const a = renderArt({ kind: 'plant', form: 'round-shrub', foliage: '#4f7a3a', seed: 1 }).svg;
    const b = renderArt({ kind: 'plant', form: 'round-shrub', foliage: '#4f7a3a', seed: 2 }).svg;
    const ids = (s: string): string[] => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const ia = ids(a);
    const ib = ids(b);
    expect(ia.length).toBeGreaterThan(0);
    expect(ia.filter((id) => ib.includes(id))).toEqual([]);
    const prefix = ia[0].split('-')[0];
    expect(ia.every((id) => id.startsWith(prefix + '-'))).toBe(true);
  });

  it('returns a copy so callers cannot corrupt the cache', () => {
    const spec: ArtSpec = { kind: 'decor', form: 'bench', color: '#8a6a4f' };
    const r = renderArt(spec);
    r.svg = 'broken';
    r.width = -1;
    const again = renderArt(spec);
    expect(again.svg.startsWith('<svg')).toBe(true);
    expect(again.width).toBeGreaterThan(0);
  });

  it('survives bad input (invalid colors, odd numbers, unknown forms)', () => {
    const bad: ArtSpec[] = [
      { kind: 'plant', form: 'palm', foliage: 'green', foliage2: '#zzz', flower: '', pot: 'nope', density: Number.NaN, seed: Number.NaN },
      { kind: 'plant', form: 'hedge', foliage: '#abc', density: 7, seed: -3.7 },
      { kind: 'plant', form: 'nonexistent' as never, foliage: '#4f7a3a', seed: 1 },
      { kind: 'fixture', form: 'bogus' as never, finish: 'brass' },
      { kind: 'decor', form: 'mirror', color: '', seed: -5 },
      { kind: 'decor', form: 'unknown' as never, color: '#123456' },
      { kind: 'mystery' } as unknown as ArtSpec,
    ];
    for (const spec of bad) checkResult(spec, renderArt(spec));
  });

  it('exposes an emitter position for every fixture form', () => {
    for (const form of FIXTURE_FORMS) {
      expect(FIXTURE_EMITTER_Y[form], form).toBeGreaterThan(0);
      expect(FIXTURE_EMITTER_Y[form], form).toBeLessThan(1);
    }
  });

  it('renders the whole catalog of forms quickly', () => {
    const t0 = performance.now();
    for (const spec of specs) renderPlantOrArt(spec);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});

/** Bypass the cache so the timing test measures real work. */
function renderPlantOrArt(spec: ArtSpec): ArtResult {
  if (spec.kind === 'plant') return renderPlant(spec, 't-', normalizeSeed(spec.seed));
  return renderArt({ ...spec, seed: 999 } as ArtSpec);
}

describe('tintArt', () => {
  it('changes the primary color of each kind and the rendered output', () => {
    const cases: ArtSpec[] = [
      { kind: 'plant', form: 'round-shrub', foliage: '#4f7a3a', foliage2: '#7fae4f', seed: 1 },
      { kind: 'fixture', form: 'pendant-dome', finish: '#1f1f1f', shade: '#f4ecd8' },
      { kind: 'decor', form: 'sofa', color: '#8a6a4f', color2: '#3d6b8a' },
    ];
    for (const spec of cases) {
      const tinted = tintArt(spec, '#AA2244');
      const primary = tinted.kind === 'plant' ? tinted.foliage : tinted.kind === 'fixture' ? tinted.finish : tinted.color;
      expect(primary).toBe('#aa2244');
      const a = renderArt(spec);
      const b = renderArt(tinted);
      expect(b.svg).not.toBe(a.svg);
      expect(b.width).toBe(a.width);
      expect(b.height).toBe(a.height);
      // The original spec is not mutated.
      expect(spec).not.toBe(tinted);
    }
  });

  it('uses the tint directly as a fill for foliage', () => {
    const t = tintArt({ kind: 'plant', form: 'hedge', foliage: '#4f7a3a', seed: 4 }, '#2266cc');
    expect(renderArt(t).svg).toContain('fill="#2266cc"');
  });

  it('shifts a plant highlight color along with the foliage', () => {
    const spec: PlantArt = { kind: 'plant', form: 'round-shrub', foliage: '#4f7a3a', foliage2: '#7fae4f', seed: 1 };
    const t = tintArt(spec, '#7a2f2a') as PlantArt;
    expect(t.foliage2).toBeDefined();
    const [h] = hexToHsl(t.foliage2!);
    // Green highlight follows the foliage into the red range.
    expect(h < 40 || h > 330).toBe(true);
    // Keeps the secondary color lighter than the primary, like the original.
    expect(hexToHsl(t.foliage2!)[2]).toBeGreaterThan(hexToHsl(t.foliage)[2]);
  });

  it('keeps secondary colors of fixtures and decor', () => {
    const f = tintArt({ kind: 'fixture', form: 'wall-lantern', finish: '#1f1f1f', shade: '#f4ecd8' }, '#b08d57');
    expect(f.kind === 'fixture' && f.shade).toBe('#f4ecd8');
    const d = tintArt({ kind: 'decor', form: 'rug', color: '#8a6a4f', color2: '#3d6b8a', seed: 1 }, '#224466');
    expect(d.kind === 'decor' && d.color2).toBe('#3d6b8a');
  });

  it('ignores invalid tints', () => {
    const spec: ArtSpec = { kind: 'decor', form: 'boulder', color: '#888888' };
    expect(tintArt(spec, 'red')).toBe(spec);
    expect(tintArt(spec, '#12')).toBe(spec);
  });
});

describe('util', () => {
  it('seeded rng is deterministic and well spread', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const r = makeRng(1);
    for (let i = 0; i < 200; i++) {
      const n = r.int(2, 5);
      expect(n >= 2 && n <= 5 && Number.isInteger(n)).toBe(true);
    }
  });

  it('normalizes seeds and hex colors', () => {
    expect(normalizeSeed(undefined)).toBe(0);
    expect(normalizeSeed(Number.NaN)).toBe(0);
    expect(normalizeSeed(3.9)).toBe(3);
    expect(normHex('#ABC', '#000000')).toBe('#aabbcc');
    expect(normHex('12ab9F', '#000000')).toBe('#12ab9f');
    expect(normHex('green', '#010203')).toBe('#010203');
  });

  it('tone() lightens and darkens', () => {
    const base = '#4f7a3a';
    expect(hexToHsl(tone(base, 0.4))[2]).toBeGreaterThan(hexToHsl(base)[2]);
    expect(hexToHsl(tone(base, -0.4))[2]).toBeLessThan(hexToHsl(base)[2]);
    expect(tone(base, 0)).toBe(base);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('transferTint maps the reference color exactly', () => {
    expect(transferTint('#4f7a3a', '#4f7a3a', '#aa2244')).toBe('#aa2244');
  });
});

describe('svg geometry', () => {
  /** Minimal interpreter for the commands PathW emits; returns subpath end points. */
  function points(d: string): { x: number; y: number }[] {
    const toks = d.match(/[MLQCAZmlqcaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    const out: { x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    let i = 0;
    const num = (): number => Number(toks[i++]);
    while (i < toks.length) {
      const cmd = toks[i++];
      if (cmd === 'M') {
        x = num();
        y = num();
        sx = x;
        sy = y;
      } else if (cmd === 'l') {
        x += num();
        y += num();
      } else if (cmd === 'q') {
        num();
        num();
        x += num();
        y += num();
      } else if (cmd === 'c') {
        for (let k = 0; k < 4; k++) num();
        x += num();
        y += num();
      } else if (cmd === 'a') {
        for (let k = 0; k < 5; k++) num();
        x += num();
        y += num();
      } else if (cmd === 'z') {
        x = sx;
        y = sy;
      } else throw new Error('unexpected ' + cmd);
      out.push({ x, y });
    }
    return out;
  }

  it('PathW writes relative commands without accumulating rounding drift', () => {
    const p = new PathW(0).M(0.4, 0.4);
    let ax = 0.4;
    let ay = 0.4;
    for (let k = 0; k < 500; k++) {
      ax += 1.37;
      ay += 0.73;
      p.L(ax, ay);
    }
    const pts = points(p.toString());
    const last = pts[pts.length - 1];
    expect(last.x).toBe(Math.round(ax));
    expect(last.y).toBe(Math.round(ay));
    expect(p.toString()).not.toMatch(/ -/);
  });

  it('closed shapes return to their start point', () => {
    const d = smoothClosed(
      Array.from({ length: 12 }, (_, i) => ({ x: 50 + Math.cos(i) * 30, y: 50 + Math.sin(i) * 20 })),
      1,
    );
    const pts = points(d);
    expect(pts[pts.length - 1]).toEqual(pts[0]);
    const leaf = points(leafPath({ x: 10, y: 10 }, -Math.PI / 2, 40, 12, 0.1, 1));
    expect(leaf[leaf.length - 1]).toEqual({ x: 10, y: 10 });
  });
});
