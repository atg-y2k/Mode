/** Outdoor living elements: lighting, water feature, outdoor furniture. */
import { color, colors, decorArt, diagram, fixtureArt, tex } from '../visuals';
import type { ElementInput } from './build';

/** Warm light colors (Kelvin approximations) shared by outdoor and interior lighting. */
export const KELVIN_SWATCH = {
  k2200: '#ff932c',
  k2700: '#ffa957',
  k3000: '#ffb46b',
  k3500: '#ffc387',
  k4000: '#ffd1a3',
} as const;

export const OUTDOOR_LIGHTING: ElementInput = {
  type: 'outdoor-lighting',
  label: 'Outdoor lighting',
  description: 'Light the walk, steps, entry and a few accents — shown at dusk.',
  icon: 'Lightbulb',
  setting: 'exterior',
  zoneKinds: ['walkway', 'steps', 'porch', 'front-door', 'facade', 'tree'],
  dimensions: [
    {
      id: 'layers',
      label: 'What to light',
      question: 'What should be lit?',
      multiple: true,
      defaultOptionId: 'path',
      options: [
        { id: 'path', label: 'Path lights', description: 'Every 8–10 ft, staggered', promptText: 'low path lights along the walk, 8–10 ft apart and staggered side to side, casting soft pools on the paving', visual: diagram('beam-path'), rationale: 'Safety first: light where people walk.' },
        { id: 'entry', label: 'Entry lanterns', description: 'Flanking the front door', promptText: 'a pair of lanterns flanking the front door, each about a quarter to a third of the door height', visual: diagram('beam-down'), rationale: 'The welcome: makes the door the brightest point of the facade.' },
        { id: 'steps', label: 'Step lights', description: 'In risers or walls', promptText: 'small step lights lighting every tread of the front steps', visual: diagram('beam-step'), rationale: 'Every change of level should be lit.' },
        { id: 'uplight-trees', label: 'Uplight trees', description: '1–3 uplights per tree', promptText: 'warm uplights grazing the trunks and canopies of the front trees', visual: diagram('beam-up'), rationale: 'Adds depth and drama; aim from the outer drip line.' },
        { id: 'facade-wash', label: 'Facade wash', description: 'Grazing the walls and columns', promptText: 'soft grazing light on the facade, columns and stone from ground fixtures 6–12 in from the wall', visual: diagram('beam-wash'), rationale: 'Shows off texture (stone, brick, columns); keep it subtle and avoid lighting windows.' },
        { id: 'string', label: 'String lights', description: 'Festive bistro bulbs', promptText: 'warm bistro string lights draped between posts', visual: diagram('beam-string'), rationale: 'For patios, porches and fences — atmosphere more than navigation.' },
      ],
    },
    {
      id: 'color-temp',
      label: 'Light color',
      question: 'How warm should the light be?',
      defaultOptionId: 'k2700',
      options: [
        { id: 'k2200', label: 'Candlelight 2200 K', description: 'Amber, vintage', promptText: 'very warm amber 2200 K light', visual: color(KELVIN_SWATCH.k2200), rationale: 'Gas-lantern glow for historic houses and string lights.' },
        { id: 'k2700', label: 'Warm white 2700 K', description: 'The residential standard', promptText: 'warm white 2700 K light', visual: color(KELVIN_SWATCH.k2700), rationale: 'Flatters brick, wood, stone and plants; the default for homes.' },
        { id: 'k3000', label: 'Soft white 3000 K', description: 'Clean, still warm', promptText: 'soft white 3000 K light', visual: color(KELVIN_SWATCH.k3000), rationale: 'Crisper for modern houses and green foliage.' },
        { id: 'k4000', label: 'Neutral 4000 K', description: 'Cool, moonlight-like', promptText: 'neutral 4000 K light', visual: color(KELVIN_SWATCH.k4000), rationale: 'Only for moonlighting effects in trees; reads harsh on houses.' },
      ],
    },
    {
      id: 'fixture-style',
      label: 'Fixture style',
      question: 'What style of fixtures?',
      defaultOptionId: 'traditional',
      options: [
        { id: 'traditional', label: 'Traditional lanterns', description: 'Black carriage lanterns', promptText: 'traditional black carriage lanterns with clear seeded glass', visual: fixtureArt('wall-lantern', '#1e1e1e', '#f5e6c8'), rationale: 'Colonial, Cape Cod, Georgian and farmhouse houses.' },
        { id: 'craftsman', label: 'Craftsman mission', description: 'Bronze with amber mica', promptText: 'Craftsman mission-style lanterns in oil-rubbed bronze with amber mica panels', visual: fixtureArt('wall-lantern', '#4a3626', '#e8c88a'), rationale: 'Made for bungalows, Prairie and Arts & Crafts houses.' },
        { id: 'modern', label: 'Modern minimal', description: 'Black cylinders and bollards', promptText: 'slim modern cylinder and bollard fixtures in matte black with shielded LEDs', visual: fixtureArt('bollard', '#2b2b2b', '#f2f2f2'), rationale: 'Contemporary, Mid-century and modern farmhouse.' },
        { id: 'brass', label: 'Solid brass', description: 'Weathers to a soft patina', promptText: 'solid brass path lights and lanterns weathering to a warm brown patina', visual: fixtureArt('path-light', '#b5893b', '#f5e6c8'), rationale: 'Coastal, Shingle and historic houses; never rusts.' },
        { id: 'hidden', label: 'Hidden fixtures', description: 'See the light, not the fixture', promptText: 'low-profile hidden fixtures (well lights and shielded spots) so the light, not the fixtures, is noticed', visual: fixtureArt('well-light', '#3a3a3a'), rationale: 'The landscape-designer approach for accents; pair with visible lanterns at the door.' },
      ],
    },
    {
      id: 'time',
      label: 'Show it at',
      question: 'When should the rendering show the lighting?',
      defaultOptionId: 'dusk',
      options: [
        { id: 'dusk', label: 'Dusk', description: 'Blue hour, lights glowing', promptText: 'the whole scene re-lit at dusk (blue hour), with the lights glowing warmly', visual: colors('#2b3a5c', '#5a6a8a', '#f2a65a'), rationale: 'The most flattering moment to judge lighting — the house still reads against the sky. Affects the whole image.' },
        { id: 'night', label: 'Night', description: 'Dark sky, only the lights', promptText: 'the whole scene at night, lit only by the landscape and house lighting', visual: colors('#0f1626', '#1d2638', '#ffb46b'), rationale: 'Shows real coverage and any dark gaps. Affects the whole image.' },
        { id: 'daytime', label: 'Daytime', description: 'Fixtures visible, lights off', promptText: 'in daylight, showing the new fixtures themselves', visual: colors('#8fb6d9', '#c9dcea', '#f4f1ea'), rationale: 'Judge what the fixtures look like by day.' },
      ],
    },
  ],
};

export const WATER_FEATURE: ElementInput = {
  type: 'water-feature',
  label: 'Water feature',
  description: 'Sound and movement: bubbler, fountain, pond, rill, birdbath or dry creek.',
  icon: 'Droplets',
  setting: 'exterior',
  zoneKinds: ['planting-bed', 'patio', 'lawn'],
  dimensions: [
    {
      id: 'type',
      label: 'Type',
      question: 'What kind of water feature?',
      defaultOptionId: 'bubbler',
      options: [
        { id: 'bubbler', label: 'Bubbling urn', description: 'Pot or boulder over hidden basin', promptText: 'a bubbling glazed urn (about 30 in tall) over a hidden basin of river rock', visual: diagram('water-bubbler'), rationale: 'Big sound in a small footprint; safe for kids (no standing water).' },
        { id: 'wall-fountain', label: 'Wall fountain', description: 'Spout into a basin', promptText: 'a wall-mounted fountain spilling from a spout into a stone basin', visual: diagram('water-wall'), rationale: 'Formal courtyards and Spanish/Mediterranean patios; centers on an axis.' },
        { id: 'pond', label: 'Small pond', description: 'Naturalistic, stone-edged', promptText: 'a small naturalistic pond (about 6×8 ft) edged with flat stones and marginal plants', visual: diagram('water-pond'), rationale: 'Wildlife magnet for Japanese-inspired and woodland gardens; 18–24 in deep, part sun.' },
        { id: 'rill', label: 'Rill', description: 'Narrow linear channel', promptText: 'a narrow linear rill of water in a stone or steel channel', visual: diagram('water-rill'), rationale: 'Modern and Moorish gardens; leads the eye along a terrace.' },
        { id: 'birdbath', label: 'Birdbath', description: 'Classic pedestal basin', promptText: 'a classic pedestal stone birdbath', visual: decorArt('birdbath', '#9c9890'), rationale: 'The simplest cottage-garden focal point.' },
        { id: 'dry-creek', label: 'Dry creek bed', description: 'River rock that carries runoff', promptText: 'a dry creek bed of mixed river rock (2–8 in) and a few boulders, winding to carry downspout runoff', visual: diagram('water-dry-creek'), rationale: 'Solves drainage while suggesting water — great in xeriscapes.' },
      ],
    },
    {
      id: 'material',
      label: 'Material',
      question: 'What material?',
      defaultOptionId: 'natural-stone',
      options: [
        { id: 'natural-stone', label: 'Natural stone', description: 'Boulders and fieldstone', promptText: 'built of natural stone', visual: tex('stone-veneer', ['#8a8176', '#9a9083', '#6f685f', '#a99e8f'], 12, 8), rationale: 'Blends into naturalistic gardens.' },
        { id: 'glazed-ceramic', label: 'Glazed ceramic', description: 'Deep blue-green glaze', promptText: 'in deep blue-green glazed ceramic', visual: colors('#2f5e6b', '#3e7482', '#244b57'), rationale: 'A jewel-toned accent for cottage and Mediterranean gardens.' },
        { id: 'corten', label: 'Weathering steel', description: 'Rust patina', promptText: 'in weathering (Corten) steel with a rust patina', visual: colors('#8a4b2a', '#7a3f22', '#9c5a35'), rationale: 'Modern and sculptural; pairs with grasses and gravel.' },
        { id: 'smooth-concrete', label: 'Smooth concrete', description: 'Minimal and gray', promptText: 'in smooth gray concrete', visual: tex('concrete', ['#a8a49c', '#b3afa7', '#9e9a92'], 24, 24, { joint: null }), rationale: 'Clean lines for contemporary houses.' },
        { id: 'cast-stone', label: 'Cast stone', description: 'Classic carved look', promptText: 'in pale classic cast stone', visual: colors('#cfc8b8', '#bdb5a4', '#d9d3c5'), rationale: 'Formal and traditional gardens.' },
      ],
    },
  ],
};

export const OUTDOOR_FURNITURE: ElementInput = {
  type: 'outdoor-furniture',
  label: 'Outdoor furniture',
  description: 'Seating and dining for patios, porches and lawns.',
  icon: 'Umbrella',
  setting: 'exterior',
  zoneKinds: ['patio', 'deck', 'porch'],
  dimensions: [
    {
      id: 'setup',
      label: 'Setup',
      question: 'What kind of seating?',
      defaultOptionId: 'dining',
      options: [
        { id: 'dining', label: 'Dining set', description: 'Table for six', promptText: 'an outdoor dining table for six with chairs', visual: decorArt('dining-set', '#8a6a4a'), rationale: 'Needs about 12×14 ft including chair clearance.' },
        { id: 'conversation', label: 'Fire-pit conversation', description: 'Sofa + chairs around a fire', promptText: 'a conversation set — outdoor sofa and two lounge chairs — around a low fire pit', visual: decorArt('fire-pit', '#6b655e', '#e07a2e'), rationale: 'Seats within 8–10 ft of each other so talk is easy.' },
        { id: 'lounge', label: 'Chaise lounges', description: 'A pair with a side table', promptText: 'a pair of chaise lounges with a small side table', visual: decorArt('lounge-chair', '#d9cfbe', '#8a6a4a'), rationale: 'Pool sides and sunny lawns.' },
        { id: 'bench', label: 'Garden bench', description: 'A single bench', promptText: 'a simple teak garden bench', visual: decorArt('bench', '#8a6a4a'), rationale: 'A destination at the end of a path or under a tree.' },
        { id: 'rockers', label: 'Rockers / Adirondacks', description: 'A classic pair', promptText: 'a pair of classic Adirondack chairs', visual: decorArt('outdoor-chair', '#f2f0ea'), rationale: 'Farmhouse, cottage and coastal ease.' },
      ],
    },
    {
      id: 'material',
      label: 'Frame',
      question: 'What material?',
      defaultOptionId: 'teak',
      options: [
        { id: 'teak', label: 'Teak', description: 'Golden, weathers silver', promptText: 'in teak', visual: color('#9c6b3e'), rationale: 'Nearly universal and long-lived.' },
        { id: 'black-aluminum', label: 'Black aluminum', description: 'Powder-coated', promptText: 'in black powder-coated aluminum', visual: color('#232426'), rationale: 'Modern and maintenance-free.' },
        { id: 'wicker', label: 'All-weather wicker', description: 'Woven resin', promptText: 'in natural-tone all-weather wicker', visual: color('#8a7a66'), rationale: 'Relaxed and textural — coastal and cottage.' },
        { id: 'white-painted', label: 'Painted white', description: 'Classic', promptText: 'in white-painted wood', visual: color('#f2f0ea'), rationale: 'Traditional porches and gardens.' },
      ],
    },
    {
      id: 'cushions',
      label: 'Cushions',
      question: 'Cushion color?',
      defaultOptionId: 'oatmeal',
      options: [
        { id: 'oatmeal', label: 'Oatmeal', description: 'Natural neutral', promptText: 'with oatmeal cushions', visual: color('#d9cfbe'), rationale: 'Calm and lets plants be the color.' },
        { id: 'navy', label: 'Navy', description: 'Crisp and nautical', promptText: 'with navy cushions', visual: color('#2b3a55'), rationale: 'Coastal and classic; hides dirt.' },
        { id: 'terracotta', label: 'Terracotta', description: 'Warm earthy', promptText: 'with terracotta cushions', visual: color('#b5643c'), rationale: 'Mediterranean and Spanish warmth.' },
        { id: 'sage', label: 'Sage', description: 'Soft green', promptText: 'with sage-green cushions', visual: color('#9aa58a'), rationale: 'Blends with the garden.' },
        { id: 'stripe', label: 'Stripes', description: 'Navy-and-white stripe', promptText: 'with navy-and-white striped cushions', visual: colors('#2b3a55', '#f2f0ea'), rationale: 'Cheerful pattern for porches and coastal houses.' },
      ],
    },
  ],
};
