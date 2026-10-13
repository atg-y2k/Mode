import { describe, expect, it } from 'vitest';
import { emptyBrief, type IdeaItem } from '../../../../shared/types';
import { buildHandoffPrompt } from '../../../handoff/prompts';
import { geminiPlan, pasteImage, ratioOverride, referencesAllowed } from './prefs';
import { droppedReferenceCount, handoffReferences, referenceItems, referenceRole } from './references';

const item = (id: string, patch: Partial<IdeaItem> = {}): IdeaItem => ({
  id,
  kind: 'image',
  imageId: `img-${id}`,
  title: `Idea ${id}`,
  note: '',
  colors: [],
  spaceIds: [],
  active: true,
  createdAt: 0,
  ...patch,
});

const board: IdeaItem[] = [
  item('a', { title: 'Bluestone patio' }),
  item('n', { kind: 'note', imageId: undefined }),
  item('t', { kind: 'theme', imageId: undefined }),
  item('p', { kind: 'product', title: 'The Belgard Dimensions pavers' }),
  item('x', { imageId: undefined }),
  item('b'),
  item('c'),
];

describe('hand-off references (Image 2+)', () => {
  it('only the brief’s explicit picks with a picture, in brief order, at most 3', () => {
    expect(referenceItems(board, { ideaItemIds: [] })).toEqual([]);
    expect(referenceItems(board, { ideaItemIds: ['n', 't', 'x', 'p', 'a', 'a', 'b', 'c'] }).map((i) => i.id)).toEqual(['p', 'a', 'b']);
  });

  it('roles name one job per image', () => {
    expect(referenceRole({ kind: 'image', title: 'Bluestone patio' })).toBe('the materials and colors in “Bluestone patio”');
    expect(referenceRole({ kind: 'product', title: 'The Belgard Dimensions pavers' })).toBe('the Belgard Dimensions pavers');
  });

  it('never for Gemini without a Google AI plan (Free routes to the Lite model)', () => {
    const brief = { ...emptyBrief(), ideaItemIds: ['a', 'p'] };
    expect(handoffReferences(board, brief, 'gemini', 'free')).toEqual([]);
    expect(handoffReferences(board, brief, 'gemini', null)).toEqual([]);
    expect(droppedReferenceCount(board, brief, 'gemini', null)).toBe(2);
    expect(handoffReferences(board, brief, 'gemini', 'paid')).toHaveLength(2);
    expect(handoffReferences(board, brief, 'chatgpt', null)).toHaveLength(2);
    expect(droppedReferenceCount(board, brief, 'chatgpt', null)).toBe(0);
    expect(referencesAllowed('chatgpt', 'free')).toBe(true);
  });

  it('what the companion tells the user to paste is exactly what the prompt references', () => {
    const brief = { ...emptyBrief(), ideaItemIds: ['a', 'p'] };
    for (const app of ['chatgpt', 'gemini'] as const) {
      const refs = handoffReferences(board, brief, app, 'paid');
      expect(refs.map((r) => r.n)).toEqual([2, 3]);
      expect(refs.map((r) => r.imageId)).toEqual(['img-a', 'img-p']);
      const prompt = buildHandoffPrompt({
        app,
        instruction: 'Lay bluestone pavers on the walk.',
        areaText: 'the walkway',
        keep: [],
        light: '',
        style: 'ranch',
        ratio: '4:3',
        markerColorName: 'magenta',
        strictness: 'balanced',
        plantMaturity: 'established',
        references: refs.map((r) => ({ role: r.role })),
        interior: false,
      });
      for (const r of refs) expect(prompt).toContain(r.sentence);
      expect(prompt).not.toContain('Image 4');
    }
  });
});

describe('hand-off prefs', () => {
  it('Gemini plan, pasted image and ratio overrides parse their stored values', () => {
    expect(geminiPlan(null)).toBeNull();
    expect(geminiPlan('paid')).toBe('paid');
    expect(geminiPlan('weird')).toBeNull();
    expect(pasteImage(null)).toBe('marked');
    expect(pasteImage('clean')).toBe('clean');
    expect(ratioOverride('chatgpt', null)).toEqual([]);
    expect(ratioOverride('chatgpt', '1:1, 3:2').map((r) => r.label)).toEqual(['1:1', '3:2']);
  });
});
