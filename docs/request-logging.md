# Durable request logging

Consort stores **admitted routing requests** in PostgreSQL, quietly on the server. The composer and catalog dialog disclose this. There is no keystroke tracker, client analytics script, tracking cookie, or public log-reading endpoint.

## What is saved

`routing_requests` contains:

- UUID `id` (also returned as the `X-Request-ID` response header).
- Database `created_at` / `completed_at` timestamps.
- Normalized `task`, `priority`, requested `router`, and the complete validated `input` as JSONB.
- `status`: `pending`, `succeeded`, `failed`, or `cancelled`.
- HTTP outcome status, `elapsed_ms`, and whether a client abort was observed before finalizing.
- `response`: the exact validated client response as JSONB. Successful results include the recommendation, effort, alternative, complete decision trace/criteria, returned probabilities/confidence, and usage/cost when actually reported. Errors contain only the sanitized error returned by the application.

`elapsed_ms` covers time from starting the initial database write through the routing outcome, before the final write/retry; `response.elapsedMs` remains the original Jev round-trip measurement. Neither is a target-model execution benchmark. Unknown usage/cost stays absent, not zero.

Not collected: unsubmitted text, swipes/match choices, IP addresses, request headers/cookies, application credentials, provider authorization headers, or unallowlisted upstream metadata/error bodies. **Text entered by users is retained verbatim after trimming**, so a user-pasted secret would still be part of the submitted task. The UI warns against sensitive input. Cloudflare/Caddy and upstream providers can have separate logging policies.

Origin/content-type/size/schema validation and spending limits run before logging. Invalid, rejected, and over-limit requests are not stored. Null characters and invalid Unicode are rejected because PostgreSQL JSONB cannot represent them. Healthchecks and static page loads do not create rows. Only calls through `/api/route` use this logger; opt-in benchmark scripts keep their separate synthetic result files.

## Durability and failure behavior

1. Insert a `pending` row and wait for PostgreSQL to commit it.
2. Make the single Jev request.
3. Persist its result, sanitized failure, or observed cancellation before sending the response.

The production entry point requires PostgreSQL; it cannot silently disable logging. Initial migrations are transactional and guarded by an advisory lock. Startup failures and storage failures emit structured **metadata-only** stderr events, never raw driver exceptions or task bodies.

If the initial insert fails, return **503 without calling Jev**. If finalization fails, retry that write once—not the paid provider request. If both writes fail, return 503 rather than claim the result was saved. `X-Request-ID` and the `request_storage_failed` event identify the attempt. Query/connection deadlines and a small connection pool bound ordinary storage failures. Health checks coalesce for five seconds and return 503 if storage is unavailable. Graceful shutdown drains active work; Compose allows 70 seconds.

A process kill, host failure, or permanent final-write failure can leave a `pending` row without a result. This is deliberate evidence of an **incomplete attempt**, not success and not proof that the provider was never called. There is no exactly-once distributed transaction with OpenRouter, no disk fallback containing prompts, and no automatic provider replay. A 503 during finalization can follow a billed provider call. Final database commit does not prove the client received the HTTP response.

## Deployment

See [deployment.md](deployment.md) for rollout. The provided Compose files add:

- `jev-db` (PostgreSQL 17), with persistent `jev_db_data`.
- An internal `jev_storage` network shared only by the app and database; no public database port.
- `POSTGRES_ADMIN_PASSWORD` for bootstrap/admin access, passed only to the database.
- `POSTGRES_PASSWORD` for the non-superuser `consort` application role, scoped to its own database. It can migrate its schema but cannot create databases/roles or access other applications' databases by default.

`deploy/postgres-init.sh` creates that role/database on a **fresh volume only**. Editing password environment variables does not change existing database passwords: rotate the database roles interactively with `psql`'s `\password`, then update the matching environment values and restart the affected containers. Never erase a volume to rotate a password.

For an existing/managed PostgreSQL instance, supply `DATABASE_URL` to the application container instead of the bundled host/password settings, remove the bundled `jev-db` dependency/service, and provide a dedicated role with schema migration privileges. Configure verified TLS according to your database provider. Do not reuse another application's database credentials. Connection strings stay server-side and must not use a `VITE_` prefix.

## Local development

Set the database fields in `.env.example` alongside the OpenRouter settings; use distinct random passwords and put the application password into `DATABASE_URL` (URL-encode it if necessary). Then:

```sh
docker compose --env-file .env -f deploy/compose.postgres.local.yaml up -d --wait
bun run dev
```

Alternatively, keep database settings in ignored `.env.local`; Bun loads it automatically, and pass `--env-file .env.local` to the local Compose command. The local database has its **own** `consort-local` project/volume and binds only `127.0.0.1:5438`. It does not reuse Incident Commander's database. Stop it without deleting data using the same Compose command with `stop` instead of `up -d --wait`.

## Inspect records privately

Run these commands on the database host with the same Compose file/environment flags used for deployment. Do not expose PostgreSQL or build a public `/api/logs` endpoint.

```sh
docker compose exec jev-db psql -U postgres -d consort
```

```sql
-- Recent outcomes, without dumping prompt text by default.
SELECT id, created_at, status, http_status, priority,
       response->>'modelId' AS model,
       response->>'effort' AS effort,
       response #>> '{trace,response,usage,cost}' AS reported_cost,
       elapsed_ms
FROM routing_requests ORDER BY created_at DESC LIMIT 50;

-- Inspect one request only when needed (replace the UUID).
SELECT input, response FROM routing_requests
WHERE id = '00000000-0000-0000-0000-000000000000';

-- Incomplete attempts; do not automatically rerun them.
SELECT id, created_at, router FROM routing_requests
WHERE status = 'pending' AND created_at < now() - interval '5 minutes';
```

## Retention, backups, and deletion

There is **no automatic expiry**: records remain until the operator deletes them, as the UI states. Define your retention/access policy and restrict database/backup access. JSONB data is not encrypted by the application; protect disks and backups appropriately. Keep exports out of Git—`backups/`, `exports/`, and `*.dump` are ignored.

Example manual retention operation, **only after deciding on a 30-day policy**:

```sql
BEGIN;
DELETE FROM routing_requests WHERE created_at < now() - interval '30 days';
COMMIT;
```

Deleting rows does not delete old backups. Apply the same retention policy to backups/exports. To take a private logical backup (add your deployment's Compose flags):

```sh
umask 077
mkdir -p backups
docker compose exec -T jev-db pg_dump -U postgres -d consort -Fc > backups/consort.dump
```

Back up before schema upgrades; never run `down -v` against production. Future migrations should preserve rollback compatibility or explicitly document restoration. This initial migration is additive.

## Verification

`bun run test` covers the logging integration with injected storage. `bun run test:deployment` adds real PostgreSQL checks: restricted role, idempotent migrations, pre-provider insertion, complete JSONB round-trips, SQL quoting/Unicode, concurrency, errors, cancellation, timeouts, transient/permanent write failures, database outage/recovery, and persistence across database/app restarts. It also exercises the actual HTTP stack against a local fake provider. No paid API calls or real user data are used.
