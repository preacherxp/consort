import { buildDecisionRequest, makeTrace, parseDecision } from '../server/router';

export const input = { task: 'Debug a TypeScript function that drops events.', priority: 'balanced' as const };
export const modelId = 'typesafe/jev-1.13';
export function completion(model = 'anthropic/claude-sonnet-5', budget = 'openai/gpt-5.6-luna', taskType = 'code', effort = 'high') {
  return {
    id: 'fixture-not-a-live-request', model: modelId, provider: 'TypeSafe',
    answers: {
      model: { type: 'choice', choice: model, confidence: .62, probabilities: { [model]: .7, 'anthropic/claude-opus-5': .3 } },
      effort: { type: 'choice', choice: effort, confidence: .8, probabilities: { low: .02, medium: .08, high: .9 } },
      taskType: { type: 'choice', choice: taskType, confidence: 1, probabilities: { code: 1 } },
      budgetModel: { type: 'choice', choice: budget },
    },
    usage: { input_tokens: 100, output_tokens: 10, cost: .00001 },
  };
}
export function resultFixture() {
  const raw = completion();
  return { ...parseDecision(raw), router: modelId, elapsedMs: 482, trace: makeTrace(buildDecisionRequest(input, modelId), raw) };
}
