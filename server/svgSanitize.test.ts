import { describe, expect, it } from 'vitest';
import { MAX_SVG_BYTES, SvgSanitizeError, decodeEntities, sanitizeSvg } from './svgSanitize';

const wrap = (inner: string, attrs = 'viewBox="0 0 200 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
const SHAPE = '<rect x="10" y="10" width="50" height="50" fill="#3a7"/>';

function clean(svg: string) {
  return sanitizeSvg(svg, { prefixIds: false }).svg;
}

describe('sanitizeSvg: removal', () => {
  it('removes <script> elements and their content', () => {
    const out = clean(wrap(`<script>alert("x")</script>${SHAPE}<script type="text/javascript"><![CDATA[ if (a < b) {} ]]></script>`));
    expect(out).not.toMatch(/script|alert/i);
    expect(out).toContain('<rect');
  });

  it('removes event handler attributes', () => {
    const out = clean(
      wrap(`<g onclick="steal()" ONMOUSEOVER='x()'><circle cx="5" cy="5" r="4" onload="evil()" fill="red"/></g>`, 'viewBox="0 0 10 10" onload="alert(1)"'),
    );
    expect(out).not.toMatch(/on(click|mouseover|load)/i);
    expect(out).toContain('<circle');
  });

  it('removes foreignObject with everything inside it', () => {
    const out = clean(wrap(`<foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject>${SHAPE}`));
    expect(out).not.toMatch(/foreignObject|<div|<img|onerror/i);
  });

  it('removes external href / xlink:href but keeps fragment and data:image references', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const out = clean(
      wrap(
        `<defs><path id="p" d="M0 0L10 10"/></defs>` +
          `<use href="#p"/><use xlink:href="https://evil.example/sprite.svg#p"/>` +
          `<image href="http://evil.example/a.png" width="10" height="10"/>` +
          `<image xlink:href="${png}" width="10" height="10"/>` +
          `<a href="javascript:alert(1)"><circle cx="1" cy="1" r="1"/></a>`,
        'viewBox="0 0 10 10" xmlns:xlink="http://www.w3.org/1999/xlink"',
      ),
    );
    expect(out).toContain('href="#p"');
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('javascript');
    expect(out).toContain(`xlink:href="${png}"`);
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(out.match(/<image/g)).toHaveLength(1);
    expect(out).toContain('<circle'); // <a> is unwrapped, content kept
    expect(out).not.toContain('<a');
  });

  it('removes javascript: hidden behind entities and whitespace', () => {
    const out = clean(wrap(`<a href="&#106;ava&#x73;cript:alert(1)"><use href=" java\tscript:alert(1)"/></a>${SHAPE}`));
    expect(out).not.toMatch(/script/i);
  });

  it('strips @import and external url() from styles', () => {
    const out = clean(
      wrap(
        `<style>@import url("https://evil.example/x.css"); .a { fill: url(http://evil.example/p.svg#g); stroke: url(#ok) } .b{behavior:url(x.htc)}</style>` +
          `<rect class="a" style="fill: url('https://evil.example/f'); opacity: .5" width="5" height="5"/>` +
          `<rect fill="url(https://evil.example/g)" filter="url(#ok)" width="5" height="5"/>`,
      ),
    );
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('@import');
    expect(out).not.toContain('behavior');
    expect(out).toContain('url(#ok)');
    expect(out).toContain('opacity: .5');
  });

  it('drops DOCTYPE (entity expansion), comments, processing instructions and animation', () => {
    const out = clean(
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol">]><!-- hi -->` +
        wrap(`<set attributeName="href" to="javascript:alert(1)"/><animate attributeName="x" values="0;1"/>${SHAPE}`),
    );
    expect(out.startsWith('<svg')).toBe(true);
    expect(out).not.toMatch(/DOCTYPE|ENTITY|<!--|<\?xml|<set|<animate/);
  });

  it('drops attributes with undeclared namespace prefixes', () => {
    const out = clean(wrap(`<g inkscape:label="Layer 1" sodipodi:nodetypes="cc">${SHAPE}</g>`));
    expect(out).not.toMatch(/inkscape|sodipodi/);
  });
});

describe('sanitizeSvg: root normalization', () => {
  it('keeps the viewBox and sets width/height and the namespace', () => {
    const r = sanitizeSvg(`<svg viewBox="0 0 400 520">${SHAPE}</svg>`);
    expect(r.svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 400 520" width="400" height="520"/);
    expect(r.aspect).toBeCloseTo(400 / 520, 6);
    expect(r.viewBox).toEqual([0, 0, 400, 520]);
  });

  it('derives a viewBox from width/height when missing', () => {
    const r = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="300px" height="150">${SHAPE}</svg>`);
    expect(r.svg).toContain('viewBox="0 0 300 150"');
    expect(r.aspect).toBe(2);
  });

  it('scales tiny drawings up and replaces percentage sizes', () => {
    const r = sanitizeSvg(wrap(SHAPE, 'viewBox="0 0 24 48" width="100%" height="100%"'));
    expect(r.width).toBe(256);
    expect(r.height).toBe(512);
    expect(r.svg).not.toContain('100%');
  });

  it('accepts markup wrapped in a code fence', () => {
    const r = sanitizeSvg('```svg\n' + wrap(SHAPE) + '\n```');
    expect(r.svg.startsWith('<svg')).toBe(true);
    expect(r.svg.endsWith('</svg>')).toBe(true);
  });

  it('removes a full-bleed white background rectangle but not real content', () => {
    const bg = sanitizeSvg(wrap(`<rect width="100%" height="100%" fill="#ffffff"/>${SHAPE}`, 'viewBox="0 0 100 100"'));
    expect(bg.svg.match(/<rect/g)).toHaveLength(1);
    const colored = sanitizeSvg(wrap(`<rect width="100" height="100" fill="#8a5a3b"/>${SHAPE}`, 'viewBox="0 0 100 100"'));
    expect(colored.svg.match(/<rect/g)).toHaveLength(2);
  });

  it('prefixes ids and every reference to them consistently', () => {
    const r = sanitizeSvg(
      wrap(
        `<style>#leaf { opacity: .9 } .x { fill: url(#grad) }</style>` +
          `<defs><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient><path id="leaf" d="M0 0L5 5"/></defs>` +
          `<rect fill="url(#grad)" style="stroke: url(#grad)" width="5" height="5"/><use href="#leaf"/>`,
      ),
      { prefixIds: 'p1-' },
    );
    expect(r.svg).toContain('id="p1-grad"');
    expect(r.svg).toContain('fill="url(#p1-grad)"');
    expect(r.svg).toContain('stroke: url(#p1-grad)');
    expect(r.svg).toContain('href="#p1-leaf"');
    expect(r.svg).toContain('#p1-leaf {');
    expect(r.svg).toContain('url(#p1-grad)');
    expect(r.svg).not.toMatch(/"#grad"|url\(#grad\)/);
  });

  it('re-escapes text and attribute values', () => {
    const r = sanitizeSvg(wrap(`<text x="1" y="1" data-x="a &amp; &quot;b&quot;">Tom &amp; Jerry &lt;3</text>${SHAPE}`));
    expect(r.svg).toContain('data-x="a &amp; &quot;b&quot;"');
    expect(r.svg).toContain('>Tom &amp; Jerry &lt;3</text>');
  });
});

describe('sanitizeSvg: errors', () => {
  it('rejects non-SVG input', () => {
    expect(() => sanitizeSvg('<html><body>nope</body></html>')).toThrow(SvgSanitizeError);
    expect(() => sanitizeSvg('just text')).toThrow(SvgSanitizeError);
  });

  it('rejects SVGs without a usable size', () => {
    expect(() => sanitizeSvg(`<svg>${SHAPE}</svg>`)).toThrow(/viewBox/);
    expect(() => sanitizeSvg(wrap(SHAPE, 'viewBox="0 0 0 10"'))).toThrow(SvgSanitizeError);
  });

  it('rejects SVGs with nothing visible', () => {
    expect(() => sanitizeSvg(wrap('<script>alert(1)</script>'))).toThrow(/visible/);
  });

  it('enforces the size limit', () => {
    const big = wrap(SHAPE.repeat(Math.ceil(MAX_SVG_BYTES / SHAPE.length) + 1));
    expect(() => sanitizeSvg(big)).toThrow(/too large/);
  });

  it('rejects pathological nesting', () => {
    expect(() => sanitizeSvg(wrap('<g>'.repeat(200) + SHAPE + '</g>'.repeat(200)))).toThrow(/nested/);
  });
});

describe('decodeEntities', () => {
  it('decodes numeric and XML named entities', () => {
    expect(decodeEntities('&#106;&#x61;&lt;&amp;&quot;&apos;&gt;&nbsp;&unknown;')).toBe('ja<&"\'> &unknown;');
  });
});
