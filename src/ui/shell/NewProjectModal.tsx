/**
 * "New project": name, ZIP code (hardiness zone & plant feasibility) and an
 * optional overall style. Creates and opens the project. A ZIP fills the
 * USDA zone and the ZIP-centre coordinates from the bundled table (offline,
 * zoneSource 'zip-table'); then, in the background, the frost dates & soil
 * profile is fetched through the Mode server and — when AI is on — the AI
 * climate summary. Both are optional and fail quietly.
 */
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { Loader2, MapPin, Sparkles } from 'lucide-react';
import type { ProjectLocation } from '../../../shared/types';
import { ARCHITECTURAL_STYLES, DESIGN_THEMES } from '../../assets/design';
import { fetchClimate } from '../../lib/studio';
import { useZipLookup } from '../../site/hooks';
import { fetchSiteProfile } from '../../site/profile';
import { lookupZip, normalizeZip, ZONE_SOURCE_NOTE, type ZipInfo } from '../../site/zip';
import { useStore } from '../../state/store';
import { visionUnsupportedReason } from '../../vision';
import { Badge, Button, Field, Modal, TextInput, cn } from '../common';
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
  const onDeviceVision = useMemo(() => visionUnsupportedReason() === null, []);
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
  const zipLookup = useZipLookup(zipOk ? zip : undefined);

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
      const z = normalizeZip(zip) ?? '';
      // Usually already resolved while typing (the table is cached); don't wait on a ZIP known to be missing.
      const typed = zipLookup.status === 'found' && zipLookup.info.zip === z ? zipLookup.info : null;
      const info = !z || zipLookup.status === 'unknown' ? null : (typed ?? (await lookupZip(z)));
      const id = await s.createProject(name.trim() || 'My home');
      const st = style.trim();
      if (z || st) {
        // Initial details are part of creating the project, not an undoable edit.
        useStore.getState().mutateProject(
          'Project details',
          (d) => {
            if (z) d.location.zip = z;
            if (info) Object.assign(d.location, zipLocation(info));
            if (st) d.style = st;
          },
          { history: false },
        );
      }
      closeNewProject();
      if (info) void lookUpSite(id, info);
      if (z && useStore.getState().health?.ai.enabled) void lookUpClimate(id, z, info?.zone ?? null);
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
            ) : zipLookup.status === 'found' ? (
              `Plant suggestions will fit zone ${zipLookup.info.zone}, with frost dates and soil for your area. ${ZONE_SOURCE_NOTE}`
            ) : zipLookup.status === 'unknown' ? (
              'This ZIP isn’t in Mode’s zone table — you can type your hardiness zone in Settings.'
            ) : aiEnabled ? (
              'Used to find your hardiness zone and climate so plant suggestions actually grow there.'
            ) : (
              'Used for your hardiness zone, frost dates and soil so plant suggestions fit your climate.'
            )
          }
        >
          <span className="flex items-center gap-2">
            <TextInput
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/[^\d-]/g, '').slice(0, 10))}
              onBlur={() => setTouchedZip(true)}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="e.g. 20817"
              aria-invalid={touchedZip && !zipOk}
              aria-describedby="mode-new-zone"
              className={cn('max-w-40', touchedZip && !zipOk && 'border-danger! focus:ring-danger/25!')}
            />
            <span id="mode-new-zone" aria-live="polite" className="inline-flex min-w-0 items-center">
              {zipLookup.status === 'loading' && <Loader2 className="size-4 animate-spin text-subtle" aria-label="Looking up the zone" />}
              {zipLookup.status === 'found' && <Badge tone="accent">USDA zone {zipLookup.info.zone}</Badge>}
            </span>
          </span>
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
            No AI key needed: {onDeviceVision ? 'map scenes on this device, ' : 'outline areas with the lasso, '}get photoreal images by
            hand-off to your ChatGPT or Gemini app, and use the Fine-tune hand tools. A Claude key (optional) adds tailored plans.
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Zone (from the PRISM 2023 ZIP table) and ZIP-centre coordinates for a new project. */
function zipLocation(info: ZipInfo): Partial<ProjectLocation> {
  return { hardinessZone: info.zone, zoneSource: 'zip-table', lat: info.lat, lon: info.lon };
}

/** Frost dates & soil for the ZIP centre (via the Mode server); silent when unavailable. */
async function lookUpSite(projectId: string, info: ZipInfo) {
  try {
    const site = await fetchSiteProfile(info.lat, info.lon, undefined, { coordsSource: 'zip' });
    if (!site.frost && !site.soil && !site.ecoregion) return;
    const s = useStore.getState();
    // Only if the project still sits at that ZIP centre (the user may have moved it meanwhile).
    if (s.project?.id !== projectId || s.project.location.lat !== info.lat || s.project.location.lon !== info.lon) return;
    s.mutateProject('Site profile', (d) => void (d.location.site = site), { history: false });
  } catch {
    // Optional: Settings offers the lookup again (e.g. when the server has no site endpoint yet).
  }
}

/** Looks up the climate for a fresh project and stores it (no undo entry). */
async function lookUpClimate(projectId: string, zip: string, zone: string | null) {
  try {
    const climate = await fetchClimate({ zip, hardinessZone: zone, notes: null });
    const s = useStore.getState();
    if (s.project?.id !== projectId) return;
    let zoneNow = climate.hardinessZone;
    s.mutateProject(
      'Climate',
      (d) => {
        if (!d.location.hardinessZone) {
          d.location.hardinessZone = climate.hardinessZone;
          d.location.zoneSource = 'ai';
        }
        // The ZIP-table zone stays the source of truth; the AI summary follows it.
        zoneNow = d.location.hardinessZone;
        d.location.climate = { ...climate, hardinessZone: zoneNow };
      },
      { history: false },
    );
    s.notify(`Climate found for USDA zone ${zoneNow}. Plant suggestions will fit it.`, 'success');
  } catch (err) {
    const s = useStore.getState();
    if (s.project?.id !== projectId) return;
    s.notify(`Couldn't look up the climate for ${zip}: ${errorText(err)} You can try again in Settings.`, 'error');
  }
}
