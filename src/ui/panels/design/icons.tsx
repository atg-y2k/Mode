/** Icons for surface kinds and outline tools (lucide-react). */
import {
  AppWindow,
  Archive,
  Blinds,
  BrickWall,
  Car,
  ChevronsUp,
  DoorClosed,
  DoorOpen,
  Eraser,
  Fence,
  Flower2,
  Footprints,
  Grid2x2,
  Grid3x3,
  House,
  Lasso,
  Layers,
  LayoutGrid,
  Palette,
  Paintbrush,
  PanelBottom,
  PanelTop,
  PanelTopDashed,
  PenTool,
  RectangleHorizontal,
  Rows3,
  Rows4,
  Shapes,
  Sparkle,
  Sprout,
  Square,
  WandSparkles,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { SurfaceKind } from '../../../../shared/types';
import type { ToolId } from '../../../state/store';
import { cn } from '../../common';

export const SURFACE_ICONS: Record<SurfaceKind, LucideIcon> = {
  wall: Square,
  'accent-wall': Palette,
  ceiling: PanelTop,
  trim: PanelBottom,
  door: DoorClosed,
  'window-frame': AppWindow,
  cabinet: Archive,
  floor: LayoutGrid,
  backsplash: Grid3x3,
  countertop: RectangleHorizontal,
  stair: ChevronsUp,
  siding: Rows4,
  roof: House,
  shutters: Blinds,
  'front-door': DoorOpen,
  'garage-door': Warehouse,
  fascia: PanelTopDashed,
  foundation: BrickWall,
  fence: Fence,
  deck: Rows3,
  patio: Grid2x2,
  path: Footprints,
  driveway: Car,
  lawn: Sprout,
  'planting-bed': Flower2,
  'retaining-wall': Layers,
  other: Shapes,
};

export function SurfaceIcon({ surface, className = 'size-4' }: { surface: SurfaceKind; className?: string }) {
  const Icon = SURFACE_ICONS[surface] ?? Shapes;
  return <Icon className={className} aria-hidden />;
}

/** Outline tools offered in the Surfaces panel, in palette order. */
export type OutlineTool = Extract<ToolId, 'smart-brush' | 'brush' | 'wand' | 'polygon' | 'lasso' | 'eraser'>;

export const OUTLINE_TOOLS: readonly { id: OutlineTool; label: string; shortcut: string; hint: string }[] = [
  {
    id: 'smart-brush',
    label: 'Smart',
    shortcut: 'S',
    hint: 'Brush over the surface — it only fills colors similar to where you start, so edges against trim, sky and plants stay clean.',
  },
  {
    id: 'wand',
    label: 'Wand',
    shortcut: 'W',
    hint: 'Tap once to grab an evenly colored area. Raise the tolerance if it misses patches, lower it if it spills over.',
  },
  {
    id: 'brush',
    label: 'Brush',
    shortcut: 'B',
    hint: 'Paint the outline by hand. A softer edge suits hedges, lawns and mulch.',
  },
  {
    id: 'polygon',
    label: 'Polygon',
    shortcut: 'P',
    hint: 'Click each corner, then finish on the first point — best for straight edges like doors, roofs and patios.',
  },
  {
    id: 'lasso',
    label: 'Lasso',
    shortcut: 'L',
    hint: 'Draw around an area freehand to fill it.',
  },
  {
    id: 'eraser',
    label: 'Eraser',
    shortcut: 'E',
    hint: 'Wipe away spill-over. Tip: hold Alt with any brush to subtract instead.',
  },
];

export function isOutlineTool(tool: ToolId): tool is OutlineTool {
  return OUTLINE_TOOLS.some((t) => t.id === tool);
}

function SmartBrushIcon({ className }: { className?: string }) {
  return (
    <span className="relative inline-flex" aria-hidden>
      <Paintbrush className={className} />
      <Sparkle className="absolute -right-1 -top-1 size-2.5" strokeWidth={2.5} />
    </span>
  );
}

const TOOL_ICONS: Record<OutlineTool, LucideIcon | typeof SmartBrushIcon> = {
  'smart-brush': SmartBrushIcon,
  brush: Paintbrush,
  wand: WandSparkles,
  polygon: PenTool,
  lasso: Lasso,
  eraser: Eraser,
};

export function OutlineToolIcon({ tool, className = 'size-[18px]' }: { tool: OutlineTool; className?: string }) {
  const Icon = TOOL_ICONS[tool];
  return <Icon className={cn(className)} aria-hidden />;
}
