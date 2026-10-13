/**
 * Color math: hex/RGB/HSL/Lab conversions, perceptual distance, color temperature.
 * Pure functions, no DOM. sRGB D65.
 */
import type { ColorFamily } from '../../shared/types';
import type { ImageDataLike, Lab, Mask, RGB } from './types';

/** '#ABC', 'abc', '#aabbcc', 'AABBCC' -> '#aabbcc'; anything else -> null. */
export declare function normalizeHex(input: string): string | null;
export declare function isValidHex(input: string): boolean;
/** Throws on invalid input. */
export declare function hexToRgb(hex: string): RGB;
/** Rounds and clamps channels; lowercase '#rrggbb'. */
export declare function rgbToHex(c: RGB): string;
/** 0..1 -> 0..1 */
export declare function srgbToLinear(v: number): number;
export declare function linearToSrgb(v: number): number;
export declare function rgbToLab(c: RGB): Lab;
/** Clamped to the sRGB gamut. */
export declare function labToRgb(lab: Lab): RGB;
export declare function hexToLab(hex: string): Lab;
/** CIEDE2000 color difference. */
export declare function deltaE(a: Lab, b: Lab): number;
/** CIE76 (euclidean Lab) — cheap, used in hot pixel loops. */
export declare function deltaE76(a: Lab, b: Lab): number;
/** WCAG relative luminance 0..1. */
export declare function relativeLuminance(c: RGB): number;
/** Paint industry Light Reflectance Value 0..100. */
export declare function lrv(hex: string): number;
/** Approximate RGB of a black body at `kelvin` (1000..40000), max channel 255. */
export declare function kelvinToRgb(kelvin: number): RGB;
/** Linear blend in sRGB space, t 0..1. */
export declare function mixHex(a: string, b: string, t: number): string;
/** Black or white, whichever reads better on `bgHex`. */
export declare function textColorOn(bgHex: string): '#000000' | '#ffffff';
/** h 0..360, s/l 0..1 */
export declare function rgbToHsl(c: RGB): { h: number; s: number; l: number };
export declare function hslToRgb(h: number, s: number, l: number): RGB;
/** Best-guess family for filtering/grouping. */
export declare function colorFamilyOf(hex: string): ColorFamily;
/** Average color of an image region (mask > 127) or of the whole image when mask is omitted. */
export declare function averageColor(img: ImageDataLike, mask?: Mask): RGB;
