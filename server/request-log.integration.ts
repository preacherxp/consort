// Run only inside the isolated test:deployment stack, mounted temporarily into the runtime image.
import assert from 'node:assert/strict';
import { SQL } from 'bun';
import { createApi } from './app';
import { databaseUrl, openRequestLog } from './request-log';

assert.equal(process.env.CONSORT_DATABASE_TEST, '1', 'Use bun run test:deployment, not a real database');
assert.equal(process.env.OPENROUTER_API_KEY, 'smoke-test-not-a-real-key');
const url = databaseUrl(process.env);
const sql = new SQL(url, { max: 2, connectionTimeout: 3 });
const log = await openRequestLog(url);
const config = { apiKey: 'smoke-test-not-a-real-key', baseUrl: 'https://unused.example/api/v1', modelId: 'typesafe/jev-1.13' };
const raw = {
  model: config.modelId, id: 'synthetic-postgres-test', private_metadata: 'PRIVATE MUST NOT BE STORED',
  answers: {
    model: { type: 'choice', choice: 'anthropic/claude-sonnet-5', confidence: .62, probabilities: { 'anthropic/claude-sonnet-5': .7, 'anthropic/claude-opus-5': .3 } },
    effort: { type: 'choice', choice: 'high' }, taskType: { type: 'choice', choice: 'code' },
    budgetModel: { type: 'choice', choice: 'none' },
  }, usage: { input_tokens: 100, output_tokens: 10, cost: .00001 },
};
const fake = (async () => Response.json(raw)) as unknown as typeof fetch;
function request(task: string, signal?: AbortSignal) {
  return new Request('http://localhost:3007/api/route', { method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: 'Bearer VISITOR-SECRET', cookie: 'private=cookie' },
    body: JSON.stringify({ task, priority: 'balanced' }),
  });
}
const count = async () => Number((await sql`SELECT count(*) AS count FROM routing_requests`)[0].count);
const rowFor = async (id: string | null) => (await sql`SELECT * FROM routing_requests WHERE id = ${id}::uuid`)[0];
try {
  assert.equal(await count(), 0, 'Refuse to run against a database containing requests');
  const [role] = await sql`SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
  assert.equal(role.name, 'consort');
  assert.equal(role.rolsuper, false); assert.equal(role.rolcreatedb, false); assert.equal(role.rolcreaterole, false);
  assert.equal(await log.healthy(), true);

  const task = "Review O'Reilly's SQL: '); DROP TABLE routing_requests; -- 日本語 🩷";
  let providerCalls = 0;
  const beforeProvider = (async () => {
    providerCalls++;
    const [pending] = await sql`SELECT * FROM routing_requests WHERE task = ${task}`;
    assert.equal(pending.status, 'pending'); assert.equal(pending.response, null);
    return Response.json(raw);
  }) as unknown as typeof fetch;
  const response = await createApi(config, { log, fetcher: beforeProvider })(request(task));
  assert.equal(response.status, 200);
  const record = await rowFor(response.headers.get('x-request-id'));
  assert.equal(record.task, task); assert.deepEqual(record.input, { task, priority: 'balanced' });
  assert.deepEqual(record.response, await response.json());
  assert.equal(record.status, 'succeeded'); assert.equal(record.http_status, 200);
  assert(record.completed_at >= record.created_at); assert(record.elapsed_ms >= 0);
  assert.equal(providerCalls, 1);
  const serialized = JSON.stringify(record);
  for (const secret of ['PRIVATE MUST NOT BE STORED', 'VISITOR-SECRET', 'private=cookie', config.apiKey, process.env.POSTGRES_PASSWORD!]) {
    assert(!serialized.includes(secret));
  }

  // JavaScript's input limit uses UTF-16 code units; PostgreSQL counts Unicode code points.
  const emoji = await createApi(config, { log, fetcher: fake })(request('🩷🩷🩷🩷'));
  assert.equal(emoji.status, 200); assert.equal((await rowFor(emoji.headers.get('x-request-id'))).task, '🩷🩷🩷🩷');
  const concurrent = createApi(config, { log, fetcher: fake });
  const four = await Promise.all(Array.from({ length: 4 }, (_, index) => concurrent(request(`Concurrent routing ${index}`))));
  assert(four.every(response => response.status === 200));
  assert.equal(new Set(four.map(response => response.headers.get('x-request-id'))).size, 4);

  const failure = await createApi(config, { log, fetcher: (async () => Response.json({ error: 'PRIVATE FAILURE' }, { status: 500 })) as unknown as typeof fetch })(request('Provider failure example'));
  assert.equal(failure.status, 502);
  const failed = await rowFor(failure.headers.get('x-request-id'));
  assert.equal(failed.status, 'failed'); assert.equal(failed.http_status, 502);
  assert.deepEqual(failed.response, await failure.json());
  assert(!JSON.stringify(failed).includes('PRIVATE FAILURE'));

  const controller = new AbortController();
  let entered: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const hanging = (async (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); entered();
  })) as typeof fetch;
  const cancelling = createApi(config, { log, fetcher: hanging })(request('Cancellation during provider call', controller.signal));
  await started; controller.abort();
  const cancelled = await cancelling;
  assert.equal(cancelled.status, 499);
  const cancelledRow = await rowFor(cancelled.headers.get('x-request-id'));
  assert.equal(cancelledRow.status, 'cancelled'); assert.equal(cancelledRow.client_aborted, true);
  const timedOut = await createApi({ ...config, timeoutMs: 10 }, { log, fetcher: hanging })(request('Timeout during provider call'));
  assert.equal(timedOut.status, 504);
  assert.equal((await rowFor(timedOut.headers.get('x-request-id'))).http_status, 504);

  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  let ran = false;
  const aborted = await log.record({ task: 'Already cancelled request', priority: 'balanced' }, config.modelId, async () => {
    ran = true; return { status: 200, body: { error: 'Unreachable' } };
  }, alreadyAborted.signal);
  assert.equal(ran, false); assert.equal((await rowFor(aborted.requestId!)).status, 'cancelled');
  const crashed = await log.record({ task: 'Unexpected callback failure', priority: 'balanced' }, config.modelId, async () => { throw new Error('PRIVATE EXCEPTION'); });
  assert.equal(crashed.status, 500);
  assert(!JSON.stringify(await rowFor(crashed.requestId!)).includes('PRIVATE EXCEPTION'));

  // A PostgreSQL sequence survives rollback: deterministically fail exactly the first update.
  await sql`CREATE SEQUENCE test_update_attempts`;
  await sql`CREATE FUNCTION test_fail_once() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF nextval('test_update_attempts') = 1 THEN RAISE EXCEPTION 'synthetic transient write failure'; END IF; RETURN NEW; END $$`;
  await sql`CREATE TRIGGER test_fail_once BEFORE UPDATE ON routing_requests FOR EACH ROW EXECUTE FUNCTION test_fail_once()`;
  try {
    let calls = 0;
    const retried = await createApi(config, { log, fetcher: (async () => { calls++; return Response.json(raw); }) as unknown as typeof fetch })(request('Retry persistence, never provider'));
    assert.equal(retried.status, 200); assert.equal(calls, 1);
    assert.equal(Number((await sql`SELECT last_value FROM test_update_attempts`)[0].last_value), 2);
    assert.equal((await rowFor(retried.headers.get('x-request-id'))).status, 'succeeded');
  } finally {
    await sql`DROP TRIGGER test_fail_once ON routing_requests`;
    await sql`DROP FUNCTION test_fail_once()`; await sql`DROP SEQUENCE test_update_attempts`;
  }

  // The normal application role must honor revocation, unlike a superuser.
  const before = await count();
  await sql`REVOKE INSERT ON routing_requests FROM consort`;
  try {
    let calls = 0;
    const denied = await createApi(config, { log, fetcher: (async () => { calls++; return Response.json(raw); }) as unknown as typeof fetch })(request('Cannot start without durable storage'));
    assert.equal(denied.status, 503); assert.equal(calls, 0); assert.equal(await count(), before);
  } finally { await sql`GRANT INSERT ON routing_requests TO consort`; }
  await sql`REVOKE UPDATE ON routing_requests FROM consort`;
  try {
    let calls = 0;
    const denied = await createApi(config, { log, fetcher: (async () => { calls++; return Response.json(raw); }) as unknown as typeof fetch })(request('Outcome storage unavailable'));
    assert.equal(denied.status, 503); assert.equal(calls, 1);
    const incomplete = await rowFor(denied.headers.get('x-request-id'));
    assert.equal(incomplete.status, 'pending'); assert.equal(incomplete.response, null);
  } finally { await sql`GRANT UPDATE ON routing_requests TO consort`; }

  const reopened = await openRequestLog(url);
  try {
    assert.equal(await reopened.healthy(), true);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM consort_schema_migrations`)[0].count), 1);
    assert(await count() >= 13);
  } finally { await reopened.close(); }
  console.log('PASS: real PostgreSQL migrations, restricted role, durable ordering, complete responses, Unicode/SQL quoting, concurrency, failures, cancellation, timeout, write retries, and fail-closed behavior.');
} finally { await log.close(); await sql.close({ timeout: 1 }); }
