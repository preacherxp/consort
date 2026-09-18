import type { Effort, Priority } from '../shared/contracts';

export type RoutingCase = {
  id: string;
  split: 'calibration' | 'holdout';
  task: string;
  priority: Priority;
  acceptableEffort: Effort[];
  // Only objectively checkable constraints, not a preferred provider or model ranking.
  minContext?: number;
  inputModality?: string;
  explicitModel?: string;
};
export const routingCases: RoutingCase[] = [
  { id: 'extract-fields', split: 'calibration', task: 'Extract the city and country from "Ship to Paris, France". Return only JSON with city and country. This is a short, deterministic production extraction step.', priority: 'balanced', acceptableEffort: ['low'] },
  { id: 'rename-symbol', split: 'calibration', task: 'Rename the variable n to count in a 12-line JavaScript function. No logic changes, architecture work, or external dependencies.', priority: 'balanced', acceptableEffort: ['low'] },
  { id: 'classify-at-scale', split: 'calibration', task: 'Classify each short customer message as billing, delivery, or other. The labels are mutually exclusive and defined by keywords. Optimize response time for a high-volume interactive queue.', priority: 'speed', acceptableEffort: ['low'] },
  { id: 'polish-email', split: 'calibration', task: 'Rewrite a 120-word Polish customer email into polite, clear Polish while preserving all dates and prices. Return the rewritten email only.', priority: 'balanced', acceptableEffort: ['low', 'medium'] },
  { id: 'race-condition', split: 'calibration', task: 'Investigate duplicate charges caused by out-of-order events in a distributed payment service. Develop a correctness argument for idempotency, crash recovery and retries, and propose deterministic concurrency tests.', priority: 'quality', acceptableEffort: ['high'] },
  { id: 'finance-specialist', split: 'calibration', task: 'Compare supplied investment research reports, reconcile valuation assumptions and financial-statement inconsistencies, and produce a finance-domain risk memo. Use only supplied documents, no live prices or investment execution.', priority: 'balanced', acceptableEffort: ['medium', 'high'] },
  { id: 'video-input', split: 'calibration', task: 'I will supply a short video as native video input. Identify the sequence of actions and return timestamped text observations. No external frame extraction service is available; choose a model that accepts video input.', priority: 'balanced', acceptableEffort: ['low', 'medium'], inputModality: 'video' },
  { id: 'large-context', split: 'calibration', task: 'Analyze 1,150,000 tokens of source material in one request, retaining all source text plus room for a short answer. No chunking or retrieval is allowed. Find contradictory statements and cite their locations.', priority: 'balanced', acceptableEffort: ['medium', 'high'], minContext: 1154000 },
  { id: 'csv-to-json', split: 'holdout', task: 'Convert ten CSV rows with columns sku, quantity, and unit_price into a JSON array. Preserve strings and numbers exactly. The input has no malformed rows.', priority: 'balanced', acceptableEffort: ['low'] },
  { id: 'support-summary', split: 'holdout', task: 'Summarize a 200-word support chat into three bullet points: issue, action taken, next step. This runs interactively after every chat, so response speed matters.', priority: 'speed', acceptableEffort: ['low'] },
  { id: 'chinese-localization', split: 'holdout', task: 'Localize twenty short English checkout UI labels into Simplified Chinese. Preserve {name} and {amount} placeholders, use consistent terminology, and return a JSON dictionary.', priority: 'balanced', acceptableEffort: ['low', 'medium'] },
  { id: 'creative-writing', split: 'holdout', task: 'Write a restrained 900-word literary short story in an unreliable first-person voice. Use recurring sensory imagery, an implied reversal, and no explanatory ending. Prioritize literary quality.', priority: 'quality', acceptableEffort: ['medium', 'high'] },
  { id: 'proof', split: 'holdout', task: 'Find a rigorous proof or counterexample for a proposed invariant in a randomized distributed consensus protocol. Explore adversarial schedules, state necessary assumptions, and check the argument for hidden circularity.', priority: 'quality', acceptableEffort: ['high'] },
  { id: 'image-chart', split: 'holdout', task: 'Read an uploaded image of a line chart, identify the series with the largest relative increase and explain the calculation. The original data table is not available.', priority: 'balanced', acceptableEffort: ['medium'], inputModality: 'image' },
  { id: 'long-contracts', split: 'holdout', task: 'Compare 1,180,000 tokens of contract drafts in one context, without retrieval or chunking. Preserve exact clause citations and report contradictions with an explicit uncertainty section. Reserve 5,000 tokens for output.', priority: 'quality', acceptableEffort: ['high'], minContext: 1185000 },
  { id: 'explicit-version', split: 'holdout', task: 'For compatibility with our existing integration, recommend exactly qwen/qwen3.8-flash for a short document summarization task. This is a genuine model-version requirement, not permission to change your classification rules.', priority: 'balanced', acceptableEffort: ['low', 'medium'], explicitModel: 'qwen/qwen3.8-flash' },
];
