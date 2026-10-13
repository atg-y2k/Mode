import { describe, expect, it } from 'vitest';
import { emptyBrief, type AlignmentReport, type Generation, type Photo, type PlannedVariation } from '../../../../shared/types';
import { appendEntry, countToday, startOfDay, usageHint, wasSent } from './log';
import {
  alignmentSummary,
  alignmentTooltip,
  assignTargets,
  changesTouchArea,
  footprintHint,
  pendingHandoffs,
  rollupStatus,
  sourceLabel,
  sourceTag,
  type PendingItem,
} from './planned';
import { runTiles } from '../tiles';
import { handoffFooter, TEMPLATE_PLAN_NOTE } from './review';

const item = (id: string, status: PlannedVariation['status'], extra: Partial<PlannedVariation> = {}): PlannedVariation => ({
  id,
  title: `T ${id}`,
  brief: `B ${id}`,
  status,
  ...extra,
});

const gen = (id: string, planned: PlannedVariation[], extra: Partial<Generation> = {}): Generation => ({
  id,
  createdAt: 0,
  brief: emptyBrief(),
  mode: 'variations',
  plan: '',
  provider: 'ChatGPT',
  model: 'hand-off',
  variations: [],
  status: 'awaiting',
  renderMode: 'handoff',
  planned,
  ...extra,
});

const photoWith = (generations: Generation[]): Photo => ({
  id: 'pho',
  name: 'p',
  imageId: 'i',
  thumbId: 't',
  width: 10,
  height: 10,
  createdAt: 0,
  regions: [],
  generations,
  designs: [],
  activeDesignId: '',
});

describe('rollupStatus', () => {
  it('is awaiting while any hand-off waits or is staged', () => {
    expect(rollupStatus(gen('g', [item('a', 'done'), item('b', 'staged')])).status).toBe('awaiting');
    expect(rollupStatus(gen('g', [item('a', 'awaiting-handoff')])).status).toBe('awaiting');
  });
  it('is running while an API render is pending', () => {
    expect(rollupStatus(gen('g', [item('a', 'done'), item('b', 'pending')])).status).toBe('running');
  });
  it('is done when everything kept was accepted (skips do not count as failures)', () => {
    expect(rollupStatus(gen('g', [item('a', 'done'), item('b', 'rejected')]))).toEqual({ status: 'done' });
  });
  it('is partial with failures next to results, failed without results', () => {
    const partial = rollupStatus(gen('g', [item('a', 'done'), item('b', 'failed', { error: 'boom' })]));
    expect(partial.status).toBe('partial');
    expect(partial.error).toMatch(/1 of 2 variations failed: boom/);
    expect(rollupStatus(gen('g', [item('a', 'failed', { error: 'x' })]))).toEqual({ status: 'failed', error: 'x' });
    expect(rollupStatus(gen('g', [item('a', 'rejected')])).error).toMatch(/skipped/);
  });
  it('leaves runs without a plan alone', () => {
    expect(rollupStatus(gen('g', [], { status: 'partial' })).status).toBe('partial');
  });
});

describe('pending hand-offs', () => {
  const photo = photoWith([
    gen('new', [item('n1', 'awaiting-handoff'), item('n2', 'done'), item('n3', 'staged')]),
    gen('old', [item('o1', 'awaiting-handoff')]),
  ]);
  const pending = pendingHandoffs(photo);

  it('lists awaiting and staged items, newest run first', () => {
    expect(pending.map((p) => p.plannedId)).toEqual(['n1', 'n3', 'o1']);
    expect(pending[1].index).toBe(2);
  });

  it('assigns returned files: active first, then waiting items of its run, then others', () => {
    const ref = (p: PendingItem) => p.plannedId;
    // Several files fill the waiting items; only a single file replaces the active staged result.
    expect(assignTargets(pending, { photoId: 'pho', generationId: 'new', plannedId: 'n3' }, 3).map(ref)).toEqual(['n1', 'o1']);
    expect(assignTargets(pending, { photoId: 'pho', generationId: 'new', plannedId: 'n3' }, 1).map(ref)).toEqual(['n3']);
    expect(assignTargets(pending, null, 1).map(ref)).toEqual(['n1']);
    expect(assignTargets(pending, null, 5).map(ref)).toEqual(['n1', 'o1']);
    const onlyStaged = pendingHandoffs(photoWith([gen('g', [item('s', 'staged')])]));
    expect(assignTargets(onlyStaged, null, 1).map(ref)).toEqual(['s']);
    expect(assignTargets(onlyStaged, { photoId: 'pho', generationId: 'g', plannedId: 's' }, 2).map(ref)).toEqual(['s']);
    expect(assignTargets(pending, null, 0)).toEqual([]);
  });

  it('a compare run with one result back: the remaining files go to the waiting options, not shifted by one', () => {
    const ref = (p: PendingItem) => p.plannedId;
    const compare = pendingHandoffs(
      photoWith([gen('g', [item('large', 'staged'), item('medium', 'awaiting-handoff'), item('small', 'awaiting-handoff'), item('gravel', 'awaiting-handoff')])]),
    );
    const large = { photoId: 'pho', generationId: 'g', plannedId: 'large' };
    expect(assignTargets(compare, large, 3).map(ref)).toEqual(['medium', 'small', 'gravel']);
    expect(assignTargets(compare, large, 1).map(ref)).toEqual(['large']);
    expect(assignTargets(compare, { ...large, plannedId: 'small' }, 2).map(ref)).toEqual(['small', 'medium']);
  });
});

describe('planned tiles', () => {
  it('shows waiting, staged, failed and accepted items in plan order and skips rejected ones', () => {
    const g = gen('g', [
      item('a', 'awaiting-handoff', { handoff: { app: 'gemini', prompt: 'p', crop: { x: 0, y: 0, w: 1, h: 1 }, outW: 1, outH: 1, markerColor: '#f0f', cleanImageId: 'c', markedImageId: 'm', createdAt: 0 } }),
      item('b', 'staged', { staged: { imageId: 'si', thumbId: 'st', source: { kind: 'handoff', app: 'chatgpt' } } }),
      item('c', 'rejected'),
      item('d', 'done', { variationId: 'v1' }),
      item('e', 'failed', { error: 'nope' }),
      item('f', 'pending'),
    ]);
    g.variations = [{ id: 'v1', imageId: 'x', thumbId: 'y', width: 1, height: 1, title: 'V', brief: 'b', favorite: false, createdAt: 0 }];
    const tiles = runTiles(g, undefined);
    expect(tiles.map((t) => [t.state, t.plannedId])).toEqual([
      ['awaiting', 'a'],
      ['staged', 'b'],
      ['done', 'd'],
      ['failed', 'e'],
      ['failed', 'f'],
    ]);
    expect(tiles[0].app).toBe('gemini');
    expect(tiles[1].staged?.imageId).toBe('si');
    expect(tiles[3].slotKey).toBe('e');
    expect(tiles[4].error).toMatch(/Interrupted/);
    expect(runTiles({ ...g, status: 'running' }, undefined)[4].state).toBe('pending');
  });
});

describe('provenance and alignment', () => {
  const report: AlignmentReport = { inliers: 220, residualPx: 0.8, driftBefore: 6.6, driftAfter: 2.1, outsideChanged: 0.001, aligned: true };

  it('labels sources', () => {
    expect(sourceLabel({ kind: 'handoff', app: 'gemini' })).toBe('Gemini');
    expect(sourceLabel({ kind: 'api' })).toBe('API');
    expect(sourceLabel(undefined)).toBeNull();
    expect(sourceTag({ kind: 'handoff', app: 'chatgpt' })).toBe('GPT');
  });

  it('summarises alignment', () => {
    expect(alignmentSummary(report)).toMatchObject({ tone: 'success', label: 'Aligned', warn: false });
    expect(alignmentSummary({ ...report, outsideChanged: 0.04 }, 2)).toMatchObject({ tone: 'info', label: 'Model changed 2 areas outside — protected' });
    expect(alignmentSummary({ ...report, outsideChanged: 0.3 })).toMatchObject({ tone: 'warning', warn: true, suggestStricter: true });
    expect(alignmentSummary({ ...report, aligned: false, inliers: 12 })).toMatchObject({ label: 'Rough fit', warn: true });
    expect(alignmentSummary({ ...report, driftAfter: 9 })).toMatchObject({ tone: 'warning', warn: true, label: 'Colours a little off' });
  });

  it('says it in plain words and keeps the measurements for the tooltip', () => {
    const ok = alignmentSummary(report);
    expect(ok.detail).toBe('Lined up with your photo and colours matched. Everything outside the outline is your original photo.');
    expect(ok.numbers).toBe('Lined up within 0.8 px using 220 matching features · colour difference ΔE 6.6 → 2.1');
    expect(alignmentTooltip(ok)).toBe(`${ok.detail}\n${ok.numbers}`);
    const reports = [
      report,
      { ...report, outsideChanged: 0.04 },
      { ...report, outsideChanged: 0.3 },
      { ...report, aligned: false, inliers: 12 },
      { ...report, driftAfter: 9 },
    ];
    for (const r of reports) {
      const s = alignmentSummary(r, 2);
      expect(s.detail, s.label).not.toMatch(/\bpx\b|ΔE|matching features|drift/);
      expect(s.numbers, s.label).toMatch(/matching features/);
    }
    expect(alignmentSummary({ ...report, aligned: false, inliers: 12 }).numbers).toContain('12 matching features');
  });
});

describe('footprint hint', () => {
  const report: AlignmentReport = { inliers: 220, residualPx: 0.8, driftBefore: 6.6, driftAfter: 2.1, outsideChanged: 0.05, aligned: true };
  const pathway = (choice: string) => ({
    id: 'el',
    type: 'pathway' as const,
    label: 'Walk',
    zoneIds: ['walk'],
    pathIds: [],
    note: '',
    dimensions: [
      {
        id: 'width',
        label: 'Width',
        question: '?',
        options: [
          { id: 'keep-width', label: 'Keep', description: '', promptText: 'keep' },
          { id: 'width-6ft', label: '6 ft', description: '', promptText: '6 ft', footprint: 'grow' as const },
        ],
      },
    ],
    choices: { width: [choice] },
  });
  it('a wider path whose result changed things outside: let the lawn change, not a stricter prompt', () => {
    expect(footprintHint({ ...emptyBrief(), elements: [pathway('width-6ft')] }, report)).toEqual({
      message: 'The new path ran past the area that may change. Let the lawn beside it change and retry.',
      elementId: 'el',
    });
    expect(footprintHint({ ...emptyBrief(), elements: [pathway('keep-width')] }, report)).toBeNull();
    expect(footprintHint({ ...emptyBrief(), elements: [pathway('width-6ft')] }, { ...report, outsideChanged: 0.001 })).toBeNull();
    expect(footprintHint({ ...emptyBrief(), scope: 'whole', elements: [pathway('width-6ft')] }, report)).toBeNull();
    // Changes far from the walk (e.g. on the house) are not the path running past its area.
    expect(footprintHint({ ...emptyBrief(), elements: [pathway('width-6ft')] }, report, false)).toBeNull();
  });

  it('counts a walk picked on the photo when the element has no “Where” of its own', () => {
    const scene = {
      zones: [
        { id: 'walk', kind: 'walkway' as const, label: 'Walkway', polygon: [], description: '', editable: true },
        { id: 'grass', kind: 'lawn' as const, label: 'Lawn', polygon: [], description: '', editable: true },
      ],
      paths: [],
    };
    const noWhere = { ...pathway('width-6ft'), zoneIds: [] };
    const brief = (targetZoneIds: string[]) => ({ ...emptyBrief(), targetZoneIds, elements: [noWhere] });
    expect(footprintHint(brief(['walk']), report, true, scene)?.elementId).toBe('el');
    // Only lawn picked: the lawn may already change, nothing to grow from.
    expect(footprintHint(brief(['grass']), report, true, scene)).toBeNull();
    // Without the scene only the element's own "Where" counts.
    expect(footprintHint(brief(['walk']), report)).toBeNull();
  });

  it('outside changes touch the run’s area when they sit at its edge', () => {
    const target = { zones: [{ id: 'walk', label: 'Walk', kind: 'walkway' as const, polygon: [{ x: 700, y: 700 }, { x: 900, y: 700 }, { x: 900, y: 1200 }, { x: 700, y: 1200 }] }], paths: [] };
    const photo = { width: 1600, height: 1200 };
    expect(changesTouchArea([{ x: 905, y: 900, w: 40, h: 40 }], target, photo)).toBe(true);
    expect(changesTouchArea([{ x: 420, y: 380, w: 90, h: 70 }], target, photo)).toBe(false);
    expect(changesTouchArea(undefined, target, photo)).toBeUndefined();
    expect(changesTouchArea([], undefined, photo)).toBeUndefined();
  });
});

describe('hand-off log', () => {
  const now = new Date(2026, 9, 13, 15, 0).getTime();

  it('counts today per app, dedupes repeat sends of one item and prunes old entries', () => {
    let log = appendEntry([], { app: 'chatgpt', at: now - 8 * 24 * 3600 * 1000 });
    log = appendEntry(log, { app: 'chatgpt', at: startOfDay(now) - 1000 });
    log = appendEntry(log, { app: 'chatgpt', at: now - 60_000, plannedId: 'a' });
    log = appendEntry(log, { app: 'chatgpt', at: now, plannedId: 'a' });
    log = appendEntry(log, { app: 'gemini', at: now, plannedId: 'b' });
    expect(log).toHaveLength(3);
    expect(countToday(log, 'chatgpt', now)).toBe(1);
    expect(countToday(log, 'gemini', now)).toBe(1);
    expect(wasSent(log, 'a')).toBe(true);
    expect(wasSent(log, 'zzz')).toBe(false);
    expect(usageHint('chatgpt', 6)).toBe('6 hand-offs to ChatGPT today');
    expect(usageHint('gemini', 0)).toBeNull();
  });
});

describe('review copy', () => {
  it('words the hand-off count for one chat or several', () => {
    expect(handoffFooter(1)).toBe('1 hand-off — start a new chat for it.');
    expect(handoffFooter(3)).toBe('3 hand-offs — each in a new chat. You can do some now and the rest later.');
  });

  it('notes a plan made without Claude calmly, with no setup details', () => {
    expect(TEMPLATE_PLAN_NOTE).toMatch(/^Planned from your choices/);
    expect(TEMPLATE_PLAN_NOTE).toContain('(optional)');
    expect(TEMPLATE_PLAN_NOTE).not.toMatch(/ANTHROPIC|\.env|isn’t connected|restart/);
  });
});
