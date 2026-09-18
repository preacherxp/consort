import { createHash } from 'node:crypto';
import { models, type Model } from '../shared/contracts';
import benchmarkEvidence from '../shared/benchmark-evidence.json' with { type: 'json' };

const measuredModels = new Map(benchmarkEvidence.models.map(model => [model.modelId, model]));

// Uniform vocabulary from the supplied catalog, not invented benchmark scores.
// These are application mentions, not assertions of comparative quality.
const applications: [string, RegExp][] = [
  ['software development', /\bcod(?:e|ing|ebase)|software|engineering/i],
  ['long-running agents', /agent|long.horizon|long.running/i],
  ['reasoning', /reasoning/i],
  ['documents and knowledge work', /document|knowledge work|professional work/i],
  ['writing', /writing|prose|document creation/i],
  ['research and science', /research|scientific|\bSTEM\b/i],
  ['finance', /financ|investment|valuation/i],
  ['classification and extraction', /classification|extraction/i],
  ['visual understanding', /visual|vision|image|video|multimodal/i],
  ['high-volume workflows', /high.volume|high.throughput|production.scale/i],
];

export function buildModelCriterion(model: Model) {
  // The catalog explicitly describes some Pro entries only as a serving mode of
  // their base model. Inherit application mentions only when that fact is stated.
  const sameBase = /same underlying model/i.test(model.strengths)
    ? models.find(candidate => candidate.id === model.id.replace(/-pro$/, '')) : undefined;
  const description = sameBase?.strengths ?? model.strengths;
  return JSON.stringify({
    model: model.name,
    catalogApplicationMentions: applications.filter(([, pattern]) => pattern.test(description)).map(([label]) => label),
    applicationEvidence: 'Vendor description mentions only; not benchmark rankings. Empty means unspecified, not incapable.',
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    contextTokens: model.context,
    structuredOutputs: model.supportedParameters.includes('structured_outputs'),
    toolCalling: model.supportedParameters.includes('tools'),
    reasoningControl: model.supportedParameters.includes('reasoning'),
    latencyOrThroughputPositioning: /\bfast(?:er|est)?\b|latency|throughput|high.volume/i.test(description) ? 'Vendor-positioned for speed/throughput; not a measured latency claim.' : 'Unspecified; do not infer from price or model name.',
    servingVariant: sameBase ? `Same base model as ${sameBase.id}; pro reasoning mode, not independent quality evidence.` : null,
    listingDate: model.released,
    recordedSuccessor: model.supersededBy,
    preview: model.preview,
    inputUSDPerMillion: model.inputPerMillion,
    outputUSDPerMillion: model.outputPerMillion,
    localBenchmark: {
      studyId: benchmarkEvidence.studyId,
      status: measuredModels.has(model.id) ? 'evaluated' : 'not-evaluated',
      results: measuredModels.get(model.id) ?? null,
    },
  });
}

export function buildModelCriteria(task: string) {
  // Stable for the same task, but no permanent provider block gets the first slots.
  // No vendor quotas, provider weights, randomness, or post-selection reranking.
  return Object.fromEntries(models.map(model => ({ model, order: createHash('sha256').update(task.trim()).update('\0').update(model.id).digest('hex') }))
    .sort((a, b) => a.order.localeCompare(b.order))
    .map(({ model }) => [model.id, buildModelCriterion(model)]));
}
