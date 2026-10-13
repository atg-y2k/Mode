/**
 * Picker for design themes from the knowledge base (cottage garden,
 * xeriscape, Japandi…), the ones that suit the photo's architecture first.
 * Each shows its purpose, principles, palette and climate notes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Sprout } from 'lucide-react';
import type { DesignTheme } from '../../../../shared/types';
import { getStyle, themesFor } from '../../../assets/design';
import { selectActivePhoto, useStore } from '../../../state/store';
import { Badge, Button, Modal, Segmented, Swatch } from '../../common';
import { addThemeIdea } from './ideas';

export function ThemePickerModal({ open, onClose, defaultSetting }: { open: boolean; onClose: () => void; defaultSetting: 'interior' | 'exterior' }) {
  const [setting, setSetting] = useState(defaultSetting);
  useEffect(() => {
    if (open) setSetting(defaultSetting);
  }, [open, defaultSetting]);
  const styleId = useStore((s) => selectActivePhoto(s)?.scene?.architecture.styleId);
  const onBoard = useStore((s) => s.project?.ideaBoard);
  const style = styleId ? getStyle(styleId) : undefined;
  const themes = useMemo(() => themesFor(setting, styleId), [setting, styleId]);
  const added = useMemo(() => new Set((onBoard ?? []).filter((i) => i.kind === 'theme' && i.themeId).map((i) => i.themeId as string)), [onBoard]);
  const suits = (t: DesignTheme) => !!styleId && (t.suits.includes(styleId) || !!style?.themes.includes(t.id));

  return (
    <Modal open={open} onClose={onClose} title="Design themes" size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-md text-sm text-muted">
            Curated looks with a purpose. Add one to the idea board and Mode uses its principles, palette and plants in your designs.
          </p>
          <Segmented
            size="sm"
            value={setting}
            onChange={setSetting}
            options={[
              { value: 'exterior', label: 'Outside' },
              { value: 'interior', label: 'Inside' },
            ]}
          />
        </div>
        {style && <p className="text-xs text-muted">Themes that suit your {style.name} come first.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {themes.map((t) => (
            <ThemeCard key={t.id} theme={t} suits={suits(t)} added={added.has(t.id)} styleName={style?.name} />
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function ThemeCard({ theme, suits, added, styleName }: { theme: DesignTheme; suits: boolean; added: boolean; styleName?: string }) {
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex h-10" aria-hidden>
        {theme.palette.slice(0, 6).map((c, i) => (
          <span key={`${c}${i}`} className="h-full flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="font-display text-base leading-tight text-text">{theme.name}</h3>
          {suits && <Badge tone="accent">Suits your {styleName ?? 'house'}</Badge>}
        </div>
        <p className="text-xs font-medium text-text">{theme.purpose}</p>
        <p className="text-xs leading-relaxed text-muted">{theme.description}</p>
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
          {theme.principles.slice(0, more ? undefined : 3).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {more && (
          <div className="flex flex-col gap-1.5 text-xs text-muted">
            {theme.materials.length > 0 && (
              <p>
                <span className="font-medium text-text">Materials:</span> {theme.materials.join(', ')}
              </p>
            )}
            {theme.plants.length > 0 && (
              <p>
                <span className="font-medium text-text">Plants:</span> {theme.plants.join(', ')}
              </p>
            )}
            {theme.lighting.length > 0 && (
              <p>
                <span className="font-medium text-text">Lighting:</span> {theme.lighting.join(', ')}
              </p>
            )}
            <div className="flex gap-1">
              {theme.palette.map((c, i) => (
                <Swatch key={`${c}${i}`} hex={c} size="sm" title={c} />
              ))}
            </div>
          </div>
        )}
        {theme.climate && (
          <p className="flex items-start gap-1.5 text-[11px] text-subtle">
            <Sprout className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
            {theme.climate}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <button type="button" onClick={() => setMore(!more)} className="text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
            {more ? 'Less' : 'Materials, plants & lighting'}
          </button>
          <Button
            size="sm"
            className="max-lg:h-9"
            variant={added ? 'ghost' : 'primary'}
            disabled={added}
            loading={busy}
            icon={added ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
            onClick={async () => {
              setBusy(true);
              try {
                await addThemeIdea(theme, []);
              } finally {
                setBusy(false);
              }
            }}
          >
            {added ? 'On your board' : 'Add'}
          </Button>
        </div>
      </div>
    </li>
  );
}
