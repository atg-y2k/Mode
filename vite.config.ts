/// <reference types="vitest/config" />
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_PORT = Number(process.env.API_PORT ?? 8787);

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
 * /api proxy. `xfwd` makes the proxy append the real TCP peer to
 * X-Forwarded-For: the API sees every proxied request coming from 127.0.0.1,
 * and without it any device on the network would count as "this computer"
 * for the Downloads watcher (server/handoff/http.ts isLocalClient).
 */
const API_PROXY = { '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true, xfwd: true } };

const isLoopback = (address: string | undefined): boolean => {
  const a = (address ?? '').toLowerCase().split('%')[0];
  return a === '::1' || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
};

/**
 * Defence in depth for the hand-off routes (Downloads watcher, its events and
 * files): while no MODE_ACCESS_TOKEN guards the server they only answer a
 * browser on this computer — refused here before the proxy, even if the API
 * server were older. Warns when the dev server listens on every interface.
 */
function handoffLocalOnly(tokenSet: boolean): Plugin {
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
      if (!tokenSet && !process.env.VITEST && server.config.server.host !== undefined && server.config.server.host !== 'localhost' && server.config.server.host !== '127.0.0.1') {
        server.config.logger.warn(
          '[mode] The dev server is reachable from other devices on your network and MODE_ACCESS_TOKEN is not set: the API (AI features) answers them too. The Downloads watcher stays limited to this computer. Set MODE_ACCESS_TOKEN in .env to require a token.',
        );
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), handoffLocalOnly(Boolean(loadEnv(mode, process.cwd(), '').MODE_ACCESS_TOKEN))],
  server: {
    host: true,
    port: 5173,
    headers: CROSS_ORIGIN_ISOLATION,
    proxy: API_PROXY,
  },
  preview: {
    headers: CROSS_ORIGIN_ISOLATION,
    proxy: API_PROXY,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'server/**/*.test.ts'],
  },
}));
