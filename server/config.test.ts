import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiEnv, apiSettingsFrom } from '../vite.config';
import { DEFAULT_CLAUDE_MODEL, loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults: everything off, port 8787, 60 AI calls per 10 min', () => {
    const c = loadConfig({}, '/app');
    expect(c).toMatchObject({
      aiEnabled: false,
      claudeModel: DEFAULT_CLAUDE_MODEL,
      imageProvider: null,
      openaiImageModel: 'gpt-image-2.5-flare',
      openaiBaseUrl: 'https://api.openai.com/v1',
      accessToken: null,
      rateLimitPer10Min: 60,
      port: 8787,
      production: false,
      staticDir: null,
      warnings: [],
    });
  });

  it('enables AI with a key or MODE_AI=on, and MODE_AI=off wins', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-x' }).aiEnabled).toBe(true);
    expect(loadConfig({ MODE_AI: 'on' }).aiEnabled).toBe(true);
    expect(loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-x', MODE_AI: 'off' }).aiEnabled).toBe(false);
    expect(loadConfig({ ANTHROPIC_API_KEY: '   ' }).aiEnabled).toBe(false);
  });

  it('reads the model, provider, token and limits', () => {
    const c = loadConfig({
      CLAUDE_MODEL: 'claude-sonnet-5-5',
      IMAGE_PROVIDER: 'OpenAI',
      OPENAI_API_KEY: 'sk-o',
      OPENAI_BASE_URL: 'https://gateway.test/v1/',
      OPENAI_IMAGE_MODEL: 'gpt-image-1-mini',
      MODE_ACCESS_TOKEN: 'secret',
      RATE_LIMIT_PER_10MIN: '5',
      TRUST_PROXY: 'true',
    });
    expect(c).toMatchObject({
      claudeModel: 'claude-sonnet-5-5',
      imageProvider: 'openai',
      openaiBaseUrl: 'https://gateway.test/v1',
      openaiImageModel: 'gpt-image-1-mini',
      accessToken: 'secret',
      rateLimitPer10Min: 5,
      trustProxy: true,
    });
  });

  it('warns about unusable settings instead of crashing', () => {
    const c = loadConfig({ IMAGE_PROVIDER: 'openai', RATE_LIMIT_PER_10MIN: 'lots', IMAGE_PROVIDER_X: '1' });
    expect(c.imageProvider).toBeNull();
    expect(c.rateLimitPer10Min).toBe(60);
    expect(c.warnings.join(' ')).toMatch(/OPENAI_API_KEY/);
    expect(c.warnings.join(' ')).toMatch(/RATE_LIMIT_PER_10MIN/);
  });

  it('lists every image provider with a key and flags the default', () => {
    expect(loadConfig({}).imageProviders).toEqual([]);
    const both = loadConfig({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', IMAGE_PROVIDER: 'gemini' });
    expect(both.imageProviders).toEqual([
      { id: 'openai', model: 'gpt-image-2.5-flare', isDefault: false },
      { id: 'gemini', model: 'gemini-2.5-flash-image', isDefault: true },
    ]);
    expect(both.imageProvider).toBe('openai'); // render / photo assets use OpenAI
    const geminiOnly = loadConfig({ GEMINI_API_KEY: 'g', GEMINI_IMAGE_MODEL: 'gemini-x' });
    expect(geminiOnly.imageProviders).toEqual([{ id: 'gemini', model: 'gemini-x', isDefault: true }]);
    expect(geminiOnly.imageProvider).toBeNull();
    const fallback = loadConfig({ GEMINI_API_KEY: 'g', IMAGE_PROVIDER: 'openai' });
    expect(fallback.imageProviders[0]).toMatchObject({ id: 'gemini', isDefault: true });
    expect(fallback.warnings.join(' ')).toMatch(/using gemini instead/);
    // GOOGLE_API_KEY is accepted for Gemini, as by the Studio providers (GEMINI_API_KEY wins).
    const google = loadConfig({ GOOGLE_API_KEY: 'gk', IMAGE_PROVIDER: 'gemini' });
    expect(google.geminiApiKey).toBe('gk');
    expect(google.imageProviders).toEqual([{ id: 'gemini', model: 'gemini-2.5-flash-image', isDefault: true }]);
    expect(google.warnings).toEqual([]);
    expect(loadConfig({ GEMINI_API_KEY: 'g', GOOGLE_API_KEY: 'gk' }).geminiApiKey).toBe('g');
    const off = loadConfig({ OPENAI_API_KEY: 'o', IMAGE_PROVIDER: 'none' });
    expect(off.imageProviders).toEqual([]);
    expect(off.imageProvider).toBeNull();
    expect(off.warnings).toEqual([]);
  });

  it('uses PORT, then API_PORT, and serves dist in production', () => {
    expect(loadConfig({ API_PORT: '9000' }).port).toBe(9000);
    expect(loadConfig({ PORT: '8080', API_PORT: '9000' }).port).toBe(8080);
    const prod = loadConfig({ NODE_ENV: 'production' }, '/srv/mode');
    expect(prod.production).toBe(true);
    expect(prod.staticDir).toBe('/srv/mode/dist');
  });

  it("agrees with the Vite dev server's reading (its /api proxy port, the network warning, the hand-off guard)", () => {
    const envs: Record<string, string>[] = [
      {},
      { PORT: '8899' },
      { API_PORT: '8898' },
      { PORT: '8080', API_PORT: '9000' },
      { PORT: 'abc', API_PORT: '9000' },
      { PORT: ' ', API_PORT: '9001' },
      { PORT: '0' },
      { ANTHROPIC_API_KEY: 'x' },
      { ANTHROPIC_API_KEY: 'x', MODE_AI: 'off' },
      { ANTHROPIC_API_KEY: 'x', MODE_AI: 'maybe' },
      { MODE_AI: 'on' },
      { MODE_AI: 'YES' },
      { OPENAI_API_KEY: 'o' },
      { GOOGLE_API_KEY: 'g' },
      { GEMINI_API_KEY: ' ' },
      { OPENAI_API_KEY: 'o', IMAGE_PROVIDER: 'none' },
      { GEMINI_API_KEY: 'g', IMAGE_PROVIDER: 'OFF' },
      { OPENAI_API_KEY: 'o', IMAGE_PROVIDER: 'bogus' },
      { MODE_ACCESS_TOKEN: 't' },
      { MODE_ACCESS_TOKEN: '  ' },
    ];
    for (const env of envs) {
      const c = loadConfig(env);
      expect(apiSettingsFrom(env), JSON.stringify(env)).toEqual({
        port: c.port,
        paidFeatures: c.aiEnabled || c.imageProviders.length > 0,
        tokenSet: c.accessToken !== null,
      });
    }
  });

  it('the dev proxy reads only .env and the shell, like the API process (never .env.local)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mode-env-'));
    try {
      writeFileSync(join(dir, '.env.local'), 'PORT=8899\n');
      writeFileSync(join(dir, '.env.development'), 'PORT=8898\n');
      expect(apiSettingsFrom(apiEnv(dir, {})).port).toBe(8787);
      writeFileSync(join(dir, '.env'), '# keys\nPORT=8788\nANTHROPIC_API_KEY=\n');
      expect(apiSettingsFrom(apiEnv(dir, {}))).toEqual({ port: 8788, paidFeatures: false, tokenSet: false });
      // A variable exported in the shell wins over .env, as with --env-file.
      expect(apiSettingsFrom(apiEnv(dir, { PORT: '9000' })).port).toBe(9000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
