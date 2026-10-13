/**
 * Fine-tune › Materials: textures for the selected surface — flooring, tile,
 * siding, roofing, decking, pavers, gravel, mulch, lawn… — suggested for the
 * surface (or all), grouped by category with rendered texture swatches; the
 * applied material's pattern size, rotation, tint and strength; and the
 * perspective plane that makes floors, patios and lawns recede realistically.
 */
import { useMemo } from 'react';
import { BrickWall } from 'lucide-react';
import type { Design, MaterialDef, MaterialTreatment, Photo, Region } from '../../../shared/types';
import { getMaterial } from '../../assets/catalog';
import { selectActiveDesign, selectActivePhoto, selectActiveSpace, selectSelectedRegion, useStore } from '../../state/store';
import { Button, EmptyState, PanelHeader, Section } from '../common';
import { applyTreatmentToRegions, openFinishPanel } from './design/actions';
import { CurrentMaterialCard, MaterialBrowser, MaterialControls } from './design/MaterialParts';
import { CalibrationCard, PerspectiveCard } from './design/MeasureCards';
import { materialTreatmentFor } from './design/materials';
import { displayHex, paintDisplayName, usedPaintColors } from './design/paint';
import { RegionBar, RegionPicker } from './design/RegionPicker';
import { isHorizontalSurface, surfaceNoun } from './design/surfaceKinds';
import { Callout } from './design/ui';

export function MaterialsPanel() {
  const photo = useStore(selectActivePhoto);
  const design = useStore(selectActiveDesign);
  const space = useStore(selectActiveSpace);
  const region = useStore(selectSelectedRegion);

  if (!photo || !design) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <PanelHeader title="Materials" subtitle="Flooring, tile, siding, pavers, lawn…" />
        <EmptyState icon={<BrickWall className="size-6" />} title="No photo open">
          Open a photo of this space to try new floors, tile, siding, roofing, pavers, mulch or a fresh lawn.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <PanelHeader title="Materials" subtitle={region ? `${region.name} · ${design.name}` : `Textures for ${design.name}`} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {region ? (
          <MaterialEditor key={region.id} photo={photo} design={design} region={region} />
        ) : (
          <RegionPicker purpose="materials" photo={photo} design={design} spaceType={space?.type} />
        )}
      </div>
    </div>
  );
}

function MaterialEditor({ photo, design, region }: { photo: Photo; design: Design; region: Region }) {
  const project = useStore((s) => s.project);
  const treatment = design.treatments[region.id];
  const applied = treatment?.type === 'material' ? treatment : undefined;
  const material = applied ? getMaterial(applied.materialId) : undefined;
  const paint = treatment?.type === 'paint' ? treatment : undefined;
  const horizontal = isHorizontalSurface(region.surface);
  const others = photo.regions.filter((r) => r.surface === region.surface && r.id !== region.id);

  const tintChoices = useMemo(
    () =>
      usedPaintColors(project)
        .slice(0, 6)
        .map((u) => ({ hex: u.hex, name: u.name ?? displayHex(u.hex) })),
    [project],
  );

  const pick = (m: MaterialDef) => useStore.getState().setTreatment(region.id, materialTreatmentFor(m, treatment));
  const change = (patch: Partial<MaterialTreatment>, key?: string) => {
    if (!applied) return;
    const next: MaterialTreatment = { ...applied, ...patch };
    if (!next.tint) delete next.tint;
    useStore.getState().setTreatment(region.id, next, key ? { coalesce: `panel:material-${key}:${region.id}` } : undefined);
  };

  return (
    <>
      <Section title="Surface">
        <RegionBar photo={photo} design={design} region={region} purpose="materials" />
        {paint && (
          <Callout tone="info">
            Currently painted <span className="font-medium text-text">{paintDisplayName(paint)}</span>. Picking a material replaces the paint.
          </Callout>
        )}
      </Section>

      <Section title="Material on this surface">
        {applied ? (
          <>
            <CurrentMaterialCard material={material} onRemove={() => useStore.getState().setTreatment(region.id, null)} />
            {horizontal && !region.plane && <PerspectiveCard region={region} prompt />}
            <MaterialControls material={material} treatment={applied} tintChoices={tintChoices} onChange={change} />
            {others.length > 0 && material && (
              <Button
                className="self-start"
                size="sm"
                variant="soft"
                onClick={() => {
                  applyTreatmentToRegions(
                    others.map((r) => r.id),
                    applied,
                  );
                  useStore.getState().notify(`${material.name} applied to ${others.length + 1} ${surfaceNoun(region.surface)} surfaces.`, 'success');
                }}
              >
                Apply to {others.length === 1 ? 'the other' : `all ${others.length} other`} {surfaceNoun(region.surface)} surface{others.length === 1 ? '' : 's'}
              </Button>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong p-3">
            <span aria-hidden className="size-12 shrink-0 rounded-xl border border-dashed border-line-strong bg-surface-2" />
            <p className="text-xs leading-relaxed text-muted">
              <span className="font-medium text-text">No material yet.</span> Tap a texture below — it follows the photo’s light and shadow, and you
              can undo anything.
            </p>
          </div>
        )}
      </Section>

      <Section title={`Materials for ${surfaceNoun(region.surface)}`}>
        <MaterialBrowser surface={region.surface} currentId={applied?.materialId} onPick={pick} onGoToPaint={() => openFinishPanel(region.id, 'paint')} />
      </Section>

      <Section title="Perspective & scale">
        <PerspectiveCard region={region} />
        <div className="border-t border-line pt-3">
          <CalibrationCard photo={photo} />
        </div>
      </Section>
    </>
  );
}
