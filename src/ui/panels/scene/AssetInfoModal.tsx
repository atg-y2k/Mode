/**
 * Details sheet for a catalog or library asset: plant facts (sun, water,
 * hardiness vs. the project's zone, mature size…), light facts (beam, color,
 * lumens, reach), price and where to buy. Library items can be edited or
 * deleted from here.
 */
import { ExternalLink, MousePointerClick, Pencil, Trash2 } from 'lucide-react';
import type { AssetDef, LightInfo, PlantInfo } from '../../../../shared/types';
import { Badge, Button, Modal } from '../../common';
import { AssetThumb } from './AssetThumb';
import { SourceBadge } from './AssetCard';
import { Callout, FactRow, KelvinChip } from './controls';
import {
  ASSET_CATEGORY_LABELS,
  BEAM_HINTS,
  BEAM_LABELS,
  PLANT_TYPE_LABELS,
  SUN_LABELS,
  WATER_LABELS,
  formatCostRange,
  formatFeetShort,
  lampColorName,
  matureSizeLabel,
  zoneFit,
  zoneShortLabel,
} from './format';

function HardinessNote({ plant, zone, zoneLabel }: { plant: PlantInfo; zone: number | undefined; zoneLabel: string | undefined }) {
  if (plant.indoor) return null;
  const range = zoneShortLabel(plant);
  if (!range) return null;
  const fit = zoneFit(plant, zone);
  const zones = range.slice(1);
  if (fit === 'unknown') {
    return (
      <Callout>
        Hardy in USDA zones {zones}. Add your ZIP code or hardiness zone in Settings to check it against your garden.
      </Callout>
    );
  }
  if (fit === 'fits') {
    return (
      <Callout tone="accent">
        Hardy in zones {zones} — a good fit for your zone {zoneLabel}.
      </Callout>
    );
  }
  const tooCold = plant.zoneMin !== undefined && zone !== undefined && zone < plant.zoneMin;
  return (
    <Callout tone="warning">
      Hardy in zones {zones} — your zone {zoneLabel} is too {tooCold ? 'cold for it to survive winter' : 'hot for it to thrive'}. Fine in a
      container you can move, or pick a hardier alternative.
    </Callout>
  );
}

function PlantFacts({ plant }: { plant: PlantInfo }) {
  return (
    <dl>
      <FactRow label="Type">{PLANT_TYPE_LABELS[plant.type] ?? plant.type}</FactRow>
      <FactRow label="Light">{plant.sun.map((s) => SUN_LABELS[s]).join(', ') || '—'}</FactRow>
      <FactRow label="Water">{WATER_LABELS[plant.water]}</FactRow>
      {!plant.indoor && zoneShortLabel(plant) && <FactRow label="Hardiness">USDA zones {zoneShortLabel(plant)!.slice(1)}</FactRow>}
      <FactRow label="Mature size">{matureSizeLabel(plant)}</FactRow>
      <FactRow label="Foliage">{plant.evergreen ? 'Evergreen' : 'Deciduous'}</FactRow>
      {plant.bloom && <FactRow label="Bloom">{plant.bloom}</FactRow>}
      {plant.deerResistant !== undefined && <FactRow label="Deer resistant">{plant.deerResistant ? 'Yes' : 'No'}</FactRow>}
      {plant.native && <FactRow label="Native to">{plant.native}</FactRow>}
      {plant.containerSize && <FactRow label="Nursery size">{plant.containerSize}</FactRow>}
      <FactRow label="Grown">{plant.indoor ? 'Indoors (houseplant)' : 'Outdoors'}</FactRow>
    </dl>
  );
}

function LightFacts({ light }: { light: LightInfo }) {
  const use = light.indoor && light.outdoor ? 'Indoor & outdoor' : light.outdoor ? 'Outdoor' : 'Indoor';
  return (
    <dl>
      <FactRow label="Light spread">
        <span title={BEAM_HINTS[light.beam]}>{BEAM_LABELS[light.beam]}</span>
      </FactRow>
      <FactRow label="Color">
        <span className="inline-flex items-center gap-1.5">
          <KelvinChip kelvin={light.kelvin} />
          {lampColorName(light.kelvin)}
        </span>
      </FactRow>
      {light.lumens > 0 && <FactRow label="Brightness">{Math.round(light.lumens).toLocaleString('en-US')} lumens</FactRow>}
      {light.reachFt > 0 && <FactRow label="Reach">about {formatFeetShort(light.reachFt)}</FactRow>}
      {light.mountHeightFt !== undefined && light.mountHeightFt > 0 && (
        <FactRow label="Typical mounting">{formatFeetShort(light.mountHeightFt)} up</FactRow>
      )}
      <FactRow label="Use">{use}</FactRow>
    </dl>
  );
}

export function AssetInfoModal({
  asset,
  onClose,
  zone,
  zoneLabel,
  canPlace,
  onPlace,
  onEdit,
  onDelete,
}: {
  asset: AssetDef | null;
  onClose: () => void;
  zone: number | undefined;
  zoneLabel: string | undefined;
  /** False when no photo is open. */
  canPlace: boolean;
  onPlace: (asset: AssetDef) => void;
  onEdit?: (asset: AssetDef) => void;
  onDelete?: (asset: AssetDef) => void;
}) {
  if (!asset) return null;
  const mine = asset.source !== 'builtin';
  const cost = formatCostRange(asset.cost);
  const vendor = asset.product?.url ?? asset.vendorUrl;
  const store = asset.product?.store;
  return (
    <Modal
      open
      onClose={onClose}
      title={asset.name}
      size="md"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {mine && onDelete && (
            <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => onDelete(asset)}>
              Delete
            </Button>
          )}
          {mine && onEdit && (
            <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => onEdit(asset)}>
              Edit
            </Button>
          )}
          <Button
            variant="primary"
            className="ml-auto"
            data-autofocus
            icon={<MousePointerClick className="size-4" />}
            disabled={!canPlace}
            title={canPlace ? undefined : 'Open a photo to place items'}
            onClick={() => onPlace(asset)}
          >
            Place on photo
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <AssetThumb asset={asset} className="h-44 w-full shrink-0 rounded-xl border border-line sm:size-40" />
          <div className="flex min-w-0 flex-col gap-2">
            {asset.plant?.botanical && <p className="text-sm italic text-muted">{asset.plant.botanical}</p>}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge>{ASSET_CATEGORY_LABELS[asset.category]}</Badge>
              {asset.subcategory && <Badge>{asset.subcategory.replace(/[-_]+/g, ' ')}</Badge>}
              <SourceBadge source={asset.source} />
            </div>
            {asset.description && <p className="text-sm leading-relaxed text-text">{asset.description}</p>}
            <dl className="text-sm">
              <FactRow label="Typical height">{formatFeetShort(asset.realHeightFt)}</FactRow>
              {cost && (
                <FactRow label="Price">
                  {cost}
                  {asset.plant?.containerSize && <span className="text-muted"> · {asset.plant.containerSize}</span>}
                </FactRow>
              )}
            </dl>
          </div>
        </div>

        {asset.plant && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Growing</h3>
            <HardinessNote plant={asset.plant} zone={zone} zoneLabel={zoneLabel} />
            <PlantFacts plant={asset.plant} />
          </section>
        )}

        {asset.light && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Light</h3>
            <LightFacts light={asset.light} />
            <p className="text-xs text-muted">
              Placed fixtures glow with this color — strongest at dusk and night. You can change the color and brightness after placing it.
            </p>
          </section>
        )}

        {asset.product && asset.product.specs.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Specs</h3>
            <ul className="flex flex-wrap gap-1.5">
              {asset.product.specs.map((s) => (
                <li key={s}>
                  <Badge>{s}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        {vendor && /^https?:\/\//i.test(vendor) && (
          <a
            href={vendor}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent underline-offset-2 hover:underline"
          >
            {store ? `View at ${store}` : 'Where to buy'}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}

        {!canPlace && <Callout>Open a photo of this space to place items on it.</Callout>}
        {asset.tags.length > 0 && (
          <p className="text-[11px] text-subtle">
            <span className="sr-only">Tags: </span>
            {asset.tags.slice(0, 10).join(' · ')}
          </p>
        )}
      </div>
    </Modal>
  );
}
