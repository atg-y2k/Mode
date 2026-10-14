import * as Lucide from 'lucide-react';
import { describe, expect, it } from 'vitest';
import type { ElementDimensionDraft } from '../../../shared/api';
import { DECOR_FORMS, FIXTURE_FORMS, PLANT_FORMS } from '../../../shared/art';
import {
  ELEMENT_TYPES,
  TEXTURE_PATTERNS,
  ZONE_KINDS,
  type ElementDimension,
  type OptionVisual,
  type SceneMap,
  type SceneZone,
} from '../../../shared/types';
import {
  ARCHITECTURAL_STYLES,
  DESIGN_THEMES,
  DIAGRAM_IDS,
  ELEMENT_DEFS,
  ELEMENT_GUIDANCE,
  designKnowledgeForAI,
  elementsForSetting,
  getElementDef,
  getStyle,
  getTheme,
  guidanceFor,
  mergeDimensions,
  newElementSpec,
  optionVisualFromDraft,
  swatchSpanIn,
  themesFor,
} from './index';
import { plantOptionKeys } from './elements';
import { PLANT_PROFILES } from './plants';

const HEX = /^#[0-9a-f]{6}$/i;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function allOptions() {
  return ELEMENT_DEFS.flatMap((def) => def.dimensions.flatMap((dim) => dim.options.map((o) => ({ def, dim, o }))));
}

function checkVisual(v: OptionVisual, where: string) {
  switch (v.kind) {
    case 'texture': {
      const t = v.texture;
      expect(TEXTURE_PATTERNS, where).toContain(t.pattern);
      expect(t.unitWidthIn, where).toBeGreaterThan(0);
      expect(t.unitHeightIn, where).toBeGreaterThan(0);
      expect(Number.isFinite(t.unitWidthIn) && Number.isFinite(t.unitHeightIn), where).toBe(true);
      expect(t.colors.length, where).toBeGreaterThan(0);
      for (const c of t.colors) expect(c, where).toMatch(HEX);
      expect(t.variation, where).toBeGreaterThanOrEqual(0);
      expect(t.variation, where).toBeLessThanOrEqual(1);
      expect(Number.isInteger(t.seed), where).toBe(true);
      if (t.joint) {
        expect(t.joint.color, where).toMatch(HEX);
        expect(t.joint.widthIn, where).toBeGreaterThan(0);
      }
      break;
    }
    case 'color':
      expect(v.hex, where).toMatch(HEX);
      break;
    case 'colors':
      expect(v.hexes.length, where).toBeGreaterThan(0);
      for (const c of v.hexes) expect(c, where).toMatch(HEX);
      break;
    case 'diagram':
      expect(Object.keys(DIAGRAM_IDS), where).toContain(v.diagram);
      break;
    case 'art': {
      const a = v.art;
      if (a.kind === 'plant') {
        expect(PLANT_FORMS, where).toContain(a.form);
        expect(a.foliage, where).toMatch(HEX);
      } else if (a.kind === 'fixture') {
        expect(FIXTURE_FORMS, where).toContain(a.form);
        expect(a.finish, where).toMatch(HEX);
      } else {
        expect(DECOR_FORMS, where).toContain(a.form);
        expect(a.color, where).toMatch(HEX);
      }
      break;
    }
    case 'image':
      throw new Error(`${where}: built-in options must not reference blob images`);
  }
}

describe('ELEMENT_DEFS', () => {
  it('has exactly one def per ElementType, in ELEMENT_TYPES order', () => {
    expect(ELEMENT_DEFS.map((d) => d.type)).toEqual([...ELEMENT_TYPES]);
    for (const t of ELEMENT_TYPES) expect(getElementDef(t).type).toBe(t);
  });

  it('every def has 2–6 dimensions of 3–6 options, with unique kebab-case ids', () => {
    for (const def of ELEMENT_DEFS) {
      expect(def.dimensions.length, def.type).toBeGreaterThanOrEqual(2);
      expect(def.dimensions.length, def.type).toBeLessThanOrEqual(6);
      const dimIds = def.dimensions.map((d) => d.id);
      expect(new Set(dimIds).size, def.type).toBe(dimIds.length);
      for (const dim of def.dimensions) {
        const where = `${def.type}/${dim.id}`;
        expect(dim.id, where).toMatch(KEBAB);
        expect(dim.label.trim(), where).not.toBe('');
        expect(dim.question.trim(), where).not.toBe('');
        expect(dim.options.length, where).toBeGreaterThanOrEqual(3);
        expect(dim.options.length, where).toBeLessThanOrEqual(6);
        const ids = dim.options.map((o) => o.id);
        expect(new Set(ids).size, where).toBe(ids.length);
        for (const id of ids) expect(id, where).toMatch(KEBAB);
        const labels = dim.options.map((o) => o.label.toLowerCase());
        expect(new Set(labels).size, where).toBe(labels.length);
      }
    }
  });

  it("every dimension's defaultOptionId exists", () => {
    for (const def of ELEMENT_DEFS) {
      for (const dim of def.dimensions) {
        if (dim.defaultOptionId === undefined) continue;
        expect(dim.options.map((o) => o.id), `${def.type}/${dim.id}`).toContain(dim.defaultOptionId);
      }
    }
  });

  it('every option has description, prompt text, rationale and a valid visual', () => {
    for (const { def, dim, o } of allOptions()) {
      const where = `${def.type}/${dim.id}/${o.id}`;
      expect(o.label.trim(), where).not.toBe('');
      expect(o.description.trim(), where).not.toBe('');
      expect(o.promptText.trim().length, where).toBeGreaterThan(3);
      expect(o.rationale?.trim(), where).toBeTruthy();
      expect(o.visual, where).toBeDefined();
      checkVisual(o.visual as OptionVisual, where);
    }
  });

  it('references only diagram ids from DIAGRAM_IDS, and every listed diagram is used', () => {
    const used = new Set(allOptions().flatMap(({ o }) => (o.visual?.kind === 'diagram' ? [o.visual.diagram] : [])));
    for (const id of used) expect(DIAGRAM_IDS, id).toHaveProperty(id);
    for (const id of Object.keys(DIAGRAM_IDS)) expect(used.has(id), `unused diagram ${id}`).toBe(true);
    for (const [id, text] of Object.entries(DIAGRAM_IDS)) expect(text.length, id).toBeGreaterThan(10);
  });

  it('uses real lucide icon names, valid zone kinds and settings', () => {
    const icons = Lucide as unknown as Record<string, unknown>;
    for (const def of ELEMENT_DEFS) {
      expect(icons[def.icon], `${def.type} icon ${def.icon}`).toBeTruthy();
      expect(['exterior', 'interior', 'both']).toContain(def.setting);
      for (const k of def.zoneKinds) expect(ZONE_KINDS, def.type).toContain(k);
    }
  });

  it('gives the pathway the stone-size question the user asked for, with visibly different unit sizes', () => {
    const size = getElementDef('pathway').dimensions.find((d) => d.id === 'stone-size') as ElementDimension;
    const tex = size.options.map((o) => (o.visual?.kind === 'texture' ? o.visual.texture : null));
    expect(tex.every(Boolean)).toBe(true);
    const byId = Object.fromEntries(size.options.map((o, i) => [o.id, tex[i]!]));
    expect(byId['large-flagstone'].pattern).toBe('flagstone');
    expect(byId['large-flagstone'].unitWidthIn).toBeGreaterThanOrEqual(18);
    expect(byId['medium-pavers'].pattern).toBe('stone-pavers');
    expect(byId['medium-pavers'].unitWidthIn).toBeGreaterThanOrEqual(12);
    expect(byId['medium-pavers'].unitWidthIn).toBeLessThanOrEqual(16);
    expect(byId['small-cobbles'].pattern).toBe('cobblestone');
    expect(byId['small-cobbles'].unitWidthIn).toBe(4);
    expect(byId['pea-gravel'].pattern).toBe('gravel');
    expect(byId['pea-gravel'].unitWidthIn).toBeLessThan(1);
    const span = swatchSpanIn(size);
    expect(span).toBeGreaterThan(byId['large-flagstone'].unitWidthIn);
  });

  it('defaults keep what is photographed: no new route, width, railing or trim, and lighting shown by day', () => {
    const dim = (type: Parameters<typeof getElementDef>[0], id: string) => getElementDef(type).dimensions.find((d) => d.id === id) as ElementDimension;
    const shape = dim('pathway', 'shape');
    expect(shape.defaultOptionId).toBe('keep-route');
    const keepRoute = shape.options.find((o) => o.id === 'keep-route');
    expect(keepRoute).toMatchObject({ label: 'Keep current route', promptText: 'keeping its current route and line' });
    expect(keepRoute?.footprint).toBeUndefined();
    expect(dim('pathway', 'width').defaultOptionId).toBe('keep-width');
    // Defaults never grow the footprint (the lawn beside the walk stays out of the outline until asked).
    for (const d of getElementDef('pathway').dimensions) expect(d.options.find((o) => o.id === d.defaultOptionId)?.footprint, d.id).toBeUndefined();
    // e2e picks these by label.
    expect(dim('pathway', 'material').options.some((o) => o.label === 'Gray granite')).toBe(true);
    expect(dim('pathway', 'stone-size').options.some((o) => o.label === 'Large flagstone slabs')).toBe(true);

    // No railing appears on steps or a porch unless the owner picks one.
    for (const type of ['steps', 'porch'] as const) {
      const railing = dim(type, 'railing');
      expect(railing.defaultOptionId, type).toBe('rail-keep');
      expect(railing.options.find((o) => o.id === 'rail-keep')?.promptText, type).toMatch(/^keeping any existing railing/);
    }

    const trim = dim('wall-paint', 'trim');
    expect(trim.defaultOptionId).toBe('trim-keep');
    expect(trim.options.find((o) => o.id === 'trim-keep')?.promptText).toMatch(/^keeping the existing trim/);

    for (const [type, dark] of [
      ['outdoor-lighting', ['dusk', 'night']],
      ['interior-lighting', ['evening', 'night']],
    ] as const) {
      const time = dim(type, 'time');
      expect(time.defaultOptionId, type).toBe('daytime');
      for (const id of dark) expect(time.options.find((o) => o.id === id)?.rationale, `${type}/${id}`).toMatch(/Switch the run to Whole image before generating\.$/);
    }
  });

  it('every built-in prompt text names one concrete choice (no "x or y" for the image model to pick)', () => {
    for (const { def, dim, o } of allOptions()) expect(o.promptText, `${def.type}/${dim.id}/${o.id}`).not.toMatch(/ or /);
  });

  it('maps every plant option to existing dimensions, options and plant profiles', () => {
    const keys = plantOptionKeys();
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      const [type, dimId, optId] = key.split('/');
      const dim = getElementDef(type as never).dimensions.find((d) => d.id === dimId);
      expect(dim?.options.some((o) => o.id === optId), key).toBe(true);
    }
    for (const p of Object.values(PLANT_PROFILES)) {
      expect(p.sun.length, p.id).toBeGreaterThan(0);
      expect(p.matureWidthFt, p.id).toBeGreaterThanOrEqual(0);
      if (!p.indoor) {
        expect(p.zoneMin, p.id).toBeDefined();
        expect((p.zoneMin as number) <= (p.zoneMax as number), p.id).toBe(true);
      }
    }
  });
});

describe('knowledge base', () => {
  it('has guidance for every element type', () => {
    expect(ELEMENT_GUIDANCE.map((g) => g.type).sort()).toEqual([...ELEMENT_TYPES].sort());
    for (const g of ELEMENT_GUIDANCE) {
      expect(g.purpose.length, g.type).toBeGreaterThan(20);
      expect(g.rulesOfThumb.length, g.type).toBeGreaterThanOrEqual(1);
      expect(g.relateToArchitecture.length, g.type).toBeGreaterThanOrEqual(1);
    }
    expect(guidanceFor('pathway')?.rulesOfThumb.join(' ')).toMatch(/4 ft/);
    expect(guidanceFor('steps')?.rulesOfThumb.join(' ')).toMatch(/6–7\.5 in/);
  });

  it('styles have unique ids, period palettes and existing theme pairings', () => {
    expect(ARCHITECTURAL_STYLES.length).toBeGreaterThanOrEqual(16);
    const ids = ARCHITECTURAL_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ARCHITECTURAL_STYLES) {
      expect(s.palettes.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.palettes.length, s.id).toBeLessThanOrEqual(3);
      for (const p of s.palettes) {
        expect(p.hexes.length, `${s.id}/${p.name}`).toBeGreaterThanOrEqual(3);
        expect(p.hexes.length, `${s.id}/${p.name}`).toBeLessThanOrEqual(5);
        for (const h of p.hexes) expect(h).toMatch(HEX);
      }
      for (const field of [s.identify, s.characteristics, s.materials, s.landscape, s.lighting, s.avoid, s.themes]) {
        expect(field.length, s.id).toBeGreaterThan(0);
      }
      for (const t of s.themes) expect(getTheme(t), `${s.id} → ${t}`).toBeDefined();
    }
  });

  it('themes have a purpose, valid palette and suit existing styles', () => {
    expect(DESIGN_THEMES.length).toBeGreaterThanOrEqual(18);
    const ids = DESIGN_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DESIGN_THEMES.some((t) => t.setting === 'exterior')).toBe(true);
    expect(DESIGN_THEMES.some((t) => t.setting === 'interior')).toBe(true);
    for (const t of DESIGN_THEMES) {
      expect(t.purpose.length, t.id).toBeGreaterThan(20);
      expect(t.principles.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.plants.length, t.id).toBeGreaterThan(0);
      expect(t.promptHint.length, t.id).toBeGreaterThan(20);
      for (const h of t.palette) expect(h, t.id).toMatch(HEX);
      for (const s of t.suits) expect(getStyle(s), `${t.id} suits ${s}`).toBeDefined();
    }
  });

  it('exterior plant lists in themes carry zone notes', () => {
    for (const t of DESIGN_THEMES.filter((x) => x.setting === 'exterior')) {
      const withZone = t.plants.filter((p) => /z\d/.test(p));
      expect(withZone.length, t.id).toBeGreaterThanOrEqual(Math.ceil(t.plants.length / 2));
    }
  });

  it('designKnowledgeForAI is deterministic and covers styles, themes and elements', () => {
    const a = designKnowledgeForAI();
    const b = designKnowledgeForAI();
    expect(a).toBe(b);
    for (const s of ARCHITECTURAL_STYLES) expect(a).toContain(`- ${s.id} |`);
    for (const t of DESIGN_THEMES) expect(a).toContain(`- ${t.id} |`);
    for (const t of ELEMENT_TYPES) expect(a).toContain(`- ${t} |`);
    expect(a).not.toMatch(/undefined|NaN|\[object Object\]/);
    expect(a).not.toMatch(/\.;/);
    expect(a).toMatch(/hardiness/i);
  });
});

describe('lookups', () => {
  it('elementsForSetting returns the setting plus "both", most relevant first', () => {
    const ext = elementsForSetting('exterior');
    expect(ext[0].type).toBe('pathway');
    expect(ext.every((d) => d.setting !== 'interior')).toBe(true);
    expect(ext.map((d) => d.type)).toContain('custom');
    expect(ext[ext.length - 1].type).toBe('custom');
    expect(ext.length).toBe(ELEMENT_DEFS.filter((d) => d.setting !== 'interior').length);
    const int = elementsForSetting('interior');
    expect(int[0].type).toBe('wall-paint');
    expect(int.every((d) => d.setting !== 'exterior')).toBe(true);
  });

  it('themesFor filters by setting and puts themes suiting the style first', () => {
    const ext = themesFor('exterior');
    expect(ext.every((t) => t.setting !== 'interior')).toBe(true);
    const craftsman = themesFor('exterior', 'craftsman');
    const pairs = (getStyle('craftsman')?.themes ?? []).filter((id) => getTheme(id)?.setting !== 'interior');
    expect(craftsman.slice(0, pairs.length).map((t) => t.id)).toEqual(pairs);
    expect(craftsman.length).toBe(ext.length);
    const interior = themesFor('interior', 'mid-century-modern');
    expect(interior[0].id).toBe('mid-century-warm');
    expect(themesFor('interior', 'no-such-style').map((t) => t.id)).toEqual(themesFor('interior').map((t) => t.id));
  });

  it('getStyle / getTheme return undefined for unknown ids', () => {
    expect(getStyle('nope')).toBeUndefined();
    expect(getTheme('nope')).toBeUndefined();
  });
});

function zone(id: string, kind: SceneZone['kind'], extra: Partial<SceneZone> = {}): SceneZone {
  return { id, kind, label: id, description: '', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], editable: true, ...extra };
}

function scene(zones: SceneZone[], paths: SceneMap['paths'] = []): SceneMap {
  return {
    category: 'front-yard',
    summary: '',
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones,
    paths,
    keep: [],
    opportunities: [],
    createdAt: 0,
    model: 'test',
  };
}

describe('newElementSpec', () => {
  const sc = scene(
    [
      zone('walk', 'walkway'),
      zone('bed-l', 'planting-bed', { sun: 'full-sun' }),
      zone('bed-r', 'planting-bed', { sun: 'shade', editable: false }),
      zone('shrubs', 'shrubs', { sun: 'full-sun' }),
      zone('lawn', 'lawn', { sun: 'shade' }),
      zone('street', 'street'),
    ],
    [
      { id: 'p1', label: 'Drive → door', from: 'driveway', to: 'front door', description: '', points: [], widthPx: 40, kind: 'existing' },
      { id: 'p2', label: 'Suggested side path', from: 'gate', to: 'patio', description: '', points: [], widthPx: 30, kind: 'suggested' },
    ],
  );

  it('preselects editable zones by the element zoneKinds', () => {
    expect(newElementSpec('planting-bed', sc).zoneIds).toEqual(['bed-l', 'shrubs']);
    expect(newElementSpec('lawn', sc).zoneIds).toEqual(['lawn']);
    expect(newElementSpec('pathway', sc).zoneIds).toEqual(['walk']);
    expect(newElementSpec('wall-paint', sc).zoneIds).toEqual([]);
    expect(newElementSpec('custom', sc).zoneIds).toEqual([]);
  });

  it('preselects real paths for a pathway (suggested ones only when there are no others)', () => {
    expect(newElementSpec('pathway', sc).pathIds).toEqual(['p1']);
    const onlySuggested = scene([], [sc.paths[1]]);
    expect(newElementSpec('pathway', onlySuggested).pathIds).toEqual(['p2']);
    expect(newElementSpec('lawn', sc).pathIds).toEqual([]);
  });

  it('copies the dimensions deeply and fills default choices', () => {
    const spec = newElementSpec('pathway');
    const def = getElementDef('pathway');
    expect(spec.label).toBe(def.label);
    expect(spec.note).toBe('');
    expect(spec.zoneIds).toEqual([]);
    expect(spec.dimensions).toEqual(def.dimensions);
    expect(spec.dimensions).not.toBe(def.dimensions);
    spec.dimensions[0].options[0].label = 'changed';
    expect(def.dimensions[0].options[0].label).not.toBe('changed');
    for (const dim of def.dimensions) expect(spec.choices[dim.id]).toEqual(dim.defaultOptionId ? [dim.defaultOptionId] : []);
    expect(newElementSpec('pathway').id).not.toBe(spec.id);
  });

  it('annotates plant options and steers plant defaults when the zone is known', () => {
    const warm = newElementSpec('lawn', sc, { zone: 9, zoneLabel: '9a' });
    const grass = warm.dimensions.find((d) => d.id === 'grass-type') as ElementDimension;
    expect(grass.options.every((o) => o.feasibility)).toBe(true);
    // the lawn zone is shaded, zone 9 → St. Augustine is the most shade-tolerant warm-season grass
    expect(warm.choices['grass-type']).toEqual(['st-augustine']);
    const cool = newElementSpec('lawn', sc, { zone: 5 });
    expect(cool.choices['grass-type']).toEqual(['shade-fescue']);
    // without a zone nothing is guessed
    expect(newElementSpec('lawn', sc).choices['grass-type']).toEqual([]);
    // a default the property cannot support is swapped for a feasible one
    const hot = newElementSpec('planting-bed', undefined, { zone: 10, sun: 'full-sun' });
    const palette = hot.dimensions.find((d) => d.id === 'palette') as ElementDimension;
    expect(palette.options.find((o) => o.id === 'evergreen-structure')?.feasibility?.rating).toBe('poor');
    expect(hot.choices.palette).toHaveLength(1);
    expect(hot.choices.palette).not.toEqual(['evergreen-structure']);
    expect(palette.options.find((o) => o.id === hot.choices.palette[0])?.feasibility?.rating).not.toBe('poor');
    // when nothing fits better, the default stays (the plan step then picks feasible plants)
    const tropical = newElementSpec('planting-bed', undefined, { zone: 12, sun: 'full-sun' });
    expect(tropical.choices.palette).toEqual(['evergreen-structure']);
    // non-plant options are left alone
    expect(warm.dimensions.find((d) => d.id === 'shape')?.options.every((o) => !o.feasibility)).toBe(true);
  });
});

describe('optionVisualFromDraft', () => {
  it('builds textures with sane sizes, keeping the pattern aspect when one side is missing', () => {
    const v = optionVisualFromDraft({ kind: 'texture', pattern: 'brick', colors: ['#AA3322', 'nope'], unitWidthIn: 8, unitHeightIn: null });
    expect(v?.kind).toBe('texture');
    if (v?.kind !== 'texture') return;
    expect(v.texture.colors).toEqual(['#aa3322']);
    expect(v.texture.unitWidthIn).toBe(8);
    expect(v.texture.unitHeightIn).toBeCloseTo(8 * (2.25 / 7.625), 5);
    expect(v.texture.joint?.widthIn).toBeGreaterThan(0);
    expect(Number.isInteger(v.texture.seed)).toBe(true);
    const again = optionVisualFromDraft({ kind: 'texture', pattern: 'brick', colors: ['#AA3322', 'nope'], unitWidthIn: 8, unitHeightIn: null });
    expect(again).toEqual(v);
  });

  it('falls back to defaults for missing or absurd sizes and colors', () => {
    const v = optionVisualFromDraft({ kind: 'texture', pattern: 'gravel', colors: [], unitWidthIn: -3, unitHeightIn: Number.NaN });
    if (v?.kind !== 'texture') throw new Error('expected texture');
    expect(v.texture.unitWidthIn).toBeGreaterThan(0);
    expect(v.texture.colors.length).toBeGreaterThan(0);
    const big = optionVisualFromDraft({ kind: 'texture', pattern: 'flagstone', colors: ['#888888'], unitWidthIn: 10_000, unitHeightIn: 20 });
    if (big?.kind !== 'texture') throw new Error('expected texture');
    expect(big.texture.unitWidthIn).toBeLessThanOrEqual(240);
  });

  it('handles colors, missing patterns and none', () => {
    expect(optionVisualFromDraft({ kind: 'color', pattern: null, colors: ['#abc'], unitWidthIn: null, unitHeightIn: null })).toEqual({ kind: 'color', hex: '#aabbcc' });
    expect(optionVisualFromDraft({ kind: 'color', pattern: null, colors: ['#111111', '#222222'], unitWidthIn: null, unitHeightIn: null })).toEqual({
      kind: 'colors',
      hexes: ['#111111', '#222222'],
    });
    expect(optionVisualFromDraft({ kind: 'texture', pattern: null, colors: ['#123456'], unitWidthIn: 4, unitHeightIn: 4 })).toEqual({ kind: 'color', hex: '#123456' });
    expect(optionVisualFromDraft({ kind: 'none', pattern: null, colors: ['#123456'], unitWidthIn: null, unitHeightIn: null })).toBeUndefined();
    expect(optionVisualFromDraft({ kind: 'color', pattern: null, colors: ['bad', 'nope'], unitWidthIn: null, unitHeightIn: null })).toBeUndefined();
  });
});

describe('mergeDimensions', () => {
  const builtin = getElementDef('pathway').dimensions;
  const draftOption = (id: string, label: string, extra: Partial<ElementDimensionDraft['options'][number]> = {}) => ({
    id,
    label,
    description: `${label} description`,
    promptText: `${label} prompt`,
    visual: { kind: 'texture' as const, pattern: 'flagstone' as const, colors: ['#777777'], unitWidthIn: 20, unitHeightIn: 18 },
    rationale: `${label} suits a cottage`,
    feasibility: null,
    ...extra,
  });

  it('puts AI options first in matching dimensions, deduped by label, keeping built-in ids for twins', () => {
    const drafts: ElementDimensionDraft[] = [
      {
        id: 'stone-size',
        label: 'Stone size',
        question: 'What stone sizes suit a cottage?',
        multiple: false,
        options: [draftOption('irregular-slabs', 'Large flagstone slabs'), draftOption('mixed-cottage', 'Mixed cottage stones'), draftOption('dup', 'mixed cottage stones ')],
      },
    ];
    const before = structuredClone(builtin);
    const merged = mergeDimensions(builtin, drafts);
    expect(builtin).toEqual(before); // inputs untouched
    const size = merged.find((d) => d.id === 'stone-size') as ElementDimension;
    expect(size.question).toBe('What stone sizes suit a cottage?');
    expect(size.options[0].id).toBe('large-flagstone'); // AI twin adopts the built-in id
    expect(size.options[0].promptText).toBe('Large flagstone slabs prompt');
    expect(size.options[1].label).toBe('Mixed cottage stones');
    const labels = size.options.map((o) => o.label.toLowerCase().trim());
    expect(new Set(labels).size).toBe(labels.length);
    expect(size.options.filter((o) => o.label === 'Large flagstone slabs')).toHaveLength(1);
    expect(size.options.map((o) => o.id)).toContain('pea-gravel'); // built-ins kept after AI options
    expect(size.options.find((o) => o.id === size.defaultOptionId)).toBeDefined();
    expect(new Set(size.options.map((o) => o.id)).size).toBe(size.options.length);
    expect(merged.map((d) => d.id).slice(0, builtin.length)).toEqual(builtin.map((d) => d.id));
  });

  it('appends new dimensions, normalizing ids and skipping empty or duplicate drafts', () => {
    const drafts: ElementDimensionDraft[] = [
      { id: 'Joint Fill', label: 'Joint fill', question: 'What fills the joints?', multiple: false, options: [draftOption('moss', 'Moss'), draftOption('thyme', 'Creeping thyme', { feasibility: { rating: 'good', reasons: ['Zone 4–9 ✓'] } })] },
      { id: 'joint-fill', label: 'Joint fill again', question: '?', multiple: false, options: [draftOption('x', 'X')] },
      { id: 'empty', label: 'Empty', question: '?', multiple: true, options: [] },
    ];
    const merged = mergeDimensions(builtin, drafts);
    expect(merged).toHaveLength(builtin.length + 1);
    const fill = merged[merged.length - 1];
    expect(fill.id).toBe('joint-fill');
    expect(fill.options.map((o) => o.id)).toEqual(['moss', 'thyme']);
    expect(fill.options[1].feasibility).toEqual({ rating: 'good', reasons: ['Zone 4–9 ✓'] });
    expect(fill.options[0].visual?.kind).toBe('texture');
    expect(fill.defaultOptionId).toBeUndefined();
  });

  it('renames AI options whose id collides with a different built-in option', () => {
    const drafts: ElementDimensionDraft[] = [
      { id: 'width', label: 'Width', question: 'How wide?', multiple: false, options: [draftOption('width-4ft', '4.5 ft')] },
    ];
    const width = mergeDimensions(builtin, drafts).find((d) => d.id === 'width') as ElementDimension;
    expect(width.options[0].label).toBe('4.5 ft');
    expect(width.options[0].id).not.toBe('width-4ft');
    expect(width.options.find((o) => o.id === 'width-4ft')?.label).toBe('4 ft');
  });

  it('accepts already-converted dimensions too', () => {
    const converted: ElementDimension[] = [
      { id: 'shape', label: 'Shape', question: 'Shape?', options: [{ id: 'herringbone-walk', label: 'Herringbone walk', description: 'd', promptText: 'p', visual: { kind: 'color', hex: '#123456' } }] },
    ];
    const shape = mergeDimensions(builtin, converted).find((d) => d.id === 'shape') as ElementDimension;
    expect(shape.options[0]).toMatchObject({ id: 'herringbone-walk', visual: { kind: 'color', hex: '#123456' } });
  });
});

describe('swatchSpanIn', () => {
  it('returns a common span only for texture dimensions of very different scales', () => {
    const pathway = getElementDef('pathway');
    expect(swatchSpanIn(pathway.dimensions.find((d) => d.id === 'shape') as ElementDimension)).toBeUndefined();
    const span = swatchSpanIn(pathway.dimensions.find((d) => d.id === 'stone-size') as ElementDimension) as number;
    expect(span).toBeGreaterThanOrEqual(18);
    expect(span).toBeLessThanOrEqual(144);
    expect(swatchSpanIn(getElementDef('front-door').dimensions[0])).toBeUndefined();
  });
});
