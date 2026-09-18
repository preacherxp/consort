import { findModel, type RouteResult } from './contracts';

export type Introduction = { modelId: string; source: 'primary' | 'candidate' | 'budget' };

/** Only real Jev selections/scores become introductions. No random catalog filler. */
export function getIntroductions(result: RouteResult): Introduction[] {
  const introductions: Introduction[] = [{ modelId: result.modelId, source: 'primary' }];
  const scored = Object.entries(result.trace.response.answers.model.probabilities ?? {})
    .filter(([id, score]) => id !== result.modelId && score > 0)
    .sort((a, b) => b[1] - a[1]);
  for (const [modelId] of scored.slice(0, 4)) introductions.push({ modelId, source: 'candidate' });
  if (result.alternative && !introductions.some(item => item.modelId === result.alternative!.modelId)) {
    introductions.push({ modelId: result.alternative.modelId, source: 'budget' });
  }
  return introductions;
}

export function introductionLabel(introduction: Introduction) {
  return { primary: 'Jev’s first pick', candidate: 'From Jev’s shortlist', budget: 'Jev’s budget pick' }[introduction.source];
}

export function matchCopy(task: string, result: RouteResult, introduction: Introduction) {
  const model = findModel(introduction.modelId);
  return `It’s a match.\n\nTask: ${task}\nMy pick: ${model.name} (${model.id})\nSuggested effort: ${result.effort}\nSource: ${introductionLabel(introduction)}. Chosen by me, not executed.\n\nIntroduced by ${result.router} via Consort. Effort is advisory; provider settings differ.`;
}
