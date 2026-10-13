/**
 * Scene overlay on the viewer: zone outlines (targeted zones filled with the
 * accent, the hovered one lit, the Scene panel's focus zone emphasized),
 * paths as dashed centerlines with direction and labels, badges on targeted
 * areas, and the hover card (what the area is, its sun, plant feasibility
 * of the plants planned for it, and what a click will do).
 *
 * Drawn in screen space (CSS px) from the photo-px geometry so line widths
 * and labels stay crisp at any zoom.
 */
import { Check, Leaf, Pencil, Sun, CloudSun, Cloud } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ElementSpec, Photo, PlantFeasibility, Project, Pt, ScenePath, SceneZone, Space } from '../../../shared/types';
import { cn } from '../common';
import { RatingDot } from './Feasibility';
import { boundsOf, interiorPoint, placeLabel, pointAlong, polygonArea, toScreen, type SceneHit, type Size, type View } from './geometry';
import { chosenOptions, elementDimensions, elementFeasibilityContext, rateOptions } from './planRequest';
import { STUDIO_KNOWLEDGE } from './knowledge';
import { pathBandOutline } from './maskFromZones';

const SUN: Record<NonNullable<SceneZone['sun']>, { label: string; icon: ReactNode }> = {
  'full-sun': { label: 'Full sun', icon: <Sun className="size-3" /> },
  'part-sun': { label: 'Part sun', icon: <CloudSun className="size-3" /> },
  shade: { label: 'Shade', icon: <Cloud className="size-3" /> },
};

/** Ground zones where plant feasibility matters. */
const PLANTABLE = new Set<SceneZone['kind']>(['lawn', 'planting-bed', 'yard-border', 'tree', 'shrubs']);

const pointsAttr = (pts: readonly Pt[], view: View) =>
  pts.map((p) => `${(p.x * view.scale + view.tx).toFixed(1)},${(p.y * view.scale + view.ty).toFixed(1)}`).join(' ');

export interface OverlayProps {
  photo: Photo;
  view: View;
  stage: Size;
  showZones: boolean;
  hover: SceneHit | null;
  targetZones: ReadonlySet<string>;
  targetPaths: ReadonlySet<string>;
  focusZoneId: string | null;
  editingPathId: string | null;
  /** A run is rendering from this image: targeted outlines breathe. */
  rendering: boolean;
  onEditPath: (pathId: string) => void;
}

export function ZoneOverlay({
  photo,
  view,
  stage,
  showZones,
  hover,
  targetZones,
  targetPaths,
  focusZoneId,
  editingPathId,
  rendering,
  onEditPath,
}: OverlayProps) {
  const scene = photo.scene;
  const zones = useMemo(() => [...(scene?.zones ?? [])].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon)), [scene?.zones]);
  if (!scene) return null;
  const hoverZone = hover?.kind === 'zone' ? hover.id : null;
  const hoverPath = hover?.kind === 'path' ? hover.id : null;

  // Context zones (sky, street, neighbors) stay quiet unless they matter right now.
  const visibleZones = zones.filter(
    (z) => z.polygon.length >= 3 && ((showZones && (z.editable || z.id === hoverZone || targetZones.has(z.id))) || z.id === focusZoneId),
  );
  const visiblePaths = scene.paths.filter((p) => p.points.length >= 2 && (showZones || p.id === editingPathId));

  const badges = visibleZones
    .filter((z) => targetZones.has(z.id) && z.id !== hoverZone)
    .map((z) => {
      const c = interiorPoint(z.polygon);
      return { z, s: toScreen(view, c.x, c.y) };
    })
    .filter(({ s }) => s.x >= 0 && s.y >= 0 && s.x <= stage.width && s.y <= stage.height);

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={stage.width} height={stage.height} aria-hidden>
        <defs>
          <marker id="studio-path-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="white" />
          </marker>
        </defs>
        {visibleZones.map((z) => {
          const targeted = targetZones.has(z.id);
          const hovered = z.id === hoverZone;
          const focused = z.id === focusZoneId;
          const pts = pointsAttr(z.polygon, view);
          return (
            <g key={z.id} className={cn(targeted && rendering && 'animate-pulse')}>
              <polygon points={pts} fill="none" stroke="rgb(0 0 0 / 0.35)" strokeWidth={targeted || hovered || focused ? 4 : 2.5} strokeLinejoin="round" />
              <polygon
                points={pts}
                fill={targeted ? 'var(--accent)' : hovered ? 'white' : 'transparent'}
                fillOpacity={targeted ? (hovered ? 0.32 : 0.22) : hovered ? 0.14 : 0}
                stroke={focused ? 'var(--gold)' : targeted ? 'var(--accent)' : 'white'}
                strokeOpacity={targeted || hovered || focused ? 1 : z.editable ? 0.55 : 0.3}
                strokeWidth={focused ? 2.5 : targeted || hovered ? 2 : 1.25}
                strokeDasharray={focused ? '7 5' : z.editable ? undefined : '4 4'}
                strokeLinejoin="round"
              />
            </g>
          );
        })}
        {visiblePaths.map((p) => (
          <PathLine
            key={p.id}
            path={p}
            photoHeight={photo.height}
            view={view}
            targeted={targetPaths.has(p.id)}
            hovered={p.id === hoverPath}
            editing={p.id === editingPathId}
          />
        ))}
      </svg>

      {/* Targeted areas carry a small badge so the brief is visible on the photo. */}
      {showZones &&
        badges.map(({ z, s }) => {
          return (
            <div
              key={z.id}
              className="pointer-events-none absolute flex max-w-40 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-fg shadow"
              style={{ left: s.x, top: s.y }}
            >
              <Check className="size-3 shrink-0" />
              <span className="truncate">{z.label}</span>
            </div>
          );
        })}

      {showZones &&
        visiblePaths.map((p) => {
          const { p: mid } = pointAlong(p.points, 0.5);
          const s = toScreen(view, mid.x, mid.y);
          if (s.x < 0 || s.y < 0 || s.x > stage.width || s.y > stage.height) return null;
          // Step aside from an area badge sitting at the same spot.
          if (badges.some((b) => Math.abs(b.s.x - s.x) < 110 && Math.abs(b.s.y - (s.y + 18)) < 24)) s.y += 30;
          const targeted = targetPaths.has(p.id);
          return (
            <div
              key={p.id}
              className={cn(
                // The label lets clicks through to the photo; only its pencil is interactive.
                'pointer-events-none absolute flex -translate-x-1/2 translate-y-2 items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2 text-[11px] font-medium shadow backdrop-blur-sm',
                targeted ? 'bg-accent text-accent-fg' : 'bg-black/55 text-white',
              )}
              style={{ left: s.x, top: s.y }}
            >
              <span className="max-w-36 truncate">{p.label}</span>
              <button
                type="button"
                aria-label={`Adjust ${p.label}`}
                title="Adjust the route and width"
                className="pointer-events-auto ml-0.5 grid size-5 place-items-center rounded-full hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onEditPath(p.id)}
              >
                <Pencil className="size-3" />
              </button>
            </div>
          );
        })}
    </>
  );
}

function PathLine({
  path,
  photoHeight,
  view,
  targeted,
  hovered,
  editing,
}: {
  path: ScenePath;
  photoHeight: number;
  view: View;
  targeted: boolean;
  hovered: boolean;
  editing: boolean;
}) {
  const pts = pointsAttr(path.points, view);
  const color = targeted ? 'var(--accent)' : 'white';
  // The band a change along this path may touch (same perspective taper as the run's mask).
  const band = useMemo(() => (targeted || hovered || editing ? pathBandOutline(path, photoHeight) : []), [path, photoHeight, targeted, hovered, editing]);
  return (
    <g>
      {band.length > 2 && (
        <polygon
          points={pointsAttr(band, view)}
          fill={color}
          fillOpacity={editing ? 0.24 : 0.16}
          stroke={color}
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeLinejoin="round"
        />
      )}
      <polyline points={pts} fill="none" stroke="rgb(0 0 0 / 0.45)" strokeWidth={hovered || targeted ? 5 : 4} strokeLinecap="round" strokeLinejoin="round" />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={hovered || targeted ? 2.5 : 2}
        strokeDasharray={path.kind === 'suggested' ? '3 6' : '9 6'}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd="url(#studio-path-arrow)"
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Hover card
// ---------------------------------------------------------------------------

interface PlantCheck {
  element: string;
  option: string;
  feasibility: PlantFeasibility;
}

/** Plant options chosen for elements that use this zone, rated for the zone's own sun. */
function plantChecksFor(zone: SceneZone, photo: Photo, project: Project | null, setting: 'exterior' | 'interior'): PlantCheck[] {
  const brief = photo.draft;
  if (!brief || setting !== 'exterior') return [];
  const out: PlantCheck[] = [];
  const els: ElementSpec[] = brief.elements.filter((e) => e.zoneIds.includes(zone.id) || (brief.targetZoneIds.includes(zone.id) && e.zoneIds.length === 0));
  for (const el of els) {
    const ctx = elementFeasibilityContext({ ...el, zoneIds: [zone.id] }, photo.scene, project?.location, setting, STUDIO_KNOWLEDGE);
    const pairs = elementDimensions(el, STUDIO_KNOWLEDGE).flatMap((dimension) => chosenOptions(el, dimension).map((option) => ({ dimension, option })));
    for (const r of rateOptions(el, pairs, ctx, STUDIO_KNOWLEDGE)) out.push({ element: el.label, option: r.option.label, feasibility: r.feasibility });
  }
  return out.slice(0, 4);
}

export function SceneHoverCard({
  photo,
  space,
  project,
  hover,
  view,
  stage,
  pointer,
  targeted,
  activeElementLabel,
}: {
  photo: Photo;
  space: Space | undefined;
  project: Project | null;
  hover: SceneHit;
  view: View;
  stage: Size;
  pointer: Pt | null;
  targeted: boolean;
  activeElementLabel: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 260, height: 96 });
  const zone = hover.kind === 'zone' ? photo.scene?.zones.find((z) => z.id === hover.id) : undefined;
  const path = hover.kind === 'path' ? photo.scene?.paths.find((p) => p.id === hover.id) : undefined;
  const setting = space?.kind ?? 'exterior';
  const checks = useMemo(() => (zone && PLANTABLE.has(zone.kind) ? plantChecksFor(zone, photo, project, setting) : []), [zone, photo, project, setting]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize((s) => (Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1 ? s : { width: r.width, height: r.height }));
  });

  if (!zone && !path) return null;
  const pts = zone ? zone.polygon : (path?.points ?? []);
  const b = boundsOf(pts);
  const tl = toScreen(view, b.x, b.y);
  const pad = path ? (path.widthPx * view.scale) / 2 : 0;
  const target = { x: tl.x - pad, y: tl.y - pad, width: b.width * view.scale + pad * 2, height: b.height * view.scale + pad * 2 };
  const pos = placeLabel(target, size, stage, { focus: pointer ?? undefined });

  const zoneLabel = project?.location.climate?.hardinessZone ?? project?.location.hardinessZone;
  let action: string;
  if (zone) action = targeted ? 'In the brief — click to leave it as is' : 'Click to let this area change';
  else if (activeElementLabel) action = `Click to ${targeted ? 'remove from' : 'add to'} ${activeElementLabel}`;
  else action = targeted ? 'Click to open its Pathway' : 'Click to design this path';

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 w-64 rounded-xl bg-black/70 p-3 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{zone?.label ?? path?.label}</div>
          <div className="text-[11px] capitalize text-white/60">
            {zone ? zone.kind.replace(/-/g, ' ') : path?.kind === 'sketch' ? 'Sketched path' : path?.kind === 'suggested' ? 'Suggested path' : 'Path'}
            {path && (path.from || path.to) ? ` · ${path.from || '…'} → ${path.to || '…'}` : ''}
          </div>
        </div>
        {targeted && (
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg">
            <Check className="size-3" /> In brief
          </span>
        )}
      </div>
      {(zone?.description || path?.description) && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-white/80">{zone?.description || path?.description}</p>
      )}
      {zone && (zone.sun || (PLANTABLE.has(zone.kind) && zoneLabel)) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {zone.sun && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 text-[11px]">
              {SUN[zone.sun].icon}
              {SUN[zone.sun].label}
            </span>
          )}
          {PLANTABLE.has(zone.kind) && zoneLabel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 text-[11px]">
              <Leaf className="size-3" />
              Zone {zoneLabel}
            </span>
          )}
        </div>
      )}
      {checks.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2">
          {checks.map((c, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] leading-snug">
              <RatingDot rating={c.feasibility.rating} className="mt-1" />
              <span className="min-w-0">
                <span className="font-medium">{c.option}</span>
                <span className="text-white/60">
                  {' '}
                  · {c.feasibility.rating === 'good' ? 'thrives here' : (c.feasibility.reasons[0] ?? c.feasibility.rating)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      {zone && PLANTABLE.has(zone.kind) && !zoneLabel && setting === 'exterior' && (
        <p className="mt-2 text-[11px] text-white/55">Add your ZIP code in Settings so plant choices are checked for your climate.</p>
      )}
      <div className="mt-2 text-[11px] font-medium text-white/70">{action}</div>
    </div>
  );
}
