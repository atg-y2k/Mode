import { describe, expect, it } from 'vitest';
import type { HealthResponse } from '../../../../shared/api';
import { effectiveRenderMode, variationCountOf } from './prefs';

const health = (providers: number): HealthResponse => ({
  ok: true,
  ai: { enabled: false, model: null },
  imageProvider: { enabled: providers > 0, name: providers ? 'OpenAI' : null, model: providers ? 'gpt-image' : null },
  imageProviders: Array.from({ length: providers }, (_, i) => ({ id: i ? 'gemini' : 'openai', name: i ? 'Gemini' : 'OpenAI', model: 'm', isDefault: i === 0 })),
});

describe('render mode and variation count', () => {
  it('API mode falls back to hand-off while the server has no image provider', () => {
    expect(effectiveRenderMode({ renderMode: 'api' }, health(0))).toBe('handoff');
    expect(effectiveRenderMode({ renderMode: 'api' }, health(1))).toBe('api');
    expect(effectiveRenderMode({ renderMode: 'handoff' }, health(1))).toBe('handoff');
  });

  it('counts 1 per hand-off and 3 with an image API until the user picks a count', () => {
    expect(variationCountOf({ variationCount: null, renderMode: 'handoff' }, health(1))).toBe(1);
    expect(variationCountOf({ variationCount: null, renderMode: 'api' }, health(1))).toBe(3);
    // API chosen earlier, but no key on this server: hand-off, one at a time.
    expect(variationCountOf({ variationCount: null, renderMode: 'api' }, health(0))).toBe(1);
    // The run's own render mode wins (a run started in API mode explicitly).
    expect(variationCountOf({ variationCount: null, renderMode: 'handoff' }, health(1), 'api')).toBe(3);
    // A picked count stays, whatever the mode.
    expect(variationCountOf({ variationCount: 2, renderMode: 'api' }, health(1))).toBe(2);
    expect(variationCountOf({ variationCount: 4, renderMode: 'handoff' }, health(0))).toBe(4);
  });
});
