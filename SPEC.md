# Mode — Home Redesign Studio: build spec

Mode is a local-first web app (works great on a phone) for redesigning a house
from photos. You upload photos of parts of the house — rooms, the facade, the
yard — then try paint colors, flooring/siding/hardscape materials, lighting
(time of day and fixtures) and landscaping (plants, planters, decor), compare
design options side by side, and keep an **asset list** (shopping/materials
list) that you can **type in, import, or generate** (rule-based from the
design, or AI-enriched). Optional AI (Claude) analyzes photos, proposes
designs, prices the list and draws new assets; an optional image provider
produces photoreal renders.

Everything works offline with no API keys except the AI features.

---------------------------------------------------------------------------

## 1. Architecture

```
index.html, src/main.tsx      Vite + React 19 + TypeScript (strict) + Tailwind v4
src/App.tsx                   app shell (routes: projects home ↔ project workspace)
src/ui/common/index.tsx       shared UI primitives (Button, IconButton, Slider, Modal, Swatch, …)
src/ui/shell/*                top bar, projects home, spaces sidebar, settings, export menu, mobile nav, toasts
src/ui/editor/*               the canvas editor (render, zoom/pan, tools, overlays, compare)
src/ui/panels/*Panel.tsx      right-hand panels: Surfaces, Paint, Materials, Lighting, Library, AssetList, AI
src/state/store.ts            zustand+immer store: project document, selection, tools, undo/redo   (DONE)
src/state/runtime.ts          in-memory masks + decoded photos + Lab cache                          (DONE)
src/state/renderContext.ts    builds engine RenderContext for a photo/design                        (DONE)
src/state/persistence.ts      IndexedDB (idb-keyval) storage + project bundle import/export
src/engine/*                  pixel engine (pure TS on ImageDataLike; compositor/assetImages use canvas)
src/assets/catalog/*          built-in catalog data (paints, materials, plants, fixtures, decor) + search
src/assets/art/*              procedural SVG art for built-in assets
src/assetList/*               quantities, area estimates, rule-based list generation, CSV/print export & CSV import
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
- assetList: area.ts, quantities.ts, generate.ts, export.ts per contracts.
  generate: group paint by hex+finish; area from regionAreaSqFt (sum); when a
  region's area is unknown, still add the row with quantity 0, specs noting
  "measure or calibrate photo". Painting supplies row once if any paint.
  Materials: materialToBuy; mulch/gravel/sod logic by material category.
  Objects: group placed objects by assetId across all spaces (count),
  unitCost = midpoint of asset.cost; plants note container size; lights:
  group by assetId (unknown fixture → by name). Space ids attached.
  designSummaryText: compact, readable, deterministic. Tests for all.

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
- Projects home: warm editorial landing (font-display headline “Redesign your
  home, one photo at a time”, short explanation of the 4 steps: add spaces →
  upload photos → design (paint, materials, lighting, landscaping) → asset
  list), "New project" (modal: name, optional ZIP/zone/style), recent
  projects grid (cover thumbnail from blob, name, counts, updated time, menu:
  open/rename/delete with ConfirmModal), "Import project" (file input
  .json), AI status hint.
- Workspace layout: desktop: TopBar (h-14) + [SpacesSidebar w-64 | EditorView
  flex-1 | RightPanel w-[22rem] with icon tab rail]; mobile (< lg): TopBar +
  one pane at a time (view.mobilePane) + bottom nav (Spaces / Design / Panels)
  and the right panel as full-height pane with a scrollable tab strip.
- TopBar: back to projects, editable project name, save status (saving/saved/
  error), undo/redo (+ Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y — ignore when
  typing in inputs), Export menu (Design image PNG via renderDesignToBlob;
  Before/after via renderBeforeAfterBlob; Asset list CSV; Print asset list
  (open assetListToPrintHTML in a new window and print); Project backup via
  exportProject), Settings button.
- SpacesSidebar: Interior / Exterior groups; space rows (icon by type, name,
  photo count) expandable to photo thumbnails (blob → object URL, revoke on
  unmount); add photo (hidden file input, accept image/*, multiple); drag &
  drop images onto a space; space menu (rename, change type, notes, delete
  with confirm); "Add space" modal: grid of SpaceType tiles with lucide icons
  grouped Interior / Exterior, optional name. Photo row menu: rename, delete.
- RightPanel: tab rail (icons + labels): Surfaces, Paint, Materials,
  Lighting, Library ("Plants & objects"), Asset list, AI; renders the panel
  components from src/ui/panels. Toasts (bottom-center, from store).
- Settings modal: project info (name, ZIP, hardiness zone with hint & link
  to https://planthardiness.ars.usda.gov, budget, style, notes); appearance
  (System/Light/Dark → html[data-theme], persisted in localStorage
  'mode.theme'); AI status (from store.health; how to enable: set
  ANTHROPIC_API_KEY in .env and restart; image provider status); server access
  token field (localStorage 'mode.apiToken'); storage usage
  (navigator.storage.estimate); export/import/delete project.
- Register a minimal service worker only in production for offline app shell
  (optional; must not cache /api).

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

### 3.11 panels-scene — `src/ui/panels/LightingPanel.tsx`, `LibraryPanel.tsx` (+ helpers under src/ui/panels/scene/)
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

### 3.12 panels-plan — `src/ui/panels/AssetListPanel.tsx`, `AIPanel.tsx` (+ helpers under src/ui/panels/plan/)
- Asset list (project-wide): header with item count, total (assetListTotals)
  vs budget (progress bar; over budget in warning color). Actions: "Generate
  from design" (store.regenerateAssetList, explains it keeps manual & locked
  rows), "AI: complete & price" (api.generateAssetListAI with
  designSummaryText → draftsToItems → append; show returned notes; disabled
  with reason when AI is off), "Add item" (modal form: name, category, qty,
  unit, unit cost, spaces multi-select, specs, vendor, link, notes, status),
  "Import CSV" (file → parseAssetListCSV → preview count → add as manual
  rows), Export CSV, Print. Grouped by category with subtotals; each row:
  swatch for paint, name, specs, qty × unit, unit cost, line total, status
  select, source badge (generated/AI/manual) + lock icon; inline edits of
  qty/unit cost; row menu edit/lock/delete. Filter by space and status.
  "Expand" opens a large modal with the full table (more columns).
- AI: status card (enabled? model; image provider). When off: friendly
  explanation + how to enable; everything else in the app still works.
  Sections for the active photo: (1) Analyze → api.analyzePhoto (photo blob →
  blobToAIDataUrl) → store.setAnalysis → render analysis (summary, style,
  surfaces with current color swatches, lighting notes, landscaping,
  opportunities). (2) Design ideas: style chips (interior: Modern farmhouse,
  Scandinavian, Japandi, Mid-century modern, Coastal, Traditional, Industrial,
  Bohemian; exterior: Modern, Craftsman, Cottage garden, Xeriscape, Tropical,
  Formal, Pollinator garden, Mediterranean) + brief + budget → api.suggestDesign
  (regions of the photo included) → suggestion card (concept, palette
  swatches, per-region treatments, lighting, fixtures, plants (botanical, why),
  decor, tips, budget). Buttons: "Apply as new option" (store.addDesign(title,
  false) then apply: paint/material treatments for listed regionIds (validate
  material ids via getMaterial; hex via normalizeHex), lighting timeOfDay +
  kelvin, place catalog fixtures/plants/decor at normalized positions ×
  photo size with defaultObjectHeightPx (skip unknown ids, report count)),
  "Add to asset list" (draftsToItems). (3) Photoreal render (image provider
  required): strength, instructions, "Render" → current composite via
  loadRenderContext + renderDesignToBlob → canvas → AI data URL →
  api.renderAI → store.addAIRender(blob, prompt, provider) → gallery of
  renders for the design with before/after slider, download, delete.
  Show progress and allow cancel (AbortController) for long calls.

---------------------------------------------------------------------------

## 4. Quality bar
- `npm run typecheck` clean, `npm test` green, `npm run build` succeeds.
- No console errors in normal use. Handle empty/edge states gracefully
  (no photo, no regions, no AI, storage errors, huge images, tiny screens).
- Looks polished: consistent spacing (panels px-4, gap-3), clear hierarchy,
  helpful microcopy, subtle transitions; respects light/dark.
