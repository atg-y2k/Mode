/**
 * Fine-tune › Plants & objects: browse the built-in catalog and the user's own
 * items (category chips, search, plant filters incl. "fits my zone"), tap a
 * card to arm placement, details sheet per item, add your own photo (live
 * background removal) or generate one with AI, edit / delete your items.
 * The selected object's inspector sits at the top.
 */
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { MapPin, Search, SearchX, Sparkles, Upload, X } from 'lucide-react';
import {
  PLANT_TYPES,
  type AssetCategory,
  type AssetDef,
  type Design,
  type PlantType,
  type SpaceKind,
  type SunExposure,
  type WaterNeed,
} from '../../../shared/types';
import { BUILTIN_ASSETS, findAsset, parseZone, searchAssets } from '../../assets/catalog';
import {
  selectActiveDesign,
  selectActivePhoto,
  selectActiveSpace,
  selectSelectedObject,
  useStore,
} from '../../state/store';
import { Badge, Button, ConfirmModal, EmptyState, IconButton, PanelHeader, Section, Segmented, Select, TextInput, cn } from '../common';
import { AddAssetModal } from './scene/AddAssetModal';
import { AssetCard } from './scene/AssetCard';
import { AssetInfoModal } from './scene/AssetInfoModal';
import { AssetThumb } from './scene/AssetThumb';
import { Callout, FilterChip } from './scene/controls';
import { EditAssetModal } from './scene/EditAssetModal';
import {
  LIBRARY_CHIPS,
  activeFilterCount,
  chipDef,
  chipHasPlantFilters,
  chipHasSettingFilter,
  countMatchesByChip,
  defaultChipFor,
  defaultSettingFor,
  filterLibrary,
  type LibraryChip,
  type LibraryFilterState,
  type SettingScope,
} from './scene/filters';
import { PLANT_TYPE_LABELS, SUN_LABELS, WATER_LABELS } from './scene/format';
import { GenerateAssetModal } from './scene/GenerateAssetModal';
import { useStableCallback } from './scene/hooks';
import { ObjectInspector } from './scene/ObjectInspector';
import { PlacementBanner } from './scene/PlacementBanner';
import { armAsset, cancelPlacement, countPlacements, detachAssetFromProject, isArmed, usePointerVerb } from './scene/placement';

/** Cards rendered before "Show all" (keeps phones snappy). */
const PAGE_SIZE = 48;

interface BrowseMemory {
  /** Explicitly chosen chip; null = follow the space kind. */
  chip: LibraryChip | null;
  text: string;
  plantType: PlantType | null;
  sun: SunExposure | null;
  water: WaterNeed | null;
  fitsZone: boolean;
  scope: { kind: SpaceKind | undefined; value: SettingScope } | null;
}

/** Browsing state survives switching panel tabs (module memory, per session). */
let memory: BrowseMemory = { chip: null, text: '', plantType: null, sun: null, water: null, fitsZone: false, scope: null };

const SEARCH_PLACEHOLDER: Record<LibraryChip, string> = {
  plants: 'Search plants — boxwood, lavender, shade…',
  fixtures: 'Search fixtures — sconce, pendant, path light…',
  decor: 'Search decor & furniture — planter, bench, rug…',
  hardscape: 'Search hardscape — boulder, fire pit, pergola…',
  mine: 'Search your items…',
};

function categoryForChip(chip: LibraryChip, kind: SpaceKind | undefined): AssetCategory {
  switch (chip) {
    case 'plants':
      return 'plant';
    case 'fixtures':
      return 'lighting';
    case 'hardscape':
      return 'hardscape';
    case 'decor':
      return 'decor';
    default:
      return kind === 'interior' ? 'decor' : 'plant';
  }
}

type ModalKind = null | 'add' | 'generate';

export function LibraryPanel() {
  const kind = useStore((s) => selectActiveSpace(s)?.kind);
  const zoneLabel = useStore((s) => s.project?.location.hardinessZone ?? s.project?.location.climate?.hardinessZone);
  const photo = useStore(selectActivePhoto);
  const design = useStore(selectActiveDesign);
  const selectedObject = useStore(selectSelectedObject);
  const aiOn = useStore((s) => !!s.health?.ai.enabled);
  const verb = usePointerVerb();
  const canPlace = !!photo && !!design;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<ModalKind>(null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <PanelHeader
        title="Plants & objects"
        subtitle={canPlace ? `${verb} an item, then ${verb.toLowerCase()} the photo to place it` : 'Browse plants, fixtures and decor'}
        action={
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="Add your own photo" onClick={() => setModal('add')}>
              <Upload className="size-4" />
            </IconButton>
            <IconButton label={aiOn ? 'Generate with AI' : 'Generate with AI (AI is off)'} onClick={() => setModal('generate')}>
              <Sparkles className={cn('size-4', !aiOn && 'opacity-60')} />
            </IconButton>
          </div>
        }
      />

      <div ref={scrollRef} className="scroll-thin @container min-h-0 flex-1 overflow-y-auto">
        <PlacementBanner />
        {!canPlace && (
          <div className="px-4 pt-3">
            <Callout>Open a photo of this space to place items. You can still browse, add your own and generate new ones.</Callout>
          </div>
        )}

        {selectedObject && photo && design && (
          <Section title="Selected item">
            <ObjectInspector obj={selectedObject} photo={photo} design={design} />
          </Section>
        )}

        {design && (
          <PlacedStrip
            design={design}
            selectedId={selectedObject?.id ?? null}
            onSelect={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          />
        )}

        <LibraryBrowser
          kind={kind}
          zoneLabel={zoneLabel}
          canPlace={canPlace}
          aiOn={aiOn}
          scrollRef={scrollRef}
          modal={modal}
          setModal={setModal}
        />
      </div>
    </div>
  );
}

/**
 * Search, chips, filters, the card grid and the asset modals. Memoized and
 * subscribed only to the library and the armed placement, so dragging things
 * on the photo doesn't re-render the whole catalog.
 */
const LibraryBrowser = memo(function LibraryBrowser({
  kind,
  zoneLabel,
  canPlace,
  aiOn,
  scrollRef,
  modal,
  setModal,
}: {
  kind: SpaceKind | undefined;
  zoneLabel: string | undefined;
  canPlace: boolean;
  aiOn: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  modal: ModalKind;
  setModal: (m: ModalKind) => void;
}) {
  const library = useStore((s) => s.library);
  const placement = useStore((s) => s.placement);
  const zone = parseZone(zoneLabel);

  // ---------------------------------------------------------------- browsing
  const [chosenChip, setChosenChip] = useState<LibraryChip | null>(memory.chip);
  const [text, setText] = useState(memory.text);
  const [plantType, setPlantType] = useState<PlantType | null>(memory.plantType);
  const [sun, setSun] = useState<SunExposure | null>(memory.sun);
  const [water, setWater] = useState<WaterNeed | null>(memory.water);
  const [fitsZone, setFitsZone] = useState(memory.fitsZone);
  const [scope, setScope] = useState(memory.scope);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const chip = chosenChip ?? defaultChipFor(kind);
  const defaultSetting = defaultSettingFor(kind);
  const setting: SettingScope = scope && scope.kind === kind ? scope.value : defaultSetting;

  useEffect(() => {
    memory = { chip: chosenChip, text, plantType, sun, water, fitsZone, scope };
  }, [chosenChip, text, plantType, sun, water, fitsZone, scope]);

  const filters: LibraryFilterState = { chip, text, plantType, sun, water, fitsZone, zone, setting };
  const results = useMemo(
    () => filterLibrary(BUILTIN_ASSETS, library, { chip, text, plantType, sun, water, fitsZone, zone, setting }, searchAssets),
    [library, chip, text, plantType, sun, water, fitsZone, zone, setting],
  );
  const counts = useMemo(() => (text.trim() ? countMatchesByChip(BUILTIN_ASSETS, library, text, searchAssets) : null), [library, text]);
  const filterCount = activeFilterCount(filters, defaultSetting);

  useEffect(() => setLimit(PAGE_SIZE), [chip, text, plantType, sun, water, fitsZone, setting]);

  const pickChip = (c: LibraryChip) => {
    setChosenChip(c);
    scrollRef.current?.querySelector('[data-browse-top]')?.scrollIntoView({ block: 'nearest' });
  };

  const clearFilters = () => {
    setText('');
    setPlantType(null);
    setSun(null);
    setWater(null);
    setFitsZone(false);
    setScope(null);
  };

  const toggleZone = () => {
    if (zone === undefined) {
      useStore.getState().notify('Add your ZIP code or USDA hardiness zone in Settings to filter plants by what survives your winters.', 'info');
      return;
    }
    setFitsZone((v) => !v);
  };

  // ------------------------------------------------------------------ modals
  const [infoId, setInfoId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const info = infoId ? findAsset(infoId, library) ?? null : null;
  const editing = editId ? library.find((a) => a.id === editId) ?? null : null;
  const deleting = deleteId ? library.find((a) => a.id === deleteId) ?? null : null;
  const deletingUses = deleting ? countPlacements(deleting.id) : 0;

  const closeModal = useStableCallback(() => setModal(null));
  const closeInfo = useStableCallback(() => setInfoId(null));
  const closeEdit = useStableCallback(() => setEditId(null));
  const closeDelete = useStableCallback(() => setDeleteId(null));
  const openUploadInstead = useStableCallback(() => setModal('add'));

  const placeFromInfo = useStableCallback((a: AssetDef) => {
    setInfoId(null);
    armAsset(a);
  });
  const editFromInfo = useStableCallback((a: AssetDef) => {
    setInfoId(null);
    setEditId(a.id);
  });
  const deleteFromInfo = useStableCallback((a: AssetDef) => {
    setInfoId(null);
    setDeleteId(a.id);
  });

  const onSaved = useStableCallback((asset: AssetDef, place: boolean) => {
    setModal(null);
    setChosenChip('mine');
    setText('');
    if (place) armAsset(asset);
    else useStore.getState().notify(`Saved “${asset.name}” to My assets`, 'success');
  });

  const confirmDelete = useStableCallback(() => {
    const asset = deleting;
    if (!asset) return;
    const s = useStore.getState();
    const p = s.placement;
    if (p && ((p.kind === 'object' && p.assetId === asset.id) || (p.kind === 'light' && p.assetId === asset.id))) cancelPlacement();
    detachAssetFromProject(asset.id);
    s.deleteLibraryAsset(asset.id).then(
      () => useStore.getState().notify(`Deleted “${asset.name}”`, 'info'),
      (err: unknown) => useStore.getState().notify(`Couldn’t delete “${asset.name}”: ${err instanceof Error ? err.message : String(err)}`, 'error'),
    );
  });

  const def = chipDef(chip);
  const libraryEmpty = chip === 'mine' && library.length === 0;
  const otherChipHits = counts ? LIBRARY_CHIPS.filter((c) => c.id !== chip && counts[c.id] > 0) : [];

  return (
    <>
        {/* Search & category chips stay reachable while scrolling the grid. */}
        <div data-browse-top className="sticky top-0 z-10 flex flex-col gap-2.5 border-b border-line bg-surface px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <TextInput
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && text) {
                  e.stopPropagation();
                  setText('');
                }
              }}
              placeholder={SEARCH_PLACEHOLDER[chip]}
              aria-label="Search plants and objects"
              className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
            />
            {text && (
              <IconButton label="Clear search" size="sm" className="absolute right-0.5 top-1/2 -translate-y-1/2" onClick={() => setText('')}>
                <X className="size-4" />
              </IconButton>
            )}
          </div>
          <div className="scroll-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5" role="group" aria-label="Categories">
            {LIBRARY_CHIPS.map((c) => (
              <FilterChip
                key={c.id}
                active={c.id === chip}
                onClick={() => pickChip(c.id)}
                count={counts ? counts[c.id] : c.id === 'mine' && library.length ? library.length : undefined}
              >
                {c.label}
              </FilterChip>
            ))}
          </div>
        </div>

        {(chipHasSettingFilter(chip) || chipHasPlantFilters(chip)) && (
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {chipHasSettingFilter(chip) && (
                <Segmented
                  size="sm"
                  value={setting}
                  onChange={(v) => setScope({ kind, value: v })}
                  options={[
                    { value: 'outdoor', label: 'Outdoor' },
                    { value: 'indoor', label: 'Indoor' },
                    { value: 'all', label: 'All' },
                  ]}
                />
              )}
              {chipHasPlantFilters(chip) && (
                <FilterChip
                  active={fitsZone && zone !== undefined}
                  onClick={toggleZone}
                  title={zone === undefined ? 'Set your ZIP or hardiness zone in Settings first' : `Only plants hardy in zone ${zoneLabel}`}
                >
                  <MapPin className="size-3.5" aria-hidden />
                  {zone === undefined ? 'Fits my zone' : `Fits zone ${zoneLabel}`}
                </FilterChip>
              )}
            </div>
            {chipHasPlantFilters(chip) && (
              <div className="grid grid-cols-3 gap-2">
                <Select aria-label="Plant type" value={plantType ?? ''} onChange={(e) => setPlantType((e.target.value || null) as PlantType | null)}>
                  <option value="">Any type</option>
                  {PLANT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {PLANT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Sun" value={sun ?? ''} onChange={(e) => setSun((e.target.value || null) as SunExposure | null)}>
                  <option value="">Any sun</option>
                  {(Object.keys(SUN_LABELS) as SunExposure[]).map((v) => (
                    <option key={v} value={v}>
                      {SUN_LABELS[v]}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Water" value={water ?? ''} onChange={(e) => setWater((e.target.value || null) as WaterNeed | null)}>
                  <option value="">Any water</option>
                  {(Object.keys(WATER_LABELS) as WaterNeed[]).map((v) => (
                    <option key={v} value={v}>
                      {WATER_LABELS[v]}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}

        {libraryEmpty && !text.trim() ? (
          <EmptyState
            icon={<Upload className="size-6" />}
            title="Make it yours"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setModal('add')}>
                  Add your own
                </Button>
                <Button icon={<Sparkles className="size-4" />} onClick={() => setModal('generate')}>
                  Generate with AI
                  {!aiOn && <Badge>Off</Badge>}
                </Button>
              </div>
            }
          >
            Snap the planter you saw at the nursery or the chair you already own — Mode cuts it out so you can place it on your photos. Or
            describe something and let AI draw it.
          </EmptyState>
        ) : results.length === 0 ? (
          <EmptyState
            icon={<SearchX className="size-6" />}
            title={text.trim() ? `No ${def.noun} match “${text.trim()}”` : `No ${def.noun} match these filters`}
            action={
              <div className="flex flex-col items-center gap-3">
                {otherChipHits.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {otherChipHits.map((c) => (
                      <FilterChip key={c.id} active={false} onClick={() => pickChip(c.id)} count={counts?.[c.id]}>
                        {c.label}
                      </FilterChip>
                    ))}
                  </div>
                )}
                {(filterCount > 0 || text) && (
                  <Button size="sm" onClick={clearFilters}>
                    Clear search & filters
                  </Button>
                )}
              </div>
            }
          >
            {otherChipHits.length > 0 ? 'Found in other categories:' : 'Try fewer filters or a different word — or add your own.'}
          </EmptyState>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 px-4 pt-3 text-xs text-muted">
              <span>
                {results.length} {results.length === 1 ? 'item' : 'items'}
                {chip === 'plants' && fitsZone && zone !== undefined && ` hardy in zone ${zoneLabel}`}
              </span>
              {(filterCount > 0 || text) && (
                <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5 px-4 py-3 @lg:grid-cols-3 @3xl:grid-cols-4">
              {results.slice(0, limit).map((a) => (
                <AssetCard
                  key={a.id}
                  asset={a}
                  zone={zone}
                  armed={isArmed(placement, a)}
                  onPick={() => armAsset(a)}
                  onInfo={() => setInfoId(a.id)}
                />
              ))}
            </div>
            {results.length > limit && (
              <div className="flex justify-center px-4 pb-3">
                <Button size="sm" onClick={() => setLimit(results.length)}>
                  Show all {results.length}
                </Button>
              </div>
            )}
          </>
        )}

        {!libraryEmpty && (
          <div className="mx-4 mb-4 mt-1 flex flex-col gap-2 rounded-xl border border-dashed border-line-strong p-3">
            <p className="text-sm font-medium text-text">Can’t find it?</p>
            <p className="text-xs text-muted">Add a photo of the exact item you have in mind, or describe it and let AI draw it.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Upload className="size-4" />} onClick={() => setModal('add')}>
                Add your own
              </Button>
              <Button size="sm" icon={<Sparkles className="size-4" />} onClick={() => setModal('generate')}>
                Generate with AI
                {!aiOn && <Badge>Off</Badge>}
              </Button>
            </div>
          </div>
        )}

      <AddAssetModal
        open={modal === 'add'}
        onClose={closeModal}
        defaultCategory={categoryForChip(chip, kind)}
        canPlace={canPlace}
        onSaved={onSaved}
      />
      <GenerateAssetModal
        open={modal === 'generate'}
        onClose={closeModal}
        defaultCategory={categoryForChip(chip, kind)}
        canPlace={canPlace}
        onSaved={onSaved}
        onUploadInstead={openUploadInstead}
      />
      <AssetInfoModal
        asset={info}
        onClose={closeInfo}
        zone={zone}
        zoneLabel={zoneLabel}
        canPlace={canPlace}
        onPlace={placeFromInfo}
        onEdit={editFromInfo}
        onDelete={deleteFromInfo}
      />
      <EditAssetModal asset={editing} onClose={closeEdit} />
      <ConfirmModal
        open={!!deleting}
        title="Delete from your library?"
        message={
          deleting ? (
            <>
              “{deleting.name}” will be removed from your library
              {deletingUses > 0 && (
                <>
                  {' '}
                  and from the {deletingUses} {deletingUses === 1 ? 'place' : 'places'} it’s used in this project
                </>
              )}
              . If other projects use it, it disappears from them too. This can’t be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onClose={closeDelete}
      />
    </>
  );
});


// ---------------------------------------------------------------------------
// Objects already on the photo (quick switcher for the inspector)
// ---------------------------------------------------------------------------

function PlacedStrip({ design, selectedId, onSelect }: { design: Design; selectedId: string | null; onSelect: () => void }) {
  const library = useStore((s) => s.library);
  const objects = useMemo(() => [...design.objects].sort((a, b) => b.z - a.z), [design.objects]);
  if (!objects.length) return null;
  return (
    <Section title={`On this photo · ${objects.length}`}>
      <div className="scroll-thin -mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1" role="group" aria-label="Placed items">
        {objects.map((o) => {
          const asset = findAsset(o.assetId, library);
          const name = o.label || asset?.name || 'Missing item';
          const selected = o.id === selectedId;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={selected}
              aria-label={`Select ${name}`}
              title={name}
              onClick={() => {
                useStore.getState().select({ objectId: selected ? null : o.id, lightId: null, regionId: null });
                if (!selected) onSelect();
              }}
              className={cn(
                'shrink-0 rounded-lg transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'hover:ring-1 hover:ring-line-strong',
              )}
            >
              <AssetThumb asset={asset} tint={o.tint} padded={false} className="size-12 border border-line p-1 pointer-coarse:size-14" />
            </button>
          );
        })}
      </div>
    </Section>
  );
}
