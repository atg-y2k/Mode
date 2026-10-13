import { describe, expect, it } from 'vitest';
import {
  exportFileName,
  formatBytes,
  isEditableTarget,
  isMacPlatform,
  isValidZip,
  matchUndoRedo,
  normalizeZone,
  plural,
  relativeTime,
  shortcutLabel,
  slugify,
} from './format';

const combo = (key: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('relativeTime', () => {
  const now = new Date('2026-10-13T12:00:00Z').getTime();
  it('formats recent times', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 60 * 60_000, now)).toBe('1 hour ago');
    expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 26 * 60 * 60_000, now)).toBe('yesterday');
    expect(relativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe('3 days ago');
  });
  it('falls back to a date for older times', () => {
    expect(relativeTime(new Date('2026-03-04T12:00:00Z').getTime(), now)).toMatch(/Mar \d/);
    expect(relativeTime(new Date('2024-03-04T12:00:00Z').getTime(), now)).toMatch(/2024/);
  });
  it('never reports the future', () => {
    expect(relativeTime(now + 60_000, now)).toBe('just now');
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(2.25 * 1024 ** 3)).toBe('2.3 GB');
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
  });
  it('handles missing values', () => {
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('plural / slugify / exportFileName', () => {
  it('pluralizes', () => {
    expect(plural(1, 'photo')).toBe('1 photo');
    expect(plural(3, 'photo')).toBe('3 photos');
    expect(plural(2, 'idea', 'ideas!')).toBe('2 ideas!');
  });
  it('slugifies names', () => {
    expect(slugify('Front yard — Option A')).toBe('front-yard-option-a');
    expect(slugify('Café  Crème')).toBe('cafe-creme');
    expect(slugify('***')).toBe('mode');
    expect(slugify('', 'x')).toBe('x');
  });
  it('builds export file names', () => {
    expect(exportFileName(['My Home', 'Kitchen', undefined, ' '], 'jpg')).toBe('my-home-kitchen.jpg');
    expect(exportFileName([], 'png')).toBe('mode.png');
  });
});

describe('matchUndoRedo', () => {
  it('maps Ctrl combos off macOS', () => {
    expect(matchUndoRedo(combo('z', { ctrl: true }), false)).toBe('undo');
    expect(matchUndoRedo(combo('Z', { ctrl: true, shift: true }), false)).toBe('redo');
    expect(matchUndoRedo(combo('y', { ctrl: true }), false)).toBe('redo');
    expect(matchUndoRedo(combo('z', { meta: true }), false)).toBeNull();
  });
  it('maps Cmd combos on macOS', () => {
    expect(matchUndoRedo(combo('z', { meta: true }), true)).toBe('undo');
    expect(matchUndoRedo(combo('z', { meta: true, shift: true }), true)).toBe('redo');
    expect(matchUndoRedo(combo('z', { ctrl: true }), true)).toBeNull();
  });
  it('ignores other keys and Alt', () => {
    expect(matchUndoRedo(combo('a', { ctrl: true }), false)).toBeNull();
    expect(matchUndoRedo(combo('z', { ctrl: true, alt: true }), false)).toBeNull();
    expect(matchUndoRedo(combo('z'), false)).toBeNull();
  });
});

describe('platform helpers', () => {
  it('detects macOS', () => {
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isMacPlatform({ platform: '', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })).toBe(true);
    expect(isMacPlatform({ platform: 'Win32' })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
  it('labels shortcuts', () => {
    expect(shortcutLabel('z', { mac: true })).toBe('⌘Z');
    expect(shortcutLabel('z', { mac: true, shift: true })).toBe('⇧⌘Z');
    expect(shortcutLabel('z', { mac: false, shift: true })).toBe('Ctrl+Shift+Z');
  });
  it('recognizes editable targets', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'range' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('location inputs', () => {
  it('validates ZIP codes', () => {
    expect(isValidZip('')).toBe(true);
    expect(isValidZip('20817')).toBe(true);
    expect(isValidZip('20817-1234')).toBe(true);
    expect(isValidZip('2081')).toBe(false);
    expect(isValidZip('abcde')).toBe(false);
  });
  it('normalizes hardiness zones', () => {
    expect(normalizeZone(' 7A ')).toBe('7a');
    expect(normalizeZone('zone 10b')).toBe('10b');
    expect(normalizeZone('6')).toBe('6');
    expect(normalizeZone('14')).toBeNull();
    expect(normalizeZone('0a')).toBeNull();
    expect(normalizeZone('warm')).toBeNull();
  });
});

describe('errorText', () => {
  it('turns errors into sentences', async () => {
    const { errorText } = await import('./format');
    expect(errorText(new Error('Network down'))).toBe('Network down.');
    expect(errorText(new Error('Try again.'))).toBe('Try again.');
    expect(errorText('Oops!')).toBe('Oops!');
    expect(errorText(null)).toBe('Something went wrong.');
  });
});
