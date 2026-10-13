import { describe, expect, it } from 'vitest';
import { emptyBrief, type DesignBrief, type ElementDimension, type IdeaItem, type Recommendation, type SceneMap } from '../../../../shared/types';
import { newElementSpec } from '../../../assets/design';
import {
  NO_IDEAS,
  appendToPrompt,
  briefFromRecommendation,
  chooseOption,
  choiceLabels,
  defaultCompareSelection,
  forgetSceneIds,
  includedIdeaIds,
  isBriefEmpty,
  mergeRecommendation,
  moveElement,
  removeElement,
  replaceDimensions,
  resetIdeas,
  summarizeBrief,
  toggleIdea,
  toggleTargetZone,
  toggled,
  worstChosenFeasibility,
} from './briefOps';

function idea(id: string, patch: Partial<IdeaItem> = {}): IdeaItem {
  return { id, kind: 'note', title: id, note: '', colors: [], spaceIds: [], active: true, createdAt: 0, ...patch };
}

function scene(): SceneMap {
  return {
    category: 'front-yard',
    summary: '',
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: 'Colonial', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones: [
      { id: 'z1', kind: 'walkway', label: 'Front walk', description: '', polygon: [], editable: true, sun: 'full-sun' },
      { id: 'z2', kind: 'lawn', label: 'Front lawn', description: '', polygon: [], editable: true },
      { id: 'z3', kind: 'sky', label: 'Sky', description: '', polygon: [], editable: false },
    ],
    paths: [{ id: 'p1', label: 'Drive to door', from: 'drive', to: 'door', description: '', points: [], widthPx: 40, kind: 'existing' }],
    keep: [],
    opportunities: [],
    createdAt: 0,
    model: 'test',
  };
}

const dim = (id: string, optionIds: string[], extra: Partial<ElementDimension> = {}): ElementDimension => ({
  id,
  label: id,
  question: id,
  options: optionIds.map((o) => ({ id: o, label: o.toUpperCase(), description: '', promptText: o })),
  ...extra,
});

describe('toggled / isBriefEmpty', () => {
  it('adds and removes ids', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('detects empty briefs', () => {
    expect(isBriefEmpty(undefined)).toBe(true);
    expect(isBriefEmpty(emptyBrief())).toBe(true);
    expect(isBriefEmpty({ ...emptyBrief(), prompt: '  ' })).toBe(true);
    expect(isBriefEmpty({ ...emptyBrief(), prompt: 'warm lights' })).toBe(false);
  });
});

describe('chooseOption', () => {
  it('replaces single choices and clears on a second pick', () => {
    const el = newElementSpec('pathway');
    const d = dim('size', ['a', 'b']);
    el.choices.size = ['a'];
    chooseOption(el, d, 'b');
    expect(el.choices.size).toEqual(['b']);
    chooseOption(el, d, 'b');
    expect(el.choices.size).toEqual([]);
  });
  it('toggles multi choices', () => {
    const el = newElementSpec('planting-bed');
    const d = dim('plants', ['a', 'b', 'c'], { multiple: true });
    el.choices.plants = [];
    chooseOption(el, d, 'a');
    chooseOption(el, d, 'c');
    expect(el.choices.plants).toEqual(['a', 'c']);
    chooseOption(el, d, 'a');
    expect(el.choices.plants).toEqual(['c']);
  });
});

describe('replaceDimensions', () => {
  it('keeps valid answers, drops stale ids and defaults new dimensions', () => {
    const el = newElementSpec('pathway');
    el.choices = { size: ['big', 'gone'], shape: [] };
    replaceDimensions(el, [dim('size', ['big', 'small']), dim('shape', ['curve', 'straight'], { defaultOptionId: 'curve' }), dim('edge', ['steel', 'brick'], { defaultOptionId: 'brick' })]);
    expect(el.choices).toEqual({ size: ['big'], shape: [], edge: ['brick'] });
    expect(el.dimensions.map((d) => d.id)).toEqual(['size', 'shape', 'edge']);
  });
  it('keeps a single choice for single-choice dimensions', () => {
    const el = newElementSpec('pathway');
    el.choices = { size: ['a', 'b'] };
    replaceDimensions(el, [dim('size', ['a', 'b'])]);
    expect(el.choices.size).toEqual(['a']);
  });
});

describe('elements', () => {
  it('removes and moves elements', () => {
    const b = emptyBrief();
    const a = newElementSpec('pathway');
    const c = newElementSpec('lawn');
    b.elements.push(a, c);
    moveElement(b, c.id, -1);
    expect(b.elements.map((e) => e.id)).toEqual([c.id, a.id]);
    moveElement(b, c.id, -1);
    expect(b.elements.map((e) => e.id)).toEqual([c.id, a.id]);
    removeElement(b, c.id);
    expect(b.elements.map((e) => e.id)).toEqual([a.id]);
  });

  it('forgets deleted zones and paths everywhere', () => {
    const b = emptyBrief();
    const el = newElementSpec('pathway', scene());
    b.elements.push(el);
    b.targetZoneIds = ['z1', 'z2'];
    expect(el.zoneIds).toContain('z1');
    expect(el.pathIds).toEqual(['p1']);
    forgetSceneIds(b, { zoneIds: ['z1'], pathIds: ['p1'] });
    expect(b.targetZoneIds).toEqual(['z2']);
    expect(b.elements[0].zoneIds).not.toContain('z1');
    expect(b.elements[0].pathIds).toEqual([]);
  });

  it('toggles target zones', () => {
    const b = emptyBrief();
    toggleTargetZone(b, 'z1');
    expect(b.targetZoneIds).toEqual(['z1']);
    toggleTargetZone(b, 'z1');
    expect(b.targetZoneIds).toEqual([]);
  });
});

describe('defaultCompareSelection', () => {
  it('puts chosen options first and "none" options last', () => {
    const el = newElementSpec('pathway');
    const d = dim('x', ['a', 'b', 'c', 'd', 'e']);
    d.options[0].visual = { kind: 'diagram', diagram: 'none' };
    el.choices.x = ['c'];
    expect(defaultCompareSelection(el, d, 4)).toEqual(['c', 'b', 'd', 'e']);
    expect(defaultCompareSelection(el, dim('y', ['a', 'b']), 4)).toEqual(['a', 'b']);
  });
});

describe('appendToPrompt', () => {
  it('appends new lines once', () => {
    const b: DesignBrief = { ...emptyBrief(), prompt: 'Warm lighting' };
    expect(appendToPrompt(b, 'Add a curved flagstone path.')).toBe(true);
    expect(b.prompt).toBe('Warm lighting\nAdd a curved flagstone path.');
    expect(appendToPrompt(b, 'add a curved flagstone path')).toBe(false);
    expect(appendToPrompt(b, '   ')).toBe(false);
    const e = emptyBrief();
    appendToPrompt(e, 'First');
    expect(e.prompt).toBe('First');
  });
});

describe('ideas', () => {
  const board = [idea('a'), idea('b', { active: false }), idea('c', { spaceIds: ['other'] }), idea('d', { spaceIds: ['s1'] })];

  it('uses the active ideas for the space by default', () => {
    expect(includedIdeaIds(board, emptyBrief(), 's1')).toEqual(['a', 'd']);
  });

  it('materializes the implicit set on the first toggle', () => {
    const b = emptyBrief();
    toggleIdea(b, board, 's1', 'b');
    expect(b.ideaItemIds).toEqual(['a', 'd', 'b']);
    toggleIdea(b, board, 's1', 'a');
    expect(includedIdeaIds(board, b, 's1')).toEqual(['d', 'b']);
  });

  it('stores an explicit "none" when every idea is excluded, and resets', () => {
    const b = emptyBrief();
    b.ideaItemIds = ['a'];
    toggleIdea(b, board, 's1', 'a');
    expect(b.ideaItemIds).toEqual([NO_IDEAS]);
    expect(includedIdeaIds(board, b, 's1')).toEqual([]);
    toggleIdea(b, board, 's1', 'd');
    expect(includedIdeaIds(board, b, 's1')).toEqual(['d']);
    resetIdeas(b);
    expect(includedIdeaIds(board, b, 's1')).toEqual(['a', 'd']);
  });
});

describe('recommendations', () => {
  const rec: Recommendation = {
    id: 'r1',
    title: 'Curved walk',
    prompt: 'Replace the straight concrete walk with a gently curved bluestone path.',
    why: 'Softens the facade',
    category: 'hardscape',
    targetZoneIds: ['z1'],
    elementType: 'pathway',
  };
  const make = () => newElementSpec('pathway', scene());

  it('merges into the brief: prompt once, targets, an element with no preselected options', () => {
    const b = emptyBrief();
    const first = mergeRecommendation(b, rec, make);
    expect(first.elementAdded).toBe(true);
    expect(first.promptAdded).toBe(true);
    expect(b.targetZoneIds).toEqual(['z1']);
    expect(b.elements).toHaveLength(1);
    expect(Object.values(b.elements[0].choices).every((c) => c.length === 0)).toBe(true);
    expect(b.elements[0].zoneIds).toEqual(['z1']);

    const again = mergeRecommendation(b, { ...rec, targetZoneIds: ['z2'] }, make);
    expect(again.elementAdded).toBe(false);
    expect(again.promptAdded).toBe(false);
    expect(again.elementId).toBe(b.elements[0].id);
    expect(b.elements).toHaveLength(1);
    expect(b.elements[0].zoneIds).toEqual(['z1', 'z2']);
    expect(b.targetZoneIds).toEqual(['z1', 'z2']);
  });

  it('builds a standalone brief keeping maturity and idea picks', () => {
    const base: DesignBrief = { ...emptyBrief(), prompt: 'other stuff', plantMaturity: 'mature', ideaItemIds: ['i1'] };
    const b = briefFromRecommendation(rec, base, make);
    expect(b.prompt).toBe(rec.prompt);
    expect(b.plantMaturity).toBe('mature');
    expect(b.ideaItemIds).toEqual(['i1']);
    expect(b.targetZoneIds).toEqual(['z1']);
    expect(b.elements).toHaveLength(1);
    const noElement = briefFromRecommendation({ ...rec, elementType: undefined }, undefined, make);
    expect(noElement.elements).toHaveLength(0);
    expect(noElement.plantMaturity).toBe('established');
  });
});

describe('summaries', () => {
  it('lists chosen option labels and resolves zone / path labels', () => {
    const sc = scene();
    const b = emptyBrief();
    const el = newElementSpec('pathway', sc);
    b.elements.push(el);
    b.targetZoneIds = ['z2', 'missing'];
    const labels = choiceLabels(el);
    expect(labels.length).toBeGreaterThan(0);
    const s = summarizeBrief(b, sc);
    expect(s.areas).toEqual(['Front lawn']);
    expect(s.elements[0].where).toEqual(['Front walk', 'Drive to door']);
    expect(s.elements[0].choices).toEqual(labels);
    expect(s.maturity).toBe('Established');
  });

  it('reports the worst chosen feasibility', () => {
    const el = newElementSpec('pathway');
    const d = dim('p', ['a', 'b', 'c'], { multiple: true });
    d.options[0].feasibility = { rating: 'good', reasons: [] };
    d.options[1].feasibility = { rating: 'poor', reasons: [] };
    d.options[2].feasibility = { rating: 'caution', reasons: [] };
    el.choices.p = ['a', 'c'];
    expect(worstChosenFeasibility(el, [d])).toBe('caution');
    el.choices.p = [];
    expect(worstChosenFeasibility(el, [d])).toBeUndefined();
  });
});
