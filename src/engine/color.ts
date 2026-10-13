/**
 * Color math: hex/RGB/HSL/Lab conversions, perceptual distance, color temperature.
 * Pure functions, no DOM. sRGB D65.
 *
 * Besides the public API there are a few allocation-free helpers
 * (`SRGB8_TO_LINEAR`, `rgb8ToLabInto`, `labToSrgb8Into`, …) meant for the
 * engine's per-pixel loops; they share the exact constants of the public
 * conversions so results agree.
 */
import type { ColorFamily } from '../../shared/types';
import type { ImageDataLike, Lab, Mask, RGB } from './types';

// ---------------------------------------------------------------------------
// Constants (sRGB primaries, D65 white — IEC 61966-2-1 / Lindbloom)
// ---------------------------------------------------------------------------

const M_RX = 0.4124564, M_RY = 0.3575761, M_RZ = 0.1804375;
const M_GX = 0.2126729, M_GY = 0.7151522, M_GZ = 0.072175;
const M_BX = 0.0193339, M_BY = 0.119192, M_BZ = 0.9503041;

const I_XR = 3.2404542, I_XG = -1.5371385, I_XB = -0.4985314;
const I_YR = -0.969266, I_YG = 1.8760108, I_YB = 0.041556;
const I_ZR = 0.0556434, I_ZG = -0.2040259, I_ZB = 1.0572252;

/** Reference white = XYZ of sRGB white, so '#ffffff' maps to exactly a = b = 0. */
const XN = M_RX + M_RY + M_RZ;
const YN = M_GX + M_GY + M_GZ;
const ZN = M_BX + M_BY + M_BZ;

const LAB_EPS = 216 / 24389; // 0.008856…
const LAB_KAPPA = 24389 / 27; // 903.296…

// ---------------------------------------------------------------------------
// Hex
// ---------------------------------------------------------------------------

const HEX3 = /^[0-9a-f]{3}$/;
const HEX6 = /^[0-9a-f]{6}$/;

/** '#ABC', 'abc', '#aabbcc', 'AABBCC' -> '#aabbcc'; anything else -> null. */
export function normalizeHex(input: string): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (HEX6.test(s)) return `#${s}`;
  if (HEX3.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  return null;
}

export function isValidHex(input: string): boolean {
  return normalizeHex(input) !== null;
}

/** Throws on invalid input. */
export function hexToRgb(hex: string): RGB {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`Invalid hex color: ${JSON.stringify(hex)}`);
  const v = parseInt(n.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/** Lenient parse used by helpers that should never throw in UI code: invalid -> black. */
function parseHexOrBlack(hex: string): RGB {
  const n = normalizeHex(hex);
  if (!n) return { r: 0, g: 0, b: 0 };
  const v = parseInt(n.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function clampByte(v: number): number {
  if (!(v > 0)) return 0; // also maps NaN to 0
  if (v > 255) return 255;
  return Math.round(v);
}

/** Rounds and clamps channels; lowercase '#rrggbb'. */
export function rgbToHex(c: RGB): string {
  const v = (clampByte(c.r) << 16) | (clampByte(c.g) << 8) | clampByte(c.b);
  return `#${v.toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Transfer functions
// ---------------------------------------------------------------------------

/** 0..1 -> 0..1 */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Linear-light value (0..1) of every 8-bit sRGB code value. */
export const SRGB8_TO_LINEAR: Float64Array = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i / 255);
  return t;
})();

const LIN_LUT_SIZE = 4096;
/** linear 0..1 (sampled at LIN_LUT_SIZE + 1 points) -> sRGB 0..255 float. */
const LINEAR_TO_SRGB8_LUT: Float64Array = (() => {
  const t = new Float64Array(LIN_LUT_SIZE + 2);
  for (let i = 0; i <= LIN_LUT_SIZE + 1; i++) t[i] = 255 * linearToSrgb(Math.min(1, i / LIN_LUT_SIZE));
  return t;
})();

/**
 * Fast linear (0..1, clamped) -> sRGB 0..255 (float, unrounded) via an
 * interpolated lookup table. Max error ≈ 0.005 code values.
 */
export function linearToSrgb8(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 1) return 255;
  const x = v * LIN_LUT_SIZE;
  const i = x | 0;
  const f = x - i;
  return LINEAR_TO_SRGB8_LUT[i] + (LINEAR_TO_SRGB8_LUT[i + 1] - LINEAR_TO_SRGB8_LUT[i]) * f;
}

// ---------------------------------------------------------------------------
// Lab
// ---------------------------------------------------------------------------

function labF(t: number): number {
  return t > LAB_EPS ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;
}

function labFInv(f: number): number {
  const f3 = f * f * f;
  return f3 > LAB_EPS ? f3 : (116 * f - 16) / LAB_KAPPA;
}

/** Lab from linear-light RGB (0..1). */
function linearToLab(r: number, g: number, b: number): Lab {
  const fx = labF((M_RX * r + M_RY * g + M_RZ * b) / XN);
  const fy = labF((M_GX * r + M_GY * g + M_GZ * b) / YN);
  const fz = labF((M_BX * r + M_BY * g + M_BZ * b) / ZN);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const LABF_LUT_SIZE = 4096;
/** Lab f(t) sampled on t ∈ [0, 1]; Math.cbrt is ~5× slower than an interpolated lookup. */
const LABF_LUT: Float64Array = (() => {
  const t = new Float64Array(LABF_LUT_SIZE + 2);
  for (let i = 0; i <= LABF_LUT_SIZE + 1; i++) t[i] = labF(Math.min(1, i / LABF_LUT_SIZE));
  return t;
})();

// RGB(linear) -> white-normalized XYZ, pre-scaled to LUT index units.
const KX_R = (M_RX / XN) * LABF_LUT_SIZE, KX_G = (M_RY / XN) * LABF_LUT_SIZE, KX_B = (M_RZ / XN) * LABF_LUT_SIZE;
const KY_R = (M_GX / YN) * LABF_LUT_SIZE, KY_G = (M_GY / YN) * LABF_LUT_SIZE, KY_B = (M_GZ / YN) * LABF_LUT_SIZE;
const KZ_R = (M_BX / ZN) * LABF_LUT_SIZE, KZ_G = (M_BY / ZN) * LABF_LUT_SIZE, KZ_B = (M_BZ / ZN) * LABF_LUT_SIZE;
const LABF_MAX_INDEX = LABF_LUT_SIZE - 1;

/**
 * 8-bit sRGB -> Lab written into `out[o..o+2]` (L, a, b). Allocation free and
 * table driven (agrees with rgbToLab to ~0.001); used by the per-pixel loops
 * (paint, region stats). Branch-free on purpose: noisy photo pixels make
 * data-dependent branches mispredict.
 */
export function rgb8ToLabInto(r: number, g: number, b: number, out: Float32Array | Float64Array, o: number): void {
  const lut = LABF_LUT;
  const lr = SRGB8_TO_LINEAR[r], lg = SRGB8_TO_LINEAR[g], lb = SRGB8_TO_LINEAR[b];
  const x = KX_R * lr + KX_G * lg + KX_B * lb;
  const y = KY_R * lr + KY_G * lg + KY_B * lb;
  const z = KZ_R * lr + KZ_G * lg + KZ_B * lb;
  const kx = Math.min(LABF_MAX_INDEX, x | 0);
  const ky = Math.min(LABF_MAX_INDEX, y | 0);
  const kz = Math.min(LABF_MAX_INDEX, z | 0);
  const fx = lut[kx] + (lut[kx + 1] - lut[kx]) * (x - kx);
  const fy = lut[ky] + (lut[ky + 1] - lut[ky]) * (y - ky);
  const fz = lut[kz] + (lut[kz + 1] - lut[kz]) * (z - kz);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

/**
 * Converts `count` RGBA pixels of `src` to Lab triples in `out` (length ≥ 3·count).
 * Same math as rgb8ToLabInto, inlined for whole images (~50 ms for 2.6 MP).
 */
export function rgbaToLabArray(src: Uint8ClampedArray | Uint8Array, out: Float32Array, count: number): void {
  const lin = SRGB8_TO_LINEAR;
  const lut = LABF_LUT;
  // Module constants copied into locals: keeps them in registers in the hot loop.
  const xr = KX_R, xg = KX_G, xb = KX_B;
  const yr = KY_R, yg = KY_G, yb = KY_B;
  const zr = KZ_R, zg = KZ_G, zb = KZ_B;
  const maxK = LABF_MAX_INDEX;
  for (let i = 0, p = 0, o = 0; i < count; i++, p += 4, o += 3) {
    const lr = lin[src[p]], lg = lin[src[p + 1]], lb = lin[src[p + 2]];
    const x = xr * lr + xg * lg + xb * lb;
    const y = yr * lr + yg * lg + yb * lb;
    const z = zr * lr + zg * lg + zb * lb;
    const kx = Math.min(maxK, x | 0);
    const ky = Math.min(maxK, y | 0);
    const kz = Math.min(maxK, z | 0);
    const fx = lut[kx] + (lut[kx + 1] - lut[kx]) * (x - kx);
    const fy = lut[ky] + (lut[ky + 1] - lut[ky]) * (y - ky);
    const fz = lut[kz] + (lut[kz + 1] - lut[kz]) * (z - kz);
    out[o] = 116 * fy - 16;
    out[o + 1] = 500 * (fx - fy);
    out[o + 2] = 200 * (fy - fz);
  }
}

/**
 * Lab -> sRGB 0..255 floats (unrounded, clipped per channel in linear light)
 * written into `out[o..o+2]`. Allocation free.
 */
export function labToSrgb8Into(l: number, a: number, b: number, out: Float32Array | Float64Array, o: number): void {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = XN * labFInv(fx);
  const y = YN * (l > LAB_KAPPA * LAB_EPS ? fy * fy * fy : l / LAB_KAPPA);
  const z = ZN * labFInv(fz);
  out[o] = linearToSrgb8(I_XR * x + I_XG * y + I_XB * z);
  out[o + 1] = linearToSrgb8(I_YR * x + I_YG * y + I_YB * z);
  out[o + 2] = linearToSrgb8(I_ZR * x + I_ZG * y + I_ZB * z);
}

function channel01(v: number): number {
  if (!(v > 0)) return 0;
  return v >= 255 ? 1 : v / 255;
}

export function rgbToLab(c: RGB): Lab {
  return linearToLab(srgbToLinear(channel01(c.r)), srgbToLinear(channel01(c.g)), srgbToLinear(channel01(c.b)));
}

/** Like labToRgb but unrounded (0..255 floats), still clipped to the sRGB gamut. */
export function labToRgbFloat(lab: Lab): RGB {
  const l = Number.isFinite(lab.l) ? lab.l : 0;
  const a = Number.isFinite(lab.a) ? lab.a : 0;
  const b = Number.isFinite(lab.b) ? lab.b : 0;
  const fy = (l + 16) / 116;
  const x = XN * labFInv(fy + a / 500);
  const y = YN * (l > LAB_KAPPA * LAB_EPS ? fy * fy * fy : l / LAB_KAPPA);
  const z = ZN * labFInv(fy - b / 200);
  const conv = (v: number) => 255 * linearToSrgb(Math.min(1, Math.max(0, v)));
  return {
    r: conv(I_XR * x + I_XG * y + I_XB * z),
    g: conv(I_YR * x + I_YG * y + I_YB * z),
    b: conv(I_ZR * x + I_ZG * y + I_ZB * z),
  };
}

/** Clamped to the sRGB gamut. */
export function labToRgb(lab: Lab): RGB {
  const c = labToRgbFloat(lab);
  return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
}

/** Throws on invalid hex (like hexToRgb). */
export function hexToLab(hex: string): Lab {
  return rgbToLab(hexToRgb(hex));
}

// ---------------------------------------------------------------------------
// Color difference
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
const POW25_7 = Math.pow(25, 7);

/** CIEDE2000 color difference (kL = kC = kH = 1), per Sharma, Wu & Dalal (2005). */
export function deltaE(x: Lab, y: Lab): number {
  const L1 = x.l, a1 = x.a, b1 = x.b;
  const L2 = y.l, a2 = y.a, b2 = y.b;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const hueDeg = (b: number, ap: number) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / DEG;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hueDeg(b1, a1p);
  const h2p = hueDeg(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const cProd = C1p * C2p;
  let dhp = 0;
  if (cProd !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(cProd) * Math.sin((dhp * DEG) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (cProd === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * DEG) +
    0.24 * Math.cos(2 * hbarp * DEG) +
    0.32 * Math.cos((3 * hbarp + 6) * DEG) -
    0.2 * Math.cos((4 * hbarp - 63) * DEG);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + POW25_7));
  const l50 = (Lbarp - 50) * (Lbarp - 50);
  const SL = 1 + (0.015 * l50) / Math.sqrt(20 + l50);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * DEG) * RC;

  const tl = dLp / SL;
  const tc = dCp / SC;
  const th = dHp / SH;
  return Math.sqrt(Math.max(0, tl * tl + tc * tc + th * th + RT * tc * th));
}

/** CIE76 (euclidean Lab) — cheap, used in hot pixel loops. */
export function deltaE76(a: Lab, b: Lab): number {
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

// ---------------------------------------------------------------------------
// Luminance
// ---------------------------------------------------------------------------

/** WCAG relative luminance 0..1. */
export function relativeLuminance(c: RGB): number {
  return (
    M_GX * srgbToLinear(channel01(c.r)) + M_GY * srgbToLinear(channel01(c.g)) + M_GZ * srgbToLinear(channel01(c.b))
  );
}

/**
 * Paint industry Light Reflectance Value 0..100 (≈ CIE Y × 100), rounded to
 * one decimal. Invalid hex reads as black (0).
 */
export function lrv(hex: string): number {
  const y = relativeLuminance(parseHexOrBlack(hex));
  return Math.round(Math.min(1, Math.max(0, y)) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Color temperature
// ---------------------------------------------------------------------------

/** Tanner Helland's black-body fit, unclamped branches (t = kelvin / 100). */
function hellandLow(t: number): [number, number, number] {
  const g = 99.4708025861 * Math.log(t) - 161.1195681661;
  const b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [255, g, b];
}
function hellandHigh(t: number): [number, number, number] {
  const r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  return [r, g, 255];
}

/**
 * Approximate RGB of a black body at `kelvin` (1000..40000), max channel 255.
 *
 * Tanner Helland's curve fit, made smooth: the two branches are blended with
 * a smoothstep across 6300–6900 K (the original has a visible jump at
 * 6600 K), channels are clamped and then rescaled so the brightest channel is
 * exactly 255. Values are unrounded floats so kelvin sliders change smoothly.
 * Non-finite input is treated as 6500 K.
 */
export function kelvinToRgb(kelvin: number): RGB {
  const k = Number.isFinite(kelvin) ? Math.min(40000, Math.max(1000, kelvin)) : 6500;
  const t = k / 100;
  const lo0 = 63;
  const hi0 = 69;
  let c: [number, number, number];
  if (t <= lo0) c = hellandLow(t);
  else if (t >= hi0) c = hellandHigh(t);
  else {
    const lo = hellandLow(t).map((v) => Math.min(255, Math.max(0, v)));
    const hi = hellandHigh(t).map((v) => Math.min(255, Math.max(0, v)));
    const u = (t - lo0) / (hi0 - lo0);
    const s = u * u * (3 - 2 * u);
    c = [lo[0] + (hi[0] - lo[0]) * s, lo[1] + (hi[1] - lo[1]) * s, lo[2] + (hi[2] - lo[2]) * s];
  }
  const r = Math.min(255, Math.max(0, c[0]));
  const g = Math.min(255, Math.max(0, c[1]));
  const b = Math.min(255, Math.max(0, c[2]));
  const m = Math.max(r, g, b);
  const scale = m > 0 ? 255 / m : 1;
  return { r: r * scale, g: g * scale, b: b * scale };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/** Linear blend in sRGB space, t 0..1. Invalid hex reads as black. */
export function mixHex(a: string, b: string, t: number): string {
  const u = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const x = parseHexOrBlack(a);
  const y = parseHexOrBlack(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * u, g: x.g + (y.g - x.g) * u, b: x.b + (y.b - x.b) * u });
}

/** Black or white, whichever reads better on `bgHex` (higher WCAG contrast). */
export function textColorOn(bgHex: string): '#000000' | '#ffffff' {
  const y = relativeLuminance(parseHexOrBlack(bgHex));
  const onBlack = (y + 0.05) / 0.05;
  const onWhite = 1.05 / (y + 0.05);
  return onBlack >= onWhite ? '#000000' : '#ffffff';
}

/** h 0..360, s/l 0..1 */
export function rgbToHsl(c: RGB): { h: number; s: number; l: number } {
  const r = channel01(c.r);
  const g = channel01(c.g);
  const b = channel01(c.b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: Math.min(1, s), l };
}

/** h in degrees (any value, wrapped), s/l 0..1 (clamped). Rounded channels. */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const hh = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
  const ss = Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 0;
  const ll = Number.isFinite(l) ? Math.min(1, Math.max(0, l)) : 0;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const hp = hh / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ll - c / 2;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/**
 * Best-guess family for filtering/grouping.
 *
 * Lightness and chroma come from CIE Lab (perceptual); the hue name comes from
 * the HSL hue angle, which lines up with everyday color names better than the
 * Lab hue (Lab puts pure blue and medium purple at the same angle).
 * - near-neutral colors: white / black by lightness; warm-tinted ones are
 *   "neutral" (greige, taupe), the rest "gray";
 * - low-chroma warm hues: "beige" when light, "brown" when dark (dark oranges
 *   and ochres are brown too);
 * - otherwise by hue, with light reds and magentas reading as "pink".
 * Invalid hex reads as black.
 */
export function colorFamilyOf(hex: string): ColorFamily {
  const rgb = parseHexOrBlack(hex);
  const lab = rgbToLab(rgb);
  const L = lab.l;
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  const labHue = C > 0 ? ((Math.atan2(lab.b, lab.a) / DEG) + 360) % 360 : 0;
  const hue = rgbToHsl(rgb).h;
  // Chroma relative to lightness (≈ saturation): dark colors carry less chroma.
  const rel = C / (L + 16);
  const warmLab = labHue >= 20 && labHue <= 120;

  // Whites (warm off-whites tolerate more tint than cool ones) and blacks.
  if (L >= 90 && C < (warmLab ? 12 : 7)) return 'white';
  if (L < 12 || (L < 23 && rel < 0.3)) return 'black';

  // Near-neutrals: greige / taupe vs true and cool grays.
  if (C < Math.max(3, Math.min(9, 0.12 * (L + 16)))) return warmLab && C >= 2 ? 'neutral' : 'gray';

  // Muted or dark warm hues: beige / brown (and dark yellows read as olive).
  if (hue >= 15 && hue < 75) {
    if (L < 55 && C < 65) {
      if (hue < 50) return 'brown';
      return hue >= 52 ? 'green' : 'brown';
    }
    if (L >= 55 && C < 25 && hue < 66) return 'beige';
    if (L >= 72 && C < 40 && hue >= 25 && hue < 50) return 'beige';
  }

  if (hue >= 345 || hue < 12) return L >= 65 ? 'pink' : 'red';
  if (hue < 40) return L >= 75 && C < 45 && hue < 25 ? 'pink' : 'orange';
  if (hue < 66) return 'yellow';
  if (hue < 170) return 'green';
  if (hue < 245) return 'blue';
  if (hue < 295) return 'purple';
  // 295..345: magenta / fuchsia / plum.
  return L < 40 ? 'purple' : 'pink';
}

/**
 * Average color of an image region (mask > 127) or of the whole image when
 * mask is omitted. Rounded channels; black when nothing is covered.
 */
export function averageColor(img: ImageDataLike, mask?: Mask): RGB {
  const { width, height, data } = img;
  let sr = 0, sg = 0, sb = 0, n = 0;
  if (!mask) {
    const len = width * height * 4;
    for (let i = 0; i < len; i += 4) {
      sr += data[i];
      sg += data[i + 1];
      sb += data[i + 2];
    }
    n = width * height;
  } else {
    const w = Math.min(width, mask.width);
    const h = Math.min(height, mask.height);
    const md = mask.data;
    for (let y = 0; y < h; y++) {
      const mRow = y * mask.width;
      const iRow = y * width;
      for (let x = 0; x < w; x++) {
        if (md[mRow + x] > 127) {
          const p = (iRow + x) * 4;
          sr += data[p];
          sg += data[p + 1];
          sb += data[p + 2];
          n++;
        }
      }
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) };
}
