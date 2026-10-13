/**
 * Suggested-edit chips atop the Design panel: the scene map's opportunities
 * and the latest AI suggestions as one-click additions to the brief (prompt
 * line + element + target areas, merged like "Add to brief" on the Suggest
 * tab). Edits already in the brief drop out of the row.
 */
import { useId, useMemo, useState } from 'react';
import { Lightbulb, Plus, Sparkles } from 'lucide-react';
import type { DesignBrief, Photo, SceneMap } from '../../../../shared/types';
import { elementsForSetting, getElementDef } from '../../../assets/design';
import { useStore } from '../../../state/store';
import { addRecommendationToBrief } from './actions';
import { elementIcon } from './icons';
import { suggestedEdits, type SuggestedEdit } from './suggestedEdits';

const PREVIEW = 4;

export function SuggestedEditChips({
  photo,
  scene,
  brief,
  setting,
  onAdded,
}: {
  photo: Photo;
  scene: SceneMap | undefined;
  brief: DesignBrief;
  setting: 'interior' | 'exterior';
  /** Called with the element the edit added or updated (to scroll it into view). */
  onAdded?: (elementId: string | null) => void;
}) {
  const titleId = useId();
  const [all, setAll] = useState(false);
  const recs = photo.recommendations?.items;
  const edits = useMemo(() => {
    const offered = new Set(elementsForSetting(setting).map((d) => d.type));
    return suggestedEdits({ scene, recommendations: recs, brief, setting, offered, zoneKindsOf: (t) => getElementDef(t).zoneKinds });
  }, [scene, recs, brief, setting]);
  if (edits.length === 0) return null;
  const shown = all ? edits : edits.slice(0, PREVIEW);

  const add = (edit: SuggestedEdit) => onAdded?.(addRecommendationToBrief(photo.id, edit.rec, { onDesignTab: true }));

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 border-b border-line px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <Lightbulb className="size-3.5 text-gold" aria-hidden />
          Suggested edits
        </h3>
        <button
          type="button"
          onClick={() => useStore.getState().setStudio({ panel: 'suggestions' })}
          className="text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          More ideas
        </button>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((edit) => {
          const def = edit.rec.elementType ? getElementDef(edit.rec.elementType) : undefined;
          const Icon = def ? elementIcon(def.icon) : edit.source === 'ai' ? Sparkles : Plus;
          return (
            <li key={edit.id} className="max-w-full">
              <button
                type="button"
                onClick={() => add(edit)}
                title={`${edit.title}\n\nClick to add to your brief${def ? ` (${def.label})` : ''}.`}
                aria-label={`Add to brief: ${edit.label}`}
                className="group inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-dashed border-line-strong bg-surface px-3 py-1 text-left text-xs font-medium text-text transition-colors hover:border-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent lg:min-h-8"
              >
                <Icon className="size-3.5 shrink-0 text-accent" aria-hidden />
                <span className="truncate">{edit.label}</span>
                <Plus className="size-3 shrink-0 text-subtle transition-colors group-hover:text-accent" aria-hidden />
              </button>
            </li>
          );
        })}
        {edits.length > PREVIEW && (
          <li>
            <button
              type="button"
              onClick={() => setAll(!all)}
              className="min-h-9 rounded-full px-2 text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8"
            >
              {all ? 'Fewer' : `+${edits.length - PREVIEW} more`}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
