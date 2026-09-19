# Deploy Consort at https://jev.purecode.sh

The image serves the built React app and API on **3007**. Only Caddy publishes ports. Caddy handles HTTPS with public access and no login; the OpenRouter key exists only in the app container's runtime environment. PostgreSQL stores admitted tasks and routing responses on a private network and persistent volume. No target models run.

**Logging-enabled releases require PostgreSQL.** Configure the database and copy its initialization script before updating a running app. The server refuses to start without working storage; deploying only the new image can otherwise cause a 502. See [request-logging.md](request-logging.md) for data handling, guarantees, queries, and backups.

## Files

- `Dockerfile`: multi-stage, frozen dependencies, build + unit tests, non-root Bun runtime, healthcheck.
- `.dockerignore`: source allowlist; `.env` files never enter the build context.
- `compose.yaml`: **standalone** Caddy + Jev + PostgreSQL deployment.
- `deploy/compose.jev.yaml`: **overlay for your existing Compose stack** on its `purecode` network; adds Jev, its private database/network/volume, and a Caddy dependency without replacing existing services.
- `deploy/postgres-init.sh`: bootstrap the dedicated database and non-superuser application role on a fresh volume.
- `deploy/compose.postgres.local.yaml`: separate loopback-only database for local development.
- `Caddyfile`: site block for `jev.purecode.sh`; append this block to your existing Caddyfile.
- `.env.production.example`: required production settings, without credentials.

Use Docker Engine and Compose **2.30+**. Do not start the standalone stack alongside your existing Caddy: ports 80/443 already belong to it.

## 1. Publish the image with GitHub Actions

`.github/workflows/docker-publish.yml` runs on branch pushes, pull requests, version tags (`v*`), and manual dispatch. It installs locked dependencies, runs typecheck/build, unit and browser tests, then the isolated Docker/Caddy smoke test. Only after success does it publish on the repository's **default branch** or a **version tag**. Pull requests and feature branches never publish.

Published image: **`ghcr.io/<repository-owner>/consort`** (for your account, `ghcr.io/preacherxp/consort`). Images support `linux/amd64` and `linux/arm64`, include OCI source/revision labels, SBOM and provenance, and use GitHub Actions build caching.

Tags:
- `latest`: default-branch builds only.
- `sha-<full-commit-sha>`: every published build.
- The exact Git tag, such as `v0.1.0`: version-tag builds. Version tags do not move `latest`.

The workflow uses the automatically supplied **`GITHUB_TOKEN`**, with `packages: write` only in the publish job. No PAT, registry password, production database password, or OpenRouter key is required in CI. The deployment tests create an isolated database with dummy credentials. **Do not add your paid provider key to CI.** Benchmarks that spend credits are opt-in and are not run by this workflow.

**Repository layout matters:** `model-router` is a standalone Git repository, with `.github/` at its root. Use the intended Consort repository (`preacherxp/model-router`), not the enclosing Incident Commander remote. For a monorepo, intentionally relocate/adapt the workflow and Docker context instead.

Once the app's intended remote is configured, push to its default branch or push a release tag:

```sh
# Run only in the app's intended Git repository, not the enclosing Incident Commander tree.
git tag v0.1.0
git push origin v0.1.0
```

The Actions run summary prints `JEV_IMAGE=ghcr.io/.../consort@sha256:...`; copy that digest reference into the server's `.env.jev` for an exact deployment. New GHCR packages may be private. Either make the package public or authenticate your server for pulls. If the package already exists, grant this repository Actions access to it in the package settings. The workflow does **not** deploy or restart your server.

### Manual publishing alternative

From the app directory on your workstation, authenticate to GHCR with your own credentials, then publish an immutable release tag:

```sh
docker login ghcr.io -u preacherxp
# Choose a unique release tag for each deployment.
export RELEASE=jev-2026-09-18-1
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/preacherxp/consort:$RELEASE --push .
```

`ghcr.io/preacherxp/consort` matches the CI image name for your account; no package has been pushed by this local setup session. Change it if desired. If the package is private, authenticate on the server with pull-only package access too. Prefer release tags or image digests over `latest`. Do not use the original Incident Commander repository as an automatic publish target.

## 2. DNS and credentials

- Point the **A record for `jev.purecode.sh`** to your server. Publish an AAAA record only if its IPv6 address is reachable. Allow inbound TCP 80/443; UDP 443 is optional for HTTP/3. Keep your other domains unchanged.
- Create a dedicated OpenRouter key with a spending cap. Do not bake it into the Docker image or commit it.
- Generate **two different database passwords**, for example by running `openssl rand -hex 32` twice. The app password and bootstrap/admin password must be distinct.

Copy `.env.production.example` to `.env.jev` **beside your existing stack's Compose file**, then `chmod 600 .env.jev`. Fill in:

```dotenv
OPENROUTER_API_KEY=your-server-side-key
POSTGRES_PASSWORD=your-random-application-database-password
POSTGRES_ADMIN_PASSWORD=your-different-random-bootstrap-password
JEV_IMAGE=ghcr.io/preacherxp/consort:jev-2026-09-18-1
```

Do not add the API key or database passwords to the Caddyfile. Only PostgreSQL receives the bootstrap password; the app receives its restricted role's password. The site has no browser login; no auth username or password hash is needed. Environment variables are visible to Docker administrators; this is not an external secret manager.

## 3. Add to your existing stack (recommended)

Keep your existing `compose.yaml`, Caddy volumes and networks. Copy `deploy/compose.jev.yaml` beside it as `compose.jev.yaml`, and copy `deploy/postgres-init.sh` beside the **base** Compose file as `postgres-init.sh` (bind-mount paths are resolved against that base directory). Back up your existing Caddyfile, then **append** the block from this project's `Caddyfile`; do not replace the other sites.

From your existing stack directory:

```sh
# First --env-file preserves settings already used by your other services.
# If your stack has no .env, omit that first --env-file .env argument.
docker compose --env-file .env --env-file .env.jev \
  -f compose.yaml -f compose.jev.yaml config --quiet

docker compose --env-file .env --env-file .env.jev \
  -f compose.yaml -f compose.jev.yaml pull jev jev-db

# Validate the complete Caddyfile without binding ports or touching running sites.
docker compose --env-file .env --env-file .env.jev \
  -f compose.yaml -f compose.jev.yaml run --rm --no-deps caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Start the database first; do not update the app before it is healthy.
docker compose --env-file .env --env-file .env.jev \
  -f compose.yaml -f compose.jev.yaml up -d --no-deps --wait jev-db

docker compose --env-file .env --env-file .env.jev \
  -f compose.yaml -f compose.jev.yaml up -d --no-deps --wait jev

# Reload the running proxy with the validated site block.
docker compose --env-file .env --env-file .env.jev \
  -f compose.yaml -f compose.jev.yaml exec caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Substitute your actual base filename (for example `docker-compose.yml`). The overlay reuses the existing `purecode` network; it does not create a second Compose project or an external network. Use the **same project name/directory as your running stack** so network and volume names stay unchanged. Do not run `down`, especially not `down -v`, on the shared production stack.

Verify:

```sh
# Expect 200 without credentials. HTTPS must validate normally; do not use -k.
curl -I https://jev.purecode.sh
curl https://jev.purecode.sh/api/health
# Expected JSON: {"configured":true,"router":"typesafe/jev-1.13","storage":"ready"}
```

Open the domain in a browser and submit a small task. That last step makes a paid Jev request. Healthchecks and page loads do not. If TLS fails, check DNS (including stale AAAA records), firewall, and Caddy logs. If the app is unhealthy, check its runtime key, database health/credentials, and app logs. Preserve Caddy's `/data` and `/config` volumes and `jev_db_data`; deleting the database volume deletes recorded tasks and outcomes.

## Standalone alternative

Only use this when no existing proxy owns ports 80/443. In this project directory:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
# Fill in the OpenRouter key and the two distinct database passwords.
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up -d --build --wait
```

This builds locally; a registry is not required. The configured image name is simply the local image tag when building this way. DNS/TLS requirements and public access are the same.

## Updates and rollback

Publish a new release tag, update `JEV_IMAGE` in `.env.jev`, then repeat `pull jev` and `up -d --no-deps --wait jev` with the same two Compose files and environment files. Caddy does not need to restart for app-only updates. The app drains active requests on shutdown and Compose allows 70 seconds, but single-replica updates are not zero-downtime orchestration. Back up the database before schema upgrades. Initialization runs only for a fresh database volume; changing password environment values does not rotate existing PostgreSQL roles (see request-logging.md).

To roll back, restore the previous image tag and repeat those commands. For Caddyfile-only changes, validate first and use `exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.

## Public access and spending safety

The supplied site is intentionally public, with no password prompt. A missing provider key or database password fails Compose validation. The app has no published host port, so the proxy is the only public entry point. If upgrading from the password-protected configuration, remove the old site's `basic_auth` block and obsolete `JEV_AUTH_USER` / `JEV_AUTH_HASH` settings, then validate and reload Caddy.

The OpenRouter key stays server-side; public routing requests use its credits. The existing in-memory limiter is **20 requests/minute and four concurrent requests per process**, not a per-user quota or distributed abuse defense. Keep one replica and a provider spending cap. TLS and origin checks are not spending limits.

The credentials in the commented unrelated services from your reference configuration are not copied here. If those pasted values are real, rotate them, even though those services are commented out.

## Troubleshooting HTML / gateway errors

An `Unexpected token '<'` JSON error means the browser received HTML from `/api/route`, not a valid application response. The frontend now handles non-JSON bodies, gateway errors, access blocks, and malformed responses without displaying parser internals. This improves the message; it does **not** repair an unavailable origin.

First check `https://jev.purecode.sh/api/health`. It must return JSON, not a login page, SPA document, or Cloudflare error. A 502 on both `/` and `/api/health` points to a gateway/origin problem before task routing. A 200 HTML response on an API path suggests a static-site fallback or the wrong upstream.

On the server, identify the actual container names and inspect them (no environment-file interpolation is needed for these read-only commands):

```sh
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
# Replace these names with the app/proxy containers from the list.
docker logs --tail=80 YOUR_JEV_CONTAINER
docker logs --tail=80 YOUR_CADDY_CONTAINER
docker exec YOUR_CADDY_CONTAINER wget -S -O - http://jev:3007/api/health
```

- If the app is exiting/restarting, fix the startup error reported by its logs.
- If Caddy cannot resolve or connect to `jev`, verify both containers share the same actual Docker network, the app binds to `0.0.0.0:3007`, and the site's upstream is `jev:3007` without stripping `/api`.
- If the internal health request succeeds but the public request fails, inspect the active Caddy site configuration, Cloudflare origin settings, and DNS. Validate and reload the correct Caddyfile, not another Compose project's proxy.
- Cloudflare 403/1010 responses or `cf-mitigated: challenge` indicate an edge access/browser-integrity rule. Check the matching Ray ID in Cloudflare security events and verify the API works from a normal browser. Do not assume a blocked diagnostic client proves the app is down, or disable security globally to work around an API challenge.
- A Cloudflare 525 is a separate origin TLS handshake failure. Fix origin TLS; do not turn off HTTPS verification to hide it.

Redact credentials before sharing logs. Do not share `.env` or full `docker compose config` output. Redeploy the frontend error-handling update separately from fixing the proxy/origin; no automatic retries are added to paid requests.

## Local verification

```sh
bun run test:deployment
```

Builds the image and starts an isolated test stack using dummy provider/database credentials, a local fake provider, HTTP on an ephemeral **loopback-only** port, and its own temporary Docker volumes. It validates the real HTTPS Caddyfile, checks overlay merging, anonymous page/API access, health, CSP, origin enforcement, secret-file absence, and non-root execution. Real PostgreSQL tests cover migrations, restricted role permissions, full input/response persistence, HTTP cancellation, write retries, outages and restart durability. It deletes only its own test containers/volumes afterward. No public DNS, certificate issuance, registry push or paid API call is involved. Docker must be running.
