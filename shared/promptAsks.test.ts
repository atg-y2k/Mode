import { describe, expect, it } from 'vitest';
import { askedWords, isKeepOrNone, promptAsks, promptAsksFor, withoutOverriddenDefaults, withoutOverriddenText } from './promptAsks';

describe('promptAsks', () => {
  it('reads what a typed idea plainly asks for', () => {
    expect([...promptAsks('a wider curved walk with warm path lights')].sort()).toEqual(['path lighting', 'shape', 'width']);
    expect([...promptAsks('A wider flagstone walk to the front door')]).toEqual(['width']);
    expect([...promptAsks('a 5 ft curved flagstone path to the door, lavender along the edge, warm path lights')].sort()).toEqual([
      'edging',
      'path lighting',
      'shape',
      'width',
    ]);
    expect([...promptAsks('a winding walk lined with lanterns and a brick border')].sort()).toEqual(['edging', 'path lighting', 'shape']);
    expect(promptAsksFor('make it 4 feet wide', 'Width')).toBe(true);
    expect(promptAsksFor('narrow the walk a little', 'Width')).toBe(true);
    expect(promptAsksFor('bollards along one side', 'Path lighting')).toBe(true);
    // Words that only look alike ask for nothing.
    expect(promptAsks('bluestone walk under the front windows, a 6 ft fence along the street').size).toBe(0);
    expect(promptAsks('')).toEqual(new Set());
    expect(promptAsksFor('a wider walk', 'Stone size')).toBe(false);
  });

  it('reads words that leave the walk as it is as no ask', () => {
    const choices = [
      { dimension: 'Shape', options: ['keeping its current route and line'] },
      { dimension: 'Width', options: ['keeping its current width'] },
      { dimension: 'Edging', options: ['with no border edging'] },
      { dimension: 'Path lighting', options: ['with no added path lighting'] },
    ];
    const base =
      'For the Front walk: Pathway — shape: keeping its current route and line; width: keeping its current width. No border edging and no added path lighting.';
    for (const idea of ['no wider than today', 'keep it straight', "don't widen it", 'not wider', 'keep the walk the same width', 'Don’t widen it']) {
      expect(promptAsks(idea).size, idea).toBe(0);
      expect(withoutOverriddenDefaults(idea, choices), idea).toEqual(choices);
      expect(withoutOverriddenText(base, idea), idea).toBe(base);
    }
    // Still asks.
    expect([...promptAsks('a little wider than today')]).toEqual(['width']);
    expect([...promptAsks('wider')]).toEqual(['width']);
    expect([...promptAsks('a 4 ft wide walk')]).toEqual(['width']);
    expect([...promptAsks('winds to the door')]).toEqual(['shape']);
    // The negation reaches three words back, not past a clause break or "but".
    expect([...promptAsks('keep it straight but make it wider')]).toEqual(['width']);
    expect([...promptAsks('no border, a wider walk')]).toEqual(['width']);
    expect(askedWords('not curved, winding instead', 'shape')).toEqual(['winding']);
    // "No …" agrees with a "no …" default; "keep" asks for what that default leaves out.
    expect(promptAsks('no path lights and no border').size).toBe(0);
    expect([...promptAsks('keep the brick border')]).toEqual(['edging']);
    // "Not wide enough" still asks for a width.
    expect(promptAsksFor("the walk isn't wide enough", 'Width')).toBe(true);
  });

  it('width: "wide enough" and "twice as wide"', () => {
    expect(promptAsksFor('make the walk wide enough for two people side by side', 'Width')).toBe(true);
    expect(promptAsksFor('a walk twice as wide', 'Width')).toBe(true);
    for (const words of ['a wide porch', 'a bench twice as long']) expect(promptAsks(words).size, words).toBe(0);
  });

  it('shape: "arc" / "arcing", "sweeping", "serpentine", "S-shaped" / "S-curve"', () => {
    for (const idea of ['a walk in a gentle arc to the door', 'an arcing walk', 'a sweeping walk', 'a serpentine path', 'an S-shaped walk', 'an S-curve to the porch']) {
      expect(promptAsksFor(idea, 'Shape'), idea).toBe(true);
    }
    for (const words of ['search for a matching stone', 'an archway over the walk', 'an arched gate', 'a stone arcade', "the walk's shape"]) {
      expect(promptAsks(words).size, words).toBe(0);
    }
  });

  it('path lighting: "lighting along the walk", "lamp posts along the walk"', () => {
    expect(promptAsksFor('soft lighting along the walk', 'Path lighting')).toBe(true);
    expect(promptAsksFor('two lamp posts along the walk', 'Path lighting')).toBe(true);
    expect(promptAsksFor('lampposts along the path', 'Path lighting')).toBe(true);
    expect(promptAsks('keep the lamp post by the drive, add lighting on the porch').size).toBe(0);
  });

  it('knows a keep / no answer', () => {
    expect(isKeepOrNone('keeping its current width')).toBe(true);
    expect(isKeepOrNone('with no added path lighting')).toBe(true);
    expect(isKeepOrNone('without step lights')).toBe(true);
    expect(isKeepOrNone('about 5 ft wide')).toBe(false);
    expect(isKeepOrNone('natural bluestone')).toBe(false);
  });

  it('drops only the keep / no answers the words override', () => {
    const choices = [
      { dimension: 'Width', options: ['keeping its current width'] },
      { dimension: 'Shape', options: ['keeping its current route and line'] },
      { dimension: 'Path lighting', options: ['with no added path lighting'] },
      { dimension: 'Edging', options: ['edged with thin black steel landscape edging set flush with grade'] },
    ];
    expect(withoutOverriddenDefaults('a wider walk with a steel border and path lights', choices)).toEqual([
      { dimension: 'Shape', options: ['keeping its current route and line'] },
      { dimension: 'Edging', options: ['edged with thin black steel landscape edging set flush with grade'] },
    ]);
    expect(withoutOverriddenDefaults('', choices)).toEqual(choices);
    // A multi-answer question keeps its positive answer.
    expect(withoutOverriddenDefaults('wider', [{ dimension: 'Width', options: ['keeping its current width', 'about 5 ft wide'] }])).toEqual([
      { dimension: 'Width', options: ['about 5 ft wide'] },
    ]);
  });

  it('strips overridden clauses from an earlier instruction', () => {
    const base =
      'Edit this photo of the home. For the Front walk: Pathway — stone & color: natural bluestone; shape: keeping its current route and line; width: keeping its current width. No border edging and no added path lighting. Change only the Front walk.';
    expect(withoutOverriddenText(base, 'Make it wider')).toBe(
      'Edit this photo of the home. For the Front walk: Pathway — stone & color: natural bluestone; shape: keeping its current route and line. No border edging and no added path lighting. Change only the Front walk.',
    );
    expect(withoutOverriddenText(base, 'add warm path lights')).toBe(
      'Edit this photo of the home. For the Front walk: Pathway — stone & color: natural bluestone; shape: keeping its current route and line; width: keeping its current width. No border edging. Change only the Front walk.',
    );
    expect(withoutOverriddenText(base, 'a wider curved walk, brick border, path lights')).toBe(
      'Edit this photo of the home. For the Front walk: Pathway — stone & color: natural bluestone. Change only the Front walk.',
    );
    expect(withoutOverriddenText('For the walk: Pathway — width: keeping its current width. Keep the rest.', 'wider')).toBe('For the walk: Pathway. Keep the rest.');
    expect(withoutOverriddenText(base, 'Warmer palette')).toBe(base);
  });
});
