/**
 * Starts the Mode server: the API on $PORT (or $API_PORT, default 8787) and,
 * when NODE_ENV=production, the built web app from ./dist with SPA fallback.
 *
 *   npm run dev:api   tsx watch, API only (Vite serves the app and proxies /api)
 *   npm start         production: one process serves app + API
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import type { Context } from 'hono';
import { createApp, type AppEnv } from './app';
import { loadConfig } from './config';
import { createHandoffDepsFromEnv, registerHandoffRoutes } from './handoff/routes';
import { registerSiteRoutes } from './site/routes';
import { createStudioDepsFromEnv, registerStudioRoutes } from './studio/routes';

const config = loadConfig();
for (const warning of config.warnings) console.warn(`[mode] warning: ${warning}`);
if (config.staticDir && !existsSync(join(config.staticDir, 'index.html'))) {
  console.warn(`[mode] warning: ${join(config.staticDir, 'index.html')} not found. Run "npm run build" before "npm start".`);
}

// Studio endpoints (scene map, element options, plans, renders, products) share
// the main server's auth, body limit, rate limit and request log.
const studio = createStudioDepsFromEnv();
for (const warning of studio.warnings) console.warn(`[mode] warning: ${warning}`);

const app = createApp({
  config,
  extraRoutes: (api, ctx) => {
    registerStudioRoutes(api, {
      ...studio,
      log: ctx.log,
      beforeAiCall: (c) => ctx.consumeAiCall(c as Context<AppEnv>),
      onClaudeUsage: (c, u) =>
        ctx.noteForLog(
          c as Context<AppEnv>,
          `claude ${u.task} in=${u.inputTokens ?? '?'} out=${u.outputTokens ?? '?'} cache=${u.cacheReadTokens ?? 0}`,
        ),
    });
    // Manual hand-off helpers (Downloads watcher, dragged image URLs).
    const handoff = createHandoffDepsFromEnv();
    for (const warning of handoff.warnings) console.warn(`[mode] warning: ${warning}`);
    registerHandoffRoutes(api, {
      ...handoff,
      accessTokenRequired: Boolean(ctx.config.accessToken),
      trustProxy: ctx.config.trustProxy,
      log: ctx.log,
    });
    // Frost dates (NOAA), soil (USDA) and ecoregion (EPA), cached under .cache/site/.
    registerSiteRoutes(api, { log: ctx.log });
    // EventSource can't send x-mode-token: the client trades the header for a
    // single-use, 60-second ticket (POST /api/handoff/events-ticket) and opens
    // the hand-off event stream with ?ticket= (checked by createApp's auth
    // middleware). The long-lived token never goes in a URL.
  },
});

const server = serve(
  { fetch: app.fetch, port: config.port, ...(config.host ? { hostname: config.host } : {}) },
  (info) => {
    const host = config.host ?? 'localhost';
    const ai = config.aiEnabled ? `on (${config.claudeModel})` : 'off (set ANTHROPIC_API_KEY to enable)';
    const images = config.imageProviders.length
      ? config.imageProviders.map((p) => `${p.id} (${p.model})${p.isDefault ? ' [default]' : ''}`).join(', ')
      : 'off';
    console.log(`[mode] server listening on http://${host}:${info.port}`);
    console.log(`[mode] AI: ${ai} · image providers: ${images} · access token: ${config.accessToken ? 'required' : 'not required'}`);
    if (Array.isArray(config.allowedHosts) && config.allowedHosts.length) {
      console.log(`[mode] also answers to: ${config.allowedHosts.join(', ')} (MODE_ALLOWED_HOSTS)`);
    }
    console.log(
      config.staticDir
        ? `[mode] serving the web app from ${config.staticDir}`
        : '[mode] API only (development): open the app from Vite at http://localhost:5173',
    );
  },
);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[mode] port ${config.port} is already in use. Stop the other process or set PORT to a free port.`);
  } else {
    console.error(`[mode] server error: ${err.message}`);
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[mode] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  // Long AI calls may hold connections open; don't wait forever.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
