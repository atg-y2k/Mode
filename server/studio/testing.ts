/** Test helpers for the Studio server modules (fake Claude client, fake providers, PNG encoder). */
import { crc32, deflateSync } from 'node:zlib';
import type { StudioClaude, StudioClaudeMessage } from './claude';
import type { ImageEditRequest, ImageProvider } from './providers';

export type ParseParams = Parameters<StudioClaude['beta']['messages']['parse']>[0];

export interface FakeClaude {
  client: StudioClaude;
  calls: ParseParams[];
}

/** A fake `client.beta.messages.parse`; `reply` returns a message or an Error to throw. */
export function fakeClaude(reply: (params: ParseParams, callNumber: number) => StudioClaudeMessage | Error): FakeClaude {
  const calls: ParseParams[] = [];
  const client: StudioClaude = {
    beta: {
      messages: {
        parse: async (params) => {
          // Snapshot (callers may reuse arrays between calls); the output format holds a function, so keep it by reference.
          const { output_config, ...rest } = params;
          calls.push({ ...structuredClone(rest), output_config } as ParseParams);
          const r = reply(params, calls.length);
          if (r instanceof Error) throw r;
          return r;
        },
      },
    },
  };
  return { client, calls };
}

/** Builds the message `.parse()` would return for `data`, running the request's own output parser like the SDK does. */
export function structuredMessage(params: ParseParams, data: unknown, stopReason = 'end_turn'): StudioClaudeMessage {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const format = params.output_config?.format as { parse?: (t: string) => unknown } | null | undefined;
  return {
    stop_reason: stopReason,
    parsed_output: format?.parse ? format.parse(text) : null,
    content: [{ type: 'text', text, citations: null }],
    model: params.model,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
  };
}

export interface FakeProvider extends ImageProvider {
  calls: ImageEditRequest[];
}

export function fakeProvider(id: 'openai' | 'gemini', supportsMask: boolean, result?: () => Promise<{ mime: 'image/png'; base64: string }>): FakeProvider {
  const calls: ImageEditRequest[] = [];
  return {
    id,
    name: id === 'openai' ? 'OpenAI' : 'Google Gemini',
    model: id === 'openai' ? 'gpt-image-1' : 'gemini-2.5-flash-image',
    supportsMask,
    calls,
    async edit(req) {
      calls.push(req);
      return result ? result() : { mime: 'image/png', base64: PNG_1PX_B64 };
    },
  };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Encodes an RGBA PNG whose alpha is `alpha(x, y)` (RGB = a gradient so the
 * filters have real work to do). `filter` (0–4) is applied to every row.
 */
export function encodeRgbaPng(width: number, height: number, alpha: (x: number, y: number) => number, filter: 0 | 1 | 2 | 3 | 4 = 0): Buffer {
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * stride + x * 4;
      pixels[p] = (x * 37) & 0xff;
      pixels[p + 1] = (y * 53) & 0xff;
      pixels[p + 2] = (x * y * 11) & 0xff;
      pixels[p + 3] = alpha(x, y);
    }
  }
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = filter;
    for (let i = 0; i < stride; i++) {
      const cur = pixels[y * stride + i];
      const left = i >= 4 ? pixels[y * stride + i - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= 4 ? pixels[(y - 1) * stride + i - 4] : 0;
      const pred = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0;
      raw[row + 1 + i] = (cur - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** A fetch fake answering by URL; records requested URLs. */
export function fakeFetch(routes: Record<string, () => Response>): { fetch: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    const handler = routes[url];
    if (!handler) return new Response('not found', { status: 404 });
    return handler();
  }) as typeof fetch;
  return { fetch: impl, requested };
}

/** 1×1 opaque PNG, base64. */
export const PNG_1PX_B64 = encodeRgbaPng(1, 1, () => 255).toString('base64');
