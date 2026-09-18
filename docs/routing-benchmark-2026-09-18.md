# Live routing calibration — 2026-09-18

## Scope and outcome

The initial calibration ran **64 real Jev routing requests** and **44 real target-model probes** (11 models × four tasks). Recorded provider-reported costs total **$0.09674**; one HTTP 429 has no usage record. This is not a complete billing reconciliation.

The initial 16-task v3 suite did **not** reproduce near-exclusive Anthropic routing: Anthropic won **5/16**, across five providers. The updated v4 policy chose Anthropic **4/16**, also across five providers. This small change is **not statistically significant evidence of debiasing** and was not the tuning objective. Complex reasoning continued to select Opus; that is not inherently an error.

Both versions passed **16/16 predefined effort checks** and **5/5 objective context/modality/explicit-version checks** on the paired suite. The checks establish basic constraint compliance, **not** that a selected model is the best possible model for its task.

## What changed

1. Removed raw marketing prose from model-selection criteria. Several upstream descriptions are truncated and make incomparable claims such as “most capable.” Every candidate now has the same structured template.
2. Added real catalog input/output modalities, context limits, structured-output support, tool-calling support and reasoning controls. Application mentions are normalized to a common vocabulary; they are explicitly **not benchmark rankings**.
3. Pro entries described by the source as the same underlying model inherit their base model's application mentions. Previously their sparse descriptions mostly advertised “higher quality” without describing applications.
4. The prompt separates hard eligibility constraints, routine transformations, domain fit, difficult reasoning and the requested priority. It does not treat a small/cheap model as incapable or assume a flagship is best for a rename/extraction task.
5. Candidate ordering is now stable per task but not permanently grouped by vendor. **This does not eliminate order sensitivity** (see below).
6. No provider quotas, provider-specific ranking bonuses, invented benchmark scores or post-selection vendor override were added. The microbenchmark scores are **not** a universal leaderboard. The later v5.1 follow-up below adds them as scoped, per-model evidence.

The trace for this initial calibration identifies the policy as **`task-evidence-v4`**. Production still makes one Jev call; it does not execute the recommended model. Only the opt-in benchmark script runs target models.

## Paired routing results

| Task | v3 baseline | v4 |
|---|---|---|
| Short field extraction | Ling 3.0 Flash | GPT-5.6 Luna |
| Rename a variable | GPT-5.6 Terra | Ling 3.0 Flash |
| High-volume keyword classification | GPT-5.6 Luna | GPT-5.6 Luna |
| Polish email rewrite | Claude Haiku 4.5 | Ling 3.0 Flash |
| Distributed payment race condition | Claude Opus 5 | Claude Opus 5 |
| Investment-report comparison | Ling 3.0 Flash Fin | Ling 3.0 Flash Fin |
| Native video input | Qwen3.8 Max 0902 | Ling 3.0 Flash VL |
| 1.15M-token single-context analysis | GLM-5.3 | GLM-5.3 Flash |
| CSV-to-JSON | Claude Haiku 4.5 | GLM-5.3 Flash |
| Low-latency support summary | GPT-5.6 Luna | Claude Haiku 4.5 |
| Chinese UI localization | Ling 3.0 Flash | Qwen3.8 Flash |
| Literary story | Claude Opus 4.8 | Claude Sonnet 4.5 |
| Difficult distributed-consensus proof | Claude Opus 5 | Claude Opus 5 |
| Uploaded chart image | Qwen3.8 Flash | Qwen3.8 Flash |
| 1.18M-token contract comparison | GLM-5.3 | GLM-5.3 |
| Explicit Qwen3.8 Flash compatibility | Qwen3.8 Flash | Qwen3.8 Flash |

Sixteen synthetic cases were split into eight calibration and eight follow-up (`holdout`) cases. Baseline outputs were visible before tuning, so this is **not a blinded holdout experiment**. The explicit-version case measures constraint following, not unbiased preference. The aggregate is descriptive; no model identity was declared the correct answer except for that explicit requirement.

## Order sensitivity and repeatability

On the eight calibration cases:

| Comparison against each version's first run | v3 | v4 |
|---|---:|---:|
| Different winner when candidate order was reversed | 4/8 | 4/8 |
| Different winner on an unchanged repeat request | 2/8 | 2/8 |

All those runs retained their checked constraints and effort labels. Reversing order also involves a new request, so order effects cannot be cleanly separated from nondeterminism in this small sample. **No robustness improvement is claimed.** Several candidates appear interchangeable to the router; exact model picks should not be presented as definitive rankings.

## Actual model microbenchmarks

Four objectively scored tasks: locale-aware invoice arithmetic, JavaScript microtask order, SQL NULL aggregation, and retry/idempotency ledger accounting. Inputs and expected outputs are in `benchmarks/model-probes.ts`; generated code is never executed. The JavaScript reference answer was also checked with Node.

Settings: temperature 0, low reasoning where supported, 2,048 completion-token cap, JSON requested in the prompt, **no native JSON-mode constraint**. One sample per model/task, not a statistically powered evaluation. Provider implementations of reasoning controls differ. Calls were sequential by task/model; three models were added afterward to inspect routine-task routing choices.

| Model | Correct answer + strict JSON | Observation |
|---|---:|---|
| Claude Sonnet 5 | 2/4 | Wrong microtask order; correct SQL data wrapped in Markdown |
| Claude Opus 5 | 4/4 | All passed |
| GPT-5.6 Sol | 4/4 | All passed |
| GPT-5.6 Luna | 4/4 | All passed |
| Qwen3.8 Flash | 2/4 | One reasoning-budget exhaustion; one HTTP 429, not a quality failure |
| GLM-5.3 | 4/4 | All passed |
| DeepSeek V4.1 Flash | 4/4 | All passed |
| MiMo-V2.5 Pro | 3/4 | Correct SQL data wrapped in Markdown |
| Ling 3.0 Flash | 3/4 | One no-answer result |
| GLM-5.3 Flash | 3/4 | One Markdown-wrapped answer |
| Claude Haiku 4.5 | 0/4 | Three Markdown-wrapped answers and wrong microtask order |

A Markdown wrapper fails the explicit output-format instruction but **does not imply inability to solve the underlying problem or use native structured outputs**. Empty/length-limited responses and HTTP errors are distinguished from wrong answers in the raw data. No retry was silently substituted for a failed result. Recorded end-to-end timings include provider/network behavior and are **not a reliable latency leaderboard**.

The useful finding is narrow: several non-Anthropic models correctly handled the bounded tasks, including inexpensive models. It is not defensible to extrapolate these four tasks to the best model for literary writing, complex proofs, security engineering, or a million-token context. Hard-task selections remain heuristic.

## Follow-up: benchmark-informed routing (v5.1)

At the user's request, **`benchmark-evidence-v5.1`** now supplies the measured observations to both Jev model-selection questions. `shared/benchmark-evidence.json` is generated offline from the saved model-probe report, with a SHA-256 provenance hash and dated protocol. It includes task-level outcomes and observed timings, without raw generated answers or invented scores. Markdown-wrapped correct content is distinguished from a wrong answer. Untested models (including untested Pro variants) get `not-evaluated`, not zero or inherited scores.

The prompt limits this evidence to similar bounded tasks and explicitly forbids treating it as a general quality/latency ranking. It cannot override context, modality or explicit compatibility requirements.

**Additional live verification: 24 routing requests.** The first eight-case v5 check exposed a context-limit regression: Jev chose Opus for a request exceeding its context. That failed run is preserved in `benchmark-informed-v5-check.json`. After adding a final numerical eligibility check, v5.1 passed all **16 effort checks and five hard-constraint checks** in `benchmark-informed-v5.1-check.json`. This remains a sampled regression check, not a correctness guarantee. These additional requests are separate from the initial 64-call totals above.

To deliberately publish updated evidence after reviewing its input report:

```sh
bun run bench:evidence:refresh
bun run build
# Restart the app / publish and deploy a new image.
```

CI verifies that the generated snapshot agrees with saved observations, without making paid requests. A new ad-hoc benchmark run does not silently change production evidence.

## Evidence and reproduction

Synthetic tasks, returned choices/scores, timings, checked constraints and reported costs are saved in `benchmarks/results/`:

- `baseline-v3.json`, `repeat-v3.json`, `order-reversed-v3.json`
- `calibrated-v4-calibration.json`, `calibrated-v4-holdout.json`
- `repeat-v4.json`, `order-reversed-v4.json`
- `model-probes.json`

Run the **current** policy again (these commands spend real OpenRouter credits; they never run in CI):

```sh
bun run bench:routing --out benchmarks/results/new-routing-run.json
bun run bench:routing --split calibration --order reverse --out benchmarks/results/new-reversed-run.json
bun run bench:models --out benchmarks/results/new-model-probes.json
# Resume an interrupted probe run without repeating completed pairs:
bun run bench:models --out benchmarks/results/new-model-probes.json --resume
```

Use new output paths; existing reports are preserved. Changing the catalog or prompt changes the experiment. For stronger conclusions, next use a larger, representative sample of actual user tasks, repeated runs, blinded scoring, controlled provider settings, and measured task success—not a target provider distribution.
