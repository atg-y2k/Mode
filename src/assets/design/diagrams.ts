/**
 * Every schematic diagram id referenced by an option visual
 * (`{ kind: 'diagram', diagram }`), with a one-line description of what the
 * small UI diagram should show. Ids are grouped by prefix so the UI can draw
 * whole families with one parametric component (e.g. `width-*` = a path in
 * plan view with a dimension arrow, `beam-*` = a fixture with its light cone).
 *
 * Conventions: plan = seen from above, section = cut-through side view,
 * elevation = seen from the front. Keep them monochrome line drawings with one
 * accent color so they read in light and dark mode.
 */
export const DIAGRAM_IDS = {
  // generic
  none: 'Nothing added: an empty frame with a thin diagonal strike-through.',
  'keep-existing': 'Leave as is: a simple house/surface outline with a small check mark.',

  // path shape (plan, house front door at the top, path starting at the bottom)
  'path-straight': 'Plan: a straight walk running directly from the bottom edge to the front door.',
  'path-curved': 'Plan: a walk with one gentle, wide S-curve leading to the front door.',
  'path-meander': 'Plan: a walk meandering in relaxed curves through planting before reaching the door.',
  'path-angled': 'Plan: a walk in straight segments with one or two crisp 90°/45° offsets.',
  'path-stepping-stones': 'Plan: separate stepping stones in a line set in grass, evenly spaced.',

  // path width (plan with dimension arrow; optional figure silhouettes for scale)
  'width-3ft': 'Plan: a narrow 3 ft path wide enough for one person (single file).',
  'width-4ft': 'Plan: a 4 ft path, one person with comfortable room to spare.',
  'width-5ft': 'Plan: a 5 ft path with two people walking side by side.',
  'width-6ft': 'Plan: a 6 ft path flaring into a wider landing at the steps.',

  // edges (section through path/bed edge and lawn)
  'edge-none': 'Section: paving or mulch meets the lawn directly with no border.',
  'edge-steel': 'Section: a thin dark steel strip standing on edge between lawn and bed/path.',
  'edge-brick': 'Section: bricks set in a row along the edge (soldier course or flat mowing strip).',
  'edge-cobble': 'Plan: a band of two rows of small square cobbles along the path edge.',
  'edge-stone': 'Plan: rough natural stones set end to end along the border.',
  'edge-spade': 'Section: a V-shaped hand-cut trench between lawn and mulched bed.',
  'edge-hedge': 'Elevation: a low clipped hedge running along the border.',
  'edge-plants': 'Elevation: low mounding flowering plants spilling over the edge.',

  // border lines (plan)
  'line-straight': 'Plan: straight bed lines running parallel to the house.',
  'line-curve': 'Plan: one broad, sweeping curve with a generous radius.',
  'line-geometric': 'Plan: crisp rectangles with right-angle offsets.',

  // border profile (section)
  'profile-flush': 'Section: border flush with the lawn so a mower wheel can ride on it.',
  'profile-raised': 'Section: border raised 4–8 in above the lawn like a low curb.',
  'profile-low-wall': 'Section: a low 12–24 in stone wall holding a slightly raised bed.',

  // lighting (side view: fixture + light cone / pool)
  'beam-path': 'Side view: short path lights casting round pools of light on the ground, staggered.',
  'beam-bollard': 'Side view: waist-high bollards throwing light down and outward onto the path.',
  'beam-inground': 'Side view: small flush lights set in the paving with a faint upward glow.',
  'beam-moonlight': 'Side view: downlights high in a tree casting dappled light on the ground below.',
  'beam-up': 'Side view: a ground uplight cone rising into a tree canopy or up a column.',
  'beam-down': 'Side view: a lantern or recessed fixture casting a cone of light downward.',
  'beam-wash': 'Elevation: wide, soft light washing evenly across a facade wall.',
  'beam-step': 'Section: small lights in each stair riser lighting the tread below.',
  'beam-string': 'Elevation: bulbs hanging along a gently sagging string line.',
  'beam-pendant': 'Side view: a pendant over a table casting a pool of light downward.',
  'beam-sconce': 'Elevation: a wall sconce washing light up and down the wall.',
  'beam-strip': 'Section: a linear glow under an upper cabinet lighting the counter.',
  'beam-lamp': 'Side view: a floor or table lamp with a soft glow around the shade.',
  'beam-cove': 'Section: hidden LED glow along a ceiling cove or crown.',

  // planting beds
  'bed-tiered': 'Section: bed against the house wall — tall at the back, medium middle, low front.',
  'bed-drifts': 'Plan: plants massed in drifts of 3, 5 and 7, each drift one kind.',
  'bed-formal': 'Plan: symmetrical clipped shrubs mirrored on both sides of a door.',
  'bed-naturalistic': 'Elevation: interwoven grasses and flowers like a meadow, no bare ground.',
  'depth-3ft': 'Section: a 3 ft deep bed from foundation to edge (one shrub row).',
  'depth-5ft': 'Section: a 5 ft deep bed with two layers of plants.',
  'depth-8ft': 'Section: an 8 ft deep bed with three layers and a small tree.',

  // lawn (plan)
  'lawn-panel': 'Plan: a smaller, crisply shaped lawn panel surrounded by deep planting beds.',
  'lawn-shape-free': 'Plan: lawn filling the yard, following the existing boundaries.',
  'lawn-shape-rect': 'Plan: a crisp rectangular lawn panel centered on the house.',
  'lawn-shape-curved': 'Plan: an oval / kidney lawn with smooth curved edges.',

  // trees (plan or elevation with a simple house block)
  'tree-specimen': 'Elevation: one ornamental tree off a front corner of the house.',
  'tree-corners': 'Elevation: small trees at both corners framing the facade.',
  'tree-screen': 'Plan: a staggered double row of evergreens along a property line.',
  'tree-shade': 'Elevation: a large canopy tree set well away from the house, shading the lawn.',
  'tree-allee': 'Plan: a matched row of trees lining both sides of a walk or drive.',

  // patio
  'patio-10x10': 'Plan: a 10×10 ft patio with a round table for four, chairs to scale.',
  'patio-12x14': 'Plan: a 12×14 ft patio with a dining table for six and room to pull chairs out.',
  'patio-16x20': 'Plan: a 16×20 ft patio with a dining area plus a lounge area.',
  'shape-rectangle': 'Plan: a rectangular patio aligned with the house wall.',
  'shape-curved': 'Plan: a patio with one long, softly curved outer edge.',
  'shape-circle': 'Plan: a round patio with a center point (fire pit).',
  'shape-l': 'Plan: an L-shaped patio wrapping a corner of the house.',
  'feature-seatwall': 'Elevation: a low 18–20 in seat wall around part of the patio edge.',
  'feature-kitchen': 'Elevation: an outdoor kitchen counter with a built-in grill.',

  // driveway (plan)
  'drive-plain': 'Plan: a driveway in one material with no border.',
  'drive-border': 'Plan: a driveway outlined with a contrasting cobble/paver border band.',
  'drive-apron': 'Plan: a driveway with a decorative apron where it meets the street.',
  'drive-ribbon': 'Plan: two paved wheel strips with a grass strip down the middle.',
  'drive-single': 'Plan: a single-car drive (10–12 ft wide) with one car.',
  'drive-double': 'Plan: a two-car drive (18–24 ft wide) with two cars side by side.',
  'drive-parking-pad': 'Plan: a drive with an extra side parking pad / turnaround.',

  // steps
  'steps-straight': 'Elevation: a straight run of steps the width of the walk.',
  'steps-flared': 'Plan: steps that flare wider at the bottom with rounded ends.',
  'steps-landing': 'Elevation: two short runs separated by a broad landing.',
  'steps-wraparound': 'Plan: steps wrapping around three sides of a stoop.',
  'rail-metal': 'Elevation: a slim black metal handrail with simple pickets.',
  'rail-wood': 'Elevation: a painted wood railing with square balusters and a cap rail.',
  'rail-cable': 'Elevation: a modern railing with thin horizontal cables between posts.',

  // fences (elevation)
  'fence-picket': 'Elevation: a classic pointed picket fence with gaps.',
  'fence-horizontal': 'Elevation: a modern fence of horizontal slats with narrow gaps.',
  'fence-privacy': 'Elevation: a solid board-on-board privacy fence with a top cap.',
  'fence-split-rail': 'Elevation: a rustic split-rail fence with two or three rails.',
  'fence-metal': 'Elevation: a black metal fence with slim vertical pickets and finials.',
  'fence-height-3ft': 'Elevation: a 3 ft fence next to a human figure for scale (waist high).',
  'fence-height-4ft': 'Elevation: a 4 ft fence next to a human figure for scale (chest high).',
  'fence-height-6ft': 'Elevation: a 6 ft fence next to a human figure for scale (above eye level).',

  // retaining walls (section)
  'wall-low': 'Section: a seat-height 18–24 in retaining wall.',
  'wall-mid': 'Section: a 30–36 in retaining wall holding a level terrace.',
  'wall-terraced': 'Section: two shorter walls stepping up the slope with a planted terrace between.',

  // water features (elevation)
  'water-bubbler': 'Elevation: a bubbling urn/boulder with water spilling into hidden river rock.',
  'water-wall': 'Elevation: a wall fountain spilling from a spout into a basin.',
  'water-pond': 'Plan: a small naturalistic pond with stone edges and marginal plants.',
  'water-rill': 'Plan: a narrow straight water channel (rill) running along a terrace.',
  'water-dry-creek': 'Plan: a winding dry creek bed of mixed river rock and boulders.',

  // front door (elevation)
  'door-panel': 'Elevation: a traditional six-panel door.',
  'door-craftsman': 'Elevation: a Craftsman door with three glass lites over vertical panels and a dentil shelf.',
  'door-glass': 'Elevation: a modern door with a large full-height glass panel.',
  'door-plank': 'Elevation: an arched-top plank door with iron straps.',
  'door-flush': 'Elevation: a flush slab door with a long vertical pull.',
  'surround-simple': 'Elevation: a door with a simple flat casing.',
  'surround-sidelights': 'Elevation: a door flanked by narrow glass sidelights.',
  'surround-transom': 'Elevation: a door with a rectangular transom or arched fanlight above.',
  'surround-pediment': 'Elevation: a door framed by pilasters and a triangular pediment.',

  // porch columns (elevation)
  'col-tapered': 'Elevation: Craftsman tapered square columns on stone or brick piers.',
  'col-round': 'Elevation: classical round Tuscan columns with simple caps.',
  'col-square': 'Elevation: simple square wood posts with a plain cap.',
  'col-modern': 'Elevation: slim steel or timber posts with no ornament.',
  'col-turned': 'Elevation: Victorian turned posts with corner brackets.',

  // garage doors (elevation)
  'garage-carriage': 'Elevation: carriage-house garage door with a top row of windows and strap hinges.',
  'garage-panel': 'Elevation: a garage door with rows of raised rectangular panels.',
  'garage-glass': 'Elevation: a full-view aluminum garage door with frosted glass panels.',
  'garage-flush': 'Elevation: a flush modern garage door with thin horizontal grooves.',
  'garage-plank': 'Elevation: a wood-look garage door of vertical or horizontal planks.',

  // shutters (elevation, one window)
  'shutters-louvered': 'Elevation: a window with louvered shutters each half the window width.',
  'shutters-panel': 'Elevation: a window with raised-panel shutters.',
  'shutters-board': 'Elevation: a window with board-and-batten shutters with a Z brace.',

  // paint sheen (a swatch with a highlight of increasing strength)
  'sheen-matte': 'Swatch: flat, no visible highlight (matte / honed).',
  'sheen-eggshell': 'Swatch: a faint soft highlight (eggshell).',
  'sheen-satin': 'Swatch: a soft, noticeable highlight (satin).',
  'sheen-semigloss': 'Swatch: a crisp highlight (semi-gloss).',
  'sheen-gloss': 'Swatch: a mirror-like sharp highlight (polished / gloss).',
  'sheen-textured': 'Swatch: a soft, slightly dimpled surface (leathered).',

  // wall color layouts (elevation of a wall)
  'wall-plain': 'Elevation: a room wall in one color with white trim.',
  'wall-accent': 'Elevation: one wall painted a contrasting color.',
  'wall-two-tone': 'Elevation: wall split at about one third height (wainscot) into two colors.',
  'wall-ceiling': 'Section: walls light, ceiling painted a color (the "fifth wall").',
  'wall-limewash': 'Elevation: a mottled, cloudy limewash wall texture.',
  'wall-drench': 'Elevation: walls, trim and door all one color (color drenching).',

  // ceilings (section / worm's-eye)
  'ceiling-beams': 'Section: exposed wood beams spanning the short direction of the room.',
  'ceiling-coffered': "Worm's-eye: a ceiling grid of recessed square coffers.",
  'ceiling-tray': 'Section: a recessed tray ceiling with a stepped perimeter.',

  // cabinets (elevation of one door/drawer stack)
  'cab-shaker': 'Elevation: a Shaker door with a flat recessed center panel.',
  'cab-slab': 'Elevation: a flat slab door with no frame.',
  'cab-inset': 'Elevation: an inset door set flush inside a beaded face frame.',
  'cab-raised': 'Elevation: a traditional raised-panel door.',
  'cab-fluted': 'Elevation: a door with vertical reeded/fluted grooves.',
  'cab-glass': 'Elevation: a glass-front door with a slim frame.',
  'cab-one-tone': 'Elevation: kitchen run with uppers, lowers and island all one color.',
  'cab-island-contrast': 'Elevation: kitchen run in one color with a contrasting island.',
  'cab-two-tone': 'Elevation: light upper cabinets over dark lower cabinets.',
  'cab-open-shelves': 'Elevation: lower cabinets with open floating shelves instead of uppers.',

  // furniture layouts (plan)
  'layout-conversation': 'Plan: sofa and two chairs facing each other around a coffee table.',
  'layout-focal': 'Plan: seating arranged in a U facing a fireplace or TV wall.',
  'layout-l': 'Plan: an L-shaped sectional with a coffee table and one chair.',
  'layout-float': 'Plan: furniture floated in the middle of the room on a rug, walkway behind.',
  'rug-front-legs': 'Plan: a rug under the front legs of the sofa and chairs.',
  'rug-all-legs': 'Plan: a large rug with all furniture legs on it and floor border around.',
  'rug-layered': 'Plan: a smaller patterned rug layered on a large natural-fiber rug.',

  // window treatments (elevation of one window)
  'wt-drapes': 'Elevation: full-length drapery panels on a rod, pooled just at the floor.',
  'wt-roman': 'Elevation: a fabric Roman shade folded at the top of the window.',
  'wt-woven': 'Elevation: a woven wood/bamboo shade partly lowered.',
  'wt-shutters': 'Elevation: interior plantation shutters with wide louvers.',
  'wt-layered': 'Elevation: a shade inside the frame plus drapery panels outside.',
  'mount-high-wide': 'Elevation: rod mounted near the ceiling and well past the frame (window looks larger).',
  'mount-inside': 'Elevation: a shade mounted inside the window frame showing the casing.',
  'mount-standard': 'Elevation: rod mounted just above the window frame.',

  // fireplace (elevation)
  'mantel-beam': 'Elevation: a chunky rough-hewn wood beam mantel.',
  'mantel-classic': 'Elevation: a classic painted mantel with legs and a shelf.',
  'fp-standard': 'Elevation: a fireplace surround around the firebox only.',
  'fp-full-height': 'Elevation: a surround running floor to ceiling.',
  'fp-builtins': 'Elevation: a fireplace flanked by built-in shelves on both sides.',

  // custom element: amount of change
  'change-subtle': 'Before/after pair: a small change (one element refreshed).',
  'change-moderate': 'Before/after pair: a noticeable change to a few elements.',
  'change-bold': 'Before/after pair: a dramatic transformation.',
} as const satisfies Record<string, string>;

export type DiagramId = keyof typeof DIAGRAM_IDS;

export function isDiagramId(id: string): id is DiagramId {
  return Object.prototype.hasOwnProperty.call(DIAGRAM_IDS, id);
}
