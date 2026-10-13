/**
 * Built-in paint palette: ~165 designer-grade colors with ORIGINAL names
 * (deliberately not any paint brand's trademarked names or codes), grouped
 * into curated collections in fan-deck order.
 *
 * Hexes are tuned to how the colors read on a wall (muted, livable chroma;
 * whites with a clear undertone). `family` is derived from the hex with the
 * engine's colorFamilyOf() so filtering a built-in color behaves exactly like
 * filtering a custom one. Tags are suggested uses / undertones / styles.
 */
import type { PaintColor } from '../../../shared/types';
import { colorFamilyOf } from '../../engine/color';
import { kebab } from './helpers';

/** [name, hex, comma-separated tags] */
type Row = readonly [name: string, hex: string, tags: string];

interface Collection {
  name: string;
  /** Tags every color in the collection gets. */
  tags: readonly string[];
  colors: readonly Row[];
}

const COLLECTIONS: readonly Collection[] = [
  {
    name: 'Warm whites',
    tags: ['white', 'warm'],
    colors: [
      ['Hearth Linen', '#f2ece0', 'walls, trim, whole house, farmhouse, north-facing rooms'],
      ['Parchment Hush', '#efe7d7', 'walls, bedroom, traditional, cozy'],
      ['Morning Oat', '#eee6d6', 'walls, living room, cabinets, soft'],
      ['Beeswax Candle', '#f1e6cc', 'walls, dining room, creamy, traditional'],
      ['Soft Plaster', '#ede7dc', 'walls, ceilings, limewash look, Mediterranean'],
      ['Cotton Bale', '#f4f0e6', 'walls, trim, cabinets, versatile'],
      ['Warm Porcelain', '#f3eee5', 'walls, kitchen, cabinets, modern farmhouse'],
      ['Shell Cameo', '#f1e8dd', 'walls, bath, bedroom, pink undertone'],
      ['Muslin Sheet', '#ede4d3', 'walls, exterior, cottage'],
      ['Buttermilk Lace', '#f3ead3', 'walls, kitchen, cottage, sunny'],
      ['Sunbleached Canvas', '#eee7da', 'walls, coastal, airy'],
      ['Vanilla Bean Cream', '#f0e5cf', 'walls, exterior, trim, colonial'],
    ],
  },
  {
    name: 'Cool whites',
    tags: ['white', 'cool'],
    colors: [
      ['Glacier Mist', '#eff2f1', 'walls, modern, south-facing rooms'],
      ['Gallery Snow', '#f5f5f2', 'walls, trim, art walls, minimalist'],
      ['Frost Paper', '#eef0ee', 'walls, bath, crisp'],
      ['Quiet Moonstone', '#eceeed', 'walls, bedroom, Scandinavian'],
      ['Seafoam Whisper', '#ebf0eb', 'walls, bath, coastal, green undertone'],
      ['Porcelain Frost', '#f3f4f2', 'walls, cabinets, contemporary'],
      ['Blue Hour White', '#eceff1', 'walls, ceilings, blue undertone'],
      ['Fresh Laundry', '#f3f5f4', 'walls, laundry, bath, clean'],
      ['Chalk Line', '#eff0ec', 'walls, trim, exterior, modern farmhouse'],
      ['Silver Birch', '#e9ebe8', 'walls, office, soft gray-white'],
      ['Cloud Linen', '#f1f2ee', 'walls, living room, balanced'],
    ],
  },
  {
    name: 'Greige & neutrals',
    tags: ['neutral', 'greige'],
    colors: [
      ['Driftwood Greige', '#cbc2b4', 'walls, whole house, transitional'],
      ['Oat Milk Greige', '#d7cfc2', 'walls, living room, open plan'],
      ['Stone Path Taupe', '#c1b7a7', 'walls, exterior, earthy'],
      ['Natural Jute', '#c9bca5', 'walls, den, warm, organic modern'],
      ['Sandbar', '#d5cbb9', 'walls, coastal, beach house'],
      ['Warm Putty', '#c6bcac', 'walls, cabinets, traditional'],
      ['Pebble Taupe', '#b3a899', 'walls, exterior, siding'],
      ['Mushroom Cap', '#a69a8c', 'accent wall, cabinets, exterior, moody neutral'],
      ['Linen Closet', '#dad3c6', 'walls, hallway, bedroom'],
      ['Dune Grass', '#d1c5ae', 'walls, exterior, Mediterranean, desert'],
      ['Taupe Tweed', '#9b8f80', 'accent wall, exterior, cabinets'],
      ['Fieldstone Greige', '#bab1a3', 'walls, exterior, craftsman'],
    ],
  },
  {
    name: 'Grays',
    tags: ['gray'],
    colors: [
      ['Harbor Fog', '#c8cac6', 'walls, whole house, coastal'],
      ['Pewter Mist', '#b6b8b4', 'walls, office, balanced gray'],
      ['Concrete Canvas', '#acaca6', 'walls, industrial, loft'],
      ['Slate Wash', '#a2a7aa', 'walls, bedroom, cool, blue undertone'],
      ['Dove Feather', '#d0d0ca', 'walls, living room, soft'],
      ['Graphite Dust', '#8c8f90', 'accent wall, exterior, cabinets'],
      ['Rainy Pavement', '#9da19f', 'walls, exterior, siding'],
      ['Sage-Gray Mist', '#b4bab2', 'walls, bath, green undertone'],
      ['Nickel Plate', '#a8aaa8', 'walls, kitchen, modern'],
      ['Storm Cellar', '#7c8082', 'accent wall, exterior, shutters'],
      ['Weathered Zinc', '#8d9597', 'exterior, siding, cool, coastal'],
      ['Ashen Linen', '#c3c1ba', 'walls, warm gray, transitional'],
    ],
  },
  {
    name: 'Charcoals & blacks',
    tags: ['dark', 'moody'],
    colors: [
      ['Soft Charcoal', '#4a4b4a', 'accent wall, exterior, cabinets, doors'],
      ['Forged Black', '#2a2a2a', 'exterior, trim, windows, doors, railings'],
      ['Ink Pot', '#262b31', 'accent wall, cabinets, blue-black'],
      ['Smoked Oak Black', '#302c28', 'exterior, warm black, modern farmhouse'],
      ['Basalt Stone', '#3b3d3e', 'exterior, siding, modern'],
      ['Charred Timber', '#3a3633', 'exterior, siding, shou sugi ban look'],
      ['Midnight Coal', '#232324', 'doors, trim, windows, high contrast'],
      ['Slate Roof', '#4e5356', 'exterior, shutters, garage door'],
      ['Gunmetal Shadow', '#545a5e', 'exterior, cabinets, industrial'],
      ['Raven Wing', '#1e2023', 'doors, accent wall, dramatic'],
      ['Graphite Pencil', '#585958', 'accent wall, office, library'],
      ['Olive Black', '#34362f', 'exterior, cabinets, green-black'],
    ],
  },
  {
    name: 'Earth tones',
    tags: ['earthy', 'warm'],
    colors: [
      ['Terracotta Clay', '#b66a4c', 'accent wall, Mediterranean, Spanish revival'],
      ['Saddle Leather', '#8a5b3d', 'accent wall, den, library'],
      ['Ochre Field', '#c49a50', 'accent wall, kitchen, 70s revival'],
      ['Adobe Wall', '#c8967b', 'exterior, stucco, Southwest'],
      ['Canyon Dust', '#c4a78b', 'exterior, walls, desert modern'],
      ['Iron Oxide', '#8c4a33', 'exterior, barn, accent'],
      ['Cinnamon Bark', '#9a6549', 'accent wall, cozy, craftsman'],
      ['Cocoa Husk', '#6a4e3d', 'exterior, trim, craftsman'],
      ['Umber Shadow', '#5d4b3f', 'exterior, siding, rustic'],
      ['Sienna Earth', '#a15f40', 'accent wall, Mediterranean'],
      ['Mesa Rose', '#b7856f', 'walls, bedroom, Southwest'],
      ['Toasted Pecan', '#8b6b52', 'cabinets, exterior, mid-century'],
    ],
  },
  {
    name: 'Greens',
    tags: ['green'],
    colors: [
      ['Garden Sage', '#a7b19a', 'walls, kitchen, cabinets, cottage'],
      ['Olive Grove', '#7c7e5b', 'cabinets, accent wall, exterior'],
      ['Eucalyptus Leaf', '#9ca89a', 'walls, bath, spa-like'],
      ['Fern Hollow', '#6e7d65', 'exterior, cabinets, craftsman'],
      ['Moss Stone', '#858a68', 'exterior, siding, woodland'],
      ['Lichen Gray-Green', '#b3b79f', 'walls, living room, organic'],
      ['Deep Forest', '#2f4336', 'accent wall, front door, library'],
      ['Bottle Green', '#2d4a40', 'cabinets, front door, traditional'],
      ['Celadon Glaze', '#c2cebb', 'walls, bedroom, soft'],
      ['Garden Mint Wash', '#ccdac9', 'walls, nursery, bath'],
      ['Hunting Lodge Green', '#3d4c3a', 'exterior, shutters, cabinets'],
      ['Juniper Green', '#5b6d5f', 'exterior, front door, cabinets'],
    ],
  },
  {
    name: 'Blues',
    tags: ['blue'],
    colors: [
      ['Harbor Navy', '#2c3a4e', 'cabinets, front door, exterior, accent wall'],
      ['Denim Wash', '#5b6f87', 'walls, office, kids room'],
      ['Coastal Fog Blue', '#a6b9c6', 'walls, bedroom, coastal'],
      ['Porch Sky', '#b3d3d8', 'porch ceiling, walls, coastal'],
      ['Slate Blue Hour', '#6d7e8b', 'exterior, siding, shutters'],
      ['Delft Tile Blue', '#3e5b7f', 'accent wall, cabinets, bold'],
      ['Smoke Blue', '#8a9caa', 'walls, exterior, cape cod'],
      ['Ink Wash Blue', '#33455a', 'cabinets, island, front door'],
      ['Morning Tide', '#bdd3dd', 'walls, bath, airy'],
      ['Steel Harbor', '#526572', 'exterior, siding, modern'],
      ['Teal Depths', '#2e595b', 'accent wall, front door, cabinets'],
      ['Powder Blue Linen', '#c4d8e4', 'walls, nursery, bedroom'],
    ],
  },
  {
    name: 'Accent reds & oranges',
    tags: ['accent', 'warm'],
    colors: [
      ['Old Barnyard Red', '#7b2e26', 'exterior, barn, front door'],
      ['Brick Kiln', '#994a3a', 'accent wall, exterior, colonial'],
      ['Paprika Spice', '#b4523b', 'accent wall, kitchen, bold'],
      ['Cranberry Glaze', '#7d2a31', 'front door, dining room'],
      ['Burnt Orange Peel', '#c86f3c', 'accent wall, mid-century, retro'],
      ['Tomato Vine', '#b03a2e', 'front door, accent'],
      ['Coral Dusk', '#d47c64', 'walls, kids room, playful'],
      ['Oxblood Leather', '#5d2426', 'front door, library, dramatic'],
      ['Spiced Pumpkin', '#c67b43', 'accent wall, autumnal'],
      ['Clay Pot Red', '#a75841', 'exterior, Spanish revival, trim'],
      ['Poppy Field', '#c6422f', 'front door, furniture, pop of color'],
    ],
  },
  {
    name: 'Yellows & golds',
    tags: ['yellow'],
    colors: [
      ['Mustard Seed', '#c3992f', 'front door, accent wall, mid-century'],
      ['Honey Jar', '#d2a647', 'accent wall, kitchen, warm'],
      ['Churned Butter', '#f0e08e', 'walls, kitchen, cottage'],
      ['Goldenrod Meadow', '#cda240', 'exterior, accent, cheerful'],
      ['Saffron Thread', '#d4992e', 'accent wall, front door'],
      ['Pale Primrose', '#f0e6ae', 'walls, nursery, sunny'],
      ['Ochre Lantern', '#b7893a', 'accent wall, library'],
      ['Lemon Sorbet', '#f2e6a7', 'walls, kitchen, bright'],
      ['Brass Candlestick', '#ae8f4c', 'accent wall, cabinets'],
      ['Harvest Wheat', '#dac085', 'exterior, walls, farmhouse'],
      ['Sunlit Straw', '#e6d993', 'walls, exterior, colonial'],
    ],
  },
  {
    name: 'Purples & pinks',
    tags: ['pink', 'purple'],
    colors: [
      ['Dusty Heather', '#a5909b', 'walls, bedroom, muted'],
      ['Lavender Field Mist', '#c2bacb', 'walls, bedroom, nursery'],
      ['Plum Wine', '#5d3a4a', 'accent wall, front door, dining room'],
      ['Blush Plaster', '#e4c6c1', 'walls, bedroom, bath, soft pink'],
      ['Rose Clay', '#c4948f', 'accent wall, dining room, earthy pink'],
      ['Mauve Velvet', '#8e6e78', 'accent wall, powder room'],
      ['Aubergine Night', '#3e2a36', 'accent wall, front door, dramatic'],
      ['Petal Pink', '#ecd3cb', 'walls, nursery, bedroom'],
      ['Lilac Dusk', '#9b8ead', 'walls, bedroom, office'],
      ['Faded Rosewood', '#c29894', 'accent wall, Victorian'],
      ['Thistle Bloom', '#b4a3b9', 'walls, bath, cottage'],
    ],
  },
  {
    name: 'Exterior classics',
    tags: ['exterior', 'siding'],
    colors: [
      ['Clapboard Cream', '#e5dcc5', 'colonial, farmhouse, body color'],
      ['Saltbox Gray', '#8e8f89', 'cape cod, colonial, body color'],
      ['Shingle Brown', '#6d5a48', 'craftsman, shingle style, body color'],
      ['Homestead White', '#efebe1', 'farmhouse, body color, trim'],
      ['Sea Cottage Blue', '#8aa1ae', 'cape cod, coastal, body color'],
      ['Craftsman Olive', '#6c6a4e', 'craftsman, bungalow, body color'],
      ['Bungalow Sage', '#8b947c', 'craftsman, cottage, body color'],
      ['Cape Shore Gray', '#a2a39c', 'cape cod, ranch, body color'],
      ['Federal Brick Red', '#793b2f', 'federal, colonial, accent'],
      ['Prairie Khaki', '#a79b80', 'prairie, ranch, body color'],
      ['Painted Lady Plum', '#6a4553', 'Victorian, accent, body color'],
      ['Adobe Sand Stucco', '#d1b897', 'Spanish revival, Mediterranean, stucco'],
      ['Ranch Redwood', '#7b4a37', 'ranch, mid-century, body color'],
      ['Lakehouse Charcoal', '#3f4245', 'modern, contemporary, body color'],
    ],
  },
  {
    name: 'Front door favorites',
    tags: ['front door', 'high gloss'],
    colors: [
      ['Lacquer Red', '#9c2b2c', 'colonial, traditional, welcoming'],
      ['Lucky Door Red', '#b1302c', 'classic, bright'],
      ['Blackened Navy', '#1f2a3a', 'colonial, modern, elegant'],
      ['Piano Lacquer', '#1c1c1e', 'modern, any house, timeless'],
      ['Hunter Door Green', '#2b4235', 'Georgian, Tudor, traditional'],
      ['Teal Welcome', '#2b6466', 'cottage, coastal, cheerful'],
      ['Marigold Door', '#c8992f', 'mid-century, modern, gray houses'],
      ['Damson Door', '#4c2d3d', 'Victorian, brick houses'],
      ["Robin's Egg Door", '#7eb2b4', 'cottage, coastal, white houses'],
      ['Sage Door', '#899a7e', 'farmhouse, cottage, soft'],
      ['Cognac Door', '#7d4a2e', 'craftsman, wood-tone look'],
      ['Slate Door Blue', '#4a5c6d', 'cape cod, colonial, gray houses'],
    ],
  },
  {
    name: 'Trim & ceiling',
    tags: ['trim', 'ceiling'],
    colors: [
      ['Bright Trim White', '#f7f7f3', 'trim, doors, crisp contrast'],
      ['Soft Trim White', '#f2efe8', 'trim, cabinets, warm walls'],
      ['Ceiling Bright', '#f8f8f5', 'ceilings, flat finish'],
      ['Warm Ceiling Cream', '#f3efe5', 'ceilings, warm rooms'],
      ['Crisp Gallery Trim', '#fafaf7', 'trim, modern, cool walls'],
      ['Ivory Molding', '#eee8da', 'trim, traditional, cream walls'],
      ['Pale Pewter Trim', '#e5e5e0', 'trim, gray walls, tonal'],
      ['Linen Trim', '#ebe5d9', 'trim, greige walls, tonal'],
      ['Window Sash Black', '#222324', 'window frames, exterior trim, modern farmhouse'],
      ['Cool Ceiling White', '#f3f5f5', 'ceilings, cool rooms'],
      ['Barely Greige Trim', '#e7e2d8', 'trim, ceilings, soft contrast'],
    ],
  },
];

/** Collection names in fan-deck order. */
export const PAINT_COLLECTIONS: readonly string[] = COLLECTIONS.map((c) => c.name);

function splitTags(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export const PAINT_COLORS: PaintColor[] = COLLECTIONS.flatMap((c) =>
  c.colors.map(([name, hex, tags]): PaintColor => {
    const h = hex.toLowerCase();
    return {
      id: kebab(name),
      name,
      hex: h,
      family: colorFamilyOf(h),
      collection: c.name,
      tags: [...new Set([...c.tags, ...splitTags(tags)])],
    };
  }),
);
