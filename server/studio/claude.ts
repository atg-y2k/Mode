/**
 * Claude access for the Studio routes.
 *
 * - `structured()` = one `client.beta.messages.parse` call with a zod output
 *   format (structured outputs), a cached system prompt, images before text,
 *   server-side refusal fallbacks, refusal / truncation handling and SDK error
 *   mapping to ApiErrorBody codes.
 * - `webSearchTurn()` = a free-text turn with the web search server tool,
 *   resumed on `pause_turn`; used by product search before a structured
 *   extraction call.
 *
 * Model notes (Claude Opus 5.5): thinking is always on and steered only by
 * `output_config.effort`; never send thinking `{type:'disabled'}`,
 * `budget_tokens`, sampling params, assistant prefill or forced tool_choice.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { StudioError, cancelled, redact } from './errors';
import type { ImageData64 } from './util';

export type Effort = 'low' | 'medium' | 'high';

type ParseParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type ContentParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** The subset of a (parsed) beta message the Studio reads. */
export interface StudioClaudeMessage {
  stop_reason: string | null;
  /** Set by `.parse()` when an output format was given. */
  parsed_output?: unknown;
  /** Response content blocks (text, server_tool_use, web_search_tool_result…). */
  content?: readonly unknown[];
  /** Model that produced the answer (differs from the request when a fallback ran). */
  model?: string;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  } | null;
}

export interface StudioClaudeRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Minimal structural view of the Anthropic client: only
 * `client.beta.messages.parse`. `new Anthropic()` satisfies it; tests inject fakes.
 */
export interface StudioClaude {
  beta: {
    messages: {
      parse(params: ParseParams, options?: StudioClaudeRequestOptions): PromiseLike<StudioClaudeMessage>;
    };
  };
}

/** Upper bound for one attempt; the route deadline (signal) bounds the total. */
export const ATTEMPT_TIMEOUT_MS = 240_000;
const MAX_TOKENS = 16000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function createAnthropicClient(apiKey: string | null): Anthropic {
  // undefined lets the SDK resolve ANTHROPIC_AUTH_TOKEN or a saved profile.
  return new Anthropic({ apiKey: apiKey ?? undefined, maxRetries: 2, timeout: ATTEMPT_TIMEOUT_MS });
}

// ---------------------------------------------------------------------------
// Tolerant structured-output parsing
// ---------------------------------------------------------------------------

/** Preferred replacements when the model returns a value outside an enum. */
const ENUM_FALLBACKS = ['other', 'none', 'other-exterior', 'other-interior'];

function pickEnumValue(received: unknown, options: readonly unknown[]): unknown {
  const strings = options.filter((o): o is string => typeof o === 'string');
  if (typeof received === 'string') {
    const guess = received
      .trim()
      .toLowerCase()
      .replace(/[\s_/]+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const exact = strings.find((o) => o === guess);
    if (exact) return exact;
    // "path way" -> "pathway", "walk" -> "walkway", "planting bed" -> "planting-bed"
    const partial =
      guess.length >= 3 ? strings.find((o) => o.startsWith(guess) || (o.length >= 3 && guess.startsWith(o))) : undefined;
    if (partial) return partial;
  }
  for (const pref of ENUM_FALLBACKS) if (strings.includes(pref)) return pref;
  return options[0];
}

function walk(root: unknown, path: readonly PropertyKey[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

function setAt(root: unknown, path: readonly PropertyKey[], value: unknown): boolean {
  if (path.length === 0) return false;
  const parent = walk(root, path.slice(0, -1));
  if (typeof parent !== 'object' || parent === null) return false;
  (parent as Record<PropertyKey, unknown>)[path[path.length - 1]] = value;
  return true;
}

/**
 * Parses Claude's JSON against `schema`. Enum values outside the allowed set
 * are mapped to the closest allowed value instead of failing the whole answer.
 * Returns null when the output still doesn't fit.
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
        repaired = setAt(data, issue.path, pickEnumValue(walk(data, issue.path), issue.values)) || repaired;
      }
    }
    if (!repaired) return null;
  }
  return null;
}

/** betaZodOutputFormat with a tolerant parser (the stock one throws on refusals / truncated JSON). */
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

/** Maps anything thrown by the SDK to a StudioError (unknown errors are returned unchanged). */
export function mapClaudeError(err: unknown, model: string, timedOut = false): unknown {
  if (err instanceof StudioError) return err;
  if (err instanceof Anthropic.APIUserAbortError) {
    return timedOut ? new StudioError('upstream_error', 'Claude took too long to answer. Please try again.', 504) : cancelled();
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new StudioError('upstream_error', 'Claude took too long to answer. Please try again.', 504);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new StudioError('upstream_error', "The server couldn't reach the Claude API. Check its internet connection and try again.", 502);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new StudioError(
      'rate_limited',
      'Claude is handling too many requests for this API key right now. Wait a minute and try again.',
      429,
      { retryAfterSec: retryAfterSeconds(err.headers) ?? 60 },
    );
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new StudioError(
      'upstream_error',
      "The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env and restart the server.",
      502,
    );
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new StudioError(
      'upstream_error',
      `The server's Anthropic API key isn't allowed to use ${model}. Check the key's workspace or set CLAUDE_MODEL.`,
      502,
    );
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new StudioError('upstream_error', `The model "${model}" isn't available. Check CLAUDE_MODEL in .env.`, 502);
  }
  if (err instanceof Anthropic.BadRequestError) {
    const detail = upstreamMessage(err);
    return new StudioError('upstream_error', `Claude couldn't process this request${detail ? `: ${detail}` : '.'}`, 502);
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529 || err.status === 503) {
      return new StudioError('upstream_error', 'Claude is temporarily overloaded. Please try again in a minute.', 503, {
        retryAfterSec: retryAfterSeconds(err.headers) ?? 30,
      });
    }
    return new StudioError(
      'upstream_error',
      `The Claude API returned an error${err.status ? ` (HTTP ${err.status})` : ''}. Please try again.`,
      502,
    );
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Client-side SDK errors, e.g. no credentials could be resolved.
    return new StudioError('upstream_error', `Claude request failed: ${redact(err.message, 200)}`, 502);
  }
  return err;
}

const refusedError = () =>
  new StudioError(
    'refused',
    'Claude declined this request. Try a different photo or rephrase your description and try again.',
    422,
  );

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export interface ClaudeUsage {
  task: string;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  ms: number;
}

interface CallBase {
  /** Short label for logs, e.g. "scene". */
  task: string;
  /** Cached system prompt (byte-stable across calls). */
  system: string;
  /** Images placed before the text, in order. */
  images?: ImageData64[];
  text: string;
  effort: Effort;
  signal?: AbortSignal;
  /** True when `signal` aborted because the route deadline passed. */
  timedOut?: () => boolean;
  onUsage?: (u: ClaudeUsage) => void;
}

export interface StructuredCall<S extends z.ZodType> extends CallBase {
  schema: S;
}

export interface StructuredResult<T> {
  data: T;
  /** Model that answered (the fallback model when a refusal fallback ran). */
  model: string;
}

function userContent(images: ImageData64[] | undefined, text: string): ContentParam[] {
  return [
    ...(images ?? []).map(
      (img): ContentParam => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } }),
    ),
    { type: 'text', text },
  ];
}

function systemBlocks(system: string): Anthropic.Beta.Messages.BetaTextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

function reportUsage(call: CallBase, message: StudioClaudeMessage, started: number): void {
  call.onUsage?.({
    task: call.task,
    stopReason: message.stop_reason,
    inputTokens: message.usage?.input_tokens ?? null,
    outputTokens: message.usage?.output_tokens ?? null,
    cacheReadTokens: message.usage?.cache_read_input_tokens ?? null,
    ms: Date.now() - started,
  });
}

/** One structured-output call. Throws StudioError on refusal, truncation, unreadable output or SDK errors. */
export async function structured<S extends z.ZodType>(
  client: StudioClaude,
  model: string,
  call: StructuredCall<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const started = Date.now();
  let message: StudioClaudeMessage;
  try {
    message = await client.beta.messages.parse(
      {
        model,
        max_tokens: MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { format: structuredFormat(call.schema), effort: call.effort },
        system: systemBlocks(call.system),
        messages: [{ role: 'user', content: userContent(call.images, call.text) }],
      },
      { signal: call.signal, timeout: ATTEMPT_TIMEOUT_MS },
    );
  } catch (err) {
    throw mapClaudeError(err, model, call.timedOut?.() ?? false);
  }
  reportUsage(call, message, started);

  if (message.stop_reason === 'refusal') throw refusedError();
  if (message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded') {
    throw new StudioError('upstream_error', "Claude's answer was cut off before it finished. Please try again.", 502);
  }
  const checked = message.parsed_output == null ? null : call.schema.safeParse(message.parsed_output);
  if (!checked?.success) {
    throw new StudioError('upstream_error', 'Claude returned an answer Mode could not read. Please try again.', 502);
  }
  return { data: checked.data, model: message.model ?? model };
}

export type WebSearchToolType = 'web_search_20260209' | 'web_search_20250305';

export interface WebSearchCall extends CallBase {
  toolType: WebSearchToolType;
  maxUses: number;
  /** Restrict results to these domains; null = any domain. */
  allowedDomains: string[] | null;
  /** Max `pause_turn` continuations (default 4). */
  maxContinuations?: number;
}

export interface WebSearchTurn {
  /** Every content block Claude produced, across continuations. */
  blocks: unknown[];
  stopReason: string | null;
  model: string;
}

/** True when the API rejected the web search tool definition (e.g. a model without the newer tool version). */
export function isToolVersionError(err: unknown): boolean {
  if (!(err instanceof Anthropic.BadRequestError)) return false;
  const detail = upstreamMessage(err) ?? err.message;
  return /web_search|tool/i.test(detail);
}

/**
 * A free-text turn with the web search server tool. `pause_turn` is resumed by
 * sending the paused assistant content back (no extra user message).
 */
export async function webSearchTurn(client: StudioClaude, model: string, call: WebSearchCall): Promise<WebSearchTurn> {
  const tool: Anthropic.Beta.Messages.BetaToolUnion =
    call.toolType === 'web_search_20260209'
      ? { type: 'web_search_20260209', name: 'web_search', max_uses: call.maxUses, ...(call.allowedDomains ? { allowed_domains: call.allowedDomains } : {}) }
      : { type: 'web_search_20250305', name: 'web_search', max_uses: call.maxUses, ...(call.allowedDomains ? { allowed_domains: call.allowedDomains } : {}) };

  const userTurn: MessageParam = { role: 'user', content: userContent(call.images, call.text) };
  const blocks: unknown[] = [];
  let assistant: unknown[] = [];
  let answeredBy = model;
  const maxContinuations = call.maxContinuations ?? 4;

  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    const messages: MessageParam[] = assistant.length
      ? [userTurn, { role: 'assistant', content: assistant as ContentParam[] }]
      : [userTurn];
    let message: StudioClaudeMessage;
    try {
      message = await client.beta.messages.parse(
        {
          model,
          max_tokens: MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          output_config: { effort: call.effort },
          system: systemBlocks(call.system),
          tools: [tool],
          messages,
        },
        { signal: call.signal, timeout: ATTEMPT_TIMEOUT_MS },
      );
    } catch (err) {
      if (isToolVersionError(err)) throw err; // the caller retries with the basic tool version
      throw mapClaudeError(err, model, call.timedOut?.() ?? false);
    }
    reportUsage(call, message, started);
    answeredBy = message.model ?? answeredBy;
    const content = [...(message.content ?? [])];
    blocks.push(...content);

    if (message.stop_reason === 'refusal') throw refusedError();
    if (message.stop_reason !== 'pause_turn' || attempt >= maxContinuations) {
      return { blocks, stopReason: message.stop_reason, model: answeredBy };
    }
    // Resume: the paused assistant turn so far (earlier parts + this response).
    assistant = [...assistant, ...content];
  }
}
