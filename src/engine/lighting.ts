/**
 * Lighting simulation on a composited image:
 * 1. applyGrade — global exposure / white balance / contrast / saturation and a
 *    time-of-day look (golden hour, dusk, night) whose strength is `ambient`.
 * 2. renderLights — additive glows for placed lights (omni / down / up / spot /
 *    strip / string) tinted by color temperature. Glows matter little in
 *    daylight and dominate at night (scaled by lightGain(timeOfDay)).
 * Pure ImageData operations, in place.
 */
import type { LightingSettings, PlacedLight, TimeOfDay } from '../../shared/types';
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
}

export declare const TIME_OF_DAY_LOOKS: Record<TimeOfDay, TimeOfDayLook>;

/** How visible artificial lights are at a time of day (day ≈ 0.2 … night = 1). */
export declare function lightGain(t: TimeOfDay): number;

/** In place. Must be the identity for DEFAULT_LIGHTING (day, 0 EV, 5500 K, no contrast/saturation change). */
export declare function applyGrade(img: ImageDataLike, s: LightingSettings): void;

/**
 * In place, additive ("screen"-like, never darkens). Lights with on = false are
 * skipped. Falloff is smooth (no hard rim) and fades to 0 at `radius`.
 */
export declare function renderLights(img: ImageDataLike, lights: PlacedLight[], s: LightingSettings): void;
