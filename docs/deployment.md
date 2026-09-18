# Deploy Consort at https://jev.purecode.sh

The image serves the built React app and API on **3007**. Only Caddy publishes ports. Caddy handles HTTPS with public access and no login; the OpenRouter key exists only in the app container's runtime environment. No target models run.

## Files

- `Dockerfile`: multi-stage, frozen dependencies, build + unit tests, non-root Bun runtime, healthcheck.
- `.dockerignore`: source allowlist; `.env` files never enter the build context.
- `compose.yaml`: **standalone** Caddy + Jev deployment.
- `deploy/compose.jev.yaml`: **overlay for your existing Compose stack** on its `purecode` network; adds Jev and a Caddy dependency without replacing existing services.
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

The workflow uses the automatically supplied **`GITHUB_TOKEN`**, with `packages: write` only in the publish job. No PAT, registry password, or OpenRouter key is required in CI. **Do not add your paid provider key to CI.** Benchmarks that spend credits are opt-in and are not run by this workflow.

**Repository layout matters:** `model-router` is now a standalone local Git repository, with `.github/` at its root. No remote is configured and nothing has been pushed. Connect it to the intended Consort repository before publishing; do not reuse the enclosing Incident Commander remote. For a monorepo, intentionally relocate/adapt the workflow and Docker context instead.

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
Copy `.env.production.example` to `.env.jev` **beside your existing stack's Compose file**, then `chmod 600 .env.jev`. Fill in:

```dotenv
OPENROUTER_API_KEY=your-server-side-key
JEV_IMAGE=ghcr.io/preacherxp/consort:jev-2026-09-18-1
```

Do not add the API key to the Caddyfile. The site has no browser login; no auth username or password hash is needed. Environment variables are visible to Docker administrators; this is not an external secret manager.

## 3. Add to your existing stack (recommended)

Keep your existing `compose.yaml`, Caddy volumes and networks. Copy `deploy/compose.jev.yaml` beside it as `compose.jev.yaml`. Back up your existing Caddyfile, then **append** the block from this project's `Caddyfile`; do not replace the other sites.

From your existing stack directory:

```sh
# First --env-file preserves settings already used by your other services.
# If your stack has no .env, omit that first --env-file .env argument.
docker compose --env-file .env --env-file .env.jev \
  -f compose.yaml -f compose.jev.yaml config --quiet

docker compose --env-file .env --env-file .env.jev \
  -f compose.yaml -f compose.jev.yaml pull jev

# Validate the complete Caddyfile without binding ports or touching running sites.
docker compose --env-file .env --env-file .env.jev \
  -f compose.yaml -f compose.jev.yaml run --rm --no-deps caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

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
# Expected JSON: {"configured":true,"router":"typesafe/jev-1.13"}
```

Open the domain in a browser and submit a small task. That last step makes a paid Jev request. Healthchecks and page loads do not. If TLS fails, check DNS (including stale AAAA records), firewall, and Caddy logs. If the app is unhealthy, check its runtime key and app logs. Preserve `/data` and `/config` volumes so certificate state survives restarts.

## Standalone alternative

Only use this when no existing proxy owns ports 80/443. In this project directory:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
# Fill in the server-side OpenRouter key.
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up -d --build --wait
```

This builds locally; a registry is not required. The configured image name is simply the local image tag when building this way. DNS/TLS requirements and public access are the same.

## Updates and rollback

Publish a new release tag, update `JEV_IMAGE` in `.env.jev`, then repeat `pull jev` and `up -d --no-deps --wait jev` with the same two Compose files and environment files. Caddy does not need to restart for app-only updates. Single-replica updates can briefly interrupt in-flight requests; this is not zero-downtime orchestration.

To roll back, restore the previous image tag and repeat those commands. For Caddyfile-only changes, validate first and use `exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.

## Public access and spending safety

The supplied site is intentionally public, with no password prompt. A missing provider key still fails Compose validation. The app has no published host port, so the proxy is the only public entry point. If upgrading from the password-protected configuration, remove the old site's `basic_auth` block and obsolete `JEV_AUTH_USER` / `JEV_AUTH_HASH` settings, then validate and reload Caddy.

The OpenRouter key stays server-side; public routing requests use its credits. The existing in-memory limiter is **20 requests/minute and four concurrent requests per process**, not a per-user quota or distributed abuse defense. Keep one replica and a provider spending cap. TLS and origin checks are not spending limits.

The credentials in the commented unrelated services from your reference configuration are not copied here. If those pasted values are real, rotate them, even though those services are commented out.

## Local verification

```sh
bun run test:deployment
```

Builds the image and starts an isolated test stack using a dummy provider key, HTTP on an ephemeral **loopback-only** port, and its own temporary Docker volumes. It validates the real HTTPS Caddyfile, checks overlay merging, anonymous page/API access, health, CSP, origin enforcement, secret-file absence and non-root execution. It deletes only its own test containers/volumes afterward. No public DNS, certificate issuance, registry push or paid API call is involved. Docker must be running.
