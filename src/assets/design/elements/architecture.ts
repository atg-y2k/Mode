/** House elements: front door, exterior paint & siding, roof, porch, garage door, windows & shutters, fence. */
import { color, colors, decorArt, diagram, tex } from '../visuals';
import { noneOption, type ElementInput } from './build';

/** Mid greige so siding textures show their shadow lines; color comes from the paint scheme. */
const SIDING_NEUTRAL = ['#c9c3b6', '#c3bdb0', '#cfc9bc'];
const CEDAR = ['#a8744b', '#9a6a43', '#b58053', '#8e623e'];

export const FRONT_DOOR: ElementInput = {
  type: 'front-door',
  label: 'Front door',
  description: 'The focal point of the facade: color, style, surround and hardware.',
  icon: 'DoorOpen',
  setting: 'exterior',
  zoneKinds: ['front-door'],
  dimensions: [
    {
      id: 'color',
      label: 'Door color',
      question: 'What color should the door be?',
      defaultOptionId: 'black',
      options: [
        { id: 'black', label: 'Classic black', description: 'High-gloss, formal', promptText: 'painted classic black in a high-gloss finish', visual: color('#1c1c1e'), rationale: 'Formal and timeless — Georgian, Colonial, Tudor, Modern Farmhouse; elegant against white, red brick or gray.' },
        { id: 'red', label: 'Colonial red', description: 'Deep oxblood red', promptText: 'painted a deep colonial oxblood red in gloss', visual: color('#8b2323'), rationale: 'The historic welcome color for Colonial, Cape Cod and Farmhouse; with white or gray siding and black shutters.' },
        { id: 'navy', label: 'Deep navy', description: 'Crisp and coastal', promptText: 'painted a deep navy blue in gloss', visual: color('#1f2e45'), rationale: 'Crisp with white and gray houses — coastal, Colonial, Shingle style; lovely with brass hardware.' },
        { id: 'green', label: 'Heritage green', description: 'Dark, rich green', promptText: 'painted a dark heritage green (almost black-green) in gloss', visual: color('#1f3a2e'), rationale: 'Sober and rich on Georgian, Tudor, Victorian and red-brick houses.' },
        { id: 'ochre', label: 'Ochre yellow', description: 'Cheerful mid-century accent', promptText: 'painted a warm ochre / marigold yellow in gloss', visual: color('#c9962e'), rationale: 'A happy accent for Mid-century, Ranch and Cottage houses against gray, charcoal or white.' },
        {
          id: 'stained-wood',
          label: 'Stained wood',
          description: 'Warm natural wood',
          promptText: 'natural stained wood (warm medium-brown oak or mahogany) with a satin finish',
          visual: tex('wood-planks', ['#8a5a34', '#7a4e2c', '#96663e', '#6e4527'], 5, 80),
          rationale: 'Warm and crafted — Craftsman, Contemporary, Mediterranean, Spanish and Prairie houses.',
        },
      ],
    },
    {
      id: 'style',
      label: 'Door style',
      question: 'What style of door?',
      defaultOptionId: 'keep-style',
      options: [
        { id: 'keep-style', label: 'Keep current', description: 'Same door, new finish', promptText: 'keeping the existing door style', visual: diagram('keep-existing'), rationale: 'Paint and hardware alone change the whole entry.' },
        { id: 'door-panel', label: 'Six-panel', description: 'Traditional raised panels', promptText: 'a traditional six-panel door', visual: diagram('door-panel'), rationale: 'Correct for Colonial, Georgian, Federal and Cape Cod houses.' },
        { id: 'door-craftsman', label: 'Craftsman', description: 'Glass lites over panels, dentil shelf', promptText: 'a Craftsman door with three glass lites over vertical panels and a dentil shelf', visual: diagram('door-craftsman'), rationale: 'Made for bungalows and Craftsman houses.' },
        { id: 'door-glass', label: 'Modern glass', description: 'Large glass panel', promptText: 'a modern door with a tall full-height glass panel in a slim frame', visual: diagram('door-glass'), rationale: 'Brings light into the hall; Contemporary, Mid-century, Modern Farmhouse.' },
        { id: 'door-plank', label: 'Arched plank', description: 'Wood planks, iron straps', promptText: 'an arched-top wood plank door with black iron strap hinges', visual: diagram('door-plank'), rationale: 'Storybook and old-world — Tudor, Spanish, Mediterranean, Cottage.' },
        { id: 'door-flush', label: 'Flush modern', description: 'Slab with a long pull', promptText: 'a flush slab door with a long vertical pull handle', visual: diagram('door-flush'), rationale: 'Minimal and graphic for Contemporary and Mid-century houses.' },
      ],
    },
    {
      id: 'surround',
      label: 'Surround',
      question: 'How should the door be framed?',
      defaultOptionId: 'surround-simple',
      options: [
        { id: 'surround-simple', label: 'Simple casing', description: 'Flat trim', promptText: 'framed by simple flat casing trim', visual: diagram('surround-simple'), rationale: 'Quiet and versatile.' },
        { id: 'surround-sidelights', label: 'Sidelights', description: 'Narrow glass each side', promptText: 'flanked by narrow glass sidelights', visual: diagram('surround-sidelights'), rationale: 'Widens the entry and adds light; in scale with larger facades.' },
        { id: 'surround-transom', label: 'Transom / fanlight', description: 'Glass above the door', promptText: 'with a transom window (or arched fanlight) above the door', visual: diagram('surround-transom'), rationale: 'Adds height; the fanlight is a Federal and Georgian signature.' },
        { id: 'surround-pediment', label: 'Pediment & pilasters', description: 'Classical frame', promptText: 'framed by flat pilasters and a classical triangular pediment', visual: diagram('surround-pediment'), rationale: 'Gives a plain Colonial facade a proper focal point.' },
      ],
    },
    {
      id: 'hardware',
      label: 'Hardware',
      question: 'What finish for the handle, knocker and house numbers?',
      defaultOptionId: 'matte-black',
      options: [
        { id: 'matte-black', label: 'Matte black', description: 'Modern and versatile', promptText: 'matte black handleset and house numbers', visual: color('#1e1e1e'), rationale: 'Works on any color but black (choose brass there).' },
        { id: 'brass', label: 'Unlacquered brass', description: 'Warm, ages to a patina', promptText: 'unlacquered brass handleset, knocker and house numbers', visual: color('#b5893b'), rationale: 'Classic on black, navy and green doors — Georgian, Colonial, Federal.' },
        { id: 'nickel', label: 'Satin nickel', description: 'Cool and quiet', promptText: 'satin nickel handleset and house numbers', visual: color('#a9aaa6'), rationale: 'Low-key with gray and white schemes.' },
        { id: 'bronze', label: 'Oil-rubbed bronze', description: 'Dark warm brown', promptText: 'oil-rubbed bronze handleset and house numbers', visual: color('#3e2f25'), rationale: 'Craftsman, Tudor and Spanish houses and stained wood doors.' },
      ],
    },
  ],
};

export const EXTERIOR_PAINT: ElementInput = {
  type: 'exterior-paint',
  label: 'Exterior paint',
  description: 'Body, trim and accent colors for the house — or new siding.',
  icon: 'PaintRoller',
  setting: 'exterior',
  zoneKinds: ['facade', 'trim'],
  dimensions: [
    {
      id: 'scheme',
      label: 'Color scheme',
      question: 'Which color scheme (body · trim · accent)?',
      defaultOptionId: 'classic-white',
      options: [
        { id: 'classic-white', label: 'Classic white', description: 'Warm white, white trim, black accents', promptText: 'warm white body, crisp white trim, black shutters and door', visual: colors('#f2f0ea', '#f7f6f2', '#1f2022'), rationale: 'The Colonial and farmhouse standard; makes a house look larger and fresh.' },
        { id: 'greige-modern', label: 'Soft greige', description: 'Greige body, white trim, charcoal', promptText: 'soft greige body, white trim and charcoal accents', visual: colors('#bdb6a8', '#f3f1ea', '#2b2c2e'), rationale: 'Warm and current; flattering with stone and both warm and cool roofs.' },
        { id: 'charcoal-cedar', label: 'Charcoal & cedar', description: 'Dark body and trim, wood accents', promptText: 'deep charcoal body and trim with natural cedar accents', visual: colors('#3a3c3e', '#3a3c3e', '#a9774f'), rationale: 'Crisp and modern — Contemporary, Modern Farmhouse, Mid-century; looks best with warm wood and lush green.' },
        { id: 'sage-cream', label: 'Sage & cream', description: 'Sage body, cream trim, brown-red door', promptText: 'muted sage-green body, cream trim and a deep brown-red door', visual: colors('#8a9479', '#ece5d3', '#5b3a2a'), rationale: 'Earthy and historic-feeling — Craftsman, Cottage, Victorian.' },
        { id: 'navy-white', label: 'Navy & white', description: 'Deep navy body, white trim', promptText: 'deep navy body, bright white trim and an ochre-gold door', visual: colors('#2e3d52', '#f4f2ec', '#c9a04b'), rationale: 'Bold and coastal — Cape Cod, Colonial and Shingle houses.' },
        { id: 'historic-earth', label: 'Historic earth', description: 'Olive body, cream trim, oxblood', promptText: 'earthy olive-brown body, cream trim and oxblood accents', visual: colors('#6e6a4e', '#d9ccae', '#7a2e26'), rationale: 'Period-correct for Craftsman bungalows and late-Victorian houses.' },
      ],
    },
    {
      id: 'trim',
      label: 'Trim contrast',
      question: 'How should the trim relate to the body?',
      defaultOptionId: 'trim-light',
      options: [
        { id: 'trim-light', label: 'Lighter trim', description: 'White or cream trim', promptText: 'trim, fascia and window casings painted lighter than the body (white or cream)', visual: colors('#8a9479', '#f4f1ea'), rationale: 'Traditional and crisp; outlines the architecture.' },
        { id: 'trim-match', label: 'Tone-on-tone', description: 'Trim matches the body', promptText: 'trim painted the same color as the body for a seamless tone-on-tone look', visual: colors('#8a9479', '#8a9479'), rationale: 'Modern and calming; hides awkward trim and gutters.' },
        { id: 'trim-dark', label: 'Dark trim', description: 'Black or charcoal trim and windows', promptText: 'trim and window frames painted black or deep charcoal', visual: colors('#f2f0ea', '#1f2022'), rationale: 'Graphic modern-farmhouse contrast against a light body.' },
      ],
    },
    {
      id: 'siding',
      label: 'Siding',
      question: 'Keep the siding or change it?',
      defaultOptionId: 'keep-siding',
      options: [
        { id: 'keep-siding', label: 'Keep & paint', description: 'Existing siding, new color', promptText: 'keeping the existing siding, repainted', visual: diagram('keep-existing'), rationale: 'Paint transforms a house at a fraction of the cost.' },
        { id: 'lap', label: 'Lap siding', description: '7 in horizontal boards', promptText: 'new horizontal lap siding with a 7 in exposure', visual: tex('lap-siding', SIDING_NEUTRAL, 96, 7), rationale: 'The traditional American cladding — Colonial, Cape Cod, Farmhouse, Craftsman.' },
        { id: 'board-batten', label: 'Board & batten', description: 'Vertical boards, 12 in battens', promptText: 'vertical board-and-batten siding with battens 12 in on center', visual: tex('board-batten', SIDING_NEUTRAL, 12, 96), rationale: 'Adds height and farmhouse character; great for gables or the whole house.' },
        { id: 'shingles', label: 'Cedar shingles', description: 'Natural or painted shakes', promptText: 'cedar shingle siding with a 7 in exposure', visual: tex('shingle-siding', ['#9a8a74', '#8c7b67', '#a69680', '#7f705d'], 6, 7), rationale: 'Texture and coastal charm — Cape Cod, Shingle style, Craftsman gables.' },
        { id: 'stucco', label: 'Smooth stucco', description: 'Seamless plaster finish', promptText: 'smooth sand-finish stucco', visual: tex('stucco', ['#e6dfd3', '#ddd5c8', '#ebe5da'], 6, 6), rationale: 'Spanish, Mediterranean, Tudor and modern houses.' },
        { id: 'stone-accent', label: 'Stone accent', description: 'Stone wainscot / base', promptText: 'a natural stone veneer wainscot along the lower third of the facade', visual: tex('stone-veneer', ['#8a8176', '#9a9083', '#6f685f', '#a99e8f'], 12, 6), rationale: 'Grounds the house visually; keep it to logical places (base, chimney, porch piers).' },
      ],
    },
    {
      id: 'masonry',
      label: 'Brick / stone',
      question: 'If there is brick or stone, what happens to it?',
      defaultOptionId: 'masonry-keep',
      options: [
        { id: 'masonry-keep', label: 'Leave natural', description: 'Keep the brick as is', promptText: 'existing brick or stone left natural', visual: colors('#8e4632', '#9c5038', '#7f3e2d'), rationale: 'Natural masonry is a fixed asset — design the paint colors around its undertones.' },
        { id: 'masonry-paint', label: 'Paint it', description: 'Solid painted brick', promptText: 'existing brick painted in the body color with a masonry paint', visual: colors('#f1efe8', '#e6e2d8', '#ece9e1'), rationale: 'Unifies mismatched brick; permanent and needs repainting every 10–15 years.' },
        { id: 'masonry-limewash', label: 'Limewash', description: 'Soft, breathable, old-world', promptText: 'existing brick finished with a soft white limewash, some brick color showing through', visual: colors('#d9cfc0', '#b88a70', '#e8e1d4'), rationale: 'Breathable and aged-looking; brick tones peek through — suits Tudor, farmhouse and European looks.' },
      ],
    },
  ],
};

export const ROOF: ElementInput = {
  type: 'roof',
  label: 'Roof',
  description: 'Roofing material and color — the largest color field on most houses.',
  icon: 'House',
  setting: 'exterior',
  zoneKinds: ['roof'],
  dimensions: [
    {
      id: 'material',
      label: 'Material',
      question: 'What roofing material?',
      defaultOptionId: 'architectural-shingle',
      options: [
        { id: 'architectural-shingle', label: 'Architectural shingles', description: 'Dimensional asphalt', promptText: 'dimensional architectural asphalt shingles', visual: tex('roof-shingles', ['#3a3b3d', '#444547', '#333436', '#4c4d4f'], 12, 5.625), rationale: 'Fits nearly any house and budget; 25–30 year life.' },
        { id: 'standing-seam', label: 'Standing-seam metal', description: '16 in panels, slim seams', promptText: 'a standing-seam metal roof with 16 in panels and slim raised seams', visual: tex('standing-seam', ['#2f3133', '#36383a', '#2b2d2f'], 16, 120), rationale: 'Modern farmhouse, contemporary and porch accents; 40–70 year life and sheds snow.' },
        { id: 'cedar-shake', label: 'Cedar shakes', description: 'Weathering warm brown-gray', promptText: 'hand-split cedar shakes with about a 10 in exposure, weathering to warm brown-gray', visual: tex('shingle-siding', ['#8a6a4e', '#7a5d44', '#957457', '#6e543e'], 7, 10), rationale: 'Rich texture for Cape Cod, Shingle, Tudor and Craftsman houses; check fire codes.' },
        { id: 'slate', label: 'Slate', description: 'Blue-gray natural slate', promptText: 'natural blue-gray slate shingles (12×20 in)', visual: tex('roof-shingles', ['#4e5459', '#5a6065', '#454b50', '#626468'], 12, 8.5), rationale: 'The century roof for Tudor, Georgian, Colonial and Gothic houses; heavy — needs strong framing.' },
        { id: 'clay-tile', label: 'Clay tile', description: 'Terracotta barrel tile', promptText: 'terracotta clay barrel (mission) tile', visual: tex('roof-shingles', ['#b5643c', '#a85a35', '#c2703f', '#9c4e2e'], 9, 12), rationale: 'Essential to Spanish, Mission and Mediterranean houses; 4:12 pitch or steeper.' },
      ],
    },
    {
      id: 'color',
      label: 'Roof color',
      question: 'What roof color?',
      defaultOptionId: 'charcoal',
      options: [
        { id: 'charcoal', label: 'Charcoal / black', description: 'Crisp, goes with most', promptText: 'in charcoal black', visual: color('#2f3133'), rationale: 'Pairs with white, gray, navy and most bodies; absorbs heat in hot climates.' },
        { id: 'weathered-wood', label: 'Weathered wood', description: 'Mixed brown-gray', promptText: 'in a weathered-wood brown-gray blend', visual: color('#5a4a3c'), rationale: 'Warm bodies, brick and Craftsman palettes.' },
        { id: 'slate-gray', label: 'Slate gray', description: 'Cool mid gray', promptText: 'in a cool slate gray', visual: color('#5e6468'), rationale: 'Softer than black; good with blue, gray and white houses.' },
        { id: 'dark-bronze', label: 'Dark bronze', description: 'Warm near-black', promptText: 'in dark bronze', visual: color('#3b3530'), rationale: 'Warm modern; ties to bronze windows and fixtures.' },
        { id: 'galvalume', label: 'Natural metal', description: 'Silver galvalume', promptText: 'in natural silver galvalume metal', visual: color('#a7aaaa'), rationale: 'Reflective cool roof for farmhouses and hot climates.' },
        { id: 'terracotta', label: 'Terracotta', description: 'Warm clay red', promptText: 'in warm terracotta red', visual: color('#b0603a'), rationale: 'Spanish and Mediterranean houses with cream or white stucco.' },
      ],
    },
  ],
};

export const PORCH: ElementInput = {
  type: 'porch',
  label: 'Porch',
  description: 'Columns, ceiling, floor, railing and furnishings of the front porch.',
  icon: 'Landmark',
  setting: 'exterior',
  zoneKinds: ['porch', 'columns'],
  dimensions: [
    {
      id: 'columns',
      label: 'Columns',
      question: 'What kind of columns?',
      defaultOptionId: 'col-square',
      options: [
        { id: 'col-tapered', label: 'Tapered on piers', description: 'Craftsman', promptText: 'Craftsman tapered square columns on stone or brick piers', visual: diagram('col-tapered'), rationale: 'Signature of Craftsman bungalows.' },
        { id: 'col-round', label: 'Round Tuscan', description: 'Classical', promptText: 'round classical Tuscan columns, 10 in diameter', visual: diagram('col-round'), rationale: 'Colonial Revival, Georgian and Greek Revival porches.' },
        { id: 'col-square', label: 'Square posts', description: 'Simple and sturdy', promptText: 'simple square wood posts (8×8 in) with plain caps', visual: diagram('col-square'), rationale: 'Farmhouse, Cape Cod and transitional houses.' },
        { id: 'col-modern', label: 'Slim modern', description: 'Steel or timber posts', promptText: 'slim black steel or timber posts with no ornament', visual: diagram('col-modern'), rationale: 'Contemporary and Mid-century; keep them in proportion to the roof they carry.' },
        { id: 'col-turned', label: 'Turned posts', description: 'Victorian with brackets', promptText: 'Victorian turned posts with decorative corner brackets', visual: diagram('col-turned'), rationale: 'Queen Anne and folk Victorian porches.' },
      ],
    },
    {
      id: 'ceiling',
      label: 'Ceiling',
      question: 'What on the porch ceiling?',
      defaultOptionId: 'haint-blue',
      options: [
        { id: 'haint-blue', label: 'Haint blue', description: 'Pale blue-green paint', promptText: 'a porch ceiling painted soft haint blue', visual: color('#a9c9c8'), rationale: 'Southern tradition that brightens the porch and reads like sky.' },
        { id: 'wood-ceiling', label: 'Natural wood', description: 'Tongue-and-groove, stained', promptText: 'a stained natural tongue-and-groove wood porch ceiling', visual: tex('wood-planks', ['#b98e62', '#ad8357', '#c49a6d'], 3.5, 96), rationale: 'Warmth overhead — Craftsman, modern farmhouse, cottage.' },
        { id: 'white-beadboard', label: 'White beadboard', description: 'Crisp painted boards', promptText: 'a white painted beadboard porch ceiling', visual: tex('shiplap', ['#f2f0ea', '#eeebe4', '#f5f3ee'], 96, 3.5), rationale: 'Clean and classic on Colonial, Victorian and coastal houses.' },
      ],
    },
    {
      id: 'floor',
      label: 'Floor',
      question: 'What porch floor?',
      defaultOptionId: 'painted-boards',
      options: [
        { id: 'painted-boards', label: 'Painted gray boards', description: 'Porch & floor enamel', promptText: 'tongue-and-groove porch floorboards painted soft gray', visual: tex('deck-boards', ['#8f9396', '#868a8d', '#979b9e'], 3.5, 96, { joint: { color: '#5e6266', widthIn: 0.0625 } }), rationale: 'The traditional porch floor for farmhouse, Victorian and Colonial houses.' },
        { id: 'stained-boards', label: 'Stained wood', description: 'Warm natural decking', promptText: 'warm stained wood porch floorboards', visual: tex('deck-boards', ['#8a6a4e', '#7e5f45', '#96755a', '#735740'], 5.5, 96), rationale: 'Warm and relaxed — Craftsman and cottage.' },
        { id: 'bluestone-floor', label: 'Bluestone', description: 'Cut stone floor', promptText: 'a cut bluestone porch floor', visual: tex('stone-pavers', ['#5f6c75', '#6c7880', '#56626a', '#7a8187'], 18, 18), rationale: 'Durable and formal; ties into stone walks.' },
        { id: 'brick-floor', label: 'Brick', description: 'Herringbone brick', promptText: 'a red brick porch floor in herringbone', visual: tex('herringbone', ['#8e4632', '#9c5038', '#7f3e2d', '#a35b42'], 4, 8, { joint: { color: '#b5aa98', widthIn: 0.25 } }), rationale: 'Georgian, Colonial and Tudor entries.' },
      ],
    },
    {
      id: 'railing',
      label: 'Railing',
      question: 'What railing?',
      defaultOptionId: 'rail-wood',
      options: [
        noneOption('rail-none', 'No railing', 'Open low porch', 'with no railing (porch floor under 30 in high)', 'Only where the floor is less than 30 in above grade.'),
        { id: 'rail-wood', label: 'Painted wood', description: 'Square balusters', promptText: 'a painted wood railing with square balusters and a flat cap rail', visual: diagram('rail-wood'), rationale: 'Classic porch railing for most traditional houses.' },
        { id: 'rail-metal', label: 'Black metal', description: 'Slim pickets', promptText: 'a slim black metal railing with simple pickets', visual: diagram('rail-metal'), rationale: 'Lighter visually; modern farmhouse and transitional.' },
        { id: 'rail-cable', label: 'Cable', description: 'Horizontal cables', promptText: 'a modern cable railing with slim posts', visual: diagram('rail-cable'), rationale: 'Keeps views open on modern and coastal houses.' },
      ],
    },
    {
      id: 'furnishing',
      label: 'Furnishing',
      question: 'Dress the porch with…',
      multiple: true,
      options: [
        { id: 'rockers', label: 'Rocking chairs', description: 'A pair of rockers', promptText: 'a pair of classic rocking chairs with a small side table', visual: decorArt('outdoor-chair', '#f2f0ea'), rationale: 'Instant welcome; needs 8 ft of porch depth to rock comfortably.' },
        { id: 'swing', label: 'Porch swing', description: 'Hanging bench swing', promptText: 'a hanging wood porch swing at one end', visual: decorArt('bench', '#8a6a4a'), rationale: 'Farmhouse and Southern charm; hang from a joist rated for the load.' },
        { id: 'potted-pair', label: 'Planters by the door', description: 'Matching pair flanking the door', promptText: 'a matching pair of large planters flanking the front door', visual: decorArt('planter-round', '#2b2c2e'), rationale: 'Symmetry that frames the entry; scale pots to about a third of the door height.' },
        { id: 'outdoor-rug', label: 'Outdoor rug', description: 'Defines the seating spot', promptText: 'a flat-woven outdoor rug under the seating', visual: decorArt('rug', '#c9b79c', '#2b3a55'), rationale: 'Makes the porch feel like a room.' },
      ],
    },
  ],
};

export const GARAGE_DOOR: ElementInput = {
  type: 'garage-door',
  label: 'Garage door',
  description: 'Style and color of the garage door — usually it should recede.',
  icon: 'Warehouse',
  setting: 'exterior',
  zoneKinds: ['garage-door'],
  dimensions: [
    {
      id: 'style',
      label: 'Style',
      question: 'What style of garage door?',
      defaultOptionId: 'garage-carriage',
      options: [
        { id: 'garage-carriage', label: 'Carriage house', description: 'Windows on top, strap hinges', promptText: 'carriage-house style garage doors with a top row of windows and decorative strap hinges', visual: diagram('garage-carriage'), rationale: 'Warm and traditional — farmhouse, Craftsman, Colonial.' },
        { id: 'garage-panel', label: 'Raised panel', description: 'Classic rectangles', promptText: 'raised-panel garage doors with a row of small windows', visual: diagram('garage-panel'), rationale: 'Neutral and traditional; recedes when painted the body color.' },
        { id: 'garage-glass', label: 'Full-view glass', description: 'Aluminum and frosted glass', promptText: 'full-view black aluminum garage doors with frosted glass panels', visual: diagram('garage-glass'), rationale: 'Contemporary and Mid-century; glows at night.' },
        { id: 'garage-flush', label: 'Flush modern', description: 'Smooth with thin grooves', promptText: 'flush modern garage doors with thin horizontal grooves', visual: diagram('garage-flush'), rationale: 'Minimal and quiet on modern houses.' },
        { id: 'garage-plank', label: 'Wood-look planks', description: 'Cedar-tone planks', promptText: 'wood-look plank garage doors in warm cedar tones', visual: diagram('garage-plank'), rationale: 'Adds warmth to modern farmhouse and contemporary facades.' },
      ],
    },
    {
      id: 'color',
      label: 'Color',
      question: 'What color?',
      defaultOptionId: 'match-body',
      options: [
        { id: 'match-body', label: 'Match the body', description: 'Recedes into the facade', promptText: 'painted the same color as the house body so it recedes', visual: colors('#bdb6a8', '#bdb6a8'), rationale: 'Keeps the front door the focal point — usually the right call.' },
        { id: 'white', label: 'White', description: 'Matches white trim', promptText: 'painted white to match the trim', visual: color('#f2f0ea'), rationale: 'Classic on white-trimmed traditional houses.' },
        { id: 'black', label: 'Black', description: 'Graphic contrast', promptText: 'painted black', visual: color('#1f2022'), rationale: 'Modern farmhouse; only when windows and trim are dark too.' },
        { id: 'charcoal', label: 'Charcoal', description: 'Soft dark gray', promptText: 'painted deep charcoal gray', visual: color('#3e4144'), rationale: 'Softer than black; works with gray and greige bodies.' },
        { id: 'wood-tone', label: 'Wood tone', description: 'Natural cedar look', promptText: 'finished in a natural cedar wood tone', visual: tex('wood-planks', CEDAR, 5.5, 96), rationale: 'Warm accent on contemporary and modern farmhouse houses.' },
      ],
    },
  ],
};

export const WINDOWS_SHUTTERS: ElementInput = {
  type: 'windows-shutters',
  label: 'Windows & shutters',
  description: 'Shutters, window frame color and window boxes.',
  icon: 'AppWindow',
  setting: 'exterior',
  zoneKinds: ['windows'],
  dimensions: [
    {
      id: 'shutters',
      label: 'Shutters',
      question: 'Shutters or not?',
      defaultOptionId: 'shutters-louvered',
      options: [
        noneOption('shutters-none', 'No shutters', 'Clean window openings', 'with no shutters', 'Right for Craftsman, Prairie, Mid-century and modern houses, and for windows too wide for shutters.'),
        { id: 'shutters-louvered', label: 'Louvered', description: 'Classic slatted shutters', promptText: 'louvered shutters sized to cover the window (each half the window width, full height)', visual: diagram('shutters-louvered'), rationale: 'Colonial, Cape Cod and Federal houses.' },
        { id: 'shutters-panel', label: 'Raised panel', description: 'Solid panel shutters', promptText: 'raised-panel shutters sized to cover the window', visual: diagram('shutters-panel'), rationale: 'Georgian and Federal formality; best on the ground floor.' },
        { id: 'shutters-board', label: 'Board & batten', description: 'Rustic plank shutters', promptText: 'board-and-batten shutters with a Z brace, sized to cover the window', visual: diagram('shutters-board'), rationale: 'Farmhouse, cottage and Tudor character.' },
      ],
    },
    {
      id: 'shutter-color',
      label: 'Shutter color',
      question: 'What color shutters?',
      defaultOptionId: 'black',
      options: [
        { id: 'black', label: 'Black', description: 'Classic', promptText: 'shutters painted black', visual: color('#1e2022'), rationale: 'Works with white, gray, yellow and brick.' },
        { id: 'green', label: 'Black-green', description: 'Historic dark green', promptText: 'shutters painted a historic black-green', visual: color('#26362c'), rationale: 'The traditional Colonial shutter color.' },
        { id: 'navy', label: 'Navy', description: 'Deep blue', promptText: 'shutters painted deep navy', visual: color('#243246'), rationale: 'Crisp with white and gray siding; coastal.' },
        { id: 'slate', label: 'Slate gray', description: 'Soft contrast', promptText: 'shutters painted slate gray', visual: color('#5e6468'), rationale: 'Quieter contrast on light gray or greige houses.' },
        { id: 'match-door', label: 'Match the door', description: 'Same as the front door', promptText: 'shutters painted to match the front door color', visual: colors('#8b2323', '#8b2323'), rationale: 'Ties the facade together when the door is a strong color.' },
      ],
    },
    {
      id: 'frames',
      label: 'Window frames',
      question: 'What color window frames?',
      defaultOptionId: 'frames-keep',
      options: [
        { id: 'frames-keep', label: 'Keep current', description: 'Leave frames as they are', promptText: 'keeping the existing window frames', visual: diagram('keep-existing'), rationale: 'Window changes are expensive — often unnecessary.' },
        { id: 'frames-white', label: 'White', description: 'Traditional sash', promptText: 'white window sash and casings', visual: color('#f4f2ec'), rationale: 'Traditional houses with light or mid bodies.' },
        { id: 'frames-black', label: 'Black', description: 'Modern contrast', promptText: 'black window sash and frames', visual: color('#1f1f1f'), rationale: 'Modern farmhouse and contemporary — reads crisp and graphic.' },
        { id: 'frames-bronze', label: 'Dark bronze', description: 'Warm dark', promptText: 'dark bronze window frames', visual: color('#3e3328'), rationale: 'Warm modern; pairs with stone, stucco and wood.' },
      ],
    },
    {
      id: 'window-boxes',
      label: 'Window boxes',
      question: 'Add window boxes?',
      defaultOptionId: 'boxes-none',
      options: [
        noneOption('boxes-none', 'No window boxes', 'Clean sills', 'with no window boxes', 'Simplest; window boxes need regular watering.'),
        { id: 'boxes-seasonal', label: 'Flowering', description: 'Trailing seasonal flowers', promptText: 'painted window boxes (as wide as the window) overflowing with trailing seasonal flowers and ivy-like greens', visual: decorArt('window-box', '#f2f0ea', '#c94f6d'), rationale: 'Cottage and Colonial charm; boxes about the window width, 8–10 in deep.' },
        { id: 'boxes-evergreen', label: 'Evergreen', description: 'Boxwood and trailing greens', promptText: 'painted window boxes with small clipped boxwoods and trailing greens', visual: decorArt('window-box', '#1f2022', '#3e5f37'), rationale: 'Tidy year-round look for formal houses.' },
      ],
    },
  ],
};

export const FENCE: ElementInput = {
  type: 'fence',
  label: 'Fence',
  description: 'Fences and gates that define the property — style, finish and height.',
  icon: 'Fence',
  setting: 'exterior',
  zoneKinds: ['fence', 'yard-border'],
  dimensions: [
    {
      id: 'style',
      label: 'Style',
      question: 'What kind of fence?',
      defaultOptionId: 'fence-picket',
      options: [
        { id: 'fence-picket', label: 'Picket', description: 'Classic and open', promptText: 'a classic picket fence with a matching gate', visual: diagram('fence-picket'), rationale: 'Colonial, Cape Cod, Cottage, Victorian — encloses without walling off.' },
        { id: 'fence-horizontal', label: 'Horizontal slat', description: 'Modern boards with gaps', promptText: 'a modern horizontal slat fence with narrow gaps', visual: diagram('fence-horizontal'), rationale: 'Contemporary and Mid-century; the horizontal lines widen a narrow lot.' },
        { id: 'fence-privacy', label: 'Board-on-board', description: 'Solid privacy fence', promptText: 'a solid board-on-board privacy fence with a top cap', visual: diagram('fence-privacy'), rationale: 'Backyards and side yards; soften long runs with planting.' },
        { id: 'fence-split-rail', label: 'Split rail', description: 'Rustic open rails', promptText: 'a rustic split-rail fence with two rails', visual: diagram('fence-split-rail'), rationale: 'Farmhouse and Ranch; marks a line while keeping the open landscape.' },
        { id: 'fence-metal', label: 'Black metal', description: 'Slim pickets and finials', promptText: 'a black metal fence with slim vertical pickets', visual: diagram('fence-metal'), rationale: 'Recedes visually; Georgian, Tudor, Spanish and modern houses, and pool codes.' },
      ],
    },
    {
      id: 'finish',
      label: 'Finish',
      question: 'What finish?',
      defaultOptionId: 'white',
      options: [
        { id: 'white', label: 'Painted white', description: 'Crisp and traditional', promptText: 'painted white', visual: color('#f4f2ec'), rationale: 'Matches white trim on traditional houses.' },
        { id: 'natural-cedar', label: 'Natural cedar', description: 'Warm wood tone', promptText: 'in natural cedar with a clear sealer', visual: tex('wood-planks', CEDAR, 5.5, 72), rationale: 'Warm and modern; weathers to silver if left unsealed.' },
        { id: 'stained-dark', label: 'Dark stain', description: 'Near-black stain', promptText: 'stained a deep charcoal-black', visual: color('#3e3a36'), rationale: 'Makes planting glow in front of it; modern and Japanese-inspired gardens.' },
        { id: 'weathered-gray', label: 'Weathered gray', description: 'Silvered wood', promptText: 'in silvered, weathered gray wood', visual: color('#8f8a82'), rationale: 'Coastal and farmhouse ease.' },
        { id: 'black-metal', label: 'Black metal', description: 'Powder-coated', promptText: 'in black powder-coated metal', visual: color('#1e1f21'), rationale: 'For metal fences: disappears against planting.' },
      ],
    },
    {
      id: 'height',
      label: 'Height',
      question: 'How tall?',
      defaultOptionId: 'fence-3ft',
      options: [
        { id: 'fence-3ft', label: '3 ft', description: 'Front-yard, waist high', promptText: 'about 3 ft tall', visual: diagram('fence-height-3ft'), rationale: 'Typical front-yard height (and often the code limit near sidewalks).' },
        { id: 'fence-4ft', label: '4 ft', description: 'Keeps pets in', promptText: 'about 4 ft tall', visual: diagram('fence-height-4ft'), rationale: 'Dogs and pool barriers (pools usually need 4 ft minimum).' },
        { id: 'fence-6ft', label: '6 ft', description: 'Full privacy', promptText: 'about 6 ft tall', visual: diagram('fence-height-6ft'), rationale: 'Backyard privacy; usually not allowed in front yards.' },
      ],
    },
  ],
};
