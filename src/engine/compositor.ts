/**
 * Full render pipeline for one design of one photo (browser: uses canvas for
 * drawing placed objects). Order:
 *   original photo
 *   → region treatments in region order (paint via applyPaint, materials via
 *     applyMaterial), skipping design.hiddenRegionIds          [cached layer]
 *   → placed objects (sorted by z, contact shadows, flip/rotate/opacity) and
 *     visible fixture art for lights with showFixture
 *   → applyGrade(design.lighting)
 *   → renderLights(design.lights)
 * Fixture art is drawn before the grade so it darkens at night like the rest
 * of the scene; the glow added afterwards makes the fixtures read as lit.
 */
import type { AssetDef, Design, MaterialDef, Photo, PlacedLight, PlacedObject, Region, Treatment } from '../../shared/types';
import { FIXTURE_EMITTER_Y, renderArt } from '../assets/art';
import { getAssetImage } from './assetImages';
import { applyGrade, isIdentityGrade, lightEndPoint, renderLights, stringBulbRadius, stringBulbs, stringSag } from './lighting';
import { applyMaterial, mappingForRegion } from './materialFill';
import { applyPaint } from './recolor';
import { getTexture } from './textures';
import { cloneImageData } from './types';
import type { ImageDataLike, Mask } from './types';

export interface RenderContext {
  photo: Photo;
  design: Design;
  /** Original photo pixels at working resolution (photo.width × photo.height). */
  image: ImageDataLike;
  getMask(maskId: string): Mask | undefined;
  getMaterial(id: string): MaterialDef | undefined;
  getAsset(id: string): AssetDef | undefined;
  /** Bumped whenever a mask's pixels change; part of the treatment-layer cache key. */
  maskVersions?: Record<string, number>;
}

export interface RenderOptions {
  /** Default true. */
  includeObjects?: boolean;
  /** Default true. Grade + light glows. */
  includeLighting?: boolean;
  /** Only render the treatment of this region at full strength and others as-is (used for previews). Optional. */
  soloRegionId?: string;
}

// ---------------------------------------------------------------------------
// Treatments (pure)
// ---------------------------------------------------------------------------

function applyTreatment(ctx: RenderContext, region: Region, t: Treatment, mask: Mask, out: ImageDataLike, strength: number): void {
  if (t.type === 'paint') {
    applyPaint(ctx.image, out, mask, { hex: t.hex, finish: t.finish, strength });
    return;
  }
  const material = ctx.getMaterial(t.materialId);
  if (!material) return;
  const { mapping, tilePxPerInch } = mappingForRegion(region, ctx.photo, t, material);
  const tile = getTexture(material.texture, tilePxPerInch);
  applyMaterial(ctx.image, out, mask, { tile, mapping, tint: t.tint, strength });
}

/**
 * Original + all visible region treatments (pure; no canvas).
 * Every treatment reads its shading from the original photo; regions later
 * in the list win where masks overlap. With `soloRegionId`, only that
 * region's treatment is applied, at full strength (even if hidden).
 */
export function renderTreatmentsLayer(ctx: RenderContext, opts: { soloRegionId?: string } = {}): ImageDataLike {
  const src = ctx.image;
  const out = cloneImageData(src);
  const solo = opts.soloRegionId;
  const hidden = new Set(ctx.design.hiddenRegionIds ?? []);
  for (const region of ctx.photo.regions) {
    if (solo ? region.id !== solo : hidden.has(region.id)) continue;
    const t = ctx.design.treatments[region.id];
    if (!t) continue;
    const mask = ctx.getMask(region.maskId);
    // A mask of another size would be misaligned with the photo: skip it rather than smear it.
    if (!mask || mask.width !== src.width || mask.height !== src.height) continue;
    const strength = solo ? 1 : t.strength;
    try {
      applyTreatment(ctx, region, t, mask, out, strength);
    } catch (err) {
      // One broken treatment (bad material data…) must not take the whole render down.
      console.warn(`[compositor] skipped the treatment of "${region.name}"`, err);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * A canvas plus its 2D context: OffscreenCanvas when it supports 2D (Safari
 * < 16.4 doesn't), else a detached <canvas>. The context is created here, with
 * the read-back hint, because the first getContext call fixes its attributes.
 */
function createSurface(width: number, height: number, willReadFrequently = false): { canvas: AnyCanvas; g: Ctx2D } {
  const attrs = willReadFrequently ? { willReadFrequently: true } : undefined;
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const g = canvas.getContext('2d', attrs) as OffscreenCanvasRenderingContext2D | null;
      if (g) return { canvas, g };
    } catch {
      // fall through to a DOM canvas
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d', attrs) as CanvasRenderingContext2D | null;
    if (g) return { canvas, g };
  }
  throw new Error('Rendering needs a browser canvas');
}

/** 2D context of a caller-provided canvas. */
function context2d(canvas: AnyCanvas): Ctx2D {
  const g = canvas.getContext('2d') as Ctx2D | null;
  if (!g) throw new Error('2D canvas is unavailable');
  return g;
}

function toImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height);
}

async function canvasToBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality);
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// Placed objects & fixture art
// ---------------------------------------------------------------------------

/** Stable small ids for object identities (assets are replaced, never mutated, on edit). */
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
function identityOf(o: object): number {
  let id = identities.get(o);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(o, id);
  }
  return id;
}

function hasVisual(asset: AssetDef): boolean {
  return !!(asset.art || asset.svg || asset.imageId);
}

function isVector(asset: AssetDef): boolean {
  return !!(asset.art || asset.svg);
}

/** Where the base sits on the art, 0..1 from the top (art anchor; bottom edge for other sources). */
function anchorYOf(asset: AssetDef): number {
  if (!asset.art) return 1;
  try {
    const a = renderArt(asset.art).anchorY;
    return a > 0 && a <= 1 ? a : 1;
  } catch {
    return 1;
  }
}

/** Light emitter position on a fixture's art, 0..1 from the top. */
function emitterYOf(asset: AssetDef): number {
  const e = asset.light?.emitterY;
  if (typeof e === 'number' && Number.isFinite(e)) return clamp(e, 0, 1);
  if (asset.art?.kind === 'fixture') return FIXTURE_EMITTER_Y[asset.art.form] ?? 0.5;
  return 0.5;
}

function aspectOf(asset: AssetDef, img: CanvasImageSource | undefined): number {
  if (asset.aspect > 0 && Number.isFinite(asset.aspect)) return asset.aspect;
  const w = img && 'width' in img ? Number(img.width) : 0;
  const h = img && 'height' in img ? Number(img.height) : 0;
  return w > 0 && h > 0 ? w / h : 1;
}

interface DrawPlan {
  objects: { obj: PlacedObject; asset: AssetDef; tint?: string }[];
  fixtures: { light: PlacedLight; asset: AssetDef }[];
  wires: { light: PlacedLight; asset?: AssetDef }[];
}

function planDrawables(ctx: RenderContext): DrawPlan {
  const objects: DrawPlan['objects'] = [];
  const sorted = (ctx.design.objects ?? [])
    .map((obj, i) => ({ obj, i }))
    .sort((a, b) => finite(a.obj.z, 0) - finite(b.obj.z, 0) || a.i - b.i);
  for (const { obj } of sorted) {
    const asset = ctx.getAsset(obj.assetId);
    if (!asset || !hasVisual(asset) || !(obj.height > 0) || !(finite(obj.opacity, 1) > 0)) continue;
    objects.push({ obj, asset, tint: isVector(asset) && obj.tint ? obj.tint : undefined });
  }
  const fixtures: DrawPlan['fixtures'] = [];
  const wires: DrawPlan['wires'] = [];
  for (const light of ctx.design.lights ?? []) {
    if (!light.showFixture) continue;
    const asset = light.assetId ? ctx.getAsset(light.assetId) : undefined;
    if (light.beam === 'string' || light.beam === 'strip') wires.push({ light, asset });
    else if (asset && hasVisual(asset) && light.fixtureSize > 0) fixtures.push({ light, asset });
  }
  return { objects, fixtures, wires };
}

function imageKey(asset: AssetDef, tint?: string): string {
  return `${identityOf(asset)}|${tint ?? ''}`;
}

/** Decodes every image the plan needs; failures are left out (those items are skipped). */
async function loadImages(plan: DrawPlan): Promise<Map<string, CanvasImageSource>> {
  const wanted = new Map<string, { asset: AssetDef; tint?: string }>();
  for (const o of plan.objects) wanted.set(imageKey(o.asset, o.tint), { asset: o.asset, tint: o.tint });
  for (const f of plan.fixtures) wanted.set(imageKey(f.asset), { asset: f.asset });
  const out = new Map<string, CanvasImageSource>();
  await Promise.all(
    [...wanted].map(async ([key, { asset, tint }]) => {
      try {
        out.set(key, await getAssetImage(asset, tint));
      } catch {
        // Missing / undecodable visual: skip the item.
      }
    }),
  );
  return out;
}

/** Soft contact shadow: a blurred dark ellipse on the ground under the anchor, sized by the object's width. */
function drawContactShadow(g: Ctx2D, x: number, y: number, w: number, h: number, alpha: number): void {
  const rx = Math.max(2, w * 0.46);
  const ry = clamp(w * 0.11, 1.5, Math.max(1.5, h * 0.2));
  const blob = (sx: number, sy: number, a: number, mid: number) => {
    g.save();
    g.translate(x, y + sy * 0.15);
    g.scale(sx, sy);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, `rgba(0,0,0,${a})`);
    grad.addColorStop(0.5, `rgba(0,0,0,${a * mid})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  blob(rx, ry, 0.34 * alpha, 0.5); // ambient occlusion spread
  blob(rx * 0.55, ry * 0.5, 0.3 * alpha, 0.45); // tight contact core
}

function drawObject(g: Ctx2D, o: DrawPlan['objects'][number], img: CanvasImageSource): void {
  const { obj, asset } = o;
  const h = obj.height;
  const w = h * aspectOf(asset, img);
  const anchorY = anchorYOf(asset);
  const alpha = clamp(finite(obj.opacity, 1), 0, 1);
  if (obj.shadow) drawContactShadow(g, obj.x, obj.y, w, h, alpha);
  g.save();
  g.globalAlpha = alpha;
  g.translate(obj.x, obj.y);
  const rot = finite(obj.rotation, 0);
  if (rot) g.rotate((rot * Math.PI) / 180);
  if (obj.flipX) g.scale(-1, 1);
  g.drawImage(img, -w / 2, -anchorY * h, w, h);
  g.restore();
}

/** Fixture art sized fixtureSize tall, placed so its emitter sits exactly on the light point. */
function drawFixture(g: Ctx2D, f: DrawPlan['fixtures'][number], img: CanvasImageSource): void {
  const size = f.light.fixtureSize;
  const w = size * aspectOf(f.asset, img);
  const top = f.light.y - emitterYOf(f.asset) * size;
  g.drawImage(img, f.light.x - w / 2, top, w, size);
}

/** Metal color of a fixture's art (for wires / channels drawn by the compositor). */
function finishOf(asset: AssetDef | undefined): string {
  return asset?.art?.kind === 'fixture' && /^#[0-9a-f]{6}$/i.test(asset.art.finish) ? asset.art.finish : '#262626';
}

/**
 * String lights: the sagging wire (a quadratic Bézier is exactly the parabola
 * renderLights uses) with a socket and a glass bulb at every bulb position.
 * LED strips: a slim aluminium channel with a diffuser along the segment.
 */
function drawWire(g: Ctx2D, wire: DrawPlan['wires'][number]): void {
  const l = wire.light;
  const e = lightEndPoint(l);
  const finish = finishOf(wire.asset);
  const size = finite(l.fixtureSize, 40);
  g.save();
  g.lineCap = 'round';
  if (l.beam === 'string') {
    const sag = stringSag(l);
    g.strokeStyle = finish;
    g.lineWidth = clamp(size * 0.018, 1, 4);
    g.beginPath();
    g.moveTo(l.x, l.y);
    g.quadraticCurveTo((l.x + e.x) / 2, (l.y + e.y) / 2 + 2 * sag, e.x, e.y);
    g.stroke();
    const br = stringBulbRadius(l);
    const shade = wire.asset?.art?.kind === 'fixture' && wire.asset.art.shade ? wire.asset.art.shade : '#fff1d6';
    for (const p of stringBulbs(l)) {
      g.fillStyle = finish;
      g.fillRect(p.x - br * 0.35, p.y - br * 0.15, br * 0.7, br * 0.6);
      const grad = g.createRadialGradient(p.x - br * 0.25, p.y + br * 0.8, br * 0.1, p.x, p.y + br, br);
      grad.addColorStop(0, '#fffaf0');
      grad.addColorStop(0.55, shade);
      grad.addColorStop(1, 'rgba(214,170,96,0.85)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(p.x, p.y + br, br * 0.85, br, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    const t = clamp(size * 0.06, 2, 10);
    g.strokeStyle = finish === '#262626' ? '#9a9a9a' : finish;
    g.lineWidth = t;
    g.beginPath();
    g.moveTo(l.x, l.y);
    g.lineTo(e.x, e.y);
    g.stroke();
    g.strokeStyle = '#fff6e4';
    g.lineWidth = t * 0.5;
    g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------

/** Key of everything the treatment layer depends on; null when it can't be tracked (no mask versions). */
function treatmentKey(ctx: RenderContext, solo: string | undefined): string | null {
  const versions = ctx.maskVersions;
  if (!versions) return null;
  const { photo, design, image } = ctx;
  const hidden = new Set(design.hiddenRegionIds ?? []);
  const c = photo.calibration;
  return JSON.stringify([
    photo.id,
    image.width,
    image.height,
    solo ?? '',
    c ? [c.a.x, c.a.y, c.b.x, c.b.y, c.lengthFt] : 0,
    photo.regions.map((r) => [
      r.id,
      r.maskId,
      r.surface,
      r.plane ?? 0,
      versions[r.maskId] ?? 0,
      hidden.has(r.id) ? 1 : 0,
      design.treatments[r.id] ?? 0,
    ]),
  ]);
}

function drawablesKey(plan: DrawPlan, images: Map<string, CanvasImageSource>): string {
  return JSON.stringify([
    plan.objects.map(({ obj, asset, tint }) => {
      const img = images.get(imageKey(asset, tint));
      return [obj.id, obj.x, obj.y, obj.height, obj.rotation, obj.flipX, obj.opacity, obj.shadow, tint ?? '', identityOf(asset), img ? identityOf(img) : 0];
    }),
    plan.fixtures.map(({ light, asset }) => {
      const img = images.get(imageKey(asset));
      return [light.id, light.x, light.y, light.fixtureSize, identityOf(asset), img ? identityOf(img) : 0];
    }),
    plan.wires.map(({ light, asset }) => [light.id, light.beam, light.x, light.y, light.x2, light.y2, light.fixtureSize, asset ? identityOf(asset) : 0]),
  ]);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

let uncachedKeys = 0;

/**
 * Stateful renderer used by the editor. Caches the treatment layer (keyed by
 * treatments, region list, hidden regions and mask versions) so dragging an
 * object or a lighting slider only redoes the cheap stages.
 *
 * Further stages are cached too: the scene with objects drawn (keyed by the
 * objects, fixtures and their decoded images) and the graded scene (plus the
 * lighting settings), so dragging a light only re-adds the light glows.
 */
export class DesignRenderer {
  private treat: { key: string; src: ImageDataLike; layer: ImageDataLike } | null = null;
  private scene: { key: string; data: Uint8ClampedArray } | null = null;
  private graded: { key: string; data: Uint8ClampedArray } | null = null;
  private outBuf: Uint8ClampedArray | null = null;
  private work: { canvas: AnyCanvas; g: Ctx2D } | null = null;

  constructor() {}

  /** Renders at full working resolution into `canvas` (resized to photo size). */
  async render(ctx: RenderContext, canvas: HTMLCanvasElement | OffscreenCanvas, opts: RenderOptions = {}): Promise<void> {
    const W = ctx.image.width;
    const H = ctx.image.height;
    if (!(W > 0 && H > 0) || ctx.image.data.length < W * H * 4) throw new Error('The photo has no pixels to render');
    const includeObjects = opts.includeObjects !== false;
    const includeLighting = opts.includeLighting !== false;

    // 1. Region treatments.
    const tk = treatmentKey(ctx, opts.soloRegionId);
    let layer: ImageDataLike;
    if (tk !== null && this.treat && this.treat.key === tk && this.treat.src === ctx.image) {
      layer = this.treat.layer;
    } else {
      layer = renderTreatmentsLayer(ctx, { soloRegionId: opts.soloRegionId });
      this.treat = tk !== null ? { key: tk, src: ctx.image, layer } : null;
    }
    const baseKey = tk ?? `uncached:${++uncachedKeys}`;

    // 2. Objects, fixture art, string-light wires.
    let scene = layer.data;
    let sceneKey = `${baseKey}|no-objects`;
    const plan = includeObjects ? planDrawables(ctx) : null;
    if (plan && (plan.objects.length || plan.fixtures.length || plan.wires.length)) {
      const images = await loadImages(plan);
      sceneKey = `${baseKey}|${drawablesKey(plan, images)}`;
      if (this.scene && this.scene.key === sceneKey && this.scene.data.length === W * H * 4) {
        scene = this.scene.data;
      } else {
        scene = this.drawScene(layer, plan, images);
        this.scene = { key: sceneKey, data: scene };
      }
    }

    // 3. Global grade.
    let graded = scene;
    if (includeLighting && !isIdentityGrade(ctx.design.lighting)) {
      const gradeKey = `${sceneKey}|${JSON.stringify(ctx.design.lighting)}`;
      if (this.graded && this.graded.key === gradeKey && this.graded.data.length === W * H * 4) {
        graded = this.graded.data;
      } else {
        // Reuse the previous graded buffer's memory when the size matches.
        const buf = this.graded && this.graded.data.length === W * H * 4 && this.graded.data !== scene ? this.graded.data : new Uint8ClampedArray(W * H * 4);
        buf.set(scene);
        applyGrade({ width: W, height: H, data: buf }, ctx.design.lighting);
        this.graded = { key: gradeKey, data: buf };
        graded = buf;
      }
    }

    // 4. Light glows (cheap enough to redo every frame a light moves).
    let out = graded;
    if (includeLighting && (ctx.design.lights ?? []).some((l) => l.on)) {
      if (!this.outBuf || this.outBuf.length !== W * H * 4) this.outBuf = new Uint8ClampedArray(W * H * 4);
      out = this.outBuf;
      out.set(graded);
      renderLights({ width: W, height: H, data: out }, ctx.design.lights, ctx.design.lighting, { width: W, height: H, data: scene });
    }

    // 5. Blit.
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    context2d(canvas).putImageData(toImageData(out, W, H), 0, 0);
  }

  /** Drop caches (e.g. when switching photos). */
  reset(): void {
    this.treat = null;
    this.scene = null;
    this.graded = null;
    this.outBuf = null;
    this.work = null;
  }

  private drawScene(layer: ImageDataLike, plan: DrawPlan, images: Map<string, CanvasImageSource>): Uint8ClampedArray {
    const W = layer.width;
    const H = layer.height;
    if (!this.work || this.work.canvas.width !== W || this.work.canvas.height !== H) {
      this.work = createSurface(W, H, true);
    }
    const g = this.work.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.putImageData(toImageData(layer.data, W, H), 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    for (const o of plan.objects) {
      const img = images.get(imageKey(o.asset, o.tint));
      if (img) drawObject(g, o, img);
    }
    for (const wire of plan.wires) drawWire(g, wire);
    for (const f of plan.fixtures) {
      const img = images.get(imageKey(f.asset));
      if (img) drawFixture(g, f, img);
    }
    return g.getImageData(0, 0, W, H).data;
  }
}

/** Final render as an image Blob (PNG by default, or JPEG with quality). */
export async function renderDesignToBlob(
  ctx: RenderContext,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality?: number,
): Promise<Blob> {
  const { canvas } = createSurface(ctx.image.width, ctx.image.height);
  await new DesignRenderer().render(ctx, canvas);
  return canvasToBlob(canvas, type, type === 'image/jpeg' ? (quality ?? 0.92) : undefined);
}

function roundRectPath(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Small dark pill with white text in the top-left corner of a panel. */
function drawLabel(g: Ctx2D, text: string, x: number, y: number, fontPx: number): void {
  g.save();
  g.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.textBaseline = 'middle';
  const padX = fontPx * 0.65;
  const h = fontPx * 1.7;
  const w = g.measureText(text).width + padX * 2;
  g.fillStyle = 'rgba(17,17,17,0.62)';
  roundRectPath(g, x, y, w, h, h / 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.fillText(text, x + padX, y + h / 2 + fontPx * 0.04);
  g.restore();
}

/** Before / after comparison image with small "Before" / "After" labels. */
export async function renderBeforeAfterBlob(
  ctx: RenderContext,
  layout: 'side-by-side' | 'stacked',
): Promise<Blob> {
  const W = ctx.image.width;
  const H = ctx.image.height;
  const after = createSurface(W, H).canvas;
  await new DesignRenderer().render(ctx, after);
  const before = createSurface(W, H);
  before.g.putImageData(toImageData(ctx.image.data, W, H), 0, 0);

  const gap = Math.max(4, Math.round(Math.min(W, H) * 0.008));
  const side = layout === 'side-by-side';
  const { canvas: out, g } = createSurface(side ? W * 2 + gap : W, side ? H : H * 2 + gap);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, out.width, out.height);
  const ax = side ? W + gap : 0;
  const ay = side ? 0 : H + gap;
  g.drawImage(before.canvas, 0, 0);
  g.drawImage(after, ax, ay);
  const fontPx = clamp(Math.round(Math.min(W, H) * 0.032), 12, 44);
  const m = Math.round(fontPx * 0.8);
  drawLabel(g, 'Before', m, m, fontPx);
  drawLabel(g, 'After', ax + m, ay + m, fontPx);
  return canvasToBlob(out, 'image/jpeg', 0.92);
}
