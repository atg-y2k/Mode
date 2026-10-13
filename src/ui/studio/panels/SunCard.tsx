/**
 * Sun & orientation (borrowed from iScape's sun slider), in the Scene panel
 * for outside photos:
 * - a compass dial (north up) with the house drawn facing the way the
 *   photographed side faces — from the photo's compass heading, the AI's
 *   estimate, or set by dragging the dial (stored as the user's);
 * - month + time: the sun on the dial (closer to the centre = higher), its
 *   track that day, the house's shadow and which walls it lights;
 * - estimated direct-sun hours for each ground area over the growing season
 *   (SunCalc, open sky), and "Update sun on areas" to write them to the scene
 *   so plant ratings use them.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { MapPin, RotateCcw, Sun, SunDim } from 'lucide-react';
import type { Photo, ProjectLocation, SceneMap } from '../../../../shared/types';
import { coordsOf, useZipLookup, type LatLon } from '../../../site';
import { useStore } from '../../../state/store';
import { Badge, Button, Section, Select, Slider, cn } from '../../common';
import { openSettings } from '../../shell/shellUI';
import { zoneIcon } from './icons';
import { formatHours } from './siteHeader';
import {
  altitudeRadius,
  bearingOf,
  clockFor,
  dayPath,
  directionText,
  footprint,
  formatMinutes,
  litFaces,
  litSummary,
  minutesOf,
  polar,
  resolveFacing,
  shadowPolygon,
  snapDeg,
  studyDate,
  sunAt,
  zoneSunEstimates,
  type FacingSource,
  type LitFaces,
  type SunAt,
} from './sunStudy';
import { sunLabel } from './zones';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TIME_MIN = 5 * 60;
const TIME_MAX = 21 * 60;

const SOURCE_TEXT: Record<FacingSource, string> = {
  photo: "From your photo's compass heading",
  user: 'Set by you',
  ai: 'Estimated by AI from shadows — drag the dial to correct it',
};

type SunCoords = LatLon & { from: 'project' | 'photo' | 'zip' };

/** Where to compute the sun: the project's coordinates (ZIP centre / address), else the photo's GPS. */
export function sunCoords(location: ProjectLocation | undefined, photo: Pick<Photo, 'capture'>): SunCoords | null {
  const c = coordsOf(location);
  if (c) return { ...c, from: 'project' };
  const { lat, lon } = photo.capture ?? {};
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, from: 'photo' } : null;
}

export function SunCard({ photo, scene, location }: { photo: Photo; scene: SceneMap; location: ProjectLocation | undefined }) {
  const monthId = useId();
  const facing = useMemo(() => resolveFacing(scene, photo.capture), [scene, photo.capture]);
  const known = sunCoords(location, photo);
  // Projects whose ZIP predates stored coordinates: use the ZIP's centre from the bundled table.
  const zip = useZipLookup(known ? undefined : location?.zip);
  const coords: SunCoords | null = known ?? (zip.status === 'found' ? { lat: zip.info.lat, lon: zip.info.lon, from: 'zip' } : null);
  const clock = coords ? clockFor(coords.lon, new Date().getTimezoneOffset()) : 'local';
  const taken = photo.capture?.takenAt ? new Date(photo.capture.takenAt) : null;
  const [month, setMonth] = useState(() => (taken ?? new Date()).getMonth() + 1);
  const [minutes, setMinutes] = useState(() => (taken && coords ? clamp(minutesOf(taken, coords.lon, clock)) : 10 * 60));
  /** Direction while the dial is being dragged (committed on release). */
  const [dragDeg, setDragDeg] = useState<number | null>(null);
  const deg = dragDeg ?? facing?.deg ?? null;

  const lat = coords?.lat;
  const lon = coords?.lon;
  const sun = useMemo(() => (lat !== undefined && lon !== undefined ? sunAt(lat, lon, studyDate(month, minutes, lon, clock)) : null), [lat, lon, month, minutes, clock]);
  const path = useMemo(() => (lat !== undefined && lon !== undefined ? dayPath(lat, lon, month, clock) : []), [lat, lon, month, clock]);
  const estimates = useMemo(
    () => (lat !== undefined && lon !== undefined && deg !== null ? zoneSunEstimates(scene, deg, lat, lon, month) : []),
    [scene, deg, lat, lon, month],
  );
  const faces = sun && deg !== null ? litFaces(sun, deg) : null;
  const changed = estimates.filter((e) => e.changed).length;

  const commitFacing = (next: number) => {
    setDragDeg(null);
    if (facing?.source === 'user' && facing.deg === next) return;
    useStore.getState().updateScene(
      photo.id,
      (sc) => {
        sc.facadeAzimuthDeg = next;
        sc.facadeAzimuthSource = 'user';
      },
      {},
    );
  };

  const resetFacing = () =>
    useStore.getState().updateScene(
      photo.id,
      (sc) => {
        delete sc.facadeAzimuthDeg;
        delete sc.facadeAzimuthSource;
      },
      {},
    );

  const writeZones = () => {
    if (!facing || deg === null) return;
    const byId = new Map(estimates.map((e) => [e.zone.id, e]));
    useStore.getState().updateScene(
      photo.id,
      (sc) => {
        for (const z of sc.zones) {
          const e = byId.get(z.id);
          if (!e) continue;
          z.sun = e.exposure;
          z.sunHours = e.hours;
        }
        // Remember which way the estimates assumed the photo faces.
        if (sc.facadeAzimuthSource !== 'user') {
          sc.facadeAzimuthDeg = deg;
          sc.facadeAzimuthSource = facing.source;
        }
      },
      {},
    );
    useStore.getState().notify(`Updated the sun on ${estimates.length} area${estimates.length === 1 ? '' : 's'} — plant ratings now use it. Undo restores the old values.`, 'success');
  };

  const canResetToPhoto = facing?.source === 'user' && typeof photo.capture?.headingDeg === 'number';

  return (
    <Section title="Sun & orientation">
      <div className="flex items-start gap-3">
        <Dial deg={deg} sun={sun} path={path} faces={faces} onDrag={setDragDeg} onCommit={commitFacing} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">
          <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">{facing?.atHouse === false ? 'This view faces' : 'The front faces'}</p>
          {deg !== null ? (
            <p className="font-display text-base leading-tight text-text">{directionText(deg)}</p>
          ) : (
            <p className="leading-snug text-muted">Tap the dial on the direction the photographed side faces.</p>
          )}
          {facing && dragDeg === null && <p className="leading-snug text-muted">{SOURCE_TEXT[facing.source]}</p>}
          {canResetToPhoto && (
            <button type="button" onClick={resetFacing} className="inline-flex items-center gap-1 self-start font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
              <RotateCcw className="size-3" aria-hidden /> Use the photo's heading
            </button>
          )}
        </div>
      </div>

      {!coords ? (
        zip.status === 'loading' ? (
          <p className="text-xs text-muted" role="status">
            Finding your ZIP code…
          </p>
        ) : (
          <div className="flex flex-col items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted">
            <p className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
              {zip.status === 'unknown'
                ? `Mode couldn't place ZIP ${location?.zip?.trim() ?? ''} — check it in project settings so it can follow the sun over your house.`
                : 'Add your ZIP code so Mode can follow the sun over your house — its path depends on where you are.'}
            </p>
            <Button size="sm" className="max-lg:h-9" variant="primary" onClick={() => openSettings('project')}>
              {zip.status === 'unknown' ? 'Project settings' : 'Add ZIP'}
            </Button>
          </div>
        )
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor={monthId} className="shrink-0 text-xs font-medium text-muted">
                Month
              </label>
              <Select id={monthId} value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} className="h-8 text-xs">
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
              {taken && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 max-lg:h-9"
                  title="Show the sun when the photo was taken"
                  onClick={() => {
                    setMonth(taken.getMonth() + 1);
                    setMinutes(clamp(minutesOf(taken, coords.lon, clock)));
                  }}
                >
                  Photo time
                </Button>
              )}
            </div>
            <Slider
              label="Time of day"
              value={minutes}
              min={TIME_MIN}
              max={TIME_MAX}
              step={15}
              onChange={setMinutes}
              format={(v) => `${formatMinutes(v)}${clock === 'solar' ? ' sun time' : ''}`}
            />
          </div>
          {sun && (
            <p className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-2.5 py-2 text-xs leading-snug text-text" aria-live="polite">
              {sun.up ? <Sun className="mt-px size-3.5 shrink-0 text-gold" aria-hidden /> : <SunDim className="mt-px size-3.5 shrink-0 text-subtle" aria-hidden />}
              <span>
                {sun.up ? (
                  <>
                    Sun {Math.round(sun.altitudeDeg)}° high in the {directionText(sun.azimuthDeg)}
                    {faces && deg !== null && <span className="text-muted"> · {litSummary(faces, sun)}</span>}
                  </>
                ) : (
                  'The sun is below the horizon.'
                )}
              </span>
            </p>
          )}

          {deg === null ? null : estimates.length === 0 ? (
            <p className="text-xs text-muted">No ground areas (lawn, beds, paths…) in the scene map to estimate.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted">Direct sun per area (a day, growing season)</p>
              <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
                {estimates.map((e) => {
                  const Icon = zoneIcon(e.zone.kind);
                  const was = e.zone.sun && e.zone.sun !== e.exposure ? sunLabel(e.zone.sun) : null;
                  return (
                    <li
                      key={e.zone.id}
                      onPointerEnter={() => useStore.getState().setStudio({ focusZoneId: e.zone.id })}
                      onPointerLeave={() => useStore.getState().setStudio({ focusZoneId: null })}
                      className="flex items-center gap-2 px-2.5 py-2"
                    >
                      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-text">{e.zone.label}</p>
                        <p className="truncate text-[11px] text-subtle">
                          Faces {directionText(e.azimuthDeg).replace(/ \(.*\)$/, '')}
                          {e.side !== 'front' ? ` · ${e.side} side` : ''}
                          {was ? ` · now “${was}”` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <Badge tone={e.exposure === 'full-sun' ? 'warning' : e.exposure === 'part-sun' ? 'accent' : 'neutral'}>{sunLabel(e.exposure)}</Badge>
                        <span className="text-[11px] tabular-nums text-muted" title={`${e.hours} h a day on average over the growing season; ${e.monthHours} h on ${MONTHS[month - 1]} 15`}>
                          {formatHours(e.hours)} avg · {MONTHS[month - 1].slice(0, 3)} {formatHours(e.monthHours)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Button size="sm" variant={changed ? 'primary' : 'secondary'} className="max-lg:h-9" icon={<Sun className="size-3.5" />} disabled={changed === 0} onClick={writeZones}>
                {changed ? `Update sun on areas (${changed})` : 'Areas are up to date'}
              </Button>
              <p className="text-[11px] leading-snug text-subtle">
                Estimates assume open sky with the house shading the side behind it (SunCalc{coords.from === 'photo' ? ", at your photo's GPS location" : ''}). Trees, fences and
                neighbors cut sun further — adjust an area by hand if you know better. Full sun ≥ 6 h, part sun 2–6 h, shade &lt; 2 h.
              </p>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function clamp(minutes: number): number {
  return Math.min(TIME_MAX, Math.max(TIME_MIN, Math.round(minutes / 15) * 15));
}

// ---------------------------------------------------------------------------
// The dial
// ---------------------------------------------------------------------------

const SIZE = 148;
const C = SIZE / 2;
const R = 56;
/** House footprint on the dial (≈ a 40 × 28 ft house, 2 stories). */
const HOUSE_W = 30;
const HOUSE_D = 21;
const HOUSE_H = 18;

function pts(list: { x: number; y: number }[]): string {
  return list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function Dial({
  deg,
  sun,
  path,
  faces,
  onDrag,
  onCommit,
}: {
  deg: number | null;
  sun: SunAt | null;
  path: SunAt[];
  faces: LitFaces | null;
  onDrag: (deg: number | null) => void;
  onCommit: (deg: number) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const shown = deg ?? 180;
  const house = footprint(C, C, HOUSE_W, HOUSE_D, shown);
  const shadow = sun && deg !== null ? shadowPolygon(house, sun, HOUSE_H, R) : [];
  const front = polar(C, C, HOUSE_D / 2, shown);
  const tip = polar(C, C, R - 4, shown);
  const handle = polar(C, C, R, shown);
  const sunPt = sun?.up ? polar(C, C, altitudeRadius(sun.altitudeDeg, R), sun.azimuthDeg) : null;
  // Edges: front 0-1, photo's left side 1-2, back 2-3, photo's right side 3-0.
  const edges: { a: number; b: number; lit: boolean }[] = [
    { a: 0, b: 1, lit: !!faces?.front },
    { a: 1, b: 2, lit: !!faces?.left },
    { a: 2, b: 3, lit: !!faces?.back },
    { a: 3, b: 0, lit: !!faces?.right },
  ];

  const bearingAt = (e: PointerEvent<SVGSVGElement>): { bearing: number; dist: number } | null => {
    const svg = ref.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * SIZE;
    const y = ((e.clientY - r.top) / r.height) * SIZE;
    return { bearing: snapDeg(bearingOf(C, C, x, y)), dist: Math.hypot(x - C, y - C) };
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const b = bearingAt(e);
    // The centre (the house) is not a target: only the ring turns the dial.
    if (!b || b.dist < R * 0.45) return;
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onDrag(b.bearing);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const b = bearingAt(e);
    if (b) onDrag(b.bearing);
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const b = bearingAt(e);
    if (b) onCommit(b.bearing);
    else onDrag(null);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 45 : 5;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = shown + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = shown - step;
    else if (e.key === 'PageUp') next = shown + 45;
    else if (e.key === 'PageDown') next = shown - 45;
    else if (e.key === 'Home') next = 0;
    if (next === null) return;
    e.preventDefault();
    onCommit(snapDeg(next));
  };

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="size-36 shrink-0 cursor-grab touch-none select-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:cursor-grabbing"
      role="slider"
      tabIndex={0}
      aria-label="Which way the photographed side faces (drag around the dial)"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={deg ?? undefined}
      aria-valuetext={deg !== null ? `Faces ${directionText(deg)}` : 'Not set'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        dragging.current = false;
        onDrag(null);
      }}
      onKeyDown={onKeyDown}
    >
      <circle cx={C} cy={C} r={R + 12} className="fill-surface-2" />
      <circle cx={C} cy={C} r={R} className="fill-surface stroke-line-strong" strokeWidth="1" />
      {/* Altitude rings: 30° and 60° above the horizon. */}
      {[30, 60].map((a) => (
        <circle key={a} cx={C} cy={C} r={altitudeRadius(a, R)} className="fill-none stroke-line" strokeDasharray="2 3" strokeWidth="0.75" />
      ))}
      {Array.from({ length: 12 }, (_, i) => {
        const a = polar(C, C, R, i * 30);
        const b = polar(C, C, R - (i % 3 === 0 ? 6 : 3), i * 30);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-line-strong" strokeWidth="1" />;
      })}
      {(['N', 'E', 'S', 'W'] as const).map((l, i) => {
        const p = polar(C, C, R + 7, i * 90);
        return (
          <text key={l} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" className={cn('text-[8px] font-semibold', l === 'N' ? 'fill-accent' : 'fill-subtle')}>
            {l}
          </text>
        );
      })}

      {/* The sun's track that day. */}
      {path.length > 1 && (
        <polyline
          points={pts(path.map((s) => polar(C, C, altitudeRadius(s.altitudeDeg, R), s.azimuthDeg)))}
          className="fill-none stroke-gold"
          strokeWidth="1.25"
          strokeDasharray="1.5 2.5"
          strokeLinecap="round"
          opacity="0.8"
        />
      )}

      {shadow.length > 2 && <polygon points={pts(shadow)} className="fill-text" opacity="0.12" />}

      <g opacity={deg === null ? 0.35 : 1}>
        <polygon points={pts(house)} className="fill-surface-3 stroke-none" />
        {edges.map(({ a, b, lit }) => (
          <line
            key={`${a}${b}`}
            x1={house[a].x}
            y1={house[a].y}
            x2={house[b].x}
            y2={house[b].y}
            className={lit ? 'stroke-gold' : 'stroke-line-strong'}
            strokeWidth={lit ? 2.5 : 1.25}
            strokeLinecap="round"
          />
        ))}
        {/* Facing arrow from the front wall to the ring. */}
        <line x1={front.x} y1={front.y} x2={tip.x} y2={tip.y} className="stroke-accent" strokeWidth="1.75" strokeLinecap="round" strokeDasharray={deg === null ? '3 3' : undefined} />
        <circle cx={handle.x} cy={handle.y} r="6" className="fill-accent stroke-surface" strokeWidth="2" />
      </g>

      {sunPt && (
        <g>
          <circle cx={sunPt.x} cy={sunPt.y} r="8" className="fill-gold" opacity="0.25" />
          <circle cx={sunPt.x} cy={sunPt.y} r="4.5" className="fill-gold stroke-surface" strokeWidth="1.25" />
        </g>
      )}
    </svg>
  );
}
