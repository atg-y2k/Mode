/// <reference types="vitest/config" />
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Cross-origin isolation for the dev and preview servers (the production
 * server sends the same pair on documents and scripts: server/app.ts
 * CROSS_ORIGIN_ISOLATION_HEADERS). With both, `crossOriginIsolated` is true,
 * SharedArrayBuffer exists and ONNX Runtime runs the vision models on several
 * WASM threads (src/vision/worker.ts). COEP `credentialless` (not
 * `require-corp`) keeps cross-origin no-cors images loading (without cookies),
 * and CORS fetches (Hugging Face model files, phzmapi.org) are unaffected;
 * /api answers, blob: URLs and the Document Picture-in-Picture companion are
 * same-origin.
 */
const CROSS_ORIGIN_ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

/**
 * /api proxy to the API server's port. `xfwd` makes the proxy append the real
 * TCP peer to X-Forwarded-For: the API sees every proxied request coming from
 * 127.0.0.1, and without it any device on the network would count as "this
 * computer" for the Downloads watcher (server/handoff/http.ts isLocalClient).
 */
const apiProxy = (port: number) => ({ '/api': { target: `http://localhost:${port}`, changeOrigin: true, xfwd: true } });

/**
 * What the API server (server/config.ts) makes of the same settings: its port
 * (PORT, else API_PORT, else 8787), whether it can spend money (a Claude or
 * image key, or MODE_AI=on; MODE_AI=off and IMAGE_PROVIDER=none turn those
 * off) and whether it requires MODE_ACCESS_TOKEN. `env` is apiEnv's. Not
 * imported from server/ (Vite's config loader warns about extensionless
 * imports on every start); server/config.test.ts checks that the two agree.
 */
export function apiSettingsFrom(env: Record<string, string | undefined>): { port: number; paidFeatures: boolean; tokenSet: boolean } {
  const str = (key: string) => env[key]?.trim() || null;
  const lower = (key: string) => str(key)?.toLowerCase() ?? '';
  const portRaw = str('PORT') ?? str('API_PORT');
  const port = portRaw !== null && Number.isInteger(Number(portRaw)) && Number(portRaw) >= 1 ? Number(portRaw) : 8787;
  const aiOff = ['0', 'false', 'off', 'no'].includes(lower('MODE_AI'));
  const aiOn = ['1', 'true', 'on', 'yes'].includes(lower('MODE_AI'));
  const aiEnabled = !aiOff && (str('ANTHROPIC_API_KEY') !== null || aiOn);
  const imagesOff = ['none', 'off'].includes(lower('IMAGE_PROVIDER'));
  const imageKey = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'].some((key) => str(key) !== null);
  return { port, paidFeatures: aiEnabled || (!imagesOff && imageKey), tokenSet: str('MODE_ACCESS_TOKEN') !== null };
}

/**
 * The settings the API process sees: `.env` in `dir` (it starts with
 * `--env-file-if-exists=.env` — never .env.local or .env.[mode], which Vite's
 * loadEnv would add) with variables exported in the shell winning.
 */
export function apiEnv(dir: string, shell: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const file = join(dir, '.env');
  return { ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...shell };
}

const isLoopback = (address: string | undefined): boolean => {
  const a = (address ?? '').toLowerCase().split('%')[0];
  return a === '::1' || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
};

/**
 * Defence in depth for the hand-off routes (Downloads watcher, its events and
 * files): while no MODE_ACCESS_TOKEN guards the server they only answer a
 * browser on this computer — refused here before the proxy, even if the API
 * server were older. Warns when the dev server listens on every interface
 * and the API can spend money (a Claude or image key, or MODE_AI=on): with
 * no keys, other devices reach nothing worth guarding.
 */
function handoffLocalOnly(tokenSet: boolean, paidFeatures: boolean): Plugin {
  const guard: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    if (tokenSet || !req.url?.startsWith('/api/handoff/') || isLoopback(req.socket.remoteAddress)) return next();
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: {
          code: 'unauthorized',
          message:
            'The Downloads watcher only works in a browser on the computer running Mode (or set MODE_ACCESS_TOKEN on the server to allow your other devices).',
        },
      }),
    );
  };
  return {
    name: 'mode-handoff-local-only',
    configureServer(server) {
      server.middlewares.use(guard);
      if (!tokenSet && paidFeatures && !process.env.VITEST && server.config.server.host !== undefined && server.config.server.host !== 'localhost' && server.config.server.host !== '127.0.0.1') {
        server.config.logger.warn(
          '[mode] The dev server is reachable from other devices on your network and MODE_ACCESS_TOKEN is not set: they can use the AI features (your API keys) too. The Downloads watcher stays limited to this computer. Set MODE_ACCESS_TOKEN in .env to require a token.',
        );
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard);
    },
  };
}

export default defineConfig(() => {
  const api = apiSettingsFrom(apiEnv(process.cwd()));
  return {
    plugins: [react(), tailwindcss(), handoffLocalOnly(api.tokenSet, api.paidFeatures)],
    server: {
      host: true,
      port: 5173,
      // Projects live in this browser's storage for this exact address: fail
      // rather than quietly move to 5174, where they would seem to be gone.
      strictPort: true,
      headers: CROSS_ORIGIN_ISOLATION,
      proxy: apiProxy(api.port),
    },
    preview: {
      headers: CROSS_ORIGIN_ISOLATION,
      proxy: apiProxy(api.port),
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'server/**/*.test.ts'],
    },
  };
});
