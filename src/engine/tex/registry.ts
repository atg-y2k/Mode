/** Pattern → generator lookup. Every TexturePattern must have an entry. */
import type { TexturePattern } from '../../../shared/types';
import { boardBatten, deckBoards, lapSiding, shiplap, standingSeam, woodPlanks } from './boards';
import { grass, mulch } from './organic';
import { chevron, herringbone } from './parquet';
import type { PatternFactory } from './plan';
import { roofShingles, shingleSiding } from './roofing';
import { cobblestone, flagstone, gravel, stonePavers, stoneVeneer } from './stones';
import { carpet, concrete, marble, stucco, terrazzo } from './surfaces';
import { brick, hexTile, subway, tileGrid } from './tiles';

export const PATTERNS: Record<TexturePattern, PatternFactory> = {
  'wood-planks': woodPlanks,
  herringbone,
  chevron,
  'tile-grid': tileGrid,
  subway,
  'hex-tile': hexTile,
  brick,
  'stone-pavers': stonePavers,
  flagstone,
  cobblestone,
  gravel,
  mulch,
  grass,
  concrete,
  stucco,
  'lap-siding': lapSiding,
  'board-batten': boardBatten,
  'shingle-siding': shingleSiding,
  'roof-shingles': roofShingles,
  'standing-seam': standingSeam,
  'deck-boards': deckBoards,
  carpet,
  marble,
  terrazzo,
  'stone-veneer': stoneVeneer,
  shiplap,
};
