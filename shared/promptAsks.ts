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
 *
 * Words that say to leave something as it is ask for nothing: "no wider than
 * today", "don't widen it" and "keep it straight" agree with the defaults.
 */

export type PromptAskDimension = 'width' | 'shape' | 'path lighting' | 'edging';

export interface PromptAsk {
  /** The element question's label, lower-cased ("Width" → 'width'). */
  dimension: PromptAskDimension;
  pattern: RegExp;
  /**
   * The question's default keeps what is photographed ("keeping its current
   * width") rather than adding nothing ("with no border edging"): "keep it
   * straight" agrees with a keep default, while "keep the brick border" asks
   * for what a "no …" default leaves out.
   */
  keepDefault: boolean;
}

/** Element types whose keep / no defaults the typed idea overrides: the asks below are the Pathway's questions. */
export const NUDGED_TYPES: ReadonlySet<string> = new Set(['pathway']);

/** Ordered as the Pathway card asks them. */
export const PROMPT_ASKS: readonly PromptAsk[] = [
  {
    dimension: 'shape',
    // "curved", "winding", "meandering", "straight", "re-route", "angled", "arcing", "sweeping", "serpentine",
    // "S-shaped" — not "window", "search" or "archway".
    pattern:
      /\b(?:curv\w*|wind(?:s|ing)?\b|meander\w*|straight\w*|re-?rout\w*|angled\b|arc(?:s|ed|ing)?\b|sweeping\b|serpentine\b|s-(?:shaped?|curve[sd]?)\b)/i,
    keepDefault: true,
  },
  {
    dimension: 'width',
    // "wider", "widen", "narrower", "wide enough", "twice as wide", "5 ft wide", "a 5 ft path".
    pattern:
      /\b(?:wider|widen\w*|broader|narrower|narrow(?:ed|ing)?|wide\s+enough|twice\s+as\s+wide)\b|\b\d+(?:\.\d+)?\s*-?\s*(?:ft|feet|foot)\b(?:\s*-?\s*wide\b|(?=\s+(?:[a-z]+\s+){0,2}(?:walk|walkway|path|pathway)\b))/i,
    keepDefault: true,
  },
  {
    dimension: 'edging',
    pattern: /\b(?:edging|edged|border(?:s|ed)?|curb(?:s|ing)?|kerb\w*)\b|\balong (?:the|its|both) edges?\b/i,
    keepDefault: false,
  },
  {
    dimension: 'path lighting',
    // "path lights", "lanterns", "bollards", "lights / lighting / lamp posts along the walk".
    pattern:
      /\b(?:path|walk|walkway)\s*-?\s*light(?:s|ing)?\b|\blanterns?\b|\bbollards?\b|\b(?:lighting|lights?|lamp\s*-?\s*posts?|lamps?)\s+(?:along|lining|beside)\s+(?:the\s+)?(?:walk|path)/i,
    keepDefault: false,
  },
];

/** A word that turns the match after it into no ask ("no wider", "not curved", "don't widen", "never straight"). */
const NEGATION = /^(?:no|not|never|without|cannot|dont|\w+n['’]t)$/i;
/** "keep it straight", "the same curve": no ask where the default keeps what is there. */
const KEEPING = /^(?:keep(?:s|ing)?|same)$/i;
/** How far back those words reach: three words, and not past a clause break or "but" ("no border, but wider"). */
const LOOK_BACK = 3;
const CLAUSE_BREAK = /[,;:.!?()—–]|\bbut\b/i;
/** Reads the same after a negation: "not wide enough" still asks for a width. */
const NEGATION_PROOF = /^wide\s+enough\b/i;

function negated(ask: PromptAsk, before: string): boolean {
  const clause = before.split(CLAUSE_BREAK).pop() ?? '';
  const words = clause
    .split(/\s+/)
    .filter(Boolean)
    .slice(-LOOK_BACK)
    .map((w) => w.replace(/^["'“‘]+|["”]+$/g, ''));
  return words.some((w) => NEGATION.test(w) || (ask.keepDefault && KEEPING.test(w)));
}

/** The matches of `ask` the text means as asks (in order): each one not negated by a word just before it. */
function askMatches(ask: PromptAsk, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(ask.pattern.source, `${ask.pattern.flags}g`))) {
    if (NEGATION_PROOF.test(m[0]) || !negated(ask, text.slice(0, m.index))) out.push(m[0]);
  }
  return out;
}

function asks(ask: PromptAsk, text: string): boolean {
  return askMatches(ask, text).length > 0;
}

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
  for (const ask of PROMPT_ASKS) if (asks(ask, text)) out.add(ask.dimension);
  return out;
}

/** True when the typed idea asks for the question labelled `dimensionLabel` ("Width", "Path lighting"…). */
export function promptAsksFor(prompt: string, dimensionLabel: string): boolean {
  const ask = PROMPT_ASKS.find((a) => a.dimension === dimensionLabel.trim().toLowerCase());
  return !!ask && asks(ask, prompt);
}

/** The words the typed idea asks for `dimension` with ("wider", "5 ft wide", "curved"), in order; empty when it doesn't. */
export function askedWords(prompt: string, dimension: PromptAskDimension): string[] {
  const ask = PROMPT_ASKS.find((a) => a.dimension === dimension);
  return ask ? askMatches(ask, prompt) : [];
}

/**
 * An earlier instruction minus the keep / no clauses new words override — for
 * a refinement ("make the walk wider") of a result whose instruction still says
 * "width: keeping its current width" or "No border edging and no added path
 * lighting.". Other text is left exactly as it was.
 */
export function withoutOverriddenText(text: string, prompt: string): string {
  const overridden = PROMPT_ASKS.filter((a) => asks(a, prompt));
  if (overridden.length === 0) return text;
  let out = text;
  for (const { dimension } of overridden) {
    const answer = `${dimension}: (?:keeping|with no|no|without)\\b[^;.]*`;
    out = out.replace(new RegExp(`;\\s*${answer}(?=[;.])`, 'gi'), '').replace(new RegExp(`\\b${answer}(?:;\\s*|(?=\\.))`, 'gi'), '');
  }
  // An element left with no answers: "Pathway — ." → "Pathway.".
  out = out.replace(/\s+—\s*(?=\.)/g, '');
  // Closing "No … and no …." clauses: drop the parts the new words ask for.
  out = out.replace(/(?<=^|[.!?]\s)((?:No|Without)\b[^.]*)\./g, (whole, clause: string) => {
    const parts = clause.split(/\s+and\s+(?=(?:no|without)\b)/i);
    // The clause's own "no" is what it says, not a negated ask: match the bare pattern.
    const kept = parts.filter((p) => !overridden.some((a) => a.pattern.test(p)));
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
