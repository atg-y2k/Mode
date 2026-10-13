/**
 * Inspiration images that go with a hand-off as Image 2, 3, … (pure).
 *
 * Only the idea-board images the brief explicitly picked (brief.ideaItemIds)
 * — never the whole board — and only when the app can use them: Gemini on
 * the Free plan routes to the Lite model, which isn't designed for multiple
 * image references, so none are attached there (see prefs.referencesAllowed).
 * Each reference gets one job, named by its role in the prompt ("Image 2 is
 * only a reference for …: copy its color and texture, not its layout…"); the
 * companion shows the very same sentence next to each "Copy reference"
 * button, so what the user pastes always matches the prompt.
 */
import type { DesignBrief, HandoffApp, IdeaItem } from '../../../../shared/types';
import { MAX_REFERENCES, referenceSentences } from '../../../handoff/prompts';
import { referencesAllowed, type GeminiPlan } from './prefs';

export interface HandoffReference {
  /** 2 for Image 2, … */
  n: number;
  itemId: string;
  /** Blob of the idea image (≤ 1024 px). */
  imageId: string;
  title: string;
  /** Role as the prompt names it ("the materials and colors in “Bluestone patio”"). */
  role: string;
  /** The prompt's sentence about this image. */
  sentence: string;
}

function clipTitle(title: string, max = 60): string {
  const t = title.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** What a reference image is for, in prompt words. */
export function referenceRole(item: Pick<IdeaItem, 'kind' | 'title'>): string {
  const title = clipTitle(item.title) || 'this inspiration image';
  if (item.kind === 'product') return `the ${title.replace(/^(the|a|an)\s+/i, '')}`;
  return `the materials and colors in “${title}”`;
}

/** Idea items of the brief that can be attached as images (images and products with a picture), in brief order. */
export function referenceItems(board: readonly IdeaItem[], brief: Pick<DesignBrief, 'ideaItemIds'>): IdeaItem[] {
  const byId = new Map(board.map((i) => [i.id, i]));
  const out: IdeaItem[] = [];
  for (const id of brief.ideaItemIds) {
    const item = byId.get(id);
    if (!item?.imageId || (item.kind !== 'image' && item.kind !== 'product')) continue;
    if (out.some((o) => o.id === item.id)) continue;
    out.push(item);
    if (out.length >= MAX_REFERENCES) break;
  }
  return out;
}

/** The references for a hand-off to `app` ([] when the app / plan can't take them). */
export function handoffReferences(board: readonly IdeaItem[], brief: Pick<DesignBrief, 'ideaItemIds'>, app: HandoffApp, plan: GeminiPlan | null): HandoffReference[] {
  if (!referencesAllowed(app, plan)) return [];
  const items = referenceItems(board, brief);
  const roles = items.map(referenceRole);
  const sentences = referenceSentences(app, roles);
  return items.map((item, i) => ({ n: i + 2, itemId: item.id, imageId: item.imageId as string, title: item.title, role: roles[i], sentence: sentences[i] }));
}

/** Idea images the brief picked that a Gemini Free hand-off leaves out (for the warning). */
export function droppedReferenceCount(board: readonly IdeaItem[], brief: Pick<DesignBrief, 'ideaItemIds'>, app: HandoffApp, plan: GeminiPlan | null): number {
  return referencesAllowed(app, plan) ? 0 : referenceItems(board, brief).length;
}
