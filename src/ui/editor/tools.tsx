/**
 * Tool metadata (labels, shortcuts, icons, guidance) and the shared
 * "activate tool" path used by the palette and keyboard shortcuts.
 */
import type { ComponentType, ReactNode } from 'react';
import {
  Eraser,
  Grid3x3,
  Hand,
  Lasso,
  MousePointer2,
  Paintbrush,
  PenTool,
  Pipette,
  Ruler,
  Sparkle,
  Stamp,
  WandSparkles,
} from 'lucide-react';
import { selectSelectedRegion, useStore, type ToolId } from '../../state/store';

export interface ToolMeta {
  id: ToolId;
  label: string;
  /** Single-key shortcut (shown uppercase). */
  shortcut?: string;
  /** One line shown in tooltips. */
  description: string;
  /** Mask / plane tools act on the selected surface. */
  needsRegion: boolean;
  group: 'navigate' | 'mask' | 'measure' | 'place';
}

export const TOOL_META: Record<ToolId, ToolMeta> = {
  select: {
    id: 'select',
    label: 'Select & move',
    shortcut: 'V',
    description: 'Pick plants, objects and lights to move, resize or rotate. Tap a surface to select it.',
    needsRegion: false,
    group: 'navigate',
  },
  pan: {
    id: 'pan',
    label: 'Pan',
    shortcut: 'H',
    description: 'Drag to move around. Hold Space with any tool to pan.',
    needsRegion: false,
    group: 'navigate',
  },
  'smart-brush': {
    id: 'smart-brush',
    label: 'Smart brush',
    shortcut: 'S',
    description: 'Paints only colors similar to where you start — clean edges between walls and trim.',
    needsRegion: true,
    group: 'mask',
  },
  brush: {
    id: 'brush',
    label: 'Brush',
    shortcut: 'B',
    description: 'Paint the selected surface by hand. Alt subtracts.',
    needsRegion: true,
    group: 'mask',
  },
  eraser: {
    id: 'eraser',
    label: 'Eraser',
    shortcut: 'E',
    description: 'Remove parts of the selected surface.',
    needsRegion: true,
    group: 'mask',
  },
  wand: {
    id: 'wand',
    label: 'Magic wand',
    shortcut: 'W',
    description: 'Tap to select an area of similar color. Shift-tap replaces the surface.',
    needsRegion: true,
    group: 'mask',
  },
  polygon: {
    id: 'polygon',
    label: 'Polygon',
    shortcut: 'P',
    description: 'Click corner points; close the shape to fill it. Great for straight edges.',
    needsRegion: true,
    group: 'mask',
  },
  lasso: {
    id: 'lasso',
    label: 'Lasso',
    shortcut: 'L',
    description: 'Draw a freehand outline to fill.',
    needsRegion: true,
    group: 'mask',
  },
  plane: {
    id: 'plane',
    label: 'Perspective plane',
    description: 'Match four corners to the surface so floors, patios and lawns recede realistically.',
    needsRegion: true,
    group: 'measure',
  },
  eyedropper: {
    id: 'eyedropper',
    label: 'Eyedropper',
    shortcut: 'I',
    description: 'Sample a color from the original photo.',
    needsRegion: false,
    group: 'measure',
  },
  calibrate: {
    id: 'calibrate',
    label: 'Measure / calibrate',
    shortcut: 'C',
    description: 'Draw along something of known length so sizes and areas are true to scale.',
    needsRegion: false,
    group: 'measure',
  },
  place: {
    id: 'place',
    label: 'Place',
    description: 'Place the plant, object or light chosen in the Library or Lighting panel.',
    needsRegion: false,
    group: 'place',
  },
};

/** Palette order. */
export const PALETTE_TOOLS: ToolId[][] = [
  ['select', 'pan'],
  ['smart-brush', 'brush', 'eraser', 'wand', 'polygon', 'lasso'],
  ['plane', 'eyedropper', 'calibrate'],
  ['place'],
];

export const MASK_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['brush', 'eraser', 'smart-brush', 'wand', 'polygon', 'lasso']);
export const BRUSH_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['brush', 'eraser', 'smart-brush']);

/** Shortcut key (lowercase) → tool. */
export const SHORTCUT_TOOLS: Record<string, ToolId> = Object.fromEntries(
  Object.values(TOOL_META)
    .filter((t) => t.shortcut)
    .map((t) => [t.shortcut!.toLowerCase(), t.id]),
);

function SmartBrushIcon({ className }: { className?: string }) {
  return (
    <span className="relative inline-flex">
      <Paintbrush className={className} />
      <Sparkle className="absolute -right-1 -top-1 size-2.5" strokeWidth={2.5} />
    </span>
  );
}

export const TOOL_ICONS: Record<ToolId, ComponentType<{ className?: string }>> = {
  select: MousePointer2,
  pan: Hand,
  'smart-brush': SmartBrushIcon,
  brush: Paintbrush,
  eraser: Eraser,
  wand: WandSparkles,
  polygon: PenTool,
  lasso: Lasso,
  plane: Grid3x3,
  eyedropper: Pipette,
  calibrate: Ruler,
  place: Stamp,
};

export function ToolIcon({ tool, className = 'size-[18px]' }: { tool: ToolId; className?: string }): ReactNode {
  const Icon = TOOL_ICONS[tool];
  return <Icon className={className} />;
}

let lastRegionPrompt = 0;

/** Tell the user a surface is needed and bring up the Surfaces panel (rate-limited). */
export function promptForRegion(): void {
  const s = useStore.getState();
  s.setPanel('surfaces');
  const now = Date.now();
  if (now - lastRegionPrompt < 2500) return;
  lastRegionPrompt = now;
  const hasRegions = (s.project?.spaces ?? []).some((sp) =>
    sp.photos.some((ph) => ph.id === s.selection.photoId && ph.regions.length > 0),
  );
  s.notify(
    hasRegions
      ? 'Select a surface in the Surfaces panel first, then outline it.'
      : 'Add a surface first (e.g. “Wall” or “Lawn”) in the Surfaces panel, then outline it.',
    'info',
  );
}

let lastPlacePrompt = 0;

export function promptForPlacement(): void {
  const s = useStore.getState();
  s.setPanel('library');
  const now = Date.now();
  if (now - lastPlacePrompt < 2500) return;
  lastPlacePrompt = now;
  s.notify('Choose a plant, object or light in the Library or Lighting panel, then tap the photo to place it.', 'info');
}

/** Switch tools from the palette or a shortcut, prompting for prerequisites. */
export function activateTool(tool: ToolId): void {
  const s = useStore.getState();
  if (tool === 'place') {
    if (!s.placement) {
      promptForPlacement();
      return;
    }
    s.setTool('place');
    return;
  }
  s.setTool(tool);
  if (TOOL_META[tool].needsRegion && !selectSelectedRegion(useStore.getState())) promptForRegion();
}

/** Brush radius steps for the [ and ] shortcuts. */
export function nextBrushRadius(radius: number, dir: 1 | -1): number {
  const next = dir > 0 ? Math.max(radius + 1, radius * 1.25) : Math.min(radius - 1, radius / 1.25);
  return Math.round(Math.max(2, Math.min(400, next)));
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** A modal dialog or menu owns the keyboard. */
export function overlayOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('[role="dialog"], [role="menu"]');
}
