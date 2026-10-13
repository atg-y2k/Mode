/**
 * SVG sanitizer for AI-generated vector assets.
 *
 * Parses the markup into a small tree and re-serializes it with an
 * allow-list of SVG elements: scripts, foreignObject, animation, event
 * handlers, external references (href / url() / @import) and DOCTYPE
 * declarations are removed. The root gets a valid viewBox, explicit
 * width/height and the SVG namespace; ids are prefixed so several assets can
 * be inlined in one document without gradient-id collisions.
 *
 * Pure string processing (no DOM) so it runs on the server and in tests.
 */

export const MAX_SVG_BYTES = 200 * 1024;

export class SvgSanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgSanitizeError';
  }
}

export interface SanitizedSvg {
  svg: string;
  /** Intrinsic size written on the root element. */
  width: number;
  height: number;
  /** viewBox width / height. */
  aspect: number;
  viewBox: [number, number, number, number];
}

export interface SanitizeOptions {
  /** Default MAX_SVG_BYTES. */
  maxBytes?: number;
  /** Prefix all ids (default true; prefix derived from a hash of the input). */
  prefixIds?: boolean | string;
  /** Remove a full-bleed white background rectangle (default true). */
  stripBackground?: boolean;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const ALLOWED_ELEMENTS = [
  'svg', 'g', 'defs', 'symbol', 'use', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood',
  'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode',
  'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
  'text', 'tspan', 'textPath', 'image', 'style',
] as const;

/** lower-case name -> canonical SVG spelling */
const CANONICAL = new Map<string, string>(ALLOWED_ELEMENTS.map((n) => [n.toLowerCase(), n]));

/** Removed but their children are kept. */
const UNWRAP_ELEMENTS = new Set(['a']);

/** Elements whose content is raw text (never parsed as markup). */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

const DRAWABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use', 'text', 'image']);

const TEXT_CONTENT_ELEMENTS = new Set(['text', 'tspan', 'textPath', 'style']);

const DROPPED_ATTRIBUTES = new Set([
  'src', 'srcset', 'xml:base', 'formaction', 'action', 'background', 'lowsrc', 'dynsrc', 'ping',
  'attributename', 'xlink:actuate', 'xlink:show', 'xlink:role', 'xlink:arcrole', 'target',
]);

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const SAFE_FRAGMENT = /^#[A-Za-z_][\w.:-]*$/;
const DANGEROUS_SCHEME = /(?:java|vb|live)script:/i;
const ATTR_NAME = /^[A-Za-z_][\w.:-]*$/;

const MAX_DEPTH = 64;
const MAX_ELEMENTS = 20_000;

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

interface ElementNode {
  type: 'el';
  name: string;
  attrs: [string, string][];
  children: TreeNode[];
}
interface TextNode {
  type: 'text';
  value: string;
}
type TreeNode = ElementNode | TextNode;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(input: string): string {
  return input.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);?/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

function escapeText(s: string): string {
  return s.replace(INVALID_XML_CHARS, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

interface ParsedTag {
  name: string;
  attrs: [string, string][];
  selfClosing: boolean;
  end: number;
}

function readTag(src: string, lt: number): ParsedTag | null {
  const nameMatch = /^[A-Za-z_][\w:.-]*/.exec(src.slice(lt + 1, lt + 129));
  if (!nameMatch) return null;
  const name = nameMatch[0];
  const attrs: [string, string][] = [];
  let i = lt + 1 + name.length;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
      i++;
      continue;
    }
    if (ch === '>') return { name, attrs, selfClosing: false, end: i + 1 };
    if (ch === '/' && src[i + 1] === '>') return { name, attrs, selfClosing: true, end: i + 2 };
    if (ch === '/') {
      i++;
      continue;
    }
    const attrMatch = /^[^\s=/>"']+/.exec(src.slice(i, i + 256));
    if (!attrMatch) return null; // stray quote etc.
    const attrName = attrMatch[0];
    i += attrName.length;
    while (i < n && /\s/.test(src[i])) i++;
    let value = '';
    if (src[i] === '=') {
      i++;
      while (i < n && /\s/.test(src[i])) i++;
      const q = src[i];
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, i + 1);
        if (close === -1) return null;
        value = src.slice(i + 1, close);
        i = close + 1;
      } else {
        const unquoted = /^[^\s>]+/.exec(src.slice(i, i + 4096));
        value = unquoted ? unquoted[0] : '';
        i += value.length;
      }
    }
    attrs.push([attrName, decodeEntities(value)]);
  }
  return null;
}

/** Index just past the end of a <!...> declaration (handles DOCTYPE internal subsets). */
function skipDeclaration(src: string, lt: number): number {
  let depth = 0;
  for (let i = lt + 2; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === '>' && depth === 0) return i + 1;
  }
  return src.length;
}

function parse(src: string): ElementNode {
  const root: ElementNode = { type: 'el', name: '#root', attrs: [], children: [] };
  const stack: ElementNode[] = [root];
  let elements = 0;
  const top = () => stack[stack.length - 1];
  const pushText = (value: string) => {
    if (value) top().children.push({ type: 'text', value });
  };

  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      pushText(decodeEntities(src.slice(i)));
      break;
    }
    if (lt > i) pushText(decodeEntities(src.slice(i, lt)));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      pushText(src.slice(lt + 9, end === -1 ? src.length : end));
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      i = skipDeclaration(src, lt);
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (src.startsWith('</', lt)) {
      const m = /^<\/\s*([A-Za-z_][\w:.-]*)\s*>/.exec(src.slice(lt, lt + 160));
      if (m) {
        const name = m[1];
        let idx = -1;
        for (let k = stack.length - 1; k > 0; k--) {
          if (stack[k].name === name) {
            idx = k;
            break;
          }
        }
        if (idx === -1) {
          for (let k = stack.length - 1; k > 0; k--) {
            if (stack[k].name.toLowerCase() === name.toLowerCase()) {
              idx = k;
              break;
            }
          }
        }
        if (idx > 0) stack.length = idx;
        i = lt + m[0].length;
      } else {
        i = lt + 2;
      }
      continue;
    }

    const tag = readTag(src, lt);
    if (!tag) {
      // A stray '<' that doesn't start a tag: drop it.
      i = lt + 1;
      continue;
    }
    if (++elements > MAX_ELEMENTS) throw new SvgSanitizeError('The SVG has too many elements.');
    const el: ElementNode = { type: 'el', name: tag.name, attrs: tag.attrs, children: [] };
    top().children.push(el);
    i = tag.end;

    const lower = tag.name.toLowerCase();
    if (RAW_TEXT_ELEMENTS.has(lower) && !tag.selfClosing) {
      const closeRe = new RegExp(`</\\s*${lower}\\s*>`, 'i');
      const rest = src.slice(i);
      const m = closeRe.exec(rest);
      let raw = m ? rest.slice(0, m.index) : rest;
      raw = raw.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
      if (lower === 'style') el.children.push({ type: 'text', value: decodeEntities(raw) });
      i = m ? i + m.index + m[0].length : src.length;
      continue;
    }
    if (!tag.selfClosing) {
      stack.push(el);
      if (stack.length > MAX_DEPTH) throw new SvgSanitizeError('The SVG is nested too deeply.');
    }
  }
  return root;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function isSafeUrlTarget(raw: string): boolean {
  const v = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  return SAFE_FRAGMENT.test(v) || SAFE_DATA_IMAGE.test(v);
}

const URL_FN = /url\(\s*(['"]?)([^)]*?)\1\s*\)/gi;

function hasUnsafeUrl(value: string): boolean {
  if (!/url\s*\(/i.test(value)) return false;
  // Unparseable url( ... without a closing paren counts as unsafe.
  const stripped = value.replace(URL_FN, (_m, _q, target: string) => (isSafeUrlTarget(target) ? '' : 'UNSAFE'));
  return stripped.includes('UNSAFE') || /url\s*\(/i.test(stripped);
}

function cssIsDangerous(value: string): boolean {
  const compact = value.replace(/[\s\u0000-\u001f]+/g, '');
  return (
    DANGEROUS_SCHEME.test(compact) ||
    /expression\(/i.test(compact) ||
    /-moz-binding/i.test(compact) ||
    /behavior:/i.test(compact) ||
    /@import/i.test(compact)
  );
}

/** Sanitizes a style="" declaration list; returns '' when nothing survives. */
function sanitizeStyleAttr(value: string): string {
  const css = value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\/g, '');
  return css
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && d.includes(':') && !cssIsDangerous(d) && !hasUnsafeUrl(d))
    .join('; ');
}

/** Sanitizes the text of a <style> element. */
function sanitizeStyleSheet(css: string): string {
  let out = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\/g, '');
  out = out.replace(/@import[^;]*;?/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, '');
  out = out.replace(URL_FN, (m, _q, target: string) => (isSafeUrlTarget(target) ? m : 'none'));
  // Drop any selector / declaration fragment that is still unsafe.
  out = out.replace(/[^;{}]+/g, (seg) => (cssIsDangerous(seg) || hasUnsafeUrl(seg) ? '' : seg));
  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Sanitize
// ---------------------------------------------------------------------------

function attr(el: ElementNode, name: string): string | undefined {
  const lower = name.toLowerCase();
  return el.attrs.find(([k]) => k.toLowerCase() === lower)?.[1];
}

function sanitizeAttrs(el: ElementNode, canonical: string): [string, string][] {
  const out: [string, string][] = [];
  for (const [rawName, rawValue] of el.attrs) {
    if (!ATTR_NAME.test(rawName)) continue;
    const name = rawName;
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) continue;
    if (lower === 'xmlns' || lower.startsWith('xmlns:')) continue;
    // Only the xml: and xlink: prefixes are declared on output; others would be unbound.
    if (lower.includes(':') && !lower.startsWith('xml:') && !lower.startsWith('xlink:')) continue;
    if (DROPPED_ATTRIBUTES.has(lower)) continue;
    const value = rawValue.replace(INVALID_XML_CHARS, '');
    const compact = value.replace(/[\s\u0000-\u001f]+/g, '');
    if (DANGEROUS_SCHEME.test(compact)) continue;

    if (lower === 'href' || lower === 'xlink:href') {
      const v = value.trim();
      if (SAFE_FRAGMENT.test(v) || (canonical === 'image' && SAFE_DATA_IMAGE.test(v))) out.push([name, v]);
      continue;
    }
    if (lower === 'style') {
      const css = sanitizeStyleAttr(value);
      if (css) out.push(['style', css]);
      continue;
    }
    if (cssIsDangerous(value) || hasUnsafeUrl(value)) continue;
    out.push([name, value]);
  }
  return out;
}

function sanitizeNode(node: TreeNode, parentCanonical: string): TreeNode[] {
  if (node.type === 'text') {
    // Text outside text elements is not rendered by SVG; drop it.
    return TEXT_CONTENT_ELEMENTS.has(parentCanonical) ? [node] : [];
  }
  const lower = node.name.toLowerCase();
  if (UNWRAP_ELEMENTS.has(lower)) return node.children.flatMap((c) => sanitizeNode(c, parentCanonical));
  const canonical = CANONICAL.get(lower);
  if (!canonical) return [];

  if (canonical === 'style') {
    const css = sanitizeStyleSheet(
      node.children.map((c) => (c.type === 'text' ? c.value : '')).join(''),
    );
    return css ? [{ type: 'el', name: 'style', attrs: [], children: [{ type: 'text', value: css }] }] : [];
  }

  const attrs = sanitizeAttrs(node, canonical);
  if (canonical === 'image' && !attrs.some(([k]) => k === 'href' || k === 'xlink:href')) return [];
  if (canonical === 'use' && !attrs.some(([k]) => k === 'href' || k === 'xlink:href')) return [];
  const children = node.children.flatMap((c) => sanitizeNode(c, canonical));
  return [{ type: 'el', name: canonical, attrs, children }];
}

// ---------------------------------------------------------------------------
// Root normalization
// ---------------------------------------------------------------------------

function parseLength(value: string | undefined): number | null {
  if (value == null) return null;
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*(px)?\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseViewBox(value: string | undefined): [number, number, number, number] | null {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts;
  return w > 0 && h > 0 ? [x, y, w, h] : null;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function isWhiteish(color: string | undefined): boolean {
  if (!color) return false;
  const c = color.trim().toLowerCase();
  if (c === 'white' || c === 'snow' || c === 'ivory' || c === 'whitesmoke') return true;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c);
  if (!m) return false;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
  return [0, 2, 4].every((k) => parseInt(hex.slice(k, k + 2), 16) >= 0xf0);
}

function fillOf(el: ElementNode): string | undefined {
  const style = attr(el, 'style');
  const fromStyle = style ? /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(style)?.[1] : undefined;
  return fromStyle ?? attr(el, 'fill');
}

/** Removes a leading full-bleed white rectangle (a "background" the model added). */
function stripBackgroundRect(svg: ElementNode, vb: [number, number, number, number]): void {
  const first = svg.children.find((c): c is ElementNode => c.type === 'el' && !['defs', 'style'].includes(c.name));
  if (!first || first.name !== 'rect' || first.children.length) return;
  const [vx, vy, vw, vh] = vb;
  const size = (v: string | undefined, full: number) =>
    v?.trim().endsWith('%') ? (parseFloat(v) / 100) * full : parseLength(v) ?? 0;
  const x = parseFloat(attr(first, 'x') ?? '0') || 0;
  const y = parseFloat(attr(first, 'y') ?? '0') || 0;
  const w = size(attr(first, 'width'), vw);
  const h = size(attr(first, 'height'), vh);
  const covers = x <= vx + vw * 0.01 && y <= vy + vh * 0.01 && w >= vw * 0.98 && h >= vh * 0.98;
  if (covers && isWhiteish(fillOf(first)) && !attr(first, 'transform')) {
    svg.children.splice(svg.children.indexOf(first), 1);
  }
}

function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function collectIds(node: TreeNode, ids: Set<string>): void {
  if (node.type !== 'el') return;
  const id = attr(node, 'id');
  if (id) ids.add(id);
  for (const c of node.children) collectIds(c, ids);
}

function rewriteRefs(value: string, map: Map<string, string>): string {
  return value.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (m, q: string, id: string) => {
    const next = map.get(id);
    return next ? `url(${q}#${next}${q})` : m;
  });
}

function rewriteCssSelectors(css: string, map: Map<string, string>): string {
  // Rewrite url(#id) everywhere and #id in selector parts (outside { }).
  let out = '';
  let depth = 0;
  let selector = '';
  for (const ch of rewriteRefs(css, map)) {
    if (depth === 0 && ch !== '{') {
      selector += ch;
      continue;
    }
    if (depth === 0 && ch === '{') {
      out += selector.replace(/#([A-Za-z_][\w-]*)/g, (m, id: string) => {
        const next = map.get(id);
        return next ? `#${next}` : m;
      });
      selector = '';
    }
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(0, depth - 1);
    out += ch;
  }
  return out + selector;
}

function applyIdPrefix(node: TreeNode, map: Map<string, string>): void {
  if (node.type !== 'el') return;
  if (node.name === 'style') {
    for (const c of node.children) if (c.type === 'text') c.value = rewriteCssSelectors(c.value, map);
    return;
  }
  node.attrs = node.attrs.map(([k, v]) => {
    const lower = k.toLowerCase();
    if (lower === 'id') return [k, map.get(v) ?? v];
    if ((lower === 'href' || lower === 'xlink:href') && v.startsWith('#')) {
      const next = map.get(v.slice(1));
      return [k, next ? `#${next}` : v];
    }
    return [k, rewriteRefs(v, map)];
  });
  for (const c of node.children) applyIdPrefix(c, map);
}

function serialize(node: TreeNode): string {
  if (node.type === 'text') return escapeText(node.value);
  const attrs = node.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
  if (!node.children.length) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serialize).join('')}</${node.name}>`;
}

function containsDrawable(node: TreeNode): boolean {
  if (node.type !== 'el') return false;
  if (node.name === 'defs' || node.name === 'clipPath' || node.name === 'mask' || node.name === 'pattern') return false;
  if (DRAWABLE.has(node.name)) return true;
  return node.children.some(containsDrawable);
}

function usesXlink(node: TreeNode): boolean {
  if (node.type !== 'el') return false;
  return node.attrs.some(([k]) => k.toLowerCase().startsWith('xlink:')) || node.children.some(usesXlink);
}

/**
 * Sanitizes untrusted SVG markup. Throws SvgSanitizeError with a
 * user-presentable message when the input can't be made into a usable asset.
 */
export function sanitizeSvg(input: string, opts: SanitizeOptions = {}): SanitizedSvg {
  const maxBytes = opts.maxBytes ?? MAX_SVG_BYTES;
  const bytes = Buffer.byteLength(input, 'utf8');
  if (bytes > maxBytes) {
    throw new SvgSanitizeError(`The SVG is too large (${Math.ceil(bytes / 1024)} KB; the limit is ${Math.floor(maxBytes / 1024)} KB).`);
  }

  // Tolerate a markdown code fence or a leading XML declaration around the markup.
  const start = input.search(/<svg[\s>]/i);
  if (start === -1) throw new SvgSanitizeError("The drawing isn't a valid SVG image.");
  const tree = parse(input.slice(start));
  const rootEl = tree.children.find((c): c is ElementNode => c.type === 'el');
  if (!rootEl || rootEl.name.toLowerCase() !== 'svg') throw new SvgSanitizeError("The drawing isn't a valid SVG image.");

  const [clean] = sanitizeNode(rootEl, '#root') as ElementNode[];

  let vb = parseViewBox(attr(clean, 'viewBox'));
  if (!vb) {
    const w = parseLength(attr(clean, 'width'));
    const h = parseLength(attr(clean, 'height'));
    if (w && h) vb = [0, 0, w, h];
  }
  if (!vb) throw new SvgSanitizeError('The SVG has no usable viewBox or size.');
  const aspect = vb[2] / vb[3];
  if (!(aspect >= 0.02 && aspect <= 50)) throw new SvgSanitizeError('The SVG has unusable proportions.');

  if (opts.stripBackground ?? true) stripBackgroundRect(clean, vb);
  if (!containsDrawable(clean)) throw new SvgSanitizeError('The SVG has no visible content.');

  if (opts.prefixIds ?? true) {
    const ids = new Set<string>();
    collectIds(clean, ids);
    if (ids.size) {
      const prefix = typeof opts.prefixIds === 'string' ? opts.prefixIds : `m${hashString(input)}-`;
      const map = new Map([...ids].map((id) => [id, `${prefix}${id}`]));
      applyIdPrefix(clean, map);
    }
  }

  // Intrinsic size: keep the viewBox size, scaled into a sensible 256..2048 range.
  const long = Math.max(vb[2], vb[3]);
  const scale = long < 256 ? 512 / long : long > 2048 ? 2048 / long : 1;
  const width = Math.round(vb[2] * scale * 100) / 100;
  const height = Math.round(vb[3] * scale * 100) / 100;

  const rootAttrs: [string, string][] = [['xmlns', 'http://www.w3.org/2000/svg']];
  if (usesXlink(clean)) rootAttrs.push(['xmlns:xlink', 'http://www.w3.org/1999/xlink']);
  rootAttrs.push(['viewBox', vb.map(fmt).join(' ')], ['width', fmt(width)], ['height', fmt(height)]);
  const skip = new Set(['viewbox', 'width', 'height', 'x', 'y']);
  clean.attrs = [...rootAttrs, ...clean.attrs.filter(([k]) => !skip.has(k.toLowerCase()))];

  const svg = serialize(clean);
  if (Buffer.byteLength(svg, 'utf8') > maxBytes) {
    throw new SvgSanitizeError(`The SVG is too large (limit ${Math.floor(maxBytes / 1024)} KB).`);
  }
  return { svg, width, height, aspect, viewBox: vb };
}
