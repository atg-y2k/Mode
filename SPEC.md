# Mode — Home Redesign Studio: build spec

> ## 0. PRODUCT DIRECTION (final, from the user interview — supersedes anything
> ## below AND any assignment prompt where they conflict)
>
> Mode is a **prompt-first redesign studio** for the user's own house (single
> user, local-first, desktop-first; must still work on a phone). The user
> uploads a photo of a room or of the outside of the house and gets
> **photoreal variations** of what it could look like.
>
> 1. **Scene understanding.** On upload the AI categorizes the photo (front of
>    house, front yard, backyard, kitchen…) and builds a **scene map**: labeled
>    zones with outlines (facade, roof, front door, windows, porch, walkway,
>    driveway, lawn, planting beds, **yard border**, trees, fence… / walls,
>    floor, ceiling, cabinetry…), **paths** (e.g. "driveway → front door",
>    current surface & width), boundaries, orientation & sun exposure, and an
>    **architectural reading** (style & era, defining features, materials,
>    proportions, design language to respect, how the space is used).
> 2. **Compose a rendition from simple design elements** — NOT drag & drop.
>    The user adds building blocks (Pathway, Border edging, Planting bed, Lawn,
>    Patio, Outdoor lighting, Front door, Exterior paint… / Wall paint,
>    Flooring, Interior lighting, Cabinets…). Each element asks visual
>    questions — e.g. Pathway → material, **stone size** (large flagstone
>    slabs / medium pavers / small cobbles / pea gravel), shape (straight /
>    gentle curve / meandering), width, edging, lighting — shown as **image
>    swatches to compare and contrast**. Choices + free-text prompt + targeted
>    zones form a **design brief**.
> 3. **Generate & compare.** Claude turns the brief into N distinct variation
>    instructions; the image provider renders them on the user's photo (only
>    the targeted zones change unless the user chooses "whole image").
>    **Compare mode** renders one variation per option of one question (e.g.
>    the path in 4 stone sizes, everything else fixed) in a labeled grid.
>    From any variation: **More like this**, **Refine** ("wider, add lavender
>    edging"), **Use as base**, favorite, download, before/after slider.
> 4. **Idea board** (inspiration): uploaded inspiration images, notes,
>    **design themes** from the knowledge base, and **real products** found by
>    AI search (Home Depot, Lowe's, nurseries) or pasted links. Items are
>    described by AI and feed generations and recommendations.
> 5. **Grounded in real architecture, themes and purpose.** A curated design
>    knowledge base (architectural styles with features/palettes/materials/
>    landscape/lighting/avoid-lists, design themes with purpose & principles,
>    per-element purpose & rules of thumb — e.g. a primary entry walk is 4–5 ft
>    wide and leads clearly to the door) drives the AI prompts, option
>    rationales and recommendations.
> 6. **Plant feasibility outdoors.** Every plant suggestion respects the
>    property's hardiness zone & climate profile (from the project ZIP), the
>    zone's sun exposure, water needs, mature size vs space, deer/invasiveness;
>    plant options carry good/caution/poor ratings with reasons; generations
>    list plants with feasibility notes; plants can be rendered as newly
>    planted / established / mature.
> 7. **Recommendations**: AI suggestions from scene + idea board, each one
>    click to add to the brief or generate.
> 8. **Fine-tune (secondary tab)**: the precise hand tools — outline surfaces,
>    exact paint colors, material textures, lighting/time of day, placing
>    plants/fixtures — remain as a secondary mode (also used to refine a
>    zone's outline before generating).
> 9. **Dropped**: the asset/shopping list (no list panel, no quantity math,
>    no CSV/print exports, no /api/asset-list UI). Inside and outside are
>    equally important. Image providers: **OpenAI and Google Gemini**, the
>    user picks in Settings / per run.
>
> **Assignment overrides for engineers who haven't started yet:**
> - **data**: do NOT implement src/assetList/quantities|generate|export (deleted).
>   Implement only src/assetList/area.ts. Persistence must handle the new
>   blobs/masks: idea board images/thumbs (project.ideaBoard), variation
>   images/thumbs (photo.generations[].variations[]), scene zone masks
>   (zone.maskId) in referencedIds, deleteProject and bundles. Projects
>   loaded from older saves must be migrated (missing ideaBoard → [],
>   photo.generations → []).
> - **shell**: see §3.8 (rewritten): Studio / Fine-tune modes; no asset-list exports.
> - **panels-plan**: your assignment is REPLACED by §3.15 Studio panels.
> - **panels-scene**: Lighting + Library are Fine-tune panels; no Shop there
>   (products go to the idea board, §3.15).
> - **catalog / textures / engine-render / panels-design**: unchanged (they
>   power Fine-tune and the option swatches — textureSwatch renders the
>   texture visuals of element options).

Mode is a local-first web app. Everything except the AI features works
offline with no API keys.

---------------------------------------------------------------------------

## 1. Architecture

```
index.html, src/main.tsx      Vite + React 19 + TypeScript (strict) + Tailwind v4
src/App.tsx                   app shell (routes: projects home ↔ project workspace)
src/ui/common/index.tsx       shared UI primitives (Button, IconButton, Slider, Modal, Swatch, …)
src/ui/shell/*                top bar, projects home, spaces sidebar, settings, export menu, mobile nav, toasts
src/ui/editor/*               the canvas editor (render, zoom/pan, tools, overlays, compare)
src/ui/panels/*Panel.tsx      Fine-tune panels: Surfaces, Paint, Materials, Lighting, Library
src/ui/studio/*               Studio: StudioView (viewer, zones, sketch, variations, compare grid), generate.ts (runs)
src/ui/studio/panels/*        Studio panels: Design (brief composer), Scene, Ideas (+ ShopModal), Suggestions, History
src/assets/design/*           design knowledge: architectural styles, themes, element guidance, ELEMENT_DEFS
src/lib/studio.ts             Studio API client + conversions    src/lib/products.ts  real products client
src/state/store.ts            zustand+immer store: project document, selection, tools, undo/redo   (DONE)
src/state/runtime.ts          in-memory masks + decoded photos + Lab cache                          (DONE)
src/state/renderContext.ts    builds engine RenderContext for a photo/design                        (DONE)
src/state/persistence.ts      IndexedDB (idb-keyval) storage + project bundle import/export
src/engine/*                  pixel engine (pure TS on ImageDataLike; compositor/assetImages use canvas)
src/assets/catalog/*          built-in catalog data (paints, materials, plants, fixtures, decor) + search
src/assets/art/*              procedural SVG art for built-in assets
src/assetList/area.ts         real-world areas / default object sizes (Fine-tune)
src/lib/imageImport.ts        decode / downscale / encode images (browser)
src/lib/backgroundRemoval.ts  cut out uploaded asset photos
src/lib/api.ts                typed client for the API server
shared/types.ts               domain model (DONE)        shared/art.ts  art spec types (DONE)
shared/api.ts                 HTTP contract + zod schemas (DONE)   shared/ids.ts newId() (DONE)
server/*                      Hono API server: Claude (vision, structured outputs) + optional image provider;
                              serves dist/ in production
tests/e2e/*                   Playwright smoke tests
```

Run: `npm run dev` (Vite on :5173 proxies `/api` to the API on :8787).
Prod: `npm run build && npm start` (one Node process serves app + API on $PORT, default 8787).
Checks: `npm run typecheck`, `npm test` (vitest), `npm run test:e2e`.

### Data model (see shared/types.ts — read it fully before coding)
Project → Spaces (interior/exterior, typed) → Photos (working-res image in blob
store, Regions = masked surfaces, Calibration, AI analysis) → Designs
(“Option A/B…”: treatments per region, placed objects, placed lights,
lighting settings, AI renders). Project.assetList holds the shopping list.
Regions (geometry) are per photo; treatments are per design, so every design
option reuses the same outlined surfaces.

Pixel data never lives in the store: photos/thumbnails/renders/uploaded asset
images are Blobs in IndexedDB (`blobs` store) referenced by id; masks are
`Uint8Array` coverage maps kept in `src/state/runtime.ts` and persisted
RLE-encoded. Photos are downscaled on import to ≤ 1600 px long edge (working
resolution); every coordinate in the model is in working-resolution pixels.

### Rendering pipeline (src/engine/compositor.ts)
original → region treatments in region order (paint = luminance-preserving
recolor in Lab; material = procedural texture, screen or perspective-plane
mapped, modulated by the photo's shading) → placed objects & fixture art
(z order, contact shadows) → global lighting grade (exposure, white balance,
time-of-day look) → additive light glows. The treatment layer is cached
(keyed by treatments + regions + hidden ids + mask versions) so dragging
objects/sliders stays interactive.

### Store usage (src/state/store.ts — read it fully)
`useStore(selector)` everywhere. Selectors: `selectActiveSpace`,
`selectActivePhoto`, `selectActiveDesign`, `selectSelectedRegion`,
`selectSelectedObject`, `selectSelectedLight`; `resolveAsset(id)`.
All document edits go through store actions (they record undo history and
autosave). High-frequency edits (drags, sliders) pass `{ coalesce: key }`.
Mask edits: `snapshotMask(id)` before, mutate the runtime mask in place,
`runtime.markMaskDirty(id)` (throttle to ~1 per animation frame while
dragging), then `useStore.getState().recordMaskEdit(id, before, after)` on
pointer up. `replaceMaskPixels(id, bytes, label)` does all of it for
whole-mask operations (invert, grow, wand result, clear…).
Tools: `tool` (ToolId), `toolOptions`, `placement` (asset/light armed for the
'place' tool), `pickedColor` (eyedropper output), `view` (compare mode, mask
display, mobile pane). Toasts: `notify(message, kind)`.

### Conventions
- TypeScript strict, no `any` unless unavoidable. ESM. Functional React components + hooks.
- Styling: Tailwind utilities with the semantic tokens from src/index.css
  (`bg-surface`, `bg-surface-2`, `text-muted`, `border-line`, `bg-accent`,
  `text-accent`, `bg-stage`, `font-display` …). Never hard-code theme colors
  (data colors like paint swatches are fine). Must look right in light AND
  dark mode. Icons: `lucide-react`.
- Reuse primitives from `src/ui/common` (Button, IconButton, Field, TextInput,
  NumberInput, TextArea, Select, Slider, Toggle, Segmented, Section,
  PanelHeader, EmptyState, Badge, Spinner, Swatch, Modal, ConfirmModal, cn,
  formatUsd). Panel layout: `PanelHeader` then `Section`s, panel body scrolls.
- Mobile first: touch targets ≥ 36 px, pointer events (not mouse events),
  works at 360 px width. Desktop layout ≥ 1024 px.
- Accessibility: labels on icon buttons, focus-visible styles, keyboard paths.
- No new npm dependencies. Available: react, react-dom, zustand, immer,
  idb-keyval, lucide-react, zod, hono, @hono/node-server, @anthropic-ai/sdk;
  dev: vitest, jsdom, @testing-library/react, fake-indexeddb, @playwright/test.
- Pure logic gets vitest unit tests next to the module (`*.test.ts`). Engine
  tests run in node with synthetic ImageDataLike images.
- Performance: photo ≤ 1600×1600 = 2.6 MP; per-pixel loops must use typed
  arrays, avoid allocations per pixel, and skip pixels where mask = 0 using
  the mask bounds.

---------------------------------------------------------------------------

## 2. Contracts

Files containing `export declare function/const/class` are CONTRACTS: replace
each `declare` with a real implementation keeping the exact exported names and
signatures (you may add optional parameters and extra exports). Do not change
shared files you do not own (shared/*, src/state/store.ts, src/state/runtime.ts,
src/state/renderContext.ts, src/ui/common/index.tsx, src/index.css). If you
truly need a contract change, work around it locally and list it under
"CONTRACT CHANGE REQUESTS" in your final report.

---------------------------------------------------------------------------

## 3. Module specs & ownership

### 3.1 engine-core — `src/engine/color.ts`, `recolor.ts`, `mask.ts`, `selection.ts`, `geometry.ts` (+ tests)
- color: accurate sRGB↔Lab (D65), CIEDE2000, kelvin→RGB (Tanner Helland style,
  smooth), colorFamilyOf (white/neutral/gray/black by lightness+chroma; hues by
  angle; beige/brown for low-chroma warm hues), averageColor.
- recolor.applyPaint: per pixel in mask: L' = targetL + (L − meanL)·k with k
  ≈ 0.9 (compress shading for very dark/light targets so they don't clip:
  scale k by available headroom), a',b' = target a,b plus a small fraction
  (~8%) of the original chroma deviation; finish keeps specular highlights:
  pixels whose L exceeds p90L blend back toward original lightness by
  {flat 0, matte .1, eggshell .25, satin .4, semi-gloss .6, gloss .75}.
  Blend into dst by (mask/255)·strength. Tests: uniform region → target color
  within ΔE2000 < 2; shading order preserved; mask 0 untouched; strength 0 = no-op.
- mask: brushes with smooth falloff by hardness, max-combine for add / min for
  erase (stamps never exceed opacity), scanline polygon fill with 4× vertical
  supersampling for AA, separable blur feather, distance-based or iterated
  grow/shrink, RLE (runs of identical bytes; must round-trip), overlay/outline.
- selection: Lab cache; magic wand flood fill (4-connected scanline, ΔE76 to
  seed average) with the seed's own region always included; global mode
  selects all similar pixels; smart brush = brush limited to similar pixels
  with a soft tolerance edge (coverage ramps down over the last 25% of
  tolerance) — gives clean wall/trim separation.
- geometry: homography via 8×8 linear solve (Gaussian elimination with pivoting).

### 3.2 engine-textures — `src/engine/textures.ts`, `src/engine/materialFill.ts` (+ tests)
- generateTexture for EVERY TexturePattern in shared/types.ts, seamless,
  deterministic (seeded PRNG, e.g. mulberry32), realistic at typical scales:
  wood planks (staggered board ends, per-board tone, grain streaks, subtle
  bevel), herringbone/chevron, tile grid/subway/hex with grout, brick running
  bond with mortar & per-brick tone, stone pavers (mixed sizes), flagstone
  (irregular polygons / jittered Voronoi with joints), cobblestone, gravel,
  mulch (fibrous chips), grass (blades, not flat green), concrete, stucco,
  lap siding (horizontal boards with shadow line under each lap),
  board & batten, shingle siding, roof shingles (staggered tabs with shadow),
  standing seam metal, deck boards (gaps), carpet, marble (veins), terrazzo,
  stone veneer, shiplap. Tile ≤ MAX_TILE_SIZE (reduce pxPerInch to fit).
- applyMaterial: per pixel compute texture coords (screen: rotate & scale;
  plane: inverse homography of the quad → (u,v) inches, rotated), bilinear
  wrap sampling, tint multiply, shading = (L/meanL) blended by `shading`,
  blend by mask·strength. For plane mapping, attenuate texture detail far
  away (mip-like: when the pixel footprint covers > 1 texel, sample a
  pre-blurred/downsampled tile) to avoid moiré.
- mappingForRegion per its doc comment. Tests: seamlessness (left vs right
  edge columns similar to an interior column pair), determinism, mask 0 untouched,
  plane mapping orientation.

### 3.3 engine-render — `src/engine/lighting.ts`, `src/engine/compositor.ts`, `src/engine/assetImages.ts` (+ tests for lighting)
- lighting: grade in linear light: exposure 2^EV, white balance = multiply by
  kelvinToRgb(kelvin)/kelvinToRgb(5500) normalized to preserve luminance,
  time-of-day looks (golden: warm, +contrast, slight orange; dusk: −1.3 EV,
  cool blue, desaturated; night: −2.6 EV, deep blue, strongly desaturated;
  all scaled by ambient), contrast around mid-gray, saturation in Lab-ish
  space. Identity for DEFAULT_LIGHTING. renderLights: color from kelvin,
  smooth falloff (e.g. (1−d²)² or gaussian), intensity × lightGain; down =
  ellipse/cone below the source, up = cone above, spot = cone along angle
  with spread, strip = capsule glow along the segment, string = bulbs along
  a sagging catenary with small bright cores + soft halo. Add in linear light
  with soft-clip (filmic shoulder) so overlapping lights don't posterize.
- compositor: as in the contract doc. Objects: draw via
  `getAssetImage(asset, obj.tint)`, size = obj.height px tall × aspect,
  anchor at bottom-center (asset anchor), rotation about the anchor, flipX,
  opacity, contact shadow (blurred dark ellipse at the base, scaled with
  width) when obj.shadow. Fixture art for lights with showFixture (height =
  fixtureSize, emitter position from asset.light.emitterY aligned to the
  light point). Unknown assets are skipped. Use OffscreenCanvas when
  available, else document.createElement('canvas'). renderBeforeAfterBlob
  draws original and design with labels.
- assetImages: art → renderArt(spec or tintArt(spec, tint)); svg → recolor by
  tint is optional (return as is); imageId → blob from persistence → createImageBitmap.
  Decode SVG via `new Image()` + data URL with explicit width/height; cache.

### 3.4 catalog — `src/assets/catalog/*` (paints.ts, materials.ts, plants.ts, fixtures.ts, decor.ts, index.ts) (+ tests)
- ~160 paint colors with ORIGINAL names (do not use paint brands' trademarked
  names/codes), grouped into collections (Warm whites, Cool whites, Greige &
  neutrals, Grays, Charcoals & blacks, Earth tones, Greens, Blues, Accent
  reds & oranges, Yellows & golds, Purples & pinks, Exterior classics, Front
  door favorites, Trim & ceiling). Realistic, designer-grade hexes.
- ~45 materials across all MaterialCategories with sensible surfaces, real
  unit sizes (e.g. 7.5″×72″ planks, 3″×6″ subway, 4″×8″ pavers, 7″ lap
  reveal), joints, palettes, and US cost ranges (per sqft; mulch/gravel per cuyd).
- ~70 plants with accurate botanical names, plant type, sun, water, USDA zones,
  mature size, evergreen, bloom, container size, deer resistance, native region,
  cost per container, and PlantArt (form, colors, seed) that matches the plant
  (e.g. Japanese maple = ornamental-tree with red foliage; lavender =
  flowering-perennial purple; boxwood = round-shrub). Mix: shade/ornamental
  trees, evergreens, flowering shrubs, foundation shrubs, perennials,
  grasses, groundcovers, succulents/cacti (xeriscape), vines, ferns, and ~12
  houseplants (indoor: true, pots).
- ~30 fixtures (interior and exterior) with LightInfo (beam, kelvin, lumens,
  reachFt, emitterY, mount height) and FixtureArt; ~30 decor/furniture/
  hardscape objects (planters, outdoor furniture, fire pit, pergola, boulders,
  raised beds, fence panel, rug, sofa, mirror, wall art…) with DecorArt.
- Every asset has realHeightFt, aspect consistent with its art
  (aspect = renderArt(art).width / height — compute it, don't guess), tags,
  description, cost. Ids are kebab-case, stable, unique across the catalog.
- index.ts implements the contract (re-export the data arrays). Keep it free
  of DOM APIs (the server imports it). catalogSummaryForAI: compact lines like
  `plant boxwood-green-velvet | Boxwood 'Green Velvet' | shrub | sun: full,part | water: med | z5-8 | 3x3ft`.
- Tests: unique ids, valid hexes, zones sane, every material pattern valid,
  aspect matches art, search & filters work.

### 3.5 art — `src/assets/art/*` (index.ts + plants.ts, fixtures.ts, decor.ts, util.ts) (+ tests)
- renderArt for every PlantForm, FixtureForm and DecorForm in shared/art.ts.
  Attractive, stylized-natural vector illustrations meant to sit on top of
  real photos: layered foliage clusters with 2–3 tones and a soft radial
  gradient for volume, a subtle darker base/shadow side, trunks/stems with
  taper, flowers as small clustered dots/petals, pots with rim highlight;
  fixtures with metal finish gradients and glass/shade; decor with simple
  shading. No text. Transparent background. Deterministic per seed.
  Reasonable size (e.g. 200–600 px tall viewBox), anchorY near the base.
  Use unique gradient ids per output (prefix with a hash of the spec) so
  several SVGs can coexist in one document.
- tintArt swaps the primary color. Tests: every form renders valid-looking SVG
  (starts with <svg, has viewBox, width/height positive, no NaN), deterministic.

### 3.6 data — `src/state/persistence.ts`, `src/lib/imageImport.ts`, `src/lib/backgroundRemoval.ts`, `src/assetList/*` (+ tests)
- persistence: idb-keyval `createStore('mode-db', '<name>')` — NOTE idb-keyval
  supports one object store per database, so use separate database names per
  store (e.g. 'mode-projects', 'mode-blobs', 'mode-masks', 'mode-library').
  Bundle export/import per contract (validate on import, remap ids).
  Tests with `fake-indexeddb/auto`.
- imageImport: createImageBitmap(file, { imageOrientation: 'from-image' })
  with fallback to <img>; high-quality downscale (step down by halves then
  final drawImage with imageSmoothingQuality 'high'); OffscreenCanvas when
  available. Friendly errors (e.g. HEIC on non-Safari: “This browser can't
  read HEIC photos — export as JPEG or use Safari”).
- backgroundRemoval per contract (tests on synthetic images).
- assetList: ONLY area.ts (the shopping list was dropped — see §0).
- persistence must cover Studio data (§0 overrides) and migrate old saves.

### 3.7 server — `server/*`, `src/lib/api.ts` (+ tests)
- Hono app (server/app.ts exporting `createApp(deps)` for tests; server/index.ts
  starts @hono/node-server on PORT ?? API_PORT ?? 8787 and, when
  NODE_ENV=production, serves ./dist with SPA fallback).
- config (env): ANTHROPIC_API_KEY (AI enabled when set or MODE_AI=on),
  CLAUDE_MODEL (default 'claude-opus-5-5'), IMAGE_PROVIDER ('openai' | unset),
  OPENAI_API_KEY, OPENAI_IMAGE_MODEL (default 'gpt-image-1'), OPENAI_BASE_URL,
  MODE_ACCESS_TOKEN (if set, every /api request except /api/health must send
  header `x-mode-token`), RATE_LIMIT_PER_10MIN (default 60 AI calls per IP).
  Write `.env.example` documenting all of them.
- Claude calls: `@anthropic-ai/sdk`, `client.beta.messages.parse({ model,
  max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks:
  'default', output_config: { format: betaZodOutputFormat(schema), effort },
  system: [{ type:'text', text, cache_control:{ type:'ephemeral' } }], messages })`
  (import betaZodOutputFormat from '@anthropic-ai/sdk/helpers/beta/zod').
  Opus 5.5: never send `thinking: {type:'disabled'}`, `budget_tokens`,
  temperature, prefill, or forced tool_choice. Effort: analyze 'medium',
  suggest 'high', asset-list 'medium', generate-asset 'high', render-prompt 'low'.
  Check `stop_reason === 'refusal'` → error code 'refused'; `max_tokens` or
  null parsed_output → 'upstream_error'. Map SDK errors (Anthropic.RateLimitError
  → 'rate_limited', other APIError → 'upstream_error'). Images: data URL →
  { type:'image', source:{ type:'base64', media_type, data } } placed before text.
- Prompts (server/prompts.ts): expert interior designer + landscape designer
  persona; system prompt includes catalogSummaryForAI() (from
  src/assets/catalog — stable text so the prefix caches) and output rules:
  only catalog ids in id fields (else null), realistic US prices, plants
  appropriate to the hardiness zone and the photo's light, positions
  normalized 0..1 on the photo where the item's base touches the ground/wall,
  region treatments only for the regionIds provided.
- generate-asset 'vector': Claude returns metadata + `svg` field (structured
  output); server sanitizes SVG (strip <script>, foreignObject, event
  handler attributes, external href/xlink:href (allow '#…' and data:image),
  <style> @import / url(http…)), enforces viewBox and width/height, size
  limit 200 KB, computes aspect. 'photo': requires image provider; generate a
  transparent-background PNG (OpenAI images `background: 'transparent'`).
- render: Claude (effort low) turns designSummary + instructions + strength
  into a concise photoreal edit prompt (preserve architecture, camera,
  perspective; apply listed changes) — falls back to a template when AI is
  off; then the image provider edits the image (OpenAI `POST
  {base}/images/edits` multipart: model, image, optional mask, prompt,
  size 'auto', quality 'high', input_fidelity 'high' for gpt-image-1;
  response data[0].b64_json). Provider behind an interface
  (server/imageProvider.ts) so others can be added.
- Body limit MAX_BODY_BYTES, zod-validate requests, errors as ApiErrorBody
  with proper status codes, never leak keys/stack traces, log one line per request.
- src/lib/api.ts per contract: fetch JSON, attach `x-mode-token` from
  localStorage 'mode.apiToken' if present, timeouts (analyze/suggest/list 180 s,
  render 300 s), validate with shared schemas, ApiError with codes.
- Tests: route validation, error mapping, SVG sanitizer, health, auth token,
  rate limit — with a fake Claude client injected through createApp deps.

### 3.8 shell — `src/App.tsx`, `src/ui/shell/*`, `public/sw.js` (optional)
- App: on mount `useStore.getState().init()`; route = project ? workspace : projects home.
  Mount `<ShopModal />` (src/ui/studio/panels/ShopModal.tsx) once at app level.
- Projects home: warm editorial landing (font-display headline, e.g. "See your
  home redesigned before you lift a shovel"), a short "how it works": upload a
  photo → Mode maps the scene → compose your idea from design elements →
  compare photoreal variations. New project modal (name, ZIP code — used for
  hardiness zone & plant feasibility —, optional style), recent projects grid
  (cover thumbnail, name, counts, updated, menu: rename/delete with confirm),
  Import project (.json), AI status hint.
- Workspace (desktop-first): TopBar (h-14) + [SpacesSidebar w-64 |
  center | right panel w-[24rem]]. A **mode switch** (Segmented: "Studio" |
  "Fine-tune", store.mode) sits at the top of the center area or in the top
  bar. Studio mode: center = `<StudioView/>` (src/ui/studio/StudioView.tsx),
  right panel tabs = Design, Scene, Ideas, Suggestions, History
  (src/ui/studio/panels/*Panel.tsx; store.studio.panel). Fine-tune mode:
  center = `<EditorView/>`, right panel tabs = Surfaces, Paint, Materials,
  Lighting, Library (store.panel). Tab rail with icons + labels.
  Mobile (< lg): one pane at a time (view.mobilePane) + bottom nav.
- TopBar: back to projects, editable project name, save status, undo/redo
  (+ Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y — ignored while typing), Export menu
  (current image: the variation shown in Studio or the Fine-tune render;
  before/after image; project backup via exportProject), Settings.
- SpacesSidebar: Interior / Exterior groups; space rows expandable to photo
  thumbnails (object URLs revoked on unmount) with a small badge when the photo
  has a scene map and the number of favorites; add photos (file input +
  drag & drop); space menu (rename, change type, notes, delete with confirm);
  "Add space" modal with SpaceType tiles. After a photo upload, if AI is
  enabled, kick off scene analysis automatically (call analyzeScene from
  src/lib/studio.ts with the photo blob and store.setScene; show a subtle
  "Mapping the scene…" state; failures → toast, never block).
- Settings modal: project info (name, ZIP, hardiness zone, "Look up climate"
  → fetchClimate → location.climate shown as a card: zone, frost dates,
  rainfall, notes), style, notes; image generation: default provider
  (OpenAI / Gemini from health.imageProviders) and quality
  (store.studio.provider / quality, persisted in localStorage
  'mode.provider' / 'mode.quality'); appearance (System/Light/Dark,
  localStorage 'mode.theme'); AI status & how to enable (ANTHROPIC_API_KEY,
  OPENAI_API_KEY, GEMINI_API_KEY in .env, restart); server access token
  (localStorage 'mode.apiToken'); storage usage; export/import/delete project.
- Toaster bottom-center. Optional production-only service worker (never cache /api).

### 3.9 editor — `src/ui/editor/*` (EditorView.tsx and helpers)
- EditorView renders, for the active photo + design: header row with design
  option tabs (switch, rename on double-click, duplicate "+", delete with
  confirm via menu), tool palette (vertical on desktop, horizontal scroll on
  mobile) with tooltips & shortcuts, zoom controls (−, %, +, fit), compare
  control (off / slider / split) and a press-and-hold "original" button.
- Empty states: no space selected → prompt to add one; space without photos →
  big drop zone + file input (accept image/*, multiple; `capture` hint on mobile)
  calling store.addPhotos; loading spinner while runtime.preloadPhoto runs.
- Stage: dark `bg-stage`, display canvas fitted (contain) with zoom/pan
  (wheel zoom at cursor, pinch zoom, two-finger / middle-button / space+drag /
  pan tool drag), DPR-aware. Render with DesignRenderer from compositor into
  an offscreen buffer and blit; re-render on design/regions/maskVersions/
  library changes, coalesced with requestAnimationFrame.
- Overlay canvas: mask tint of the selected region (or all, per view.masks)
  using maskToOverlay + maskOutline (cache per mask version), brush cursor,
  polygon (points, rubber band, close by clicking first point / double-click /
  Enter; Escape cancels; Backspace removes last point), lasso path, wand
  (tap = new selection replacing/adding/subtracting per toolOptions.maskMode),
  smart brush, eyedropper (sets pickedColor; shows loupe), calibrate (drag a
  line → modal asks real length with unit ft/in/m/cm → setCalibration),
  plane (4 draggable corners initialised to the region bounds; perspective
  grid preview; writes region.plane), place (click to place store.placement:
  objects get height from defaultObjectHeightPx, lights get radius from
  reachFt × px/ft or 22% of photo width, fixtureSize from mountHeight or 8%
  of height; after placing keep placement armed while Shift is held,
  otherwise switch to select), select (hit-test objects by their rendered
  rect top-most first, then light handles; drag to move; corner handle
  scales (keep anchor at base); rotate handle; for lights: center handle
  move, radius ring drag, strip/string endpoints drag; Delete key deletes;
  arrow keys nudge).
- Mask-editing tools require a selected region; if none, show a hint toast
  and switch the right panel to Surfaces.
- Compare: slider (draggable divider over original vs design), split
  (side by side). Design canvas and original share zoom/pan.
- Keyboard shortcuts: V select, H pan (Space hold = temporary pan), B brush,
  E eraser, S smart brush, W wand, P polygon, L lasso, I eyedropper,
  C calibrate, [ / ] brush size, Alt held = subtract while masking,
  Esc cancel, Delete remove selection, Ctrl/Cmd+0 fit.
- Must be smooth on a phone: pointer events with setPointerCapture,
  touch-action: none on the stage, throttle mask overlay updates.

### 3.10 panels-design — `src/ui/panels/SurfacesPanel.tsx`, `PaintPanel.tsx`, `MaterialsPanel.tsx` (+ helper files under src/ui/panels/design/)
- Surfaces: list of regions of the active photo (color dot, name (inline
  rename), surface type select, treatment chip (paint swatch / material
  swatch / "untouched"), estimated area (regionAreaSqFt; "calibrate" link
  when unknown), hide toggle (design.hiddenRegionIds), move up/down, delete
  with confirm). "Add surface" grid of SurfaceKinds — relevant ones first for
  the space kind (interior vs exterior) — creates region, selects it and sets
  the smart-brush tool. Selected-region tool card: mask tools (Smart brush,
  Brush, Wand, Polygon, Lasso, Eraser) as a segmented/icon group; Add/Subtract;
  brush size/hardness; wand tolerance + contiguous; smart tolerance; mask ops:
  Invert, Grow 2px, Shrink 2px, Feather, Clear, Select all (replaceMaskPixels);
  perspective plane (Set/Edit → tool 'plane'; real width/height inputs;
  remove); area override; photo calibration status + button (tool 'calibrate').
  Short guidance text for first-time users.
- Paint: needs a selected region (else list regions to pick one / add one).
  Current paint card (large swatch, name, hex, brand/code, LRV). Finish
  segmented, coats, strength. Sources: catalog collections as horizontal
  chips + family filter + search → swatch grid (tooltip name); "Custom":
  hex input + native color input + name + brand + code; eyedropper button
  (tool 'eyedropper'; when pickedColor changes while eyedropper active,
  offer "Use #hex" and nearest catalog colors); "Used in this project"
  (unique colors from all designs); similar colors (nearestPaints). Apply
  updates via setTreatment({ type:'paint', … }) with coalesce while dragging.
  "Apply to all {surface}s in this photo" button. Remove paint.
- Materials: needs a selected region. Materials for the region's surface
  (materialsForSurface) with "Show all" toggle, grouped by category; swatches
  rendered with textureSwatch → canvas → dataURL (memoized). Selected
  material controls: scale, rotation, tint (optional), strength; perspective
  hint for horizontal surfaces (button → plane tool). Remove material.

### 3.11 panels-scene — `src/ui/panels/LightingPanel.tsx`, `LibraryPanel.tsx` (+ helpers under src/ui/panels/scene/) — Fine-tune mode
- Lighting: Scene section: time of day segmented with icons (Sun, Sunset,
  CloudMoon, Moon), exposure, warmth (kelvin slider with a warm→cool gradient
  track), ambient strength, contrast, saturation, reset. Fixtures section:
  catalog FIXTURES filtered by space kind (indoor/outdoor) as cards with art
  thumbnails → arm placement ({ kind:'light', assetId, … }); also "Generic
  glow" placements (omni / spot / strip / string). Placed lights list (name,
  on/off toggle, kelvin chip, select, delete) + "All on / all off". Selected
  light inspector: beam, radius, intensity, kelvin with presets (2200, 2700,
  3000, 4000, 5000), angle/spread for spot, show fixture + fixture size,
  duplicate, delete.
- Library ("Plants & objects"): category chips (Plants, Fixtures, Decor &
  furniture, Hardscape, My assets), search, plant filters (type, sun, water,
  "fits my zone" using project.location.hardinessZone, indoor/outdoor default
  from space kind). Card grid (thumbnail via assetSvgDataUrl or
  getAssetImageUrl, name, cost range); tap → arm placement (and on mobile
  switch to the editor pane); info popover with plant/light details.
  "Add your own" modal: pick image → removeBackground preview over checker
  with tolerance slider + "keep original" → name, category, real height,
  cost, vendor URL → store.addLibraryAsset(asset, pngBlob).
  "Generate with AI" modal: description, category, mode (Vector / Photo when
  image provider enabled) → api.generateAsset → preview → save to library
  (vector: svg field; photo: dataUrlToBlob → imageId). Disabled with an
  explanation when AI is off. Edit/delete for "My assets".
  Selected object inspector (shown at top when an object is selected): asset
  name, size (height), rotation, flip, opacity, shadow, tint (vector assets),
  layer order buttons, duplicate, delete.

### 3.12 (removed — asset list & old AI panel were dropped; see §3.15)

### 3.13 studio-server — `server/studio/*`, `src/lib/studio.ts`, `src/lib/products.ts` (+ tests)
- Endpoints (shared/api.ts §Studio and §Real store products): scene, climate,
  element-options, recommend, describe-idea, plan, render-variation,
  products/search, products/from-url, products/image. Export
  `registerStudioRoutes(app, deps)`; the lead wires it into server/app.ts.
- Claude calls as in §3.7 (beta.messages.parse, structured outputs,
  fallbacks 'default', cached system prompt). System prompts embed
  designKnowledgeForAI() (src/assets/design) and catalogSummaryForAI()
  lazily (memoized). Scene: precise zone polygons (tight, clockwise),
  paths' centerlines, sun per ground zone from shadows/orientation,
  architecture reading using the style list. Plan: one self-contained,
  photoreal image-edit instruction per variation that preserves camera,
  perspective, lighting and everything outside the targets; respects the
  architecture and element purpose; plants feasible for zone/sun/space and
  sized per plantMaturity; compare runs vary ONLY the compared option.
- Image providers (server/studio/providers.ts): OpenAI Images edits (mask,
  references as extra images) and Google Gemini image generation
  (generateContent with inline image parts + text; GEMINI_API_KEY,
  GEMINI_IMAGE_MODEL default 'gemini-2.5-flash-image'); provider chosen per
  request or IMAGE_PROVIDER default; health lists configured providers.
  Return the provider's image as is (the client resizes and composites).
- Products: search = Claude with the web search server tool restricted via
  allowed_domains to homedepot.com, lowes.com and reputable nurseries
  (e.g. naturehills.com, fast-growing-trees.com, monrovia.com,
  provenwinners.com, springhillnursery.com, waysidegardens.com,
  highcountrygardens.com, plantnative.org-style native nurseries); returns
  real product pages only (never invent URLs). from-url = SSRF-safe fetch
  (http/https only, resolve DNS and refuse private/loopback/link-local
  addresses, 10 s timeout, 3 MB cap), parse JSON-LD Product / OpenGraph,
  fall back to Claude reading the trimmed page text, 'partial' when blocked.
  products/image = SSRF-safe image proxy (image/* only, ≤ 8 MB).
- Tests with fake Claude / fake providers / fake fetch.

### 3.14 studio-view — `src/ui/studio/StudioView.tsx`, `src/ui/studio/generate.ts`, other files in `src/ui/studio/` except `panels/`
- Viewer: shows the original photo or the variation `studio.viewVariationId`
  (fit/zoom/pan like the editor, DPR-aware), zone overlay (outlines + labels
  on hover; targeted zones highlighted; focusZoneId emphasized; click a zone
  to toggle it in the brief's targetZoneIds), paths drawn as dashed
  centerlines with labels, sketch tools (draw a path centerline with a width
  handle → scene path kind 'sketch'; draw an area → zone kind 'other'
  labeled "Sketched area"), before/after slider vs the original, and the
  run progress overlay.
- Bottom dock: the prompt bar (multi-line prompt bound to the photo's
  draft.prompt, chips for targeted zones/elements/ideas, scope toggle "Only
  selected areas / Whole image", variation count, provider, Generate) and
  the variations strip (newest run first; each run labeled with its plan;
  thumbnails with favorite star, compare-run option labels, status
  placeholders while rendering, failed tiles with retry). Click a
  variation → view it; actions: More like this, Refine (feedback input),
  Use as base (viewVariationId), Compare with original, Download, Delete.
- Compare grid: when studio.gridGenerationId is set, show that run's
  variations side by side with option labels, rationale, and "Choose" (sets
  the element choice to that option and views the variation).
- generate.ts per its contract: builds the PlanRequest (scene summary,
  zones with sun, paths, brief elements → where/choices prompt texts, ideas
  text, up to 3 idea images downscaled, location + climate summary,
  compare/refine), creates the Generation (status 'running'), renders with a
  concurrency of 3, converts results: resize to photo size, protect pixels
  outside buildTargetMask (feathered alpha composite) when scope 'zones',
  encode JPEG (q 0.9) + thumb, putBlob, addVariation; updates progress;
  marks done/partial/failed; respects cancel. Mask sent to the server uses
  the OpenAI convention (opaque keep, transparent edit).
- Polished, calm, gallery-like UI; keyboard: ←/→ to step variations, F
  favorite, Esc back to original.

### 3.15 studio-panels — `src/ui/studio/panels/*` (DesignPanel, ScenePanel, IdeasPanel, SuggestionsPanel, HistoryPanel, ShopModal + helpers in that folder)
- Design (brief composer — the heart): element palette (tiles from
  elementsForSetting(space kind), icon + label) → adds newElementSpec to the
  draft. Each element card: label (editable), "where" chips (zones/paths from
  the scene, toggleable; "pick on photo" hint), each dimension as a question
  with option cards showing the visual (texture → textureSwatch canvas,
  color/colors → swatches, art → assetSvg via renderArt, diagram → small
  inline SVG diagrams you draw for path shapes/widths/beams, image → blob),
  label, description, rationale, plant feasibility badge
  (good/caution/poor + reasons on hover); "Tailor to my photo" (AI
  fetchElementOptions → mergeDimensions); "Compare these on my photo" per
  dimension (startRun mode 'compare' with the selected 2–6 options); note
  field; remove. Below: plant maturity segmented (newly planted /
  established / mature), idea items included (toggle chips), free-text
  prompt, Generate N variations. Element guidance (purpose, rules of thumb)
  shown as a subtle tip.
- Scene: Analyze / Re-analyze (analyzeScene); category (editable select),
  summary, viewpoint, orientation & lighting, architecture card (style, era,
  features, materials, proportions, design language, purpose), boundaries,
  zones list (kind icon, label editable, sun badge, description, target
  toggle, focus on hover, delete, "Refine outline" → creates a Fine-tune
  Surface region whose mask is seeded from the zone polygon (fillPolygon),
  sets zone.maskId = region.maskId (shared mask, so brush/wand edits in
  Fine-tune refine the zone) and switches to Fine-tune with that region
  selected), paths list, keep-list, opportunities (each → "Add to brief").
- Ideas: idea board (project-wide; filter "this space"/all): add image
  (file/paste/drag; downscale ≤ 1024 + thumb; extract 5 colors; if AI on,
  describeIdea → title/aiDescription), add note, add theme (themesFor(setting,
  scene styleId) picker with purpose & principles), find products (opens
  ShopModal), paste product link (productFromUrl → image via
  fetchProductImage → idea kind 'product'). Cards: image, title, note
  (editable), colors, AI description, store/price/link for products,
  active toggle, delete.
- ShopModal (store.shop): query, category, stores (Home Depot / Lowe's /
  Nurseries), max price, uses project zone; results grid (image, name, price,
  store badge, specs, plant zones) → "Add to idea board", "Open at store ↗".
- Suggestions: fetchRecommendations (focus input optional) → cards (title,
  category, why, targets) → "Add to brief" (prompt + element + targets) or
  "Generate now".
- History: all runs (plan, plant feasibility notes table, brief summary,
  provider/model, time), favorites filter, re-run with same brief, delete run.
- Climate: if exterior and project has no climate profile, prompt to add ZIP
  (Settings) — plant feasibility needs it.

### 3.16 design-knowledge — `src/assets/design/*` (+ tests)
- ~16 architectural styles (exterior & interior: Colonial/Colonial Revival,
  Georgian, Federal, Cape Cod, Craftsman/Bungalow, Tudor, Victorian/Queen
  Anne, Farmhouse (traditional & modern), Ranch, Mid-century modern, Split-level,
  Spanish/Mission, Mediterranean, Prairie, Contemporary/Modern, Cottage,
  Transitional interior, Scandinavian, Japandi, Industrial…) with accurate
  identifying cues, characteristics, 2–3 historically appropriate palettes,
  materials, landscape and lighting approaches, avoid-lists, theme ids.
- ~18 design themes (exterior: cottage garden, formal/symmetrical,
  native & pollinator, xeriscape/dry garden, woodland shade, modern
  minimalist, Mediterranean, Japanese-inspired, coastal, edible/potager;
  interior: warm minimal, Scandinavian, Japandi, modern farmhouse,
  traditional, mid-century, coastal, bold eclectic) with purpose,
  principles, palette, materials, plants (feasibility-minded with climate
  notes), lighting, suits, promptHint.
- ELEMENT_DEFS for every ElementType with 2–6 dimensions each and 3–6
  options per dimension, each with description, promptText (specific,
  photoreal-friendly: sizes in inches/feet, materials, colors), rationale
  and a visual: textures (TextureSpec using TEXTURE_PATTERNS with realistic
  unit sizes — e.g. Pathway "stone size": large flagstone 18–24 in, medium
  12–16 in pavers, small 4 in cobbles, 3/8 in pea gravel), colors,
  diagrams (ids listed in a DIAGRAM_IDS export for the UI to draw:
  'path-straight', 'path-curved', 'path-meander', 'width-3ft', 'width-4ft',
  'width-5ft', 'edge-none', 'edge-steel', 'edge-brick', 'edge-plants',
  'beam-down', 'beam-up', 'beam-path', …) or art (PlantArt/FixtureArt).
- ELEMENT_GUIDANCE per element: purpose, rules of thumb (dimensions, code /
  safety basics like step riser 6–7.5 in, path lighting spacing 8–10 ft),
  how to relate to the architecture.
- Functions per contract; plantFeasibility uses catalog PlantInfo; tests.

---------------------------------------------------------------------------

## 4. Quality bar
- `npm run typecheck` clean, `npm test` green, `npm run build` succeeds.
- No console errors in normal use. Handle empty/edge states gracefully
  (no photo, no regions, no AI, storage errors, huge images, tiny screens).
- Looks polished: consistent spacing (panels px-4, gap-3), clear hierarchy,
  helpful microcopy, subtle transitions; respects light/dark.
