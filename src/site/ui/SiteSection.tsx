/**
 * Settings → Project → "Location & climate": where the property is
 * (ZIP centre, photo GPS or an exact location), deer pressure, the free
 * government site profile (NOAA frost dates, USDA soil) and one-click
 * native-plant link-outs. Coordinates stay on this device except for the
 * site-profile lookup, which goes through the user's own Mode server.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Camera,
  Crosshair,
  ExternalLink,
  Layers,
  Leaf,
  MapPin,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Snowflake,
  Sprout,
  Sun,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { Project, ProjectLocation, SiteProfile } from '../../../shared/types';
import { isAbortError } from '../../lib/api';
import { useStore } from '../../state/store';
import { Badge, Button, Field, NumberInput, Segmented, cn } from '../../ui/common';
import { relativeTime } from '../../ui/shell/format';
import { COORDS_SOURCE_LABELS, DEER_PRESSURE_OPTIONS, formatCoords, frostSummary, soilFacts } from '../format';
import { plantLinks } from '../links';
import { coordsOf, coordsSourceOf, photosWithGps, withCoords } from '../location';
import { useInvasivesReady } from '../hooks';
import { invasiveCoverageNote, invasivesCount } from '../invasives';
import { fetchSiteProfile } from '../profile';
import { hasZipCoords, localityForZip, type ZipInfo } from '../zip';

type DeerChoice = NonNullable<ProjectLocation['deerPressure']> | 'unset';

const LOOKED_UP_FOR: Record<SiteProfile['coordsSource'], string> = {
  zip: 'ZIP code centre',
  address: 'exact location',
  'photo-gps': 'photo’s GPS location',
};

export interface SiteSectionProps {
  project: Project;
  /** Merges a patch into project.location (one undo step per edit burst). */
  setLocation: (patch: Partial<ProjectLocation>) => void;
  /** The project ZIP resolved in the zone table (null while unknown). */
  zipInfo: ZipInfo | null;
}

export function SiteSection({ project, setLocation, zipInfo }: SiteSectionProps) {
  const location = project.location;
  const gps = photosWithGps(project);
  const coords = coordsOf(location);
  const source = coordsSourceOf(
    location,
    zipInfo,
    gps.map((g) => g.capture),
  );

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-2/60 p-4">
      <CoordinatesRow location={location} source={source} gps={gps} zipInfo={zipInfo} setLocation={setLocation} />
      <DeerPressureField value={location.deerPressure} onChange={(deerPressure) => setLocation({ deerPressure })} />
      <SiteProfileCard
        key={coords ? `${coords.lat},${coords.lon}` : 'none'}
        projectId={project.id}
        location={location}
        source={source}
        setLocation={setLocation}
      />
      <LinkOuts zip={location.zip} />
    </div>
  );
}

/**
 * What the invasive flags on plant cards cover (C11): US-RIIS for the ZIP's
 * region and no state list — so an unflagged plant reads as "not flagged",
 * never as "not invasive".
 */
function InvasiveCoverage({ zip }: { zip: string | undefined }) {
  const ready = useInvasivesReady();
  const locality = localityForZip(zip) ?? 'L48';
  return (
    <p className="flex items-start gap-2 text-[11px] leading-relaxed text-subtle">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {invasiveCoverageNote(locality)}
        {ready ? ` (${invasivesCount().toLocaleString()} plant names)` : ''}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

function CoordinatesRow({
  location,
  source,
  gps,
  zipInfo,
  setLocation,
}: {
  location: ProjectLocation;
  source: SiteProfile['coordsSource'] | null;
  gps: ReturnType<typeof photosWithGps>;
  zipInfo: ZipInfo | null;
  setLocation: (patch: Partial<ProjectLocation>) => void;
}) {
  const coords = coordsOf(location);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ lat?: number; lon?: number }>({});
  const latOk = draft.lat !== undefined && Math.abs(draft.lat) <= 90;
  const lonOk = draft.lon !== undefined && Math.abs(draft.lon) <= 180;
  const photo = gps[0];

  const startEdit = () => {
    setDraft(coords ? { lat: coords.lat, lon: coords.lon } : {});
    setEditing(true);
  };
  const save = () => {
    if (!latOk || !lonOk) return;
    setLocation(withCoords(location, { lat: draft.lat as number, lon: draft.lon as number }));
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
            <Crosshair className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-subtle">Property location</p>
            {coords ? (
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium tabular-nums text-text">
                {formatCoords(coords.lat, coords.lon)}
                {source && <Badge tone={source === 'zip' ? 'neutral' : 'accent'}>{COORDS_SOURCE_LABELS[source]}</Badge>}
              </p>
            ) : zipInfo && !hasZipCoords(zipInfo) ? (
              <p className="text-sm text-muted">ZIP {zipInfo.zip} has no map centre (PO-box or single-organisation ZIP) — use a photo’s location or enter coordinates</p>
            ) : (
              <p className="text-sm text-muted">Not set — add your ZIP code above</p>
            )}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {photo && source !== 'photo-gps' && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Camera className="size-3.5" />}
              title={`Use the GPS location saved with “${photo.name}”`}
              onClick={() => setLocation(withCoords(location, photo.capture))}
            >
              Use photo location
            </Button>
          )}
          {hasZipCoords(zipInfo) && coords && source !== 'zip' && (
            <Button size="sm" variant="ghost" icon={<MapPin className="size-3.5" />} onClick={() => setLocation(withCoords(location, zipInfo))}>
              Use ZIP centre
            </Button>
          )}
          {!editing && (
            <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={startEdit}>
              {coords ? 'Edit' : 'Enter coordinates'}
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Latitude" hint={draft.lat !== undefined && !latOk ? <span className="text-danger">−90 to 90</span> : undefined}>
              <NumberInput value={draft.lat} step="any" placeholder="38.9968" onValueChange={(lat) => setDraft((d) => ({ ...d, lat }))} />
            </Field>
            <Field label="Longitude" hint={draft.lon !== undefined && !lonOk ? <span className="text-danger">−180 to 180</span> : undefined}>
              <NumberInput value={draft.lon} step="any" placeholder="-77.1352" onValueChange={(lon) => setDraft((d) => ({ ...d, lon }))} />
            </Field>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Tip: in a map app, long-press or right-click your house to copy its coordinates (west longitudes are negative).
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!latOk || !lonOk}>
              Use these coordinates
            </Button>
          </div>
        </form>
      )}
      <p className="text-[11px] leading-relaxed text-subtle">
        Used for sun angles, frost dates and soil. It stays on this device — only the frost-date and soil lookup sends it, through your Mode
        server, to NOAA and USDA.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deer pressure
// ---------------------------------------------------------------------------

function DeerPressureField({ value, onChange }: { value: ProjectLocation['deerPressure']; onChange: (v: ProjectLocation['deerPressure']) => void }) {
  const choice: DeerChoice = value ?? 'unset';
  const hint =
    DEER_PRESSURE_OPTIONS.find((o) => o.value === value)?.hint ?? 'Not set — deer favorites get a note, not a warning. Ask a neighbour if unsure.';
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted" aria-hidden>
        Deer pressure
      </span>
      <div>
        <Segmented<DeerChoice>
          value={choice}
          label="Deer pressure"
          onChange={(v) => onChange(v === 'unset' ? undefined : v)}
          options={[
            { value: 'unset', label: <span className="whitespace-nowrap">Not sure</span> },
            ...DEER_PRESSURE_OPTIONS.map((o) => ({ value: o.value as DeerChoice, label: o.label, title: o.hint })),
          ]}
          className="w-full sm:w-auto"
        />
      </div>
      <p className="text-xs text-subtle">{hint}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site profile (frost dates & soil)
// ---------------------------------------------------------------------------

function SiteProfileCard({
  projectId,
  location,
  source,
  setLocation,
}: {
  projectId: string;
  location: ProjectLocation;
  source: SiteProfile['coordsSource'] | null;
  setLocation: (patch: Partial<ProjectLocation>) => void;
}) {
  const coords = coordsOf(location);
  const site = location.site;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const lookUp = async (force: boolean) => {
    if (!coords || busy) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const profile = await fetchSiteProfile(coords.lat, coords.lon, controller.signal, { coordsSource: source ?? 'zip', force });
      // The user may have switched projects while the lookup ran.
      if (useStore.getState().project?.id !== projectId) return;
      setLocation({ site: profile });
      if (!profile.frost && !profile.soil) setError('No frost or soil records were found for this spot. Try again later, or check a nearby ZIP.');
    } catch (err) {
      if (!isAbortError(err)) setError(err instanceof Error ? err.message : 'The lookup failed.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const frost = site?.frost ? frostSummary(site.frost) : null;
  const soil = site?.soil;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-text">Frost dates & soil</h4>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {site
              ? `Looked up ${relativeTime(site.updatedAt)} for the ${LOOKED_UP_FOR[site.coordsSource]}.`
              : 'Free government data for your spot: NOAA 1991–2020 climate normals and the USDA soil survey.'}
          </p>
        </div>
        <Button
          size="sm"
          variant={site ? 'ghost' : 'secondary'}
          icon={site ? <RefreshCw className="size-3.5" /> : <Sprout className="size-3.5" />}
          loading={busy}
          disabled={!coords}
          title={coords ? undefined : 'Add a ZIP code or coordinates first'}
          onClick={() => void lookUp(!!site)}
        >
          {site ? 'Refresh' : 'Look up'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {frost?.frostFree && (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2 rounded-lg bg-surface px-2.5 py-2 text-xs">
            <Sun className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-text">{frost.headline}</p>
              <p className="text-[11px] text-muted">No 32 °F freeze in a typical year — plant by heat and rainfall, not frost dates.</p>
            </div>
          </div>
          <p className="text-[11px] text-subtle">{frost.sourceLine}</p>
        </div>
      )}
      {frost && !frost.frostFree && (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-1 gap-2 text-xs min-[420px]:grid-cols-3">
            <Fact icon={Snowflake} label="Last spring frost" value={`~${frost.lastFrost}`} sub={frost.lastFrostLate} />
            <Fact icon={CalendarDays} label="First fall frost" value={`~${frost.firstFrost}`} sub={frost.firstFrostEarly} />
            <Fact icon={Leaf} label="Growing season" value={frost.season?.replace(' frost-free days', ' days') ?? '—'} sub="frost-free (median)" />
          </dl>
          <p className="text-[11px] text-subtle">{frost.sourceLine}</p>
        </div>
      )}
      {soil && (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Layers className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            <p className="text-xs leading-relaxed text-text">
              <span className="font-medium">{soil.mapUnit}</span>
            </p>
          </div>
          {soilFacts(soil).length > 0 && (
            <dl className="flex flex-wrap gap-1.5">
              {soilFacts(soil).map((f) => (
                <div key={f.label} className="rounded-lg bg-surface px-2.5 py-1.5 text-xs">
                  <dt className="inline text-subtle">{f.label}: </dt>
                  <dd className="inline font-medium text-text">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {soil.disturbed && (
            <p className="flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-xs leading-relaxed text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Mapped as disturbed or urban fill — the soil survey is unreliable here. A soil test from your extension office is worth it.
            </p>
          )}
          <p className="text-[11px] text-subtle">USDA NRCS Soil Data Access (SSURGO) · map unit at the point</p>
        </div>
      )}
      {site?.ecoregion && (
        <p className="text-xs text-muted">
          <span className="text-subtle">Ecoregion: </span>
          {site.ecoregion}
        </p>
      )}
      {site && !frost && !soil && !error && <p className="text-xs text-muted">No frost or soil records were returned for this spot.</p>}
    </div>
  );
}

function Fact({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-surface px-2.5 py-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0">
        <dt className="text-[10px] uppercase tracking-wider text-subtle">{label}</dt>
        <dd className="truncate font-medium text-text">{value}</dd>
        {sub && <dd className="truncate text-[11px] text-muted">{sub}</dd>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Link-outs
// ---------------------------------------------------------------------------

function LinkOuts({ zip }: { zip: string | undefined }) {
  const links = plantLinks({ zip }).filter((l) => l.kind !== 'plant');
  if (!links.length) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <h4 className="text-sm font-medium text-text">Check plants for your area</h4>
      <ul className="flex flex-wrap gap-1.5">
        {links.map((l) => (
          <li key={l.url}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              title={l.description}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-text transition-colors',
                'hover:border-line-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
              )}
            >
              {l.label}
              <ExternalLink className="size-3 text-subtle" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-subtle">Opens in a new tab. Native-plant finders use your ZIP; Rutgers ratings reflect the Northeast.</p>
      <InvasiveCoverage zip={zip} />
    </div>
  );
}
