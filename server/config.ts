/**
 * Server configuration, read once from the environment (see .env.example).
 *
 * Everything is optional: with no keys the server still serves the app and
 * answers /api/health with AI disabled, so the rest of Mode works offline.
 */
import { resolve } from 'node:path';
import type { ImageProviderId } from '../shared/api';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
/** gpt-image-1 shuts down 2026-10-23; GPT Image 2.5 Flare is the everyday editing model. */
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
export const DEFAULT_PORT = 8787;
export const DEFAULT_RATE_LIMIT_PER_10MIN = 60;

/** Providers implemented by server/imageProvider.ts (used by /api/render and photo assets). */
export type ImageProviderName = 'openai';

export interface ConfiguredImageProvider {
  id: ImageProviderId;
  model: string;
  isDefault: boolean;
}

export const IMAGE_PROVIDER_LABELS: Record<ImageProviderId, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
};

export interface ServerConfig {
  /** True when Claude features are available (ANTHROPIC_API_KEY set, or MODE_AI=on). */
  aiEnabled: boolean;
  /** Explicit API key; null lets the SDK resolve other credentials (MODE_AI=on). */
  anthropicApiKey: string | null;
  claudeModel: string;

  /**
   * Provider for /api/render and photo-style /api/generate-asset (needs OpenAI:
   * transparent backgrounds), or null.
   */
  imageProvider: ImageProviderName | null;
  /** Every image provider that has an API key (Studio lets the user pick); the default is flagged. */
  imageProviders: ConfiguredImageProvider[];
  openaiApiKey: string | null;
  openaiImageModel: string;
  openaiBaseUrl: string;
  geminiApiKey: string | null;
  geminiImageModel: string;

  /** When set, every /api request except /api/health must send header `x-mode-token`. */
  accessToken: string | null;
  /** Max AI calls per client IP per 10 minutes; 0 disables the limit. */
  rateLimitPer10Min: number;
  /** Use X-Forwarded-For / X-Real-IP for the client IP (only behind a trusted reverse proxy). */
  trustProxy: boolean;
  /**
   * Extra host names the server answers to (MODE_ALLOWED_HOSTS), besides IP
   * addresses, localhost, this computer's name and HOST. Vite semantics: a
   * leading '.' allows the domain and all its subdomains. `true` turns the
   * Host check (the DNS-rebinding guard) off.
   */
  allowedHosts: string[] | true;

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

/**
 * One MODE_ALLOWED_HOSTS entry as a bare lower-case host name: no scheme, port,
 * IPv6 brackets or trailing dot (a leading '.' — "this domain and its
 * subdomains" — is kept). '' when nothing usable is left.
 */
export function normalizeHostEntry(raw: string): string {
  let v = raw.trim().toLowerCase();
  if (v.includes('://')) {
    try {
      v = new URL(v).hostname;
    } catch {
      return '';
    }
  }
  v = v.replace(/\/.*$/, '');
  if (v.startsWith('[')) v = v.slice(1, v.indexOf(']') > 0 ? v.indexOf(']') : undefined);
  else if ((v.match(/:/g) ?? []).length === 1) v = v.slice(0, v.indexOf(':'));
  return v.replace(/\.+$/, '');
}

function allowedHostsFrom(env: Env, warnings: string[]): string[] | true {
  const raw = str(env, 'MODE_ALLOWED_HOSTS');
  if (raw == null) return [];
  const entries = raw.split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.some((e) => e === '*' || e.toLowerCase() === 'true')) {
    warnings.push(
      'MODE_ALLOWED_HOSTS turns the host-name check off: a web page you visit can then reach this server through DNS rebinding and use your API keys. Use it only behind a reverse proxy that checks the host name itself, or list the names instead.',
    );
    return true;
  }
  const hosts = entries.map(normalizeHostEntry).filter((h) => h && h !== '.');
  return [...new Set(hosts)];
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

  // Image providers: each one is available when its key is set; IMAGE_PROVIDER
  // picks the default ("none" / "off" disables image generation entirely).
  const providerRaw = str(env, 'IMAGE_PROVIDER')?.toLowerCase() ?? null;
  const imagesOff = providerRaw === 'none' || providerRaw === 'off';
  const openaiApiKey = str(env, 'OPENAI_API_KEY');
  // GOOGLE_API_KEY is Google's own name for the same key (the Studio providers accept it too).
  const geminiApiKey = str(env, 'GEMINI_API_KEY') ?? str(env, 'GOOGLE_API_KEY');
  const openaiImageModel = str(env, 'OPENAI_IMAGE_MODEL') ?? DEFAULT_OPENAI_IMAGE_MODEL;
  const geminiImageModel = str(env, 'GEMINI_IMAGE_MODEL') ?? DEFAULT_GEMINI_IMAGE_MODEL;
  const available: { id: ImageProviderId; model: string }[] = [];
  if (!imagesOff && openaiApiKey) available.push({ id: 'openai', model: openaiImageModel });
  if (!imagesOff && geminiApiKey) available.push({ id: 'gemini', model: geminiImageModel });
  let defaultId: ImageProviderId | null = available[0]?.id ?? null;
  if (providerRaw === 'openai' || providerRaw === 'gemini') {
    if (available.some((p) => p.id === providerRaw)) defaultId = providerRaw;
    else {
      const key = providerRaw === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
      warnings.push(
        `IMAGE_PROVIDER=${providerRaw} but ${key} is not set; ${defaultId ? `using ${defaultId} instead` : 'image generation is disabled'}.`,
      );
    }
  } else if (providerRaw != null && !imagesOff) {
    warnings.push(`IMAGE_PROVIDER="${providerRaw}" is not supported (use openai, gemini or none).`);
  }
  const imageProviders = available.map((p) => ({ ...p, isDefault: p.id === defaultId }));
  const imageProvider: ImageProviderName | null = available.some((p) => p.id === 'openai') ? 'openai' : null;

  const baseUrl = (str(env, 'OPENAI_BASE_URL') ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  const production = env.NODE_ENV === 'production';
  const portRaw = str(env, 'PORT') != null ? 'PORT' : 'API_PORT';
  const port = int(env, portRaw, DEFAULT_PORT, warnings, 1);

  return {
    aiEnabled,
    anthropicApiKey,
    claudeModel: str(env, 'CLAUDE_MODEL') ?? DEFAULT_CLAUDE_MODEL,
    imageProvider,
    imageProviders,
    openaiApiKey,
    openaiImageModel,
    openaiBaseUrl: baseUrl,
    geminiApiKey,
    geminiImageModel,
    accessToken: str(env, 'MODE_ACCESS_TOKEN'),
    rateLimitPer10Min: int(env, 'RATE_LIMIT_PER_10MIN', DEFAULT_RATE_LIMIT_PER_10MIN, warnings),
    trustProxy: bool(env, 'TRUST_PROXY') === true,
    allowedHosts: allowedHostsFrom(env, warnings),
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
    imageProviders: [],
    openaiApiKey: null,
    openaiImageModel: DEFAULT_OPENAI_IMAGE_MODEL,
    openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
    geminiApiKey: null,
    geminiImageModel: DEFAULT_GEMINI_IMAGE_MODEL,
    accessToken: null,
    rateLimitPer10Min: DEFAULT_RATE_LIMIT_PER_10MIN,
    trustProxy: false,
    allowedHosts: [],
    port: DEFAULT_PORT,
    host: null,
    production: false,
    staticDir: null,
    warnings: [],
    ...overrides,
  };
}
