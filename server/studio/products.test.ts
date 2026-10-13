import { describe, expect, it } from 'vitest';
import type { ProductResult } from '../../shared/api';
import {
  allowedDomainsFor,
  collectSearchEvidence,
  filterFoundProducts,
  guessCategory,
  nameFromUrl,
  pageImages,
  pageText,
  parseProductPage,
  storeForUrl,
  urlKey,
} from './products';

describe('parseProductPage', () => {
  it('reads a JSON-LD Product with offers, brand and image', () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Product","name":"Endless Summer &amp; Co. Hydrangea",
         "brand":"Endless Summer","image":{"@type":"ImageObject","url":"https://cdn.example.com/h.jpg"},
         "description":"Reblooming hydrangea.","offers":[{"@type":"Offer","price":"49.99","priceCurrency":"USD"},{"@type":"Offer","price":"34.99","priceCurrency":"USD"}],
         "additionalProperty":[{"@type":"PropertyValue","name":"Hardiness Zones","value":"4-9"}]}
      </script></head><body></body></html>`;
    const p = parseProductPage(html, 'https://shop.example.com/p/1');
    expect(p.structured).toBe(true);
    expect(p.name).toBe('Endless Summer & Co. Hydrangea');
    expect(p.brand).toBe('Endless Summer');
    expect(p.imageUrl).toBe('https://cdn.example.com/h.jpg');
    expect(p.priceUsd).toBe(34.99);
    expect(p.priceText).toBe('$34.99–$49.99');
    expect(p.specs).toEqual(['Hardiness Zones: 4-9']);
  });

  it('finds products inside @graph / ProductGroup variants and tolerates broken blocks', () => {
    const html = `<script type="application/ld+json">{ broken json </script>
      <script type='application/ld+json'>{"@graph":[{"@type":"WebPage"},{"@type":["ProductGroup"],"name":"Planter",
        "hasVariant":[{"offers":{"price":19.5,"priceCurrency":"USD"}}],"image":"/img/p.png"}]}</script>`;
    const p = parseProductPage(html, 'https://shop.example.com/x/y');
    expect(p.name).toBe('Planter');
    expect(p.priceUsd).toBe(19.5);
    expect(p.imageUrl).toBe('https://shop.example.com/img/p.png');
  });

  it('ignores non-USD prices and falls back to OpenGraph', () => {
    const html = `<meta property="og:title" content="Garden Bench"><meta content="https://img.example.com/b.jpg" property="og:image">
      <meta property="product:price:amount" content="129.00"><meta property="product:price:currency" content="USD">
      <meta property="og:site_name" content="Example Garden">`;
    const p = parseProductPage(html, 'https://shop.example.com/bench');
    expect(p.structured).toBe(false);
    expect(p).toMatchObject({ name: 'Garden Bench', imageUrl: 'https://img.example.com/b.jpg', priceUsd: 129, siteName: 'Example Garden' });

    const eur = parseProductPage('<script type="application/ld+json">{"@type":"Product","name":"X","offers":{"price":"10","priceCurrency":"EUR"}}</script>', 'https://e.com/');
    expect(eur.priceUsd).toBeNull();
  });
});

describe('page helpers', () => {
  it('extracts visible text and candidate images', () => {
    const html = `<html><head><style>.a{}</style><script>var x=1</script><meta property="og:image" content="/og.jpg"></head>
      <body><h1>Lamp</h1><p>Bronze&nbsp;finish</p><img src="/logo.svg"><img data-src="https://cdn.example.com/lamp.jpg"></body></html>`;
    expect(pageText(html)).toBe('Lamp\nBronze finish');
    expect(pageImages(html, 'https://shop.example.com/p')).toEqual(['https://shop.example.com/og.jpg', 'https://cdn.example.com/lamp.jpg']);
  });

  it('names products from URL slugs and guesses categories', () => {
    expect(nameFromUrl('https://www.homedepot.com/p/Hampton-Bay-Bronze-Path-Light-Kit/312345678')).toBe('Hampton Bay Bronze Path Light Kit');
    expect(guessCategory('Bronze LED path light')).toBe('lighting');
    expect(guessCategory('Limelight hydrangea shrub, 3 gal')).toBe('plant');
    expect(guessCategory('Tumbled concrete paver')).toBe('hardscape');
  });
});

describe('stores', () => {
  it('maps hosts to stores and domains', () => {
    expect(storeForUrl('https://www.homedepot.com/p/1')).toEqual({ storeKind: 'home-depot', store: 'The Home Depot' });
    expect(storeForUrl('https://shop.naturehills.com/x')).toEqual({ storeKind: 'nursery', store: 'Nature Hills Nursery' });
    expect(storeForUrl('https://example.com/x')).toBeNull();
    expect(allowedDomainsFor(['lowes'])).toEqual(['lowes.com']);
    expect(allowedDomainsFor(['nursery'])).toContain('highcountrygardens.com');
    expect(allowedDomainsFor(['home-depot', 'other'])).toBeNull();
    expect(urlKey('https://WWW.Lowes.com/pd/x/1/?a=1#b')).toBe('lowes.com/pd/x/1');
  });
});

describe('search evidence', () => {
  const blocks = [
    { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} },
    {
      type: 'web_search_tool_result',
      tool_use_id: 's1',
      content: [{ type: 'web_search_result', url: 'https://www.lowes.com/pd/Lamp/1', title: 'Lamp', page_age: '2 days ago', encrypted_content: 'e' }],
    },
    { type: 'web_search_tool_result', tool_use_id: 's2', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
    { type: 'bash_code_execution_tool_result', tool_use_id: 'c1', content: { type: 'bash_code_execution_result', stdout: 'https://www.lowes.com/pd/Lantern/2, $40', stderr: '', return_code: 0 } },
    { type: 'text', text: 'Two lamps.', citations: [{ type: 'web_search_result_location', url: 'https://www.lowes.com/pd/Sconce/3', title: 'Sconce', cited_text: '', encrypted_index: 'i' }] },
  ];

  it('collects result URLs, cited URLs and filtered output', () => {
    const ev = collectSearchEvidence(blocks);
    expect(ev.results).toEqual([{ url: 'https://www.lowes.com/pd/Lamp/1', title: 'Lamp', pageAge: '2 days ago' }]);
    expect([...ev.seen.keys()].sort()).toEqual(['lowes.com/pd/Lamp/1', 'lowes.com/pd/Lantern/2', 'lowes.com/pd/Sconce/3']);
    expect(ev.text).toContain('Two lamps.');
    expect(ev.text).toContain('https://www.lowes.com/pd/Sconce/3');
    expect(ev.extra).toContain('$40');
  });

  it('keeps only products whose URL was found, on allowed domains, within budget', () => {
    const ev = collectSearchEvidence(blocks);
    const p = (url: string, price: number | null, imageUrl: string | null = null): ProductResult => ({
      name: 'x',
      brand: null,
      store: 'Lowes',
      storeKind: 'other',
      url,
      imageUrl,
      priceUsd: price,
      priceText: null,
      category: 'lighting',
      description: '',
      realHeightFt: null,
      specs: [],
      plant: null,
      light: null,
    });
    const out = filterFoundProducts(
      [
        p('http://lowes.com/pd/Lamp/1?cm_mmc=x', 30, 'https://made-up.example.com/i.jpg'),
        p('https://www.lowes.com/pd/Invented/9', 10),
        p('https://www.lowes.com/pd/Lantern/2', 80),
        p('https://www.lowes.com/pd/Sconce/3', null),
        p('https://www.lowes.com/pd/Lamp/1', 30),
      ],
      ev,
      ['lowes.com'],
      60,
    );
    expect(out.map((x) => x.url)).toEqual(['https://www.lowes.com/pd/Lamp/1', 'https://www.lowes.com/pd/Sconce/3']);
    expect(out[0]).toMatchObject({ storeKind: 'lowes', store: "Lowe's", imageUrl: null });
  });
});
