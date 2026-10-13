/**
 * Export menu in the top bar:
 * - Studio: the image in the viewer (variation or original photo),
 *   before/after against the original, a labeled sheet of the current run
 *   (compare runs show each option).
 * - Fine-tune: the composited design and a before/after.
 * - Project backup (.mode.json) via store.exportProject.
 */
import { useState } from 'react';
import { Archive, Columns2, Download, GalleryHorizontal, Image as ImageIcon, LayoutGrid, Loader2, Rows2 } from 'lucide-react';
import type { Generation, Photo } from '../../../shared/types';
import { findVariation, selectActiveDesign, selectActivePhoto, useStore } from '../../state/store';
import { cn } from '../common';
import {
  exportDesignBeforeAfter,
  exportDesignImage,
  exportGenerationSheet,
  exportStudioBeforeAfter,
  exportStudioImage,
  generationSheetTitle,
  preferredLayout,
  type BeforeAfterLayout,
} from './exporters';
import { errorText } from './format';
import { Menu, type MenuEntry } from './Menu';

function generationOf(photo: Photo | undefined, variationId: string | null): Generation | undefined {
  if (!photo || !variationId) return undefined;
  return photo.generations.find((g) => g.variations.some((v) => v.id === variationId));
}

export function ExportMenu({ compact }: { compact?: boolean }) {
  const project = useStore((s) => s.project);
  const mode = useStore((s) => s.mode);
  const photo = useStore(selectActivePhoto);
  const design = useStore(selectActiveDesign);
  const viewVariationId = useStore((s) => s.studio.viewVariationId);
  const gridGenerationId = useStore((s) => s.studio.gridGenerationId);
  const [busy, setBusy] = useState<string | null>(null);

  if (!project) return null;
  const variation = findVariation(photo, viewVariationId);
  const sheetGen =
    (gridGenerationId ? photo?.generations.find((g) => g.id === gridGenerationId) : undefined) ?? generationOf(photo, viewVariationId);

  const run = (what: string, task: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(what);
    void task()
      .then((name) => {
        if (name) useStore.getState().notify(`Saved ${name}`, 'success');
      })
      .catch((err: unknown) => useStore.getState().notify(`Export failed: ${errorText(err)}`, 'error'))
      .finally(() => setBusy(null));
  };

  const noPhoto = 'Add a photo first';
  const layouts: { layout: BeforeAfterLayout; label: string; icon: typeof Columns2 }[] = [
    { layout: 'side-by-side', label: 'Before / after — side by side', icon: Columns2 },
    { layout: 'stacked', label: 'Before / after — stacked', icon: Rows2 },
  ];
  if (photo && preferredLayout(photo) === 'stacked') layouts.reverse();

  const items: MenuEntry[] = [{ kind: 'heading', label: mode === 'studio' ? 'Studio image' : 'Fine-tune image' }];

  if (mode === 'studio') {
    items.push({
      label: variation ? 'This variation' : 'Original photo',
      hint: !photo ? noPhoto : variation ? variation.title || 'Full resolution' : 'Open a variation to export it instead',
      icon: <ImageIcon className="size-4" />,
      disabled: !photo,
      onSelect: () => photo && run('image', () => exportStudioImage(project, photo, variation)),
    });
    for (const l of layouts) {
      items.push({
        label: l.label,
        hint: !photo ? noPhoto : variation ? 'Original next to this variation' : 'Open a variation first',
        icon: <l.icon className="size-4" />,
        disabled: !photo || !variation,
        onSelect: () => photo && variation && run('before-after', () => exportStudioBeforeAfter(project, photo, variation, l.layout)),
      });
    }
    items.push({
      label: sheetGen?.mode === 'compare' ? 'Comparison sheet' : 'Run sheet',
      hint: sheetGen ? `${generationSheetTitle(sheetGen)} — labeled grid` : 'Open a run’s variation or compare grid first',
      icon: <LayoutGrid className="size-4" />,
      disabled: !photo || !sheetGen || !sheetGen.variations.length,
      onSelect: () => photo && sheetGen && run('sheet', () => exportGenerationSheet(project, photo, sheetGen)),
    });
  } else {
    items.push({
      label: 'Design image',
      hint: photo && design ? `${design.name} · full resolution JPEG` : noPhoto,
      icon: <GalleryHorizontal className="size-4" />,
      disabled: !photo || !design,
      onSelect: () => photo && design && run('image', () => exportDesignImage(project, photo, design)),
    });
    for (const l of layouts) {
      items.push({
        label: l.label,
        hint: photo && design ? `Original and ${design.name}` : noPhoto,
        icon: <l.icon className="size-4" />,
        disabled: !photo || !design,
        onSelect: () => photo && design && run('before-after', () => exportDesignBeforeAfter(project, photo, design, l.layout)),
      });
    }
  }

  items.push(
    { kind: 'separator' },
    { kind: 'heading', label: 'Project' },
    {
      label: 'Back up project',
      hint: 'One .json file with photos, scene maps, variations and designs',
      icon: <Archive className="size-4" />,
      onSelect: () =>
        run('backup', async () => {
          await useStore.getState().exportProject();
          return `a backup of “${project.name}”`;
        }),
    },
  );

  return (
    <Menu
      label="Export"
      width={288}
      items={items}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          disabled={!!busy}
          className={cn(
            'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60',
            compact ? 'w-9 text-muted hover:bg-surface-2 hover:text-text' : 'border border-line bg-surface px-3 text-text hover:bg-surface-2',
          )}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          {!compact && <span>{busy ? 'Exporting…' : 'Export'}</span>}
        </button>
      )}
    />
  );
}
