/**
 * AI availability, derived from /api/health: a compact pill for headers and a
 * one-line explanation for empty states. Clicking the pill opens Settings →
 * AI & server. Only the thinking (plans, suggestions, climate, architecture
 * notes) needs Claude: photoreal variations work by hand-off to the user's
 * ChatGPT or Gemini app (SPEC 5) and scenes can be mapped on this device.
 */
import type { HealthResponse } from '../../../shared/api';
import { useStore } from '../../state/store';
import { visionUnsupportedReason } from '../../vision';
import { cn } from '../common';
import { openSettings } from './shellUI';

export type AiLevel = 'checking' | 'offline' | 'off' | 'planning-only' | 'ready';

export function aiLevel(health: HealthResponse | null): AiLevel {
  if (!health) return 'checking';
  if (!health.ok) return 'offline';
  if (!health.ai.enabled) return 'off';
  return imageProvidersOf(health).length ? 'ready' : 'planning-only';
}

/** Configured image providers (falls back to the legacy single-provider field). */
export function imageProvidersOf(health: HealthResponse | null): { id: string; name: string; model: string; isDefault: boolean }[] {
  if (!health) return [];
  if (health.imageProviders?.length) return health.imageProviders;
  if (health.imageProvider.enabled) {
    return [
      {
        id: (health.imageProvider.name ?? 'openai').toLowerCase().includes('gemini') ? 'gemini' : 'openai',
        name: health.imageProvider.name ?? 'Image provider',
        model: health.imageProvider.model ?? '',
        isDefault: true,
      },
    ];
  }
  return [];
}

const LABELS: Record<AiLevel, string> = {
  checking: 'Checking AI…',
  offline: 'Server offline',
  off: 'No AI key · hand-off',
  'planning-only': 'AI ready · hand-off',
  ready: 'AI ready',
};

/** `onDeviceVision`: this browser can map scenes itself (default: detected). */
export function aiSummary(level: AiLevel, onDeviceVision = visionUnsupportedReason() === null): string {
  switch (level) {
    case 'checking':
      return 'Checking which AI features this server offers…';
    case 'offline':
      return "Can't reach the Mode server. Projects and hand tools still work; AI features need the server.";
    case 'off':
      return `No AI key: Mode writes each instruction from your choices; photoreal images come from your ChatGPT or Gemini app by hand-off, and ${
        onDeviceVision ? 'scenes map on this device' : 'you outline areas with the lasso'
      }. A Claude key (optional) adds tailored plans and suggestions.`;
    case 'planning-only':
      return 'Claude plans and maps scenes. Photoreal variations work by hand-off to your ChatGPT or Gemini app; add an OpenAI or Gemini key to render them in Mode instead.';
    case 'ready':
      return 'Scene mapping, suggestions and photoreal variations are available.';
  }
}

export function AiStatusPill({ className }: { className?: string }) {
  const health = useStore((s) => s.health);
  const level = aiLevel(health);
  // Hand-off rendering (planning-only) is the default setup, not a degraded one.
  const dot = level === 'ready' || level === 'planning-only' ? 'bg-success' : level === 'checking' ? 'bg-line-strong animate-pulse' : 'bg-subtle';
  return (
    <button
      type="button"
      onClick={() => openSettings('server')}
      title={aiSummary(level)}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-3 text-xs font-medium text-muted transition-colors',
        'hover:border-line-strong hover:text-text focus-visible:outline-2 focus-visible:outline-accent',
        className,
      )}
    >
      <span className={cn('size-2 rounded-full', dot)} aria-hidden />
      {LABELS[level]}
    </button>
  );
}
