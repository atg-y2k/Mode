/**
 * What a typed idea plainly asks for, per element question.
 *
 * Several element questions default to keeping what is photographed
 * ("keeping its current width") or to adding nothing ("with no added path
 * lighting"). A typed idea such as "a wider curved walk with warm path lights"
 * contradicts those defaults: the template plan drops the keep / no clause
 * the idea overrides (server/studio/prompts.ts), and the Studio nudges the
 * owner to pick an option on the card, because the room the outline leaves
 * for a wider or re-routed walk comes from the choice, not from the words
 * (src/ui/studio/PromptDock.tsx).
 */

export type PromptAskDimension = 'width' | 'shape' | 'path lighting' | 'edging';

export interface PromptAsk {
  /** The element question's label, lower-cased ("Width" → 'width'). */
  dimension: PromptAskDimension;
  pattern: RegExp;
}

/** Ordered as the Pathway card asks them. */
export const PROMPT_ASKS: readonly PromptAsk[] = [
  {
    dimension: 'shape',
    // "curved", "winding", "meandering", "straight", "re-route", "angled" — not "window".
    pattern: /\b(?:curv\w*|wind(?:s|ing)?\b|meander\w*|straight\w*|re-?rout\w*|angled\b)/i,
  },
  {
    dimension: 'width',
    // "wider", "widen", "narrower", "5 ft wide", "a 5 ft path".
    pattern:
      /\b(?:wider|widen\w*|broader|narrower|narrow(?:ed|ing)?)\b|\b\d+(?:\.\d+)?\s*-?\s*(?:ft|feet|foot)\b(?:\s*-?\s*wide\b|(?=\s+(?:[a-z]+\s+){0,2}(?:walk|walkway|path|pathway)\b))/i,
  },
  {
    dimension: 'edging',
    pattern: /\b(?:edging|edged|border(?:s|ed)?|curb(?:s|ing)?|kerb\w*)\b|\balong (?:the|its|both) edges?\b/i,
  },
  {
    dimension: 'path lighting',
    pattern:
      /\b(?:path|walk|walkway)\s*-?\s*light(?:s|ing)?\b|\blanterns?\b|\bbollards?\b|\blights?\s+(?:along|lining|beside)\s+(?:the\s+)?(?:walk|path)/i,
  },
];

/** A chosen option that keeps what is photographed or asks for the absence of something. */
const KEEP_OR_NONE = /^(?:keeping\b|(?:with )?no\b|without\b)/i;

export function isKeepOrNone(promptText: string): boolean {
  return KEEP_OR_NONE.test(promptText.trim());
}

/** The asks (by dimension label) the typed idea makes; empty when it names none of them. */
export function promptAsks(prompt: string): Set<PromptAskDimension> {
  const out = new Set<PromptAskDimension>();
  const text = prompt.trim();
  if (!text) return out;
  for (const ask of PROMPT_ASKS) if (ask.pattern.test(text)) out.add(ask.dimension);
  return out;
}

/** True when the typed idea asks for the question labelled `dimensionLabel` ("Width", "Path lighting"…). */
export function promptAsksFor(prompt: string, dimensionLabel: string): boolean {
  const ask = PROMPT_ASKS.find((a) => a.dimension === dimensionLabel.trim().toLowerCase());
  return !!ask && ask.pattern.test(prompt);
}

/**
 * An earlier instruction minus the keep / no clauses new words override — for
 * a refinement ("make the walk wider") of a result whose instruction still says
 * "width: keeping its current width" or "No border edging and no added path
 * lighting.". Other text is left exactly as it was.
 */
export function withoutOverriddenText(text: string, prompt: string): string {
  const asks = PROMPT_ASKS.filter((a) => a.pattern.test(prompt));
  if (asks.length === 0) return text;
  let out = text;
  for (const { dimension } of asks) {
    const answer = `${dimension}: (?:keeping|with no|no|without)\\b[^;.]*`;
    out = out.replace(new RegExp(`;\\s*${answer}(?=[;.])`, 'gi'), '').replace(new RegExp(`\\b${answer}(?:;\\s*|(?=\\.))`, 'gi'), '');
  }
  // An element left with no answers: "Pathway — ." → "Pathway.".
  out = out.replace(/\s+—\s*(?=\.)/g, '');
  // Closing "No … and no …." clauses: drop the parts the new words ask for.
  out = out.replace(/(?<=^|[.!?]\s)((?:No|Without)\b[^.]*)\./g, (whole, clause: string) => {
    const parts = clause.split(/\s+and\s+(?=(?:no|without)\b)/i);
    const kept = parts.filter((p) => !asks.some((a) => a.pattern.test(p)));
    if (kept.length === parts.length) return whole;
    const joined = kept.join(' and ');
    return joined ? `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.` : '';
  });
  return out.replace(/ {2,}/g, ' ').trim();
}

/**
 * The element's choices minus the keep / no options the typed idea overrides
 * (a positive choice is never removed; a question left with nothing is dropped).
 */
export function withoutOverriddenDefaults<C extends { dimension: string; options: readonly string[] }>(prompt: string, choices: readonly C[]): C[] {
  if (!prompt.trim()) return [...choices];
  const out: C[] = [];
  for (const c of choices) {
    if (!promptAsksFor(prompt, c.dimension)) {
      out.push(c);
      continue;
    }
    const options = c.options.filter((o) => !isKeepOrNone(o));
    if (options.length) out.push(options.length === c.options.length ? c : { ...c, options });
  }
  return out;
}
