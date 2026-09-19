import { SQL } from 'bun';
import type { Priority, RouteResult } from '../shared/contracts';

type Input = { task: string; priority: Priority };
export type RoutingOutcome = { status: number; body: RouteResult | { error: string }; requestId?: string };
export class StorageError extends Error {
  constructor(public phase: 'start' | 'finish', public requestId: string) {
    super(phase === 'start' ? 'Request storage is unavailable. Please try again later.' : 'The routing result could not be saved. Please try again later.');
  }
}
export interface RequestLog {
  // Persist an attempt before invoking run; persist its outcome before returning.
  record(input: Input, router: string, run: () => Promise<RoutingOutcome>, signal?: AbortSignal): Promise<RoutingOutcome>;
  healthy(): Promise<boolean>;
  close(): Promise<void>;
}

export function databaseUrl(env: Record<string, string | undefined>): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_HOST && env.POSTGRES_PASSWORD) {
    return `postgresql://consort:${encodeURIComponent(env.POSTGRES_PASSWORD)}@${env.POSTGRES_HOST}:5432/consort`;
  }
  throw new Error('Configure DATABASE_URL or the Compose PostgreSQL settings.');
}

export async function openRequestLog(url: string): Promise<RequestLog> {
  if (!/^postgres(?:ql)?:\/\//.test(url)) throw new Error('A PostgreSQL connection URL is required.');
  const sql = new SQL(url, {
    max: 5, connectionTimeout: 3, idleTimeout: 30,
    connection: { statement_timeout: 2500, lock_timeout: 1500, application_name: 'consort' },
  });
  // A client deadline also bounds a broken connection after it has been established.
  async function bounded<T>(query: PromiseLike<T> & { cancel(): unknown }): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([Promise.resolve(query), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Storage timeout.'));
          try { query.cancel(); } catch { /* The deadline still rejects if cancellation fails. */ }
        }, 4000);
      })]);
    } finally { clearTimeout(timer!); }
  }
  try {
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(741029311)`;
      await tx`CREATE TABLE IF NOT EXISTS consort_schema_migrations (
        version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      )`;
      const applied = await tx`SELECT version FROM consort_schema_migrations WHERE version = 1`;
      if (applied.length) return;
      await tx`CREATE TABLE routing_requests (
        id uuid PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        task text NOT NULL,
        priority text NOT NULL CHECK (priority IN ('balanced', 'speed', 'cost', 'quality')),
        router text NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
        http_status integer,
        elapsed_ms integer,
        client_aborted boolean NOT NULL DEFAULT false,
        input jsonb NOT NULL,
        response jsonb,
        CHECK (char_length(task) BETWEEN 1 AND 4000),
        CHECK ((status = 'pending' AND completed_at IS NULL AND response IS NULL)
          OR (status <> 'pending' AND completed_at IS NOT NULL AND response IS NOT NULL AND http_status IS NOT NULL))
      )`;
      await tx`CREATE INDEX routing_requests_created_at_idx ON routing_requests (created_at DESC)`;
      await tx`CREATE INDEX routing_requests_status_idx ON routing_requests (status, created_at DESC)`;
      await tx`CREATE INDEX routing_requests_model_idx ON routing_requests ((response->>'modelId')) WHERE status = 'succeeded'`;
      await tx`INSERT INTO consort_schema_migrations (version) VALUES (1)`;
    });
  } catch {
    await sql.close({ timeout: 1 }).catch(() => {});
    throw new Error('PostgreSQL initialization failed. Check database connectivity and permissions.');
  }
  let healthAt = 0;
  let health = Promise.resolve(true);
  return {
    async record(input, router, run, signal) {
      const id = crypto.randomUUID();
      const started = performance.now();
      try {
        await bounded(sql`INSERT INTO routing_requests (id, task, priority, router, input)
          VALUES (${id}, ${input.task}, ${input.priority}, ${router}, ${input}::jsonb)`);
      } catch { throw new StorageError('start', id); }
      let outcome: RoutingOutcome;
      try {
        outcome = signal?.aborted
          ? { status: 499, body: { error: 'Routing cancelled.' } }
          : await run();
      } catch { outcome = { status: 500, body: { error: 'Routing failed. Please try again.' } }; }
      const status = outcome.status === 200 ? 'succeeded' : outcome.status === 499 ? 'cancelled' : 'failed';
      const elapsed = Math.round(performance.now() - started);
      const aborted = signal?.aborted ?? false;
      // Bun SQL serializes object parameters for JSONB; pre-stringifying would double-encode them.
      const body = outcome.body;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // Idempotent update: retry only persistence, never the paid provider operation.
          const updated = await bounded(sql`UPDATE routing_requests SET completed_at = now(), status = ${status},
            http_status = ${outcome.status}, elapsed_ms = ${elapsed}, client_aborted = ${aborted}, response = ${body}::jsonb
            WHERE id = ${id} RETURNING id`);
          if (updated.length !== 1) throw new Error('Missing request record.');
          return { ...outcome, requestId: id };
        } catch {
          if (attempt === 1) throw new StorageError('finish', id);
          await Bun.sleep(100);
        }
      }
      throw new StorageError('finish', id);
    },
    healthy() {
      // Coalesce public health probes rather than opening a query for every caller.
      if (Date.now() - healthAt >= 5000) {
        healthAt = Date.now();
        health = bounded(sql`SELECT has_table_privilege(current_user, 'routing_requests', 'INSERT')
          AND has_table_privilege(current_user, 'routing_requests', 'UPDATE')
          AND has_table_privilege(current_user, 'routing_requests', 'SELECT') AS ready`)
          .then(rows => rows[0]?.ready === true, () => false);
      }
      return health;
    },
    close: () => sql.close({ timeout: 5 }),
  };
}
