import { describe, expect, it } from 'vitest';
import type { PlanRequest } from '../../shared/api';
import { ELEMENT_DEFS } from '../../src/assets/design/elements';
import { briefTitle, variationTitles } from './templateTitles';

type Brief = PlanRequest['brief'];
type Element = Brief['elements'][number];

/** A built-in option's prompt text, as the client sends it. */
function text(type: string, dimension: string, option: string): string {
  const dim = ELEMENT_DEFS.find((d) => d.type === type)?.dimensions.find((d) => d.id === dimension);
  const found = dim?.options.find((o) => o.id === option);
  if (!dim || !found) throw new Error(`no option ${type}/${dimension}/${option}`);
  return found.promptText;
}

/** The Pathway as the Design panel sends it: every question answered, defaults included. */
function pathway(picks: Record<string, string> = {}): Element {
  const def = ELEMENT_DEFS.find((d) => d.type === 'pathway')!;
  return {
    type: 'pathway',
    label: 'Pathway',
    where: ['Patio'],
    choices: def.dimensions
      .filter((d) => d.defaultOptionId)
      .map((d) => ({ dimension: d.label, options: [text('pathway', d.id, picks[d.id] ?? d.defaultOptionId!)] })),
    note: '',
  };
}

const brief = (patch: Partial<Brief>): Brief => ({ prompt: '', scope: 'zones', plantMaturity: 'new', targetZoneLabels: [], elements: [], ...patch });

describe('template plan titles', () => {
  it('names the element and the options picked over the defaults', () => {
    expect(briefTitle(brief({ elements: [pathway({ 'stone-size': 'large-flagstone' })], prompt: 'A wider flagstone walk to the front door' }))).toBe(
      'Pathway · Large flagstone slabs',
    );
    // Two picks: both, the second in sentence case.
    expect(briefTitle(brief({ elements: [pathway({ material: 'granite', 'stone-size': 'large-flagstone' })] }))).toBe('Pathway · Gray granite, large flagstone slabs');
  });

  it('falls back to the homeowner\'s words, then to the first default', () => {
    expect(briefTitle(brief({ elements: [pathway()], prompt: 'A wider flagstone walk to the front door.' }))).toBe('Pathway · A wider flagstone walk to the front door');
    expect(briefTitle(brief({ elements: [pathway()] }))).toBe('Pathway · Bluestone');
    // Tailored options (not in the catalog) and no words: the element alone.
    expect(briefTitle(brief({ elements: [{ ...pathway(), choices: [{ dimension: 'Stone', options: ['reclaimed granite setts'] }] }] }))).toBe('Pathway');
    // No elements: the prompt, capitalized and cut at a word.
    expect(briefTitle(brief({ prompt: 'paint the front door a deep navy blue and add brass hardware and a new kick plate' }))).toBe(
      'Paint the front door a deep navy blue and add…',
    );
    expect(briefTitle(brief({}))).toBe('Your brief');
  });

  it('keeps several elements short', () => {
    const bed: Element = { type: 'planting-bed', label: 'Planting bed', where: [], choices: [], note: '' };
    const lights: Element = { type: 'outdoor-lighting', label: 'Outdoor lighting', where: [], choices: [], note: '' };
    expect(briefTitle(brief({ elements: [pathway({ 'stone-size': 'large-flagstone' }), bed] }))).toBe('Pathway & Planting bed · Large flagstone slabs');
    expect(briefTitle(brief({ elements: [pathway(), bed, lights], prompt: 'Cottage feel' }))).toBe('Pathway & 2 more · Cottage feel');
    for (const t of [briefTitle(brief({ elements: [pathway({ material: 'granite', 'stone-size': 'large-flagstone', shape: 'straight' })], prompt: 'x'.repeat(200) }))]) {
      expect(t.length).toBeLessThanOrEqual(60);
    }
  });

  it('tells several variations apart', () => {
    const b = brief({ elements: [pathway({ 'stone-size': 'large-flagstone' })] });
    expect(variationTitles(b, ['Faithful take', 'Softer, naturalistic take'], 1)).toEqual(['Pathway · Large flagstone slabs']);
    expect(variationTitles(b, ['Faithful take', 'Softer, naturalistic take'], 3)).toEqual([
      'Pathway · Large flagstone slabs (faithful)',
      'Pathway · Large flagstone slabs (softer, naturalistic)',
      'Pathway · Large flagstone slabs (faithful) 2',
    ]);
    // Strict: identical instructions, numbered.
    expect(variationTitles(b, null, 2)).toEqual(['Pathway · Large flagstone slabs (1)', 'Pathway · Large flagstone slabs (2)']);
  });
});
