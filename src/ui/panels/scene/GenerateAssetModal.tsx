/**
 * "Generate with AI": describe an item → Claude draws a vector illustration
 * (or the image provider renders a photoreal cut-out) → preview → adjust the
 * details → save to the library. Explains clearly when AI or the image
 * provider is off.
 */
import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, PenTool, RefreshCw, Sparkles, Upload } from 'lucide-react';
import type { GeneratedAsset } from '../../../../shared/api';
import { newId } from '../../../../shared/ids';
import { ASSET_CATEGORIES, type AssetCategory, type AssetDef } from '../../../../shared/types';
import { ApiError, generateAsset, isAbortError } from '../../../lib/api';
import { trimTransparent } from '../../../lib/backgroundRemoval';
import { blobToImageData, dataUrlToBlob, imageDataToBlob } from '../../../lib/imageImport';
import { useStore } from '../../../state/store';
import { Button, cn, Field, Modal, Select, Spinner, TextArea } from '../../common';
import { AssetDetailsForm } from './AssetDetailsForm';
import {
  DEFAULT_HEIGHT_FT,
  detailsToFields,
  emptyDetails,
  hasErrors,
  saneAspect,
  svgAspect,
  svgToDataUrl,
  tagsFor,
  validateDetails,
  type AssetDetails,
} from './assetForm';
import { Callout } from './controls';
import { ASSET_CATEGORY_LABELS } from './format';
import { useElapsedSeconds, useMountedRef, useStableCallback } from './hooks';

type GenMode = 'vector' | 'photo';

const EXAMPLES: Record<AssetCategory, string[]> = {
  plant: ['Dwarf Japanese maple in a glazed blue pot', 'Clump of ornamental fountain grass with tan plumes', 'Climbing white rose on a black metal obelisk'],
  lighting: ['Matte black cylinder wall sconce, up and down light', 'Aged brass lantern pendant with seeded glass', 'Copper path light with a mushroom cap'],
  decor: ['Weathered terracotta urn planter, about 24 in tall', 'Round woven jute rug, natural color', 'Large arched mirror with a thin brass frame'],
  furniture: ['Teak garden bench with curved armrests', 'Cream bouclé lounge chair with oak legs', 'Black aluminum bistro set for two'],
  hardscape: ['Stacked natural stone fire pit, 36 in round', 'Cedar pergola with black steel brackets', 'Low dry-stacked fieldstone wall section'],
  other: ['Cedar raised garden bed with a trellis', 'Modern black mailbox on a post', 'Copper birdbath on a stone pedestal'],
};

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'ai_disabled':
        return 'AI is turned off on the server. Add ANTHROPIC_API_KEY to the server’s .env file and restart it.';
      case 'image_provider_disabled':
        return 'Photo mode needs an image provider (OPENAI_API_KEY or GEMINI_API_KEY in .env). Try Illustration instead.';
      case 'refused':
        return 'The AI declined this request. Try describing the item differently.';
      case 'rate_limited':
        return 'Too many AI requests right now. Wait a minute and try again.';
      default:
        return err.message || 'Generation failed. Please try again.';
    }
  }
  return err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';
}

interface Generated {
  asset: GeneratedAsset;
  /** Safe <img> source: an SVG data URL or the provider's PNG data URL. */
  previewUrl: string;
}

export function GenerateAssetModal({
  open,
  onClose,
  defaultCategory,
  canPlace,
  onSaved,
  onUploadInstead,
}: {
  open: boolean;
  onClose: () => void;
  defaultCategory: AssetCategory;
  canPlace: boolean;
  onSaved: (asset: AssetDef, place: boolean) => void;
  /** Offered when AI is off. */
  onUploadInstead?: () => void;
}) {
  if (!open) return null;
  return (
    <GenerateBody onClose={onClose} defaultCategory={defaultCategory} canPlace={canPlace} onSaved={onSaved} onUploadInstead={onUploadInstead} />
  );
}

function GenerateBody({
  onClose,
  defaultCategory,
  canPlace,
  onSaved,
  onUploadInstead,
}: {
  onClose: () => void;
  defaultCategory: AssetCategory;
  canPlace: boolean;
  onSaved: (asset: AssetDef, place: boolean) => void;
  onUploadInstead?: () => void;
}) {
  const health = useStore((s) => s.health);
  const checking = health === null;
  const serverUp = !!health?.ok;
  const aiOn = !!health?.ai.enabled;
  const photoOn = !!health && (health.imageProvider.enabled || (health.imageProviders?.length ?? 0) > 0);

  const mounted = useMountedRef();
  const abortRef = useRef<AbortController | null>(null);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<AssetCategory>(defaultCategory);
  const [mode, setMode] = useState<GenMode>('vector');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Generated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<AssetDetails>(() => emptyDetails(defaultCategory));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState<null | 'save' | 'place'>(null);
  const [rechecking, setRechecking] = useState(false);
  const elapsed = useElapsedSeconds(running);

  const effectiveMode: GenMode = mode === 'photo' && !photoOn ? 'vector' : mode;
  const errors = showErrors ? validateDetails(details) : {};
  const canGenerate = aiOn && description.trim().length >= 2 && !running;

  useEffect(() => () => abortRef.current?.abort(), []);

  const recheck = async () => {
    setRechecking(true);
    try {
      await useStore.getState().refreshHealth();
    } finally {
      if (mounted.current) setRechecking(false);
    }
  };

  const generate = async () => {
    const desc = description.trim();
    if (desc.length < 2) {
      setError('Describe the item in a few words first.');
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setError(null);
    setShowErrors(false);
    try {
      const res = await generateAsset({ description: desc.slice(0, 1000), category, mode: effectiveMode }, ctrl.signal);
      if (ctrl.signal.aborted || !mounted.current) return;
      const previewUrl = res.svg ? svgToDataUrl(res.svg) : res.image && /^data:image\//i.test(res.image) ? res.image : null;
      if (!previewUrl) throw new Error('The AI didn’t return an image. Try again, or describe the item differently.');
      const cat = (ASSET_CATEGORIES as readonly string[]).includes(res.category) ? res.category : category;
      setResult({ asset: res, previewUrl });
      setDetails({
        ...emptyDetails(cat),
        name: res.name.trim().slice(0, 80) || desc.slice(0, 60),
        realHeightFt: Number.isFinite(res.realHeightFt) && res.realHeightFt > 0 ? Math.round(res.realHeightFt * 10) / 10 : DEFAULT_HEIGHT_FT[cat],
        costLow: res.costLowUsd ?? undefined,
        costHigh: res.costHighUsd ?? undefined,
        description: res.description.slice(0, 500),
      });
    } catch (err) {
      if (isAbortError(err) || ctrl.signal.aborted || !mounted.current) return;
      setError(errorText(err));
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        if (mounted.current) setRunning(false);
      }
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  };

  const save = async (place: boolean) => {
    setShowErrors(true);
    if (!result || saving || hasErrors(validateDetails(details))) return;
    setSaving(place ? 'place' : 'save');
    setError(null);
    try {
      const r = result.asset;
      const base: AssetDef = {
        id: newId('ast'),
        ...detailsToFields(details),
        source: 'ai',
        subcategory: r.subcategory ?? undefined,
        aspect: 1,
        tags: tagsFor(details.category, 'ai', r.tags),
        createdAt: Date.now(),
      };
      let asset: AssetDef;
      let blob: Blob | undefined;
      if (r.svg) {
        asset = { ...base, svg: r.svg, aspect: saneAspect(r.aspect, svgAspect(r.svg) ?? 1) };
      } else {
        const raw = await dataUrlToBlob(result.previewUrl);
        blob = raw;
        let aspect = saneAspect(r.aspect);
        try {
          // Crop transparent margins so the item's base sits on the anchor.
          const trimmed = trimTransparent(await blobToImageData(raw));
          blob = await imageDataToBlob(trimmed, 'image/png');
          aspect = trimmed.width / Math.max(1, trimmed.height);
        } catch {
          // Undecodable here: keep the provider's PNG and its reported aspect.
        }
        asset = { ...base, aspect };
      }
      await useStore.getState().addLibraryAsset(asset, blob);
      const stored = useStore.getState().library.find((a) => a.id === asset.id) ?? asset;
      if (!mounted.current) return;
      onSaved(stored, place);
    } catch (err) {
      if (!mounted.current) return;
      setError(`Couldn’t save it: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(null);
    }
  };

  const safeClose = useStableCallback(() => {
    if (saving) return;
    abortRef.current?.abort();
    onClose();
  });

  const footer = running ? (
    <Button onClick={cancel}>Cancel generation</Button>
  ) : result ? (
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      <Button variant="ghost" className="mr-auto" icon={<RefreshCw className="size-4" />} disabled={!!saving || !aiOn} onClick={() => void generate()}>
        Try again
      </Button>
      <Button variant={canPlace ? 'secondary' : 'primary'} loading={saving === 'save'} disabled={!!saving && saving !== 'save'} onClick={() => void save(false)}>
        Save to library
      </Button>
      {canPlace && (
        <Button variant="primary" loading={saving === 'place'} disabled={!!saving && saving !== 'place'} onClick={() => void save(true)}>
          Save &amp; place
        </Button>
      )}
    </div>
  ) : (
    <>
      <Button onClick={safeClose}>Cancel</Button>
      <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={!canGenerate} onClick={() => void generate()}>
        Generate
      </Button>
    </>
  );

  const modeOption = (value: GenMode, title: string, text: string, Icon: typeof PenTool, disabledReason?: string) => {
    const active = effectiveMode === value;
    const disabled = !!disabledReason || !aiOn || running;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        disabled={disabled}
        onClick={() => setMode(value)}
        className={cn(
          'flex flex-1 flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed',
          active ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-surface-2',
          disabled && !active && 'opacity-60',
        )}
      >
        <span className={cn('flex items-center gap-1.5 text-sm font-medium', active ? 'text-accent' : 'text-text')}>
          <Icon className="size-4" aria-hidden />
          {title}
        </span>
        <span className="text-xs text-muted">{disabledReason ?? text}</span>
      </button>
    );
  };

  return (
    <Modal open onClose={safeClose} title="Generate an item with AI" size={result ? 'lg' : 'md'} footer={footer}>
      <div className="flex flex-col gap-4">
        {checking ? (
          <Callout icon={<Spinner className="size-4" />}>Checking whether AI is available…</Callout>
        ) : !serverUp ? (
          <Callout
            tone="warning"
            title="Can’t reach the Mode server"
            action={
              <>
                <Button size="sm" loading={rechecking} onClick={() => void recheck()}>
                  Check again
                </Button>
                {onUploadInstead && (
                  <Button size="sm" variant="ghost" icon={<Upload className="size-4" />} onClick={onUploadInstead}>
                    Add your own photo instead
                  </Button>
                )}
              </>
            }
          >
            AI features run on the Mode API server. Start it (npm run dev starts it with the app), then check again.
          </Callout>
        ) : !aiOn ? (
          <Callout
            tone="warning"
            title="AI is off"
            action={
              <>
                <Button size="sm" loading={rechecking} onClick={() => void recheck()}>
                  Check again
                </Button>
                {onUploadInstead && (
                  <Button size="sm" variant="ghost" icon={<Upload className="size-4" />} onClick={onUploadInstead}>
                    Add your own photo instead
                  </Button>
                )}
              </>
            }
          >
            Generating items uses Claude on the Mode server. Add <code className="font-mono">ANTHROPIC_API_KEY</code> to the server’s
            <code className="font-mono"> .env</code> file and restart it.
          </Callout>
        ) : null}

        {result && !running ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="bg-checker flex h-56 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2 p-3 sm:h-64">
                <img src={result.previewUrl} alt={`Generated: ${details.name || 'item'}`} className="max-h-full max-w-full object-contain" />
              </div>
              <p className="text-xs text-muted">
                {result.asset.svg ? 'Illustration — you can recolor it after placing.' : 'Photo cut-out from the image provider.'} Not quite right? Edit
                the description below and try again.
              </p>
              <TextArea
                aria-label="Description"
                rows={2}
                className="min-h-16"
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-3">
              {error && <Callout tone="warning">{error}</Callout>}
              <AssetDetailsForm value={details} onChange={setDetails} errors={errors} disabled={!!saving} />
            </div>
          </div>
        ) : (
          <>
            <Field label="Describe the item" hint="Material, color, style and size help. One item per request.">
              <TextArea
                rows={3}
                maxLength={1000}
                value={description}
                disabled={!aiOn || running}
                placeholder={`e.g. ${EXAMPLES[category][0]}`}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canGenerate) {
                    e.preventDefault();
                    void generate();
                  }
                }}
              />
            </Field>
            {aiOn && !running && (
              <div className="-mt-1 flex flex-wrap gap-1.5">
                {EXAMPLES[category].map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setDescription(ex)}
                    className="rounded-full border border-line bg-surface px-2.5 py-1 text-left text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}

            <Field label="Category">
              <Select value={category} disabled={!aiOn || running} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
                {ASSET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ASSET_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">Style</span>
              <div role="radiogroup" aria-label="Style" className="flex flex-col gap-2 sm:flex-row">
                {modeOption('vector', 'Illustration', 'Clean vector art you can recolor · about 30 s', PenTool)}
                {modeOption(
                  'photo',
                  'Photo',
                  'Photoreal cut-out from the image provider · about a minute',
                  ImageIcon,
                  health && aiOn && !photoOn ? 'Needs an image provider — add OPENAI_API_KEY or GEMINI_API_KEY to .env' : undefined,
                )}
              </div>
            </div>

            {running && (
              <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm" role="status">
                <Spinner className="size-5 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-text">{effectiveMode === 'photo' ? 'Rendering your item…' : 'Drawing your item…'}</p>
                  <p className="text-xs text-muted">
                    {elapsed}s · {effectiveMode === 'photo' ? 'usually 30–90 seconds' : 'usually 20–60 seconds'}. You can keep this open.
                  </p>
                </div>
              </div>
            )}
            {error && !running && <Callout tone="warning">{error}</Callout>}
          </>
        )}
      </div>
    </Modal>
  );
}
