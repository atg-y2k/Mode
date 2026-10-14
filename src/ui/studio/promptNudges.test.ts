import { describe, expect, it } from 'vitest';
import { emptyBrief, type DesignBrief, type ElementSpec } from '../../../shared/types';
import { ELEMENT_DEFS } from '../../assets/design/elements';
import { promptNote, promptNudges } from './promptNudges';

const PATHWAY = ELEMENT_DEFS.find((d) => d.type === 'pathway')!;

function pathway(picks: Record<string, string> = {}): ElementSpec {
  return {
    id: 'el1',
    type: 'pathway',
    label: 'Pathway',
    zoneIds: [],
    pathIds: [],
    dimensions: PATHWAY.dimensions,
    choices: Object.fromEntries(PATHWAY.dimensions.filter((d) => d.defaultOptionId).map((d) => [d.id, [picks[d.id] ?? d.defaultOptionId!]])),
    note: '',
  };
}

function brief(prompt: string, el = pathway()): DesignBrief {
  return { ...emptyBrief(), prompt, elements: [el] };
}

describe('promptNudges / promptNote', () => {
  it('names the Pathway question the idea asks for while it says Keep current / No …', () => {
    expect(promptNudges(brief('A wider flagstone walk to the front door')).map((n) => n.key)).toEqual(['el1:width']);
    expect(promptNote(brief('A wider flagstone walk to the front door'))).toEqual({
      keys: ['el1:width'],
      elementId: 'el1',
      elementLabel: 'Pathway',
      text: 'Your idea mentions a wider walk — pick a width on the Pathway card so Mode leaves room for it.',
    });
  });

  it('joins several asks of one card into one sentence', () => {
    const idea = 'a 5 ft curved flagstone path to the door, lavender along the edge, warm path lights';
    expect(promptNudges(brief(idea)).map((n) => n.key)).toEqual(['el1:shape', 'el1:width', 'el1:edging', 'el1:lighting']);
    expect(promptNote(brief(idea))?.text).toBe(
      'Your idea mentions a 5 ft curved walk, the walk’s edge and path lights — pick a shape, a width, an edging and a light style on the Pathway card so Mode leaves room for them.',
    );
    expect(promptNote(brief('a wider curved walk'))?.text).toBe(
      'Your idea mentions a wider, curved walk — pick a shape and a width on the Pathway card so Mode leaves room for them.',
    );
    // Lights alone need no room, only a choice.
    expect(promptNote(brief('warm path lights along the walk'))?.text).toBe(
      'Your idea mentions path lights — pick a light style on the Pathway card so the instruction says exactly which.',
    );
  });

  it('stays quiet once the card answers, when dismissed, or for unrelated words', () => {
    expect(promptNote(brief('A wider flagstone walk', pathway({ width: 'width-5ft' })))).toBeNull();
    expect(promptNote(brief('A wider flagstone walk'), new Set(['el1:width']))).toBeNull();
    expect(promptNote(brief('bluestone under the front windows'))).toBeNull();
    expect(promptNote(brief(''))).toBeNull();
    // Only Pathway cards are checked.
    expect(promptNote(brief('a wider drive', { ...pathway(), type: 'driveway' }))).toBeNull();
    // A dismissed ask drops out of the joined sentence.
    expect(promptNote(brief('a wider walk with path lights'), new Set(['el1:width']))?.keys).toEqual(['el1:lighting']);
  });
});
