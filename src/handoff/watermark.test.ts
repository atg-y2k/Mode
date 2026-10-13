import { describe, expect, it } from 'vitest';
import { createMask } from '../engine/mask';
import { HANDOFF_DOWNLOAD_PREFIX, handoffDownloadName, isOwnHandoffDownload } from './filenames';
import { ellipseMask } from './testing';
import { targetTouchesWatermark, watermarkCorner } from './watermark';

const W = 1600;
const H = 1200;
const full = { x: 0, y: 0, w: W, h: H };

describe('Gemini watermark corner', () => {
  it('is the bottom-right square of the exported frame', () => {
    expect(watermarkCorner(full)).toEqual({ x: 1440, y: 1040, w: 160, h: 160 });
    const crop = { x: 400, y: 300, w: 800, h: 600 };
    expect(watermarkCorner(crop)).toEqual({ x: 1120, y: 820, w: 80, h: 80 });
  });

  it('flags targets whose composite band reaches the corner, and whole-image edits', () => {
    // A lawn running into the bottom-right corner.
    expect(targetTouchesWatermark(ellipseMask(W, H, 1300, 1100, 400, 200), full)).toBe(true);
    // A door in the middle: the sparkle lands on restored pixels.
    expect(targetTouchesWatermark(ellipseMask(W, H, 800, 500, 80, 150), full)).toBe(false);
    // Just short of the corner, but the band (grown + feathered) reaches it.
    const near = ellipseMask(W, H, 1418, 1008, 30, 30);
    expect(targetTouchesWatermark(near, full)).toBe(true);
    // Relative to the crop that was exported, not the photo.
    expect(targetTouchesWatermark(ellipseMask(W, H, 800, 600, 120, 90), { x: 500, y: 400, w: 420, h: 315 })).toBe(true);
    const whole = createMask(W, H);
    whole.data.fill(255);
    expect(targetTouchesWatermark(whole, full)).toBe(true);
    expect(targetTouchesWatermark(createMask(W, H), full)).toBe(true); // empty = whole image
  });
});

describe('hand-off download names', () => {
  it('share one prefix with the server watcher', () => {
    expect(HANDOFF_DOWNLOAD_PREFIX).toBe('mode-handoff-');
    expect(handoffDownloadName('Curved flagstone path + lavender!')).toBe('mode-handoff-curved-flagstone-path-lavender.png');
    expect(handoffDownloadName('  ', 'jpg')).toBe('mode-handoff-photo.jpg');
    expect(isOwnHandoffDownload('/Users/me/Downloads/mode-handoff-path.png')).toBe(true);
    expect(isOwnHandoffDownload('Mode-Handoff-x.PNG')).toBe(true);
    expect(isOwnHandoffDownload('Gemini_Generated_Image_abc.png')).toBe(false);
  });
});
