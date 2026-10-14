import { describe, expect, it } from 'vitest';
import { isKeepOrNone, promptAsks, promptAsksFor, withoutOverriddenDefaults, withoutOverriddenText } from './promptAsks';

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
