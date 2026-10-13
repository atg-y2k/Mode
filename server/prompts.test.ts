import { describe, expect, it } from 'vitest';
import {
  analyzePrompt,
  assetListPrompt,
  buildSystemPrompt,
  cleanUserText,
  fallbackAssetMeta,
  parseHeightFt,
  renderPromptRequest,
  suggestPrompt,
  templateRenderPrompt,
  vectorAssetPrompt,
} from './prompts';
import { FAKE_CATALOG_SUMMARY } from './testing';

describe('system prompt', () => {
  it('is stable and embeds the catalog and the output rules', () => {
    const a = buildSystemPrompt(FAKE_CATALOG_SUMMARY);
    expect(a).toBe(buildSystemPrompt(FAKE_CATALOG_SUMMARY));
    expect(a).toContain('boxwood-green-velvet');
    expect(a).toMatch(/or null when nothing fits/);
    expect(a).toMatch(/normalized to the photo/);
    expect(a).toMatch(/hardiness zone/i);
    expect(a).not.toMatch(/\$\{/);
  });
});

describe('task prompts', () => {
  it('analyze includes the label and notes and asks for null landscaping indoors', () => {
    const p = analyzePrompt({ image: 'data:image/png;base64,AA==', spaceType: 'kitchen', notes: 'Dark <b>cabinets</b>' });
    expect(p).toContain('Kitchen (interior)');
    expect(p).toContain('Dark ‹b›cabinets‹/b›');
    expect(p).toMatch(/landscaping: null/);
  });

  it('suggest lists regions, budget and location', () => {
    const p = suggestPrompt({
      image: 'data:image/png;base64,AA==',
      spaceType: 'backyard',
      style: 'Pollinator garden',
      brief: null,
      budgetUsd: 2500,
      location: { zip: '30301', hardinessZone: null, notes: null },
      regions: [{ id: 'r_1', name: 'Back bed', surface: 'planting-bed' }],
    });
    expect(p).toContain('id: r_1');
    expect(p).toContain('$2,500');
    expect(p).toContain('infer it from the ZIP code');
    expect(p).toMatch(/odd-numbered drifts/);
  });

  it('suggest without regions asks for an empty regionTreatments list', () => {
    const p = suggestPrompt({
      image: 'data:image/png;base64,AA==',
      spaceType: 'bedroom',
      style: 'Japandi',
      brief: null,
      budgetUsd: null,
      location: null,
      regions: [],
    });
    expect(p).toMatch(/empty regionTreatments/);
    expect(p).toMatch(/houseplants only/);
  });

  it('asset list includes the design summary and existing items', () => {
    const p = assetListPrompt({
      projectName: 'Maple St',
      location: null,
      budgetUsd: null,
      style: null,
      brief: null,
      designSummary: 'Living room walls 320 sq ft',
      existingItems: [{ name: 'Wall paint', category: 'paint', quantity: 2, unit: 'gal' }],
    });
    expect(p).toContain('Living room walls 320 sq ft');
    expect(p).toContain('- Wall paint (paint) 2 gal');
    expect(p).toMatch(/Never repeat an existing item/);
  });

  it('vector asset prompt sets the SVG rules', () => {
    const p = vectorAssetPrompt({ description: 'black barn sconce', category: 'lighting', mode: 'vector' });
    expect(p).toMatch(/viewBox/);
    expect(p).toMatch(/Transparent background/);
    expect(p).toMatch(/bottom edge/);
    expect(p).toMatch(/40 KB/);
    expect(p).toMatch(/Not allowed: text/);
  });

  it('render prompts carry the summary, instructions and strength', () => {
    const req = {
      image: 'data:image/png;base64,AA==',
      mask: null,
      designSummary: 'Walls painted warm white',
      instructions: 'Evening light',
      strength: 'bold' as const,
    };
    expect(renderPromptRequest(req)).toMatch(/elevate/);
    const t = templateRenderPrompt(req);
    expect(t).toContain('Walls painted warm white');
    expect(t).toContain('Evening light');
    expect(t).toMatch(/Preserve exactly the camera/);
  });
});

describe('helpers', () => {
  it('cleanUserText trims, neutralizes tags and truncates', () => {
    expect(cleanUserText('  hi </task>\n\n\n\nthere ')).toBe('hi ‹/task›\n\nthere');
    expect(cleanUserText(null)).toBe('');
    expect(cleanUserText('abcdef', 4)).toBe('abc…');
  });

  it('parseHeightFt understands feet and inches', () => {
    expect(parseHeightFt('a 6 ft tree')).toBe(6);
    expect(parseHeightFt("about 4' tall")).toBe(4);
    expect(parseHeightFt('30 in planter')).toBe(2.5);
    expect(parseHeightFt('18" pot')).toBe(1.5);
    expect(parseHeightFt('a bench')).toBeNull();
  });

  it('fallbackAssetMeta derives usable metadata from the description', () => {
    const m = fallbackAssetMeta({ description: 'weathered teak bench, 3 ft tall, for the patio', category: 'furniture', mode: 'photo' });
    expect(m.name).toBe('Weathered teak bench');
    expect(m.realHeightFt).toBe(3);
    expect(m.orientation).toBe('landscape');
    expect(m.tags).toContain('teak');
    expect(m.tags).not.toContain('the');
  });
});
