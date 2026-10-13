/**
 * Prompts for every Claude call.
 *
 * One shared system prompt (persona + standards + the built-in catalog) is
 * byte-stable across requests so it is served from the prompt cache; all
 * per-request context and task instructions go in the user turn.
 */
import type {
  AnalyzeRequest,
  AssetListRequest,
  GenerateAssetRequest,
  GeneratedAssetMeta,
  RenderRequest,
  SuggestRequest,
} from '../shared/api';
import { SPACE_TYPE_LABELS, SURFACE_LABELS, spaceKindOf, type AssetCategory, type SpaceType } from '../shared/types';

// ---------------------------------------------------------------------------
// System prompt (cached prefix)
// ---------------------------------------------------------------------------

export function buildSystemPrompt(catalogSummary: string): string {
  return `You are the design studio inside Mode, a home-redesign app. You work as two seasoned professionals in one: a residential interior designer (color, finishes, flooring, lighting, styling) and a landscape designer (planting design, hardscape, outdoor lighting), serving homeowners across the United States.

Homeowners photograph a room, the outside of their house or their yard. Mode paints colors, materials, light fixtures, plants and decor onto that photo and keeps a shopping list (the "asset list"). Your answers are applied to the photo automatically and shown to the homeowner, so they must be accurate, specific and buildable.

## Read the photo first
- Base every judgment on what is visible: architectural style and era, existing materials, fixed elements (windows, doors, rooflines, stairs, built-ins, mature trees, slopes, utilities), scale, and the condition of surfaces.
- Read the light: where daylight comes from, how strong it is, which areas get full sun, part sun or shade (shadow patterns, moss, thin lawn, orientation clues), and what color cast the camera recorded. Judge existing colors as they would look under neutral daylight, not as tinted by the photo.
- Work with the architecture, not against it: keep its proportions and character, and propose only what a homeowner can realistically change (paint, finishes, flooring, fixtures, plants, decor, hardscape). No structural changes unless asked.

## Design standards
- Color: build a cohesive palette (roughly 60/30/10 across main, secondary and accent), check undertones against fixed elements (roof, brick, stone, flooring, countertops) and against the home's light. Give every color a descriptive name and a '#rrggbb' hex matching the color as it looks painted, in neutral daylight.
- Paint finishes: ceilings flat; walls matte or eggshell (kitchens and baths satin); interior trim, doors and cabinets satin or semi-gloss; exterior siding flat or satin; exterior trim, doors and shutters satin, semi-gloss or gloss.
- Lighting: layer ambient, task and accent light. Interiors 2700-3000 K (kitchens and work areas up to 3500 K); exterior and landscape lighting 2700-3000 K, shielded and aimed to avoid glare into windows and neighbors; path lights about 6-8 ft apart and staggered, never runway-straight. Favor dimmable LED, and low-voltage outdoor systems with a transformer and a timer or photocell.
- Planting: right plant, right place. Match sun, water and USDA hardiness zone, and size for mature dimensions (shrubs 2-3 ft off the foundation, below window sills, clear of walkways). Plant in odd-numbered drifts, layer heights (tall at the back and corners, medium in the middle, low edging in front), repeat plants for rhythm, and combine evergreen structure with seasonal flowers and foliage. Favor regionally native and pollinator-friendly plants, avoid invasive-prone species, and mention deer resistance or pet toxicity when it matters.
- Hardiness: when the homeowner's USDA zone is given, only recommend plants rated for it. When only a ZIP code is given, infer the zone from it. When neither is given, infer the climate cautiously from the photo (vegetation, architecture, light), prefer widely adaptable plants, and say the zone should be confirmed.
- Materials and hardscape: choose materials suited to the surface, climate and use (slip resistance, freeze-thaw, drainage, upkeep), with clean transitions and edges.
- Practicality: realistic quantities with waste allowances, sensible sequencing, and a short note when a licensed pro or a permit is typically needed (hardwired electrical, gas, structural work, retaining walls over about 4 ft, large tree work).

## Prices
Use realistic current US retail prices: what a homeowner pays per unit at home centers, lighting retailers and local nurseries. Exclude labor unless the line item is labor. Useful anchors: interior paint $40-80/gal; exterior paint $50-95/gal; primer $25-45/gal; 1-gal perennials $12-25; 3-gal shrubs $30-60; 15-gal trees $120-300; bagged mulch $4-6 per 2 cu ft bag or $35-60/cu yd bulk; LED path lights $40-150 each; low-voltage transformers $120-300; luxury vinyl plank $2.50-5/sq ft; porcelain tile $3-10/sq ft; concrete pavers $4-9/sq ft.

## Mode's catalog
Mode ships with the built-in catalog below: one line per item, "kind id | name | key attributes". Any field named assetId, materialId or refId must contain an id copied exactly from this catalog, or null when nothing fits. Never invent, shorten or alter ids. Match kinds: materialId uses a material line, plant assetIds use plant lines, fixture assetIds use fixture lines, decor assetIds use decor lines. A null id is fine (the item still appears by name), so never force a poor match.

<catalog>
${catalogSummary.trim()}
</catalog>

## Positions on the photo
- Positions are normalized to the photo: x from 0 (left edge) to 1 (right edge), y from 0 (top edge) to 1 (bottom edge).
- A position marks where the item's base touches its support: the soil line of a plant, the bottom of a planter or a piece of furniture standing on the ground or floor, the ground point of a path light, the mounting point of a wall sconce or porch light, the bulb of a ceiling fixture. Mode stands the item upright on that point and scales it with perspective.
- Place items only where they could physically go: visible ground, beds, lawn edges, decks, patios, floors, tabletops or walls. Never in the sky, on roofs, windows, glass, doors, people or vehicles, and never blocking doors, steps or paths.
- Spread multiples naturally along beds and edges, staggered rather than in a rigid grid (unless it is a hedge, a row of path lights or symmetrical planters). Items lower in the frame are closer to the camera.

## Output
- Answer only in the requested JSON format, with plain text in every field: no markdown, no catalog ids inside prose.
- Be concise and homeowner-friendly, and lead with the most impactful ideas.
- Only use region ids that the request lists.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Homeowner text goes inside tagged sections; keep it from closing them. */
export function cleanUserText(text: string | null | undefined, maxLength = 4000): string {
  if (!text) return '';
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/[<>]/g, (ch) => (ch === '<' ? '‹' : '›'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function section(tag: string, body: string): string {
  return `<${tag}>\n${body.trim()}\n</${tag}>`;
}

function spaceLabel(type: SpaceType | null): string {
  if (!type) return 'not specified';
  return `${SPACE_TYPE_LABELS[type]} (${spaceKindOf(type)})`;
}

function formatUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

type Location = SuggestRequest['location'];

function formatLocation(location: Location): string {
  const zip = location?.zip?.trim();
  const zone = location?.hardinessZone?.trim();
  const notes = cleanUserText(location?.notes, 1000);
  const lines = [
    `ZIP code: ${zip || 'not given'}`,
    `USDA hardiness zone: ${zone || (zip ? 'not given (infer it from the ZIP code)' : 'not given (infer the climate from the photo and say the zone should be confirmed)')}`,
  ];
  if (notes) lines.push(`Site notes: ${notes}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// POST /api/analyze
// ---------------------------------------------------------------------------

export function analyzePrompt(req: AnalyzeRequest): string {
  const notes = cleanUserText(req.notes, 2000);
  const exterior = req.spaceType ? spaceKindOf(req.spaceType) === 'exterior' : null;
  return [
    section('task', 'Analyze the attached photo so the homeowner can plan a redesign of this space.'),
    section(
      'context',
      [
        `Space type as labeled by the homeowner: ${spaceLabel(req.spaceType)}`,
        `Homeowner notes: ${notes || 'none'}`,
      ].join('\n'),
    ),
    section(
      'instructions',
      `- spaceType: the homeowner's label unless the photo clearly shows a different kind of space; if no label, your best classification.
- summary: 2-3 sentences on what the photo shows: architecture and era, layout, standout features and overall condition.
- style: the current style in a few words (e.g. "dated 1990s builder traditional", "mid-century ranch with original brick").
- surfaces: every visible surface a homeowner could redesign (walls, accent walls, ceiling, trim, doors, cabinets, floor, backsplash, countertops, siding, roof, shutters, front and garage doors, fascia, foundation, fence, deck, patio, paths, driveway, lawn, planting beds, retaining walls), using the closest surface kind. description: material and finish as seen. currentColorHex: your best estimate of the surface's real color under neutral daylight (correct for the photo's color cast), or null when it has no meaningful single color. condition: a short note on wear or problems, or null if it looks fine.
- lighting.natural: direction, quality and amount of daylight, and orientation clues. lighting.artificial: fixtures you can see (or "none visible"). lighting.issues: concrete problems such as dark corners, glare, mismatched color temperatures, a single overhead light, or an entry that will be dark at night.
- landscaping: ${exterior === false ? 'null (interior space).' : 'for exterior photos, the existing plantings, lawn and hardscape (features) and problems such as overgrown foundation shrubs, bare or eroding beds, lawn in deep shade, weak curb appeal (issues); null for interior photos.'}
- opportunities: 4-8 specific, high-impact moves, most impactful first, each naming the surface or area and the change (for example "Repaint the orange-toned oak trim a soft white (#f2efe6) to brighten the room"). Mix quick wins with bigger projects, and fit the home's style.`,
    ),
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// POST /api/suggest
// ---------------------------------------------------------------------------

export function suggestPrompt(req: SuggestRequest): string {
  const kind = spaceKindOf(req.spaceType);
  const brief = cleanUserText(req.brief, 4000);
  const regions = req.regions.length
    ? req.regions
        .map((r) => `- id: ${r.id} | name: "${cleanUserText(r.name, 80)}" | surface: ${r.surface} (${SURFACE_LABELS[r.surface]})`)
        .join('\n')
    : 'none: the homeowner has not outlined any surfaces yet, so return an empty regionTreatments list and describe color changes in the palette.';
  const budget =
    req.budgetUsd != null && req.budgetUsd > 0
      ? `${formatUsd(req.budgetUsd)} for materials, plants and products; keep estimatedBudget.highUsd within it, or explain the trade-off in tips.`
      : 'not set: propose a sensible mid-range plan.';

  const plantRule =
    kind === 'exterior'
      ? '- plants: the planting plan. Use catalog plant ids when a listed plant fits; give botanical names; quantities in odd-numbered drifts; placement (which bed, foreground or background, spacing); why it works here (sun, zone, size, season, maintenance). positions: one ground-contact point per plant you would show in the photo, inside visible beds, lawn edges or containers.'
      : '- plants: houseplants only (or an empty list): pick species that suit the room\'s light, with pots, and note pet toxicity when relevant. positions: floor or furniture points where each pot sits.';

  return [
    section('task', 'Create one complete, buildable redesign option for the space in the attached photo.'),
    section(
      'project',
      [
        `Space: ${spaceLabel(req.spaceType)}`,
        `Style direction: ${cleanUserText(req.style, 300) || 'designer\'s choice that suits the architecture'}`,
        `Homeowner brief: ${brief || 'none'}`,
        `Budget: ${budget}`,
        formatLocation(req.location),
      ].join('\n'),
    ),
    section('regions', `Surfaces the homeowner has outlined on the photo (use these ids exactly):\n${regions}`),
    section(
      'instructions',
      `- title: a short, evocative name for this option (e.g. "Sage & Cedar Craftsman").
- concept: 2-4 sentences on the direction and why it suits this ${kind === 'exterior' ? 'house and site' : 'room'}.
- palette: 3-6 colors, each with its role, name, hex and finish. brandMatch: a comparable real paint color the homeowner can sample in store, written as brand, color name and code (for example "Benjamin Moore Hale Navy HC-154"), or null if you are not confident.
- regionTreatments: one entry for every outlined region, each region exactly once. kind "paint" needs hex, colorName and finish (materialId null); kind "material" needs a catalog materialId suited to that surface (hex, colorName and finish null); kind "none" keeps the surface as is. reason: one short sentence.
- lighting.timeOfDay: the best time to preview this design (dusk or night to show landscape and accent lighting, golden for curb appeal, day for most interiors). lighting.kelvin: white balance of the ambient light for that preview, 2200-6500 (about 5500 for neutral daylight, 3500-4500 for a warm golden-hour glow, 5500-6500 for a cool dusk or night sky).
- lighting.fixtures: specific fixtures with catalog ids when one fits, quantity, color temperature (kelvin) and placement. positions: where each fixture you would show sits in the photo (at most the quantity; may be empty for fixtures not visible in this view).
${plantRule}
- decor: furniture, planters, rugs, wall art, outdoor furniture or hardscape objects that complete the look, with catalog ids when one fits, quantity, placement and positions.
- assetList: the shopping list to build this option: paint by the gallon (about 350 sq ft per gallon per coat, 2 coats; primer when covering dark or stained surfaces), materials by area plus 10% waste, plants by container size, fixtures, transformers, bulbs, decor, supplies, and labor lines for work a homeowner would normally hire out. Use realistic unit prices, refIds from the catalog when an item matches, hex for paint rows, and an empty spaceNames list.
- tips: 3-6 practical tips: sample before committing, prep, sequencing, planting season for the zone, maintenance.
- estimatedBudget: low and high totals in USD for the asset list.`,
    ),
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// POST /api/asset-list
// ---------------------------------------------------------------------------

export function assetListPrompt(req: AssetListRequest): string {
  const existing = req.existingItems.length
    ? req.existingItems
        .map((i) => `- ${cleanUserText(i.name, 160)} (${i.category}) ${i.quantity} ${cleanUserText(i.unit, 20)}`)
        .join('\n')
    : 'none yet';
  return [
    section('task', 'Complete and price the shopping list (asset list) for this home redesign project.'),
    section(
      'project',
      [
        `Project: ${cleanUserText(req.projectName, 200) || 'Untitled'}`,
        `Style direction: ${cleanUserText(req.style, 300) || 'not set'}`,
        `Budget: ${req.budgetUsd != null && req.budgetUsd > 0 ? formatUsd(req.budgetUsd) : 'not set'}`,
        `Homeowner brief: ${cleanUserText(req.brief, 4000) || 'none'}`,
        formatLocation(req.location),
      ].join('\n'),
    ),
    section('design_summary', cleanUserText(req.designSummary, 60000) || 'No design details yet.'),
    section('existing_items', existing),
    section(
      'instructions',
      `- items: only what the list is missing to actually build the design in design_summary. Never repeat an existing item, even under a different name. Think through everything a homeowner needs: paint and primer (about 350 sq ft per gallon per coat, 2 coats; round up to whole gallons), painting supplies, materials with 10% waste plus underlayment, grout, adhesive, edging or base as needed; plants by container size; mulch at a 3 in depth, soil amendment and landscape edging for new beds; fixtures plus bulbs, transformers, cable, timers or smart switches; hardware; delivery or disposal fees when significant; and labor lines for work usually hired out (electrician, tile setter, tree work).
- quantity and unit: derived from the areas and counts in design_summary; when an area is unknown, estimate conservatively and say so in notes. Units: gal, each, sq ft, cu yd, bag, lin ft, flat or hour.
- unitCostUsd: realistic current US retail per unit, or null for free or unknown items.
- specs: a short spec line (finish and sheen, size, color temperature, container size, coverage).
- vendor: the kind of store or a representative brand when helpful, else null.
- hex: paint color for paint rows, else null. refId: catalog id when the item matches a catalog entry, else null.
- spaceNames: names of the spaces from design_summary the item is for; empty for whole-project items.
- notes: 3-8 planning notes: order of work (for example hardscape, then planting, then mulch, then lighting), permits or HOA approval, the best season to plant in this zone, lead times, hidden costs, and how the total compares with the budget.`,
    ),
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// POST /api/generate-asset
// ---------------------------------------------------------------------------

const CATEGORY_GUIDE: Record<AssetCategory, string> = {
  plant: 'a plant (in the ground unless the description mentions a pot or planter); realHeightFt is the size at planting from a typical nursery container unless the description asks for a mature specimen',
  lighting: 'a light fixture (wall, ceiling, pendant, post, path or landscape light); show the fixture with its glass or shade as if lit softly',
  decor: 'a decor object (planter, wall art, mirror, rug, lantern, sculpture, accessory)',
  furniture: 'a piece of furniture (indoor or outdoor)',
  hardscape: 'a hardscape element (boulder, fire pit, bench, raised bed, fence panel, pergola, water feature, stepping stone)',
  other: 'a home or garden object',
};

function metadataInstructions(req: GenerateAssetRequest): string {
  return `- name: short, specific, title case (e.g. "Oakleaf Hydrangea", "Black Barn Sconce").
- category: "${req.category}". subcategory: a short lowercase grouping (e.g. "shrub", "sconce", "planter", "lounge chair"), or null.
- description: one sentence describing the object for a library card.
- realHeightFt: the object's real-world height in feet as drawn (base to top); used to scale it on photos.
- tags: 4-8 lowercase search words (material, color, style, use, indoor/outdoor).
- costLowUsd / costHighUsd: typical US retail price range per item, or null if it is not something you buy.`;
}

export function vectorAssetPrompt(req: GenerateAssetRequest): string {
  return [
    section(
      'task',
      'Create a new placeable asset for Mode\'s library: metadata plus an SVG illustration that will be composited onto real photos of homes and yards.',
    ),
    section(
      'request',
      `Category: ${req.category}: ${CATEGORY_GUIDE[req.category]}\nDescription: ${cleanUserText(req.description, 1000)}`,
    ),
    section(
      'metadata',
      metadataInstructions(req),
    ),
    section(
      'svg_rules',
      `Draw the object itself and nothing else. Follow every rule:
- One standalone <svg> element with xmlns="http://www.w3.org/2000/svg", a viewBox fitted tightly to the object's real proportions (for example "0 0 400 520"), and width and height equal to the viewBox size. Use a viewBox about 300-600 units on its longer side.
- Transparent background: no background rectangle, sky, ground plane, floor, frame, scenery or drop shadow beyond a very faint contact shadow at the base.
- The object's base (soil line, pot bottom, feet, or wall-mount back plate) touches the bottom edge of the viewBox, horizontally centered, with only a small margin at the sides and top.
- Look: an attractive, natural, photo-friendly illustration with realistic proportions, seen at eye level from slightly in front. Build volume with layered shapes in 2-3 tones per material plus linear or radial gradients, light from the upper left, a slightly darker shadow side and base, and small highlights. Foliage is many overlapping, irregular leaf clusters with varied edges and some see-through gaps, never one smooth blob; flowers are small clustered petals or dots; metal and glass get subtle gradients and a highlight. No cartoon outlines (strokes 1.5 px or thinner, in darker tones of the fill).
- Allowed elements: g, path, rect, circle, ellipse, polygon, polyline, line, defs, linearGradient, radialGradient, stop, clipPath, mask, use, and filter with feGaussianBlur only.
- Not allowed: text, images, scripts, style elements, CSS, animation, foreignObject, event handlers, links or any external reference.
- Give ids a short unique prefix (e.g. "hyd-leaf1") and reference them only with url(#id) or href="#id".
- Keep it compact: typically 8-25 KB and never more than 40 KB, coordinates rounded to 1 decimal, gradients reused, no comments or editor metadata.`,
    ),
  ].join('\n\n');
}

export function photoAssetPlanPrompt(req: GenerateAssetRequest): string {
  return [
    section(
      'task',
      'Plan a new photo-style asset for Mode\'s library: write its metadata and the prompt an image model will use to render it as a cut-out product photo on a transparent background.',
    ),
    section(
      'request',
      `Category: ${req.category}: ${CATEGORY_GUIDE[req.category]}\nDescription: ${cleanUserText(req.description, 1000)}`,
    ),
    section('metadata', metadataInstructions(req)),
    section(
      'image_prompt',
      `- imagePrompt: one paragraph (50-120 words) describing only the object so it renders true to life: exact species and cultivar or product type, size and proportions, colors, materials and finish, condition (healthy, full, well-shaped), and the view (eye level, slightly from the front, the whole object visible from base to top, centered). Do not mention backgrounds, rooms, scenery or text; Mode adds the transparent background instructions itself.
- orientation: "portrait" for tall objects (most plants, floor lamps, sconces), "landscape" for wide ones (sofas, benches, rugs, fire pits), "square" otherwise.`,
    ),
  ].join('\n\n');
}

/** Wraps the object description with the cut-out requirements for the image provider. */
export function photoAssetImagePrompt(objectPrompt: string): string {
  return `${objectPrompt.trim()}

Isolated product photo of this single object only, entire object in frame from its base to its top, centered, with a little empty margin. Realistic photographic detail, soft even daylight from the upper left, true colors. Fully transparent background: no ground, floor, wall, pot saucer, shadow, reflection, scenery, people, text or watermark.`;
}

// ---------------------------------------------------------------------------
// POST /api/render
// ---------------------------------------------------------------------------

const STRENGTH_GUIDE: Record<RenderRequest['strength'], string> = {
  subtle:
    'subtle: keep the composition and every design choice exactly as previewed; only make it photoreal (real textures, real plants, real fixtures, believable light and shadows).',
  balanced:
    'balanced: faithfully realize the previewed design as a real photo, refining anything that looks flat, pasted-on or illustrated, while keeping the layout and every listed change.',
  bold:
    'bold: fully realize and elevate the design in the same spirit: richer, more mature planting, finished styling and flattering light are welcome, while the architecture and camera stay exactly the same.',
};

export function renderPromptRequest(req: RenderRequest): string {
  const instructions = cleanUserText(req.instructions, 2000);
  return [
    section(
      'task',
      'Write the prompt for an image-editing model that will turn the attached preview into a photorealistic photo of the finished redesign.',
    ),
    section(
      'about_the_image',
      "The attached image is Mode's preview of the design: the homeowner's real photo with paint recolors, procedural material textures, illustrated plants, fixtures and decor, and simulated lighting composited on top. Some of it looks flat or illustrated; the edit must make the whole image look like a real photograph of the finished project.",
    ),
    section('design_summary', cleanUserText(req.designSummary, 20000) || 'No design details provided.'),
    section('homeowner_instructions', instructions || 'none'),
    section('strength', STRENGTH_GUIDE[req.strength]),
    section(
      'instructions',
      `Write one prompt of 80-200 words in plain sentences (no lists, no markdown):
1. Open with what the photo shows (for example "Photo of a two-story craftsman house with a covered front porch and a small front lawn").
2. Preserve exactly: camera position, lens, perspective and framing; the architecture, rooflines, windows, doors and every structure; and anything the design does not change.
3. Describe the changes concretely and in place: colors by plain color names with their finish (image models do not read hex codes), materials, the specific plants, fixtures and decor and where they are, and the lighting or time of day.
4. Ask for realism: real plant species with natural variation, true-to-scale objects that sit on the ground with contact shadows, consistent light direction, reflections and believable materials.
5. End with: photorealistic, natural colors, sharp detail, no text, no watermarks, no people.
Follow the strength setting, and include the homeowner's instructions unless they conflict with preserving the architecture.`,
    ),
  ].join('\n\n');
}

/** Used when Claude is off (or unavailable): a solid generic edit prompt. */
export function templateRenderPrompt(req: RenderRequest): string {
  const summary = cleanUserText(req.designSummary, 3000);
  const instructions = cleanUserText(req.instructions, 1500);
  const strength: Record<RenderRequest['strength'], string> = {
    subtle:
      'Keep the composition and every design element exactly as shown; only make it look like a real photograph with real textures, plants, fixtures, light and shadows.',
    balanced:
      'Faithfully realize the design shown as a real photograph, refining anything that looks flat, pasted-on or illustrated, while keeping the layout and every change.',
    bold:
      'Fully realize and elevate the design in the same spirit, with richer planting, finished styling and flattering light, while the architecture and camera stay exactly the same.',
  };
  return [
    'Turn this preview of a home redesign into a photorealistic photograph of the finished project.',
    'Preserve exactly the camera position, lens, perspective and framing, the architecture, rooflines, windows, doors and every structure, and anything not changed by the design.',
    strength[req.strength],
    summary ? `The design: ${summary}` : '',
    instructions ? `Also: ${instructions}` : '',
    'Plants must look like real, healthy plants with natural variation; objects must be true to scale and sit on the ground with contact shadows; light direction, reflections and materials must be consistent and believable.',
    'Photorealistic, natural colors, sharp detail, no text, no watermarks, no people.',
  ]
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Fallback metadata (photo assets while Claude is off)
// ---------------------------------------------------------------------------

const DEFAULT_HEIGHT_FT: Record<AssetCategory, number> = {
  plant: 3,
  lighting: 1.5,
  decor: 2,
  furniture: 3,
  hardscape: 2,
  other: 2,
};

const STOP_WORDS = new Set(
  'a an and the with for of in on to my our your this that some very small large big tall short new old from into by or at as is are its it'.split(
    ' ',
  ),
);

/** Reads a height such as "6 ft", "4'", "30 in" or "30\"" from a description. */
export function parseHeightFt(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|in|inch|inches|")(?![a-z])/i.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2].toLowerCase();
  const ft = unit === 'in' || unit === 'inch' || unit === 'inches' || unit === '"' ? value / 12 : value;
  return ft > 0.1 && ft < 150 ? Math.round(ft * 100) / 100 : null;
}

export function fallbackAssetMeta(req: GenerateAssetRequest): GeneratedAssetMeta & {
  orientation: 'portrait' | 'square' | 'landscape';
} {
  const description = req.description.replace(/\s+/g, ' ').trim();
  const firstClause = description.split(/[.,;:\n]/)[0].trim() || description;
  const words = firstClause.split(' ');
  let name = words.slice(0, 6).join(' ');
  if (name.length > 48) name = `${name.slice(0, 47)}…`;
  name = name.charAt(0).toUpperCase() + name.slice(1);
  const tags = [
    ...new Set(
      description
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
    ),
  ].slice(0, 8);
  const orientation =
    req.category === 'plant' || req.category === 'lighting'
      ? 'portrait'
      : req.category === 'furniture' || req.category === 'hardscape'
        ? 'landscape'
        : 'square';
  return {
    name,
    category: req.category,
    subcategory: null,
    description,
    realHeightFt: parseHeightFt(description) ?? DEFAULT_HEIGHT_FT[req.category],
    tags,
    costLowUsd: null,
    costHighUsd: null,
    orientation,
  };
}
