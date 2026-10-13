/**
 * Paint and Materials work on one surface at a time.
 * - RegionPicker: shown when no surface is selected — pick an existing one or add a new one.
 * - RegionBar: shown on top when a surface is selected — switch surface, plus
 *   warnings when it has no outline yet or its finish is hidden.
 */
import { ChevronRight, Paintbrush, Shapes } from 'lucide-react';
import { SURFACE_LABELS, type Design, type Photo, type Region, type SpaceType } from '../../../../shared/types';
import { useStore } from '../../../state/store';
import { Button, IconButton, Section, Select } from '../../common';
import { activateCanvasTool, selectRegion } from './actions';
import { AddSurfaceGrid, type FinishPurpose } from './AddSurfaceGrid';
import { useRegionStats } from './hooks';
import { surfaceNoun } from './surfaceKinds';
import { TreatmentSwatch, treatmentLabel } from './TreatmentSwatch';
import { Callout, RegionDot, StepGuide } from './ui';

const ADD_NEW = '__add__';

export function RegionPicker({
  purpose,
  photo,
  design,
  spaceType,
}: {
  purpose: FinishPurpose;
  photo: Photo;
  design: Design;
  spaceType: SpaceType | undefined;
}) {
  const regions = photo.regions;
  const verb = purpose === 'paint' ? 'paint' : 'cover with a new material';
  return (
    <>
      {regions.length > 0 ? (
        <Section title="Choose a surface">
          <p className="text-xs text-muted">Which surface do you want to {verb}? Each one keeps its own finish in every design option.</p>
          <ul className="flex flex-col gap-1.5" aria-label="Surfaces in this photo">
            {regions.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => selectRegion(r.id)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                >
                  <RegionDot color={r.color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{r.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {SURFACE_LABELS[r.surface]} · {treatmentLabel(design.treatments[r.id])}
                    </span>
                  </span>
                  <TreatmentSwatch treatment={design.treatments[r.id]} hidden={design.hiddenRegionIds.includes(r.id)} className="size-8" />
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <Section title="Start here">
          <p className="text-sm text-text">
            {purpose === 'paint' ? 'Try a color on any surface of the photo in three steps:' : 'Try flooring, tile, siding, pavers or a fresh lawn in three steps:'}
          </p>
          <StepGuide current={1} />
        </Section>
      )}
      <Section title={regions.length > 0 ? 'Or add a new surface' : 'Add a surface'}>
        <AddSurfaceGrid spaceType={spaceType} purpose={purpose} />
      </Section>
    </>
  );
}

export function RegionBar({ photo, design, region, purpose }: { photo: Photo; design: Design; region: Region; purpose: FinishPurpose }) {
  const stats = useRegionStats(region, photo);
  const hidden = design.hiddenRegionIds.includes(region.id);
  const what = purpose === 'paint' ? 'color' : 'material';
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <RegionDot color={region.color} className="ml-1" />
        <Select
          aria-label="Surface"
          value={region.id}
          onChange={(e) => {
            const v = e.target.value;
            if (v === ADD_NEW) useStore.getState().select({ regionId: null });
            else selectRegion(v);
          }}
          className="min-w-0 flex-1"
        >
          {photo.regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name === SURFACE_LABELS[r.surface] || r.name.startsWith(`${SURFACE_LABELS[r.surface]} `) ? r.name : `${r.name} — ${SURFACE_LABELS[r.surface]}`}
            </option>
          ))}
          <option value={ADD_NEW}>＋ Add another surface…</option>
        </Select>
        <IconButton label="Outline & surface settings" onClick={() => useStore.getState().setPanel('surfaces')}>
          <Shapes className="size-4" />
        </IconButton>
      </div>
      {stats?.empty && (
        <Callout
          tone="warning"
          title={`“${region.name}” isn’t outlined yet`}
          action={
            <Button size="sm" variant="primary" icon={<Paintbrush className="size-4" />} onClick={() => activateCanvasTool('smart-brush')}>
              Outline with smart brush
            </Button>
          }
        >
          Brush over the {surfaceNoun(region.surface)} in the photo — the {what} only shows inside the outline.
        </Callout>
      )}
      {hidden && (
        <Callout
          tone="info"
          title={`Hidden in ${design.name}`}
          action={
            <Button size="sm" onClick={() => useStore.getState().toggleRegionHidden(region.id)}>
              Show it
            </Button>
          }
        >
          The finish is applied but switched off, so the photo shows the original surface.
        </Callout>
      )}
    </div>
  );
}
