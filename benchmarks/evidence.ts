import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { modelProbes } from './model-probes';

const reportSchema = z.object({
  startedAt: z.string().datetime(),
  results: z.array(z.object({
    model: z.string().min(1), probe: z.string().min(1),
    status: z.enum(['pass', 'wrong-answer', 'invalid-json', 'no-answer', 'api-error']),
    elapsedMs: z.number().finite().nonnegative(),
    answer: z.string().optional(), finishReason: z.string().optional(), error: z.string().optional(),
  })).min(1),
});

export function buildBenchmarkEvidence(source: string) {
  const report = reportSchema.parse(JSON.parse(source));
  const seen = new Set<string>();
  const observations = report.results.map(row => {
    const probe = modelProbes.find(probe => probe.id === row.probe);
    if (!probe) throw new Error(`Unknown probe: ${row.probe}`);
    const key = `${row.model}\0${row.probe}`;
    if (seen.has(key)) throw new Error('Duplicate model/probe observations; repeat runs need a new study.');
    seen.add(key);
    let strictJson = false;
    let answerCorrect: boolean | null = null;
    let markdownWrapped = false;
    if (row.answer?.trim()) {
      try {
        const value: unknown = JSON.parse(row.answer);
        strictJson = true;
        answerCorrect = isDeepStrictEqual(value, probe.expected);
      } catch {
        const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\s*```$/i.exec(row.answer.trim());
        if (fenced) {
          try {
            answerCorrect = isDeepStrictEqual(JSON.parse(fenced[1]), probe.expected);
            markdownWrapped = true;
          } catch { /* Invalid content stays unknown, not a fabricated wrong answer. */ }
        }
      }
    }
    const observedStatus = row.status === 'api-error' ? 'api-error'
      : !row.answer?.trim() ? 'no-answer'
      : !strictJson ? 'invalid-json'
      : answerCorrect ? 'pass' : 'wrong-answer';
    if (observedStatus !== row.status) throw new Error(`Recorded score disagrees with answer: ${row.model}/${row.probe}`);
    return {
      modelId: row.model,
      task: row.probe,
      outcome: row.status === 'no-answer' && row.finishReason === 'length' ? 'token-budget-exhausted' : row.status,
      strictJson: row.status === 'api-error' || row.status === 'no-answer' ? null : strictJson,
      answerCorrect: row.status === 'api-error' ? null : answerCorrect,
      markdownWrapped,
      observedElapsedMs: row.elapsedMs,
      httpStatus: row.status === 'api-error' ? Number(/^HTTP (\d{3})$/.exec(row.error ?? '')?.[1]) || null : null,
    };
  });
  const digest = createHash('sha256').update(source).digest('hex');
  return {
    studyId: `consort-microtasks-${report.startedAt.slice(0, 10)}-${digest.slice(0, 12)}`,
    source: 'benchmarks/results/model-probes.json',
    sourceSha256: digest,
    runStartedAt: report.startedAt,
    protocol: {
      samplesPerModelTask: 1,
      temperature: 0,
      reasoning: 'low where supported; provider implementations differ',
      maxCompletionTokens: 2048,
      outputFormat: 'JSON requested in the prompt; native JSON mode was NOT enabled',
      tasks: modelProbes.map(probe => ({ id: probe.id, task: probe.task })),
      limitations: 'Four synthetic bounded tasks, one sample per model/task, sequential requests. Not a general leaderboard or a blinded/randomized evaluation. Timing includes network/provider effects. No writing, vision, long-context, complex architecture, or difficult-proof quality was measured.',
    },
    models: [...new Set(observations.map(row => row.modelId))].sort().map(modelId => {
      const rows = observations.filter(row => row.modelId === modelId);
      return {
        modelId,
        attempted: rows.length,
        strictCorrect: rows.filter(row => row.outcome === 'pass').length,
        contentCorrectIncludingMarkdown: rows.filter(row => row.answerCorrect === true).length,
        observations: rows.map(({ modelId: _modelId, ...observation }) => observation),
      };
    }),
  };
}
