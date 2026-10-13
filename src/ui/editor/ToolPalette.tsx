/**
 * Tool palette: vertical rail on desktop, horizontally scrolling strip on
 * phones. Tooltips show the tool name, its shortcut and a one-line hint.
 */
import { Fragment } from 'react';
import { resolveAsset, selectSelectedRegion, useStore, type ToolId } from '../../state/store';
import { cn } from '../common';
import { Kbd, Tooltip } from './Tooltip';
import { PALETTE_TOOLS, TOOL_META, ToolIcon, activateTool } from './tools';

export function ToolPalette({ className }: { className?: string }) {
  return (
    <div
      role="toolbar"
      aria-label="Editing tools"
      className={cn(
        'scroll-thin flex shrink-0 items-center gap-1 overflow-x-auto border-t border-line bg-surface px-2 py-1.5',
        'lg:w-14 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:border-r lg:border-t-0 lg:px-0 lg:py-2',
        className,
      )}
    >
      {PALETTE_TOOLS.map((group, gi) => (
        <Fragment key={group.join('-')}>
          {gi > 0 && <div aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line lg:mx-0 lg:my-1 lg:h-px lg:w-7" />}
          {group.map((id) => (
            <ToolButton key={id} id={id} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function ToolButton({ id }: { id: ToolId }) {
  const active = useStore((s) => s.tool === id);
  const needsRegion = TOOL_META[id].needsRegion;
  const missingRegion = useStore((s) => needsRegion && !selectSelectedRegion(s));
  const placementName = useStore((s) => {
    if (id !== 'place' || !s.placement) return null;
    return s.placement.kind === 'object' ? (resolveAsset(s.placement.assetId)?.name ?? 'item') : s.placement.name;
  });
  const meta = TOOL_META[id];
  const armed = id === 'place' && !!placementName;
  const disabledLook = (id === 'place' && !armed) || missingRegion;

  return (
    <Tooltip
      side="auto"
      content={
        <span className="block">
          <span className="flex items-center font-semibold">
            {meta.label}
            {meta.shortcut && <Kbd>{meta.shortcut}</Kbd>}
          </span>
          <span className="mt-0.5 block opacity-85">
            {armed ? `Placing “${placementName}” — tap the photo. Hold Shift to place several.` : meta.description}
          </span>
          {missingRegion && <span className="mt-1 block font-medium">Select a surface first.</span>}
          {id === 'place' && !armed && <span className="mt-1 block font-medium">Pick something in the Library first.</span>}
        </span>
      }
    >
      <button
        type="button"
        aria-label={meta.shortcut ? `${meta.label} (${meta.shortcut})` : meta.label}
        aria-pressed={active}
        aria-keyshortcuts={meta.shortcut}
        onClick={() => activateTool(id)}
        onPointerUp={(e) => {
          // Mouse clicks shouldn't leave focus on the button (Space = temporary pan).
          if (e.pointerType === 'mouse') e.currentTarget.blur();
        }}
        className={cn(
          'relative inline-flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
          active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-text',
          !active && disabledLook && 'opacity-55',
        )}
      >
        <ToolIcon tool={id} />
        {armed && <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-surface" />}
      </button>
    </Tooltip>
  );
}
