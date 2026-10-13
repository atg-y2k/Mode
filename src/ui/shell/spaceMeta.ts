/**
 * Icons and short descriptions for space types (Add space tiles, sidebar rows,
 * empty states).
 */
import {
  Armchair,
  Baby,
  Bath,
  BedDouble,
  Briefcase,
  Car,
  CookingPot,
  DoorOpen,
  DoorStairwell,
  Fence,
  Flower2,
  House,
  HouseHeart,
  Houses,
  Sofa,
  Sprout,
  Tent,
  TreeDeciduous,
  Trees,
  UtensilsCrossed,
  Warehouse,
  WashingMachine,
  WavesLadder,
  Footprints,
  type LucideIcon,
} from 'lucide-react';
import { EXTERIOR_SPACE_TYPES, INTERIOR_SPACE_TYPES, type SpaceType } from '../../../shared/types';

export const SPACE_ICONS: Record<SpaceType, LucideIcon> = {
  'living-room': Sofa,
  bedroom: BedDouble,
  kitchen: CookingPot,
  bathroom: Bath,
  'dining-room': UtensilsCrossed,
  office: Briefcase,
  entryway: DoorOpen,
  hallway: Footprints,
  basement: DoorStairwell,
  laundry: WashingMachine,
  nursery: Baby,
  'other-interior': Armchair,
  'front-exterior': House,
  'back-exterior': HouseHeart,
  'side-exterior': Houses,
  'front-yard': Flower2,
  backyard: Trees,
  'side-yard': Sprout,
  patio: Tent,
  deck: Fence,
  'pool-area': WavesLadder,
  garden: TreeDeciduous,
  driveway: Car,
  'other-exterior': Warehouse,
};

/** A few words under the tile label in the Add space modal. */
export const SPACE_HINTS: Partial<Record<SpaceType, string>> = {
  'living-room': 'Walls, floors, lighting',
  kitchen: 'Cabinets, counters, backsplash',
  bathroom: 'Tile, vanity, fixtures',
  bedroom: 'Paint, flooring, lamps',
  'front-exterior': 'Paint, door, roof, porch',
  'front-yard': 'Walkway, beds, lawn, lights',
  backyard: 'Patio, planting, privacy',
  patio: 'Pavers, furniture, string lights',
  deck: 'Boards, railing, planters',
  garden: 'Beds, borders, paths',
  driveway: 'Surface, edging, lighting',
  'pool-area': 'Coping, planting, lighting',
};

/** Most common types first in each group. */
export const INTERIOR_ORDER: readonly SpaceType[] = INTERIOR_SPACE_TYPES;
export const EXTERIOR_ORDER: readonly SpaceType[] = EXTERIOR_SPACE_TYPES;
