import { describe, expect, it } from 'vitest';
import { DEFAULT_CLAUDE_MODEL, loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults: everything off, port 8787, 60 AI calls per 10 min', () => {
    const c = loadConfig({}, '/app');
    expect(c).toMatchObject({
      aiEnabled: false,
      claudeModel: DEFAULT_CLAUDE_MODEL,
      imageProvider: null,
      openaiImageModel: 'gpt-image-1',
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
      { id: 'openai', model: 'gpt-image-1', isDefault: false },
      { id: 'gemini', model: 'gemini-2.5-flash-image', isDefault: true },
    ]);
    expect(both.imageProvider).toBe('openai'); // render / photo assets use OpenAI
    const geminiOnly = loadConfig({ GEMINI_API_KEY: 'g', GEMINI_IMAGE_MODEL: 'gemini-x' });
    expect(geminiOnly.imageProviders).toEqual([{ id: 'gemini', model: 'gemini-x', isDefault: true }]);
    expect(geminiOnly.imageProvider).toBeNull();
    const fallback = loadConfig({ GEMINI_API_KEY: 'g', IMAGE_PROVIDER: 'openai' });
    expect(fallback.imageProviders[0]).toMatchObject({ id: 'gemini', isDefault: true });
    expect(fallback.warnings.join(' ')).toMatch(/using gemini instead/);
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
});
