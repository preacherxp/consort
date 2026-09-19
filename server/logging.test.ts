import { describe, expect, test, spyOn } from 'bun:test';
import { createApi } from './app';
import { databaseUrl, StorageError, type RequestLog, type RoutingOutcome } from './request-log';
import { completion, input } from '../tests/fixtures';

const config = { apiKey: 'provider-secret', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'typesafe/jev-1.13' };
const id = 'e6fdbf12-800a-4cf1-becf-cf09192830b8';
const fetcher = (async () => Response.json({ ...completion(), private_metadata: 'DO NOT STORE' })) as unknown as typeof fetch;
function request(body: unknown = input, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request('http://localhost:3007/api/route', { method: 'POST', body: JSON.stringify(body), signal,
    headers: { 'content-type': 'application/json', ...headers } });
}
function fakeLog() {
  const saved: { input: unknown; router: string; outcome: RoutingOutcome; aborted: boolean }[] = [];
  const log: RequestLog = {
    async record(input, router, run, signal) {
      const outcome = await run();
      saved.push({ input: structuredClone(input), router, outcome: structuredClone(outcome), aborted: signal?.aborted ?? false });
      return { ...outcome, requestId: id };
    },
    healthy: async () => true,
    close: async () => {},
  };
  return { log, saved };
}

describe('durable routing integration', () => {
  test('records normalized input and the exact allowlisted client response, not headers or keys', async () => {
    const { log, saved } = fakeLog();
    const api = createApi(config, { fetcher, log });
    const response = await api(request({ ...input, task: `  ${input.task}  ` }, { authorization: 'Bearer visitor-secret', cookie: 'session=private', 'x-forwarded-for': '203.0.113.1' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe(id);
    const body = await response.json();
    expect(saved).toHaveLength(1);
    expect(saved[0].input).toEqual(input);
    expect(saved[0].router).toBe(config.modelId);
    expect(saved[0].outcome.body).toEqual(body);
    expect(body.trace.request.state).toEqual(input);
    for (const secret of ['provider-secret', 'visitor-secret', 'session=private', '203.0.113.1', 'DO NOT STORE']) {
      expect(JSON.stringify(saved)).not.toContain(secret);
    }
  });
  test('does not resolve the HTTP response until persistence finishes', async () => {
    const { log } = fakeLog();
    let stored: () => void = () => {};
    let providerDone: () => void = () => {};
    const finished = new Promise<void>(resolve => { stored = resolve; });
    const ready = new Promise<void>(resolve => { providerDone = resolve; });
    log.record = async (_input, _router, run) => {
      const outcome = await run(); providerDone(); await finished;
      return { ...outcome, requestId: id };
    };
    let delivered = false;
    const pending = createApi(config, { log, fetcher })(request()).then(response => { delivered = true; return response; });
    await ready;
    expect(delivered).toBe(false);
    stored();
    expect((await pending).status).toBe(200);
  });
  test('persists sanitized provider failures and their HTTP status', async () => {
    const { log, saved } = fakeLog();
    const api = createApi(config, { log, fetcher: (async () => Response.json({ error: 'provider-secret PRIVATE UPSTREAM BODY' }, { status: 500 })) as unknown as typeof fetch });
    const response = await api(request());
    expect(response.status).toBe(502);
    expect(saved[0].outcome).toEqual({ status: 502, body: await response.json() });
    expect(JSON.stringify(saved)).not.toContain('PRIVATE UPSTREAM BODY');
  });
  test('does not store rejected, cross-origin, over-limit or malformed submissions', async () => {
    const { log, saved } = fakeLog();
    const api = createApi(config, { log, fetcher, maxPerMinute: 1 });
    for (const task of ['', 'bad\u0000task', 'bad\ud800task', 'bad\udc00task']) {
      expect((await api(request({ ...input, task }))).status).toBe(400);
    }
    expect((await api(request(input, { origin: 'https://other.example' }))).status).toBe(403);
    expect(saved).toHaveLength(0);
    expect((await api(request())).status).toBe(200);
    expect((await api(request())).status).toBe(429);
    expect(saved).toHaveLength(1);
  });
  test('cancellation is a saved 499, not a dropped completion', async () => {
    const { log, saved } = fakeLog();
    const controller = new AbortController();
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const hanging = (async (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); entered();
    })) as typeof fetch;
    const pending = createApi(config, { log, fetcher: hanging })(request(input, {}, controller.signal));
    await started; controller.abort();
    expect((await pending).status).toBe(499);
    expect(saved[0].outcome.status).toBe(499);
    expect(saved[0].aborted).toBe(true);
  });
  test('already-cancelled requests never call the provider', async () => {
    const { log, saved } = fakeLog();
    const controller = new AbortController(); controller.abort();
    let called = false;
    const response = await createApi(config, { log, fetcher: (async () => { called = true; return Response.json(completion()); }) as unknown as typeof fetch })(request(input, {}, controller.signal));
    expect(response.status).toBe(499);
    expect(called).toBe(false);
    expect(saved[0].outcome.status).toBe(499);
  });
  test('times out without losing the sanitized failure record', async () => {
    const { log, saved } = fakeLog();
    const hanging = (async (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    })) as typeof fetch;
    const response = await createApi({ ...config, timeoutMs: 5 }, { log, fetcher: hanging })(request());
    expect(response.status).toBe(504);
    expect(saved[0].outcome.status).toBe(504);
  });
  test('fails closed on storage errors without exposing driver details or retrying the provider', async () => {
    const stderr = spyOn(console, 'error').mockImplementation(() => {});
    try {
      let calls = 0;
      const tracked = (async () => { calls++; return Response.json(completion()); }) as unknown as typeof fetch;
      const { log } = fakeLog();
      log.record = async () => { throw new Error('postgresql://secret:password@private/task'); };
      const api = createApi(config, { log, fetcher: tracked });
      for (let i = 0; i < 5; i++) { // Concurrency slots must be released after every failure.
        const response = await api(request());
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain('postgresql');
      }
      expect(calls).toBe(0);
      log.record = async (_input, _router, run) => { await run(); throw new StorageError('finish', id); };
      const response = await api(request());
      expect(response.status).toBe(503);
      expect(response.headers.get('x-request-id')).toBe(id);
      expect(calls).toBe(1);
      expect(JSON.stringify(stderr.mock.calls)).not.toContain('password');
      expect(JSON.stringify(stderr.mock.calls)).toContain('request_storage_failed');
    } finally { stderr.mockRestore(); }
  });
  test('health reports database readiness without exposing connection details', async () => {
    const { log } = fakeLog();
    const api = createApi(config, { log });
    const health = () => api(new Request('http://localhost:3007/api/health'));
    expect(await (await health()).json()).toEqual({ configured: true, router: config.modelId, storage: 'ready' });
    log.healthy = async () => { throw new Error('secret database URL'); };
    const failed = await health();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ configured: true, router: config.modelId, storage: 'unavailable' });
  });
  test('uses explicit database URLs or safely encodes Compose credentials', () => {
    expect(databaseUrl({ DATABASE_URL: 'postgres://explicit/db', POSTGRES_PASSWORD: 'other' })).toBe('postgres://explicit/db');
    const password = 'p@ss:/#?%$';
    const url = new URL(databaseUrl({ POSTGRES_HOST: 'jev-db', POSTGRES_PASSWORD: password }));
    expect(url.hostname).toBe('jev-db');
    expect(decodeURIComponent(url.password)).toBe(password);
    expect(() => databaseUrl({})).toThrow('Configure DATABASE_URL');
  });
});
