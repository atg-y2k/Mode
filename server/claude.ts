/**
 * Claude access for the API routes: one structured-output call per request
 * (vision + JSON schema from shared/api.ts), with refusal handling and SDK
 * error mapping to ApiErrorBody codes.
 *
 * Model notes (Claude Opus 5.5): thinking is always on (adaptive) and is
 * steered only through `output_config.effort`; never send thinking
 * `{type:'disabled'}`, `budget_tokens`, sampling params, assistant prefill or
 * forced tool_choice.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { ServerConfig } from './config';
import type { ImageData64 } from './dataUrl';
import { ApiHttpError, cancelled, redact } from './errors';

export type Effort = 'low' | 'medium' | 'high';

type ParseParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** The subset of a parsed beta message the server reads. */
export interface ClaudeParsedMessage {
  stop_reason: string | null;
  parsed_output?: unknown;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null;
}

export interface ClaudeRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Structural type of the Anthropic client as used here. `new Anthropic()`
 * satisfies it; tests inject fakes (or a real client with a fake `fetch`).
 */
export interface ClaudeClientLike {
  beta: {
    messages: {
      parse(params: ParseParams, options?: ClaudeRequestOptions): PromiseLike<ClaudeParsedMessage>;
    };
  };
}

export interface StructuredCall<S extends z.ZodType> {
  /** Short label for logs, e.g. "analyze". */
  task: string;
  schema: S;
  /** Cached system prompt (stable across calls). */
  system: string;
  /** Images placed before the text, in order. */
  images?: ImageData64[];
  text: string;
  effort: Effort;
  /** Aborts the call (client disconnected or the route deadline passed). */
  signal?: AbortSignal;
  /** True when `signal` aborted because the route deadline passed. */
  timedOut?: () => boolean;
  /** Called with token usage once Claude answers (for the request log). */
  onUsage?: (entry: ClaudeUsage) => void;
}

export interface ClaudeService {
  readonly model: string;
  structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>>;
}

/** Upper bound for one attempt; the route deadline (signal) bounds the total. */
const ATTEMPT_TIMEOUT_MS = 240_000;

export function createAnthropicClient(config: ServerConfig): Anthropic {
  return new Anthropic({
    // undefined lets the SDK resolve ANTHROPIC_AUTH_TOKEN or a saved profile (MODE_AI=on).
    apiKey: config.anthropicApiKey ?? undefined,
    maxRetries: 2,
    timeout: ATTEMPT_TIMEOUT_MS,
  });
}

// ---------------------------------------------------------------------------
// Tolerant structured-output parsing
// ---------------------------------------------------------------------------

/** Preferred replacements when the model returns a value outside an enum. */
const ENUM_FALLBACKS = ['other', 'none', 'eggshell', 'day'];

function normalizeEnumGuess(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function pickEnumValue(received: unknown, options: readonly unknown[]): unknown {
  const strings = options.filter((o): o is string => typeof o === 'string');
  const guess = normalizeEnumGuess(received);
  if (guess) {
    const exact = strings.find((o) => o === guess);
    if (exact) return exact;
    // "semi gloss" -> "semi-gloss", "living" -> "living-room", "walls" -> "wall"
    const partial =
      guess.length >= 3 ? strings.find((o) => o.startsWith(guess) || (o.length >= 3 && guess.startsWith(o))) : undefined;
    if (partial) return partial;
  }
  for (const pref of ENUM_FALLBACKS) if (strings.includes(pref)) return pref;
  const other = strings.find((o) => o.startsWith('other'));
  return other ?? options[0];
}

function setAtPath(root: unknown, path: readonly PropertyKey[], value: unknown): boolean {
  if (path.length === 0) return false;
  let node: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<PropertyKey, unknown>)[path[i]];
  }
  if (typeof node !== 'object' || node === null) return false;
  (node as Record<PropertyKey, unknown>)[path[path.length - 1]] = value;
  return true;
}

function getAtPath(root: unknown, path: readonly PropertyKey[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

/**
 * Parses Claude's JSON against `schema`. The SDK's JSON-schema transform does
 * not enforce enums, so out-of-enum strings are mapped to the closest allowed
 * value instead of failing the whole response. Returns null when the output
 * still doesn't fit (the caller reports an upstream error).
 */
export function parseStructuredOutput<S extends z.ZodType>(schema: S, text: string): z.infer<S> | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  for (let pass = 0; pass < 3; pass++) {
    const result = schema.safeParse(data);
    if (result.success) return result.data;
    let repaired = false;
    for (const issue of result.error.issues) {
      if (issue.code === 'invalid_value' && Array.isArray(issue.values)) {
        const current = getAtPath(data, issue.path);
        repaired = setAtPath(data, issue.path, pickEnumValue(current, issue.values)) || repaired;
      }
    }
    if (!repaired) return null;
  }
  return null;
}

/**
 * betaZodOutputFormat(schema) with a tolerant `parse`: the stock parser throws
 * on non-JSON text (e.g. a refusal or a truncated answer) before the caller
 * can look at `stop_reason`.
 */
function structuredFormat<S extends z.ZodType>(schema: S) {
  const format = betaZodOutputFormat(schema);
  return { ...format, parse: (content: string): z.infer<S> | null => parseStructuredOutput(schema, content) };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function upstreamMessage(err: InstanceType<typeof Anthropic.APIError>): string | null {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const msg = body?.error?.message;
  return typeof msg === 'string' && msg.trim() ? redact(msg, 200) : null;
}

function retryAfterSeconds(headers: Headers | undefined): number | null {
  const raw = headers?.get('retry-after');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
}

/** Maps anything thrown by the SDK to an ApiHttpError (unknown errors are rethrown). */
export function mapClaudeError(err: unknown, model: string, timedOut = false): unknown {
  if (err instanceof ApiHttpError) return err;
  if (err instanceof Anthropic.APIUserAbortError) {
    return timedOut
      ? new ApiHttpError('upstream_error', 'Claude took too long to answer. Please try again.', 504)
      : cancelled();
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ApiHttpError('upstream_error', 'Claude took too long to answer. Please try again.', 504);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ApiHttpError(
      'upstream_error',
      "The server couldn't reach the Claude API. Check its internet connection and try again.",
      502,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ApiHttpError(
      'rate_limited',
      'Claude is handling too many requests for this API key right now. Wait a minute and try again.',
      429,
      { retryAfterSec: retryAfterSeconds(err.headers) ?? 60 },
    );
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new ApiHttpError(
      'upstream_error',
      "The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env and restart the server.",
      502,
    );
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new ApiHttpError(
      'upstream_error',
      `The server's Anthropic API key isn't allowed to use ${model}. Check the key's workspace or set CLAUDE_MODEL.`,
      502,
    );
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new ApiHttpError('upstream_error', `The model "${model}" isn't available. Check CLAUDE_MODEL in .env.`, 502);
  }
  if (err instanceof Anthropic.BadRequestError) {
    const detail = upstreamMessage(err);
    return new ApiHttpError('upstream_error', `Claude couldn't process this request${detail ? `: ${detail}` : '.'}`, 502);
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529 || err.status === 503) {
      return new ApiHttpError('upstream_error', 'Claude is temporarily overloaded. Please try again in a minute.', 503, {
        retryAfterSec: retryAfterSeconds(err.headers) ?? 30,
      });
    }
    return new ApiHttpError(
      'upstream_error',
      `The Claude API returned an error${err.status ? ` (HTTP ${err.status})` : ''}. Please try again.`,
      502,
    );
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Client-side SDK errors, e.g. no credentials could be resolved (MODE_AI=on without a key).
    return new ApiHttpError('upstream_error', `Claude request failed: ${redact(err.message, 200)}`, 502);
  }
  return err;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ClaudeUsage {
  task: string;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  ms: number;
}

export function createClaudeService(client: ClaudeClientLike, model: string): ClaudeService {
  return {
    model,
    async structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
      const started = Date.now();
      const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [
        ...(call.images ?? []).map(
          (img): Anthropic.Beta.Messages.BetaImageBlockParam => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mime, data: img.base64 },
          }),
        ),
        { type: 'text', text: call.text },
      ];

      let message: ClaudeParsedMessage;
      try {
        message = await client.beta.messages.parse(
          {
            model,
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { format: structuredFormat(call.schema), effort: call.effort },
            system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content }],
          },
          { signal: call.signal, timeout: ATTEMPT_TIMEOUT_MS },
        );
      } catch (err) {
        throw mapClaudeError(err, model, call.timedOut?.() ?? false);
      }

      call.onUsage?.({
        task: call.task,
        stopReason: message.stop_reason,
        inputTokens: message.usage?.input_tokens ?? null,
        outputTokens: message.usage?.output_tokens ?? null,
        cacheReadTokens: message.usage?.cache_read_input_tokens ?? null,
        ms: Date.now() - started,
      });

      if (message.stop_reason === 'refusal') {
        throw new ApiHttpError(
          'refused',
          'Claude declined this request. Try a different photo or rephrase your description and try again.',
          422,
        );
      }
      if (message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded') {
        throw new ApiHttpError(
          'upstream_error',
          "Claude's answer was cut off before it finished. Try again, or shorten your brief.",
          502,
        );
      }
      const output = message.parsed_output;
      if (output == null) {
        throw new ApiHttpError('upstream_error', 'Claude returned an answer Mode could not read. Please try again.', 502);
      }
      // Re-validate: the output may come from a fake client or a lenient parse.
      const checked = call.schema.safeParse(output);
      if (!checked.success) {
        throw new ApiHttpError('upstream_error', 'Claude returned an answer Mode could not read. Please try again.', 502);
      }
      return checked.data;
    },
  };
}
