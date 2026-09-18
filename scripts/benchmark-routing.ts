import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildDecisionRequest, decisionsUrl } from '../server/router';
import { decisionResponseSchema, findModel, traceSchema } from '../shared/contracts';
import { routingCases } from '../benchmarks/routing-cases';

const { values } = parseArgs({ args: process.argv.slice(2), options: { split: { type: 'string', default: 'all' }, order: { type: 'string', default: 'default' }, out: { type: 'string' } } });
const split = values.split;
const order = values.order;
const output = resolve(values.out ?? `benchmarks/results/routing-${Date.now()}.json`);
if (existsSync(output)) throw new Error('Output already exists; choose a new --out path to preserve prior evidence.');
const selected = routingCases.filter(item => split === 'all' || item.split === split);
if (!selected.length || !['default', 'reverse'].includes(order)) throw new Error('Use --split all|calibration|holdout and --order default|reverse');
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('Set OPENROUTER_API_KEY. This benchmark makes real paid Jev requests.');
const model = process.env.OPENROUTER_MODEL_ID ?? 'typesafe/jev-1.13';
const catalogResponse = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) });
if (!catalogResponse.ok) throw new Error('Cannot verify capability metadata');
const catalog = await catalogResponse.json() as { data: { id: string; architecture: { input_modalities: string[] } }[] };
const results: unknown[] = [];
const report = { startedAt: new Date().toISOString(), model, order, split, policyVersion: traceSchema.shape.policyVersion.value, candidateCriteria: buildDecisionRequest({ task: selected[0].task, priority: selected[0].priority }, model).questions.model.criteria, methodology: 'Real routing requests on synthetic tasks. Distribution is descriptive, not an accuracy target. Constraint/effort checks are defined before running. No recommended model is executed by this script.', results };
await mkdir(dirname(output), { recursive: true });
for (const item of selected) {
  const payload = buildDecisionRequest({ task: item.task, priority: item.priority }, model);
  if (order === 'reverse') {
    payload.questions.model.criteria = Object.fromEntries(Object.entries(payload.questions.model.criteria).reverse());
    payload.questions.budgetModel.criteria = Object.fromEntries(Object.entries(payload.questions.budgetModel.criteria).reverse()) as typeof payload.questions.budgetModel.criteria;
  }
  const started = performance.now();
  const response = await fetch(decisionsUrl(process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'), {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Consort - routing benchmark' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Jev failed (${response.status}); completed results are in ${output}`);
  const decision = decisionResponseSchema.parse(await response.json());
  const winner = findModel(decision.answers.model.choice);
  const metadata = catalog.data.find(entry => entry.id === winner.id);
  const checks = {
    effort: item.acceptableEffort.includes(decision.answers.effort.choice as typeof item.acceptableEffort[number]),
    context: item.minContext === undefined ? null : winner.context >= item.minContext,
    modality: item.inputModality === undefined ? null : (metadata?.architecture.input_modalities.includes(item.inputModality) ?? false),
    explicitModel: item.explicitModel === undefined ? null : winner.id === item.explicitModel,
  };
  results.push({ id: item.id, split: item.split, task: item.task, priority: item.priority, modelId: winner.id, provider: winner.provider, effort: decision.answers.effort.choice, elapsedMs: Math.round(performance.now() - started), checks, policy: payload.questions.model.instructions, candidateOrder: Object.keys(payload.questions.model.criteria), criteriaHash: createHash('sha256').update(JSON.stringify(payload.questions.model.criteria)).digest('hex'), answers: decision.answers, usage: decision.usage });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${item.id}: ${winner.id} / ${decision.answers.effort.choice} ${JSON.stringify(checks)}`);
}
console.log(`Saved ${results.length} live decisions to ${output}`);
