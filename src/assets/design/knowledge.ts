/**
 * Compact, deterministic text of the design knowledge base for Claude system
 * prompts. It is part of a prompt-cached prefix, so it must not vary between
 * calls: fixed ordering, no dates, no randomness — memoized.
 */
import { FEASIBILITY_RULES } from './feasibility';
import { ELEMENT_DEFS } from './elements';
import { ELEMENT_GUIDANCE } from './guidance';
import { ARCHITECTURAL_STYLES } from './styles';
import { DESIGN_THEMES } from './themes';

const SETTING_LABEL = { exterior: 'exterior', interior: 'interior', both: 'exterior & interior' } as const;

/** Composition principles shared by architects, landscape architects and interior designers. */
const PRINCIPLES = [
  'Purpose first: every change should serve how the space is used (arrival, gathering, privacy, maintenance) before how it looks.',
  'Respect the architecture: style, era, proportions and fixed materials (roof, brick, stone) set the palette and the vocabulary; work with them, not against them.',
  'Scale and proportion: size walks, beds, trees, lights and furniture to the facade or room (two-story houses need deeper beds, wider walks, bigger fixtures).',
  'A clear focal point: outside, the front door; inside, the fireplace, a view or a statement piece. Everything else supports it.',
  'Unity through repetition: repeat a few materials, colors and plants (odd-numbered groups of 3, 5, 7) rather than one of everything.',
  'Color 60-30-10: dominant, secondary and accent. Outside: body, trim, door/shutters. Warm with warm, cool with cool undertones.',
  'Layering: tall-back / mid / low-front in beds; ambient / task / accent in lighting; large / medium / small in furnishings.',
  'Light: warm white 2700–3000 K for homes, one color temperature per view, shielded fixtures, some darkness left at night.',
  'Feasibility: plants must suit the hardiness zone, the spot’s sun, the water available and the space at maturity; hardscape must meet basic code (riser 6–7.5 in, tread ≥ 11–12 in, rails at 4+ risers, guards over 30 in).',
];

/** Items joined on one line; trailing periods dropped so '; ' separators read cleanly. */
function line(label: string, items: readonly string[]): string {
  return items.length > 0 ? `  ${label}: ${items.map((i) => i.replace(/\.$/, '')).join('; ')}` : '';
}

function stylesSection(): string {
  const out = ['## Architectural styles (id | name | era | setting)'];
  for (const s of ARCHITECTURAL_STYLES) {
    out.push(`- ${s.id} | ${s.name} | ${s.era} | ${SETTING_LABEL[s.setting]}`);
    out.push(line('identify', s.identify));
    out.push(line('character', s.characteristics));
    out.push(line('palettes (body, trim, accent/door, shutter/roof)', s.palettes.map((p) => `${p.name} ${p.hexes.join(' ')}`)));
    out.push(line('materials', s.materials));
    out.push(line('landscape', s.landscape));
    out.push(line('lighting', s.lighting));
    out.push(line('avoid', s.avoid));
    out.push(line('themes', s.themes));
  }
  return out.filter(Boolean).join('\n');
}

function themesSection(): string {
  const out = ['## Design themes (id | name | setting)'];
  for (const t of DESIGN_THEMES) {
    out.push(`- ${t.id} | ${t.name} | ${SETTING_LABEL[t.setting]}`);
    out.push(`  purpose: ${t.purpose}`);
    out.push(line('principles', t.principles));
    out.push(line('palette', t.palette));
    out.push(line('materials', t.materials));
    out.push(line('plants', t.plants));
    out.push(line('lighting', t.lighting));
    out.push(line('suits', t.suits));
    if (t.climate) out.push(`  climate: ${t.climate}`);
    out.push(`  prompt: ${t.promptHint}`);
  }
  return out.filter(Boolean).join('\n');
}

function elementsSection(): string {
  const out = ['## Design elements (type | label | setting — choice dimensions)'];
  const guidance = new Map(ELEMENT_GUIDANCE.map((g) => [g.type, g]));
  for (const d of ELEMENT_DEFS) {
    out.push(`- ${d.type} | ${d.label} | ${SETTING_LABEL[d.setting]} — ${d.dimensions.map((dim) => dim.label.toLowerCase()).join(', ')}`);
    const g = guidance.get(d.type);
    if (!g) continue;
    out.push(`  purpose: ${g.purpose}`);
    out.push(line('rules', g.rulesOfThumb));
    out.push(line('architecture', g.relateToArchitecture));
  }
  return out.join('\n');
}

let cached: string | undefined;

/**
 * Compact, deterministic text of the styles, themes and element guidance for
 * Claude system prompts (prompt-cached, so it must not vary between calls).
 */
export function designKnowledgeForAI(): string {
  if (cached === undefined) {
    cached = [
      '# Design knowledge base',
      'Use it to read the architecture (match styleId to an id below), choose themes with a purpose, size and place elements, and keep plants feasible.',
      '## Principles',
      ...PRINCIPLES.map((p) => `- ${p}`),
      '## Plant feasibility rules',
      ...FEASIBILITY_RULES.map((r) => `- ${r}`),
      stylesSection(),
      themesSection(),
      elementsSection(),
    ].join('\n');
  }
  return cached;
}
