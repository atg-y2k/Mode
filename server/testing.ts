/**
 * Test doubles for the server (used by server/*.test.ts). No network, no keys.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { CatalogAccess } from './catalog';
import type { ClaudeClientLike, ClaudeParsedMessage, ClaudeRequestOptions } from './claude';
import { createApp, type AppDeps } from './app';
import { testConfig, type ServerConfig } from './config';
import type { EditImageRequest, GenerateImageRequest, ImageProvider, ImageResult } from './imageProvider';
import { encodePngRgba } from './png';

type ParseParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export interface RecordedClaudeCall {
  params: ParseParams;
  options: ClaudeRequestOptions | undefined;
}

export type FakeClaudeReply =
  | { output: unknown; stopReason?: string }
  | { rawText: string; stopReason?: string }
  | { error: unknown };

/**
 * A fake Anthropic client. Replies are consumed in order (the last one
 * repeats). Like the real SDK, the JSON text is run through the request's
 * `output_config.format.parse`, so the server's tolerant parser is exercised.
 */
export function fakeClaude(...replies: FakeClaudeReply[]): ClaudeClientLike & { calls: RecordedClaudeCall[] } {
  const calls: RecordedClaudeCall[] = [];
  let i = 0;
  return {
    calls,
    beta: {
      messages: {
        async parse(params, options): Promise<ClaudeParsedMessage> {
          calls.push({ params, options });
          const reply = replies[Math.min(i++, replies.length - 1)];
          if (!reply) throw new Error('fakeClaude: no reply configured');
          if ('error' in reply) throw reply.error;
          const text = 'rawText' in reply ? reply.rawText : JSON.stringify(reply.output);
          const format = params.output_config?.format as { parse?: (t: string) => unknown } | null | undefined;
          const parsed = format?.parse ? format.parse(text) : JSON.parse(text);
          return {
            stop_reason: reply.stopReason ?? 'end_turn',
            parsed_output: parsed,
            usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 1000 },
          };
        },
      },
    },
  };
}

export interface FakeImageProvider extends ImageProvider {
  edits: EditImageRequest[];
  generations: GenerateImageRequest[];
}

export function fakeImageProvider(result?: Partial<ImageResult> & { error?: unknown }): FakeImageProvider {
  const edits: EditImageRequest[] = [];
  const generations: GenerateImageRequest[] = [];
  const out = (): ImageResult => {
    if (result?.error) throw result.error;
    return { mime: result?.mime ?? 'image/png', base64: result?.base64 ?? tinyPngBase64() };
  };
  return {
    name: 'fake',
    model: 'fake-image-1',
    edits,
    generations,
    async editImage(req) {
      edits.push(req);
      return out();
    },
    async generateImage(req) {
      generations.push(req);
      return out();
    },
  };
}

/** A w×h RGBA PNG, transparent except an opaque box [x0,x1)×[y0,y1). */
export function boxPng(w: number, h: number, box: { x0: number; y0: number; x1: number; y1: number }): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const o = (y * w + x) * 4;
      data[o] = 40;
      data[o + 1] = 120;
      data[o + 2] = 60;
      data[o + 3] = 255;
    }
  }
  return encodePngRgba({ width: w, height: h, data });
}

export function tinyPngBase64(): string {
  return Buffer.from(boxPng(4, 4, { x0: 0, y0: 0, x1: 4, y1: 4 })).toString('base64');
}

export function tinyPngDataUrl(): string {
  return `data:image/png;base64,${tinyPngBase64()}`;
}

export const FAKE_CATALOG_SUMMARY = [
  'material oak-plank-natural | Natural oak plank | flooring | 7.5x72in',
  'material paver-charcoal | Charcoal paver | hardscape | 4x8in',
  'plant boxwood-green-velvet | Boxwood \'Green Velvet\' | shrub | sun: full,part | water: med | z5-8 | 3x3ft',
  'fixture path-light-bronze | Bronze path light | path | 2700K',
  'decor planter-tall-white | Tall white planter | planter',
].join('\n');

export const fakeCatalog: CatalogAccess = {
  summary: () => FAKE_CATALOG_SUMMARY,
  isMaterial: (id) => id === 'oak-plank-natural' || id === 'paver-charcoal',
  assetCategory: (id) =>
    id === 'boxwood-green-velvet'
      ? 'plant'
      : id === 'path-light-bronze'
        ? 'lighting'
        : id === 'planter-tall-white'
          ? 'decor'
          : undefined,
};

export function makeApp(overrides: Partial<ServerConfig> = {}, deps: Omit<Partial<AppDeps>, 'config'> = {}) {
  const lines: string[] = [];
  const app = createApp({
    config: testConfig({ trustProxy: true, ...overrides }),
    claude: null,
    imageProvider: null,
    catalog: fakeCatalog,
    log: (line) => lines.push(line),
    ...deps,
  });
  return { app, lines };
}

export function postJson(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}
