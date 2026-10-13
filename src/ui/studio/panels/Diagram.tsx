/**
 * Small schematic diagrams for element options ({ kind: 'diagram' } visuals):
 * plan views of path shapes and widths, sections of edges and borders, light
 * beams, layouts… Monochrome line drawings in the muted text color with
 * semantic accents (accent = the subject, gold = light, success = plants), so
 * they read in light and dark mode. Every id in DIAGRAM_IDS has a drawing;
 * unknown ids fall back to a neutral frame with the id's description as title.
 */
import type { ReactNode } from 'react';
import { DIAGRAM_IDS, isDiagramId } from '../../../assets/design';
import { cn } from '../../common';

// ---------------------------------------------------------------------------
// Palette (Tailwind classes on SVG elements)
// ---------------------------------------------------------------------------

const ACC = 'stroke-accent';
const ACC_FILL = 'fill-accent/25 stroke-accent';
const ACC_SOLID = 'fill-accent stroke-none';
const PAVE = 'fill-muted/20';
const SOFT = 'fill-muted/10';
const LAWN = 'fill-success/15 stroke-none';
const PLANT = 'fill-success/30 stroke-success';
const PLANT_DARK = 'fill-success/50 stroke-success';
const LIGHT = 'fill-gold/35 stroke-none';
const LIGHT_SOFT = 'fill-gold/20 stroke-none';
const BULB = 'fill-gold stroke-none';

// ---------------------------------------------------------------------------
// Building blocks (48×48 canvas)
// ---------------------------------------------------------------------------

const GROUND_Y = 42;

function Ground({ y = GROUND_Y, x1 = 3, x2 = 45 }: { y?: number; x1?: number; x2?: number }) {
  return <line x1={x1} x2={x2} y1={y} y2={y} />;
}

/** Grass ticks along a line (section / elevation). */
function Grass({ x1, x2, y = GROUND_Y }: { x1: number; x2: number; y?: number }) {
  const ticks: ReactNode[] = [];
  for (let x = x1; x <= x2; x += 2.6) ticks.push(<path key={x} d={`M${x.toFixed(1)} ${y} l0.8 -2.4`} className="stroke-success" strokeWidth={1} />);
  return <>{ticks}</>;
}

/** House strip at the top of a plan view, with the front door. */
function HousePlan({ door = 24 }: { door?: number }) {
  return (
    <>
      <rect x={3} y={3} width={42} height={8} className={SOFT} />
      <rect x={door - 3.5} y={9.5} width={7} height={2.2} rx={0.6} className={ACC_SOLID} />
    </>
  );
}

function Person({ x, base = GROUND_Y, h = 17 }: { x: number; base?: number; h?: number }) {
  const r = h * 0.1;
  const neck = base - h + 2 * r;
  const hip = base - h * 0.45;
  return (
    <g strokeWidth={1.2}>
      <circle cx={x} cy={base - h + r} r={r} />
      <path d={`M${x} ${neck} V${hip} M${x} ${hip} L${x - h * 0.12} ${base} M${x} ${hip} L${x + h * 0.12} ${base} M${x - h * 0.16} ${neck + h * 0.12} L${x} ${neck + h * 0.05} L${x + h * 0.16} ${neck + h * 0.12}`} />
    </g>
  );
}

/** Dimension line with end ticks and a label. */
function Dim({ x1, x2, y, label, below = true }: { x1: number; x2: number; y: number; label: string; below?: boolean }) {
  return (
    <g className={ACC} strokeWidth={1}>
      <path d={`M${x1} ${y} H${x2} M${x1} ${y - 2} v4 M${x2} ${y - 2} v4`} />
      <text x={(x1 + x2) / 2} y={below ? y + 6.5 : y - 2.5} textAnchor="middle" fontSize={6} className="fill-accent stroke-none font-sans">
        {label}
      </text>
    </g>
  );
}

function VDim({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) {
  return (
    <g className={ACC} strokeWidth={1}>
      <path d={`M${x} ${y1} V${y2} M${x - 2} ${y1} h4 M${x - 2} ${y2} h4`} />
      <text x={x + 2.5} y={(y1 + y2) / 2 + 2} fontSize={6} className="fill-accent stroke-none font-sans">
        {label}
      </text>
    </g>
  );
}

function Shrub({ cx, cy, r, dark }: { cx: number; cy: number; r: number; dark?: boolean }) {
  return <circle cx={cx} cy={cy} r={r} className={dark ? PLANT_DARK : PLANT} strokeWidth={1} />;
}

/** Deciduous tree in elevation. */
function Tree({ x, base = GROUND_Y, h = 26, r = 8 }: { x: number; base?: number; h?: number; r?: number }) {
  return (
    <>
      <path d={`M${x} ${base} V${base - h + r}`} strokeWidth={1.6} />
      <circle cx={x} cy={base - h + r} r={r} className={PLANT} strokeWidth={1} />
    </>
  );
}

function Evergreen({ x, base = GROUND_Y, h = 16, w = 8 }: { x: number; base?: number; h?: number; w?: number }) {
  return <path d={`M${x} ${base - h} L${x + w / 2} ${base} H${x - w / 2} Z`} className={PLANT_DARK} strokeWidth={1} />;
}

/** Simple house block in elevation (body + roof). */
function HouseElevation({ x = 8, w = 32, base = GROUND_Y, h = 16 }: { x?: number; w?: number; base?: number; h?: number }) {
  return (
    <>
      <rect x={x} y={base - h} width={w} height={h} className={SOFT} />
      <path d={`M${x - 2} ${base - h} L${x + w / 2} ${base - h - 9} L${x + w + 2} ${base - h}`} />
      <rect x={x + w / 2 - 2.5} y={base - 8} width={5} height={8} className={ACC_SOLID} />
    </>
  );
}

/** Light cone polygon from an apex to a span. */
function Cone({ apex, left, right, soft }: { apex: [number, number]; left: [number, number]; right: [number, number]; soft?: boolean }) {
  return <path d={`M${apex[0]} ${apex[1]} L${left[0]} ${left[1]} L${right[0]} ${right[1]} Z`} className={soft ? LIGHT_SOFT : LIGHT} />;
}

/** A window opening in elevation. */
function Window({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} className={SOFT} />
      <path d={`M${x + w / 2} ${y} V${y + h} M${x} ${y + h / 2} H${x + w}`} strokeWidth={0.8} />
    </>
  );
}

function Label({ x, y, children, anchor = 'middle' }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} fontSize={6} textAnchor={anchor} className="fill-current stroke-none font-sans">
      {children}
    </text>
  );
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

const pathBand = (d: string, width = 8) => (
  <>
    <path d={d} className="stroke-muted/30" strokeWidth={width + 1.6} strokeLinecap="butt" />
    <path d={d} className="stroke-accent/45" strokeWidth={width} strokeLinecap="butt" />
  </>
);

function pathWidth(widthPx: number, label: string, people: number, flare = false): ReactNode {
  const x1 = 24 - widthPx / 2;
  const x2 = 24 + widthPx / 2;
  return (
    <>
      <HousePlan />
      <path
        d={flare ? `M${x1} 38 V18 L${x1 - 4} 12 H${x2 + 4} L${x2} 18 V38 Z` : `M${x1} 38 V12 H${x2} V38 Z`}
        className="fill-accent/25 stroke-accent"
      />
      {Array.from({ length: people }, (_, i) => {
        const cx = people === 1 ? 24 : 24 + (i - (people - 1) / 2) * (widthPx / people);
        return <circle key={i} cx={cx} cy={26} r={2.4} className="fill-muted/40" strokeWidth={1} />;
      })}
      <Dim x1={x1} x2={x2} y={40} label={label} />
    </>
  );
}

function edgeSection(edge: ReactNode): ReactNode {
  return (
    <>
      <rect x={3} y={30} width={20} height={14} className={LAWN} />
      <Grass x1={4} x2={21} y={30} />
      <rect x={25} y={30} width={20} height={14} className={PAVE} />
      <path d="M3 30 H23 M25 30 H45" />
      {edge}
    </>
  );
}

function bedLine(line: string, fill: string): ReactNode {
  return (
    <>
      <HousePlan />
      <path d={fill} className="fill-success/25 stroke-none" />
      <rect x={3} y={11} width={42} height={34} className="fill-success/10 stroke-none" />
      <path d={line} className={ACC} strokeWidth={1.8} />
      <Shrub cx={10} cy={15} r={2.5} />
      <Shrub cx={38} cy={15} r={2.5} />
    </>
  );
}

function profileSection(border: ReactNode): ReactNode {
  return (
    <>
      <rect x={3} y={32} width={20} height={12} className={LAWN} />
      <Grass x1={4} x2={20} y={32} />
      <path d="M3 32 H22" />
      {border}
    </>
  );
}

function fixturePost(x: number, h: number) {
  return (
    <>
      <path d={`M${x} ${GROUND_Y} V${GROUND_Y - h}`} strokeWidth={1.4} />
      <path d={`M${x - 2.2} ${GROUND_Y - h} H${x + 2.2} L${x + 1.4} ${GROUND_Y - h - 2} H${x - 1.4} Z`} className={ACC_SOLID} />
    </>
  );
}

function patioPlan(w: number, h: number, seats: number, label: string): ReactNode {
  const x = 24 - w / 2;
  const y = 25 - h / 2;
  const r = 4.2;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} className="fill-accent/20 stroke-accent" />
      <circle cx={24} cy={25} r={r} className={SOFT} />
      {Array.from({ length: seats }, (_, i) => {
        const a = (i / seats) * Math.PI * 2;
        return <rect key={i} x={24 + Math.cos(a) * (r + 3) - 1.5} y={25 + Math.sin(a) * (r + 3) - 1.5} width={3} height={3} rx={0.8} className="fill-muted/40" strokeWidth={0.8} />;
      })}
      <Label x={24} y={46}>{label}</Label>
    </>
  );
}

function drivePlan(extra: ReactNode, band: ReactNode = <rect x={15} y={11} width={18} height={31} className={PAVE} />): ReactNode {
  return (
    <>
      <rect x={3} y={3} width={42} height={8} className={SOFT} />
      <rect x={14} y={5} width={20} height={6} className={ACC_FILL} />
      {band}
      <rect x={3} y={42} width={42} height={4} className="fill-muted/30 stroke-none" />
      {extra}
    </>
  );
}

function car(x: number, y: number) {
  return <rect x={x} y={y} width={6} height={10} rx={1.6} className="fill-muted/45" strokeWidth={0.9} />;
}

function fenceElevation(body: ReactNode, person = false): ReactNode {
  return (
    <>
      <Ground />
      {body}
      {person && <Person x={40} />}
    </>
  );
}

function pickets(x1: number, x2: number, top: number, spacing: number, width: number, pointed: boolean, cls = SOFT) {
  const out: ReactNode[] = [];
  for (let x = x1; x + width <= x2; x += spacing) {
    out.push(
      pointed ? (
        <path key={x} d={`M${x} ${GROUND_Y} V${top + 1.6} L${x + width / 2} ${top} L${x + width} ${top + 1.6} V${GROUND_Y} Z`} className={cls} strokeWidth={0.9} />
      ) : (
        <rect key={x} x={x} y={top} width={width} height={GROUND_Y - top} className={cls} strokeWidth={0.9} />
      ),
    );
  }
  return out;
}

function fenceHeight(heightPx: number, label: string): ReactNode {
  return (
    <>
      <Ground />
      <rect x={5} y={GROUND_Y - heightPx} width={22} height={heightPx} className={ACC_FILL} />
      {pickets(6, 27, GROUND_Y - heightPx, 3.5, 2, false, 'fill-none stroke-accent/50')}
      <Person x={36} h={30} />
      <Label x={16} y={GROUND_Y - heightPx - 2}>{label}</Label>
    </>
  );
}

function doorFrame(inner: ReactNode, arched = false): ReactNode {
  return (
    <>
      <Ground y={45} />
      {arched ? (
        <path d="M15 45 V16 A9 9 0 0 1 33 16 V45 Z" className={ACC_FILL} />
      ) : (
        <rect x={15} y={7} width={18} height={38} className={ACC_FILL} />
      )}
      {inner}
      <circle cx={30} cy={28} r={0.9} className={ACC_SOLID} />
    </>
  );
}

function surround(inner: ReactNode): ReactNode {
  return (
    <>
      <Ground y={45} />
      <rect x={18} y={14} width={12} height={31} className={ACC_FILL} />
      {inner}
    </>
  );
}

function column(body: ReactNode): ReactNode {
  return (
    <>
      <Ground y={45} />
      <rect x={6} y={3} width={36} height={4} className={SOFT} />
      {body}
    </>
  );
}

function garage(body: ReactNode): ReactNode {
  return (
    <>
      <Ground y={44} />
      <path d="M4 44 V12 H44 V44" className={SOFT} />
      <rect x={8} y={16} width={32} height={28} className={ACC_FILL} />
      {body}
    </>
  );
}

function shutterWindow(shutter: (x: number) => ReactNode): ReactNode {
  return (
    <>
      <Window x={17} y={10} w={14} h={26} />
      {shutter(9)}
      {shutter(32)}
    </>
  );
}

function sheen(highlight: ReactNode): ReactNode {
  return (
    <>
      <rect x={6} y={6} width={36} height={36} rx={3} className="fill-accent/30 stroke-accent/60" />
      {highlight}
    </>
  );
}

/** Room wall elevation: wall, baseboard, ceiling line. */
function roomWall(fill: ReactNode): ReactNode {
  return (
    <>
      <rect x={4} y={6} width={40} height={36} className={SOFT} />
      {fill}
      <path d="M4 38 H44" strokeWidth={1.2} />
      <rect x={30} y={18} width={9} height={20} strokeWidth={1} />
    </>
  );
}

function ceilingSection(body: ReactNode): ReactNode {
  return (
    <>
      <path d="M4 44 V12 M44 44 V12" />
      <Ground y={44} x1={4} x2={44} />
      {body}
    </>
  );
}

function cabDoor(inner: ReactNode): ReactNode {
  return (
    <>
      <rect x={13} y={6} width={22} height={36} rx={0.6} className={ACC_FILL} />
      {inner}
      <path d="M31 22 V28" strokeWidth={1.6} />
    </>
  );
}

function kitchen(upper: string, lower: string, island: string | null, shelves = false): ReactNode {
  return (
    <>
      <Ground y={44} />
      {shelves ? (
        <path d="M5 12 H25 M5 19 H25" strokeWidth={1.6} />
      ) : (
        <rect x={5} y={7} width={22} height={13} className={upper} />
      )}
      <rect x={5} y={28} width={22} height={16} className={lower} />
      <path d="M4 28 H28" strokeWidth={1.4} />
      {island && <rect x={31} y={30} width={13} height={14} className={island} />}
    </>
  );
}

function roomPlan(body: ReactNode, focal?: 'fireplace' | 'tv'): ReactNode {
  return (
    <>
      <rect x={3} y={3} width={42} height={42} className="fill-none stroke-muted/60" />
      {focal && <rect x={18} y={3} width={12} height={3} className={ACC_SOLID} />}
      {body}
    </>
  );
}

const sofa = (x: number, y: number, w: number, h: number, rot = 0) => (
  <rect x={x} y={y} width={w} height={h} rx={1.4} className="fill-accent/30 stroke-accent" strokeWidth={1} transform={rot ? `rotate(${rot} ${x + w / 2} ${y + h / 2})` : undefined} />
);
const chair = (x: number, y: number) => <rect x={x} y={y} width={6} height={6} rx={1.2} className="fill-accent/30 stroke-accent" strokeWidth={1} />;
const table = (x: number, y: number, w: number, h: number) => <rect x={x} y={y} width={w} height={h} rx={0.8} className="fill-muted/30" strokeWidth={1} />;

function windowTreatment(body: ReactNode): ReactNode {
  return (
    <>
      <Ground y={45} />
      <Window x={16} y={12} w={16} h={22} />
      {body}
    </>
  );
}

function fireplace(body: ReactNode): ReactNode {
  return (
    <>
      <Ground y={45} />
      {body}
      <path d="M19 45 V36 A5 5 0 0 1 29 36 V45 Z" className="fill-muted/40" />
      <path d="M22 44 Q24 38 26 44" className="fill-gold/60 stroke-none" />
    </>
  );
}

function beforeAfter(changes: ReactNode): ReactNode {
  return (
    <>
      <rect x={3} y={12} width={19} height={24} rx={1.5} className={SOFT} />
      <path d="M6 31 L11 23 L15 28 L18 25 L20 31 Z" className="fill-muted/30" strokeWidth={0.8} />
      <path d="M23.5 24 h1.5 m-1 -1.5 l1.5 1.5 l-1.5 1.5" className={ACC} strokeWidth={1} />
      <rect x={26} y={12} width={19} height={24} rx={1.5} className={SOFT} />
      <path d="M29 31 L34 23 L38 28 L41 25 L43 31 Z" className="fill-muted/30" strokeWidth={0.8} />
      {changes}
    </>
  );
}

// ---------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------

const DRAWINGS: Record<string, () => ReactNode> = {
  // generic
  none: () => (
    <>
      <rect x={8} y={8} width={32} height={32} rx={3} strokeDasharray="3 2.5" />
      <path d="M12 36 L36 12" />
    </>
  ),
  'keep-existing': () => (
    <>
      <path d="M8 40 V22 L24 10 L40 22 V40 Z" className={SOFT} />
      <circle cx={33} cy={33} r={7} className="fill-success/25 stroke-success" />
      <path d="M29.8 33 l2.3 2.4 l4.2 -4.6" className="stroke-success" strokeWidth={1.6} />
    </>
  ),

  // path shapes (plan)
  'path-straight': () => (
    <>
      <HousePlan />
      {pathBand('M24 46 V12')}
    </>
  ),
  'path-curved': () => (
    <>
      <HousePlan />
      {pathBand('M32 46 C 12 38, 34 22, 24 12')}
    </>
  ),
  'path-meander': () => (
    <>
      <HousePlan />
      <Shrub cx={9} cy={22} r={4} />
      <Shrub cx={39} cy={34} r={4.5} />
      <Shrub cx={37} cy={18} r={3} />
      <Shrub cx={11} cy={40} r={3} />
      {pathBand('M18 46 C 38 40, 8 32, 26 25 S 20 15, 24 12', 7)}
    </>
  ),
  'path-angled': () => (
    <>
      <HousePlan />
      <path d="M14 46 V33 H33 V21 H24 V12" className="stroke-muted/30" strokeWidth={8.6} strokeLinejoin="miter" strokeLinecap="butt" />
      <path d="M14 46 V33 H33 V21 H24 V12" className="stroke-accent/45" strokeWidth={7} strokeLinejoin="miter" strokeLinecap="butt" />
    </>
  ),
  'path-stepping-stones': () => (
    <>
      <HousePlan />
      <rect x={3} y={12} width={42} height={34} className={LAWN} />
      {[42, 35, 28, 21, 15].map((y, i) => (
        <rect key={y} x={(i % 2 ? 22 : 20.5) - 1} y={y - 2.4} width={8} height={4.6} rx={1.8} className="fill-accent/35 stroke-accent" strokeWidth={1} />
      ))}
    </>
  ),

  // path widths (plan)
  'width-3ft': () => pathWidth(9, '3 ft', 1),
  'width-4ft': () => pathWidth(13, '4 ft', 1),
  'width-5ft': () => pathWidth(17, '5 ft', 2),
  'width-6ft': () => pathWidth(21, '6 ft', 2, true),

  // edges
  'edge-none': () => edgeSection(null),
  'edge-steel': () => edgeSection(<rect x={23} y={27} width={2} height={11} className="fill-text stroke-none" />),
  'edge-brick': () =>
    edgeSection(
      <>
        <rect x={21.5} y={27.5} width={5} height={10} className="fill-danger/40 stroke-danger" strokeWidth={0.9} />
      </>,
    ),
  'edge-cobble': () => (
    <>
      <rect x={3} y={3} width={16} height={42} className={LAWN} />
      <rect x={29} y={3} width={16} height={42} className={PAVE} />
      {Array.from({ length: 7 }, (_, i) => (
        <g key={i}>
          <rect x={19.5} y={4 + i * 6} width={4.2} height={4.2} rx={0.6} className="fill-accent/35 stroke-accent" strokeWidth={0.8} />
          <rect x={24.3} y={7 + i * 6 - 3} width={4.2} height={4.2} rx={0.6} className="fill-accent/35 stroke-accent" strokeWidth={0.8} />
        </g>
      ))}
    </>
  ),
  'edge-stone': () => (
    <>
      <rect x={3} y={3} width={18} height={42} className={LAWN} />
      <rect x={28} y={3} width={17} height={42} className={PAVE} />
      {['M20 4 l6 1 l1 6 l-6 1 z', 'M21 13 l6 -1 l1 7 l-7 1 z', 'M20 22 l7 0 l0 6 l-6 2 z', 'M21 31 l6 -1 l1 7 l-6 0 z', 'M20 39 l7 0 l0 6 l-7 0 z'].map((d) => (
        <path key={d} d={d} className="fill-accent/35 stroke-accent" strokeWidth={0.9} />
      ))}
    </>
  ),
  'edge-spade': () => (
    <>
      <rect x={3} y={30} width={20} height={14} className={LAWN} />
      <Grass x1={4} x2={18} y={30} />
      <path d="M3 30 H19 L23 38 L27 33 H45" className={ACC} strokeWidth={1.6} />
      <path d="M27 33 H45 V44 H27 Z" className="fill-muted/30 stroke-none" />
      <Label x={36} y={28}>mulch</Label>
    </>
  ),
  'edge-hedge': () => (
    <>
      <Ground />
      <path d="M5 42 V34 Q5 30 9 30 H39 Q43 30 43 34 V42 Z" className={PLANT_DARK} strokeWidth={1} />
      <rect x={3} y={42} width={42} height={3} className={PAVE} />
    </>
  ),
  'edge-plants': () => (
    <>
      <rect x={26} y={40} width={19} height={5} className={PAVE} />
      <Ground x2={26} />
      {[8, 15, 22, 28].map((x, i) => (
        <circle key={x} cx={x} cy={37 - (i % 2)} r={5} className={PLANT} strokeWidth={1} />
      ))}
      {[7, 13, 18, 24, 29].map((x) => (
        <circle key={x} cx={x} cy={33 + (x % 3)} r={1} className="fill-accent stroke-none" />
      ))}
    </>
  ),

  // border lines (plan)
  'line-straight': () => bedLine('M3 24 H45', 'M3 11 H45 V24 H3 Z'),
  'line-curve': () => bedLine('M3 20 C 16 36, 32 36, 45 20', 'M3 11 H45 V20 C 32 36, 16 36, 3 20 Z'),
  'line-geometric': () => bedLine('M3 20 H16 V28 H32 V20 H45', 'M3 11 H45 V20 H32 V28 H16 V20 H3 Z'),

  // border profiles (section)
  'profile-flush': () =>
    profileSection(
      <>
        <rect x={22} y={32} width={8} height={5} className={ACC_FILL} />
        <rect x={30} y={30} width={15} height={14} className="fill-muted/30 stroke-none" />
        <circle cx={26} cy={29} r={2.6} strokeWidth={1} />
        <Label x={37} y={27}>bed</Label>
      </>,
    ),
  'profile-raised': () =>
    profileSection(
      <>
        <rect x={22} y={26} width={6} height={11} className={ACC_FILL} />
        <rect x={28} y={26} width={17} height={18} className="fill-muted/30 stroke-none" />
        <VDim x={19} y1={26} y2={32} label="" />
      </>,
    ),
  'profile-low-wall': () =>
    profileSection(
      <>
        <rect x={22} y={18} width={8} height={20} className={ACC_FILL} />
        <path d="M22 22 H30 M22 27 H30 M22 32 H30 M26 18 V22 M24 22 V27 M28 27 V32" strokeWidth={0.8} className={ACC} />
        <rect x={30} y={18} width={15} height={26} className="fill-muted/30 stroke-none" />
        <Shrub cx={37} cy={14} r={4} />
      </>,
    ),

  // lighting
  'beam-path': () => (
    <>
      <Ground />
      {[10, 24, 38].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={GROUND_Y} rx={6} ry={1.8} className={LIGHT} />
          <Cone apex={[x, 34]} left={[x - 5, GROUND_Y]} right={[x + 5, GROUND_Y]} soft />
          {fixturePost(x, 8)}
        </g>
      ))}
    </>
  ),
  'beam-bollard': () => (
    <>
      <Ground />
      {[13, 35].map((x) => (
        <g key={x}>
          <Cone apex={[x, 26]} left={[x - 10, GROUND_Y]} right={[x + 10, GROUND_Y]} soft />
          <rect x={x - 2} y={24} width={4} height={18} rx={1} className="fill-muted/40" strokeWidth={1} />
          <rect x={x - 2} y={25.5} width={4} height={2.5} className={BULB} />
        </g>
      ))}
    </>
  ),
  'beam-inground': () => (
    <>
      <Ground y={36} />
      <rect x={3} y={36} width={42} height={8} className={PAVE} />
      {[12, 24, 36].map((x) => (
        <g key={x}>
          <Cone apex={[x, 36]} left={[x - 4, 20]} right={[x + 4, 20]} soft />
          <rect x={x - 2} y={35} width={4} height={2} className={BULB} />
        </g>
      ))}
    </>
  ),
  'beam-moonlight': () => (
    <>
      <Ground />
      <path d="M24 42 V18" strokeWidth={2} />
      <path d="M24 26 L16 18 M24 22 L32 15" strokeWidth={1.2} />
      <ellipse cx={24} cy={12} rx={17} ry={8} className="fill-success/20 stroke-success" strokeWidth={1} />
      <Cone apex={[26, 14]} left={[14, GROUND_Y]} right={[38, GROUND_Y]} soft />
      {[16, 22, 29, 35].map((x, i) => (
        <ellipse key={x} cx={x} cy={GROUND_Y - 0.5} rx={2.2 + (i % 2)} ry={0.9} className={LIGHT} />
      ))}
      <circle cx={26} cy={14} r={1.3} className={BULB} />
    </>
  ),
  'beam-up': () => (
    <>
      <Ground />
      <path d="M26 42 V20" strokeWidth={2} />
      <circle cx={26} cy={14} r={11} className="fill-success/20 stroke-success" strokeWidth={1} />
      <Cone apex={[19, 41]} left={[16, 6]} right={[34, 10]} />
      <rect x={17} y={39.5} width={4} height={2.5} rx={0.6} className={ACC_SOLID} />
    </>
  ),
  'beam-down': () => (
    <>
      <rect x={4} y={4} width={9} height={38} className={SOFT} />
      <Ground />
      <Cone apex={[17, 17]} left={[13, GROUND_Y]} right={[38, GROUND_Y]} />
      <path d="M13 13 H15" strokeWidth={1.2} />
      <rect x={15} y={10} width={5} height={7} rx={1} className={ACC_SOLID} />
      <path d="M15 10 L17.5 7 L20 10" className={ACC} />
    </>
  ),
  'beam-wash': () => (
    <>
      <rect x={6} y={6} width={36} height={36} className={SOFT} />
      <Ground />
      <path d="M6 42 L4 6 H44 L42 42 Z" className={LIGHT_SOFT} />
      <path d="M10 42 L12 14 H36 L38 42 Z" className={LIGHT} />
      {[12, 24, 36].map((x) => (
        <rect key={x} x={x - 2} y={40} width={4} height={2} className={BULB} />
      ))}
    </>
  ),
  'beam-step': () => (
    <>
      <path d="M4 44 V38 H14 V32 H24 V26 H34 V20 H44" className={SOFT} />
      {[
        [14, 38],
        [24, 32],
        [34, 26],
      ].map(([x, y]) => (
        <g key={x}>
          <Cone apex={[x, y - 2]} left={[x - 9, y]} right={[x - 1, y]} soft />
          <rect x={x - 1} y={y - 3} width={1.6} height={2} className={BULB} />
        </g>
      ))}
    </>
  ),
  'beam-string': () => (
    <>
      <path d="M4 10 V44 M44 10 V44" strokeWidth={1.6} />
      <path d="M4 12 Q24 28 44 12" />
      {[8, 14, 20, 26, 32, 38].map((x) => {
        const t = (x - 4) / 40;
        const y = 12 + 32 * t * (1 - t) + 2.5;
        return (
          <g key={x}>
            <circle cx={x} cy={y} r={3.4} className={LIGHT_SOFT} />
            <circle cx={x} cy={y} r={1.3} className={BULB} />
          </g>
        );
      })}
      <Ground y={44} />
    </>
  ),
  'beam-pendant': () => (
    <>
      <path d="M24 3 V14" />
      <path d="M17 19 Q24 9 31 19 Z" className={ACC_FILL} />
      <Cone apex={[24, 19]} left={[11, 33]} right={[37, 33]} />
      <rect x={9} y={33} width={30} height={2.4} className="fill-muted/40" />
      <path d="M12 35.4 V44 M36 35.4 V44" />
    </>
  ),
  'beam-sconce': () => (
    <>
      <rect x={4} y={4} width={40} height={40} className={SOFT} />
      <Cone apex={[24, 22]} left={[14, 4]} right={[34, 4]} soft />
      <Cone apex={[24, 26]} left={[15, 44]} right={[33, 44]} soft />
      <rect x={21} y={20} width={6} height={8} rx={1.2} className={ACC_SOLID} />
    </>
  ),
  'beam-strip': () => (
    <>
      <rect x={4} y={6} width={34} height={14} className={SOFT} />
      <path d="M4 34 H40" strokeWidth={1.8} />
      <rect x={4} y={34} width={34} height={10} className={SOFT} />
      <rect x={6} y={19.5} width={30} height={1.2} className={BULB} />
      <path d="M6 20.5 L4 34 H38 L36 20.5 Z" className={LIGHT} />
    </>
  ),
  'beam-lamp': () => (
    <>
      <Ground y={44} />
      <circle cx={24} cy={16} r={12} className={LIGHT_SOFT} />
      <path d="M18 20 L20 11 H28 L30 20 Z" className={ACC_FILL} />
      <path d="M24 20 V43 M19 44 H29" strokeWidth={1.6} />
    </>
  ),
  'beam-cove': () => (
    <>
      <path d="M4 8 H44" strokeWidth={1.4} />
      <path d="M4 14 H12 V17 M44 14 H36 V17" strokeWidth={1.4} />
      <path d="M4 8 H44 V10 Q24 18 4 10 Z" className={LIGHT} />
      <rect x={5} y={12.6} width={6} height={1.2} className={BULB} />
      <rect x={37} y={12.6} width={6} height={1.2} className={BULB} />
      <path d="M4 14 V44 M44 14 V44" />
      <Ground y={44} x1={4} x2={44} />
    </>
  ),

  // planting beds
  'bed-tiered': () => (
    <>
      <rect x={3} y={6} width={6} height={36} className={SOFT} />
      <Ground x1={9} />
      <Evergreen x={15} h={24} w={10} />
      <Shrub cx={26} cy={35} r={6} />
      <Shrub cx={37} cy={38.5} r={3.5} />
      <Shrub cx={43} cy={39.5} r={2.5} />
    </>
  ),
  'bed-drifts': () => (
    <>
      <rect x={3} y={3} width={42} height={42} rx={4} className="fill-muted/15 stroke-none" />
      {[
        [9, 10],
        [14, 9],
        [11, 15],
      ].map(([x, y]) => <Shrub key={`${x}${y}`} cx={x} cy={y} r={3} dark />)}
      {[
        [26, 10],
        [31, 12],
        [36, 9],
        [29, 17],
        [35, 16],
      ].map(([x, y]) => <Shrub key={`${x}${y}`} cx={x} cy={y} r={2.6} />)}
      {[
        [10, 30],
        [15, 27],
        [20, 31],
        [13, 36],
        [19, 37],
        [25, 34],
        [8, 40],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r={2.4} className="fill-accent/35 stroke-accent" strokeWidth={0.9} />
      ))}
      <Shrub cx={36} cy={34} r={6} />
    </>
  ),
  'bed-formal': () => (
    <>
      <HousePlan />
      <path d="M24 12 V46" className="stroke-muted/40" strokeWidth={6} />
      {[15, 25, 35].map((y) => (
        <g key={y}>
          <Shrub cx={13} cy={y} r={3.2} dark />
          <Shrub cx={35} cy={y} r={3.2} dark />
        </g>
      ))}
      <rect x={5} y={13} width={2} height={30} className="fill-success/40 stroke-none" />
      <rect x={41} y={13} width={2} height={30} className="fill-success/40 stroke-none" />
    </>
  ),
  'bed-naturalistic': () => (
    <>
      <Ground />
      {[6, 10, 15, 20, 26, 31, 37, 42].map((x, i) => (
        <path key={x} d={`M${x} 42 Q${x - 2} ${32 - (i % 3) * 3} ${x - 3} ${24 - (i % 2) * 4} M${x} 42 Q${x + 2} ${30} ${x + 3} ${26 - (i % 3) * 2}`} className="stroke-success" strokeWidth={1} />
      ))}
      {[8, 13, 18, 23, 29, 34, 40].map((x, i) => (
        <circle key={x} cx={x} cy={22 + (i % 3) * 5} r={1.6} className={i % 2 ? 'fill-accent stroke-none' : 'fill-gold stroke-none'} />
      ))}
    </>
  ),
  'depth-3ft': () => (
    <>
      <rect x={3} y={8} width={6} height={34} className={SOFT} />
      <Ground />
      <rect x={9} y={40} width={12} height={2} className="fill-muted/30 stroke-none" />
      <Shrub cx={15} cy={35} r={5} />
      <Grass x1={23} x2={44} />
      <Dim x1={9} x2={21} y={46} label="" />
      <Label x={33} y={20}>3 ft</Label>
    </>
  ),
  'depth-5ft': () => (
    <>
      <rect x={3} y={8} width={6} height={34} className={SOFT} />
      <Ground />
      <Shrub cx={14} cy={33} r={5.5} dark />
      <Shrub cx={24} cy={37.5} r={3.5} />
      <Grass x1={30} x2={44} />
      <Dim x1={9} x2={29} y={46} label="" />
      <Label x={37} y={20}>5 ft</Label>
    </>
  ),
  'depth-8ft': () => (
    <>
      <rect x={3} y={8} width={5} height={34} className={SOFT} />
      <Ground />
      <Tree x={14} h={30} r={6} />
      <Shrub cx={24} cy={36} r={4.5} dark />
      <Shrub cx={33} cy={38.5} r={3} />
      <Grass x1={38} x2={45} />
      <Dim x1={8} x2={38} y={46} label="" />
      <Label x={36} y={14}>8 ft</Label>
    </>
  ),

  // lawn (plan)
  'lawn-panel': () => (
    <>
      <HousePlan />
      <rect x={3} y={12} width={42} height={33} className="fill-success/30 stroke-none" />
      <rect x={11} y={18} width={26} height={20} rx={1} className="fill-success/10 stroke-accent" strokeWidth={1.4} />
      <path d="M24 12 V46" className="stroke-muted/40" strokeWidth={4} />
    </>
  ),
  'lawn-shape-free': () => (
    <>
      <HousePlan />
      <path d="M3 13 H45 V45 H3 Z" className="fill-success/20 stroke-none" />
      <path d="M3 14 Q14 12 22 14 T45 14" className="stroke-success/60" strokeDasharray="2 2" />
      <path d="M24 12 V46" className="stroke-muted/40" strokeWidth={4} />
    </>
  ),
  'lawn-shape-rect': () => (
    <>
      <HousePlan />
      <rect x={3} y={12} width={42} height={33} className="fill-success/10 stroke-none" />
      <rect x={9} y={18} width={30} height={22} className="fill-success/30 stroke-accent" strokeWidth={1.4} />
    </>
  ),
  'lawn-shape-curved': () => (
    <>
      <HousePlan />
      <rect x={3} y={12} width={42} height={33} className="fill-success/10 stroke-none" />
      <ellipse cx={24} cy={29} rx={17} ry={11} className="fill-success/30 stroke-accent" strokeWidth={1.4} />
    </>
  ),

  // trees
  'tree-specimen': () => (
    <>
      <Ground />
      <HouseElevation x={6} w={26} />
      <path d="M39 42 V31" strokeWidth={1.4} />
      <path d="M39 33 Q31 30 33 24 Q36 18 41 21 Q47 24 44 30 Q42 34 39 33 Z" className="fill-danger/30 stroke-danger" strokeWidth={1} />
    </>
  ),
  'tree-corners': () => (
    <>
      <Ground />
      <HouseElevation x={12} w={24} />
      <Tree x={7} h={22} r={5} />
      <Tree x={41} h={22} r={5} />
    </>
  ),
  'tree-screen': () => (
    <>
      <path d="M40 3 V45" strokeDasharray="3 2" />
      {[6, 16, 26, 36].map((y) => (
        <circle key={y} cx={31} cy={y + 2} r={4.4} className={PLANT_DARK} strokeWidth={1} />
      ))}
      {[11, 21, 31, 41].map((y) => (
        <circle key={y} cx={23} cy={y} r={4.4} className={PLANT_DARK} strokeWidth={1} />
      ))}
      <Label x={9} y={26}>yard</Label>
    </>
  ),
  'tree-shade': () => (
    <>
      <Ground />
      <rect x={3} y={30} width={10} height={12} className={SOFT} />
      <ellipse cx={30} cy={42} rx={13} ry={2.2} className="fill-muted/30 stroke-none" />
      <Tree x={30} h={34} r={12} />
    </>
  ),
  'tree-allee': () => (
    <>
      <HousePlan />
      <path d="M24 12 V46" className="stroke-accent/45" strokeWidth={7} strokeLinecap="butt" />
      {[17, 26, 35, 44].map((y) => (
        <g key={y}>
          <circle cx={12} cy={y - 1} r={3.6} className={PLANT} strokeWidth={1} />
          <circle cx={36} cy={y - 1} r={3.6} className={PLANT} strokeWidth={1} />
        </g>
      ))}
    </>
  ),

  // patio
  'patio-10x10': () => patioPlan(22, 22, 4, '10×10 ft'),
  'patio-12x14': () => patioPlan(28, 26, 6, '12×14 ft'),
  'patio-16x20': () => (
    <>
      <rect x={4} y={4} width={40} height={36} className="fill-accent/20 stroke-accent" />
      <circle cx={14} cy={15} r={4} className={SOFT} />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return <rect key={i} x={14 + Math.cos(a) * 7 - 1.4} y={15 + Math.sin(a) * 7 - 1.4} width={2.8} height={2.8} rx={0.7} className="fill-muted/40" strokeWidth={0.8} />;
      })}
      {sofa(26, 26, 14, 5)}
      {chair(26, 16)}
      {table(30, 18, 7, 5)}
      <Label x={24} y={46}>16×20 ft</Label>
    </>
  ),
  'shape-rectangle': () => (
    <>
      <HousePlan />
      <rect x={8} y={14} width={32} height={20} className="fill-accent/25 stroke-accent" />
    </>
  ),
  'shape-curved': () => (
    <>
      <HousePlan />
      <path d="M6 13 H42 V24 Q42 40 24 40 Q6 40 6 24 Z" className="fill-accent/25 stroke-accent" />
    </>
  ),
  'shape-circle': () => (
    <>
      <circle cx={24} cy={24} r={18} className="fill-accent/25 stroke-accent" />
      <circle cx={24} cy={24} r={5} className="fill-muted/30" />
      <path d="M22 26 Q24 19 26 26" className="fill-gold/70 stroke-none" />
    </>
  ),
  'shape-l': () => (
    <>
      <rect x={3} y={3} width={22} height={22} className={SOFT} />
      <path d="M25 3 H44 V44 H4 V25 H25 Z" className="fill-accent/25 stroke-accent" />
    </>
  ),
  'feature-seatwall': () => (
    <>
      <Ground />
      <rect x={4} y={31} width={26} height={11} className={ACC_FILL} />
      <path d="M3 31 H31" strokeWidth={1.8} />
      <Person x={38} />
      <VDim x={33} y1={31} y2={42} label="" />
    </>
  ),
  'feature-kitchen': () => (
    <>
      <Ground />
      <rect x={4} y={26} width={40} height={16} className={ACC_FILL} />
      <path d="M3 26 H45" strokeWidth={1.8} />
      <rect x={16} y={20} width={14} height={6} rx={1} className="fill-muted/40" />
      <path d="M17 20 Q23 15 29 20" />
      <path d="M8 31 H13 M34 31 H40 M8 35 H13 M34 35 H40" strokeWidth={0.9} />
    </>
  ),

  // driveway (plan)
  'drive-plain': () => drivePlan(null),
  'drive-border': () => drivePlan(<path d="M15 11 V42 M33 11 V42" className={ACC} strokeWidth={3} strokeLinecap="butt" />),
  'drive-apron': () =>
    drivePlan(
      <>
        <path d="M12 42 L15 33 H33 L36 42 Z" className={ACC_FILL} />
        <path d="M18 37 H30 M20 35 l2 4 M26 35 l2 4" className={ACC} strokeWidth={0.8} />
      </>,
    ),
  'drive-ribbon': () =>
    drivePlan(
      <>
        <rect x={15} y={11} width={18} height={31} className={LAWN} />
        <rect x={15} y={11} width={5} height={31} className={ACC_FILL} />
        <rect x={28} y={11} width={5} height={31} className={ACC_FILL} />
      </>,
      null,
    ),
  'drive-single': () =>
    drivePlan(
      <>
        {car(21, 20)}
        <Dim x1={18} x2={30} y={38} label="" />
      </>,
      <rect x={18} y={11} width={12} height={31} className={PAVE} />,
    ),
  'drive-double': () =>
    drivePlan(
      <>
        {car(16, 18)}
        {car(26, 18)}
      </>,
      <rect x={12} y={11} width={24} height={31} className={PAVE} />,
    ),
  'drive-parking-pad': () =>
    drivePlan(
      <>
        <rect x={33} y={24} width={10} height={14} className={ACC_FILL} />
        {car(35, 26)}
        {car(21, 18)}
      </>,
    ),

  // steps
  'steps-straight': () => (
    <>
      <rect x={30} y={10} width={15} height={32} className={SOFT} />
      <path d="M4 42 V37 H11 V32 H18 V27 H25 V22 H30" className={ACC} strokeWidth={1.6} />
      <path d="M4 42 V37 H11 V32 H18 V27 H25 V22 H30 V42 Z" className="fill-accent/20 stroke-none" />
      <Ground />
    </>
  ),
  'steps-flared': () => (
    <>
      <rect x={14} y={3} width={20} height={8} className={SOFT} />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${16 - i * 3} ${14 + i * 8} H${32 + i * 3} Q${35 + i * 4} ${18 + i * 8} ${32 + i * 3} ${22 + i * 8} H${16 - i * 3} Q${13 - i * 4} ${18 + i * 8} ${16 - i * 3} ${14 + i * 8} Z`} className="fill-accent/20 stroke-accent" strokeWidth={1} />
      ))}
    </>
  ),
  'steps-landing': () => (
    <>
      <path d="M4 42 V38 H9 V34 H14 V30 H26 V26 H31 V22 H36 V18 H44 V42 Z" className="fill-accent/20 stroke-accent" />
      <Ground />
      <Label x={17} y={27}>landing</Label>
    </>
  ),
  'steps-wraparound': () => (
    <>
      <rect x={14} y={3} width={20} height={8} className={SOFT} />
      <rect x={16} y={11} width={16} height={12} className={PAVE} />
      <path d="M12 11 V27 H36 V11" className={ACC} strokeWidth={1.2} />
      <path d="M8 11 V31 H40 V11" className={ACC} strokeWidth={1.2} />
      <path d="M4 11 V35 H44 V11" className={ACC} strokeWidth={1.2} />
    </>
  ),
  'rail-metal': () => (
    <>
      <path d="M4 42 V36 H14 V30 H24 V24 H34 V18 H44" className={SOFT} />
      <path d="M6 22 L42 6" strokeWidth={1.8} className="stroke-text" />
      {[9, 16, 23, 30, 37].map((x) => (
        <path key={x} d={`M${x} ${22 - ((x - 6) * 16) / 36} V${42 - Math.floor((x - 4) / 10) * 6}`} className="stroke-text" strokeWidth={0.9} />
      ))}
    </>
  ),
  'rail-wood': () => (
    <>
      <Ground />
      <rect x={4} y={18} width={40} height={3} className={ACC_FILL} />
      <rect x={4} y={36} width={40} height={2} className={ACC_FILL} />
      {[8, 13, 18, 23, 28, 33, 38].map((x) => (
        <rect key={x} x={x - 1} y={21} width={2} height={15} className={SOFT} strokeWidth={0.8} />
      ))}
      <rect x={3} y={15} width={4} height={27} className={ACC_FILL} />
      <rect x={41} y={15} width={4} height={27} className={ACC_FILL} />
    </>
  ),
  'rail-cable': () => (
    <>
      <Ground />
      <rect x={4} y={14} width={3} height={28} className="fill-text/70 stroke-none" />
      <rect x={41} y={14} width={3} height={28} className="fill-text/70 stroke-none" />
      <rect x={4} y={13} width={40} height={2} className="fill-text/70 stroke-none" />
      {[19, 23, 27, 31, 35, 39].map((y) => (
        <path key={y} d={`M7 ${y} H41`} strokeWidth={0.6} />
      ))}
    </>
  ),

  // fences (elevation)
  'fence-picket': () => fenceElevation(<>{pickets(4, 45, 24, 4.2, 2.6, true, 'fill-accent/20 stroke-accent')}<path d="M3 29 H45 M3 37 H45" strokeWidth={1} /></>),
  'fence-horizontal': () =>
    fenceElevation(
      <>
        {[16, 20, 24, 28, 32, 36].map((y) => (
          <rect key={y} x={4} y={y} width={40} height={3} className={ACC_FILL} strokeWidth={0.8} />
        ))}
        <path d="M4 14 V42 M24 14 V42 M44 14 V42" strokeWidth={1.4} />
      </>,
    ),
  'fence-privacy': () =>
    fenceElevation(
      <>
        <rect x={4} y={12} width={40} height={30} className={ACC_FILL} />
        {[9, 14, 19, 24, 29, 34, 39].map((x) => (
          <path key={x} d={`M${x} 12 V42`} className={ACC} strokeWidth={0.7} />
        ))}
        <rect x={3} y={10} width={42} height={2.5} className="fill-accent/40 stroke-accent" strokeWidth={0.8} />
      </>,
    ),
  'fence-split-rail': () =>
    fenceElevation(
      <>
        {[6, 24, 42].map((x) => (
          <rect key={x} x={x - 1.6} y={20} width={3.2} height={22} className={ACC_FILL} />
        ))}
        <path d="M5 26 L43 24 M5 33 L43 35" className={ACC} strokeWidth={2.2} />
      </>,
    ),
  'fence-metal': () =>
    fenceElevation(
      <>
        <path d="M3 22 H45 M3 38 H45" className="stroke-text" strokeWidth={1.2} />
        {Array.from({ length: 11 }, (_, i) => 5 + i * 3.8).map((x) => (
          <path key={x} d={`M${x} 42 V19 M${x - 1} 20 L${x} 17.5 L${x + 1} 20`} className="stroke-text" strokeWidth={0.9} />
        ))}
      </>,
    ),
  'fence-height-3ft': () => fenceHeight(13, '3 ft'),
  'fence-height-4ft': () => fenceHeight(17, '4 ft'),
  'fence-height-6ft': () => fenceHeight(26, '6 ft'),

  // retaining walls (section)
  'wall-low': () => (
      <>
        <rect x={3} y={38} width={20} height={6} className={PAVE} />
        <rect x={20} y={30} width={7} height={14} className={ACC_FILL} />
        <path d="M20 34 H27 M20 38 H27" className={ACC} strokeWidth={0.8} />
        <rect x={27} y={30} width={18} height={14} className="fill-muted/30 stroke-none" />
        <Grass x1={28} x2={44} y={30} />
        <Person x={11} base={38} h={14} />
    </>
  ),
  'wall-mid': () => (
      <>
        <rect x={3} y={38} width={20} height={6} className={PAVE} />
        <rect x={19} y={22} width={8} height={22} className={ACC_FILL} />
        <path d="M19 27 H27 M19 32 H27 M19 37 H27" className={ACC} strokeWidth={0.8} />
        <rect x={27} y={22} width={18} height={22} className="fill-muted/30 stroke-none" />
        <Grass x1={28} x2={44} y={22} />
        <Person x={11} base={38} h={14} />
    </>
  ),
  'wall-terraced': () => (
      <>
        <path d="M3 40 H14 V32 H28 V24 H45 V44 H3 Z" className="fill-muted/20 stroke-none" />
        <rect x={12} y={32} width={5} height={10} className={ACC_FILL} />
        <rect x={26} y={24} width={5} height={10} className={ACC_FILL} />
        <Shrub cx={22} cy={29} r={3} />
        <Shrub cx={37} cy={21} r={3} />
        <path d="M3 40 H12 M17 32 H26 M31 24 H45" />
    </>
  ),

  // water features
  'water-bubbler': () => (
    <>
      <Ground y={40} />
      <ellipse cx={24} cy={41} rx={18} ry={3.5} className="fill-muted/30" strokeWidth={0.9} />
      <path d="M17 40 Q15 28 20 22 H28 Q33 28 31 40 Z" className={ACC_FILL} />
      <path d="M24 22 Q22 15 24 12 Q26 15 24 22" className="fill-accent/40 stroke-accent" strokeWidth={0.9} />
      <path d="M20 22 Q17 24 18 30 M28 22 Q31 24 30 30" className="stroke-accent/60" strokeWidth={0.9} />
    </>
  ),
  'water-wall': () => (
    <>
      <rect x={6} y={4} width={36} height={30} className={SOFT} />
      <rect x={21} y={14} width={6} height={3} className="fill-muted/50" />
      <path d="M24 17 Q25 26 24 34" className={ACC} strokeWidth={2} />
      <path d="M10 34 H38 V44 H10 Z" className={ACC_FILL} />
    </>
  ),
  'water-pond': () => (
    <>
      <path d="M8 24 Q8 10 24 10 Q42 10 40 26 Q38 40 22 39 Q8 38 8 24 Z" className="fill-accent/30 stroke-accent" />
      {[
        [9, 15],
        [17, 8],
        [31, 8],
        [41, 18],
        [39, 33],
        [27, 41],
        [13, 38],
        [6, 28],
      ].map(([x, y]) => (
        <ellipse key={`${x}${y}`} cx={x} cy={y} rx={3} ry={2} className="fill-muted/40" strokeWidth={0.8} />
      ))}
      <Shrub cx={36} cy={36} r={3} />
      <path d="M18 22 q3 -2 6 0 M24 28 q3 -2 6 0" className={ACC} strokeWidth={0.8} />
    </>
  ),
  'water-rill': () => (
    <>
      <rect x={4} y={4} width={40} height={40} className={PAVE} />
      <rect x={21} y={4} width={6} height={40} className="fill-accent/35 stroke-accent" />
      <path d="M22.5 12 q1.5 -1 3 0 M22.5 24 q1.5 -1 3 0 M22.5 36 q1.5 -1 3 0" className={ACC} strokeWidth={0.8} />
    </>
  ),
  'water-dry-creek': () => (
    <>
      <rect x={3} y={3} width={42} height={42} className={LAWN} />
      <path d="M10 3 Q30 14 18 24 T 36 45" className="stroke-muted/45" strokeWidth={9} />
      {[
        [13, 6],
        [22, 11],
        [24, 18],
        [17, 23],
        [20, 30],
        [28, 36],
        [33, 42],
      ].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx={2.4} ry={1.6} className="fill-muted/60" strokeWidth={0.6} />
      ))}
      <ellipse cx={30} cy={22} rx={4} ry={3} className="fill-muted/50" />
      <ellipse cx={11} cy={33} rx={3.5} ry={2.6} className="fill-muted/50" />
    </>
  ),

  // front doors (elevation)
  'door-panel': () =>
    doorFrame(
      <>
        {[10, 20, 31].map((y, i) => (
          <g key={y}>
            <rect x={17.5} y={y} width={5.5} height={i === 2 ? 11 : 8} rx={0.4} strokeWidth={0.8} className={ACC} />
            <rect x={25} y={y} width={5.5} height={i === 2 ? 11 : 8} rx={0.4} strokeWidth={0.8} className={ACC} />
          </g>
        ))}
      </>,
    ),
  'door-craftsman': () =>
    doorFrame(
      <>
        {[17.5, 22.5, 27.5].map((x) => (
          <rect key={x} x={x} y={10} width={3.8} height={9} className="fill-surface/70 stroke-accent" strokeWidth={0.8} />
        ))}
        <path d="M16 21 H32" className={ACC} strokeWidth={1.6} />
        <rect x={17.5} y={24} width={5.5} height={18} strokeWidth={0.8} className={ACC} />
        <rect x={25} y={24} width={5.5} height={18} strokeWidth={0.8} className={ACC} />
      </>,
    ),
  'door-glass': () => doorFrame(<rect x={19} y={10} width={10} height={32} className="fill-surface/70 stroke-accent" strokeWidth={0.9} />),
  'door-plank': () =>
    doorFrame(
      <>
        {[19.5, 24, 28.5].map((x) => (
          <path key={x} d={`M${x} 10 V45`} className={ACC} strokeWidth={0.7} />
        ))}
        <path d="M15 20 H25 M15 38 H25" className="stroke-text" strokeWidth={1.4} />
      </>,
      true,
    ),
  'door-flush': () => doorFrame(<path d="M29 18 V36" className="stroke-text" strokeWidth={1.6} />),
  'surround-simple': () => surround(<path d="M16 45 V12 H32 V45" strokeWidth={2} />),
  'surround-sidelights': () =>
    surround(
      <>
        <rect x={12} y={14} width={4.5} height={31} className="fill-surface/70" strokeWidth={0.9} />
        <rect x={31.5} y={14} width={4.5} height={31} className="fill-surface/70" strokeWidth={0.9} />
        <path d="M10 45 V12 H38 V45" strokeWidth={1.6} />
      </>,
    ),
  'surround-transom': () =>
    surround(
      <>
        <path d="M17 13 A7 6 0 0 1 31 13 Z" className="fill-surface/70" strokeWidth={0.9} />
        <path d="M24 7 V13 M19 9 L24 13 L29 9" strokeWidth={0.6} />
        <path d="M16 45 V13 A8 7 0 0 1 32 13 V45" strokeWidth={1.6} />
      </>,
    ),
  'surround-pediment': () =>
    surround(
      <>
        <rect x={13} y={14} width={3} height={31} className={SOFT} />
        <rect x={32} y={14} width={3} height={31} className={SOFT} />
        <path d="M11 13 L24 4 L37 13 Z" className={SOFT} />
        <path d="M11 13 H37" strokeWidth={1.4} />
      </>,
    ),

  // porch columns (elevation)
  'col-tapered': () =>
    column(
      <>
        {[12, 36].map((x) => (
          <g key={x}>
            <path d={`M${x - 2.5} 7 H${x + 2.5} L${x + 4} 30 H${x - 4} Z`} className={ACC_FILL} />
            <rect x={x - 5.5} y={30} width={11} height={15} className="fill-muted/35" />
            <path d={`M${x - 5.5} 35 H${x + 5.5} M${x - 5.5} 40 H${x + 5.5}`} strokeWidth={0.7} />
          </g>
        ))}
      </>,
    ),
  'col-round': () =>
    column(
      <>
        {[12, 36].map((x) => (
          <g key={x}>
            <rect x={x - 4.5} y={7} width={9} height={2.5} className={ACC_FILL} />
            <path d={`M${x - 3} 9.5 L${x - 3.5} 42 H${x + 3.5} L${x + 3} 9.5 Z`} className={ACC_FILL} />
            <rect x={x - 4.5} y={42} width={9} height={3} className={ACC_FILL} />
          </g>
        ))}
      </>,
    ),
  'col-square': () =>
    column(
      <>
        {[12, 36].map((x) => (
          <g key={x}>
            <rect x={x - 3} y={9} width={6} height={36} className={ACC_FILL} />
            <rect x={x - 4} y={7} width={8} height={2.5} className={ACC_FILL} />
          </g>
        ))}
      </>,
    ),
  'col-modern': () =>
    column(
      <>
        {[12, 36].map((x) => (
          <rect key={x} x={x - 1.2} y={7} width={2.4} height={38} className="fill-text/70 stroke-none" />
        ))}
      </>,
    ),
  'col-turned': () =>
    column(
      <>
        {[12, 36].map((x) => (
          <g key={x}>
            <path d={`M${x - 2} 7 V12 Q${x - 4} 15 ${x - 2} 18 V30 Q${x - 4} 34 ${x - 2} 37 V45 H${x + 2} V37 Q${x + 4} 34 ${x + 2} 30 V18 Q${x + 4} 15 ${x + 2} 12 V7 Z`} className={ACC_FILL} />
            <path d={x < 24 ? `M${x + 2} 14 Q${x + 6} 8 ${x + 9} 7` : `M${x - 2} 14 Q${x - 6} 8 ${x - 9} 7`} className={ACC} strokeWidth={1.2} />
          </g>
        ))}
      </>,
    ),

  // garage doors (elevation)
  'garage-carriage': () =>
    garage(
      <>
        {[10, 17, 25, 32].map((x) => (
          <rect key={x} x={x} y={18} width={5.5} height={4} className="fill-surface/70" strokeWidth={0.7} />
        ))}
        <path d="M24 16 V44" className={ACC} strokeWidth={1} />
        <path d="M10 28 L22 40 M38 28 L26 40" className={ACC} strokeWidth={0.8} />
        <path d="M9 26 H14 M9 38 H14 M34 26 H39 M34 38 H39" className="stroke-text" strokeWidth={1.4} />
      </>,
    ),
  'garage-panel': () =>
    garage(
      <>
        {[18, 25, 32, 39].map((y) =>
          [10, 18, 26, 34].map((x) => <rect key={`${x}${y}`} x={x} y={y} width={5} height={4} className={ACC} strokeWidth={0.7} />),
        )}
      </>,
    ),
  'garage-glass': () =>
    garage(
      <>
        {[17, 24, 31, 38].map((y) =>
          [9, 17, 25, 33].map((x) => <rect key={`${x}${y}`} x={x} y={y} width={6} height={5} className="fill-surface/70 stroke-text/70" strokeWidth={0.6} />),
        )}
      </>,
    ),
  'garage-flush': () => garage(<path d="M8 23 H40 M8 30 H40 M8 37 H40" className={ACC} strokeWidth={0.6} />),
  'garage-plank': () =>
    garage(
      <>
        {[12, 16, 20, 24, 28, 32, 36].map((x) => (
          <path key={x} d={`M${x} 16 V44`} className={ACC} strokeWidth={0.6} />
        ))}
      </>,
    ),

  // shutters
  'shutters-louvered': () =>
    shutterWindow((x) => (
      <g key={x}>
        <rect x={x} y={10} width={7} height={26} className={ACC_FILL} />
        {[13, 16, 19, 22, 25, 28, 31, 34].map((y) => (
          <path key={y} d={`M${x + 1} ${y} H${x + 6}`} className={ACC} strokeWidth={0.6} />
        ))}
      </g>
    )),
  'shutters-panel': () =>
    shutterWindow((x) => (
      <g key={x}>
        <rect x={x} y={10} width={7} height={26} className={ACC_FILL} />
        <rect x={x + 1.4} y={12} width={4.2} height={9} className={ACC} strokeWidth={0.6} />
        <rect x={x + 1.4} y={24} width={4.2} height={10} className={ACC} strokeWidth={0.6} />
      </g>
    )),
  'shutters-board': () =>
    shutterWindow((x) => (
      <g key={x}>
        <rect x={x} y={10} width={7} height={26} className={ACC_FILL} />
        <path d={`M${x + 2.3} 10 V36 M${x + 4.7} 10 V36`} className={ACC} strokeWidth={0.5} />
        <path d={`M${x} 14 H${x + 7} M${x} 32 H${x + 7} M${x + 7} 14 L${x} 32`} className={ACC} strokeWidth={1} />
      </g>
    )),

  // sheen
  'sheen-matte': () => sheen(null),
  'sheen-eggshell': () => sheen(<ellipse cx={18} cy={16} rx={10} ry={6} className="fill-white/15 stroke-none" />),
  'sheen-satin': () => sheen(<ellipse cx={18} cy={16} rx={9} ry={5} className="fill-white/30 stroke-none" />),
  'sheen-semigloss': () =>
    sheen(
      <>
        <ellipse cx={18} cy={16} rx={8} ry={4} className="fill-white/35 stroke-none" />
        <ellipse cx={17} cy={15} rx={4} ry={1.8} className="fill-white/60 stroke-none" />
      </>,
    ),
  'sheen-gloss': () =>
    sheen(
      <>
        <path d="M10 12 L30 9 L14 26 Z" className="fill-white/25 stroke-none" />
        <ellipse cx={16} cy={14} rx={5} ry={2} className="fill-white/85 stroke-none" />
      </>,
    ),
  'sheen-textured': () =>
    sheen(
      <>
        {Array.from({ length: 25 }, (_, i) => (
          <circle key={i} cx={10 + (i % 5) * 7 + ((i / 5) % 2) * 2} cy={10 + Math.floor(i / 5) * 7} r={1.4} className="fill-white/20 stroke-none" />
        ))}
      </>,
    ),

  // wall paint layouts
  'wall-plain': () => roomWall(<rect x={4} y={6} width={40} height={32} className="fill-accent/25 stroke-none" />),
  'wall-accent': () => (
    <>
      <path d="M4 6 L16 12 V40 L4 44 Z" className="fill-accent/60 stroke-accent" />
      <path d="M16 12 H44 V40 H16 Z" className={SOFT} />
      <path d="M16 37 H44" strokeWidth={1.1} />
    </>
  ),
  'wall-two-tone': () =>
    roomWall(
      <>
        <rect x={4} y={6} width={40} height={18} className="fill-accent/15 stroke-none" />
        <rect x={4} y={24} width={40} height={14} className="fill-accent/55 stroke-none" />
        <path d="M4 24 H44" strokeWidth={1.2} />
      </>,
    ),
  'wall-ceiling': () => (
    <>
      <path d="M4 4 H44 L36 12 H12 Z" className="fill-accent/60 stroke-accent" />
      <path d="M12 12 H36 V40 H12 Z M4 4 L12 12 V40 L4 44 Z M44 4 L36 12 V40 L44 44 Z" className={SOFT} />
    </>
  ),
  'wall-limewash': () =>
    roomWall(
      <>
        <rect x={4} y={6} width={40} height={32} className="fill-accent/20 stroke-none" />
        {[
          [12, 12, 7],
          [26, 18, 9],
          [36, 10, 6],
          [16, 28, 8],
          [34, 30, 7],
        ].map(([x, y, r]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r={r} className="fill-accent/15 stroke-none" />
        ))}
      </>,
    ),
  'wall-drench': () => (
    <>
      <rect x={4} y={6} width={40} height={36} className="fill-accent/55 stroke-accent" />
      <path d="M4 38 H44" className={ACC} strokeWidth={1.2} />
      <rect x={30} y={18} width={9} height={20} className="fill-accent/70 stroke-accent" strokeWidth={1} />
    </>
  ),

  // ceilings
  'ceiling-beams': () =>
    ceilingSection(
      <>
        <path d="M4 12 H44" />
        {[9, 18, 27, 36].map((x) => (
          <rect key={x} x={x} y={12} width={4} height={4} className={ACC_FILL} />
        ))}
      </>,
    ),
  'ceiling-coffered': () => (
    <>
      <rect x={4} y={4} width={40} height={40} className={SOFT} />
      {[4, 17.3, 30.6].map((y) =>
        [4, 17.3, 30.6].map((x) => <rect key={`${x}${y}`} x={x + 2} y={y + 2} width={9.3} height={9.3} className={ACC_FILL} strokeWidth={0.9} />),
      )}
    </>
  ),
  'ceiling-tray': () => ceilingSection(<path d="M4 16 H11 V12 H16 V8 H32 V12 H37 V16 H44" className={ACC} strokeWidth={1.4} />),

  // cabinets
  'cab-shaker': () => cabDoor(<rect x={17} y={10} width={14} height={28} className={ACC} strokeWidth={1} />),
  'cab-slab': () => cabDoor(null),
  'cab-inset': () =>
    cabDoor(
      <>
        <rect x={10} y={3} width={28} height={42} rx={0.6} strokeWidth={1.4} />
        <rect x={16} y={9} width={16} height={30} className={ACC} strokeWidth={0.8} />
      </>,
    ),
  'cab-raised': () =>
    cabDoor(
      <>
        <rect x={17} y={10} width={14} height={28} className={ACC} strokeWidth={1} />
        <rect x={19.5} y={12.5} width={9} height={23} rx={2} className={ACC} strokeWidth={0.8} />
      </>,
    ),
  'cab-fluted': () =>
    cabDoor(
      <>
        {[16, 18.5, 21, 23.5, 26, 28.5, 31].map((x) => (
          <path key={x} d={`M${x} 9 V39`} className={ACC} strokeWidth={0.7} />
        ))}
      </>,
    ),
  'cab-glass': () => cabDoor(<rect x={16} y={9} width={16} height={30} className="fill-surface/70 stroke-accent" strokeWidth={0.9} />),
  'cab-one-tone': () => kitchen(ACC_FILL, ACC_FILL, ACC_FILL),
  'cab-island-contrast': () => kitchen(ACC_FILL, ACC_FILL, 'fill-accent/70 stroke-accent'),
  'cab-two-tone': () => kitchen('fill-accent/15 stroke-accent', 'fill-accent/70 stroke-accent', null),
  'cab-open-shelves': () => kitchen(SOFT, ACC_FILL, null, true),

  // furniture layouts (plan)
  'layout-conversation': () =>
    roomPlan(
      <>
        {sofa(14, 34, 20, 7)}
        {chair(15, 9)}
        {chair(27, 9)}
        {table(18, 20, 12, 8)}
      </>,
    ),
  'layout-focal': () =>
    roomPlan(
      <>
        {sofa(14, 36, 20, 6)}
        {sofa(6, 18, 6, 14)}
        {sofa(36, 18, 6, 14)}
        {table(18, 22, 12, 8)}
      </>,
      'fireplace',
    ),
  'layout-l': () =>
    roomPlan(
      <>
        <path d="M8 22 H15 V35 H34 V41 H8 Z" className="fill-accent/30 stroke-accent" strokeWidth={1} />
        {table(19, 24, 10, 7)}
        {chair(34, 12)}
      </>,
      'tv',
    ),
  'layout-float': () =>
    roomPlan(
      <>
        <rect x={10} y={10} width={28} height={24} className="fill-muted/15" strokeDasharray="2 1.5" strokeWidth={0.9} />
        {sofa(14, 27, 20, 6)}
        {chair(13, 12)}
        {chair(29, 12)}
        {table(19, 18, 10, 6)}
        <path d="M6 40 H42" className={ACC} strokeDasharray="2 2" strokeWidth={1} />
      </>,
    ),
  'rug-front-legs': () =>
    roomPlan(
      <>
        <rect x={10} y={14} width={28} height={20} className="fill-gold/20 stroke-gold" strokeWidth={1} />
        {sofa(12, 30, 24, 7)}
        {table(18, 18, 12, 7)}
      </>,
    ),
  'rug-all-legs': () =>
    roomPlan(
      <>
        <rect x={7} y={8} width={34} height={33} className="fill-gold/20 stroke-gold" strokeWidth={1} />
        {sofa(12, 31, 24, 7)}
        {chair(11, 11)}
        {chair(31, 11)}
        {table(18, 19, 12, 7)}
      </>,
    ),
  'rug-layered': () =>
    roomPlan(
      <>
        <rect x={7} y={8} width={34} height={32} className="fill-muted/20 stroke-muted" strokeWidth={1} />
        <rect x={14} y={14} width={20} height={20} className="fill-gold/25 stroke-gold" strokeWidth={1} />
        <path d="M14 19 H34 M14 24 H34 M14 29 H34" className="stroke-gold/60" strokeWidth={0.7} />
      </>,
    ),

  // window treatments
  'wt-drapes': () =>
    windowTreatment(
      <>
        <path d="M8 8 H40" strokeWidth={1.4} />
        <path d="M9 8 V45 H15 V8" className={ACC_FILL} />
        <path d="M33 8 V45 H39 V8" className={ACC_FILL} />
        <path d="M11 8 V45 M13 8 V45 M35 8 V45 M37 8 V45" className={ACC} strokeWidth={0.5} />
      </>,
    ),
  'wt-roman': () =>
    windowTreatment(
      <>
        <rect x={16} y={12} width={16} height={10} className={ACC_FILL} />
        <path d="M16 15.5 H32 M16 19 H32" className={ACC} strokeWidth={0.7} />
      </>,
    ),
  'wt-woven': () =>
    windowTreatment(
      <>
        <rect x={16} y={12} width={16} height={14} className="fill-gold/30 stroke-gold" />
        {[14, 16, 18, 20, 22, 24].map((y) => (
          <path key={y} d={`M16 ${y} H32`} className="stroke-gold/70" strokeWidth={0.5} />
        ))}
      </>,
    ),
  'wt-shutters': () =>
    windowTreatment(
      <>
        <rect x={16} y={12} width={8} height={22} className={ACC_FILL} />
        <rect x={24} y={12} width={8} height={22} className={ACC_FILL} />
        {[15, 18, 21, 24, 27, 30].map((y) => (
          <path key={y} d={`M17 ${y} H23 M25 ${y} H31`} className={ACC} strokeWidth={0.6} />
        ))}
      </>,
    ),
  'wt-layered': () =>
    windowTreatment(
      <>
        <rect x={16} y={12} width={16} height={9} className="fill-gold/30 stroke-gold" />
        <path d="M8 8 H40" strokeWidth={1.4} />
        <path d="M9 8 V45 H14 V8 Z M34 8 V45 H39 V8 Z" className={ACC_FILL} />
      </>,
    ),
  'mount-high-wide': () => (
    <>
      <path d="M4 4 H44" className="stroke-muted/50" />
      <Ground y={45} />
      <Window x={17} y={14} w={14} h={20} />
      <path d="M6 6 H42" strokeWidth={1.4} className={ACC} />
      <path d="M7 6 V45 H12 V6 Z M36 6 V45 H41 V6 Z" className={ACC_FILL} />
    </>
  ),
  'mount-inside': () =>
    windowTreatment(
      <>
        <rect x={14} y={10} width={20} height={26} strokeWidth={1.6} />
        <rect x={16} y={12} width={16} height={8} className={ACC_FILL} />
      </>,
    ),
  'mount-standard': () =>
    windowTreatment(
      <>
        <path d="M12 10 H36" strokeWidth={1.4} className={ACC} />
        <path d="M13 10 V45 H17 V10 Z M31 10 V45 H35 V10 Z" className={ACC_FILL} />
      </>,
    ),

  // fireplaces
  'mantel-beam': () =>
    fireplace(
      <>
        <rect x={13} y={22} width={22} height={23} className="fill-muted/25" />
        <rect x={10} y={19} width={28} height={4} className="fill-gold/40 stroke-gold" />
      </>,
    ),
  'mantel-classic': () =>
    fireplace(
      <>
        <path d="M10 45 V22 H38 V45 H34 V26 H14 V45 Z" className={ACC_FILL} />
        <rect x={8} y={19} width={32} height={3} className={ACC_FILL} />
      </>,
    ),
  'fp-standard': () =>
    fireplace(
      <>
        <rect x={6} y={6} width={36} height={39} className={SOFT} />
        <rect x={14} y={26} width={20} height={19} className={ACC_FILL} />
      </>,
    ),
  'fp-full-height': () =>
    fireplace(
      <>
        <rect x={13} y={3} width={22} height={42} className={ACC_FILL} />
        <path d="M13 12 H35 M13 21 H35 M18 3 V12 M28 12 V21 M23 21 V30" className={ACC} strokeWidth={0.6} />
      </>,
    ),
  'fp-builtins': () =>
    fireplace(
      <>
        <rect x={15} y={6} width={18} height={39} className={SOFT} />
        {[3, 35].map((x) => (
          <g key={x}>
            <rect x={x} y={6} width={10} height={39} className={ACC_FILL} />
            <path d={`M${x} 14 H${x + 10} M${x} 22 H${x + 10} M${x} 30 H${x + 10}`} className={ACC} strokeWidth={0.8} />
          </g>
        ))}
      </>,
    ),

  // amount of change
  'change-subtle': () => beforeAfter(<circle cx={35} cy={19} r={2.2} className={ACC_SOLID} />),
  'change-moderate': () =>
    beforeAfter(
      <>
        <circle cx={35} cy={19} r={2.2} className={ACC_SOLID} />
        <rect x={28} y={31} width={15} height={3} className={ACC_SOLID} />
      </>,
    ),
  'change-bold': () => beforeAfter(<path d="M26 12 H45 V36 H26 Z" className="fill-accent/45 stroke-accent" />),
};

/** True when the id has its own drawing (used by tests to keep DIAGRAM_IDS covered). */
export function hasDiagramDrawing(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DRAWINGS, id);
}

export function diagramDescription(id: string): string | undefined {
  return isDiagramId(id) ? DIAGRAM_IDS[id] : undefined;
}

export function Diagram({ id, className, title }: { id: string; className?: string; title?: string }) {
  const draw = DRAWINGS[id];
  const label = title ?? diagramDescription(id) ?? id;
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      className={cn('text-muted', className)}
    >
      <title>{label}</title>
      {draw ? (
        draw()
      ) : (
        <>
          <rect x={7} y={7} width={34} height={34} rx={4} className={SOFT} />
          <path d="M15 31 L21 23 L26 28 L29 25 L34 31 Z" className="fill-muted/30" strokeWidth={1} />
          <circle cx={30} cy={17} r={2.4} />
        </>
      )}
    </svg>
  );
}

