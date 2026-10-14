/**
 * A note under the prompt dock when the typed idea asks for something a
 * Pathway question still answers with its "Keep current" / "No …" default
 * ("a wider walk" while Width says Keep current). The template plan already
 * drops the contradicting clause from the instruction; the note exists
 * because the room the outline leaves for a wider or re-routed walk comes
 * from the card's choice, not from the words. One note per card (its asks
 * joined into one sentence), shown in the dock's hint line so the dock — and
 * the photo pane above it — keep their height.
 */
import { isKeepOrNone, promptAsks, type PromptAskDimension } from '../../../shared/promptAsks';
import type { DesignBrief } from '../../../shared/types';
import { chosenOptions } from './planRequest';

export interface PromptNudge {
  /** `${elementId}:${dimensionId}` — what a dismissal remembers. */
  key: string;
  elementId: string;
  elementLabel: string;
  ask: PromptAskDimension;
}

export interface PromptNote {
  /** Every nudge key the note covers (a dismissal closes them all). */
  keys: string[];
  elementId: string;
  elementLabel: string;
  text: string;
}

/** Element types whose keep / no defaults the dock checks against the typed idea. */
const NUDGED_TYPES = new Set(['pathway']);

/**
 * The Pathway questions the typed idea asks for while they are still on a
 * keep / no answer (or unanswered), in card order; `dismissed` holds the keys
 * the owner closed.
 */
export function promptNudges(brief: DesignBrief, dismissed: ReadonlySet<string> = new Set()): PromptNudge[] {
  const asks = promptAsks(brief.prompt);
  if (asks.size === 0) return [];
  const out: PromptNudge[] = [];
  for (const el of brief.elements) {
    if (!NUDGED_TYPES.has(el.type)) continue;
    const card = el.label.trim() || 'Pathway';
    for (const dim of el.dimensions) {
      const ask = dim.label.trim().toLowerCase() as PromptAskDimension;
      if (!asks.has(ask)) continue;
      const key = `${el.id}:${dim.id}`;
      if (dismissed.has(key)) continue;
      if (!chosenOptions(el, dim).every((o) => isKeepOrNone(o.promptText))) continue;
      out.push({ key, elementId: el.id, elementLabel: card, ask });
    }
  }
  return out;
}

function joinList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function shapeWord(prompt: string): string {
  if (/\bcurv/i.test(prompt)) return 'curved';
  if (/\bmeander/i.test(prompt)) return 'meandering';
  if (/\bwind(?:s|ing)?\b/i.test(prompt)) return 'winding';
  if (/\bangled\b/i.test(prompt)) return 'angled';
  if (/\bre-?rout/i.test(prompt)) return 're-routed';
  return 'straight';
}

function widthWord(prompt: string): string {
  const feet = prompt.match(/\b(\d+(?:\.\d+)?)\s*-?\s*(?:ft|feet|foot)\b/i);
  if (feet) return `${feet[1]} ft`;
  return /\bnarrow/i.test(prompt) && !/\bwide[nr]/i.test(prompt) ? 'narrower' : 'wider';
}

const QUESTION: Record<PromptAskDimension, string> = {
  width: 'a width',
  shape: 'a shape',
  'path lighting': 'a light style',
  edging: 'an edging',
};

/**
 * One sentence for the first card with nudges: "Your idea mentions a wider
 * walk — pick a width on the Pathway card so Mode leaves room for it." /
 * "… a wider, curved walk and path lights — pick a width, a shape and a light
 * style on the Pathway card so Mode leaves room for them." Null without nudges.
 */
export function promptNote(brief: DesignBrief, dismissed: ReadonlySet<string> = new Set()): PromptNote | null {
  const all = promptNudges(brief, dismissed);
  if (all.length === 0) return null;
  const first = all[0];
  const nudges = all.filter((n) => n.elementId === first.elementId);
  const has = (a: PromptAskDimension) => nudges.some((n) => n.ask === a);
  const prompt = brief.prompt;
  const mentions: string[] = [];
  if (has('width') || has('shape')) {
    const width = has('width') ? widthWord(prompt) : '';
    const shape = has('shape') ? shapeWord(prompt) : '';
    const words = width && shape ? (/ ft$/.test(width) ? `${width} ${shape}` : `${width}, ${shape}`) : width || shape;
    mentions.push(`${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words} walk`);
  }
  if (has('edging')) mentions.push('the walk’s edge');
  if (has('path lighting')) mentions.push('path lights');
  const room = has('width') || has('shape');
  const narrowOnly = has('width') && !has('shape') && widthWord(prompt) === 'narrower';
  const why = room && !narrowOnly ? `so Mode leaves room for ${nudges.length > 1 ? 'them' : 'it'}` : 'so the instruction says exactly which';
  return {
    keys: nudges.map((n) => n.key),
    elementId: first.elementId,
    elementLabel: first.elementLabel,
    text: `Your idea mentions ${joinList(mentions)} — pick ${joinList(nudges.map((n) => QUESTION[n.ask]))} on the ${first.elementLabel} card ${why}.`,
  };
}
