/**
 * Catalog / library card: checkerboard thumbnail, name, plant badges or light
 * color, cost range. Tapping the card arms placement; the corner button opens
 * the details sheet.
 */
import { Info, MoreHorizontal, MousePointerClick, Sparkles, User } from 'lucide-react';
import type { AssetDef } from '../../../../shared/types';
import { cn, IconButton } from '../../common';
import { AssetThumb } from './AssetThumb';
import { KelvinChip, PlantBadges } from './controls';
import { formatCostRange } from './format';

export function SourceBadge({ source, className }: { source: AssetDef['source']; className?: string }) {
  if (source === 'builtin') return null;
  const ai = source === 'ai';
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full bg-surface/90 px-1.5 text-[10px] font-semibold text-text shadow-sm ring-1 ring-line backdrop-blur',
        className,
      )}
      title={ai ? 'Generated with AI' : 'Your upload'}
    >
      {ai ? <Sparkles className="size-3 text-accent" aria-hidden /> : <User className="size-3 text-accent" aria-hidden />}
      {ai ? 'AI' : 'Mine'}
    </span>
  );
}

export function AssetCard({
  asset,
  zone,
  armed,
  onPick,
  onInfo,
}: {
  asset: AssetDef;
  /** Project USDA zone number (plant badges show whether the plant fits). */
  zone: number | undefined;
  armed: boolean;
  onPick: () => void;
  onInfo: () => void;
}) {
  const cost = formatCostRange(asset.cost);
  const mine = asset.source !== 'builtin';
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={armed}
        title={armed ? 'Placing — tap again to cancel' : `Place ${asset.name} on the photo`}
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-xl border bg-surface text-left transition-[border-color,box-shadow]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          armed ? 'border-accent ring-2 ring-accent/35' : 'border-line hover:border-line-strong hover:shadow-panel',
        )}
      >
        <AssetThumb asset={asset} className="aspect-square w-full rounded-none" />
        <span className="flex min-w-0 flex-col gap-1 px-2 pb-2 pt-1.5">
          <span className="line-clamp-2 text-xs font-medium leading-snug text-text">{asset.name}</span>
          {asset.plant?.botanical && <span className="truncate text-[11px] italic leading-tight text-muted">{asset.plant.botanical}</span>}
          {asset.plant && <PlantBadges plant={asset.plant} zone={zone} />}
          {asset.category === 'lighting' && asset.light && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <KelvinChip kelvin={asset.light.kelvin} />
              {asset.light.lumens > 0 && <span className="tabular-nums">{Math.round(asset.light.lumens)} lm</span>}
            </span>
          )}
          {cost && <span className="text-[11px] tabular-nums text-muted">{cost}</span>}
        </span>
      </button>
      {armed ? (
        <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex h-5 items-center gap-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg shadow-sm">
          <MousePointerClick className="size-3" aria-hidden />
          Placing
        </span>
      ) : (
        mine && <SourceBadge source={asset.source} className="pointer-events-none absolute left-1.5 top-1.5" />
      )}
      <IconButton
        label={mine ? `Details, edit or delete ${asset.name}` : `About ${asset.name}`}
        size="sm"
        onClick={onInfo}
        className="absolute right-1 top-1 bg-surface/85 shadow-sm backdrop-blur pointer-coarse:size-9"
      >
        {mine ? <MoreHorizontal className="size-4" /> : <Info className="size-4" />}
      </IconButton>
    </div>
  );
}
