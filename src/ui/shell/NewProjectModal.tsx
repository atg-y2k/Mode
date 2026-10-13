/**
 * "New project": name, ZIP code (hardiness zone & plant feasibility) and an
 * optional overall style. Creates and opens the project; when a ZIP is given
 * and AI is on, the climate profile is looked up in the background.
 */
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { MapPin, Sparkles } from 'lucide-react';
import { ARCHITECTURAL_STYLES, DESIGN_THEMES } from '../../assets/design';
import { fetchClimate } from '../../lib/studio';
import { useStore } from '../../state/store';
import { Button, Field, Modal, TextInput, cn } from '../common';
import { errorText, isValidZip } from './format';
import { closeNewProject, useShellUI } from './shellUI';

const QUICK_STYLES = ['Modern farmhouse', 'Craftsman', 'Coastal', 'Mid-century modern', 'Cottage garden', 'Drought-tolerant'];

function styleSuggestions(): string[] {
  try {
    const names = [...ARCHITECTURAL_STYLES.map((s) => s.name), ...DESIGN_THEMES.map((t) => t.name)];
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  } catch {
    return QUICK_STYLES; // design knowledge not loaded
  }
}

export function NewProjectModal() {
  const open = useShellUI((s) => s.newProjectOpen);
  return open ? <NewProjectForm /> : null;
}

function NewProjectForm() {
  const aiEnabled = useStore((s) => !!s.health?.ai.enabled);
  const [name, setName] = useState('');
  const [zip, setZip] = useState('');
  const [style, setStyle] = useState('');
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = (v: boolean) => {
    busyRef.current = v;
    setBusyState(v);
  };
  // Stable: the Modal re-runs its focus effect whenever onClose changes identity.
  const onClose = useCallback(() => {
    if (!busyRef.current) closeNewProject();
  }, []);
  const [touchedZip, setTouchedZip] = useState(false);
  const suggestions = useMemo(styleSuggestions, []);
  const zipOk = isValidZip(zip);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!zipOk) {
      setTouchedZip(true);
      return;
    }
    setBusy(true);
    const s = useStore.getState();
    try {
      const id = await s.createProject(name.trim() || 'My home');
      const z = zip.trim();
      const st = style.trim();
      if (z || st) {
        // Initial details are part of creating the project, not an undoable edit.
        useStore.getState().mutateProject(
          'Project details',
          (d) => {
            if (z) d.location.zip = z;
            if (st) d.style = st;
          },
          { history: false },
        );
      }
      closeNewProject();
      if (z && useStore.getState().health?.ai.enabled) void lookUpClimate(id, z);
    } catch (err) {
      s.notify(`Couldn't create the project: ${errorText(err)}`, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New project"
      footer={
        <>
          <Button onClick={closeNewProject} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Create project
          </Button>
        </>
      }
    >
      <form
        onSubmit={submit}
        onKeyDown={(e) => {
          // Enter in any single-line field creates the project.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
            void submit();
          }
        }}
        className="flex flex-col gap-4"
      >
        <p className="text-sm text-muted">
          A project is your house. Inside it you’ll add spaces — rooms, the front of the house, the yard — and photos of each.
        </p>
        <Field label="Project name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maple Street house" maxLength={80} autoComplete="off" />
        </Field>
        <Field
          label={
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden /> ZIP code <span className="font-normal text-subtle">(recommended)</span>
            </span>
          }
          hint={
            touchedZip && !zipOk ? (
              <span className="text-danger">Enter a 5-digit US ZIP code, or leave it empty.</span>
            ) : aiEnabled ? (
              'Used to find your hardiness zone and climate so plant suggestions actually grow there.'
            ) : (
              'Used for your hardiness zone so plant suggestions fit your climate. You can add the zone yourself in Settings.'
            )
          }
        >
          <TextInput
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/[^\d-]/g, '').slice(0, 10))}
            onBlur={() => setTouchedZip(true)}
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="e.g. 20817"
            aria-invalid={touchedZip && !zipOk}
            className={cn('max-w-40', touchedZip && !zipOk && 'border-danger! focus:ring-danger/25!')}
          />
        </Field>
        <Field label="Overall style (optional)" hint="A direction for the whole house. Each photo’s architecture is read separately.">
          <TextInput value={style} onChange={(e) => setStyle(e.target.value)} list="mode-style-suggestions" placeholder="e.g. Modern farmhouse, cottage garden" maxLength={120} />
          <datalist id="mode-style-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {QUICK_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStyle(s)}
              aria-pressed={style === s}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                style === s ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:border-line-strong hover:text-text',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {!aiEnabled && (
          <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            AI features are off on this server. You can still outline surfaces, try paint, materials, lighting and plants by hand in
            Fine-tune.
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Looks up the climate for a fresh project and stores it (no undo entry). */
async function lookUpClimate(projectId: string, zip: string) {
  try {
    const climate = await fetchClimate({ zip, hardinessZone: null, notes: null });
    const s = useStore.getState();
    if (s.project?.id !== projectId) return;
    s.mutateProject(
      'Climate',
      (d) => {
        d.location.climate = climate;
        if (!d.location.hardinessZone) d.location.hardinessZone = climate.hardinessZone;
      },
      { history: false },
    );
    s.notify(`Climate found: USDA zone ${climate.hardinessZone}. Plant suggestions will fit it.`, 'success');
  } catch (err) {
    const s = useStore.getState();
    if (s.project?.id !== projectId) return;
    s.notify(`Couldn't look up the climate for ${zip}: ${errorText(err)} You can try again in Settings.`, 'error');
  }
}
