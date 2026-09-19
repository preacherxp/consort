import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApi } from './app';
import { databaseUrl, openRequestLog, type RequestLog } from './request-log';

let log: RequestLog;
try { log = await openRequestLog(databaseUrl(process.env)); }
catch {
  console.error(JSON.stringify({ level: 'error', event: 'database_startup_failed', message: 'Check PostgreSQL configuration, connectivity, and migration permissions.' }));
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3007);
const api = createApi({
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  modelId: process.env.OPENROUTER_MODEL_ID ?? 'typesafe/jev-1.13',
}, {
  log,
  origins: [
    'http://localhost:5177', 'http://127.0.0.1:5177',
    `http://localhost:${port}`, `http://127.0.0.1:${port}`,
    ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []),
  ],
});
const dist = resolve(import.meta.dir, '../dist');
const assets = new Map<string, string>();
if (existsSync(dist)) {
  for await (const name of new Bun.Glob('**/*').scan({ cwd: dist, onlyFiles: true })) {
    assets.set(`/${name}`, resolve(dist, name));
  }
}
const server = Bun.serve({
  port,
  hostname: process.env.HOST ?? '127.0.0.1',
  maxRequestBodySize: 20000,
  idleTimeout: 60,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return api(request);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const asset = assets.get(path) ?? (path === '/' ? assets.get('/index.html') : undefined);
    if (!asset) return new Response('Not found. For development, open http://localhost:5177.', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : Bun.file(asset), {
      headers: {
        'Content-Type': Bun.file(asset).type,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    });
  },
});
console.log(`Consort API${assets.size ? ' + web' : ''} → ${server.url}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', event: 'shutdown_deadline_exceeded' }));
    void server.stop(true);
    process.exit(1);
  }, 60000);
  deadline.unref();
  try {
    await server.stop(false); // Drain in-flight routing and database writes first.
    await log.close();
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'shutdown_failed' }));
    process.exitCode = 1;
  } finally { clearTimeout(deadline); }
  process.exit(process.exitCode ?? 0);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown(); });
