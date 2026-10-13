/**
 * Variation titles for template plans (no Claude on the server). The title
 * names the variation once it is accepted, so it says what the result shows:
 * the element and the options the homeowner picked over the defaults
 * ("Pathway · Large flagstone slabs"), else their own words ("Your brief"
 * only for an empty brief). The request carries option prompt texts only; their short
 * labels come from the built-in element catalog (tailored options have none).
 */
import type { PlanRequest } from '../../shared/api';
import { ELEMENT_DEFS } from '../../src/assets/design/elements';

type Brief = PlanRequest['brief'];

const MAX_TITLE = 60;
/** Option labels shown after the element (the most distinctive picks). */
const MAX_DETAILS = 2;

let catalog: Map<string, { label: string; isDefault: boolean }> | null = null;

/** A built-in option's label by element type + prompt text (undefined for tailored / unknown options). */
function builtInOption(type: string, promptText: string): { label: string; isDefault: boolean } | undefined {
  catalog ??= new Map(
    ELEMENT_DEFS.flatMap((def) =>
      def.dimensions.flatMap((dim) => dim.options.map((o) => [`${def.type}\n${o.promptText.trim()}`, { label: o.label, isDefault: o.id === dim.defaultOptionId }] as const)),
    ),
  );
  return catalog.get(`${type}\n${promptText.trim()}`);
}

/** One line, at most `max` characters, cut at a word with "…". */
function clip(text: string, max: number): string {
  const t = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Large flagstone slabs" → "large flagstone slabs" mid-list; "LED strip" stays. */
const midList = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** What one template variation of this brief shows, e.g. "Pathway · Gray granite, large flagstone slabs". */
export function briefTitle(brief: Brief): string {
  const prompt = clip(brief.prompt, 48);
  const elements = brief.elements.filter((e) => e.label.trim());
  if (!elements.length) return prompt ? capitalize(prompt) : 'Your brief';
  const names = elements.map((e) => clip(e.label, 28));
  const subject = names.length <= 2 ? names.join(' & ') : `${names[0]} & ${names.length - 1} more`;

  // The homeowner's picks (options other than the preselected defaults) say most; else the first default.
  const picked: string[] = [];
  const defaults: string[] = [];
  for (const el of elements) {
    for (const choice of el.choices) {
      for (const text of choice.options) {
        const option = builtInOption(el.type, text);
        if (option) (option.isDefault ? defaults : picked).push(option.label);
      }
    }
  }
  const details = [...new Set(picked.length ? picked : prompt ? [] : defaults.slice(0, 1))].slice(0, MAX_DETAILS);
  let title = subject;
  details.forEach((label, i) => {
    const next = i === 0 ? `${subject} · ${label}` : `${title}, ${midList(label)}`;
    if (next.length <= MAX_TITLE) title = next;
  });
  if (title === subject && prompt) title = clip(`${subject} · ${prompt}`, MAX_TITLE);
  return title;
}

/**
 * Titles for `count` template variations: the brief's title, told apart by
 * each take's short name ("… (softer, naturalistic)") or a number when the
 * instructions are identical (strict), and never repeated.
 */
export function variationTitles(brief: Brief, takes: readonly string[] | null, count: number): string[] {
  const base = briefTitle(brief);
  if (count <= 1) return [base];
  const seen = new Map<string, number>();
  return Array.from({ length: count }, (_, i) => {
    const take = takes?.[i % takes.length]?.replace(/,?\s*take$/i, '').trim().toLowerCase();
    const title = take ? `${base} (${take})` : `${base} (${i + 1})`;
    const n = (seen.get(title) ?? 0) + 1;
    seen.set(title, n);
    return n > 1 ? `${title} ${n}` : title;
  });
}
