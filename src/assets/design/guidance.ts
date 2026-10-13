/**
 * Purpose and rules of thumb per design element — the practical knowledge an
 * architect / landscape architect / interior designer applies (dimensions,
 * code and safety basics, proportion) and how each choice should relate to
 * the architecture. Rules are typical US residential practice; local codes win.
 */
import type { ElementGuidance } from '../../../shared/types';

export const ELEMENT_GUIDANCE: ElementGuidance[] = [
  {
    type: 'pathway',
    purpose: 'Lead visitors clearly and comfortably from where they arrive (driveway, street, parking) to the front door, and make the entry the obvious destination.',
    rulesOfThumb: [
      'Primary entry walk 4 ft minimum; 5 ft lets two people walk side by side. Secondary/garden paths 3 ft; stepping stones 18–24 in.',
      'Start the walk where people actually arrive (usually the driveway) — people cut corners on curves that have no reason.',
      'Keep the walk at least as wide as the front steps; widen into a landing (≥ 5×5 ft) at the steps or door.',
      'Stepping stones 24–26 in on center (a natural stride), set flush with grade.',
      'Cross-slope about 2% (1/4 in per ft) for drainage; slopes over 5% need steps or a ramp.',
      'Outdoor stone must be non-slip: thermal/flamed, cleft or broom finishes — never polished.',
      'Path lights every 8–10 ft, staggered side to side, 2700–3000 K, shielded to light the ground, not eyes.',
      'Base: 4–6 in compacted gravel in mild climates, 6–8 in where the ground freezes; pea gravel 2–3 in deep with a firm edge.',
    ],
    relateToArchitecture: [
      'Symmetrical houses (Colonial, Georgian, Federal): a straight walk on the door axis, or straight from the drive with one clear turn.',
      'Pick paving that relates to the house materials — a shade lighter or darker than the brick or stone, not a near-match.',
      'Craftsman and Cottage: flagstone or brick with softened edges; Modern/MCM/Prairie: large rectangular slabs with crisp lines.',
      'Scale the walk to the facade: two-story houses and wide porches want 5–6 ft; a small cottage 4 ft.',
    ],
  },
  {
    type: 'border-edging',
    purpose: 'Define where lawn stops and beds begin — and where the yard meets the street or neighbors — so the landscape reads intentional and is easy to maintain.',
    rulesOfThumb: [
      'One clean, continuous line beats many wiggles: broad curves (radius 8–10 ft or more) or straight lines parallel to the house.',
      'Flush edges (steel, brick mowing strip) let the mower wheel ride along them — no string trimming.',
      'Steel edging 1/8–3/16 in thick with the top about 1/2 in above grade; brick mowing strips about 8 in wide, flush.',
      'Spade-cut edges need re-cutting 2–3 times a season; hard edges hold the line for decades.',
      'Hedges or walls on the front property line: keep under about 3 ft near sidewalks and driveway corners for sight lines (often code).',
      'Low seat walls 18–20 in high, 12–18 in deep.',
    ],
    relateToArchitecture: [
      'Formal houses: crisp straight lines and clipped hedges; cottage/Craftsman: soft plant edges or fieldstone; modern: steel and geometric lines.',
      'Echo a house material (brick edge with a brick house; steel edge with dark window frames).',
      'Align bed lines with architectural features — house corners, porch ends, window centers — rather than arbitrary curves.',
    ],
  },
  {
    type: 'planting-bed',
    purpose: 'Anchor the house to the ground, frame the entry and give year-round structure and seasonal interest — with plants sized and suited to the spot.',
    rulesOfThumb: [
      'Foundation beds at least 3–5 ft deep (5–8 ft for two-story houses) so shrubs reach mature width without being sheared into boxes.',
      'Plant shrubs at least half their mature width (plus 1 ft) from the wall; keep mature height below the window sills.',
      'Layer by height: tall at the back and corners, mid-height in the middle, low (≤ 18 in) in front.',
      'Group in odd numbers (3, 5, 7) and repeat the same plants along the bed for rhythm.',
      'In cold climates make about half to two thirds of a foundation bed evergreen for winter structure.',
      'Mulch 2–3 in deep, pulled a few inches back from stems and siding; never mulch volcanoes around trees.',
      'Match the plants to the sun: full sun = 6+ h of direct sun, part sun = 3–6 h, shade = under 3 h. North-facing beds are usually shade.',
      'Space plants at their mature width (center to center) so the bed fills in by year 3.',
    ],
    relateToArchitecture: [
      'Frame the entry: the strongest plants (or a matched pair) flank the door; never hide the door, steps or house numbers.',
      'Soften house corners with taller shrubs or small trees; keep low plants under windows.',
      'Symmetrical facades take mirrored, clipped planting; asymmetrical houses take balanced asymmetrical masses.',
      'Echo trim and door colors in flowers (blue/purple with a navy door, white flowers with white trim).',
    ],
  },
  {
    type: 'lawn',
    purpose: 'A calm, usable open plane that sets off the house and planting — sized to how the lawn is actually used.',
    rulesOfThumb: [
      'Give the lawn a clear shape (rectangle, oval or confident curve) — it is a positive shape, not leftover space.',
      'Cool-season grasses (tall fescue, Kentucky bluegrass, fine fescues) in zones 3–7; warm-season (Bermuda, zoysia, St. Augustine, buffalograss) in zones 7–11.',
      'Most turf needs 4–6 h of sun; under trees use fine fescue or replace it with shade groundcover.',
      'Mow high (3–4 in for cool-season grass) and leave the clippings; about 1 in of water a week in summer.',
      'Avoid strips narrower than 4–6 ft (hard to mow and water) — plant them instead.',
      'Slopes steeper than about 3:1 are safer planted than mown.',
    ],
    relateToArchitecture: [
      'A crisp lawn panel suits formal and traditional houses; meadow, gravel or groundcover suits modern, Prairie and dry-climate houses.',
      'The lawn should lead the eye to the entry, not compete with it.',
    ],
  },
  {
    type: 'trees-shrubs',
    purpose: 'Frame the house, add height and shade, and screen views — with species that fit their space at maturity and the climate.',
    rulesOfThumb: [
      'Site by mature size: small trees (≤ 25 ft) 8–10 ft from the house, medium trees 15–20 ft, large shade trees 20–30+ ft and away from sewer lines.',
      'Frame the house with trees off the front corners, seen at an angle — not dead-center in front of the door.',
      'Trees maturing above 25 ft stay 10+ ft clear of overhead lines.',
      'Screens: stagger two rows and space at about two thirds of the mature width.',
      'Plant the root flare at grade; mulch a 3 ft ring 2–3 in deep, never against the trunk.',
      'Choose for hardiness zone, sun and soil first; avoid invasives (Bradford pear, burning bush, Japanese barberry, Norway maple).',
    ],
    relateToArchitecture: [
      'Japanese maples and multi-stem small trees soften Craftsman, modern and Japanese-inspired houses; matched pairs and clipped evergreens suit formal facades.',
      'Match tree scale to the house: a one-story ranch wants small and medium trees, a two-story Colonial can carry large shade trees set well back.',
      'Columnar trees add vertical accents — avoid them against strongly horizontal Prairie and Ranch facades.',
    ],
  },
  {
    type: 'patio',
    purpose: 'An outdoor room for eating, lounging or gathering — sized for furniture plus circulation and connected to the house.',
    rulesOfThumb: [
      'Dining for 4: about 10×10 ft; for 6: about 12×14 ft (table plus 3 ft on all sides); dining + lounge: 16×20 ft or more.',
      'Slope 1/8–1/4 in per ft away from the house; finish at least 1 in below the door threshold.',
      'Keep main walkways 3–4 ft wide past the furniture; place dining within a few steps of the kitchen door.',
      'Fire pits about 10 ft from structures and overhanging branches (check local code); seating 3–4 ft from the fire.',
      'Seat walls 18–20 in high and 12–18 in deep.',
      'Use the same paving family as the walk so the property reads as one design.',
    ],
    relateToArchitecture: [
      'Traditional houses: rectilinear patios aligned with doors and windows; cottage/Craftsman: flagstone with soft edges; modern: large-format pavers or concrete.',
      'Align the patio edges or center line with the door, windows or bay it serves.',
    ],
  },
  {
    type: 'driveway',
    purpose: 'Practical parking and access that does not dominate the facade and connects clearly to the front walk.',
    rulesOfThumb: [
      'Single-car 10–12 ft wide; two-car 18–24 ft; add a 2–3 ft walk-off strip where people step out of cars.',
      'Slope at least 1% for drainage and under about 12–15% for safety.',
      'A contrasting border or apron (Belgian block, brick) breaks up a large paved area.',
      'Permeable options (gravel, permeable pavers, ribbon strips) reduce runoff; gravel needs edging and a 4–6 in compacted base.',
      'Connect the drive to the front walk with a clear paved link so guests do not cross the lawn.',
    ],
    relateToArchitecture: [
      'Keep the driveway visually quieter than the front door: neutral tones, planting to soften its edges.',
      'Belgian block and brick suit traditional houses; smooth concrete and large pavers suit modern ones; gravel suits farmhouse, cottage and Mediterranean.',
    ],
  },
  {
    type: 'steps',
    purpose: 'Safe, comfortable changes of level that announce the entry.',
    rulesOfThumb: [
      'Risers 6–7.5 in (outdoor ideally 5–6 in), treads 12–15 in (outdoor at least 12 in; garden steps 14–18 in); keep every riser in a run identical (±3/8 in).',
      'Comfort formula: 2 × riser + tread ≈ 25–27 in.',
      'Handrail on at least one side with 4 or more risers; a guard where the drop exceeds 30 in.',
      'Steps at least as wide as the door they serve, ideally as wide as the walk (4–5 ft).',
      'Landing at the door at least 36 in deep and as wide as the door; 5×5 ft is comfortable.',
      'Light every step: riser lights or side lights at 2700–3000 K.',
    ],
    relateToArchitecture: [
      'Match tread material to the walk or porch floor; risers can match the foundation (brick, stone).',
      'Flared or bullnose steps suit Georgian, Colonial and Victorian; crisp slab steps suit modern; rough stone slabs suit cottage and woodland gardens.',
    ],
  },
  {
    type: 'fence',
    purpose: 'Define the property, add privacy or enclosure where needed, and frame the garden without walling the house off from the street.',
    rulesOfThumb: [
      'Front-yard fences usually 3–4 ft (often a code limit); backyard privacy fences up to 6 ft — check local code and HOA rules.',
      'The finished side faces out toward the street and neighbors.',
      'Posts every 6–8 ft, set below frost depth.',
      'Soften long runs with planting in front; mark the entry with a gate and arbor.',
      'Pool barriers: at least 4 ft with self-closing, self-latching gates.',
    ],
    relateToArchitecture: [
      'Picket for Colonial, Cape Cod, Cottage and Victorian; split rail for farmhouse and Ranch; horizontal slat for modern and MCM; black metal for Georgian, Tudor and Spanish.',
      'White fences go with white trim on traditional houses; stained wood with modern and Craftsman; black metal recedes.',
    ],
  },
  {
    type: 'retaining-wall',
    purpose: 'Hold grade to create level, usable areas and planting terraces, and add structure on slopes.',
    rulesOfThumb: [
      'Walls over about 3–4 ft usually need engineering and a permit; terrace into two lower walls instead (tiers at least twice the lower wall height apart).',
      'Drainage is everything: gravel backfill, a perforated drain at the base, weep holes; batter the face back about 1 in per ft.',
      'Bury the first course (about 1/8 of the wall height) on a compacted gravel base.',
      'Seat-height walls (18–20 in) double as seating.',
    ],
    relateToArchitecture: [
      'Use stone that matches the foundation or chimney; fieldstone for farmhouse and cottage, cut stone for formal houses, board-formed concrete or Corten for modern.',
    ],
  },
  {
    type: 'water-feature',
    purpose: 'Sound, movement and a focal point; masks road noise and attracts birds.',
    rulesOfThumb: [
      'Place it where it is heard from a seat or window, scaled to the space (a 30 in bubbler suits a small courtyard).',
      'Recirculating features need a GFCI outlet nearby and an accessible pump.',
      'Ponds at least 18–24 in deep for fish, in part sun to limit algae; check local depth and fencing rules.',
      'Dry creek beds: mix two or three sizes of river rock with a few boulders and make them carry real runoff.',
    ],
    relateToArchitecture: [
      'Formal houses: a centered basin or wall fountain on an axis; naturalistic gardens: boulder bubblers and ponds; modern: rills, sheet water and steel basins.',
    ],
  },
  {
    type: 'outdoor-lighting',
    purpose: 'Safe navigation and a welcoming facade at night — light the path, steps and door first, then a few accents; leave some darkness.',
    rulesOfThumb: [
      'Warm white 2700–3000 K for homes; never mix color temperatures in one view.',
      'Path lights every 8–10 ft, staggered side to side, 14–24 in tall, lighting the ground — not a runway of matched pairs.',
      'Entry lanterns about 1/4–1/3 of the door height each (or 1/3 for a single fixture), centered about 66 in above the threshold.',
      'Uplight trees with 1–3 fixtures from the outer drip line; graze textured walls from 6–12 in out.',
      'Light every change of level; shield fixtures so you see the light, not the bulb (dark-sky friendly).',
      'Low-voltage LED: 3–5 W path lights and 4–8 W uplights are usually plenty.',
    ],
    relateToArchitecture: [
      'Fixture style follows the house: carriage lanterns for Colonial, mission lanterns with mica for Craftsman, minimal cylinders for modern.',
      'Light the architecture’s best features (columns, gables, stone) and the entry first.',
    ],
  },
  {
    type: 'front-door',
    purpose: 'The focal point of the facade — easy to find and saying "welcome".',
    rulesOfThumb: [
      'A saturated door color is the classic focal point; choose it after body and trim, as the accent (the 10 in 60-30-10).',
      'Standard doors are 36 × 80 in; two-story entries carry 8 ft doors; sidelights add 12–14 in each.',
      'Lanterns about 1/4–1/3 of the door height; house numbers 4–6 in tall and readable from the street.',
      'Hardware finish should match the lights and house numbers; the handleset sits about 36–38 in above the threshold.',
      'Gloss or semi-gloss paint on doors resists wear and catches the light.',
    ],
    relateToArchitecture: [
      'Colonial/Georgian/Federal: six-panel doors with pediment, transom or fanlight in red, black or deep green.',
      'Craftsman: stained wood with glass lites and a dentil shelf; Modern: flush or glass doors in a bold color or wood; Spanish/Tudor: arched plank doors with iron.',
    ],
  },
  {
    type: 'exterior-paint',
    purpose: 'Unify the house with a palette that respects the style, the fixed materials (roof, brick, stone) and the neighborhood.',
    rulesOfThumb: [
      'Start from what you cannot change — roof, brick, stone — and match their undertones (warm with warm, cool with cool).',
      'Three-part scheme: body (~60%), trim (~30%), accent/door (~10%); shutters often match the door or go one shade darker.',
      'Colors look 1–2 shades lighter outdoors in sun — pick a step deeper for the body.',
      'Light bodies make a house look larger; dark bodies recede and look crisp with light or matching trim.',
      'Satin for body and trim, semi-gloss or gloss for doors and shutters, flat for stucco and masonry.',
      'Test large swatches on two sides of the house at different times of day.',
    ],
    relateToArchitecture: [
      'Historic styles have historic palettes: Victorian polychrome, Craftsman earth tones, Colonial whites/grays/yellows with black or green shutters.',
      'Modern houses look best restrained: one body color, dark windows, natural wood accents.',
      'Painting brick is permanent; limewash is a breathable, softer alternative.',
    ],
  },
  {
    type: 'roof',
    purpose: 'The largest color field on most houses — it sets the palette and must suit the roof pitch and climate.',
    rulesOfThumb: [
      'Asphalt shingles need at least 2:12 pitch (4:12 standard); standing seam works down to about 3:12 (some systems lower); slate and tile need 4:12+ and stronger framing.',
      'Dark roofs absorb heat (avoid in hot climates); light/cool roofs cut cooling loads.',
      'Warm roofs (brown, terracotta) with warm bodies; cool roofs (gray, black) with cool or neutral bodies.',
      'Metal roofs last 40–70 years and shed snow — add snow guards over entries.',
    ],
    relateToArchitecture: [
      'Slate or cedar for Tudor, Colonial and Shingle style; clay tile for Spanish and Mediterranean; standing seam for modern farmhouse and contemporary; architectural shingles fit almost anything.',
    ],
  },
  {
    type: 'porch',
    purpose: 'A sheltered transition between street and house, sized for sitting and greeting.',
    rulesOfThumb: [
      'Usable porch depth at least 6 ft; 8 ft for rockers and seating; 10 ft feels like a room.',
      'Columns sized to the house: about 8–10 in for one story, 10–12 in for two; align posts with the beam above.',
      'Guards required where the floor is more than 30 in above grade, 36 in high for homes.',
      'Haint-blue or natural wood ceilings are traditional; paint floors with porch and floor enamel.',
    ],
    relateToArchitecture: [
      'Craftsman: tapered columns on piers; Colonial/Georgian: round Tuscan columns; Victorian: turned posts with brackets; modern farmhouse: square posts and black metal; contemporary: slim steel.',
    ],
  },
  {
    type: 'garage-door',
    purpose: 'Make a large, unavoidable element recede (or harmonize) so the front door stays the focal point.',
    rulesOfThumb: [
      'Usually paint the garage door the body color (or the trim color) so it recedes.',
      'Singles are 8–9 ft wide, doubles 16 ft; 7–8 ft tall.',
      'Windows in the top row only, aligned with the house windows where possible.',
      'Carriage hardware should match the exterior light finishes.',
    ],
    relateToArchitecture: [
      'Carriage-house doors for farmhouse, Craftsman and Colonial; flush or full-view glass for modern and MCM; raised panel for traditional.',
    ],
  },
  {
    type: 'windows-shutters',
    purpose: 'Windows give the facade its rhythm; shutters and trim should reinforce, not fake, its proportions.',
    rulesOfThumb: [
      'Each shutter is half the window width and the full window height — they should look like they could close.',
      'Hang them on hinges with shutter dogs where possible; louvers point up when open (they shed rain).',
      'Skip shutters on picture windows, wide paired windows and most modern houses.',
      'Window boxes about the window width, 8–10 in deep, with plants about a third of the window height.',
      'Black or bronze frames read modern; white sash reads traditional.',
    ],
    relateToArchitecture: [
      'Louvered shutters for Colonial, Cape Cod and Federal; panel shutters for Georgian; board-and-batten for farmhouse, cottage and Tudor; none for Craftsman, MCM, Prairie and modern.',
    ],
  },
  {
    type: 'outdoor-furniture',
    purpose: 'Make outdoor rooms usable — seating that fits the space, with circulation and shade.',
    rulesOfThumb: [
      'Allow 3 ft around a dining table to pull out chairs and 30 in for walkways.',
      'Conversation seating within 8–10 ft across.',
      'Weather-appropriate materials: teak, powder-coated aluminum, all-weather wicker, solution-dyed fabrics.',
      'Furniture should fill no more than about two thirds of the patio.',
    ],
    relateToArchitecture: [
      'Teak and black metal are near-universal; rockers and Adirondacks suit farmhouse, cottage and coastal; slim metal and concrete suit modern.',
    ],
  },
  {
    type: 'wall-paint',
    purpose: 'Set the mood and light of the room and tie together fixed elements (floors, counters, fabrics).',
    rulesOfThumb: [
      '60-30-10: about 60% dominant color (walls), 30% secondary (furniture, cabinets, textiles), 10% accent.',
      'North-facing rooms get cool light — choose warm whites and neutrals; south-facing rooms handle cooler colors.',
      'LRV 60–80 for bright rooms; below about 20 reads dark and moody — great for studies, dining and powder rooms.',
      'Matte/eggshell for living areas and bedrooms; satin for kitchens, baths and kids; semi-gloss for trim and doors.',
      'Ceilings white or the wall color lightened 25–50%; color-drenching (walls, trim, ceiling one color) for an enveloping look.',
      'Test 2×2 ft samples on two walls and look at them in morning and evening light.',
    ],
    relateToArchitecture: [
      'Pull colors from the fixed materials (floor tone, stone, brick) and keep connected rooms in one related family.',
      'Traditional rooms: lighter walls with crisp white trim; modern rooms: color-drenched or white with black accents.',
    ],
  },
  {
    type: 'flooring',
    purpose: 'A continuous, durable base that unifies the floor plan and suits how each room is used.',
    rulesOfThumb: [
      'Keep one flooring through connected living areas; change material at thresholds (baths, mudrooms), not mid-room.',
      'Run planks parallel to the longest wall or the main line of sight.',
      'Wide planks (7–9 in) suit large rooms; narrow strip (2¼–3¼ in) suits older houses.',
      'Herringbone and chevron add pattern — limit to one room or zone per floor.',
      'Large-format tile (24×24, 12×24 in) shows fewer grout lines; offset 12×24 tiles by no more than a third.',
      'Kitchens, baths and basements: porcelain or waterproof LVP rather than solid wood.',
    ],
    relateToArchitecture: [
      'Older homes: oak strip, heart pine, hex or penny tile in baths; MCM: terrazzo, cork, walnut; modern: concrete, large-format porcelain, wide white oak.',
    ],
  },
  {
    type: 'ceiling',
    purpose: 'The fifth wall: brighten, warm up, or add architecture overhead.',
    rulesOfThumb: [
      'Beams only where they would make structural sense: spanning the short direction, evenly spaced 4–8 ft.',
      'Under 8 ft: keep the ceiling light or matched to the walls and skip heavy beams.',
      'Coffers and trays need at least 9 ft ceilings.',
      'Wood plank ceilings warm large rooms; keep the tone lighter than the floor.',
    ],
    relateToArchitecture: [
      'Beams for farmhouse, Craftsman, Spanish and Tudor; coffers for traditional and Georgian; tongue-and-groove for coastal and cottage; flat white for modern.',
    ],
  },
  {
    type: 'interior-lighting',
    purpose: 'Layered light: ambient for the room, task where you work, accent for mood and art.',
    rulesOfThumb: [
      'Layer ambient + task + accent; every room needs at least three light sources at different heights.',
      '2700–3000 K in living spaces and bedrooms; 3000–3500 K in kitchens, baths and work areas; CRI 90+.',
      'Chandelier diameter in inches ≈ room length + width in feet; over a table 1/2–2/3 of the table width, bottom 30–36 in above the top.',
      'Island pendants 30–36 in above the counter, 24–30 in apart, about 6 in in from the ends.',
      'Recessed lights about every 4–6 ft (spacing ≈ ceiling height ÷ 2), 2–3 ft from the walls.',
      'Sconces about 60–66 in to center; vanity sconces at eye level beside the mirror.',
      'Put everything on dimmers.',
    ],
    relateToArchitecture: [
      'Fixture style and metal follow the room’s style; mix no more than two metal finishes.',
      'Respect low ceilings with flush mounts; use tall rooms for statement pendants.',
    ],
  },
  {
    type: 'cabinets',
    purpose: 'Storage that defines the kitchen’s look; door style and color set the architecture of the room.',
    rulesOfThumb: [
      'Shaker is the most versatile; slab for modern; inset for traditional and high-end.',
      'Pulls about a third of the drawer width (3–5 in on narrow drawers, 8–12 in on wide); knobs on doors 2.5–3 in from the corner.',
      'Counter height 36 in; uppers start 18 in above the counter; 42–48 in clear around an island.',
      'Two-tone: darker lowers or island, lighter uppers keep the room bright.',
      'Run uppers to the ceiling (or finish with crown) to avoid a dusty gap.',
    ],
    relateToArchitecture: [
      'Beaded inset or raised panel for Colonial and Victorian; Shaker for farmhouse and transitional; slab or reeded wood for MCM, modern and Japandi.',
    ],
  },
  {
    type: 'countertops',
    purpose: 'A durable work surface that ties cabinets, backsplash and floor together.',
    rulesOfThumb: [
      'Quartz for low maintenance; marble etches and patinas; soapstone darkens with oil; butcher block needs oiling.',
      'Standard depth 25.5 in, 1¼ in (3 cm) thick; seating overhang 12–15 in with 24 in per stool.',
      'Let one surface star: a busy counter wants a calm backsplash and vice versa.',
      'Honed and leathered finishes hide scratches and fingerprints.',
    ],
    relateToArchitecture: [
      'Marble and soapstone for traditional and farmhouse; quartz for transitional; concrete and terrazzo for modern and MCM; butcher block for cottage and farmhouse.',
    ],
  },
  {
    type: 'backsplash',
    purpose: 'Protect the wall and add pattern or texture between counters and cabinets.',
    rulesOfThumb: [
      'Run to the underside of the uppers; go full height behind a range or open shelves.',
      'Stop at a natural edge (cabinet side, window casing) — never mid-wall.',
      'Matching grout calms; contrasting grout emphasizes the pattern.',
      'Small busy tiles can overwhelm small kitchens; larger tiles or slab read calm.',
    ],
    relateToArchitecture: [
      'Subway and zellige for farmhouse and cottage; marble hex or herringbone for traditional; vertical stack or slab for modern; handmade tile for Spanish.',
    ],
  },
  {
    type: 'furniture',
    purpose: 'Arrange for conversation and circulation, scaled to the room.',
    rulesOfThumb: [
      'Main walkways 30–36 in; 16–18 in between the sofa and coffee table.',
      'Coffee table about two thirds of the sofa length.',
      'Seating within 8–10 ft for conversation.',
      'Rugs: front legs of all seating on the rug (8×10 ft in most living rooms, 9×12 ft in large ones) with 12–18 in of floor showing at the walls; dining rugs extend 24 in beyond the table on all sides.',
      'Float furniture off the walls in larger rooms and anchor the group with a rug.',
      'Mix scales: one large piece, medium chairs, small side tables.',
    ],
    relateToArchitecture: [
      'Let the architecture lead: Mid-century houses with leggy MCM pieces, traditional rooms with classic upholstery, lofts with industrial pieces.',
    ],
  },
  {
    type: 'window-treatments',
    purpose: 'Control light and privacy while making windows look larger and softening the room.',
    rulesOfThumb: [
      'Hang rods high and wide: 4–6 in below the ceiling (or halfway between window and ceiling) and 8–12 in past the frame.',
      'Panels just kiss the floor; fullness 2–2.5× the window width.',
      'Inside-mount shades show off good casings; outside mounts make windows look bigger.',
      'Layer sheers or woven shades with lined drapes for privacy and blackout in bedrooms.',
    ],
    relateToArchitecture: [
      'Plantation shutters suit traditional and Southern houses; woven shades suit coastal and Japandi; tailored Roman shades suit traditional and transitional rooms.',
    ],
  },
  {
    type: 'decor',
    purpose: 'Art, mirrors, plants, textiles and objects that complete the palette and add personality.',
    rulesOfThumb: [
      'Hang art with its center at 57–60 in; over a sofa, 8–10 in above the back and about two thirds of the sofa width.',
      'Group objects in odd numbers with varied heights; repeat each accent color at least three times in a room.',
      'Pillows: mix one pattern, one texture and one solid.',
      'Place mirrors to reflect a window and bounce light.',
      'Match plants to light: fiddle-leaf figs need bright indirect light; snake plants and pothos tolerate low light.',
    ],
    relateToArchitecture: [
      'Scale decor to the room: a few large pieces in big rooms, fewer and smaller in small ones.',
    ],
  },
  {
    type: 'fireplace',
    purpose: 'A natural focal point — the surround and mantel should be scaled to the wall and the room’s style.',
    rulesOfThumb: [
      'Combustible mantels at least 12 in above the firebox opening (more for deeper mantels); noncombustible hearth about 16–20 in deep — check local code.',
      'Mantel height typically 54–60 in; floor-to-ceiling surrounds suit tall rooms.',
      'A TV over the mantel is usually too high — prefer another wall or a recessed niche.',
      'Built-ins flanking the fireplace balance the wall.',
    ],
    relateToArchitecture: [
      'Beam mantels for farmhouse and rustic; classic painted mantels for Colonial and Georgian; plaster for Spanish and warm minimal; slab or no mantel for modern.',
    ],
  },
  {
    type: 'custom',
    purpose: 'Anything the other elements do not cover — described in your own words, still respecting the architecture and scale.',
    rulesOfThumb: [
      'Describe size, material, color and where it goes.',
      'Say what must stay unchanged.',
      'One idea per custom element gives the clearest results.',
    ],
    relateToArchitecture: ['Keep proportions and materials consistent with the house’s style and era.'],
  },
];
