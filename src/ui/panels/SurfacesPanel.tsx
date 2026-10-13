/**
 * Fine-tune › Surfaces: the outlined surfaces (regions) of the active photo
 * and the tools to outline them. Flow for first-time users:
 * 1. Add a surface → 2. outline it with the smart brush or wand → 3. pick a
 * paint or material (Paint / Materials panels).
 */
import { useRef } from 'react';
import { Plus, Shapes } from 'lucide-react';
import type { Design, Photo, Region } from '../../../shared/types';
import { selectActiveDesign, selectActivePhoto, selectActiveSpace, selectSelectedRegion, useStore, type ViewState } from '../../state/store';
import { Button, EmptyState, PanelHeader, Section, Segmented } from '../common';
import { AddSurfaceGrid } from './design/AddSurfaceGrid';
import { useRegionStats } from './design/hooks';
import { AreaCard, CalibrationCard, PerspectiveCard } from './design/MeasureCards';
import { OutlineCard } from './design/OutlineCard';
import { RegionList } from './design/RegionList';
import { Callout, RegionDot, StepGuide } from './design/ui';

export function SurfacesPanel() {
  const photo = useStore(selectActivePhoto);
  const design = useStore(selectActiveDesign);
  const space = useStore(selectActiveSpace);
  const region = useStore(selectSelectedRegion);
  const addRef = useRef<HTMLDivElement>(null);

  if (!photo || !design) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <PanelHeader title="Surfaces" subtitle="Walls, floors, siding, lawn — the parts you want to change" />
        <EmptyState icon={<Shapes className="size-6" />} title="No photo open">
          Add or open a photo of this space, then outline the surfaces you want to repaint or resurface.
        </EmptyState>
      </div>
    );
  }

  const regions = photo.regions;
  const scrollToAdd = () => {
    const el = addRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <PanelHeader
        title="Surfaces"
        subtitle={regions.length ? `${photo.name} · finishes shown for ${design.name}` : 'Outline the parts of the photo you want to change'}
        action={
          regions.length > 0 ? (
            <Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={scrollToAdd}>
              Add
            </Button>
          ) : undefined
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {regions.length === 0 ? (
          <>
            <Section title="Start here">
              <p className="text-sm text-text">Redesign any part of this photo in three steps:</p>
              <StepGuide current={1} />
            </Section>
            <Section title="Add a surface">
              <p className="-mt-1 text-xs text-muted">Most useful for {space ? space.name.toLowerCase() : 'this space'} first. You can add as many as you like.</p>
              <AddSurfaceGrid spaceType={space?.type} />
            </Section>
          </>
        ) : (
          <>
            <Section title={`In this photo · ${regions.length}`} action={<OutlineDisplayToggle />}>
              <RegionList photo={photo} design={design} selectedId={region?.id ?? null} />
              <p className="text-[11px] text-subtle">Where outlines overlap, surfaces lower in the list are applied on top.</p>
            </Section>
            {region ? (
              <SelectedSurface key={region.id} region={region} photo={photo} design={design} />
            ) : (
              <Section>
                <Callout tone="accent" title="Select a surface to outline it">
                  Tap a surface in the list above (or on the photo) to see the outline tools, its perspective and its size.
                </Callout>
              </Section>
            )}
            <div ref={addRef} className="scroll-mt-2">
              <Section title="Add a surface">
                <AddSurfaceGrid spaceType={space?.type} />
              </Section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OutlineDisplayToggle() {
  const masks = useStore((s) => s.view.masks);
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Show outlines on the photo">
      <span className="hidden text-[11px] text-subtle min-[400px]:inline">Show</span>
      <Segmented<ViewState['masks']>
        size="sm"
        value={masks}
        onChange={(v) => useStore.getState().setView({ masks: v })}
        options={[
          { value: 'selected', label: 'Selected', title: 'Tint only the selected surface on the photo' },
          { value: 'all', label: 'All', title: 'Tint every surface on the photo' },
          { value: 'none', label: 'None', title: 'Hide surface tints' },
        ]}
      />
    </div>
  );
}

function SelectedSurface({ region, photo, design }: { region: Region; photo: Photo; design: Design }) {
  const stats = useRegionStats(region, photo);
  return (
    <>
      <Section
        title={
          <span className="inline-flex min-w-0 items-center gap-2">
            <RegionDot color={region.color} className="size-2.5" />
            <span className="truncate">Outline · {region.name}</span>
          </span>
        }
      >
        <OutlineCard region={region} photo={photo} design={design} />
      </Section>
      <Section title="Perspective">
        <PerspectiveCard region={region} />
      </Section>
      <Section title="Size & scale">
        <AreaCard region={region} stats={stats} />
        <div className="border-t border-line pt-3">
          <CalibrationCard photo={photo} />
        </div>
      </Section>
    </>
  );
}
