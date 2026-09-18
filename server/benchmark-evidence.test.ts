import { expect, test } from 'bun:test';
import { buildBenchmarkEvidence } from '../benchmarks/evidence';
import evidence from '../shared/benchmark-evidence.json' with { type: 'json' };
import { buildDecisionRequest } from './router';
import { buildModelCriterion } from './model-criteria';
import { findModel } from '../shared/contracts';

const source = await Bun.file(new URL('../benchmarks/results/model-probes.json', import.meta.url)).text();
const criterion = (id: string) => JSON.parse(buildModelCriterion(findModel(id))).localBenchmark;

test('published benchmark evidence is derived exactly from saved real observations', () => {
  expect(buildBenchmarkEvidence(source)).toEqual(evidence);
  expect(evidence.models).toHaveLength(11);
  expect(evidence.models.reduce((sum, model) => sum + model.attempted, 0)).toBe(44);
  expect(evidence.protocol.maxCompletionTokens).toBe(2048);
  expect(evidence.protocol.samplesPerModelTask).toBe(1);
});

test('benchmark criteria preserve wrong answers versus correct content with format violations', () => {
  const result = criterion('anthropic/claude-sonnet-5');
  expect(result.status).toBe('evaluated');
  expect(result.results.strictCorrect).toBe(2);
  expect(result.results.contentCorrectIncludingMarkdown).toBe(3);
  expect(result.results.observations.find((row: { task: string }) => row.task === 'microtask-order')).toMatchObject({ outcome: 'wrong-answer', strictJson: true, answerCorrect: false });
  expect(result.results.observations.find((row: { task: string }) => row.task === 'sql-null-aggregation')).toMatchObject({ outcome: 'invalid-json', strictJson: false, answerCorrect: true, markdownWrapped: true });
});

test('token exhaustion and HTTP errors do not become fabricated wrong answers', () => {
  const rows = criterion('qwen/qwen3.8-flash').results.observations;
  expect(rows.find((row: { task: string }) => row.task === 'microtask-order')).toMatchObject({ outcome: 'token-budget-exhausted', answerCorrect: null, strictJson: null });
  expect(rows.find((row: { task: string }) => row.task === 'retry-idempotency')).toMatchObject({ outcome: 'api-error', answerCorrect: null, strictJson: null, httpStatus: 429 });
});

test('untested models and Pro variants have missing evidence, not zero scores or inherited results', () => {
  expect(criterion('openai/gpt-5.6-sol').results.strictCorrect).toBe(4);
  for (const id of ['openai/gpt-5.6-sol-pro', 'anthropic/claude-opus-4.7', 'google/gemini-3.8-flash']) {
    expect(criterion(id)).toEqual({ studyId: evidence.studyId, status: 'not-evaluated', results: null });
  }
});

test('both selection questions receive the study protocol and exact per-model observations', () => {
  const payload = buildDecisionRequest({ task: 'Convert a short well-formed CSV to JSON', priority: 'balanced' }, 'typesafe/jev-1.13');
  for (const question of [payload.questions.model, payload.questions.budgetModel]) {
    expect(question.instructions).toContain(evidence.sourceSha256);
    expect(question.instructions).toContain(evidence.runStartedAt);
    expect(question.instructions).toContain('Untested models are not worse');
    expect(question.instructions).toContain('Benchmark success cannot override any of these checks');
    expect(question.instructions).toContain('A 429 is an availability observation');
    expect(question.instructions).toContain('native JSON mode was NOT enabled');
    const entries: Record<string, string> = question.criteria;
    expect(JSON.parse(entries['openai/gpt-5.6-luna']).localBenchmark.results.strictCorrect).toBe(4);
  }
  // Raw model output and reference solutions are not shipped as routing instructions.
  expect(JSON.stringify(payload)).not.toContain('334515');
});

test('evidence refresh rejects duplicate observations and scores contradicted by saved answers', () => {
  const original = JSON.parse(source);
  expect(() => buildBenchmarkEvidence(JSON.stringify({ ...original, results: [original.results[0], original.results[0]] }))).toThrow('Duplicate');
  expect(() => buildBenchmarkEvidence(JSON.stringify({ ...original, results: [{ ...original.results[0], answer: '{}' }] }))).toThrow('disagrees');
});
