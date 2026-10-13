import { describe, expect, it } from 'vitest';
import { plantLinkOuts, plantLinks } from './links';

describe('plantLinkOuts', () => {
  it('builds ZIP links for native plant finders', () => {
    const links = plantLinkOuts({ zip: '20817-1234' });
    expect(links.map((l) => l.url)).toEqual([
      'https://nativeplantfinder.nwf.org/Plants?zip=20817',
      'https://www.audubon.org/native-plants/search?zipcode=20817',
      'https://extension.rutgers.edu/deer-resistant-plants',
    ]);
  });

  it('searches plant databases by species, without the cultivar', () => {
    const links = plantLinkOuts({ botanical: "Berberis thunbergii 'Crimson Pygmy'", common: "Japanese barberry 'Crimson Pygmy'" });
    expect(links).toEqual([
      { label: 'NC State Plant Toolbox', url: 'https://plants.ces.ncsu.edu/find_a_plant/?q=Berberis+thunbergii', kind: 'plant', description: expect.any(String) },
      {
        label: 'Missouri Botanical Garden',
        url: 'https://www.missouribotanicalgarden.org/PlantFinder/PlantFinderSearchResults.aspx?basic=Berberis%20thunbergii',
        kind: 'plant',
        description: expect.any(String),
      },
      {
        label: 'Deer resistance (Rutgers)',
        url: 'https://extension.rutgers.edu/deer-resistant-plants?keys=Japanese+barberry',
        kind: 'deer',
        description: expect.any(String),
      },
    ]);
  });

  it('falls back to the common name and the genus', () => {
    expect(plantLinkOuts({ common: 'Boxwood (dwarf)' })[0].url).toBe('https://plants.ces.ncsu.edu/find_a_plant/?q=Boxwood');
    const rutgers = plantLinks({ botanical: 'Hosta sieboldiana' }).find((l) => l.kind === 'deer');
    expect(rutgers?.url).toBe('https://extension.rutgers.edu/deer-resistant-plants?keys=Hosta');
  });

  it('includes all five sources with a ZIP and a plant, and nothing for empty input', () => {
    expect(plantLinkOuts({ zip: '20817', botanical: 'Echinacea purpurea' }).map((l) => l.label)).toEqual([
      'Native plants for my ZIP (NWF)',
      'Plants for birds (Audubon)',
      'NC State Plant Toolbox',
      'Missouri Botanical Garden',
      'Deer resistance (Rutgers)',
    ]);
    expect(plantLinkOuts({})).toEqual([]);
    expect(plantLinkOuts({ zip: 'abc' })).toEqual([]);
  });

  it('encodes unusual characters safely', () => {
    const url = plantLinkOuts({ common: 'Lily & <script>' })[0].url;
    expect(url).toBe('https://plants.ces.ncsu.edu/find_a_plant/?q=Lily+%26+%3Cscript%3E');
  });
});
