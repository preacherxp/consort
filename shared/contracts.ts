import { z } from 'zod';
import catalog from './catalog.json' with { type: 'json' };
import meta from './catalog-meta.json' with { type: 'json' };

export const models = catalog;
export const catalogMeta = meta;
export type Model = (typeof models)[number];
export const priorities = ['balanced', 'speed', 'cost', 'quality'] as const;
export type Priority = (typeof priorities)[number];
export const effortSchema = z.enum(['low', 'medium', 'high']);
export type Effort = z.infer<typeof effortSchema>;
export const requestSchema = z.object({
  task: z.string().trim().min(8, 'Give us a little more detail (at least 8 characters).').max(4000),
  priority: z.enum(priorities).default('balanced'),
}).strict();
const modelId = z.string().refine(id => models.some(model => model.id === id), 'Unknown model');
const taskTypeSchema = z.enum(['code', 'writing', 'analysis', 'reasoning', 'everyday']);
const decisionShape = {
  modelId,
  effort: effortSchema,
  taskType: taskTypeSchema,
  headline: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(1).max(600),
  alternative: z.object({ modelId, effort: effortSchema, reason: z.string().trim().min(1).max(250) }).strict().nullable(),
};
function validateAlternative(value: { modelId: string; alternative: { modelId: string } | null }, ctx: z.RefinementCtx) {
  if (value.alternative && !isCheaper(findModel(value.alternative.modelId), findModel(value.modelId))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Alternative must be a different, cheaper model.' });
  }
}
export const decisionSchema = z.object(decisionShape).strict().superRefine(validateAlternative);
export type Decision = z.infer<typeof decisionSchema>;

const question = z.object({ type: z.literal('choice'), instructions: z.string(), criteria: z.record(z.string()) });
export const decisionRequestSchema = z.object({
  model: z.string(), state: requestSchema,
  questions: z.object({ model: question, effort: question, taskType: question, budgetModel: question }),
});
const probability = z.number().finite().min(0).max(1);
const choice = z.object({
  type: z.literal('choice'), choice: z.string(),
  confidence: probability.optional(), probabilities: z.record(probability).optional(),
});
// Only explicitly allowlisted response fields leave the server. No arbitrary upstream metadata.
export const decisionResponseSchema = z.object({
  model: z.string(), id: z.string().optional(), provider: z.string().optional(),
  answers: z.object({ model: choice, effort: choice, taskType: choice, budgetModel: choice }),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(), cost: z.number().finite().nonnegative().optional() }).optional(),
});
export const traceSchema = z.object({
  request: decisionRequestSchema,
  response: decisionResponseSchema,
  catalogVerifiedAt: z.string(),
  policyVersion: z.literal('benchmark-evidence-v5.1'),
  budgetDisposition: z.enum(['shown', 'none', 'not-cheaper']),
});
export type DecisionTrace = z.infer<typeof traceSchema>;
export const routeResultSchema = z.object({
  ...decisionShape,
  elapsedMs: z.number().finite().nonnegative(),
  router: z.string(),
  trace: traceSchema,
}).strict().superRefine(validateAlternative);
export type RouteResult = z.infer<typeof routeResultSchema>;

export function findModel(id: string): Model {
  const model = models.find(model => model.id === id);
  if (!model) throw new Error('Unknown model');
  return model;
}
export function isCheaper(a: Model, b: Model) {
  return a.inputPerMillion <= b.inputPerMillion && a.outputPerMillion <= b.outputPerMillion &&
    (a.inputPerMillion < b.inputPerMillion || a.outputPerMillion < b.outputPerMillion);
}
