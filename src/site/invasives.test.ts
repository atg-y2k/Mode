import { readFileSync, statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  describeInvasive,
  findInvasive,
  invasiveStatus,
  invasiveStatusSync,
  invasiveCoverageNote,
  invasivesReady,
  loadInvasives,
  onInvasivesLoaded,
  parseBotanical,
  parseInvasivesData,
  setInvasivesData,
  splitBotanicalNames,
  type InvasivesData,
} from './invasives';

/** A small slice in the bundled format (status digits: L48 AK HI). */
const SAMPLE: InvasivesData = {
  rows: [
    ['Berberis thunbergii', 'Japanese barberry', '300'],
    ['Cenchrus setaceus', 'Crimson fountaingrass', '303', 'Pennisetum setaceum'],
    ['Euonymus alatus', 'Winged burning bush', '300', 'Euonymus alata'],
    ['Euonymus fortunei var. radicans', 'Climbing euonymus', '200'],
    ['Festuca rubra', 'Red fescue', '332', 'Festuca heteromalla|Festuca rubra ssp. fallax'],
    ['Lavandula angustifolia', 'English lavender', '100'],
    ['Lonicera japonica', 'Japanese honeysuckle', '303'],
    ['Mentha X piperita', 'Peppermint', '020'],
    ['Poa pratensis ssp. pratensis', 'Kentucky bluegrass', '330'],
    ['Poa pratensis', 'Kentucky bluegrass', '003'],
    ['Rubus idaeus var. idaeus', 'European red raspberry', '100'],
    ['Lythrum salicaria', 'Purple loosestrife', '320', 'Lythrum salicaria f. albiflora'],
  ],
};

beforeEach(() => setInvasivesData(SAMPLE));
afterEach(() => setInvasivesData(null));

describe('parseBotanical', () => {
  it('keeps genus + species and drops cultivars, authors and notes', () => {
    expect(parseBotanical("Berberis thunbergii 'Crimson Pygmy'")?.key).toBe('berberis thunbergii');
    expect(parseBotanical('Berberis thunbergii DC.')?.key).toBe('berberis thunbergii');
    expect(parseBotanical('Salvia yangii (syn. Perovskia atriplicifolia)')?.key).toBe('salvia yangii');
    expect(parseBotanical('Trifolium repens (micro types)')?.key).toBe('trifolium repens');
    expect(parseBotanical('  BERBERIS   THUNBERGII ')?.display).toBe('Berberis thunbergii');
  });

  it('normalizes subspecies, variety and forma spellings', () => {
    expect(parseBotanical('Festuca rubra ssp. fallax')?.key).toBe('festuca rubra subsp. fallax');
    expect(parseBotanical('Festuca rubra subsp. fallax')?.key).toBe('festuca rubra subsp. fallax');
    expect(parseBotanical('Festuca rubra subspecies fallax')?.key).toBe('festuca rubra subsp. fallax');
    expect(parseBotanical("Rudbeckia fulgida var. sullivantii 'Goldsturm'")?.key).toBe('rudbeckia fulgida var. sullivantii');
    expect(parseBotanical('Rudbeckia fulgida variety sullivantii')?.key).toBe('rudbeckia fulgida var. sullivantii');
    expect(parseBotanical('Lythrum salicaria f. albiflora')?.key).toBe('lythrum salicaria f. albiflora');
    expect(parseBotanical('Centaurea stoebe L. ssp. micranthos (Gugler) Hayek')?.key).toBe('centaurea stoebe subsp. micranthos');
  });

  it('ignores hybrid markers (×, x, X)', () => {
    expect(parseBotanical('Mentha × piperita')?.key).toBe('mentha piperita');
    expect(parseBotanical('Mentha x piperita')?.key).toBe('mentha piperita');
    expect(parseBotanical('Mentha X piperita')?.key).toBe('mentha piperita');
    expect(parseBotanical('Mentha ×piperita')?.key).toBe('mentha piperita');
    expect(parseBotanical('× Cupressocyparis leylandii')?.key).toBe('cupressocyparis leylandii');
  });

  it('rejects names that are not at least genus + species', () => {
    expect(parseBotanical("Buxus 'Green Velvet'")).toBeNull();
    expect(parseBotanical('Miscanthus spp.')).toBeNull();
    expect(parseBotanical('Hosta')).toBeNull();
    expect(parseBotanical('')).toBeNull();
    expect(parseBotanical(undefined)).toBeNull();
  });
});

describe('splitBotanicalNames', () => {
  it('splits mixes and expands abbreviated genera', () => {
    expect(splitBotanicalNames('Festuca arundinacea + Poa pratensis')).toEqual(['Festuca arundinacea', 'Poa pratensis']);
    expect(splitBotanicalNames('Zoysia japonica / Cynodon dactylon')).toEqual(['Zoysia japonica', 'Cynodon dactylon']);
    expect(splitBotanicalNames('Festuca rubra, F. trachyphylla, F. ovina')).toEqual(['Festuca rubra', 'Festuca trachyphylla', 'Festuca ovina']);
    expect(splitBotanicalNames('Petunia × atkinsiana & Calibrachoa')).toEqual(['Petunia × atkinsiana', 'Calibrachoa']);
    expect(splitBotanicalNames("Buxus 'Green Velvet'")).toEqual(["Buxus 'Green Velvet'"]);
    expect(splitBotanicalNames(undefined)).toEqual([]);
  });
});

describe('matching', () => {
  it('matches exact names and cultivars of listed species', () => {
    expect(findInvasive('Berberis thunbergii')).toMatchObject({ name: 'Berberis thunbergii', match: 'exact' });
    expect(findInvasive("Berberis thunbergii 'Rose Glow'")).toMatchObject({ name: 'Berberis thunbergii', match: 'exact' });
  });

  it('resolves US-RIIS synonyms (including old genus names and spelling variants)', () => {
    expect(findInvasive('Pennisetum setaceum')).toMatchObject({ name: 'Cenchrus setaceus', match: 'synonym' });
    expect(findInvasive("Pennisetum setaceum 'Rubrum'")?.name).toBe('Cenchrus setaceus');
    expect(findInvasive("Euonymus alata 'Compactus'")).toMatchObject({ name: 'Euonymus alatus', match: 'synonym' });
    expect(findInvasive('Lythrum salicaria forma albiflora')?.name).toBe('Lythrum salicaria');
  });

  it('gives varieties and subspecies the status of a listed species', () => {
    expect(findInvasive('Berberis thunbergii var. atropurpurea')).toMatchObject({ name: 'Berberis thunbergii', match: 'species' });
    expect(findInvasive('Lonicera japonica subsp. halliana')?.match).toBe('species');
  });

  it('prefers the exact infraspecific entry over the species', () => {
    expect(findInvasive('Poa pratensis subsp. pratensis')).toMatchObject({ name: 'Poa pratensis ssp. pratensis', match: 'exact' });
    expect(findInvasive('Festuca rubra ssp. fallax')).toMatchObject({ name: 'Festuca rubra', match: 'synonym' });
  });

  it('reports listed forms of an unlisted species without condemning the species', () => {
    const m = findInvasive('Euonymus fortunei');
    expect(m).toMatchObject({ name: 'Euonymus fortunei var. radicans', match: 'infraspecific' });
    const v = describeInvasive(m!, 'L48');
    expect(v.invasive).toBe(false);
    expect(v.note).toMatch(/a form of this species.*check which form/);
    // Autonyms: only the European variety of red raspberry is listed (as established).
    const raspberry = describeInvasive(findInvasive('Rubus idaeus')!, 'L48');
    expect(raspberry.invasive).toBe(false);
    expect(raspberry.note).toBeUndefined();
  });

  it('handles hybrids written with ×', () => {
    expect(findInvasive('Mentha × piperita')?.name).toBe('Mentha X piperita');
  });

  it('returns null for unlisted or unparseable names', () => {
    expect(findInvasive('Echinacea purpurea')).toBeNull();
    expect(findInvasive('Japanese barberry')).toBeNull();
    expect(findInvasive("Buxus 'Green Velvet'")).toBeNull();
  });
});

describe('verdicts', () => {
  it('flags invasive in the lower 48 with a sourced note', () => {
    const v = invasiveStatusSync('Berberis thunbergii');
    expect(v).toMatchObject({ invasive: true, level: 3 });
    expect(v?.note).toBe('Japanese barberry (Berberis thunbergii) is listed as a widespread invasive in the lower 48 states (USGS US-RIIS v2.0)');
    expect(invasiveStatusSync('Pennisetum setaceum')?.note).toMatch(/also known as Pennisetum setaceum/);
    expect(invasiveStatusSync('Berberis thunbergii var. atropurpurea')?.note).toMatch(
      /^Berberis thunbergii var\. atropurpurea is a form of Japanese barberry/,
    );
  });

  it('distinguishes established (not invasive) and other localities', () => {
    expect(invasiveStatusSync('Lavandula angustifolia')).toMatchObject({ invasive: false, level: 1 });
    expect(invasiveStatusSync('Lavandula angustifolia')?.note).toMatch(/not on the USGS US-RIIS v2.0 invasive list \(no state list available\)/);
    expect(invasiveStatusSync('Lavandula angustifolia')?.note).not.toMatch(/not invasive/i);
    expect(invasiveStatusSync('Mentha piperita')).toMatchObject({ invasive: false, level: 0 });
    expect(invasiveStatusSync('Mentha piperita')?.note).toMatch(/invasive in Alaska/);
    expect(invasiveStatusSync('Mentha piperita', 'AK')).toMatchObject({ invasive: true, level: 2 });
    expect(invasiveStatusSync('Poa pratensis', 'HI')?.invasive).toBe(true);
    // The species isn't listed in the lower 48, but its typical subspecies is: say so.
    const bluegrass = invasiveStatusSync('Poa pratensis');
    expect(bluegrass).toMatchObject({ invasive: false, formListed: true });
    expect(bluegrass?.note).toMatch(/^Poa pratensis ssp\. pratensis \(a form of this species\) is listed as widespread invasive in the lower 48/);
    // Forms are judged per locality.
    expect(invasiveStatusSync('Euonymus fortunei', 'HI')).toEqual(expect.objectContaining({ invasive: false, level: 0 }));
    expect(invasiveStatusSync('Euonymus fortunei', 'HI')?.note).toBeUndefined();
  });

  it('says "not listed" (never "not invasive") for parseable names and null for the rest', () => {
    expect(invasiveStatusSync('Echinacea purpurea')).toEqual({ invasive: false, listed: false, level: 0 });
    expect(invasiveStatusSync('Berberis thunbergii')?.listed).toBe(true);
    expect(invasiveStatusSync('Hosta')).toBeNull();
    expect(invasiveCoverageNote('HI')).toBe(
      "Invasive flags come from USGS US-RIIS v2.0 (Hawaii). No state list available — check your state's invasive plant list too.",
    );
  });

  it('is null until the list has loaded', () => {
    setInvasivesData(null);
    expect(invasivesReady()).toBe(false);
    expect(invasiveStatusSync('Berberis thunbergii')).toBeNull();
    expect(findInvasive('Berberis thunbergii')).toBeNull();
  });

  it('notifies listeners when data arrives', () => {
    setInvasivesData(null);
    let calls = 0;
    const off = onInvasivesLoaded(() => calls++);
    setInvasivesData(SAMPLE);
    off();
    setInvasivesData(SAMPLE);
    expect(calls).toBe(1);
  });

  it('invasiveStatus (async contract) resolves from the cache; null when it cannot load', async () => {
    expect(await invasiveStatus('Lonicera japonica')).toEqual({
      invasive: true,
      listed: true,
      note: expect.stringMatching(/Japanese honeysuckle/),
    });
    expect(await invasiveStatus('Echinacea purpurea')).toEqual({ invasive: false, listed: false });
    setInvasivesData(null);
    expect(await loadInvasives()).toBe(false); // no page to fetch from in node
    expect(await invasiveStatus('Berberis thunbergii')).toBeNull();
  });
});

describe('bundled public/data/invasives.json', () => {
  const path = new URL('../../public/data/invasives.json', import.meta.url);

  it('is small and loads into a working index', () => {
    expect(statSync(path).size).toBeLessThan(500 * 1024);
    const data = parseInvasivesData(JSON.parse(readFileSync(path, 'utf8')));
    expect(data.rows.length).toBeGreaterThan(4000);
    setInvasivesData(data);
    // Widespread landscape invasives.
    for (const name of ['Berberis thunbergii', 'Euonymus alatus', 'Pyrus calleryana', 'Lonicera japonica', 'Hedera helix', 'Ailanthus altissima']) {
      expect(invasiveStatusSync(name)?.invasive, name).toBe(true);
    }
    expect(invasiveStatusSync("Pennisetum setaceum 'Rubrum'")?.invasive).toBe(true);
    expect(invasiveStatusSync('Buddleia davidii')?.invasive).toBe(true);
    // Introduced but not invasive; natives aren't listed (no entry — not a verdict).
    expect(invasiveStatusSync('Lavandula angustifolia')).toMatchObject({ invasive: false, listed: true, level: 1 });
    expect(invasiveStatusSync('Echinacea purpurea')).toEqual({ invasive: false, listed: false, level: 0 });
    expect(invasiveStatusSync('Ilex glabra')).toEqual({ invasive: false, listed: false, level: 0 });
  });

  it('has unique names and well-formed status digits', () => {
    const data = parseInvasivesData(JSON.parse(readFileSync(path, 'utf8')));
    const names = data.rows.map((r) => r[0]);
    expect(new Set(names).size).toBe(names.length);
    expect(data.rows.every((r) => /^[0-3]{3}$/.test(r[2]))).toBe(true);
  });
});
