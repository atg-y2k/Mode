import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { DesignSuggestionSchema, SpaceAnalysisResultSchema } from '../shared/api';
import { createClaudeService, mapClaudeError, parseStructuredOutput } from './claude';
import { ApiHttpError } from './errors';
import { fakeClaude } from './testing';

describe('parseStructuredOutput', () => {
  it('returns null for non-JSON or mismatched output', () => {
    expect(parseStructuredOutput(SpaceAnalysisResultSchema, 'not json')).toBeNull();
    expect(parseStructuredOutput(SpaceAnalysisResultSchema, '{"summary": 1}')).toBeNull();
  });

  it('maps near-miss enum values to allowed ones', () => {
    const out = parseStructuredOutput(
      DesignSuggestionSchema.shape.palette,
      JSON.stringify([
        { role: 'trim', name: 'White', hex: '#fff', finish: 'Semi Gloss', brandMatch: null },
        { role: 'walls', name: 'Greige', hex: '#ccc', finish: 'velvet', brandMatch: null },
      ]),
    );
    expect(out?.map((p) => p.finish)).toEqual(['semi-gloss', 'eggshell']);
  });
});

describe('mapClaudeError', () => {
  it('maps SDK errors to API error codes', () => {
    const headers = new Headers({ 'retry-after': '12' });
    const rate = mapClaudeError(new Anthropic.RateLimitError(429, undefined, 'rate', headers), 'm') as ApiHttpError;
    expect(rate).toMatchObject({ code: 'rate_limited', status: 429, retryAfterSec: 12 });
    expect(mapClaudeError(new Anthropic.APIConnectionTimeoutError(), 'm')).toMatchObject({ code: 'upstream_error', status: 504 });
    expect(mapClaudeError(new Anthropic.APIUserAbortError(), 'm')).toMatchObject({ status: 499 });
    expect(mapClaudeError(new Anthropic.APIUserAbortError(), 'm', true)).toMatchObject({ status: 504 });
    expect(mapClaudeError(new Anthropic.NotFoundError(404, undefined, 'nf', new Headers()), 'claude-x')).toMatchObject({
      code: 'upstream_error',
      message: expect.stringContaining('claude-x'),
    });
    const bad = mapClaudeError(
      new Anthropic.BadRequestError(400, { error: { message: 'image exceeds 5 MB maximum' } }, '400', new Headers()),
      'm',
    ) as ApiHttpError;
    expect(bad.message).toContain('image exceeds 5 MB maximum');
    const plain = new Error('boom');
    expect(mapClaudeError(plain, 'm')).toBe(plain);
    const noCreds = new Error('Could not resolve authentication method. Expected one of apiKey, authToken…');
    expect(mapClaudeError(noCreds, 'm')).toMatchObject({ code: 'ai_disabled', status: 503 });
  });
});

describe('createClaudeService', () => {
  it('forwards the abort signal and never sends forbidden Opus 5.5 params', async () => {
    const claude = fakeClaude({ output: { prompt: 'x' } });
    const service = createClaudeService(claude, 'claude-opus-5-5');
    const controller = new AbortController();
    const { z } = await import('zod');
    await service.structured({
      task: 't',
      schema: z.object({ prompt: z.string() }),
      system: 'sys',
      text: 'hello',
      effort: 'low',
      signal: controller.signal,
    });
    const { params, options } = claude.calls[0];
    expect(options?.signal).toBe(controller.signal);
    for (const key of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice', 'tools']) {
      expect(params).not.toHaveProperty(key);
    }
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0].role).toBe('user');
  });
});
