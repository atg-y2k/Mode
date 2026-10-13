/**
 * Fine-tune › Paint: color for the selected surface, like a paint-store fan
 * deck — collections, hue families and search over a dense swatch grid, the
 * current color as a big chip with name, hex, brand/code and LRV, finish /
 * coats / strength, the eyedropper, colors already used in the project,
 * similar colors and a custom color form.
 */
import { useMemo } from 'react';
import { PaintRoller } from 'lucide-react';
import type { Design, PaintColor, PaintTreatment, Photo, Region, Treatment } from '../../../shared/types';
import { getMaterial, getPaint, nearestPaints } from '../../assets/catalog';
import {
  selectActiveDesign,
  selectActivePhoto,
  selectActiveSpace,
  selectSelectedRegion,
  useStore,
} from '../../state/store';
import { Button, EmptyState, PanelHeader, Section } from '../common';
import { activateCanvasTool, applyTreatmentToRegions, openFinishPanel } from './design/actions';
import {
  ColorTiles,
  CurrentPaintCard,
  CustomColorForm,
  FanDeck,
  PaintSettings,
  PickedColorCard,
  type ColorTileItem,
} from './design/PaintParts';
import {
  deltaELabel,
  displayHex,
  isSamePaint,
  paintDisplayName,
  paintFromCatalog,
  paintFromCustom,
  usedPaintColors,
  type CustomColor,
} from './design/paint';
import { RegionBar, RegionPicker } from './design/RegionPicker';
import { prefersMaterial, surfaceNoun } from './design/surfaceKinds';
import { Callout } from './design/ui';

function safeNearest(hex: string, n: number): { paint: PaintColor; deltaE: number }[] {
  try {
    return nearestPaints(hex, n) ?? [];
  } catch {
    return [];
  }
}

function startEyedropper() {
  useStore.getState().setPickedColor(null);
  activateCanvasTool('eyedropper');
}

export function PaintPanel() {
  const photo = useStore(selectActivePhoto);
  const design = useStore(selectActiveDesign);
  const space = useStore(selectActiveSpace);
  const region = useStore(selectSelectedRegion);
  const picked = useStore((s) => s.pickedColor);

  if (!photo || !design) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <PanelHeader title="Paint" subtitle="Try colors on walls, trim, siding and doors" />
        <EmptyState icon={<PaintRoller className="size-6" />} title="No photo open">
          Open a photo of this space to try paint colors on its walls, trim, cabinets, siding or front door.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <PanelHeader title="Paint" subtitle={region ? `${region.name} · ${design.name}` : `Colors for ${design.name}`} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {region ? (
          <PaintEditor key={region.id} photo={photo} design={design} region={region} picked={picked} />
        ) : (
          <>
            {picked && (
              <Section>
                <PickedColor hex={picked} region={undefined} treatment={undefined} />
              </Section>
            )}
            <RegionPicker purpose="paint" photo={photo} design={design} spaceType={space?.type} />
          </>
        )}
      </div>
    </div>
  );
}

function PickedColor({ hex, region, treatment }: { hex: string; region: Region | undefined; treatment: Treatment | undefined }) {
  const matches = useMemo<ColorTileItem[]>(
    () =>
      safeNearest(hex, 4).map(({ paint, deltaE }) => ({
        key: paint.id,
        hex: paint.hex,
        name: paint.name,
        caption: `${deltaELabel(deltaE)} · ΔE ${deltaE.toFixed(1)}`,
        selected: isSamePaint(treatment, { hex: paint.hex, paintId: paint.id }),
      })),
    [hex, treatment],
  );
  const finish = () => {
    const s = useStore.getState();
    s.setPickedColor(null);
    if (s.tool === 'eyedropper') s.setTool('select');
  };
  return (
    <PickedColorCard
      hex={hex}
      matches={matches}
      canApply={!!region}
      onUse={() => {
        if (!region) return;
        const t = paintFromCustom({ hex, name: 'Picked color' }, treatment, region.surface);
        if (t) useStore.getState().setTreatment(region.id, t);
        finish();
      }}
      onPickMatch={(id) => {
        const paint = getPaint(id);
        if (!region || !paint) return;
        useStore.getState().setTreatment(region.id, paintFromCatalog(paint, treatment, region.surface));
        finish();
      }}
      onPickAgain={startEyedropper}
      onDismiss={() => useStore.getState().setPickedColor(null)}
    />
  );
}

function PaintEditor({ photo, design, region, picked }: { photo: Photo; design: Design; region: Region; picked: string | null }) {
  const project = useStore((s) => s.project);
  const tool = useStore((s) => s.tool);
  const treatment = design.treatments[region.id];
  const paint = treatment?.type === 'paint' ? treatment : undefined;
  const material = treatment?.type === 'material' ? getMaterial(treatment.materialId) : undefined;
  const others = photo.regions.filter((r) => r.surface === region.surface && r.id !== region.id);

  const apply = (t: PaintTreatment, coalesce?: string) => useStore.getState().setTreatment(region.id, t, coalesce ? { coalesce } : undefined);

  const pickCatalog = (p: PaintColor) => apply(paintFromCatalog(p, treatment, region.surface));
  const applyCustom = (c: CustomColor & { paintId?: string }, live = false) => {
    const t = paintFromCustom(c, treatment, region.surface);
    if (t) apply(t, live ? `panel:paint-custom:${region.id}` : undefined);
  };

  const used = useMemo(() => usedPaintColors(project), [project]);
  const usedItems: ColorTileItem[] = used.slice(0, 16).map((u) => ({
    key: u.key,
    hex: u.hex,
    name: u.name ?? displayHex(u.hex),
    caption: u.uses === 1 ? '1 surface' : `${u.uses} surfaces`,
    selected: isSamePaint(paint, u),
  }));

  const similar = useMemo<ColorTileItem[]>(() => {
    if (!paint) return [];
    return safeNearest(paint.hex, 9)
      .filter(({ paint: p }) => p.id !== paint.paintId)
      .slice(0, 8)
      .map(({ paint: p, deltaE }) => ({ key: p.id, hex: p.hex, name: p.name, caption: deltaELabel(deltaE) }));
  }, [paint]);

  const customInitial: CustomColor | undefined = paint
    ? paint.paintId
      ? { hex: paint.hex }
      : { hex: paint.hex, name: paint.colorName, brand: paint.brand, code: paint.code }
    : picked
      ? { hex: picked }
      : undefined;

  return (
    <>
      {picked && (
        <Section>
          <PickedColor hex={picked} region={region} treatment={treatment} />
        </Section>
      )}

      <Section title="Surface">
        <RegionBar photo={photo} design={design} region={region} purpose="paint" />
        {material && (
          <Callout tone="info">
            Currently covered with <span className="font-medium text-text">{material.name}</span>. Picking a color replaces the material.
          </Callout>
        )}
        {!paint && prefersMaterial(region.surface) && (
          <Callout
            tone="info"
            action={
              <Button size="sm" onClick={() => openFinishPanel(region.id, 'materials')}>
                Browse materials
              </Button>
            }
          >
            Tip: a {surfaceNoun(region.surface)} usually looks more convincing with a material — real textures like stone, wood or grass.
          </Callout>
        )}
      </Section>

      <Section title="Color on this surface">
        {paint ? (
          <>
            <CurrentPaintCard paint={paint} onRemove={() => useStore.getState().setTreatment(region.id, null)} />
            <PaintSettings
              paint={paint}
              onChange={(patch, key) => apply({ ...paint, ...patch }, key ? `panel:paint-${key}:${region.id}` : undefined)}
            />
            {others.length > 0 && (
              <Button
                className="self-start"
                size="sm"
                variant="soft"
                onClick={() => {
                  applyTreatmentToRegions(
                    others.map((r) => r.id),
                    paint,
                  );
                  useStore.getState().notify(`${paintDisplayName(paint)} applied to ${others.length + 1} ${surfaceNoun(region.surface)} surfaces.`, 'success');
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
              <span className="font-medium text-text">No paint yet.</span> Tap a color below — it previews on the photo instantly. You can undo anything.
            </p>
          </div>
        )}
      </Section>

      <Section title="Color library">
        <FanDeck current={paint} onPick={pickCatalog} onEyedropper={startEyedropper} eyedropperActive={tool === 'eyedropper'} />
      </Section>

      {similar.length > 0 && (
        <Section title="Similar colors">
          <ColorTiles
            items={similar}
            label="Similar colors"
            onPick={(id) => {
              const p = getPaint(id);
              if (p) pickCatalog(p);
            }}
          />
        </Section>
      )}

      {usedItems.length > 0 && (
        <Section title="Used in this project">
          <ColorTiles
            items={usedItems}
            label="Colors used in this project"
            onPick={(key) => {
              const u = used.find((x) => x.key === key);
              if (!u) return;
              const catalog = u.paintId ? getPaint(u.paintId) : undefined;
              if (catalog) pickCatalog(catalog);
              else applyCustom({ hex: u.hex, name: u.name, brand: u.brand, code: u.code, paintId: u.paintId });
            }}
          />
        </Section>
      )}

      <Section title="Custom color">
        <CustomColorForm key={region.id} initial={customInitial} onApply={applyCustom} />
      </Section>
    </>
  );
}
