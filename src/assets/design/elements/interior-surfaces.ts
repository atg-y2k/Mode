/** Interior surface elements: wall paint, flooring, ceiling, cabinets, countertops, backsplash, fireplace. */
import { color, colors, diagram, tex } from '../visuals';
import type { ElementInput } from './build';

const OAK = ['#c29a6b', '#b48c5f', '#cda77a', '#a88257'];
const WALNUT = ['#5e4130', '#6b4a36', '#523828', '#76533d'];
const STONE_TILE = ['#d8d3ca', '#cfc9bf', '#e0dbd3'];
const MARBLE = ['#f2f0ec', '#e3dfd8', '#b8b3aa'];

export const WALL_PAINT: ElementInput = {
  type: 'wall-paint',
  label: 'Wall paint',
  description: 'Wall color, sheen, trim and how the color is used.',
  icon: 'Paintbrush',
  setting: 'interior',
  zoneKinds: ['wall', 'accent-wall'],
  dimensions: [
    {
      id: 'color',
      label: 'Wall color',
      question: 'What color should the walls be?',
      defaultOptionId: 'warm-white',
      options: [
        { id: 'warm-white', label: 'Warm white', description: 'Soft, creamy (LRV ~85)', promptText: 'walls painted a soft warm white (creamy, not yellow; LRV about 85)', visual: color('#f1ece1'), rationale: 'Bright without glare; the safe choice for north-facing rooms and any style.' },
        { id: 'greige', label: 'Greige', description: 'Warm gray-beige (LRV ~60)', promptText: 'walls painted a warm greige (gray-beige, LRV about 60)', visual: color('#cfc6b8'), rationale: 'Bridges warm wood floors and cool grays; transitional and farmhouse rooms.' },
        { id: 'sage', label: 'Soft sage', description: 'Muted gray-green (LRV ~50)', promptText: 'walls painted a muted soft sage green (LRV about 50)', visual: color('#b4bba2'), rationale: 'Calm and natural — kitchens, bedrooms, cottage and Japandi rooms; pairs with oak and brass.' },
        { id: 'blue-gray', label: 'Misty blue-gray', description: 'Airy, cool (LRV ~50)', promptText: 'walls painted a misty blue-gray (LRV about 50)', visual: color('#a9b6bc'), rationale: 'Restful in bedrooms and baths; best in south-facing rooms with warm light.' },
        { id: 'clay', label: 'Terracotta clay', description: 'Earthy warm (LRV ~25)', promptText: 'walls painted a warm earthy terracotta clay (LRV about 25)', visual: color('#b97a5b'), rationale: 'Mediterranean, Spanish and warm-minimal rooms; cozy in dining rooms and dens.' },
        { id: 'deep-green', label: 'Deep green', description: 'Moody, enveloping (LRV ~6)', promptText: 'walls painted a deep moody green (LRV about 6)', visual: color('#2f3e3a'), rationale: 'Studies, dining rooms and powder rooms; dark colors make small rooms feel intentional and cozy.' },
      ],
    },
    {
      id: 'finish',
      label: 'Sheen',
      question: 'What paint sheen?',
      defaultOptionId: 'eggshell',
      options: [
        { id: 'matte', label: 'Matte', description: 'No shine, hides flaws', promptText: 'in a flat matte finish', visual: diagram('sheen-matte'), rationale: 'Richest color, hides wall imperfections; for low-traffic rooms and ceilings.' },
        { id: 'eggshell', label: 'Eggshell', description: 'Soft low sheen', promptText: 'in an eggshell finish', visual: diagram('sheen-eggshell'), rationale: 'The standard for living rooms, halls and bedrooms — wipeable but soft.' },
        { id: 'satin', label: 'Satin', description: 'Washable, soft glow', promptText: 'in a satin finish', visual: diagram('sheen-satin'), rationale: 'Kitchens, baths, kids’ rooms and mudrooms.' },
        { id: 'semi-gloss', label: 'Semi-gloss', description: 'Lacquered look', promptText: 'in a semi-gloss lacquered finish', visual: diagram('sheen-semigloss'), rationale: 'Trim and doors, or high-gloss jewel-box rooms (walls must be smooth).' },
      ],
    },
    {
      id: 'trim',
      label: 'Trim',
      question: 'What about the trim and doors?',
      defaultOptionId: 'trim-keep',
      options: [
        { id: 'trim-keep', label: 'Keep trim as is', description: 'Trim and doors unchanged', promptText: 'keeping the existing trim, baseboards and doors exactly as they are', visual: diagram('keep-existing'), rationale: 'The safe default: only the walls change.' },
        { id: 'trim-white', label: 'Crisp white', description: 'Classic contrast', promptText: 'with crisp white trim, baseboards and doors in semi-gloss', visual: color('#f7f6f2'), rationale: 'Traditional and fresh; outlines the architecture.' },
        { id: 'trim-drench', label: 'Color-drenched', description: 'Trim the same as walls', promptText: 'color-drenched: trim, baseboards and doors painted the same color as the walls', visual: diagram('wall-drench'), rationale: 'Modern and enveloping; makes small rooms feel larger and calmer.' },
        { id: 'trim-dark', label: 'Dark trim', description: 'Black or charcoal', promptText: 'with deep charcoal-black trim and doors', visual: color('#2b2c2e'), rationale: 'Graphic contrast for modern farmhouse and industrial rooms.' },
        { id: 'trim-wood', label: 'Stained wood', description: 'Natural wood trim', promptText: 'with stained natural wood trim and doors', visual: tex('wood-planks', WALNUT, 3.5, 84), rationale: 'Craftsman and Mid-century houses — keep original stained trim.' },
      ],
    },
    {
      id: 'treatment',
      label: 'Treatment',
      question: 'How should color be used?',
      defaultOptionId: 'wall-plain',
      options: [
        { id: 'wall-plain', label: 'All walls', description: 'One color throughout', promptText: 'one color on all walls', visual: diagram('wall-plain'), rationale: 'Calm and cohesive.' },
        { id: 'wall-accent', label: 'Accent wall', description: 'One wall contrasting', promptText: 'one accent wall, the room\'s natural focal wall, in a deeper color', visual: diagram('wall-accent'), rationale: 'Only on the natural focal wall, never a random one.' },
        { id: 'wall-two-tone', label: 'Two-tone', description: 'Wainscot at about one third height', promptText: 'two-tone walls: a deeper color on the lower third (wainscot height, about 36–42 in) with a lighter color above', visual: diagram('wall-two-tone'), rationale: 'Traditional proportion that grounds a room; durable below.' },
        { id: 'wall-ceiling', label: 'Painted ceiling', description: 'The fifth wall', promptText: 'the ceiling painted a soft color related to the walls', visual: diagram('wall-ceiling'), rationale: 'Adds intimacy to bedrooms and dining rooms; keep it lighter on low ceilings.' },
        { id: 'wall-limewash', label: 'Limewash', description: 'Soft mottled texture', promptText: 'walls finished in a soft mottled limewash', visual: diagram('wall-limewash'), rationale: 'Old-world depth for Mediterranean, Japandi and warm-minimal rooms.' },
      ],
    },
  ],
};

export const FLOORING: ElementInput = {
  type: 'flooring',
  label: 'Flooring',
  description: 'Floor material, layout pattern and tone.',
  icon: 'Rows3',
  setting: 'interior',
  zoneKinds: ['floor'],
  dimensions: [
    {
      id: 'material',
      label: 'Material',
      question: 'What should the floor be?',
      defaultOptionId: 'hardwood',
      options: [
        { id: 'hardwood', label: 'Wood plank', description: 'Oak hardwood (or wood-look vinyl)', promptText: 'white oak hardwood flooring with a matte finish', visual: tex('wood-planks', OAK, 7, 72), rationale: 'Warm and timeless in living areas and bedrooms; LVP gives the look in kitchens and basements.' },
        { id: 'porcelain-stone', label: 'Stone-look porcelain', description: '24×24 in large-format tile', promptText: 'large-format 24×24 in stone-look porcelain tile with thin warm-gray grout joints', visual: tex('tile-grid', STONE_TILE, 24, 24, { joint: { color: '#bdb7ad', widthIn: 0.125 } }), rationale: 'Waterproof and durable — kitchens, baths, entries; fewer grout lines read calm.' },
        { id: 'marble', label: 'Marble tile', description: 'Honed 24×24 in', promptText: 'honed white marble floor tiles (24×24 in) with soft gray veining', visual: tex('marble', MARBLE, 24, 24, { joint: { color: '#d8d4cc', widthIn: 0.0625 } }), rationale: 'Classic luxury for baths and entries; honed for slip resistance.' },
        { id: 'concrete', label: 'Polished concrete', description: 'Seamless and modern', promptText: 'seamless polished concrete floors in soft gray', visual: tex('concrete', ['#a9a6a0', '#b4b1ab', '#9e9b95'], 48, 48, { joint: null }), rationale: 'Industrial and contemporary; hard and cool underfoot — add rugs.' },
        { id: 'terrazzo', label: 'Terrazzo', description: 'Chips in a pale ground', promptText: 'terrazzo floors with marble chips in a pale ground', visual: tex('terrazzo', ['#ede9e2', '#b9b2a6', '#8e8779', '#c47a5a'], 1, 1), rationale: 'Mid-century signature; nearly indestructible.' },
        { id: 'carpet', label: 'Wall-to-wall carpet', description: 'Soft wool-look loop', promptText: 'soft wall-to-wall carpet in an oatmeal wool-look loop', visual: tex('carpet', ['#cfc6b6', '#c8bfaf', '#d6cdbd'], 1, 1), rationale: 'Quiet and warm in bedrooms and family rooms.' },
      ],
    },
    {
      id: 'pattern',
      label: 'Layout',
      question: 'What layout pattern?',
      defaultOptionId: 'wide-plank',
      options: [
        { id: 'wide-plank', label: 'Wide plank', description: '7–9 in boards', promptText: 'laid in wide 8 in planks running the length of the room', visual: tex('wood-planks', OAK, 8, 84), rationale: 'Calm and current; suits larger rooms and modern houses.' },
        { id: 'narrow-strip', label: 'Narrow strip', description: '2¼–3¼ in classic strip', promptText: 'laid as narrow 3 in strip flooring', visual: tex('wood-planks', OAK, 3.25, 48), rationale: 'Period-correct for older houses (1900–1960).' },
        { id: 'herringbone', label: 'Herringbone', description: 'Zigzag of short planks', promptText: 'laid in a herringbone pattern', visual: tex('herringbone', OAK, 4, 24), rationale: 'Elegant European pattern; one room or zone per floor.' },
        { id: 'chevron', label: 'Chevron', description: 'Angled V pattern', promptText: 'laid in a chevron pattern', visual: tex('chevron', OAK, 4, 24), rationale: 'Crisper and more formal than herringbone.' },
        { id: 'large-format', label: 'Large-format grid', description: '12×24 in tile, ⅓ offset', promptText: 'laid as 12×24 in tiles with a one-third offset', visual: tex('tile-grid', STONE_TILE, 24, 12, { joint: { color: '#bdb7ad', widthIn: 0.125 } }), rationale: 'For tile and stone: a third offset avoids lippage on long tiles.' },
      ],
    },
    {
      id: 'tone',
      label: 'Tone',
      question: 'How light or dark?',
      defaultOptionId: 'light-natural',
      options: [
        { id: 'light-natural', label: 'Light natural', description: 'Raw oak, Scandinavian', promptText: 'in a light natural (raw oak) tone', visual: colors('#d9bc93', '#cdae84', '#e2c9a3'), rationale: 'Bright and airy; hides dust; Scandinavian and Japandi.' },
        { id: 'honey', label: 'Warm honey', description: 'Classic golden', promptText: 'in a warm honey tone', visual: colors('#c08a55', '#b37d4a', '#cb9762'), rationale: 'Traditional warmth; period houses and cottages.' },
        { id: 'mid-brown', label: 'Mid brown', description: 'Versatile medium', promptText: 'in a medium brown tone', visual: colors('#8e6440', '#7e5636', '#9a6f4a'), rationale: 'Forgiving and versatile; transitional rooms.' },
        { id: 'espresso', label: 'Dark espresso', description: 'Rich and formal', promptText: 'in a dark espresso tone', visual: colors('#4a3426', '#3e2b1f', '#56402f'), rationale: 'Dramatic contrast with white walls; shows dust and scratches.' },
        { id: 'whitewashed', label: 'Whitewashed gray', description: 'Coastal, weathered', promptText: 'in a pale whitewashed gray tone', visual: colors('#b8aea0', '#a69c8e', '#c4bbae'), rationale: 'Coastal and Scandinavian; can look dated if too gray.' },
      ],
    },
  ],
};

export const CEILING: ElementInput = {
  type: 'ceiling',
  label: 'Ceiling',
  description: 'The fifth wall: paint, wood, beams, coffers or a tray.',
  icon: 'PanelTop',
  setting: 'interior',
  zoneKinds: ['ceiling'],
  dimensions: [
    {
      id: 'treatment',
      label: 'Treatment',
      question: 'What should happen overhead?',
      defaultOptionId: 'flat-white',
      options: [
        { id: 'flat-white', label: 'Flat white', description: 'Clean and bright', promptText: 'a smooth flat white ceiling', visual: color('#f6f5f1'), rationale: 'Maximizes light; right for low ceilings and modern rooms.' },
        { id: 'wood-planks', label: 'Wood planks', description: 'Tongue-and-groove', promptText: 'a tongue-and-groove wood plank ceiling running the long direction', visual: tex('wood-planks', ['#b98e62', '#ad8357', '#c49a6d', '#a37a50'], 5.5, 96), rationale: 'Warmth for large rooms, porches, cottages and modern cabins.' },
        { id: 'beams', label: 'Exposed beams', description: 'Wood beams across the room', promptText: 'exposed wood beams spanning the short direction of the room, evenly spaced 4–6 ft apart', visual: diagram('ceiling-beams'), rationale: 'Farmhouse, Craftsman, Spanish and Tudor rooms; needs 8.5 ft or more.' },
        { id: 'coffered', label: 'Coffered', description: 'Grid of recessed panels', promptText: 'a coffered ceiling with a grid of recessed square panels and crown molding', visual: diagram('ceiling-coffered'), rationale: 'Formal traditional and Georgian rooms with 9 ft+ ceilings.' },
        { id: 'tray', label: 'Tray', description: 'Recessed center', promptText: 'a recessed tray ceiling with a hidden cove light', visual: diagram('ceiling-tray'), rationale: 'Adds height over beds and dining tables.' },
        { id: 'painted-color', label: 'Painted color', description: 'Soft color overhead', promptText: 'the ceiling painted a soft color a shade lighter than the walls', visual: color('#c9d3d4'), rationale: 'Cozy and finished; keep it light on ceilings under 8 ft.' },
      ],
    },
    {
      id: 'wood-tone',
      label: 'Wood / beam tone',
      question: 'If wood is used, what tone?',
      defaultOptionId: 'light-oak',
      options: [
        { id: 'light-oak', label: 'Light oak', description: 'Pale and airy', promptText: 'wood in a pale natural oak tone', visual: colors('#d2b48c', '#c8a67e'), rationale: 'Keeps the ceiling from feeling heavy.' },
        { id: 'honey', label: 'Warm honey', description: 'Golden pine/fir', promptText: 'wood in a warm honey fir tone', visual: colors('#c08a55', '#b37d4a'), rationale: 'Cabin and cottage warmth.' },
        { id: 'walnut', label: 'Dark walnut', description: 'Dramatic contrast', promptText: 'wood in a dark walnut tone', visual: colors('#5e4130', '#523828'), rationale: 'Only on tall ceilings with light walls.' },
        { id: 'painted', label: 'Painted white', description: 'Texture without contrast', promptText: 'wood painted white', visual: colors('#f2f0ea', '#e8e5de'), rationale: 'Coastal and farmhouse texture without heaviness.' },
      ],
    },
  ],
};

export const CABINETS: ElementInput = {
  type: 'cabinets',
  label: 'Cabinets',
  description: 'Cabinet color, door style, hardware and layout.',
  icon: 'Archive',
  setting: 'interior',
  zoneKinds: ['cabinetry'],
  dimensions: [
    {
      id: 'color',
      label: 'Color',
      question: 'What color cabinets?',
      defaultOptionId: 'warm-white',
      options: [
        { id: 'warm-white', label: 'Warm white', description: 'Bright and classic', promptText: 'cabinets painted a warm white', visual: color('#f2f0ea'), rationale: 'Timeless and bright; the safe resale choice.' },
        { id: 'putty', label: 'Putty / greige', description: 'Soft warm neutral', promptText: 'cabinets painted a soft putty greige', visual: color('#c8bfae'), rationale: 'Warmer and more forgiving than white; pairs with brass and marble.' },
        { id: 'sage', label: 'Sage green', description: 'Muted green', promptText: 'cabinets painted a muted sage green', visual: color('#8e9a7e'), rationale: 'Cottage, English and farmhouse kitchens.' },
        { id: 'navy', label: 'Navy', description: 'Deep blue', promptText: 'cabinets painted deep navy blue', visual: color('#24324a'), rationale: 'Great on islands and lowers with white uppers and brass.' },
        { id: 'black', label: 'Soft black', description: 'Dramatic', promptText: 'cabinets painted soft black', visual: color('#232426'), rationale: 'Bold modern and industrial kitchens; needs good light.' },
        { id: 'white-oak', label: 'Rift white oak', description: 'Natural wood', promptText: 'rift-sawn white oak cabinets with a natural matte finish', visual: tex('wood-planks', ['#c4a47c', '#b99a72', '#cfb088'], 6, 36), rationale: 'Warm modern, Japandi and Mid-century.' },
      ],
    },
    {
      id: 'door-style',
      label: 'Door style',
      question: 'What door style?',
      defaultOptionId: 'cab-shaker',
      options: [
        { id: 'cab-shaker', label: 'Shaker', description: 'Recessed flat panel', promptText: 'Shaker-style doors (flat recessed panel)', visual: diagram('cab-shaker'), rationale: 'The most versatile — farmhouse, transitional, traditional.' },
        { id: 'cab-slab', label: 'Slab', description: 'Flat, frameless', promptText: 'flat slab doors', visual: diagram('cab-slab'), rationale: 'Modern, Mid-century and Japandi.' },
        { id: 'cab-inset', label: 'Beaded inset', description: 'Furniture-like, flush', promptText: 'beaded inset doors set flush in the face frame', visual: diagram('cab-inset'), rationale: 'High-end traditional, Colonial and Victorian kitchens.' },
        { id: 'cab-raised', label: 'Raised panel', description: 'Traditional', promptText: 'raised-panel doors', visual: diagram('cab-raised'), rationale: 'Formal traditional rooms; can look dated in modern spaces.' },
        { id: 'cab-fluted', label: 'Fluted / reeded', description: 'Vertical grooves', promptText: 'fluted / reeded doors with fine vertical grooves', visual: diagram('cab-fluted'), rationale: 'Texture for warm-minimal and Art Deco-tinged rooms; best on an island or vanity.' },
        { id: 'cab-glass', label: 'Glass-front', description: 'Display uppers', promptText: 'glass-front upper doors with slim frames', visual: diagram('cab-glass'), rationale: 'Lightens a wall of uppers; keep the contents tidy.' },
      ],
    },
    {
      id: 'hardware',
      label: 'Hardware',
      question: 'What hardware?',
      defaultOptionId: 'brass-pulls',
      options: [
        { id: 'brass-pulls', label: 'Brass bar pulls', description: 'Unlacquered brass', promptText: 'unlacquered brass bar pulls (about one third of the drawer width) and knobs on doors', visual: color('#b5893b'), rationale: 'Warm and classic with white, green, navy and wood.' },
        { id: 'black-pulls', label: 'Matte black pulls', description: 'Graphic', promptText: 'matte black bar pulls and knobs', visual: color('#1e1e1e'), rationale: 'Modern farmhouse and industrial.' },
        { id: 'nickel-knobs', label: 'Polished nickel', description: 'Cup pulls and knobs', promptText: 'polished nickel cup pulls on drawers and knobs on doors', visual: color('#c9c9c4'), rationale: 'Traditional and Colonial kitchens.' },
        { id: 'leather-pulls', label: 'Leather tabs', description: 'Soft, minimal', promptText: 'minimal cognac leather tab pulls', visual: color('#8a5230'), rationale: 'Japandi and Scandinavian softness.' },
      ],
    },
    {
      id: 'layout',
      label: 'Color layout',
      question: 'One color or two?',
      defaultOptionId: 'cab-one-tone',
      options: [
        { id: 'cab-one-tone', label: 'One color', description: 'All cabinets match', promptText: 'all cabinets in one color', visual: diagram('cab-one-tone'), rationale: 'Calm and cohesive; best in small kitchens.' },
        { id: 'cab-island-contrast', label: 'Contrasting island', description: 'Island stands out', promptText: 'the island in a contrasting deeper color', visual: diagram('cab-island-contrast'), rationale: 'An easy focal point without darkening the room.' },
        { id: 'cab-two-tone', label: 'Light uppers, dark lowers', description: 'Two-tone', promptText: 'two-tone: light upper cabinets over darker lower cabinets', visual: diagram('cab-two-tone'), rationale: 'Grounds the room while keeping eye level bright.' },
        { id: 'cab-open-shelves', label: 'Open shelves', description: 'Shelves instead of uppers', promptText: 'open floating shelves in place of some upper cabinets', visual: diagram('cab-open-shelves'), rationale: 'Airy and personal; only where you can keep it tidy.' },
      ],
    },
  ],
};

export const COUNTERTOPS: ElementInput = {
  type: 'countertops',
  label: 'Countertops',
  description: 'Counter material and finish.',
  icon: 'RectangleHorizontal',
  setting: 'interior',
  zoneKinds: ['countertop'],
  dimensions: [
    {
      id: 'material',
      label: 'Material',
      question: 'What countertop?',
      defaultOptionId: 'quartz',
      options: [
        { id: 'quartz', label: 'White quartz', description: 'Subtle veining, no upkeep', promptText: 'white quartz countertops with subtle soft-gray veining', visual: tex('marble', ['#f2f0ec', '#ebe8e2', '#cfcac2'], 48, 24), rationale: 'Low maintenance and bright; the transitional default.' },
        { id: 'marble', label: 'Marble', description: 'Carrara / Calacatta', promptText: 'Calacatta-style white marble countertops with bold gray veining', visual: tex('marble', ['#f4f2ee', '#d9d5ce', '#8e8a84'], 48, 24), rationale: 'Classic luxury that etches and patinas — traditional and European kitchens.' },
        { id: 'soapstone', label: 'Soapstone', description: 'Soft charcoal, matte', promptText: 'charcoal soapstone countertops with faint white veins', visual: tex('marble', ['#3e4442', '#4a504e', '#6b716e'], 48, 24), rationale: 'Farmhouse and Colonial; darkens and softens with use.' },
        { id: 'butcher-block', label: 'Butcher block', description: 'Warm wood', promptText: 'oiled maple butcher-block countertops', visual: tex('wood-planks', ['#b98a55', '#a87a48', '#c99a62'], 1.75, 36), rationale: 'Cottage and farmhouse warmth; great on islands, needs oiling.' },
        { id: 'concrete', label: 'Concrete', description: 'Matte gray, handmade', promptText: 'smooth matte gray concrete countertops', visual: tex('concrete', ['#9c9890', '#a7a39b', '#918d85'], 48, 24, { joint: null }), rationale: 'Industrial and modern; seal well.' },
        { id: 'granite', label: 'Speckled granite', description: 'Durable, salt-and-pepper', promptText: 'honed salt-and-pepper granite countertops', visual: tex('terrazzo', ['#3a3a3a', '#8a8a8a', '#d9d9d9', '#5e5e5e'], 0.5, 0.5), rationale: 'Bulletproof and heat-proof; honed finishes look current.' },
      ],
    },
    {
      id: 'finish',
      label: 'Finish',
      question: 'What surface finish?',
      defaultOptionId: 'honed',
      options: [
        { id: 'polished', label: 'Polished', description: 'Glossy, reflective', promptText: 'with a polished glossy finish', visual: diagram('sheen-gloss'), rationale: 'Shows veining at its richest; shows etching on marble.' },
        { id: 'honed', label: 'Honed', description: 'Soft matte', promptText: 'with a soft honed matte finish', visual: diagram('sheen-matte'), rationale: 'Understated and current; hides scratches.' },
        { id: 'leathered', label: 'Leathered', description: 'Soft textured', promptText: 'with a leathered, softly textured finish', visual: diagram('sheen-textured'), rationale: 'Hides fingerprints and water spots; lovely on dark stone.' },
      ],
    },
  ],
};

export const BACKSPLASH: ElementInput = {
  type: 'backsplash',
  label: 'Backsplash',
  description: 'Tile shape, color and grout between counter and cabinets.',
  icon: 'Grid3x3',
  setting: 'interior',
  zoneKinds: ['backsplash'],
  dimensions: [
    {
      id: 'tile',
      label: 'Tile',
      question: 'What tile?',
      defaultOptionId: 'subway',
      options: [
        { id: 'subway', label: 'Classic subway', description: '3×6 in, running bond', promptText: 'classic 3×6 in glossy subway tile in a running bond', visual: tex('subway', ['#f4f3ef', '#edebe6', '#f8f7f4'], 6, 3, { joint: { color: '#d9d6cf', widthIn: 0.0625 } }), rationale: 'Timeless and affordable; works in every style.' },
        { id: 'zellige', label: 'Zellige', description: 'Handmade 4×4 in, glossy, uneven', promptText: 'handmade glossy zellige tile (4×4 in) with irregular surfaces and tone variation', visual: tex('tile-grid', ['#e8e4da', '#dcd6c8', '#f0ede5', '#d3ccbc'], 4, 4, { joint: { color: '#d8d2c5', widthIn: 0.0625 }, variation: 0.45 }), rationale: 'Shimmering, artisan texture — Mediterranean, warm-minimal, farmhouse.' },
        { id: 'herringbone', label: 'Marble herringbone', description: '2×6 in pieces', promptText: 'honed marble tile in a small herringbone pattern (2×6 in pieces)', visual: tex('herringbone', MARBLE, 2, 6, { joint: { color: '#d8d4cc', widthIn: 0.0625 } }), rationale: 'Elegant and traditional; pair with a quiet counter.' },
        { id: 'hex', label: 'Hexagon', description: '2–3 in hex mosaic', promptText: 'small hexagon mosaic tile (about 3 in)', visual: tex('hex-tile', ['#eeece8', '#e3e0da', '#f4f2ee'], 3, 3, { joint: { color: '#cfcbc4', widthIn: 0.0625 } }), rationale: 'Vintage charm for bungalows and Colonial baths and kitchens.' },
        { id: 'vertical-stack', label: 'Vertical stack', description: '2×8 in stacked', promptText: 'slim 2×8 in tiles in a vertical stacked pattern', visual: tex('tile-grid', ['#e9e7e2', '#dedbd5', '#f1efea'], 2, 8, { joint: { color: '#cfcbc4', widthIn: 0.0625 } }), rationale: 'Modern and tall-looking; Contemporary and Japandi kitchens.' },
        { id: 'slab', label: 'Full-height slab', description: 'Stone continuing up the wall', promptText: 'a full-height stone slab backsplash continuing from the counter', visual: tex('marble', MARBLE, 48, 48), rationale: 'Seamless and luxurious; no grout to clean.' },
      ],
    },
    {
      id: 'color',
      label: 'Color',
      question: 'What tile color?',
      defaultOptionId: 'white',
      options: [
        { id: 'white', label: 'White', description: 'Bright and clean', promptText: 'in white', visual: color('#f4f3ef'), rationale: 'Bright and timeless.' },
        { id: 'cream', label: 'Warm cream', description: 'Soft and handmade-feeling', promptText: 'in warm cream', visual: color('#ebe2cf'), rationale: 'Softer than white with wood and brass.' },
        { id: 'sage', label: 'Sage green', description: 'Muted glaze', promptText: 'in a muted sage-green glaze', visual: color('#9aa58a'), rationale: 'Brings nature in; lovely with white or oak cabinets.' },
        { id: 'deep-blue', label: 'Deep blue', description: 'Rich glaze', promptText: 'in a deep blue glaze', visual: color('#2f4a6b'), rationale: 'Bold accent for white kitchens.' },
        { id: 'charcoal', label: 'Charcoal', description: 'Dark and moody', promptText: 'in charcoal', visual: color('#3a3c3e'), rationale: 'Modern drama; pair with light counters.' },
      ],
    },
    {
      id: 'grout',
      label: 'Grout',
      question: 'Grout color?',
      defaultOptionId: 'grout-match',
      options: [
        { id: 'grout-match', label: 'Matching', description: 'Blends with tile', promptText: 'with grout matching the tile', visual: colors('#f4f3ef', '#ecebe6'), rationale: 'Calm, seamless look.' },
        { id: 'grout-warm', label: 'Warm gray', description: 'Subtle contrast, hides dirt', promptText: 'with warm light-gray grout', visual: colors('#f4f3ef', '#c9c4ba'), rationale: 'Practical behind the stove.' },
        { id: 'grout-dark', label: 'Charcoal', description: 'Graphic outline', promptText: 'with contrasting charcoal grout', visual: colors('#f4f3ef', '#4a4b4d'), rationale: 'Emphasizes the pattern — industrial and farmhouse.' },
      ],
    },
  ],
};

export const FIREPLACE: ElementInput = {
  type: 'fireplace',
  label: 'Fireplace',
  description: 'Surround, mantel and how far the fireplace wall goes.',
  icon: 'Flame',
  setting: 'interior',
  zoneKinds: ['fireplace'],
  dimensions: [
    {
      id: 'surround',
      label: 'Surround',
      question: 'What should the surround be?',
      defaultOptionId: 'limewash-brick',
      options: [
        { id: 'limewash-brick', label: 'Limewashed brick', description: 'Soft white brick', promptText: 'brick surround finished with a soft white limewash', visual: tex('brick', ['#e6e0d6', '#d9cfc2', '#efe9e0', '#cbbfb0'], 7.625, 2.25, { joint: { color: '#e9e4dc', widthIn: 0.375 } }), rationale: 'Keeps brick texture while brightening; farmhouse and transitional.' },
        { id: 'stacked-stone', label: 'Stacked stone', description: 'Natural ledgestone', promptText: 'natural stacked-stone (ledgestone) surround', visual: tex('stone-veneer', ['#8a8176', '#9a9083', '#6f685f', '#a99e8f'], 12, 4), rationale: 'Rustic warmth for mountain, Craftsman and Ranch houses.' },
        { id: 'marble-slab', label: 'Marble slab', description: 'Veined stone panels', promptText: 'book-matched marble slab surround', visual: tex('marble', MARBLE, 36, 36), rationale: 'Elegant and classic; traditional and modern luxury.' },
        { id: 'plaster', label: 'Smooth plaster', description: 'Sculptural, seamless', promptText: 'smooth hand-troweled plaster surround in warm white', visual: tex('stucco', ['#e6dfd3', '#ddd5c8', '#ebe5da'], 6, 6), rationale: 'Warm minimal, Japandi, Spanish and Mediterranean.' },
        { id: 'zellige', label: 'Glazed tile', description: 'Handmade zellige', promptText: 'glossy handmade zellige tile surround', visual: tex('tile-grid', ['#2f5e6b', '#3e7482', '#2a5561', '#467d8a'], 4, 4, { joint: { color: '#c9c4ba', widthIn: 0.0625 }, variation: 0.45 }), rationale: 'A color moment for eclectic and Mediterranean rooms.' },
        { id: 'painted-paneling', label: 'Painted paneling', description: 'Shiplap or panels', promptText: 'painted wood paneling (shiplap) on the fireplace wall', visual: tex('shiplap', ['#f2f0ea', '#eeebe4', '#f5f3ee'], 96, 6), rationale: 'Coastal and farmhouse; keep combustible material clear of the opening.' },
      ],
    },
    {
      id: 'mantel',
      label: 'Mantel',
      question: 'What mantel?',
      defaultOptionId: 'mantel-beam',
      options: [
        { id: 'mantel-none', label: 'No mantel', description: 'Clean and minimal', promptText: 'with no mantel shelf', visual: diagram('none'), rationale: 'Modern and minimal; art leans on the hearth instead.' },
        { id: 'mantel-beam', label: 'Wood beam', description: 'Chunky rough-hewn', promptText: 'with a chunky rough-hewn wood beam mantel', visual: diagram('mantel-beam'), rationale: 'Warm focal point for farmhouse, Craftsman and rustic modern.' },
        { id: 'mantel-classic', label: 'Classic mantel', description: 'Painted with legs', promptText: 'with a classic painted mantel with pilaster legs and a crown shelf', visual: diagram('mantel-classic'), rationale: 'Traditional, Colonial and Georgian rooms.' },
      ],
    },
    {
      id: 'extent',
      label: 'Extent',
      question: 'How far should it go?',
      defaultOptionId: 'fp-full-height',
      options: [
        { id: 'fp-standard', label: 'Firebox surround', description: 'Around the opening only', promptText: 'with the surround around the firebox only', visual: diagram('fp-standard'), rationale: 'Traditional proportion; lets wall color show.' },
        { id: 'fp-full-height', label: 'Floor to ceiling', description: 'Full-height feature wall', promptText: 'with the surround running floor to ceiling', visual: diagram('fp-full-height'), rationale: 'Makes the fireplace the room’s anchor; best with tall ceilings.' },
        { id: 'fp-builtins', label: 'With built-ins', description: 'Shelves on both sides', promptText: 'flanked by built-in shelves and cabinets on both sides', visual: diagram('fp-builtins'), rationale: 'Balanced and useful; classic in living rooms.' },
      ],
    },
  ],
};
