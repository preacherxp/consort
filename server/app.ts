import { requestSchema } from '../shared/contracts';
import { routeTask, RouterError, type RouterConfig } from './router';
import { StorageError, type RequestLog, type RoutingOutcome } from './request-log';

export function createApi(config: RouterConfig, options: { origins?: string[]; fetcher?: typeof fetch; maxPerMinute?: number; log?: RequestLog } = {}) {
  const origins = options.origins ?? ['http://127.0.0.1:5177', 'http://localhost:5177', 'http://127.0.0.1:3007', 'http://localhost:3007'];
  let windowStart = Date.now();
  let requests = 0;
  let active = 0;
  const json = (data: unknown, status = 200, requestId?: string) => Response.json(data, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(requestId ? { 'X-Request-ID': requestId } : {}) },
  });
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/api/health' && request.method === 'GET') {
      const ready = options.log ? await options.log.healthy().catch(() => false) : true;
      return json({ configured: Boolean(config.apiKey), router: config.modelId,
        ...(options.log ? { storage: ready ? 'ready' : 'unavailable' } : {}),
      }, ready ? 200 : 503);
    }
    if (path !== '/api/route') return json({ error: 'Not found.' }, 404);
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    const origin = request.headers.get('origin');
    if ((origin && !origins.includes(origin)) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return json({ error: 'This origin is not allowed.' }, 403);
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json({ error: 'Send application/json.' }, 415);
    }
    let input;
    try {
      // Bound the body while reading, including chunked requests without Content-Length.
      if (Number(request.headers.get('content-length')) > 20000) return json({ error: 'Task is too long.' }, 413);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'A task is required.' }, 400);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 20000) { await reader.cancel(); return json({ error: 'Task is too long.' }, 413); }
        chunks.push(value);
      }
      input = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch { return json({ error: 'Describe a task in 8–4,000 characters and choose a valid priority.' }, 400); }
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
    if (requests >= (options.maxPerMinute ?? 20) || active >= 4) return json({ error: 'A few too many requests. Please wait a minute.' }, 429);
    requests++;
    active++;
    const run = async (): Promise<RoutingOutcome> => {
      try {
        if (request.signal.aborted) throw new RouterError(499, 'Routing cancelled.');
        return { status: 200, body: await routeTask(input, config, options.fetcher, request.signal) };
      } catch (error) {
        return error instanceof RouterError
          ? { status: error.status, body: { error: error.message } }
          : { status: 500, body: { error: 'Routing failed. Please try again.' } };
      }
    };
    try {
      const outcome = options.log ? await options.log.record(input, config.modelId, run, request.signal) : await run();
      return json(outcome.body, outcome.status, outcome.requestId);
    } catch (error) {
      // No task, provider body, connection URL, password, or driver exception in stdout.
      const requestId = error instanceof StorageError ? error.requestId : undefined;
      console.error(JSON.stringify({ level: 'error', event: 'request_storage_failed', requestId,
        phase: error instanceof StorageError ? error.phase : 'unknown' }));
      return json({ error: error instanceof StorageError ? error.message : 'Request storage is unavailable. Please try again later.' }, 503, requestId);
    } finally { active--; }
  };
}
