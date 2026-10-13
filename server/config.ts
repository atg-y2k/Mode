/**
 * Server configuration, read once from the environment (see .env.example).
 *
 * Everything is optional: with no keys the server still serves the app and
 * answers /api/health with AI disabled, so the rest of Mode works offline.
 */
import { resolve } from 'node:path';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_PORT = 8787;
export const DEFAULT_RATE_LIMIT_PER_10MIN = 60;

export type ImageProviderName = 'openai';

export interface ServerConfig {
  /** True when Claude features are available (ANTHROPIC_API_KEY set, or MODE_AI=on). */
  aiEnabled: boolean;
  /** Explicit API key; null lets the SDK resolve other credentials (MODE_AI=on). */
  anthropicApiKey: string | null;
  claudeModel: string;

  /** Configured *and* usable image provider, or null. */
  imageProvider: ImageProviderName | null;
  openaiApiKey: string | null;
  openaiImageModel: string;
  openaiBaseUrl: string;

  /** When set, every /api request except /api/health must send header `x-mode-token`. */
  accessToken: string | null;
  /** Max AI calls per client IP per 10 minutes; 0 disables the limit. */
  rateLimitPer10Min: number;
  /** Use X-Forwarded-For / X-Real-IP for the client IP (only behind a trusted reverse proxy). */
  trustProxy: boolean;

  port: number;
  /** Interface to listen on; null = all interfaces (reachable from phones on the LAN). */
  host: string | null;
  production: boolean;
  /** Absolute directory with the built web app to serve (production), or null. */
  staticDir: string | null;

  /** Human-readable configuration problems, printed at startup. */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

function bool(env: Env, key: string): boolean | null {
  const v = str(env, key)?.toLowerCase();
  if (v == null) return null;
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  return null;
}

function int(env: Env, key: string, fallback: number, warnings: string[], min = 0): number {
  const raw = str(env, key);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    warnings.push(`${key}="${raw}" is not a valid whole number ≥ ${min}; using ${fallback}.`);
    return fallback;
  }
  return n;
}

export function loadConfig(env: Env = process.env, cwd: string = process.cwd()): ServerConfig {
  const warnings: string[] = [];

  const anthropicApiKey = str(env, 'ANTHROPIC_API_KEY');
  const modeAi = bool(env, 'MODE_AI');
  if (str(env, 'MODE_AI') != null && modeAi == null) {
    warnings.push(`MODE_AI="${env.MODE_AI}" is not recognised; use "on" or "off".`);
  }
  // MODE_AI=off force-disables AI; MODE_AI=on enables it without an explicit key
  // (the SDK then uses ANTHROPIC_AUTH_TOKEN or a profile from `ant auth login`).
  const aiEnabled = modeAi === false ? false : anthropicApiKey != null || modeAi === true;

  const providerRaw = str(env, 'IMAGE_PROVIDER')?.toLowerCase() ?? null;
  const openaiApiKey = str(env, 'OPENAI_API_KEY');
  let imageProvider: ImageProviderName | null = null;
  if (providerRaw === 'openai') {
    if (openaiApiKey) imageProvider = 'openai';
    else warnings.push('IMAGE_PROVIDER=openai but OPENAI_API_KEY is not set; photoreal renders are disabled.');
  } else if (providerRaw != null && providerRaw !== 'none' && providerRaw !== 'off') {
    warnings.push(`IMAGE_PROVIDER="${providerRaw}" is not supported (supported: openai); photoreal renders are disabled.`);
  }

  const baseUrl = (str(env, 'OPENAI_BASE_URL') ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  const production = env.NODE_ENV === 'production';
  const portRaw = str(env, 'PORT') != null ? 'PORT' : 'API_PORT';
  const port = int(env, portRaw, DEFAULT_PORT, warnings, 1);

  return {
    aiEnabled,
    anthropicApiKey,
    claudeModel: str(env, 'CLAUDE_MODEL') ?? DEFAULT_CLAUDE_MODEL,
    imageProvider,
    openaiApiKey,
    openaiImageModel: str(env, 'OPENAI_IMAGE_MODEL') ?? DEFAULT_OPENAI_IMAGE_MODEL,
    openaiBaseUrl: baseUrl,
    accessToken: str(env, 'MODE_ACCESS_TOKEN'),
    rateLimitPer10Min: int(env, 'RATE_LIMIT_PER_10MIN', DEFAULT_RATE_LIMIT_PER_10MIN, warnings),
    trustProxy: bool(env, 'TRUST_PROXY') === true,
    port,
    host: str(env, 'HOST'),
    production,
    staticDir: production ? resolve(cwd, str(env, 'STATIC_DIR') ?? 'dist') : null,
    warnings,
  };
}

/** A config with every feature off — handy as a base in tests. */
export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    aiEnabled: false,
    anthropicApiKey: null,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    imageProvider: null,
    openaiApiKey: null,
    openaiImageModel: DEFAULT_OPENAI_IMAGE_MODEL,
    openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
    accessToken: null,
    rateLimitPer10Min: DEFAULT_RATE_LIMIT_PER_10MIN,
    trustProxy: false,
    port: DEFAULT_PORT,
    host: null,
    production: false,
    staticDir: null,
    warnings: [],
    ...overrides,
  };
}
