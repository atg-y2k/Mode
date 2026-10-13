/**
 * Lighting simulation on a composited image:
 * 1. applyGrade — global exposure / white balance / contrast / saturation and a
 *    time-of-day look (golden hour, dusk, night) whose strength is `ambient`.
 * 2. renderLights — additive glows for placed lights (omni / down / up / spot /
 *    strip / string) tinted by color temperature. Glows matter little in
 *    daylight and dominate at night (scaled by lightGain(timeOfDay)).
 * Pure ImageData operations, in place.
 *
 * Everything is computed in linear light and written back with a sub-LSB
 * dither, so darkened gradients and soft light falloffs never band.
 */
import type { LightingSettings, PlacedLight, TimeOfDay } from '../../shared/types';
import { kelvinToRgb, linearToSrgb8, SRGB8_TO_LINEAR, srgbToLinear } from './color';
import type { ImageDataLike } from './types';

export interface TimeOfDayLook {
  /** Exposure offset in stops at ambient = 1. */
  exposure: number;
  /** Multiplicative RGB tint at ambient = 1 (1,1,1 = none). */
  tint: [number, number, number];
  /** Saturation offset at ambient = 1. */
  saturation: number;
  /** Contrast offset at ambient = 1. */
  contrast: number;
  /**
   * Optional split toning: tint of the shadows at ambient = 1. When set,
   * `tint` applies to the highlights and the two blend by scene luminance
   * (golden hour: warm sunlit planes, cooler shade).
   */
  shadowTint?: [number, number, number];
}

/**
 * The looks are tuned on real-photo-like scenes:
 * - golden: low warm sun — orange highlights, slightly violet shade, a touch
 *   darker, more contrast and saturation.
 * - dusk: blue hour — −1.3 EV, cool blue, desaturated, flatter (no sun).
 * - night: −2.6 EV moonlit blue, strongly desaturated; contrast is reduced
 *   before the exposure drop so harsh daylight shadows read as diffuse
 *   ambient light and the placed lights carry the scene.
 */
export const TIME_OF_DAY_LOOKS: Record<TimeOfDay, TimeOfDayLook> = {
  day: { exposure: 0, tint: [1, 1, 1], saturation: 0, contrast: 0 },
  golden: {
    exposure: -0.3,
    tint: [1.2, 0.98, 0.68],
    shadowTint: [1.02, 0.94, 1.02],
    saturation: 0.14,
    contrast: 0.16,
  },
  dusk: { exposure: -1.3, tint: [0.8, 0.92, 1.3], saturation: -0.38, contrast: -0.12 },
  night: { exposure: -2.6, tint: [0.62, 0.84, 1.55], saturation: -0.72, contrast: -0.3 },
};

const LIGHT_GAIN: Record<TimeOfDay, number> = { day: 0.2, golden: 0.45, dusk: 0.75, night: 1 };

/** How visible artificial lights are at a time of day (day ≈ 0.2 … night = 1). */
export function lightGain(t: TimeOfDay): number {
  return LIGHT_GAIN[t] ?? LIGHT_GAIN.day;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Rec. 709 luminance weights (linear light). */
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

type Vec3 = [number, number, number];

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lookFor(t: TimeOfDay): TimeOfDayLook {
  return TIME_OF_DAY_LOOKS[t] ?? TIME_OF_DAY_LOOKS.day;
}

/** Settings with missing / non-finite fields replaced (older saves, sliders mid-edit). */
function sanitize(s: LightingSettings): LightingSettings {
  return {
    timeOfDay: TIME_OF_DAY_LOOKS[s.timeOfDay] ? s.timeOfDay : 'day',
    exposure: clamp(finite(s.exposure, 0), -6, 6),
    kelvin: clamp(finite(s.kelvin, 5500), 1000, 40000),
    ambient: clamp(finite(s.ambient, 0.75), 0, 1),
    contrast: clamp(finite(s.contrast, 0), -1, 1),
    saturation: clamp(finite(s.saturation, 0), -1, 1),
  };
}

/** kelvinToRgb ratio to neutral 5500 K, used as a linear-light multiplier. */
function kelvinRatio(kelvin: number): Vec3 {
  const c = kelvinToRgb(kelvin);
  const n = kelvinToRgb(5500);
  return [c.r / n.r, c.g / n.g, c.b / n.b];
}

/** Scale so the luminance of the multiplier is 1 (pure color shift, no brightness change). */
function normalizeLuminance(v: Vec3): Vec3 {
  const y = LR * v[0] + LG * v[1] + LB * v[2];
  return y > 0 ? [v[0] / y, v[1] / y, v[2] / y] : [1, 1, 1];
}

/** White-balance multiplier for an ambient color temperature (identity at 5500 K). */
export function whiteBalanceGains(kelvin: number): Vec3 {
  if (kelvin === 5500) return [1, 1, 1];
  return normalizeLuminance(kelvinRatio(kelvin));
}

/** Linear RGB of a light of `kelvin` with luminance 1. */
export function lightColorLinear(kelvin: number): Vec3 {
  return normalizeLuminance(kelvinRatio(clamp(finite(kelvin, 2700), 1000, 40000)));
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const ONE: Vec3 = [1, 1, 1];

/** Deterministic per-pixel dither in [0, 1) (integer hash of the pixel index). */
function dither(i: number): number {
  let h = Math.imul(i ^ 0x5bd1e995, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return (h & 0xffff) / 65536;
}

/** sRGB 8-bit (as float, dithered) of a linear value, clamped. */
function encode(v: number, d: number): number {
  return Math.floor(linearToSrgb8(v) + d);
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

/** Above this (linear, max channel) the grade rolls highlights off smoothly instead of clipping. */
const GRADE_KNEE = 0.9;

/** Identity below `knee`, then a C1 rational shoulder that approaches 1. */
function shoulder(x: number, knee: number): number {
  if (x <= knee) return x;
  const u = (x - knee) / (1 - knee);
  return knee + ((1 - knee) * u) / (1 + u);
}

function schlickBias(t: number, a: number): number {
  return t / ((1 / a - 2) * (1 - t) + 1);
}

/** Schlick's gain: monotonic S-curve on 0..1 with fixed points 0, 0.5, 1; g = 0.5 is the identity. */
function schlickGain(v: number, g: number): number {
  return v < 0.5 ? schlickBias(2 * v, 1 - g) / 2 : 1 - schlickBias(2 - 2 * v, 1 - g) / 2;
}

const CONTRAST_LUT_SIZE = 1024;

/**
 * Contrast as a luminance multiplier k(Y) = Y'/Y, where Y' applies an S-curve
 * around mid-gray in the perceptual (sRGB-encoded) domain. Sampled on √Y so
 * the shadows are finely resolved. Scaling RGB by k keeps hue and saturation.
 */
function contrastLut(contrast: number): Float32Array {
  const g = 0.5 + 0.2 * contrast;
  const lut = new Float32Array(CONTRAST_LUT_SIZE + 2);
  for (let i = 0; i <= CONTRAST_LUT_SIZE + 1; i++) {
    const s = Math.min(1, i / CONTRAST_LUT_SIZE);
    const y = Math.max(1e-7, s * s);
    const v = linearToSrgb8(y) / 255;
    lut[i] = srgbToLinear(schlickGain(v, g)) / y;
  }
  return lut;
}

/** Everything applyGrade needs, resolved once per call. */
interface GradeParams {
  identity: boolean;
  /** Exposure × white balance per channel (before tint). */
  gain: Vec3;
  hiTint: Vec3;
  shTint: Vec3;
  split: boolean;
  saturation: number;
  contrast: number;
}

function gradeParams(input: LightingSettings): GradeParams {
  const s = sanitize(input);
  const look = lookFor(s.timeOfDay);
  const amb = s.ambient;
  const ev = s.exposure + look.exposure * amb;
  const expo = Math.pow(2, ev);
  const wb = whiteBalanceGains(s.kelvin);
  const hiTint = lerp3(ONE, look.tint, amb);
  const shTint = lerp3(ONE, look.shadowTint ?? look.tint, amb);
  const saturation = clamp(1 + s.saturation + look.saturation * amb, 0, 2.5);
  const contrast = clamp(s.contrast + look.contrast * amb, -1, 1);
  const neutral = (v: Vec3) => v[0] === 1 && v[1] === 1 && v[2] === 1;
  const identity = ev === 0 && neutral(wb) && neutral(hiTint) && neutral(shTint) && saturation === 1 && contrast === 0;
  return {
    identity,
    gain: [expo * wb[0], expo * wb[1], expo * wb[2]],
    hiTint,
    shTint,
    split: hiTint[0] !== shTint[0] || hiTint[1] !== shTint[1] || hiTint[2] !== shTint[2],
    saturation,
    contrast,
  };
}

/**
 * Per-channel multiplier the grade applies to a mid-tone (exposure × white
 * balance × tint). Used to estimate the un-graded surface color when
 * renderLights is not given the pre-grade image.
 */
export function gradeGain(s: LightingSettings): Vec3 {
  const p = gradeParams(s);
  const t = lerp3(p.shTint, p.hiTint, 0.5);
  return [p.gain[0] * t[0], p.gain[1] * t[1], p.gain[2] * t[2]];
}

/** True when applyGrade(img, s) would leave the image untouched. */
export function isIdentityGrade(s: LightingSettings): boolean {
  return gradeParams(s).identity;
}

/** In place. Must be the identity for DEFAULT_LIGHTING (day, 0 EV, 5500 K, no contrast/saturation change). */
export function applyGrade(img: ImageDataLike, s: LightingSettings): void {
  const p = gradeParams(s);
  if (p.identity) return;
  const d = img.data;
  const n = Math.min(d.length >> 2, img.width * img.height);
  const lin = SRGB8_TO_LINEAR;
  const cLut = p.contrast !== 0 ? contrastLut(p.contrast) : null;
  const sat = p.saturation;
  const [gr, gg, gb] = p.gain;
  const [hr, hg, hb] = p.hiTint;
  const [sr, sg, sb] = p.shTint;
  const split = p.split;
  // Without split toning the combined multiplier is constant.
  const mr0 = gr * hr;
  const mg0 = gg * hg;
  const mb0 = gb * hb;

  for (let px = 0, i = 0; px < n; px++, i += 4) {
    let r = lin[d[i]];
    let g = lin[d[i + 1]];
    let b = lin[d[i + 2]];
    let y = LR * r + LG * g + LB * b;

    // Contrast around mid-gray (scene-referred, before the exposure change).
    if (cLut) {
      const sy = Math.sqrt(y) * CONTRAST_LUT_SIZE;
      const j = sy | 0;
      const k = cLut[j] + (cLut[j + 1] - cLut[j]) * (sy - j);
      r *= k;
      g *= k;
      b *= k;
      y *= k;
    }

    // Saturation around luminance (keeps lightness; never pushes a channel below 0).
    if (sat !== 1) {
      let f = sat;
      if (f > 1) {
        const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
        if (mn < y) f = Math.min(f, y / (y - mn));
      }
      r = y + (r - y) * f;
      g = y + (g - y) * f;
      b = y + (b - y) * f;
    }

    // Exposure × white balance × time-of-day tint.
    if (split) {
      const w = smoothstep(0.12, 0.75, Math.sqrt(y));
      r *= gr * (sr + (hr - sr) * w);
      g *= gg * (sg + (hg - sg) * w);
      b *= gb * (sb + (hb - sb) * w);
    } else {
      r *= mr0;
      g *= mg0;
      b *= mb0;
    }

    // Hue-preserving highlight roll-off.
    const m = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (m > GRADE_KNEE) {
      const k = shoulder(m, GRADE_KNEE) / m;
      r *= k;
      g *= k;
      b *= k;
    }

    const dt = dither(px);
    d[i] = encode(r, dt);
    d[i + 1] = encode(g, dt);
    d[i + 2] = encode(b, dt);
  }
}

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

/** Peak reflected light (× surface color) of a light at intensity 1 at night. */
const REFLECT = 1.15;
/** Part of the reflected light independent of the surface's own brightness (keeps dark surfaces visibly lit). */
const RESPONSE_FLOOR = 0.14;
/** Surface brightness → response curve exponent (< 1 lifts dark surfaces and baked-in daylight shadows). */
const RESPONSE_POW = 0.8;
/** Peak of the emissive halo around the emitter (multiplied by lightGain²). */
const HALO = 0.75;
/** Knee of the per-channel shoulder used when adding light. */
const LIGHT_KNEE = 0.72;

/**
 * One evaluated light shape. Radial shapes (`kind` 0) optionally restricted to
 * a soft cone; capsules (`kind` 1) measure the distance to a segment.
 * Falloff: f(q) = (1 − q)^p / (1 + K·q) with q = d² / R² — an inverse-square
 * like hot center windowed to exactly 0 (with zero slope) at R.
 */
interface Prim {
  kind: 0 | 1;
  /** Added as-is (bulb glow, halo) instead of being reflected by the surface. */
  emissive: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cx: number;
  cy: number;
  /** Capsule end. */
  ex: number;
  ey: number;
  R: number;
  invR2: number;
  K: number;
  p: number;
  cone: boolean;
  /** Cone apex and unit axis. */
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  cosIn: number;
  cosOut: number;
  r: number;
  g: number;
  b: number;
}

interface PrimSpec {
  emissive?: boolean;
  x: number;
  y: number;
  /** Capsule end (omit for radial). */
  x2?: number;
  y2?: number;
  R: number;
  K: number;
  p?: number;
  amp: number;
  color: Vec3;
  /** Cone: axis angle (radians, image space: 0 = right, π/2 = down), half-angles, apex pull-back in px. */
  cone?: { angle: number; inner: number; outer: number; back: number };
}

function makePrim(sp: PrimSpec, W: number, H: number): Prim | null {
  const R = sp.R;
  if (!(R > 0.5) || !(sp.amp > 0)) return null;
  const capsule = sp.x2 !== undefined && sp.y2 !== undefined;
  const ex = capsule ? (sp.x2 as number) : sp.x;
  const ey = capsule ? (sp.y2 as number) : sp.y;
  const x0 = Math.max(0, Math.floor(Math.min(sp.x, ex) - R));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(sp.x, ex) + R));
  const y0 = Math.max(0, Math.floor(Math.min(sp.y, ey) - R));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(sp.y, ey) + R));
  if (x0 > x1 || y0 > y1) return null;
  const prim: Prim = {
    kind: capsule ? 1 : 0,
    emissive: !!sp.emissive,
    x0,
    x1,
    y0,
    y1,
    cx: sp.x,
    cy: sp.y,
    ex,
    ey,
    R,
    invR2: 1 / (R * R),
    K: sp.K,
    p: sp.p ?? 2,
    cone: false,
    ax: 0,
    ay: 0,
    dx: 0,
    dy: 0,
    cosIn: 1,
    cosOut: 1,
    r: sp.color[0] * sp.amp,
    g: sp.color[1] * sp.amp,
    b: sp.color[2] * sp.amp,
  };
  if (sp.cone && !capsule) {
    const { angle, inner, outer, back } = sp.cone;
    prim.cone = true;
    prim.dx = Math.cos(angle);
    prim.dy = Math.sin(angle);
    prim.ax = sp.x - prim.dx * back;
    prim.ay = sp.y - prim.dy * back;
    prim.cosIn = Math.cos(Math.min(inner, outer - 1e-3));
    prim.cosOut = Math.cos(outer);
  }
  return prim;
}

/** Endpoint of a strip / string light (falls back to a short horizontal run). */
export function lightEndPoint(l: PlacedLight): { x: number; y: number } {
  if (Number.isFinite(l.x2) && Number.isFinite(l.y2)) return { x: l.x2 as number, y: l.y2 as number };
  return { x: l.x + Math.max(40, l.radius * 0.8), y: l.y };
}

/** Sag of a string light's catenary (px): ~10% of the span. */
export function stringSag(l: PlacedLight): number {
  const e = lightEndPoint(l);
  return Math.hypot(e.x - l.x, e.y - l.y) * 0.1;
}

/** Point at t ∈ [0, 1] along a string light's sagging wire (parabolic catenary approximation). */
export function stringPoint(l: PlacedLight, t: number): { x: number; y: number } {
  const e = lightEndPoint(l);
  const sag = stringSag(l);
  return { x: l.x + (e.x - l.x) * t, y: l.y + (e.y - l.y) * t + 4 * sag * t * (1 - t) };
}

/**
 * Bulb positions of a string light: evenly spaced along the wire (none at the
 * mounting ends), roughly half a fixture size apart.
 */
export function stringBulbs(l: PlacedLight): { x: number; y: number }[] {
  const e = lightEndPoint(l);
  const span = Math.hypot(e.x - l.x, e.y - l.y);
  const spacing = Math.max(10, finite(l.fixtureSize, 40) * 0.45);
  const n = clamp(Math.round(span / spacing), 2, 80);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) out.push(stringPoint(l, (i + 0.5) / n));
  return out;
}

/** Radius of a string light's bulb glass in px (shared with the compositor's wire drawing). */
export function stringBulbRadius(l: PlacedLight): number {
  return clamp(finite(l.fixtureSize, 40) * 0.07, 1.5, 24);
}

const DEG = Math.PI / 180;

/** Decomposes one light into falloff primitives (pools, cones, halos). */
function lightPrims(l: PlacedLight, gain: number, W: number, H: number): Prim[] {
  const R = finite(l.radius, 0);
  const intensity = clamp(finite(l.intensity, 1), 0, 4);
  if (!(R > 0) || !(intensity > 0) || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return [];
  const color = lightColorLinear(l.kelvin);
  const reflect = REFLECT * intensity * gain;
  const halo = HALO * intensity * gain * gain;
  const fx = clamp(finite(l.fixtureSize, R * 0.25), 2, R);
  const haloR = clamp(fx * 0.4, 3, R * 0.35);
  const specs: PrimSpec[] = [];
  const { x, y } = l;

  switch (l.beam) {
    case 'down':
    case 'up': {
      const angle = l.beam === 'down' ? Math.PI / 2 : -Math.PI / 2;
      specs.push({ x, y, R, K: 3.5, amp: reflect, color, cone: { angle, inner: 14 * DEG, outer: 48 * DEG, back: R * 0.07 } });
      specs.push({ x, y, R: R * 0.4, K: 6, amp: reflect * 0.22, color });
      specs.push({ emissive: true, x, y, R: haloR, K: 10, p: 3, amp: halo, color });
      break;
    }
    case 'spot': {
      const angle = finite(l.angle, 90) * DEG;
      const half = clamp(finite(l.spread, 40), 4, 170) * 0.5 * DEG;
      specs.push({
        x,
        y,
        R,
        K: 2.5,
        amp: reflect * 1.1,
        color,
        cone: { angle, inner: half * 0.45, outer: Math.min(Math.PI * 0.98, half * 1.3), back: R * 0.05 },
      });
      specs.push({ x, y, R: R * 0.28, K: 6, amp: reflect * 0.18, color });
      specs.push({ emissive: true, x, y, R: haloR, K: 10, p: 3, amp: halo, color });
      break;
    }
    case 'strip': {
      const e = lightEndPoint(l);
      const core = clamp(fx * 0.08, 1.2, R * 0.1);
      specs.push({ x, y, x2: e.x, y2: e.y, R, K: 5, amp: reflect * 0.85, color });
      specs.push({ emissive: true, x, y, x2: e.x, y2: e.y, R: core * 5, K: 14, p: 3, amp: halo * 0.8, color });
      specs.push({ emissive: true, x, y, x2: e.x, y2: e.y, R: core, K: 0, p: 2, amp: halo * 1.3, color });
      break;
    }
    case 'string': {
      const bulbs = stringBulbs(l);
      const e = lightEndPoint(l);
      const span = Math.hypot(e.x - x, e.y - y);
      const spacing = span / Math.max(1, bulbs.length);
      const poolR = Math.max(R * 0.55, spacing * 1.5);
      // Pools overlap along the wire; scale so their sum peaks near 0.55 × a single light.
      const poolAmp = (reflect * 0.55 * spacing) / (poolR * POOL_LINE_INTEGRAL_K5);
      const br = stringBulbRadius(l);
      for (const p of bulbs) {
        specs.push({ x: p.x, y: p.y, R: poolR, K: 5, amp: poolAmp, color });
        specs.push({ emissive: true, x: p.x, y: p.y + br, R: br * 5, K: 12, p: 3, amp: halo * 0.7, color });
        specs.push({ emissive: true, x: p.x, y: p.y + br, R: br * 1.15, K: 0, p: 2, amp: 0.6 + halo * 1.4, color });
      }
      break;
    }
    case 'omni':
    default: {
      specs.push({ x, y, R, K: 6, amp: reflect, color });
      specs.push({ emissive: true, x, y, R: haloR, K: 10, p: 3, amp: halo, color });
      break;
    }
  }
  const out: Prim[] = [];
  for (const sp of specs) {
    const p = makePrim(sp, W, H);
    if (p) out.push(p);
  }
  return out;
}

/** ∫_{-1}^{1} (1 − u²)² / (1 + 5u²) du — the line integral of a K = 5 pool, for string normalization. */
const POOL_LINE_INTEGRAL_K5 = (() => {
  let s = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const u = -1 + (2 * (i + 0.5)) / N;
    const q = u * u;
    s += ((1 - q) * (1 - q)) / (1 + 5 * q);
  }
  return (s * 2) / N;
})();

/** Accumulates one primitive's contribution over row `y` into `acc` (3 floats per pixel). Returns [minX, maxX] touched. */
function accumulateRow(pr: Prim, y: number, acc: Float32Array, span: Int32Array): void {
  const py = y + 0.5;
  let xs = pr.x0;
  let xe = pr.x1;
  if (pr.kind === 0) {
    const dy = py - pr.cy;
    const h2 = pr.R * pr.R - dy * dy;
    if (h2 <= 0) return;
    const h = Math.sqrt(h2);
    xs = Math.max(xs, Math.floor(pr.cx - h - 0.5));
    xe = Math.min(xe, Math.ceil(pr.cx + h - 0.5));
  }
  if (xs > xe) return;
  if (xs < span[0]) span[0] = xs;
  if (xe > span[1]) span[1] = xe;
  const { invR2, K, p, r, g, b } = pr;
  const segX = pr.ex - pr.cx;
  const segY = pr.ey - pr.cy;
  const segL2 = segX * segX + segY * segY;
  for (let x = xs; x <= xe; x++) {
    const px = x + 0.5;
    let dx: number;
    let dy: number;
    if (pr.kind === 1 && segL2 > 0) {
      let t = ((px - pr.cx) * segX + (py - pr.cy) * segY) / segL2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      dx = px - (pr.cx + segX * t);
      dy = py - (pr.cy + segY * t);
    } else {
      dx = px - pr.cx;
      dy = py - pr.cy;
    }
    const q = (dx * dx + dy * dy) * invR2;
    if (q >= 1) continue;
    const w = 1 - q;
    let f = (p === 3 ? w * w * w : w * w) / (1 + K * q);
    if (pr.cone) {
      const vx = px - pr.ax;
      const vy = py - pr.ay;
      const len = Math.sqrt(vx * vx + vy * vy);
      if (len > 1e-6) {
        const c = (vx * pr.dx + vy * pr.dy) / len;
        if (c <= pr.cosOut) continue;
        if (c < pr.cosIn) {
          const t = (c - pr.cosOut) / (pr.cosIn - pr.cosOut);
          f *= t * t * (3 - 2 * t);
        }
      }
    }
    const j = x * 3;
    acc[j] += f * r;
    acc[j + 1] += f * g;
    acc[j + 2] += f * b;
  }
}

/** Per-8-bit-value surface response (reflectance proxy) for one channel. */
function responseLut(channelGain: number): Float32Array {
  const lut = new Float32Array(256);
  const inv = channelGain > 0 ? 1 / channelGain : 1;
  for (let v = 0; v < 256; v++) {
    const alb = Math.min(1, SRGB8_TO_LINEAR[v] * inv);
    lut[v] = RESPONSE_FLOOR + (1 - RESPONSE_FLOOR) * Math.pow(alb, RESPONSE_POW);
  }
  return lut;
}

/** Adds `add` to `base` through the shoulder so increments compress near white; add = 0 returns base exactly. */
function addLight(base: number, add: number): number {
  const sum = base + add;
  if (sum <= LIGHT_KNEE) return sum;
  const out = base + shoulder(sum, LIGHT_KNEE) - shoulder(base, LIGHT_KNEE);
  return out > 1 ? 1 : out;
}

let rowBuffers: { illum: Float32Array; emit: Float32Array } | null = null;

function rowAccumulators(width: number): { illum: Float32Array; emit: Float32Array } {
  if (!rowBuffers || rowBuffers.illum.length < width * 3) {
    rowBuffers = { illum: new Float32Array(width * 3), emit: new Float32Array(width * 3) };
  }
  return rowBuffers;
}

/**
 * In place, additive ("screen"-like, never darkens). Lights with on = false are
 * skipped. Falloff is smooth (no hard rim) and fades to 0 at `radius`.
 *
 * Light that lands on a surface is modulated by that surface's color (a lit
 * white wall glows, a dark mulch bed barely does), estimated from `albedo` —
 * the pre-grade image, when the caller has it — or from `img` by undoing the
 * grade's color multipliers. Emissive halos around bulbs are added as-is.
 * Additions pass a per-channel filmic shoulder so overlapping pools burn
 * smoothly toward warm white instead of clipping.
 */
export function renderLights(img: ImageDataLike, lights: PlacedLight[], s: LightingSettings, albedo?: ImageDataLike): void {
  const W = img.width;
  const H = img.height;
  if (!(W > 0) || !(H > 0) || !lights?.length) return;
  const gain = lightGain(sanitize(s).timeOfDay);
  const prims: Prim[] = [];
  for (const l of lights) {
    if (!l || !l.on) continue;
    for (const p of lightPrims(l, gain, W, H)) prims.push(p);
  }
  if (!prims.length) return;

  const useAlbedo = !!albedo && albedo.width === W && albedo.height === H;
  const src = useAlbedo ? (albedo as ImageDataLike).data : img.data;
  const g0 = useAlbedo ? ONE : gradeGain(s);
  const respR = responseLut(g0[0]);
  const respG = responseLut(g0[1]);
  const respB = responseLut(g0[2]);

  let yMin = H;
  let yMax = -1;
  for (const p of prims) {
    if (p.y0 < yMin) yMin = p.y0;
    if (p.y1 > yMax) yMax = p.y1;
  }
  prims.sort((a, b) => a.y0 - b.y0);

  const { illum, emit } = rowAccumulators(W);
  const spanI = new Int32Array(2);
  const spanE = new Int32Array(2);
  const d = img.data;
  const lin = SRGB8_TO_LINEAR;
  const active: Prim[] = [];
  let next = 0;

  for (let y = yMin; y <= yMax; y++) {
    while (next < prims.length && prims[next].y0 <= y) active.push(prims[next++]);
    spanI[0] = W;
    spanI[1] = -1;
    spanE[0] = W;
    spanE[1] = -1;
    for (let k = active.length - 1; k >= 0; k--) {
      const p = active[k];
      if (p.y1 < y) {
        active.splice(k, 1);
        continue;
      }
      if (p.emissive) accumulateRow(p, y, emit, spanE);
      else accumulateRow(p, y, illum, spanI);
    }
    const xs = Math.min(spanI[0], spanE[0]);
    const xe = Math.max(spanI[1], spanE[1]);
    if (xs > xe) continue;
    const row = y * W;
    for (let x = xs; x <= xe; x++) {
      const j = x * 3;
      const ir = illum[j];
      const ig = illum[j + 1];
      const ib = illum[j + 2];
      const er = emit[j];
      const eg = emit[j + 1];
      const eb = emit[j + 2];
      if (ir + ig + ib + er + eg + eb <= 0) continue;
      illum[j] = illum[j + 1] = illum[j + 2] = 0;
      emit[j] = emit[j + 1] = emit[j + 2] = 0;
      const i = (row + x) * 4;
      const ar = respR[src[i]];
      const ag = respG[src[i + 1]];
      const ab = respB[src[i + 2]];
      const r = addLight(lin[d[i]], ir * ar + er);
      const g = addLight(lin[d[i + 1]], ig * ag + eg);
      const b = addLight(lin[d[i + 2]], ib * ab + eb);
      const dt = dither(row + x);
      // Never darker than before (dither could otherwise round a tiny addition down).
      const nr = encode(r, dt);
      const ng = encode(g, dt);
      const nb = encode(b, dt);
      if (nr > d[i]) d[i] = nr;
      if (ng > d[i + 1]) d[i + 1] = ng;
      if (nb > d[i + 2]) d[i + 2] = nb;
    }
  }
}
