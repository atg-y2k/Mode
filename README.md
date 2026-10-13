# Mode — Home Redesign Studio

Upload photos of parts of your house (rooms, the front of the house, the yard)
and see what they'd look like redesigned: new **paint colors**, **flooring,
siding, tile and hardscape**, **lighting** (time of day and fixtures), and
**landscaping** (plants, planters, outdoor furniture). Compare design options
side by side, then turn the design into an **asset list** (shopping and
materials list) that you can type in, import from a spreadsheet, or generate.

Mode is local-first: projects, photos and lists stay in your browser
(IndexedDB). The AI features are optional and only run when you ask for them.

## Features

| Area | What you can do |
| --- | --- |
| **Spaces & photos** | Organize the house into interior and exterior spaces, upload photos (phone camera works), several design options per photo (Option A / B / …). |
| **Surfaces** | Outline walls, trim, cabinets, floors, siding, doors, lawns and beds with a smart brush, magic wand, polygon, lasso, brush and eraser. Masks are shared by every design option. |
| **Paint** | Shading-preserving recolor with finishes (flat → gloss). Built-in palette of about 160 colors in curated collections, custom hex / brand / code entry, eyedropper, similar colors, colors already used in the project. |
| **Materials** | Procedural textures for wood, tile, brick, pavers, flagstone, gravel, mulch, grass, stucco, siding, shingles, metal roofing, decking and more. Flat or perspective-plane mapping so floors and patios recede correctly. |
| **Lighting** | Day, golden hour, dusk and night looks, exposure and warmth, plus placed lights (recessed, pendants, sconces, lanterns, path lights, uplights, spots, LED strips, string lights) with color temperature and reach. |
| **Landscaping & objects** | A library of plants (zone, sun, water, mature size), fixtures, planters, furniture and hardscape objects to place, scale and layer. Add your own by uploading a photo (with background removal) or by generating one with AI. |
| **Asset list** | Type items in, import CSV, or generate the list from your designs: paint gallons from wall area and coats, materials with waste, mulch in cubic yards, plants and fixtures with counts and cost estimates. Optional AI pass adds missing items and prices. Export as CSV or print. |
| **AI (optional)** | Claude analyzes a photo, proposes complete design options you can apply in one click, and completes and prices the asset list. With an image provider configured you also get photoreal renders. |
| **Compare & export** | Before/after slider, side-by-side view, PNG export, before/after image, project backup and restore. |

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev          # app on http://localhost:5173, API on :8787
```

Open the app on your phone over your LAN at `http://<your-computer-ip>:5173`.

### Enable AI features (optional)

```bash
cp .env.example .env
# set ANTHROPIC_API_KEY=...            (photo analysis, design ideas, asset-list pricing, vector assets)
# optional: IMAGE_PROVIDER=openai and OPENAI_API_KEY=...   (photoreal renders and photo assets)
npm run dev
```

Everything except the AI buttons works without keys.

### Production

```bash
npm run build
npm start            # one Node process serves the app and the API on $PORT (default 8787)
```

If you expose the server beyond your own network, set `MODE_ACCESS_TOKEN` and
enter the same token under **Settings → Server access token**.

## How to use it

1. **Create a project** for your house and add spaces (Living room, Front of
   house, Backyard, and so on).
2. **Upload photos** of each space.
3. **Outline surfaces** (Surfaces panel): add a surface such as *Wall* or
   *Lawn*, then tap it with the smart brush or the magic wand and refine the
   edges with the brush or eraser. Optionally calibrate the photo by drawing
   a line of known length (a door is about 3 ft wide) to get real areas.
4. **Design**: pick paint or materials for each surface, set the lighting
   and place fixtures, and add plants and objects. Use **+** next to the
   option tabs to try alternatives.
5. **Asset list**: generate it from your designs, add your own items, export
   it, and track status from idea to installed.

## Development

```bash
npm run typecheck    # TypeScript
npm test             # unit tests (vitest)
npm run test:e2e     # browser smoke tests (Playwright)
```

Architecture and module contracts are documented in [SPEC.md](SPEC.md).
