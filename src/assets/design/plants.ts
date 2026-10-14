/**
 * Landscape plant profiles behind the built-in plant options (planting-bed
 * palettes, hedges, lawn grasses, trees, houseplants). Each option that
 * implies plants lists profile ids, so its feasibility badge can be computed
 * for the property's hardiness zone, the spot's sun and deer pressure.
 *
 * Data follows common US nursery references (USDA zones, mature size at
 * ~10 years for shrubs/trees). Lawn grasses have matureWidthFt 0 (they spread).
 * deerResistant follows the Rutgers NJAES deer ratings where they list the
 * species: A/B (rarely / seldom severely damaged) → true, C/D (occasionally /
 * frequently severely damaged) → false; others are unrated or follow other
 * extension references.
 */
import type { PlantInfo } from '../../../shared/types';

export interface PlantProfile extends PlantInfo {
  id: string;
  name: string;
}

type ProfileData = Omit<PlantProfile, 'id' | 'indoor' | 'evergreen'> & { indoor?: boolean; evergreen?: boolean };

const ALL_SUN = ['full-sun', 'part-sun', 'shade'] as PlantInfo['sun'];

const DATA = {
  // --- evergreen structure & hedges
  boxwood: {
    name: "Boxwood 'Green Velvet'", botanical: "Buxus 'Green Velvet'", type: 'shrub', sun: ['full-sun', 'part-sun'], water: 'medium',
    zoneMin: 5, zoneMax: 8, matureHeightFt: 4, matureWidthFt: 4, evergreen: true, deerResistant: true,
  },
  inkberry: {
    name: "Inkberry holly 'Shamrock'", botanical: "Ilex glabra 'Shamrock'", type: 'shrub', sun: ALL_SUN, water: 'medium',
    zoneMin: 5, zoneMax: 9, matureHeightFt: 4, matureWidthFt: 4, evergreen: true, deerResistant: true, native: 'Eastern US',
  },
  'dwarf-hinoki': {
    name: "Dwarf Hinoki cypress 'Nana Gracilis'", botanical: "Chamaecyparis obtusa 'Nana Gracilis'", type: 'shrub', sun: ['full-sun', 'part-sun'],
    water: 'medium', zoneMin: 5, zoneMax: 8, matureHeightFt: 6, matureWidthFt: 4, evergreen: true, deerResistant: false,
  },
  'dwarf-yaupon': {
    name: 'Dwarf yaupon holly', botanical: "Ilex vomitoria 'Nana'", type: 'shrub', sun: ALL_SUN, water: 'low',
    zoneMin: 7, zoneMax: 10, matureHeightFt: 4, matureWidthFt: 5, evergreen: true, deerResistant: true, native: 'Southeastern US',
  },
  // --- flowering shrubs
  'little-lime-hydrangea': {
    name: "Panicle hydrangea 'Little Lime'", botanical: "Hydrangea paniculata 'Jane'", type: 'shrub', sun: ['full-sun', 'part-sun'], water: 'medium',
    zoneMin: 3, zoneMax: 8, matureHeightFt: 4, matureWidthFt: 4, bloom: 'Lime-green aging to pink, midsummer–fall', deerResistant: false,
  },
  'miss-kim-lilac': {
    name: "Dwarf Korean lilac 'Miss Kim'", botanical: "Syringa pubescens subsp. patula 'Miss Kim'", type: 'shrub', sun: ['full-sun', 'part-sun'],
    water: 'medium', zoneMin: 3, zoneMax: 8, matureHeightFt: 7, matureWidthFt: 6, bloom: 'Fragrant lavender, late spring', deerResistant: true,
  },
  'virginia-sweetspire': {
    name: "Virginia sweetspire 'Little Henry'", botanical: "Itea virginica 'Sprich'", type: 'shrub', sun: ALL_SUN, water: 'medium',
    zoneMin: 5, zoneMax: 9, matureHeightFt: 3, matureWidthFt: 3, bloom: 'Fragrant white spikes, early summer; red fall color', deerResistant: true,
    native: 'Eastern US',
  },
  // --- sunny perennials & grasses
  coneflower: {
    name: 'Purple coneflower', botanical: 'Echinacea purpurea', type: 'perennial', sun: ['full-sun', 'part-sun'], water: 'low',
    zoneMin: 3, zoneMax: 8, matureHeightFt: 3, matureWidthFt: 2, bloom: 'Purple-pink, midsummer', deerResistant: true, native: 'Eastern & Central US',
  },
  'black-eyed-susan': {
    name: "Black-eyed Susan 'Goldsturm'", botanical: "Rudbeckia fulgida var. sullivantii 'Goldsturm'", type: 'perennial', sun: ['full-sun', 'part-sun'],
    water: 'medium', zoneMin: 3, zoneMax: 9, matureHeightFt: 2.5, matureWidthFt: 2, bloom: 'Golden yellow, mid–late summer', deerResistant: true,
    native: 'Eastern US',
  },
  catmint: {
    name: "Catmint 'Walker's Low'", botanical: "Nepeta × faassenii 'Walker's Low'", type: 'perennial', sun: ['full-sun', 'part-sun'], water: 'low',
    zoneMin: 3, zoneMax: 8, matureHeightFt: 2.5, matureWidthFt: 3, bloom: 'Lavender-blue, late spring–fall', deerResistant: true,
  },
  'may-night-salvia': {
    name: "Meadow sage 'May Night'", botanical: "Salvia × sylvestris 'Mainacht'", type: 'perennial', sun: ['full-sun'], water: 'low',
    zoneMin: 4, zoneMax: 8, matureHeightFt: 1.5, matureWidthFt: 1.5, bloom: 'Violet-blue spikes, late spring–summer', deerResistant: true,
  },
  'little-bluestem': {
    name: 'Little bluestem', botanical: 'Schizachyrium scoparium', type: 'grass', sun: ['full-sun'], water: 'low',
    zoneMin: 3, zoneMax: 9, matureHeightFt: 3, matureWidthFt: 2, bloom: 'Blue-green foliage turning copper in fall', deerResistant: true,
    native: 'Most of North America',
  },
  lavender: {
    name: "Lavender 'Phenomenal'", botanical: "Lavandula × intermedia 'Phenomenal'", type: 'perennial', sun: ['full-sun'], water: 'low',
    zoneMin: 5, zoneMax: 9, matureHeightFt: 2.5, matureWidthFt: 3, evergreen: true, bloom: 'Lavender-purple, early–mid summer', deerResistant: true,
  },
  'russian-sage': {
    name: 'Russian sage', botanical: 'Salvia yangii (Perovskia atriplicifolia)', type: 'perennial', sun: ['full-sun'], water: 'low',
    zoneMin: 4, zoneMax: 9, matureHeightFt: 4, matureWidthFt: 3, bloom: 'Lavender-blue haze, summer–fall', deerResistant: true,
  },
  'autumn-joy-sedum': {
    name: "Stonecrop 'Autumn Joy'", botanical: "Hylotelephium 'Herbstfreude'", type: 'succulent', sun: ['full-sun', 'part-sun'], water: 'low',
    zoneMin: 3, zoneMax: 9, matureHeightFt: 2, matureWidthFt: 2, bloom: 'Pink aging to rust, late summer–fall', deerResistant: true,
  },
  'moonshine-yarrow': {
    name: "Yarrow 'Moonshine'", botanical: "Achillea 'Moonshine'", type: 'perennial', sun: ['full-sun'], water: 'low',
    zoneMin: 3, zoneMax: 8, matureHeightFt: 2, matureWidthFt: 2, bloom: 'Sulfur-yellow, early summer–fall', deerResistant: true,
  },
  'ladys-mantle': {
    name: "Lady's mantle", botanical: 'Alchemilla mollis', type: 'perennial', sun: ['full-sun', 'part-sun'], water: 'medium',
    zoneMin: 3, zoneMax: 8, matureHeightFt: 1.5, matureWidthFt: 2, bloom: 'Chartreuse froth, early summer', deerResistant: true,
  },
  'feather-reed-grass': {
    name: "Feather reed grass 'Karl Foerster'", botanical: "Calamagrostis × acutiflora 'Karl Foerster'", type: 'grass', sun: ['full-sun', 'part-sun'],
    water: 'medium', zoneMin: 4, zoneMax: 9, matureHeightFt: 5, matureWidthFt: 2, bloom: 'Upright tan plumes, early summer–winter', deerResistant: true,
  },
  switchgrass: {
    name: "Switchgrass 'Northwind'", botanical: "Panicum virgatum 'Northwind'", type: 'grass', sun: ['full-sun'], water: 'low',
    zoneMin: 4, zoneMax: 9, matureHeightFt: 5, matureWidthFt: 2.5, deerResistant: true, native: 'Most of North America',
  },
  'prairie-dropseed': {
    name: 'Prairie dropseed', botanical: 'Sporobolus heterolepis', type: 'grass', sun: ['full-sun'], water: 'low',
    zoneMin: 3, zoneMax: 9, matureHeightFt: 2.5, matureWidthFt: 3, deerResistant: true, native: 'Central North America',
  },
  'pink-muhly': {
    name: 'Pink muhly grass', botanical: 'Muhlenbergia capillaris', type: 'grass', sun: ['full-sun'], water: 'low',
    zoneMin: 6, zoneMax: 10, matureHeightFt: 3, matureWidthFt: 3, bloom: 'Pink cloud, fall', deerResistant: true, native: 'Southeastern US',
  },
  // --- shade
  hosta: {
    name: "Hosta 'Halcyon'", botanical: "Hosta 'Halcyon'", type: 'perennial', sun: ['part-sun', 'shade'], water: 'medium',
    zoneMin: 3, zoneMax: 9, matureHeightFt: 1.5, matureWidthFt: 2.5, bloom: 'Lavender, midsummer', deerResistant: false,
  },
  'japanese-forest-grass': {
    name: "Japanese forest grass 'Aureola'", botanical: "Hakonechloa macra 'Aureola'", type: 'grass', sun: ['part-sun', 'shade'], water: 'medium',
    zoneMin: 5, zoneMax: 9, matureHeightFt: 1.5, matureWidthFt: 2, deerResistant: true,
  },
  heuchera: {
    name: "Coral bells 'Palace Purple'", botanical: "Heuchera micrantha 'Palace Purple'", type: 'perennial', sun: ['part-sun', 'shade'], water: 'medium',
    zoneMin: 4, zoneMax: 9, matureHeightFt: 1.5, matureWidthFt: 1.5, evergreen: true, bloom: 'Airy white sprays, early summer', deerResistant: true,
    native: 'North America (species)',
  },
  hellebore: {
    name: 'Lenten rose', botanical: 'Helleborus × hybridus', type: 'perennial', sun: ['part-sun', 'shade'], water: 'medium',
    zoneMin: 4, zoneMax: 9, matureHeightFt: 1.5, matureWidthFt: 2, evergreen: true, bloom: 'Cream, rose or plum, late winter–early spring',
    deerResistant: true,
  },
  'autumn-fern': {
    name: 'Autumn fern', botanical: 'Dryopteris erythrosora', type: 'fern', sun: ['part-sun', 'shade'], water: 'medium',
    zoneMin: 5, zoneMax: 9, matureHeightFt: 2, matureWidthFt: 2, evergreen: true, deerResistant: true,
  },
  // --- groundcovers
  'creeping-thyme': {
    name: 'Creeping thyme', botanical: 'Thymus serpyllum', type: 'groundcover', sun: ['full-sun'], water: 'low',
    zoneMin: 4, zoneMax: 9, matureHeightFt: 0.25, matureWidthFt: 1.5, evergreen: true, bloom: 'Purple-pink, early summer', deerResistant: true,
  },
  'pennsylvania-sedge': {
    name: 'Pennsylvania sedge', botanical: 'Carex pensylvanica', type: 'groundcover', sun: ['part-sun', 'shade'], water: 'low',
    zoneMin: 3, zoneMax: 8, matureHeightFt: 0.75, matureWidthFt: 1, deerResistant: true, native: 'Eastern North America',
  },
  // --- lawn grasses
  'tall-fescue-blend': {
    name: 'Tall fescue / Kentucky bluegrass', botanical: 'Festuca arundinacea + Poa pratensis', type: 'grass', sun: ['full-sun', 'part-sun'],
    water: 'medium', zoneMin: 3, zoneMax: 7, matureHeightFt: 0.3, matureWidthFt: 0,
  },
  'zoysia-bermuda': {
    name: 'Zoysia / Bermuda grass', botanical: 'Zoysia japonica / Cynodon dactylon', type: 'grass', sun: ['full-sun'], water: 'low',
    zoneMin: 7, zoneMax: 11, matureHeightFt: 0.2, matureWidthFt: 0,
  },
  'fine-fescue': {
    name: 'Fine fescue mix', botanical: 'Festuca rubra, F. trachyphylla, F. ovina', type: 'grass', sun: ALL_SUN, water: 'low',
    zoneMin: 3, zoneMax: 7, matureHeightFt: 0.4, matureWidthFt: 0,
  },
  'st-augustine': {
    name: 'St. Augustine grass', botanical: 'Stenotaphrum secundatum', type: 'grass', sun: ['full-sun', 'part-sun'], water: 'high',
    zoneMin: 8, zoneMax: 11, matureHeightFt: 0.3, matureWidthFt: 0,
  },
  buffalograss: {
    name: 'Buffalograss', botanical: 'Bouteloua dactyloides', type: 'grass', sun: ['full-sun'], water: 'low',
    zoneMin: 4, zoneMax: 8, matureHeightFt: 0.3, matureWidthFt: 0, native: 'Great Plains',
  },
  microclover: {
    name: 'Microclover (overseeded in turf)', botanical: 'Trifolium repens (micro types)', type: 'groundcover', sun: ['full-sun', 'part-sun'],
    water: 'low', zoneMin: 4, zoneMax: 9, matureHeightFt: 0.3, matureWidthFt: 0,
  },
  // --- trees
  'japanese-maple': {
    name: "Japanese maple 'Bloodgood'", botanical: "Acer palmatum 'Bloodgood'", type: 'tree', sun: ['full-sun', 'part-sun'], water: 'medium',
    zoneMin: 5, zoneMax: 8, matureHeightFt: 18, matureWidthFt: 18, bloom: 'Burgundy-red leaves spring–fall', deerResistant: true,
  },
  redbud: {
    name: 'Eastern redbud', botanical: 'Cercis canadensis', type: 'tree', sun: ['full-sun', 'part-sun'], water: 'medium',
    zoneMin: 4, zoneMax: 9, matureHeightFt: 25, matureWidthFt: 30, bloom: 'Rosy pink, early spring', deerResistant: false,
    native: 'Eastern & Central US',
  },
  serviceberry: {
    name: "Serviceberry 'Autumn Brilliance'", botanical: "Amelanchier × grandiflora 'Autumn Brilliance'", type: 'tree', sun: ['full-sun', 'part-sun'],
    water: 'medium', zoneMin: 3, zoneMax: 8, matureHeightFt: 20, matureWidthFt: 15, bloom: 'White, early spring; June berries; orange fall color',
    deerResistant: true, native: 'Eastern North America',
  },
  'crape-myrtle': {
    name: "Crape myrtle 'Natchez'", botanical: "Lagerstroemia indica × fauriei 'Natchez'", type: 'tree', sun: ['full-sun'], water: 'low',
    zoneMin: 7, zoneMax: 10, matureHeightFt: 25, matureWidthFt: 20, bloom: 'White, all summer; cinnamon bark', deerResistant: true,
  },
  'emerald-arborvitae': {
    name: "Arborvitae 'Emerald Green'", botanical: "Thuja occidentalis 'Smaragd'", type: 'tree', sun: ['full-sun', 'part-sun'], water: 'medium',
    zoneMin: 3, zoneMax: 8, matureHeightFt: 14, matureWidthFt: 4, evergreen: true, deerResistant: false, native: 'Northeastern North America (species)',
  },
  'red-maple': {
    name: "Red maple 'October Glory'", botanical: "Acer rubrum 'October Glory'", type: 'tree', sun: ['full-sun', 'part-sun'], water: 'medium',
    zoneMin: 4, zoneMax: 9, matureHeightFt: 45, matureWidthFt: 35, bloom: 'Brilliant red fall color', deerResistant: true,
    native: 'Eastern North America',
  },
  // --- houseplants (sun = window light: full = bright direct, part = bright indirect, shade = low light)
  'fiddle-leaf-fig': {
    name: 'Fiddle-leaf fig', botanical: 'Ficus lyrata', type: 'houseplant', sun: ['full-sun', 'part-sun'], water: 'medium',
    matureHeightFt: 6, matureWidthFt: 3, evergreen: true, indoor: true,
  },
  'snake-plant': {
    name: 'Snake plant', botanical: 'Dracaena trifasciata', type: 'houseplant', sun: ALL_SUN, water: 'low',
    matureHeightFt: 3, matureWidthFt: 1.5, evergreen: true, indoor: true,
  },
  pothos: {
    name: 'Golden pothos', botanical: 'Epipremnum aureum', type: 'houseplant', sun: ['part-sun', 'shade'], water: 'medium',
    matureHeightFt: 1, matureWidthFt: 3, evergreen: true, indoor: true,
  },
} satisfies Record<string, ProfileData>;

export type PlantId = keyof typeof DATA;

export const PLANT_PROFILES: Record<PlantId, PlantProfile> = Object.fromEntries(
  (Object.entries(DATA) as [PlantId, ProfileData][]).map(([id, d]) => [
    id,
    { ...d, id, indoor: d.indoor ?? false, evergreen: d.evergreen ?? false } satisfies PlantProfile,
  ]),
) as Record<PlantId, PlantProfile>;

export function getPlantProfile(id: string): PlantProfile | undefined {
  return (PLANT_PROFILES as Record<string, PlantProfile>)[id];
}
