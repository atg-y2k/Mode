import { describe, expect, it } from 'vitest';
import { emptyBrief, type Generation, type Photo } from '../../../../shared/types';
import { pendingRunsNote } from './ScenePanel';

const run = (id: string, extra: Partial<Generation> = {}): Generation => ({
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
  ...extra,
});
const photo = (generations: Generation[]) => ({ generations }) as unknown as Photo;

describe('Re-map / Clear map dialogs and pending runs', () => {
  it('say that pending runs keep their original areas (and which older ones cannot)', () => {
    expect(pendingRunsNote(photo([run('done', { status: 'done' })]))).toBe('');
    const waiting = run('w', { planned: [{ id: 'p', title: 'T', brief: 'B', status: 'awaiting-handoff' }], target: { zones: [], paths: [] } });
    expect(pendingRunsNote(photo([waiting]))).toBe(' The run still waiting for a hand-off or rendering keeps its original areas.');
    const legacy = run('l', { planned: [{ id: 'p', title: 'T', brief: 'B', status: 'staged' }] });
    expect(pendingRunsNote(photo([waiting, { ...waiting, id: 'w2' }, legacy]))).toBe(
      " The 2 runs still waiting for a hand-off or rendering keep their original areas. 1 run from before this version still waiting can't use the old areas after this — start it again.",
    );
  });
});
