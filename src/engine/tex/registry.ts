import type { TexturePattern } from '../../../shared/types';
import { boardBatten, deckBoards, lapSiding, shiplap, standingSeam, woodPlanks } from './boards';
import type { PatternFactory } from './plan';
import { cobblestone, flagstone, gravel, stonePavers, stoneVeneer } from './stones';
import { brick, hexTile, subway, tileGrid } from './tiles';

export const PATTERNS: Record<TexturePattern, PatternFactory> = new Proxy({
  'wood-planks': woodPlanks,
  'deck-boards': deckBoards,
  shiplap,
  'lap-siding': lapSiding,
  'board-batten': boardBatten,
  'standing-seam': standingSeam,
  'tile-grid': tileGrid, subway, 'hex-tile': hexTile, brick,
  'stone-pavers': stonePavers, flagstone, cobblestone, gravel, 'stone-veneer': stoneVeneer,
} as Record<string, PatternFactory>, { get: (t, k: string) => t[k] ?? woodPlanks }) as Record<TexturePattern, PatternFactory>;
