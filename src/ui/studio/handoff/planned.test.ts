import { describe, expect, it } from 'vitest';
import { emptyBrief, type AlignmentReport, type Generation, type Photo, type PlannedVariation } from '../../../../shared/types';
import { appendEntry, countToday, startOfDay, usageHint, wasSent } from './log';
import {
  alignmentSummary,
  assignTargets,
  pendingHandoffs,
  rollupStatus,
  sourceLabel,
  sourceTag,
  type PendingItem,
} from './planned';
import { runTiles } from '../tiles';

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
    expect(assignTargets(pending, { photoId: 'pho', generationId: 'new', plannedId: 'n3' }, 3).map(ref)).toEqual(['n3', 'n1', 'o1']);
    expect(assignTargets(pending, null, 1).map(ref)).toEqual(['n1']);
    expect(assignTargets(pending, null, 5).map(ref)).toEqual(['n1', 'o1']);
    const onlyStaged = pendingHandoffs(photoWith([gen('g', [item('s', 'staged')])]));
    expect(assignTargets(onlyStaged, null, 1).map(ref)).toEqual(['s']);
    expect(assignTargets(pending, null, 0)).toEqual([]);
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
    expect(alignmentSummary({ ...report, driftAfter: 9 })).toMatchObject({ tone: 'warning', warn: true });
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
