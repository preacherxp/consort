import { requestSchema } from '../shared/contracts';
import { routeTask, RouterError, type RouterConfig } from './router';

export function createApi(config: RouterConfig, options: { origins?: string[]; fetcher?: typeof fetch; maxPerMinute?: number } = {}) {
  const origins = options.origins ?? ['http://127.0.0.1:5177', 'http://localhost:5177', 'http://127.0.0.1:3007', 'http://localhost:3007'];
  let windowStart = Date.now();
  let requests = 0;
  let active = 0;
  const json = (data: unknown, status = 200) => Response.json(data, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/api/health' && request.method === 'GET') {
      return json({ configured: Boolean(config.apiKey), router: config.modelId });
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
    try {
      return json(await routeTask(input, config, options.fetcher, request.signal));
    } catch (error) {
      if (error instanceof RouterError) return json({ error: error.message }, error.status);
      return json({ error: 'Routing failed. Please try again.' }, 500);
    } finally { active--; }
  };
}
