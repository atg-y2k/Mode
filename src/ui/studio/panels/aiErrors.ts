/**
 * Human messages for AI / server failures in the Studio panels, and whether
 * AI features are usable right now. Pure (no DOM) so it is unit-tested.
 */
import type { HealthResponse } from '../../../../shared/api';
import { ApiError, isAbortError } from '../../../lib/api';

export type AiAvailability =
  /** /api/health hasn't answered yet: let the user try (the call reports its own error). */
  | { state: 'unknown' }
  | { state: 'ready' }
  | { state: 'offline'; reason: string }
  | { state: 'off'; reason: string };

/** Claude is off: neutral, no setup details (those live in Settings → AI & server, "How to add a Claude key"). */
export const AI_OFF_REASON = 'This needs Claude, which is off. A Claude key is optional — everything else in Mode works without one.';
export const SERVER_OFFLINE_REASON = "Can't reach the Mode server. Make sure it's running (npm run dev starts it with the app).";
/** Claude is off and this browser can't run the on-device map either. */
export const NO_DEVICE_MAP_REASON =
  "This browser can't map photos on this device. Outline the areas to change with the lasso on the photo instead — or add a Claude key (optional) to map them for you.";

export function aiAvailability(health: HealthResponse | null | undefined): AiAvailability {
  if (!health) return { state: 'unknown' };
  if (!health.ok) return { state: 'offline', reason: SERVER_OFFLINE_REASON };
  if (!health.ai.enabled) return { state: 'off', reason: AI_OFF_REASON };
  return { state: 'ready' };
}

/** True when an AI action may be attempted (ready, or health still loading). */
export function aiUsable(a: AiAvailability): boolean {
  return a.state === 'ready' || a.state === 'unknown';
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * A friendly, actionable message for an error from an AI call; null when the
 * user cancelled (nothing to report). `what` names the action, e.g.
 * "get suggestions", and is used where the message needs context.
 */
export function friendlyAiError(err: unknown, what = 'finish this'): string | null {
  if (isAbortError(err)) return null;
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'ai_disabled':
        return AI_OFF_REASON;
      case 'image_provider_disabled':
        return 'Photoreal images straight from Mode need an OpenAI or Gemini key (optional). Without one, hand the edit off to your ChatGPT or Gemini app.';
      case 'refused':
        return `The AI declined to ${what}. Try rephrasing your request or using a different photo.`;
      case 'rate_limited':
        return 'Too many AI requests in a short time. Wait a minute, then try again.';
      case 'upstream_error':
        return `The AI service had a problem and couldn't ${what}. Please try again in a moment.`;
      case 'payload_too_large':
        return 'That image is too large to send. Try a smaller photo.';
      case 'network':
        return sentence(err.message) || SERVER_OFFLINE_REASON;
      case 'bad_request':
      case 'internal':
      default:
        return sentence(err.message) || `Couldn't ${what}. Please try again.`;
    }
  }
  if (err instanceof Error) return sentence(err.message) || `Couldn't ${what}. Please try again.`;
  if (typeof err === 'string' && err.trim()) return sentence(err);
  return `Couldn't ${what}. Please try again.`;
}

/** "45 s", "1 min 05 s". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, '0')} s`;
}
