/**
 * Inspector for the selected placed object (plant, decor, uploaded item):
 * size, rotation, flip, opacity, contact shadow, tint (vector art), layer
 * order, duplicate and delete. Shown at the top of the Library panel.
 */
import { useMemo } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BringToFront,
  Copy,
  FlipHorizontal2,
  Ruler,
  RotateCcw,
  SendToBack,
  Trash2,
  X,
} from 'lucide-react';
import type { AssetCategory, Design, Photo, PlacedObject } from '../../../../shared/types';
import { findAsset } from '../../../assets/catalog';
import { defaultObjectHeightPx, pxPerFoot } from '../../../assetList/area';
import { useStore } from '../../../state/store';
import { Button, cn, IconButton, Slider, Swatch, Toggle } from '../../common';
import { AssetThumb } from './AssetThumb';
import { Callout, LogSlider } from './controls';
import { ASSET_CATEGORY_LABELS, formatDegrees, formatFeetShort, formatPercent, formatSize, isVectorAsset } from './format';
import { isNarrowScreen } from './placement';

interface Tint {
  hex: string;
  name: string;
}

const FOLIAGE_TINTS: Tint[] = [
  { hex: '#3f6b35', name: 'Deep green' },
  { hex: '#6f9a46', name: 'Fresh green' },
  { hex: '#a3b45a', name: 'Chartreuse' },
  { hex: '#6c8a83', name: 'Blue-green' },
  { hex: '#7a2e35', name: 'Burgundy' },
  { hex: '#b4603a', name: 'Copper' },
  { hex: '#c9a33a', name: 'Gold' },
  { hex: '#8a6aa8', name: 'Purple' },
];

const FINISH_TINTS: Tint[] = [
  { hex: '#1e1e1e', name: 'Matte black' },
  { hex: '#b08d57', name: 'Brass' },
  { hex: '#a7abae', name: 'Brushed nickel' },
  { hex: '#4e3b2d', name: 'Oil-rubbed bronze' },
  { hex: '#ecebe6', name: 'White' },
  { hex: '#6e7378', name: 'Galvanized' },
];

const DECOR_TINTS: Tint[] = [
  { hex: '#1f1f1f', name: 'Black' },
  { hex: '#f1ede5', name: 'Warm white' },
  { hex: '#80807a', name: 'Gray' },
  { hex: '#8a5d3b', name: 'Walnut' },
  { hex: '#c9a87c', name: 'Natural oak' },
  { hex: '#b0573b', name: 'Terracotta' },
  { hex: '#2e4a66', name: 'Navy' },
  { hex: '#5d7457', name: 'Sage' },
];

const STONE_TINTS: Tint[] = [
  { hex: '#8d8a83', name: 'Granite gray' },
  { hex: '#b9ab92', name: 'Limestone' },
  { hex: '#6d6258', name: 'Bluestone brown' },
  { hex: '#a45d45', name: 'Brick red' },
  { hex: '#4a4a48', name: 'Charcoal' },
  { hex: '#d5cdbd', name: 'Sandstone' },
];

/** Tint presets per category (data colors). */
const TINTS: Record<AssetCategory, Tint[]> = {
  plant: FOLIAGE_TINTS,
  lighting: FINISH_TINTS,
  decor: DECOR_TINTS,
  furniture: DECOR_TINTS,
  hardscape: STONE_TINTS,
  other: DECOR_TINTS,
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function ObjectInspector({ obj, photo, design }: { obj: PlacedObject; photo: Photo; design: Design }) {
  const library = useStore((s) => s.library);
  const asset = useMemo(() => findAsset(obj.assetId, library), [obj.assetId, library]);
  const ppf = pxPerFoot(photo.calibration);
  const key = `panel:object:${obj.id}`;
  const update = (patch: Partial<Omit<PlacedObject, 'id'>>, coalesce?: string) =>
    useStore.getState().updateObject(obj.id, patch, coalesce ? { coalesce: `${key}:${coalesce}` } : {});

  const ordered = useMemo(() => [...design.objects].sort((a, b) => a.z - b.z), [design.objects]);
  const rank = ordered.findIndex((o) => o.id === obj.id);
  const count = ordered.length;
  const atFront = rank === count - 1;
  const atBack = rank <= 0;

  const minH = 8;
  const maxH = Math.max(photo.height * 1.6, obj.height * 1.2, minH * 4);
  const realHeightPx = asset && ppf ? asset.realHeightFt * ppf : null;

  const name = obj.label || asset?.name || 'Missing item';
  const tints = asset ? (TINTS[asset.category] ?? DECOR_TINTS) : [];
  const tintable = isVectorAsset(asset);

  const resetSize = () => {
    if (!asset) return;
    let h: number;
    try {
      h = defaultObjectHeightPx(asset, photo);
    } catch {
      h = photo.height * 0.15;
    }
    if (Number.isFinite(h) && h > 0) update({ height: h });
  };

  const startCalibration = () => {
    const s = useStore.getState();
    s.setTool('calibrate');
    if (isNarrowScreen()) s.setView({ mobilePane: 'editor' });
    s.notify('Drag along something whose length you know — a door, a fence panel, a step.', 'info');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <AssetThumb asset={asset} tint={tintable ? obj.tint : undefined} className="size-14 shrink-0 border border-line" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-text">{name}</p>
          <p className="truncate text-xs text-muted">
            {asset ? ASSET_CATEGORY_LABELS[asset.category] : 'Not in your library'}
            {count > 1 && ` · layer ${rank + 1} of ${count}`}
          </p>
        </div>
        <IconButton label="Done — deselect" onClick={() => useStore.getState().select({ objectId: null })}>
          <X className="size-4" />
        </IconButton>
      </div>

      {!asset && (
        <Callout tone="warning">
          This item’s artwork was deleted from your library, so it can’t be drawn. Delete it to tidy up this design.
        </Callout>
      )}

      {asset && (
        <>
          <div className="flex flex-col gap-2">
            <LogSlider
              label="Size"
              value={obj.height}
              min={minH}
              max={maxH}
              valueText={`${formatSize(obj.height, ppf)} tall`}
              onChange={(h) => update({ height: h }, 'height')}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {realHeightPx ? (
                <button
                  type="button"
                  className="font-medium text-accent underline-offset-2 hover:underline disabled:pointer-events-none disabled:text-subtle"
                  disabled={Math.abs(realHeightPx - obj.height) < 1}
                  onClick={resetSize}
                >
                  Real size ({formatFeetShort(asset.realHeightFt)})
                </button>
              ) : (
                <>
                  <span>Typically {formatFeetShort(asset.realHeightFt)} tall.</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium text-accent underline-offset-2 hover:underline"
                    onClick={startCalibration}
                  >
                    <Ruler className="size-3.5" aria-hidden />
                    Set the photo’s scale
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Slider
                label="Rotation"
                value={Math.round(obj.rotation)}
                min={-180}
                max={180}
                step={1}
                format={formatDegrees}
                onChange={(v) => update({ rotation: v }, 'rotation')}
              />
            </div>
            <IconButton label="Straighten" size="sm" disabled={Math.round(obj.rotation) === 0} onClick={() => update({ rotation: 0 })}>
              <RotateCcw className="size-4" />
            </IconButton>
          </div>

          <Slider
            label="Opacity"
            value={Math.round(obj.opacity * 100)}
            min={10}
            max={100}
            step={1}
            format={(v) => formatPercent(v / 100)}
            onChange={(v) => update({ opacity: v / 100 }, 'opacity')}
          />

          <div className="flex flex-col gap-3">
            <Toggle label="Contact shadow" checked={obj.shadow} onChange={(v) => update({ shadow: v })} />
            <Button
              size="sm"
              className="self-start"
              aria-pressed={obj.flipX}
              icon={<FlipHorizontal2 className="size-4" />}
              onClick={() => update({ flipX: !obj.flipX })}
            >
              {obj.flipX ? 'Flipped' : 'Flip horizontally'}
            </Button>
          </div>

          {tintable && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted">Color</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={!obj.tint}
                  onClick={() => update({ tint: undefined })}
                  className={cn(
                    'inline-flex h-6 items-center rounded-lg border border-line px-2 text-[11px] font-medium text-muted transition-colors hover:text-text',
                    'focus-visible:outline-2 focus-visible:outline-accent',
                    !obj.tint && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                  )}
                >
                  Original
                </button>
                {tints.map((t) => (
                  <Swatch key={t.hex} hex={t.hex} size="sm" title={t.name} selected={obj.tint?.toLowerCase() === t.hex} onClick={() => update({ tint: t.hex })} />
                ))}
                <input
                  type="color"
                  aria-label="Custom color"
                  title="Custom color"
                  value={obj.tint && HEX_RE.test(obj.tint) ? obj.tint : '#808080'}
                  onChange={(e) => update({ tint: e.target.value }, 'tint')}
                  className="h-6 w-8 cursor-pointer rounded-lg border border-line bg-surface p-0.5"
                />
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted">Layer</span>
        <div className="flex items-center gap-1" role="group" aria-label="Layer order">
          <IconButton label="Send to back" size="sm" disabled={atBack} onClick={() => useStore.getState().reorderObject(obj.id, 'back')}>
            <SendToBack className="size-4" />
          </IconButton>
          <IconButton label="Send backward" size="sm" disabled={atBack} onClick={() => useStore.getState().reorderObject(obj.id, 'backward')}>
            <ArrowDown className="size-4" />
          </IconButton>
          <IconButton label="Bring forward" size="sm" disabled={atFront} onClick={() => useStore.getState().reorderObject(obj.id, 'forward')}>
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton label="Bring to front" size="sm" disabled={atFront} onClick={() => useStore.getState().reorderObject(obj.id, 'front')}>
            <BringToFront className="size-4" />
          </IconButton>
        </div>
        {count > 1 && <p className="text-xs text-subtle">Things lower in the photo are closer to the camera, so they usually go in front.</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {asset && (
          <Button size="sm" icon={<Copy className="size-4" />} onClick={() => useStore.getState().duplicateObject(obj.id)}>
            Duplicate
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => useStore.getState().deleteObject(obj.id)}>
          Delete
        </Button>
      </div>
    </div>
  );
}
