# Consort

**Meet your model match.** Model matchmaking with Jev as your consort, powered by `typesafe/jev-1.13` through OpenRouter. Formerly Dispatch; the project still lives in `model-router/`.

Describe your task → Jev makes introductions → swipe / pass / match → copy your choice or save a 1600×900 match card for X. Matching does **not** run the selected model.

## Run

Requires Bun 1.2+.

```sh
bun install
cp .env.example .env # skip if .env is already configured
# Set OPENROUTER_API_KEY in .env
bun run dev
```

Open **http://localhost:5177**. The API listens on `127.0.0.1:3007`. This project is independent of Incident Commander. Its ignored, permission-restricted `.env` contains only its own configuration and a copy of the OpenRouter key; no database or other app secrets were copied.

```sh
bun run build       # TypeScript check + production web bundle
bun start           # API + production web at http://localhost:3007
bun run test        # Unit/API tests, no paid calls
bunx playwright install chromium
bun run test:e2e    # Desktop/mobile browser tests with mocked upstream responses
```

## The Jev integration (important)

Jev is a **Decisions model**, not a chat-completions model. OpenRouter rejects it on `/chat/completions`.

- Configured base: `https://openrouter.ai/api/v1`
- Actual endpoint: **`https://openrouter.ai/api/alpha/decisions`** (outside `/v1`)
- Request: `{ model, state, questions }`
- `state` contains the task and priority, not an executable prompt.
- Four independent choice questions select the **model, task-required effort, task type, and budget model** in a single API call.
- The **benchmark-evidence-v5.1** policy applies the same task-specific rules to every provider. It evaluates the requested deliverable, domain, difficulty, stakes, scope, language, context and version constraints. The default **Task fit** uses price only to break ties between similarly suitable candidates.
- Candidates use one structured factual template: actual input/output modalities, context, supported controls, normalized application mentions and prices. Raw marketing superlatives are not sent as selection criteria. Pro serving variants inherit base-model application mentions where the catalog explicitly says they share a base. Candidate order is stable per task, not grouped by provider; it is not a quality ranking. Missing evidence remains uncertainty. No provider quotas or post-selection vendor override are applied.
- Both model-selection questions receive the saved **44-observation / 11-model** microbenchmark as dated, per-model evidence, with exact protocol and provenance. Correct content versus strict JSON, wrong answers, token exhaustion, and HTTP errors remain separate. Untested models and untested Pro variants have missing evidence, not zero scores. Hard eligibility constraints take precedence; these small tests are not a general leaderboard.
- These are heuristic routing recommendations, not a guarantee of correctness or a comprehensive measured model benchmark. Validating actual task success requires representative tasks and evaluations of the recommended models.
- Effort is evaluated separately, so choosing a cheaper model does not quietly lower the thinking budget for a difficult task.
- Answers and every reported probability key are validated against the supplied candidates. Unknown choices and out-of-range scores are rejected.
- A budget option is shown only if both its input and output rates are no higher and at least one is lower.
- The full-width **Jev decision inspector** shows each returned choice, candidate probabilities, reported confidence, exact criteria/instructions, the exact request body, and allowlisted response fields. Missing scores remain missing; probabilities are not calibrated chances of task success.
- Jev returns choices, **not a prose rationale**. Card summaries come from OpenRouter catalog descriptions and authored effort labels. The inspector separates our supplied criteria from Jev’s response. No fabricated thinking, scores, or savings.
- The resolved Jev version returned by the provider is retained in the trace and result.
- Displayed routing time is the measured server round-trip, not an estimate of task execution speed.

Official reference: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request

## Model catalog

`shared/catalog.json` contains **38 models**, verified against OpenRouter’s public `/api/v1/models` listing; `shared/catalog-meta.json` records the verification timestamp and scope:

- **10 OpenAI:** GPT-6 Astra / Astra Pro; all six GPT-5.6 Sol / Terra / Luna variants; GPT-5.4 Mini and Nano.
- **11 Anthropic:** the available non-batch Claude lineup minus the explicitly excluded Opus 4.1, Opus 4, Sonnet 4, and Claude 3 Haiku. Retained older releases are labeled, not automatically penalized.
- **15 Chinese:** reviewed DeepSeek, Qwen, GLM, Kimi, MiniMax, Xiaomi and inclusionAI releases.
- **2 others:** current Gemini Flash and Grok.

`bun run catalog:refresh` re-fetches availability, descriptions, dates and rates and discovers the Anthropic lineup while respecting `shared/catalog-exclusions.ts`. The 11 user-excluded models are blocked on every refresh and in both routing candidate sets. Review the explicit OpenAI/Chinese release lists in `scripts/refresh-catalog.ts` when new versions ship; the script does **not** pretend to automatically identify every vendor’s successors. Rebuild and restart after refreshing. Missing required IDs fail rather than silently substituting older models.

Prices are base USD per million tokens, **not** task-cost estimates; live rates and provider/context tiers can differ. Descriptions come from the provider catalog and are vendor claims, not independent benchmarks. Release dates are catalog listing timestamps. This is a reviewed candidate set, not every LLM available on OpenRouter.

Effort is an advisory thinking budget. Provider-specific thinking controls differ; the app does not imply that every model accepts a literal `reasoning_effort` parameter. Verify native support before executing a recommendation.

## UX

Minimal single-column layout: model profiles **above** the task input in both visual and DOM order, on desktop and mobile. Compact empty state, three-option segmented priority selector (Task fit, Faster, Best quality), and no marketing footer or decorative portrait panels. Jev’s decision details and introduction history are collapsed until requested. Warm ink-plum canvas, rose accents and cream profile cards remain. Jev plays matchmaker, not chatbot. Locally hosted Manrope / IBM Plex Mono, serif display accents, typewriter examples, spring-driven profile swipes, an in-place “it’s a match” reveal, and matching PNG exports. Body text stays 16px, task input 22–24px, primary actions 18px.

- Ten presets span quick edits, debugging, architecture, email, summaries, translation, extraction, fiction, finance and proofs. They fill the input without submitting or changing your priority.
- **Find my match** shows a small shuffling card deck, heart pulse and button shimmer only while the request is pending. A persistent measured-height surface smoothly resizes into the actual result without scaling text or waiting for an outgoing loader. Reduced-motion mode keeps a still deck; no artificial wait or pretend progress is added.
- The native priority radios share a sliding highlight. Matching preserves the same profile element, and fast swipes use the direction of the actual gesture. Presets and controls use consistent, restrained press feedback.
- Swipe left or **Pass** for the next introduction; swipe right or **Match** to choose. Labeled buttons and keyboard activation are equivalent to gestures.
- The deck contains Jev’s primary pick, up to four positive-scored runners-up, and the validated budget option if distinct. No random catalog filler, zero-score introductions, or invented compatibility ratings. A one-model result is valid.
- **Previous model**, **Keep browsing**, and replay after the shortlist ends let you reconsider. Matching only selects locally; no target model runs, and browsing never calls the API again.
- The original Jev trace remains unchanged when you pick a runner-up. Copy/export identifies **your** selected model and whether Jev introduced it as its first pick, a scored candidate, or its budget choice.
- Task-required thinking effort is preserved across introductions. A cheaper model doesn’t silently mean lower effort.
- Accessible priority radio group, `⌘/Ctrl + Enter`, cancel/retry states, reduced-motion support, responsive layouts, in-memory introduction history, and local PNG exports remain. **Meet the models** opens the catalog and explains data handling.

For a recording: submit **A tricky bug**, pass a profile, match the next, and save the card. Results are live, so the number and order of introductions can vary.

Design references behind the refinement: **[docs/design-references.md](docs/design-references.md)** — verified first-party sources and concrete ideas for improving hierarchy and fluid motion without adding visual noise.

## Docker + Caddy deployment

See **[docs/deployment.md](docs/deployment.md)** for `https://jev.purecode.sh`, including the overlay for your existing Caddy/`purecode` stack, GHCR publishing, credentials, DNS, verification and rollback.

- Standalone: `compose.yaml` + `Caddyfile`.
- Existing stack: `deploy/compose.jev.yaml`; append the site's block to your current Caddyfile.
- Runtime settings: `.env.production.example` (never commit the filled-in file).
- Local verification: `bun run test:deployment` builds and tests isolated Docker containers with dummy credentials and no paid requests.

The proxy is password-protected by default; only it publishes ports. The app runs non-root with a read-only filesystem. `.github/workflows/docker-publish.yml` tests and publishes AMD64/ARM64 images to `ghcr.io/<owner>/consort` on default-branch pushes and `v*` tags using `GITHUB_TOKEN`; PRs never publish. GitHub requires this app's `.github/` to be at the repository root. CI publishes images, but does not deploy the server.

## Live routing benchmarks

See **[the measured routing report](docs/routing-benchmark-2026-09-18.md)**: 64 real Jev requests, 44 real target-model probes, raw results, limitations, and reproduction commands. The prompt was calibrated for task requirements and factual evidence—not a target vendor distribution. This is prompt calibration, not model-weight fine-tuning or proof of optimal selections.

`shared/benchmark-evidence.json` is the reviewed snapshot sent to Jev. After reviewing a new saved `benchmarks/results/model-probes.json`, run **`bun run bench:evidence:refresh`**, rebuild and restart to publish it. That refresh is offline and validates scores against the saved answers; it does not run models. Other ad-hoc benchmark reports are not automatically promoted into production.

`bun run bench:routing` and `bun run bench:models` use real OpenRouter credits and are **never run in CI**. App usage remains selection-only; target models run only in the explicitly invoked benchmark script.

## Security and deployment

- API key stays on the server; never use a `VITE_` prefix for secrets.
- Binds to loopback by default. No unauthenticated public deployment is enabled automatically.
- Strict request/response validation, bounded request body, 45-second upstream timeout, cancellation, sanitized errors, same-origin browser checks, 20 requests/minute per process and four concurrent requests.
- No prompt logs, database, analytics, or localStorage. Recent tasks exist in React memory until the tab closes. Exported PNGs deliberately contain the task text.
- Tasks are sent to OpenRouter and TypeSafe and remain subject to their data policies. Don’t submit secrets.
- No fake fallback: upstream failures produce an honest error and retry action.

**Before a public X launch:** retain the deployment's password protection or replace it with a real authenticated/shared abuse gate, and set an OpenRouter key spending cap. The supplied Caddy configuration handles TLS. The in-memory limiter is a demo safeguard, not robust multi-instance protection. Set `HOST=0.0.0.0` and `APP_ORIGIN=https://your-domain` only when ready to expose it. The origin check is CSRF mitigation, not authentication.

## Layout

- `src/` — React UI, swipeable match deck, decision inspector, CSS, match-card renderer
- `shared/` — catalog, Zod contracts, evidence-backed introductions and match copy
- `server/router.ts` — Decisions request/response adapter
- `server/app.ts` — HTTP validation and request limits
- `server/index.ts` — Bun server and explicit static-asset allowlist
- `scripts/refresh-catalog.ts` — reviewed model coverage and live catalog refresh
- `server/*.test.ts` — API contracts, candidate provenance, immutable traces and user-selected match tests
- `tests/` — Playwright browser flows

Font licenses are included in `public/fonts/`.
