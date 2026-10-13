/** Mode mark (house tile, half "redesigned") + optional wordmark; themed via tokens. */
import { cn } from '../common';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('shrink-0', className ?? 'size-8')} aria-hidden>
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path d="M14 34 32 18l18 16v14a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2z" fill="var(--accent-fg)" />
      <path d="M32 18 50 34v14a2 2 0 0 1-2 2H32z" fill="var(--gold)" />
      <rect x="27" y="38" width="10" height="12" rx="1.5" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      {!compact && <span className="font-display text-xl leading-none tracking-tight text-text">Mode</span>}
    </span>
  );
}
