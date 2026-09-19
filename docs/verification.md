# Verification — Consort matchmaking

## Passed

- `bun run build`: strict TypeScript check and production Vite bundle.
- `bun run test`: 43 tests / 607 assertions, covering all four Decisions questions, candidate/score validation, metadata allowlisting, budget checks, effort preservation, timeouts, cancellation, origins, rate limits and sanitized errors. Match-deck tests verify provenance, no invented candidates, no duplicate introductions, filtering of zero-score entries while retaining genuinely scored older runners-up, immutable Jev traces and accurate user-choice copy.
- `bun run test:e2e`: 36 Playwright tests across desktop and mobile Chromium. Left-drag passes and right-drag matches; equivalent buttons and keyboard activation work. Undo, matching a runner-up, one-model/shortlist exhaustion behavior, replay, reduced motion, copy/PNG download, introduction history, error/retry/cancel, exact decision scores and request/response inspection all pass. Browsing and matching make no additional API calls.
- UI sizing assertions: primary action at least 18px; task input at least 22px.
- Axe WCAG A/AA scans on initial, profile, matched, inspector and catalog-dialog states: no reported violations in those scans. Not a complete accessibility audit.
- Visually inspected the minimal desktop/mobile single-column layout, compact profiles above the input, matched reveal and exported PNG.
- Browser tests assert profile-before-composer geometry and DOM order, collapsed decision details, and absence of the removed footer/slogans.
- Ten task presets populate the composer without submitting or changing priority. Search animation tests verify pending-only card motion, reduced-motion fallback, disabled duplicate submission, accessible cancellation, no overflow, and exactly one API request.
- Gateway/error regression tests cover HTML 502 responses, successful HTML SPA fallbacks, HTML access blocks, malformed JSON, and incomplete JSON. They preserve the task, suppress raw proxy/parser details, and verify explicit retry without automatic paid requests.
- Refined UI tests verify that the same recommendation surface persists through idle/search/result, matching retains the profile DOM node, the sliding highlight settles onto its selected radio, swipe-to-match returns the card to center, and the full profile fits its non-scaling stage at 320px width.
- Unit tests assert all 11 explicit exclusions are absent from the catalog and both Jev model-selection questions.

## PostgreSQL request logging

- Unit tests exercise exact validated input/response capture, no header/credential/unknown-metadata collection, response delivery only after persistence, sanitized failure/cancellation/timeout outcomes, rejected-input exclusion, failed-storage admission, readiness, and password URL encoding.
- `bun run test:deployment` passed with real PostgreSQL 17 and the production runtime. Verified transactional/idempotent migrations, a non-superuser app role, durable insertion before provider execution, JSONB round-trips, quoted SQL/Unicode text, concurrent requests, saved errors/cancellations/timeouts, a deterministic transient update failure, and permanent insert/update failures without provider replay.
- Actual HTTP-through-Caddy tests use a local fake provider to verify persisted response equality and cancellation propagation into Bun/PostgreSQL. During a database outage, health and new routing requests return JSON 503s. Rows survive database and app restarts; no public log-reading endpoints are exposed.
- Runtime image excludes credential files, and the app receives no bootstrap/admin database password. Production database ports are not published and the storage network is internal. Tests remove only their isolated containers/volumes.
- The local preview uses a separate persistent `consort-local` database; its generated credentials are in ignored, mode-0600 `.env.local`. No Incident Commander database or credentials were reused. No paid API calls were made for this logging verification.
- Browser tests verify storage disclosure beside the composer and in the catalog dialog. Records persist until operator deletion; unsubmitted text/keystrokes are not logged. No production logging deployment was performed by this work.

## Earlier v4 production matchmaking smoke

Production browser → local API → actual Jev, using the quick-fix example:

- Qwen3.8 Flash / low effort returned successfully from the 38-model candidate set, with `task-evidence-v4` verified in the actual trace.
- Verified profile-before-input geometry and complete footer removal on the production build.
- No browser page errors. Browser regression tests separately verify swiping/matching makes no additional API calls.
- `preview.png`, `match-preview.png`, and `decision-preview.png` capture that earlier live result.

## Current routing calibration and CI

- Current policy: `benchmark-evidence-v5.1`. Retains v4 factual criteria and task-stable ordering, and now includes 44 measured observations across 11 models, with dated protocol and provenance. Untested models/Pro variants remain untested. Formatting, correctness, token exhaustion and transport errors remain distinct; hard eligibility takes precedence.
- Six evidence-specific unit tests validate the snapshot against raw observations, score/format distinctions, missing evidence, both routing questions, provenance, and rejection of inconsistent/duplicate observations. The browser inspector exposes the same evidence sent to Jev.
- An initial eight-case benchmark-informed check caught a context regression. The failed run is preserved; after strengthening the final eligibility check, the v5.1 16-case check passed all defined effort and hard constraints. This is not a guarantee of optimality.
- See `routing-benchmark-2026-09-18.md` for 64 live routing calls and 44 real model probes. No optimality or general unbiasedness claim; candidate-order sensitivity remains observable.
- GitHub Actions workflow passed `actionlint` (including shell checks). It gates multi-platform GHCR publishing on build/unit/browser/deployment checks, never publishes PRs, and requires no paid API key. The hosted workflow has not been run from this local setup.

## Earlier deployment and neutral routing update

- `vendor-neutral-v3` removes named-vendor preferences, automatic age/price/size ranking, and asymmetric successor penalties. Both model questions use identical candidate metadata; scored older runners-up are no longer silently suppressed.
- Unit tests check shared guidance and metadata templates across all candidates and preserve Jev's selected ID from every provider. These are structural regression tests, not evidence of empirically unbiased or optimal task performance.
- `bun run test:deployment` passed: production Docker build and unit tests; real Caddyfile validation; existing-stack Compose merge; missing-provider-key failure; isolated read-only/non-root app health; anonymous static/API access without a login challenge; CSP; secret-file 404; public origin accepted and foreign origin rejected.
- Smoke stack used dummy credentials and a loopback-only ephemeral HTTP port. Its containers/volumes were removed afterward. No image was pushed, no public certificate requested, no DNS changed, and no paid routing request made by this deployment test.

## Live catalog

The refresh script successfully verified 38 candidates against OpenRouter: 10 OpenAI, 11 Anthropic, 15 Chinese releases, and Gemini/Grok. The explicit 11-ID exclusion set is applied on every refresh. The timestamp is in `shared/catalog-meta.json`.

Older Anthropic releases are retained at the user’s explicit request, marked with successors, but not automatically penalized by the current policy. Preview models are labeled. Other families are explicitly reviewed releases, not an automatic claim about every newly published model.

## Live Jev verification

Historical live `typesafe/jev-1.13` request, before the 11-model exclusion update:

- Task: intermittent race condition in a distributed payment system, including double charging.
- Priority: task fit (API value `balanced`).
- Selected: **Claude Opus 5 / high effort**.
- Resolved router: `typesafe/jev-1.13-20260917`.
- Primary choice probability: **38%**; reported confidence: **35%**. These are distinct, faithfully preserved provider fields, not reliability estimates.
- Runner-up: Claude Sonnet 5, **33%** choice probability.
- Observed adapter round-trip: **583 ms** (one request, not a performance guarantee).

The inspector uses these actual response fields; it does not fabricate an internal thinking transcript. The target model is never run.

## Boundaries

This logging update was verified locally, not deployed to production by this work. No hosted CI run, broad browser-engine test, or comprehensive recommendation-quality benchmark was performed here. Local Docker public access, PostgreSQL durability, and the earlier bounded real-model microtasks were tested as described above. See README for public-launch spending caps and abuse controls. The app now retains admitted tasks and routing outcomes in PostgreSQL; recent introductions also remain in page memory. The opt-in benchmark scripts separately persist synthetic test cases and their results. Earlier security notes describe the pre-logging version and are not an audit of the new storage behavior.
