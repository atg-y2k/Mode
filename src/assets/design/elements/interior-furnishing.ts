/** Interior furnishing elements: lighting, furniture, window treatments, decor — plus the free-form custom element. */
import { color, colors, decorArt, diagram, fixtureArt, plantArt } from '../visuals';
import type { ElementInput } from './build';
import { KELVIN_SWATCH } from './outdoor-living';

export const INTERIOR_LIGHTING: ElementInput = {
  type: 'interior-lighting',
  label: 'Lighting',
  description: 'Layered light: ambient, task and accent, a statement fixture, warmth and finish.',
  icon: 'LampCeiling',
  setting: 'interior',
  zoneKinds: ['ceiling', 'light-fixture'],
  dimensions: [
    {
      id: 'layers',
      label: 'Light layers',
      question: 'Which layers of light?',
      multiple: true,
      defaultOptionId: 'statement',
      options: [
        { id: 'recessed', label: 'Recessed ambient', description: 'Even ceiling downlights', promptText: 'small recessed ceiling downlights spaced evenly (about every 4–6 ft) for ambient light', visual: diagram('beam-down'), rationale: 'Even base light; keep them 2–3 ft from walls and on dimmers.' },
        { id: 'statement', label: 'Statement fixture', description: 'Pendant or chandelier', promptText: 'a statement pendant or chandelier centered over the table or seating', visual: diagram('beam-pendant'), rationale: 'The room’s jewelry and a focal point; size it to the room or table.' },
        { id: 'sconces', label: 'Wall sconces', description: 'Up/down glow on walls', promptText: 'wall sconces at about 66 in to center washing the walls with light', visual: diagram('beam-sconce'), rationale: 'Eye-level glow that flatters faces; frames art, mirrors and beds.' },
        { id: 'under-cabinet', label: 'Under-cabinet', description: 'Task light on counters', promptText: 'warm under-cabinet LED strips lighting the countertops', visual: diagram('beam-strip'), rationale: 'Essential task light in kitchens.' },
        { id: 'lamps', label: 'Floor & table lamps', description: 'Soft pools at seating', promptText: 'floor and table lamps creating soft pools of light at the seating', visual: diagram('beam-lamp'), rationale: 'The cozy layer — light at several heights around the room.' },
        { id: 'cove', label: 'Cove / LED strip', description: 'Hidden indirect glow', promptText: 'hidden LED cove lighting washing the ceiling edge', visual: diagram('beam-cove'), rationale: 'Indirect glow that lifts the ceiling; modern rooms and trays.' },
      ],
    },
    {
      id: 'fixture',
      label: 'Statement fixture',
      question: 'What kind of statement fixture?',
      defaultOptionId: 'dome-pendant',
      options: [
        { id: 'dome-pendant', label: 'Dome pendant', description: 'Metal dome shade', promptText: 'a large matte metal dome pendant', visual: fixtureArt('pendant-dome', '#1e1e1e', '#f2efe8'), rationale: 'Modern farmhouse, industrial and Scandinavian kitchens and tables.' },
        { id: 'chandelier', label: 'Chandelier', description: 'Classic arms', promptText: 'a classic brass chandelier with candle arms and small shades', visual: fixtureArt('chandelier', '#b5893b', '#f5ead6'), rationale: 'Traditional dining rooms and entries; diameter in inches ≈ room length + width in feet.' },
        { id: 'globe-pendant', label: 'Opal globe', description: 'Soft glass sphere', promptText: 'an opal glass globe pendant', visual: fixtureArt('pendant-globe', '#b5893b', '#f4f1ea'), rationale: 'Mid-century and transitional; diffuse, glare-free light.' },
        { id: 'cage-pendant', label: 'Cage pendant', description: 'Industrial wire cage', promptText: 'an industrial black wire cage pendant with a vintage bulb', visual: fixtureArt('pendant-cage', '#2b2b2b', '#ffd9a0'), rationale: 'Industrial and loft spaces.' },
        { id: 'flush-mount', label: 'Flush mount', description: 'For low ceilings', promptText: 'a slim flush-mount ceiling fixture', visual: fixtureArt('flush-mount', '#a9aaa6', '#f4f1ea'), rationale: 'Ceilings under 8 ft and bedrooms.' },
      ],
    },
    {
      id: 'color-temp',
      label: 'Light color',
      question: 'How warm should the light be?',
      defaultOptionId: 'k2700',
      options: [
        { id: 'k2700', label: 'Warm 2700 K', description: 'Living rooms, bedrooms', promptText: 'warm 2700 K light', visual: color(KELVIN_SWATCH.k2700), rationale: 'Incandescent-like warmth for living spaces and bedrooms.' },
        { id: 'k3000', label: 'Soft white 3000 K', description: 'Kitchens, baths', promptText: 'soft white 3000 K light', visual: color(KELVIN_SWATCH.k3000), rationale: 'A touch crisper for kitchens, baths and work areas.' },
        { id: 'k3500', label: 'Neutral-warm 3500 K', description: 'Task-focused', promptText: 'neutral-warm 3500 K light', visual: color(KELVIN_SWATCH.k3500), rationale: 'Offices, laundry and garages; too cool for living rooms.' },
        { id: 'k2200', label: 'Candlelight 2200 K', description: 'Dim-to-warm glow', promptText: 'candle-like 2200 K light', visual: color(KELVIN_SWATCH.k2200), rationale: 'Evening mood and dining; ideal with dim-to-warm bulbs.' },
      ],
    },
    {
      id: 'finish',
      label: 'Metal finish',
      question: 'What metal finish?',
      defaultOptionId: 'brass',
      options: [
        { id: 'brass', label: 'Brass', description: 'Warm gold', promptText: 'fixtures in warm brass', visual: color('#b5893b'), rationale: 'Warmth and glow; traditional and transitional.' },
        { id: 'black', label: 'Matte black', description: 'Graphic', promptText: 'fixtures in matte black', visual: color('#1e1e1e'), rationale: 'Modern farmhouse, industrial, Scandinavian.' },
        { id: 'nickel', label: 'Polished nickel', description: 'Soft silver', promptText: 'fixtures in polished nickel', visual: color('#c9c9c4'), rationale: 'Classic baths and traditional rooms.' },
        { id: 'bronze', label: 'Aged bronze', description: 'Dark warm', promptText: 'fixtures in aged bronze', visual: color('#4a3a2c'), rationale: 'Craftsman and Spanish rooms; hides fingerprints.' },
      ],
    },
    {
      id: 'time',
      label: 'Show it at',
      question: 'When should the rendering show the room?',
      defaultOptionId: 'evening',
      options: [
        { id: 'daytime', label: 'Daytime', description: 'Natural light, fixtures off', promptText: 'in daylight with the fixtures off, showing their design', visual: colors('#f4f1ea', '#dfe6ea', '#c9b79c'), rationale: 'Judge how fixtures look by day.' },
        { id: 'evening', label: 'Evening', description: 'Lights on, dusk outside', promptText: 'the whole room in the evening with all lights on and dusk outside the windows', visual: colors('#2b3a5c', '#ffa957', '#f2d3a8'), rationale: 'The moment to judge layered lighting. Affects the whole image.' },
        { id: 'night', label: 'Night', description: 'Only the lamps glowing', promptText: 'the whole room at night lit only by its fixtures and lamps, dark outside', visual: colors('#141a26', '#ffb46b', '#5a4632'), rationale: 'Shows mood and any dark corners. Affects the whole image.' },
      ],
    },
  ],
};

export const FURNITURE: ElementInput = {
  type: 'furniture',
  label: 'Furniture',
  description: 'Furniture style, layout, upholstery color and rug.',
  icon: 'Sofa',
  setting: 'interior',
  zoneKinds: ['furniture', 'rug'],
  dimensions: [
    {
      id: 'style',
      label: 'Style',
      question: 'What furniture style?',
      defaultOptionId: 'modern-organic',
      options: [
        { id: 'modern-organic', label: 'Modern organic', description: 'Soft curves, natural textures', promptText: 'modern organic furniture: a low curved sofa in bouclé, oak and travertine tables', visual: decorArt('sofa', '#e4dccd', '#b08a62'), rationale: 'Warm and current; suits most houses and warm-minimal rooms.' },
        { id: 'mid-century', label: 'Mid-century', description: 'Tapered legs, walnut', promptText: 'mid-century modern furniture: a tight-back sofa on tapered walnut legs, molded lounge chair', visual: decorArt('sofa', '#6b6b45', '#6b4a36'), rationale: 'Made for Ranch and Mid-century houses; light and leggy.' },
        { id: 'traditional', label: 'Classic traditional', description: 'Rolled arms, skirted chairs', promptText: 'classic traditional furniture: a rolled-arm sofa, skirted armchairs, wood side tables', visual: decorArt('sofa', '#d8cdbb', '#5e4130'), rationale: 'Colonial, Georgian and Victorian rooms.' },
        { id: 'scandinavian', label: 'Scandinavian', description: 'Light wood, simple forms', promptText: 'Scandinavian furniture: a simple light-gray sofa, pale oak and woven pieces', visual: decorArt('sofa', '#bfc0bb', '#d2b48c'), rationale: 'Bright, practical and calm.' },
        { id: 'japandi', label: 'Japandi low', description: 'Low, minimal, wood and linen', promptText: 'Japandi furniture: low-slung linen sofa, dark-stained wood, minimal forms', visual: decorArt('sofa', '#cbbfa9', '#3a3632'), rationale: 'Calm, grounded and clutter-free.' },
        { id: 'industrial', label: 'Industrial', description: 'Leather, metal, reclaimed wood', promptText: 'industrial furniture: a cognac leather sofa, black metal and reclaimed-wood tables', visual: decorArt('sofa', '#8a5230', '#2b2b2b'), rationale: 'Lofts and rooms with brick, concrete or beams.' },
      ],
    },
    {
      id: 'layout',
      label: 'Layout',
      question: 'How should it be arranged?',
      defaultOptionId: 'layout-conversation',
      options: [
        { id: 'layout-conversation', label: 'Conversation', description: 'Sofa + chairs facing', promptText: 'arranged for conversation: sofa facing two chairs across a coffee table, all within 8–10 ft', visual: diagram('layout-conversation'), rationale: 'People talk comfortably within about 8–10 ft.' },
        { id: 'layout-focal', label: 'Facing the focal point', description: 'U around fireplace/TV', promptText: 'arranged in a U facing the fireplace or media wall', visual: diagram('layout-focal'), rationale: 'Orients the room to its focal point.' },
        { id: 'layout-l', label: 'L-sectional', description: 'Sectional + chair', promptText: 'an L-shaped sectional with one accent chair and a coffee table', visual: diagram('layout-l'), rationale: 'Family rooms and open plans; defines a zone.' },
        { id: 'layout-float', label: 'Floated', description: 'Off the walls on a rug', promptText: 'furniture floated off the walls, anchored on a large rug, with a walkway behind the sofa', visual: diagram('layout-float'), rationale: 'Large and open-plan rooms; keep 30–36 in walkways.' },
      ],
    },
    {
      id: 'upholstery',
      label: 'Upholstery',
      question: 'Main upholstery color?',
      defaultOptionId: 'oatmeal',
      options: [
        { id: 'oatmeal', label: 'Oatmeal', description: 'Warm neutral', promptText: 'upholstered in oatmeal linen', visual: color('#d9cfbe'), rationale: 'Calm base for any palette (the 30% in 60-30-10).' },
        { id: 'cognac', label: 'Cognac leather', description: 'Warm brown', promptText: 'upholstered in cognac leather', visual: color('#8a5230'), rationale: 'Ages beautifully; Mid-century and industrial.' },
        { id: 'charcoal', label: 'Charcoal', description: 'Practical dark', promptText: 'upholstered in charcoal wool', visual: color('#3e3f41'), rationale: 'Hides wear; grounding in bright rooms.' },
        { id: 'olive', label: 'Olive', description: 'Earthy green', promptText: 'upholstered in olive green', visual: color('#6b6b45'), rationale: 'A rich neutral with wood and brass.' },
        { id: 'navy-velvet', label: 'Navy velvet', description: 'Deep and luxe', promptText: 'upholstered in navy velvet', visual: color('#24324a'), rationale: 'Traditional luxury and contrast with white walls.' },
        { id: 'rust', label: 'Rust', description: 'Warm accent', promptText: 'upholstered in warm rust', visual: color('#a5502e'), rationale: 'Warm-minimal and eclectic rooms; use as the accent piece.' },
      ],
    },
    {
      id: 'rug',
      label: 'Rug',
      question: 'How should the rug work?',
      defaultOptionId: 'rug-front-legs',
      options: [
        { id: 'rug-none', label: 'No rug', description: 'Bare floor', promptText: 'with no area rug', visual: diagram('none'), rationale: 'Shows off special floors; louder acoustically.' },
        { id: 'rug-front-legs', label: 'Front legs on', description: 'Usually 8×10 ft', promptText: 'on an 8×10 ft rug with the front legs of all seating on it', visual: diagram('rug-front-legs'), rationale: 'The standard living-room rule; leave 12–18 in of floor at the walls.' },
        { id: 'rug-all-legs', label: 'All legs on', description: 'Large 9×12 ft or more', promptText: 'on a large 9×12 ft rug with all furniture legs on it', visual: diagram('rug-all-legs'), rationale: 'Anchors a floated layout; makes the room feel bigger.' },
        { id: 'rug-layered', label: 'Layered', description: 'Pattern over natural fiber', promptText: 'on layered rugs: a smaller patterned rug over a large jute rug', visual: diagram('rug-layered'), rationale: 'Collected, textural look for eclectic and boho rooms.' },
      ],
    },
  ],
};

export const WINDOW_TREATMENTS: ElementInput = {
  type: 'window-treatments',
  label: 'Window treatments',
  description: 'Curtains, shades or shutters — how they hang and their color.',
  icon: 'Blinds',
  setting: 'interior',
  zoneKinds: ['window'],
  dimensions: [
    {
      id: 'type',
      label: 'Type',
      question: 'What kind of window treatment?',
      defaultOptionId: 'wt-drapes',
      options: [
        { id: 'wt-drapes', label: 'Drapery panels', description: 'Full-length linen', promptText: 'full-length linen drapery panels that just kiss the floor', visual: diagram('wt-drapes'), rationale: 'Softens a room and adds height; 2–2.5× window width in fullness.' },
        { id: 'wt-roman', label: 'Roman shades', description: 'Tailored fabric folds', promptText: 'tailored fabric Roman shades', visual: diagram('wt-roman'), rationale: 'Neat over sinks, desks and window seats.' },
        { id: 'wt-woven', label: 'Woven wood shades', description: 'Bamboo / grass', promptText: 'natural woven wood (bamboo) shades', visual: diagram('wt-woven'), rationale: 'Texture and filtered light; coastal, Japandi, boho.' },
        { id: 'wt-shutters', label: 'Plantation shutters', description: 'Wide louvers', promptText: 'white interior plantation shutters with wide louvers', visual: diagram('wt-shutters'), rationale: 'Architectural and great light control; Southern, coastal and traditional houses.' },
        { id: 'wt-layered', label: 'Shade + drapes', description: 'Layered for privacy', promptText: 'layered: a woven shade inside the frame plus linen drapery panels', visual: diagram('wt-layered'), rationale: 'Daylight plus privacy/blackout; bedrooms and living rooms.' },
      ],
    },
    {
      id: 'mount',
      label: 'Mounting',
      question: 'How should they hang?',
      defaultOptionId: 'mount-high-wide',
      options: [
        { id: 'mount-high-wide', label: 'High & wide', description: 'Near the ceiling, past the frame', promptText: 'mounted high and wide: rod 4–6 in below the ceiling and 8–12 in past each side of the frame', visual: diagram('mount-high-wide'), rationale: 'Makes windows look larger and ceilings taller.' },
        { id: 'mount-inside', label: 'Inside mount', description: 'Within the frame', promptText: 'inside-mounted within the window frame, showing the casing', visual: diagram('mount-inside'), rationale: 'Shows off nice trim; tailored and clean.' },
        { id: 'mount-standard', label: 'Just above the frame', description: 'Standard height', promptText: 'mounted just above the window frame', visual: diagram('mount-standard'), rationale: 'Where there is no room above the window (low ceilings, crown).' },
      ],
    },
    {
      id: 'fabric',
      label: 'Fabric color',
      question: 'What color?',
      defaultOptionId: 'white-linen',
      options: [
        { id: 'white-linen', label: 'White linen', description: 'Airy and light', promptText: 'in white linen', visual: color('#f2efe6'), rationale: 'Maximizes light; disappears into white walls.' },
        { id: 'oatmeal', label: 'Oatmeal', description: 'Warm neutral', promptText: 'in oatmeal linen', visual: color('#d8cdbb'), rationale: 'Warmer and hides sun fading.' },
        { id: 'warm-gray', label: 'Warm gray', description: 'Soft contrast', promptText: 'in warm gray', visual: color('#a8a39a'), rationale: 'Quiet contrast against white walls.' },
        { id: 'sage', label: 'Sage', description: 'Muted green', promptText: 'in muted sage', visual: color('#9aa58a'), rationale: 'Soft color for bedrooms and cottages.' },
        { id: 'navy', label: 'Navy', description: 'Deep and tailored', promptText: 'in navy', visual: color('#2b3a55'), rationale: 'Traditional drama; blocks light well.' },
      ],
    },
  ],
};

export const DECOR: ElementInput = {
  type: 'decor',
  label: 'Decor',
  description: 'Art, mirrors, plants, textiles and objects that finish the room.',
  icon: 'Frame',
  setting: 'interior',
  zoneKinds: ['decor'],
  dimensions: [
    {
      id: 'accents',
      label: 'Accents',
      question: 'What should we add?',
      multiple: true,
      defaultOptionId: 'art',
      options: [
        { id: 'art', label: 'Large art', description: 'One big piece', promptText: 'one large-scale artwork hung with its center at about 57–60 in (about two thirds the width of the furniture below)', visual: decorArt('wall-art', '#c9b79c', '#2f3e3a'), rationale: 'One generous piece beats many small ones.' },
        { id: 'mirror', label: 'Mirror', description: 'Bounce the light', promptText: 'a large round or arched mirror placed to reflect a window', visual: decorArt('mirror', '#b5893b'), rationale: 'Doubles daylight and opens small rooms.' },
        {
          id: 'plants',
          label: 'Indoor plants',
          description: 'Matched to the light',
          promptText: 'healthy indoor plants matched to the light: a tall fiddle-leaf fig by the window, snake plants or trailing pothos further in',
          visual: plantArt('houseplant-upright', '#3e6b3a', { foliage2: '#58864a', pot: '#d9cfbe', seed: 31 }),
          rationale: 'Life and softness; place by light level — fiddle-leaf figs need bright indirect light, snake plants and pothos tolerate low light.',
          plants: ['fiddle-leaf-fig', 'snake-plant', 'pothos'],
          plantMode: 'any',
        },
        { id: 'textiles', label: 'Textiles', description: 'Pillows and throws', promptText: 'layered textiles: pillows in one pattern, one texture and one solid, plus a chunky throw', visual: colors('#d9cfbe', '#a5502e', '#2f3e3a', '#c9b79c'), rationale: 'The easiest place for the 10% accent color.' },
        { id: 'objects', label: 'Books & objects', description: 'Styled shelves and tables', promptText: 'styled shelves and tables with books, ceramics and objects grouped in odd numbers at varied heights', visual: colors('#c9b79c', '#7a5a3e', '#2f3e3a', '#e8e1d4'), rationale: 'Personality; repeat each accent color at least three times in the room.' },
      ],
    },
    {
      id: 'palette',
      label: 'Accent palette',
      question: 'Which accent colors (the 30 and 10 of 60-30-10)?',
      defaultOptionId: 'warm-neutrals',
      options: [
        { id: 'warm-neutrals', label: 'Warm neutrals + terracotta', description: 'Cream, camel, rust', promptText: 'accents in cream, camel and terracotta', visual: colors('#e8e1d4', '#c49a6c', '#a5502e'), rationale: 'Warm-minimal and Mediterranean.' },
        { id: 'black-white', label: 'Black & white', description: 'Graphic monochrome', promptText: 'accents in black, white and natural wood', visual: colors('#f4f3ef', '#1e1e1e', '#b48c5f'), rationale: 'Modern farmhouse and Scandinavian.' },
        { id: 'blue-white', label: 'Blue & white', description: 'Fresh and classic', promptText: 'accents in blue and white', visual: colors('#f4f3ef', '#2f4a6b', '#9fb4c8'), rationale: 'Coastal and traditional; timeless.' },
        { id: 'earthy-green', label: 'Earthy greens', description: 'Olive, moss, ochre', promptText: 'accents in olive, moss and ochre', visual: colors('#6b6b45', '#8e9a7e', '#c9962e'), rationale: 'Japandi, Craftsman and biophilic rooms.' },
        { id: 'jewel', label: 'Jewel tones', description: 'Emerald, sapphire, garnet', promptText: 'accents in emerald, sapphire and garnet', visual: colors('#1f5e4a', '#24324a', '#7a2333'), rationale: 'Bold eclectic and moody rooms.' },
      ],
    },
    {
      id: 'density',
      label: 'Amount',
      question: 'How much decor?',
      defaultOptionId: 'curated',
      options: [
        { id: 'minimal', label: 'Minimal', description: 'A few strong pieces', promptText: 'minimal: only a few strong pieces with plenty of empty space', visual: colors('#e8e1d4', '#3a3632'), rationale: 'Japandi, Scandinavian and modern calm.' },
        { id: 'curated', label: 'Curated', description: 'Balanced and layered', promptText: 'curated: balanced, layered decor with breathing room', visual: colors('#e8e1d4', '#c49a6c', '#2f3e3a', '#8e9a7e'), rationale: 'Lived-in but tidy; suits most rooms.' },
        { id: 'collected', label: 'Collected / maximal', description: 'Rich layers and pattern', promptText: 'collected and maximal: rich layers of art, pattern and objects', visual: colors('#7a2333', '#c9962e', '#1f5e4a', '#24324a', '#e8e1d4', '#a5502e'), rationale: 'Bold eclectic and Victorian rooms; keep a common color thread.' },
      ],
    },
  ],
};

export const CUSTOM: ElementInput = {
  type: 'custom',
  label: 'Custom',
  description: 'Anything else — describe it in your own words.',
  icon: 'Sparkles',
  setting: 'both',
  zoneKinds: [],
  dimensions: [
    {
      id: 'amount',
      label: 'Amount of change',
      question: 'How big a change?',
      defaultOptionId: 'moderate',
      options: [
        { id: 'subtle', label: 'Subtle', description: 'A light refresh', promptText: 'a subtle refresh that keeps the current character', visual: diagram('change-subtle'), rationale: 'Low risk; good for testing an idea.' },
        { id: 'moderate', label: 'Noticeable', description: 'Clearly improved', promptText: 'a noticeable, clearly improved change', visual: diagram('change-moderate'), rationale: 'The usual sweet spot.' },
        { id: 'bold', label: 'Bold', description: 'A transformation', promptText: 'a bold transformation', visual: diagram('change-bold'), rationale: 'See the full potential — still respecting the structure.' },
      ],
    },
    {
      id: 'mood',
      label: 'Color mood',
      question: 'Which color mood?',
      defaultOptionId: 'match',
      options: [
        { id: 'match', label: 'Match the house', description: 'Use existing colors', promptText: 'using colors already in the house', visual: diagram('keep-existing'), rationale: 'Most cohesive with what stays.' },
        { id: 'warm', label: 'Warm', description: 'Cream, wood, terracotta', promptText: 'in a warm palette of cream, natural wood and terracotta', visual: colors('#e8e1d4', '#b48c5f', '#a5502e'), rationale: 'Inviting and earthy.' },
        { id: 'cool', label: 'Cool', description: 'White, gray, blue', promptText: 'in a cool palette of white, soft gray and blue', visual: colors('#f4f3ef', '#a9b6bc', '#2f4a6b'), rationale: 'Fresh and crisp.' },
        { id: 'neutral', label: 'Neutral', description: 'Greige, black accents', promptText: 'in a neutral palette of greige with black accents', visual: colors('#cfc6b8', '#f2f0ea', '#1e1e1e'), rationale: 'Quiet and versatile.' },
        { id: 'bold-color', label: 'Bold', description: 'Saturated accents', promptText: 'with bold saturated color accents', visual: colors('#1f5e4a', '#c9962e', '#7a2333'), rationale: 'Personality and energy.' },
      ],
    },
  ],
};
