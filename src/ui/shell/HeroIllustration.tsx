/**
 * Projects-home hero: an illustrated house with a draggable before/after
 * divider — the plain house on the left, the redesign on the right (new
 * paint, shutters, a flagstone walk, planting beds, a Japanese maple and
 * warm evening lighting). Drag, tap, or use the arrow keys on the handle.
 * Gently sweeps once on first view unless reduced motion is preferred.
 */
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../common';
import { usePrefersReducedMotion } from './hooks';

const W = 480;
const H = 340;

interface Palette {
  skyTop: string;
  skyBottom: string;
  hills: string;
  siding: string;
  sidingLine: string;
  roof: string;
  roofLine: string;
  trim: string;
  door: string;
  knob: string;
  glass: string;
  chimney: string;
  foundation: string;
  steps: string;
}

const BEFORE: Palette = {
  skyTop: '#d9e1e5',
  skyBottom: '#f0efe8',
  hills: '#bcc3b7',
  siding: '#d8d0c0',
  sidingLine: '#c8bfad',
  roof: '#8b8379',
  roofLine: '#7b746a',
  trim: '#ebe5d9',
  door: '#9d8d77',
  knob: '#6d655b',
  glass: '#5d6870',
  chimney: '#a39383',
  foundation: '#b3a998',
  steps: '#c9c3b8',
};

const AFTER: Palette = {
  skyTop: '#223049',
  skyBottom: '#e3a278',
  hills: '#2b3a39',
  siding: '#5e7367',
  sidingLine: '#52665b',
  roof: '#2e3135',
  roofLine: '#3a3e43',
  trim: '#f3f0e8',
  door: '#1c1f21',
  knob: '#d9b779',
  glass: '#ffcf87',
  chimney: '#6e5145',
  foundation: '#3c3e40',
  steps: '#8d8478',
};

const WINDOWS = [
  { x: 149, y: 178, w: 40, h: 50 },
  { x: 291, y: 178, w: 40, h: 50 },
];
const DORMERS = [178, 270];

function House({ p, ids, after }: { p: Palette; ids: Ids; after: boolean }) {
  return (
    <g>
      {/* chimney */}
      <rect x={320} y={62} width={20} height={56} fill={p.chimney} />
      <rect x={316} y={57} width={28} height={7} rx={1} fill={p.roofLine} />
      {/* roof */}
      <polygon points="96,156 166,84 314,84 384,156" fill={p.roof} />
      <g clipPath={`url(#${ids.roofClip})`} stroke={p.roofLine} strokeWidth={1.2} opacity={0.9}>
        {[96, 106, 116, 126, 136, 146].map((y) => (
          <line key={y} x1={90} x2={390} y1={y} y2={y} />
        ))}
      </g>
      {/* dormers */}
      {DORMERS.map((x) => (
        <g key={x}>
          <rect x={x} y={100} width={32} height={34} fill={p.siding} />
          <polygon points={`${x - 6},103 ${x + 16},84 ${x + 38},103`} fill={p.roof} />
          <rect x={x + 7} y={109} width={18} height={20} fill={p.trim} />
          <rect x={x + 9} y={111} width={14} height={16} fill={p.glass} />
          <line x1={x + 16} x2={x + 16} y1={111} y2={127} stroke={p.trim} strokeWidth={1.2} />
        </g>
      ))}
      {/* fascia */}
      <rect x={96} y={152} width={288} height={6} fill={p.trim} />
      {/* body */}
      <rect x={116} y={158} width={248} height={92} fill={p.siding} />
      <g stroke={p.sidingLine} strokeWidth={1}>
        {Array.from({ length: 11 }, (_, i) => 166 + i * 8).map((y) => (
          <line key={y} x1={116} x2={364} y1={y} y2={y} />
        ))}
      </g>
      <rect x={116} y={158} width={6} height={92} fill={p.trim} />
      <rect x={358} y={158} width={6} height={92} fill={p.trim} />
      {/* windows */}
      {WINDOWS.map((w) => (
        <g key={w.x}>
          {after && (
            <>
              <rect x={w.x - 15} y={w.y} width={11} height={w.h} fill="#23302b" />
              <rect x={w.x + w.w + 4} y={w.y} width={11} height={w.h} fill="#23302b" />
            </>
          )}
          <rect x={w.x - 3} y={w.y - 3} width={w.w + 6} height={w.h + 6} fill={p.trim} />
          <rect x={w.x} y={w.y} width={w.w} height={w.h} fill={p.glass} />
          {after && <rect x={w.x} y={w.y} width={w.w} height={w.h} fill={`url(#${ids.windowGlow})`} />}
          <g stroke={p.trim} strokeWidth={2}>
            <line x1={w.x + w.w / 2} x2={w.x + w.w / 2} y1={w.y} y2={w.y + w.h} />
            <line x1={w.x} x2={w.x + w.w} y1={w.y + w.h / 2} y2={w.y + w.h / 2} />
          </g>
          <rect x={w.x - 6} y={w.y + w.h + 2} width={w.w + 12} height={4} fill={p.trim} />
        </g>
      ))}
      {/* entry */}
      <polygon points="210,180 240,163 270,180" fill={p.trim} />
      <rect x={215} y={180} width={50} height={70} fill={p.trim} />
      <rect x={222} y={186} width={36} height={64} fill={p.door} />
      <g fill="none" stroke={after ? '#33393c' : '#8a7b66'} strokeWidth={1.2}>
        <rect x={227} y={192} width={26} height={22} rx={1} />
        <rect x={227} y={220} width={26} height={24} rx={1} />
      </g>
      <circle cx={252} cy={219} r={2.2} fill={p.knob} />
      {/* foundation & steps */}
      <rect x={116} y={244} width={248} height={6} fill={p.foundation} />
      <rect x={210} y={250} width={60} height={5} fill={p.steps} />
      <rect x={204} y={255} width={72} height={5} fill={p.steps} />
    </g>
  );
}

interface Ids {
  skyB: string;
  skyA: string;
  lawnA: string;
  roofClip: string;
  pathClip: string;
  glow: string;
  windowGlow: string;
  afterClip: string;
}

function Before({ ids }: { ids: Ids }) {
  return (
    <g>
      <rect width={W} height={262} fill={`url(#${ids.skyB})`} />
      <path d="M0,232 C60,200 120,214 170,206 C230,196 300,214 360,204 C410,196 450,210 480,204 L480,262 L0,262 Z" fill={BEFORE.hills} />
      <rect y={250} width={W} height={H - 250} fill="#b9b58e" />
      <g fill="#a9a57f">
        <ellipse cx={80} cy={292} rx={46} ry={8} />
        <ellipse cx={392} cy={312} rx={58} ry={9} />
        <ellipse cx={140} cy={326} rx={34} ry={6} />
      </g>
      <g fill="#c8c39d">
        <ellipse cx={360} cy={276} rx={40} ry={6} />
        <ellipse cx={60} cy={322} rx={30} ry={5} />
      </g>
      <House p={BEFORE} ids={ids} after={false} />
      {/* straight concrete walk */}
      <polygon points="220,260 260,260 302,340 178,340" fill="#ccc7bc" />
      <g stroke="#b3ada1" strokeWidth={1}>
        <line x1={214} x2={266} y1={282} y2={282} />
        <line x1={204} x2={278} y1={306} y2={306} />
      </g>
      <path d="M236,288 l6,7 l-3,6" stroke="#aaa497" strokeWidth={1} fill="none" />
      {/* tired shrubs */}
      <g fill="#8b8f64">
        <ellipse cx={150} cy={247} rx={17} ry={10} />
        <ellipse cx={334} cy={248} rx={13} ry={8} />
      </g>
      <g fill="#7a7f57">
        <ellipse cx={145} cy={250} rx={9} ry={5} />
        <ellipse cx={338} cy={251} rx={7} ry={4} />
      </g>
    </g>
  );
}

function After({ ids }: { ids: Ids }) {
  return (
    <g>
      <rect width={W} height={262} fill={`url(#${ids.skyA})`} />
      {/* moon & stars */}
      <circle cx={420} cy={50} r={13} fill="#f6ecd2" />
      <circle cx={426} cy={45} r={12} fill="#2a3750" />
      <g fill="#f6ecd2">
        {[
          [60, 34, 1.4],
          [118, 58, 1],
          [212, 26, 1.2],
          [372, 30, 1],
          [452, 92, 1.1],
          [30, 86, 1],
        ].map(([x, y, r]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={r} opacity={0.85} />
        ))}
      </g>
      <path d="M0,232 C60,200 120,214 170,206 C230,196 300,214 360,204 C410,196 450,210 480,204 L480,262 L0,262 Z" fill={AFTER.hills} />
      <rect y={250} width={W} height={H - 250} fill={`url(#${ids.lawnA})`} />
      <g fill="#ffffff" opacity={0.05}>
        <polygon points="0,262 60,262 0,310" />
        <polygon points="110,262 190,262 40,340 0,340 0,330" />
        <polygon points="300,262 380,262 480,330 480,340 440,340" />
      </g>
      <House p={AFTER} ids={ids} after />
      {/* warm wash on the facade */}
      <ellipse cx={240} cy={214} rx={92} ry={50} fill={`url(#${ids.glow})`} opacity={0.55} />
      {/* sconces */}
      {[206, 274].map((x) => (
        <g key={x}>
          <circle cx={x} cy={200} r={20} fill={`url(#${ids.glow})`} />
          <rect x={x - 3.5} y={192} width={7} height={13} rx={1.5} fill="#1c1f21" />
          <rect x={x - 2} y={195} width={4} height={7} fill="#ffd894" />
        </g>
      ))}
      {/* mulch beds */}
      <path d="M100,247 L212,247 L212,262 Q160,284 100,270 Z" fill="#4a3428" />
      <path d="M268,247 L380,247 L380,270 Q320,284 268,262 Z" fill="#4a3428" />
      {/* boxwoods */}
      {[118, 140, 340, 362].map((x) => (
        <g key={x}>
          <circle cx={x} cy={252} r={11} fill="#335c33" />
          <circle cx={x - 3} cy={249} r={6} fill="#457a41" />
        </g>
      ))}
      {/* hydrangeas */}
      {[176, 304].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={254} rx={18} ry={11} fill="#3f6a3a" />
          {[-10, -3, 4, 11, -6, 7].map((dx, i) => (
            <circle key={dx} cx={x + dx} cy={i < 4 ? 249 : 255} r={4.2} fill="#f3eee2" />
          ))}
        </g>
      ))}
      {/* flagstone walk */}
      <path d="M222,258 C226,288 194,302 186,340 L294,340 C286,304 254,288 258,258 Z" fill="#7d7466" />
      <g clipPath={`url(#${ids.pathClip})`}>
        {[
          [214, 260, 30, 14],
          [246, 260, 16, 14],
          [206, 276, 26, 16],
          [234, 276, 32, 16],
          [196, 294, 38, 18],
          [236, 294, 30, 18],
          [268, 294, 20, 18],
          [186, 314, 30, 26],
          [218, 314, 40, 26],
          [260, 314, 40, 26],
        ].map(([x, y, w, h]) => (
          <rect key={`${x}-${y}`} x={x + 1.5} y={y + 1.5} width={w - 3} height={h - 3} rx={4} fill="#b9ad98" />
        ))}
      </g>
      <path d="M222,258 C226,288 194,302 186,340 M258,258 C254,288 286,304 294,340" fill="none" stroke="#2d2f30" strokeWidth={2} />
      {/* lavender along the walk */}
      {[
        [196, 286],
        [184, 306],
        [176, 328],
        [284, 286],
        [298, 306],
        [306, 328],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <ellipse cx={x} cy={y + 4} rx={9} ry={5} fill="#4f6d45" />
          {[-5, -1.5, 2, 5.5].map((dx) => (
            <ellipse key={dx} cx={x + dx} cy={y - 1} rx={1.6} ry={4.5} fill="#8f7cc6" />
          ))}
        </g>
      ))}
      {/* path lights */}
      {[
        [204, 296],
        [278, 296],
        [190, 324],
        [292, 324],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <ellipse cx={x} cy={y + 8} rx={18} ry={7} fill={`url(#${ids.glow})`} />
          <rect x={x - 1} y={y - 6} width={2} height={14} fill="#1c1f21" />
          <rect x={x - 3.5} y={y - 9} width={7} height={4} rx={1} fill="#ffd894" />
        </g>
      ))}
      {/* Japanese maple */}
      <path d="M58,300 C60,280 56,262 48,248 M58,282 C66,270 74,262 84,258" stroke="#3a2a22" strokeWidth={4} fill="none" strokeLinecap="round" />
      <g>
        <ellipse cx={44} cy={240} rx={30} ry={18} fill="#8f3329" />
        <ellipse cx={80} cy={248} rx={26} ry={15} fill="#a23d30" />
        <ellipse cx={62} cy={228} rx={26} ry={15} fill="#b44c3a" />
        <ellipse cx={54} cy={246} rx={16} ry={8} fill="#7e2b23" opacity={0.6} />
      </g>
      <ellipse cx={60} cy={302} rx={30} ry={5} fill="#000" opacity={0.18} />
      {/* ornamental grass */}
      <g stroke="#d8c08a" strokeWidth={1.6} fill="none" strokeLinecap="round">
        {[-14, -8, -3, 2, 7, 12].map((dx) => (
          <path key={dx} d={`M420,300 Q${420 + dx * 0.6},282 ${420 + dx * 1.6},266`} />
        ))}
      </g>
      <ellipse cx={420} cy={301} rx={14} ry={3} fill="#000" opacity={0.15} />
    </g>
  );
}

export function HeroIllustration({ className }: { className?: string }) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids: Ids = {
    skyB: `${raw}-skyb`,
    skyA: `${raw}-skya`,
    lawnA: `${raw}-lawna`,
    roofClip: `${raw}-roof`,
    pathClip: `${raw}-path`,
    glow: `${raw}-glow`,
    windowGlow: `${raw}-wglow`,
    afterClip: `${raw}-after`,
  };
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const reduced = usePrefersReducedMotion();

  // One gentle sweep to show it's interactive.
  useEffect(() => {
    if (reduced) return;
    const keys = [
      [0, 50],
      [700, 50],
      [1500, 24],
      [2500, 76],
      [3300, 52],
    ];
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (touched.current) return;
      const t = now - start;
      if (t >= keys[keys.length - 1][0]) {
        setPos(keys[keys.length - 1][1]);
        return;
      }
      let i = 0;
      while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
      const [t0, v0] = keys[i];
      const [t1, v1] = keys[i + 1];
      const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      setPos(v0 + (v1 - v0) * ease);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const fromPointer = (e: ReactPointerEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    setPos(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };

  const clipX = (pos / 100) * W;

  return (
    <figure className={cn('relative', className)}>
      <div
        ref={boxRef}
        className={cn(
          'relative aspect-[480/340] w-full select-none overflow-hidden rounded-3xl border border-line shadow-panel',
          dragging ? 'cursor-grabbing' : 'cursor-ew-resize',
        )}
        style={{ touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          touched.current = true;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging && fromPointer(e)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" aria-hidden>
          <defs>
            <linearGradient id={ids.skyB} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={BEFORE.skyTop} />
              <stop offset="1" stopColor={BEFORE.skyBottom} />
            </linearGradient>
            <linearGradient id={ids.skyA} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={AFTER.skyTop} />
              <stop offset="0.6" stopColor="#6c5a78" />
              <stop offset="1" stopColor={AFTER.skyBottom} />
            </linearGradient>
            <linearGradient id={ids.lawnA} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4f7a40" />
              <stop offset="1" stopColor="#355c2d" />
            </linearGradient>
            <radialGradient id={ids.glow}>
              <stop offset="0" stopColor="#ffd894" stopOpacity="0.95" />
              <stop offset="0.45" stopColor="#ffc777" stopOpacity="0.35" />
              <stop offset="1" stopColor="#ffc777" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={ids.windowGlow} cx="0.5" cy="0.6" r="0.7">
              <stop offset="0" stopColor="#fff1cf" stopOpacity="0.9" />
              <stop offset="1" stopColor="#f2a65a" stopOpacity="0.35" />
            </radialGradient>
            <clipPath id={ids.roofClip}>
              <polygon points="96,156 166,84 314,84 384,156" />
            </clipPath>
            <clipPath id={ids.pathClip}>
              <path d="M222,258 C226,288 194,302 186,340 L294,340 C286,304 254,288 258,258 Z" />
            </clipPath>
            <clipPath id={ids.afterClip}>
              <rect x={clipX} y={0} width={Math.max(0, W - clipX)} height={H} />
            </clipPath>
          </defs>
          <Before ids={ids} />
          <g clipPath={`url(#${ids.afterClip})`}>
            <After ids={ids} />
          </g>
        </svg>

        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
          Before
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
          After
        </span>

        {/* divider */}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_0_1px_rgb(0_0_0/0.15)]" style={{ left: `${pos}%` }} />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Compare before and after"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={`${Math.round(100 - pos)}% redesigned`}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 4;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setPos((p) => Math.max(0, p - step));
            else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setPos((p) => Math.min(100, p + step));
            else if (e.key === 'Home') setPos(0);
            else if (e.key === 'End') setPos(100);
            else return;
            touched.current = true;
            e.preventDefault();
          }}
          className="absolute top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg ring-1 ring-black/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{ left: `${pos}%` }}
        >
          <ChevronLeft className="-mr-1 size-4" aria-hidden />
          <ChevronRight className="-ml-1 size-4" aria-hidden />
        </div>
      </div>
      <figcaption className="mt-2.5 text-center text-xs text-subtle">
        Drag to compare — paint, a flagstone walk, planting beds and evening lighting.
      </figcaption>
    </figure>
  );
}
