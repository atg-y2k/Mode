/**
 * "Add your own": pick a photo of an item → background removed live (tolerance
 * slider, cut-out / original preview, or keep the original) → name, category,
 * real height, price, link → saved to the user's library as a transparent PNG.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Lightbulb, RefreshCw, Scissors } from 'lucide-react';
import { newId } from '../../../../shared/ids';
import type { AssetCategory, AssetDef } from '../../../../shared/types';
import type { ImageDataLike } from '../../../engine/types';
import { hasTransparency, removeBackground, trimTransparent } from '../../../lib/backgroundRemoval';
import { blobToImageData, imageDataToBlob, importImageFile } from '../../../lib/imageImport';
import { useStore } from '../../../state/store';
import { Button, cn, Modal, Segmented, Slider, Spinner, Toggle } from '../../common';
import { AssetDetailsForm } from './AssetDetailsForm';
import {
  detailsToFields,
  emptyDetails,
  hasErrors,
  nameFromFilename,
  tagsFor,
  validateDetails,
  type AssetDetails,
} from './assetForm';
import { Callout } from './controls';
import { useMountedRef, useStableCallback } from './hooks';
import { ImageDataCanvas, opaqueShare } from './ImageDataCanvas';
import { usePointerVerb } from './placement';

/** Uploads are kept at most this big (long edge) — plenty for placing on a 1600 px photo. */
const UPLOAD_MAX_SIZE = 1024;
const DEFAULT_TOLERANCE = 18;

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong.';
}

function looksLikeImage(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name);
}

function toleranceLabel(v: number): string {
  if (v < 12) return `Tight · ${v}`;
  if (v < 30) return `Balanced · ${v}`;
  return `Loose · ${v}`;
}

interface CutResult {
  image: ImageDataLike;
  /** Share of the photo kept (0..1). */
  kept: number;
  /** Whether anything was made transparent. */
  removedAny: boolean;
}

export function AddAssetModal({
  open,
  onClose,
  defaultCategory,
  canPlace,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  defaultCategory: AssetCategory;
  /** A photo is open, so "Save & place" makes sense. */
  canPlace: boolean;
  onSaved: (asset: AssetDef, place: boolean) => void;
}) {
  if (!open) return null;
  return <AddAssetBody onClose={onClose} defaultCategory={defaultCategory} canPlace={canPlace} onSaved={onSaved} />;
}

function AddAssetBody({
  onClose,
  defaultCategory,
  canPlace,
  onSaved,
}: {
  onClose: () => void;
  defaultCategory: AssetCategory;
  canPlace: boolean;
  onSaved: (asset: AssetDef, place: boolean) => void;
}) {
  const mounted = useMountedRef();
  const verb = usePointerVerb();
  const inputRef = useRef<HTMLInputElement>(null);
  const runRef = useRef(0);

  const [phase, setPhase] = useState<'pick' | 'loading' | 'edit'>('pick');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [source, setSource] = useState<ImageDataLike | null>(null);
  const [sourceTransparent, setSourceTransparent] = useState(false);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [view, setView] = useState<'cutout' | 'original'>('cutout');
  const [cut, setCut] = useState<CutResult | null>(null);
  const [cutting, setCutting] = useState(false);

  const [details, setDetails] = useState<AssetDetails>(() => emptyDetails(defaultCategory));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState<null | 'save' | 'place'>(null);

  const errors = useMemo(() => (showErrors ? validateDetails(details) : {}), [details, showErrors]);

  const loadFile = useStableCallback(async (file: File) => {
    if (!looksLikeImage(file)) {
      setError(`“${file.name}” isn’t an image. Choose a JPEG, PNG or WebP photo.`);
      return;
    }
    setError(null);
    setPhase('loading');
    setFileName(file.name);
    try {
      const imported = await importImageFile(file, { maxSize: UPLOAD_MAX_SIZE, keepAlpha: true });
      const img = await blobToImageData(imported.blob);
      if (!mounted.current) return;
      const transparent = hasTransparency(img);
      runRef.current++;
      setSource(img);
      setSourceTransparent(transparent);
      setKeepOriginal(transparent);
      setView('cutout');
      setCut(null);
      setCutting(false);
      setDetails((d) => ({ ...d, name: d.name.trim() ? d.name : nameFromFilename(file.name) }));
      setPhase('edit');
    } catch (err) {
      if (!mounted.current) return;
      setError(errorText(err));
      setPhase(source ? 'edit' : 'pick');
    }
  });

  // Background removal, re-run (debounced) as the tolerance changes.
  const hasCut = cut !== null;
  useEffect(() => {
    if (!source || keepOriginal) return;
    const run = ++runRef.current;
    setCutting(true);
    const timer = setTimeout(
      () => {
        try {
          const removed = removeBackground(source, { tolerance });
          const result: CutResult = { image: trimTransparent(removed), kept: opaqueShare(removed), removedAny: hasTransparency(removed) };
          if (run === runRef.current) setCut(result);
        } catch (err) {
          if (run === runRef.current) setError(`Couldn’t remove the background: ${errorText(err)}`);
        } finally {
          if (run === runRef.current) setCutting(false);
        }
      },
      hasCut ? 160 : 40,
    );
    return () => clearTimeout(timer);
    // `hasCut` only tunes the debounce delay; it must not retrigger the cut.
  }, [source, tolerance, keepOriginal]);

  // Paste an image from the clipboard while choosing.
  useEffect(() => {
    if (phase !== 'pick') return;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      void loadFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [phase, loadFile]);

  const original = useMemo(() => (source && sourceTransparent ? trimTransparent(source) : source), [source, sourceTransparent]);
  const finalImage = keepOriginal ? original : cut?.image ?? null;
  const preview = keepOriginal || view === 'original' ? original : cut?.image ?? source;
  const previewIsStale = !keepOriginal && view === 'cutout' && (cutting || !cut);

  const safeClose = useStableCallback(() => {
    if (saving) return;
    onClose();
  });

  const save = async (place: boolean) => {
    setShowErrors(true);
    if (hasErrors(validateDetails(details)) || !finalImage || saving) return;
    setSaving(place ? 'place' : 'save');
    setError(null);
    try {
      const blob = await imageDataToBlob(finalImage, 'image/png');
      const asset: AssetDef = {
        id: newId('ast'),
        ...detailsToFields(details),
        source: 'user',
        aspect: finalImage.width / Math.max(1, finalImage.height),
        tags: tagsFor(details.category, 'user'),
        createdAt: Date.now(),
      };
      await useStore.getState().addLibraryAsset(asset, blob);
      const stored = useStore.getState().library.find((a) => a.id === asset.id) ?? asset;
      if (!mounted.current) return;
      onSaved(stored, place);
    } catch (err) {
      if (!mounted.current) return;
      setError(`Couldn’t save it: ${errorText(err)}`);
      setSaving(null);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(looksLikeImage) ?? e.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void loadFile(file);
      }}
    />
  );

  const footer =
    phase === 'edit' ? (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          className="mr-auto"
          icon={<RefreshCw className="size-4" />}
          disabled={!!saving}
          onClick={() => inputRef.current?.click()}
        >
          <span className="hidden sm:inline">Choose another</span>
          <span className="sm:hidden">Replace</span>
        </Button>
        <Button
          variant={canPlace ? 'secondary' : 'primary'}
          loading={saving === 'save'}
          disabled={!finalImage || (!!saving && saving !== 'save')}
          onClick={() => void save(false)}
        >
          Save to library
        </Button>
        {canPlace && (
          <Button variant="primary" loading={saving === 'place'} disabled={!finalImage || (!!saving && saving !== 'place')} onClick={() => void save(true)}>
            Save &amp; place
          </Button>
        )}
      </div>
    ) : (
      <Button onClick={safeClose}>Cancel</Button>
    );

  return (
    <Modal open onClose={safeClose} title="Add your own item" size={phase === 'edit' ? 'lg' : 'md'} footer={footer}>
      {phase === 'pick' && (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            data-autofocus
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              'flex min-h-48 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              dragOver ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2 hover:border-accent hover:bg-accent-soft',
            )}
          >
            <ImagePlus className="size-8 text-accent" aria-hidden />
            <span className="font-medium text-text">Choose a photo of the item</span>
            <span className="text-sm text-muted">
              {verb === 'Click' ? 'or drop it here · paste with Ctrl+V / ⌘V' : 'from your camera roll or files'}
            </span>
          </button>
          {fileInput}
          {error && <Callout tone="warning">{error}</Callout>}
          <Callout icon={<Lightbulb className="size-4" />} title="For a clean cut-out">
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Shoot it against a plain wall, the sky or a white backdrop.</li>
              <li>Keep the whole item in frame, one item per photo.</li>
              <li>Product photos on white and transparent PNGs work best.</li>
            </ul>
          </Callout>
        </div>
      )}

      {phase === 'loading' && (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted" role="status">
          <Spinner className="size-6" />
          Preparing {fileName || 'your photo'}…
        </div>
      )}

      {phase === 'edit' && source && (
        <div className="grid gap-5 sm:grid-cols-2">
          {fileInput}
          <div className="flex flex-col gap-3">
            <div className="bg-checker relative flex h-56 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2 p-3 sm:h-64">
              {preview && (
                <ImageDataCanvas
                  image={preview}
                  label={keepOriginal || view === 'original' ? 'Original photo' : 'Item with background removed'}
                  className={cn('transition-opacity', previewIsStale && 'opacity-60')}
                />
              )}
              {previewIsStale && (
                <span className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2 py-1 text-xs text-muted shadow-sm" role="status">
                  <Spinner className="size-3.5" />
                  Cutting out…
                </span>
              )}
            </div>

            {!keepOriginal && (
              <Segmented
                className="w-full"
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: 'cutout', label: 'Cut out' },
                  { value: 'original', label: 'Original' },
                ]}
              />
            )}

            {!keepOriginal && (
              <div className="flex flex-col gap-1">
                <Slider
                  label="Background tolerance"
                  value={tolerance}
                  min={4}
                  max={60}
                  step={1}
                  format={toleranceLabel}
                  onChange={(v) => {
                    setTolerance(v);
                    setView('cutout');
                  }}
                />
                <p className="text-xs text-subtle">Raise it if bits of background remain; lower it if edges of the item disappear.</p>
              </div>
            )}

            {!keepOriginal && cut && !cutting && cut.kept < 0.03 && (
              <Callout tone="warning">Almost everything was removed. Lower the tolerance, or keep the original background.</Callout>
            )}
            {!keepOriginal && cut && !cutting && !sourceTransparent && !cut.removedAny && (
              <Callout>No plain background found to remove. Raise the tolerance, or keep the original background.</Callout>
            )}

            <Toggle
              label={sourceTransparent ? 'Use the transparent background as is' : 'Keep the original background'}
              checked={keepOriginal}
              onChange={(v) => {
                setKeepOriginal(v);
                setView('cutout');
              }}
            />
            {sourceTransparent && (
              <p className="-mt-1 flex items-center gap-1.5 text-xs text-muted">
                <Scissors className="size-3.5 shrink-0" aria-hidden />
                This image already has a transparent background.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {error && <Callout tone="warning">{error}</Callout>}
            <AssetDetailsForm value={details} onChange={setDetails} errors={errors} disabled={!!saving} />
          </div>
        </div>
      )}
    </Modal>
  );
}
