import { describe, expect, it } from 'vitest';
import { emptyBrief, type Generation, type Variation } from '../../../shared/types';
import type { RunInfo } from './runs';
import { compareContext, runTiles, runVariations } from './tiles';

const v = (id: string, createdAt: number, extra: Partial<Variation> = {}): Variation => ({
  id,
  imageId: `img-${id}`,
  thumbId: `th-${id}`,
  width: 10,
  height: 10,
  title: `Title ${id}`,
  brief: 'b',
  favorite: false,
  createdAt,
  ...extra,
});

const compareGen = (variations: Variation[], status: Generation['status']): Generation => ({
  id: 'g',
  createdAt: 0,
  brief: {
    ...emptyBrief(),
    elements: [
      {
        id: 'el',
        type: 'pathway',
        label: 'Front walk',
        zoneIds: [],
        pathIds: [],
        choices: {},
        note: '',
        dimensions: [
          {
            id: 'size',
            label: 'Stone size',
            question: '',
            options: [
              { id: 'large', label: 'Large', description: '', promptText: 'large' },
              { id: 'small', label: 'Small', description: '', promptText: 'small' },
              { id: 'gravel', label: 'Gravel', description: '', promptText: 'gravel' },
            ],
          },
        ],
      },
    ],
  },
  mode: 'compare',
  compare: { elementId: 'el', dimensionId: 'size', optionIds: ['large', 'small', 'gravel'] },
  plan: '',
  provider: 'openai',
  model: 'm',
  variations,
  status,
});

describe('runTiles', () => {
  it('follows live slots: finished, rendering and failed tiles in planned order', () => {
    const g: Generation = { ...compareGen([], 'running'), mode: 'variations', compare: undefined, variations: [v('b', 2), v('a', 1), v('x', 3)] };
    const info: RunInfo = {
      generationId: 'g',
      photoId: 'p',
      stage: 'rendering',
      slots: [
        { key: 'v1', title: 'One', brief: 'x', state: 'done', variationId: 'a' },
        { key: 'v2', title: 'Two', brief: 'x', state: 'failed', error: 'boom' },
        { key: 'v3', title: 'Three', brief: 'x', state: 'rendering' },
        { key: 'v4', title: 'Four', brief: 'x', state: 'done', variationId: 'deleted' },
        { key: 'v5', title: 'Five', brief: 'x', state: 'done', variationId: 'b' },
      ],
    };
    const tiles = runTiles(g, info);
    expect(tiles.map((t) => [t.state, t.variation?.id ?? t.slotKey])).toEqual([
      ['done', 'a'],
      ['failed', 'v2'],
      ['rendering', 'v3'],
      ['done', 'b'],
      ['done', 'x'],
    ]);
    expect(tiles[1].error).toBe('boom');
    expect(runVariations(g, info).map((x) => x.id)).toEqual(['a', 'b', 'x']);
  });

  it('orders compare runs by option and shows options that never rendered', () => {
    const g = compareGen([v('s', 1, { optionId: 'small', optionLabel: 'Small' }), v('l', 2, { optionId: 'large', optionLabel: 'Large' })], 'partial');
    const tiles = runTiles(g, undefined);
    expect(tiles.map((t) => [t.state, t.label])).toEqual([
      ['done', 'Large'],
      ['done', 'Small'],
      ['missing', 'Gravel'],
    ]);
    // Still running (no live info): no "missing" placeholders.
    expect(runTiles({ ...g, status: 'running' }, undefined)).toHaveLength(2);
  });

  it('describes the compared element and dimension', () => {
    const ctx = compareContext(compareGen([], 'done'))!;
    expect(ctx.elementLabel).toBe('Front walk');
    expect(ctx.dimensionLabel).toBe('Stone size');
    expect(ctx.options.map((o) => o.id)).toEqual(['large', 'small', 'gravel']);
    expect(compareContext({ ...compareGen([], 'done'), mode: 'variations' })).toBeNull();
  });
});
