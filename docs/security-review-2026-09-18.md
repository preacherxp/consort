Security review — 2026-09-18

Reviewed commit `08e5b47`, the full application, build/deployment configuration, reachable Git history, and the locally built production image. No application code or production settings were changed. No paid model requests were made.

No exploitable secret disclosure, arbitrary file read, command execution, server-side request forgery, or script injection was identified in the reviewed paths. This is a scoped review, not a guarantee that the deployed service or host is secure.

**Confirmed exposure: anonymous visitors can consume the routing budget.**

- Location: `server/app.ts:19–48`, `server/router.ts:96–99`, `Caddyfile:15`.
- Confidence: 10/10. This is intentional public functionality, not an authentication bypass.
- A valid JSON POST without `Origin`, cookies, or credentials reaches the provider. A scripted client can also supply the allowed origin. Reproduced with a fake provider and fake key; both requests returned 200 and invoked the mock.
- The global limit allows 20 requests per minute per process, with four in flight. Sustained usage can consume credits over time; process restarts reset the counters. This limiter does not impose a dollar budget.
- Existing mitigation verified: OpenRouter's read-only key metadata reports a **$5 non-resetting limit** for the local `.env` key. It is not a management key. The deployed key and its settings were not accessible, so this does not establish the production budget.
- Recommendation: keep a dedicated capped production key. If anonymous use is intended, accept that visitors can spend that allowance. If only you should use the app, require authentication at the proxy for both the UI and API. Adding stricter Origin checks does not authenticate scripted clients.

OpenRouter documents per-key spending limits and optional reset periods in its [API key documentation](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys).

**Deployment verification remains incomplete.**

At approximately 20:39 UTC, both `https://jev.purecode.sh/` and `/api/health` returned Cloudflare HTTP 525. Cloudflare defines this as a [TLS handshake failure between Cloudflare and the origin](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-525/). The response prevented verification of the actual app version, app headers, and public API behavior. It is an availability/configuration observation, not evidence of compromise. Inspect the origin TLS/Caddy configuration and logs, then repeat the public checks.

**Checks completed**

| Check | Result |
| --- | --- |
| `bun run test` | 32 tests passed, 548 assertions; provider requests mocked |
| `bun run build` | Typecheck and production build passed |
| `bun audit --json` | `{}`; no known npm advisories reported for the locked dependencies at audit time |
| `bun run test:deployment` | Passed using a fake key and isolated loopback-only Docker/Caddy stack; its temporary containers and volumes were cleaned up |
| Extra API probes | Confirmed anonymous access, rejected an untrusted origin before provider access, rejected and cancelled a streamed body over 20,000 bytes, and rejected a fifth simultaneous provider call |
| Secret scan | No matches in tracked files, built frontend, or 88 reachable historical Git blobs for the exact local provider key and selected OpenRouter/GitHub/AWS/private-key patterns; secret values were never printed |
| Local secret file | `.env` is ignored, untracked, absent from reachable history at that path, and mode `0600` |

The Docker smoke test verified the production Caddyfile, Compose overlay, anonymous page access, CSP, origin checks, non-root execution, lack of a published app host port, and absence of credential files from the image. It tests local HTTP behind Caddy; it does not validate public certificate issuance or the production firewall.

**Protections traced in code**

- The provider key is read by the server and sent only in the provider authorization header. Request traces contain the request body and allowlisted response fields, not that header. Provider error bodies are replaced with fixed messages.
- Static files are served through a map of files under `dist`; request paths are not joined into arbitrary filesystem paths. The deployment test confirmed `/.env` returns 404.
- User tasks cannot select an upstream host, API key, or router model. Strict input validation rejects extra fields. Model choices and probabilities are validated before returning them.
- User-controlled and provider-controlled text is rendered through React text/value properties or canvas text; no application HTML injection sink was found. Production CSP restricts scripts and connections to the same origin and disallows framing.
- Request bodies are bounded, upstream calls have cancellation/timeouts, and cross-origin browser requests are rejected.
- The app container runs as a non-root user with a read-only filesystem, dropped capabilities, and no-new-privileges. CI uses pinned actions, read-only default permissions, and a separate publishing job.

**Privacy and scope limits**

Task text goes to OpenRouter/TypeSafe, as disclosed beside the input. It stays in page memory locally; the reviewed app has no database, analytics, browser persistence, or task logging. Copying or saving a match includes task text. Provider retention and account privacy settings were not verified.

The secret scan is pattern-based and cannot detect every credential format or previously leaked copy outside this repository. npm auditing does not cover Bun/Caddy/Alpine vulnerabilities; a container OS/runtime advisory scan was not performed. Production host access, firewall rules, Cloudflare settings, deployed image digest, and deployed key settings were outside the accessible scope.
