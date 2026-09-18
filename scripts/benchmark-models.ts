import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { modelProbes, probeModels } from '../benchmarks/model-probes';

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('Set OPENROUTER_API_KEY. This script executes real paid model requests.');
const { values } = parseArgs({ args: process.argv.slice(2), options: { out: { type: 'string' }, resume: { type: 'boolean', default: false } } });
if (values.resume && !values.out) throw new Error('--resume requires --out pointing to the existing report.');
const output = resolve(values.out ?? `benchmarks/results/model-probes-${Date.now()}.json`);
if (!values.resume && existsSync(output)) throw new Error('Output already exists; choose a new --out path or explicitly --resume.');
await mkdir(dirname(output), { recursive: true });
type Row = { model: string; probe: string; status: 'pass' | 'wrong-answer' | 'invalid-json' | 'no-answer' | 'api-error'; elapsedMs: number; answer?: string; finishReason?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: string };
const report: { startedAt: string; methodology: string; results: Row[] } = {
  startedAt: new Date().toISOString(),
  methodology: `Four synthetic objectively checked JSON microtasks on ${probeModels.length} models, one sample per pair. Temperature 0, low reasoning where supported, 2048 completion-token cap, no tools. End-to-end latency is one observation, not a stable speed ranking. Reasoning text is neither saved nor evaluated. These tests cannot establish overall model quality.`,
  results: [],
};
if (values.resume) {
  const previous = JSON.parse(await readFile(output, 'utf8')) as typeof report;
  report.startedAt = previous.startedAt;
  report.results = previous.results;
}
// Round-robin models per task to reduce model-order/warmup confounding; not a randomized trial.
for (const probe of modelProbes) for (const model of probeModels) {
  if (report.results.some(row => row.probe === probe.id && row.model === model)) continue;
  const started = performance.now();
  let row: Row;
  try {
    const response = await fetch(`${(process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Consort - model microbenchmark' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: 'Solve the task accurately. Return only the requested JSON value, without Markdown or explanations.' }, { role: 'user', content: probe.task }], temperature: 0, max_tokens: 2048, reasoning: { effort: 'low', exclude: true } }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: Row['usage'] };
    const answer = data.choices?.[0]?.message?.content;
    row = { model, probe: probe.id, status: 'no-answer', elapsedMs: Math.round(performance.now() - started), finishReason: data.choices?.[0]?.finish_reason, usage: data.usage };
    if (typeof answer === 'string' && answer.trim()) {
      row.answer = answer;
      try { row.status = isDeepStrictEqual(JSON.parse(answer), probe.expected) ? 'pass' : 'wrong-answer'; }
      catch { row.status = 'invalid-json'; }
    }
  } catch (error) {
    row = { model, probe: probe.id, status: 'api-error', elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : 'Request failed' };
  }
  report.results.push(row);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${probe.id}: ${model} ${row.status} ${row.elapsedMs}ms`);
}
console.log(`Saved ${report.results.length} real model executions to ${output}`);
