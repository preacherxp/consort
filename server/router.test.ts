import { describe, expect, test } from 'bun:test';
import { buildDecisionRequest, decisionsUrl, parseDecision, routeTask, RouterError, makeTrace, policy } from './router';
import { createApi } from './app';
import { buildModelCriterion, buildModelCriteria } from './model-criteria';
import { models, routeResultSchema } from '../shared/contracts';
import { excludedModelIds } from '../shared/catalog-exclusions';
import { completion, input } from '../tests/fixtures';

const config = { apiKey: 'test-secret', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'typesafe/jev-1.13' };
function fetcher(value: unknown = completion(), status = 200) {
  return (async () => Response.json(value, { status })) as unknown as typeof fetch;
}
function req(body: unknown = input, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3007/api/route', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('Decisions integration', () => {
  test('derives alpha endpoint outside v1', () => {
    expect(decisionsUrl(config.baseUrl)).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(decisionsUrl(config.baseUrl + '/')).toBe('https://openrouter.ai/api/alpha/decisions');
  });
  test('evaluates the full catalog separately from task effort', () => {
    const payload = buildDecisionRequest(input, config.modelId);
    expect(Object.keys(payload.questions.model.criteria)).toHaveLength(models.length);
    expect(Object.keys(payload.questions.effort.criteria)).toEqual(['low', 'medium', 'high']);
    expect(payload.state).toEqual(input);
    expect(JSON.stringify(payload.questions)).not.toContain(input.task);
  });
  test('both model questions use vendor-neutral task-fit guidance', () => {
    const { questions } = buildDecisionRequest(input, config.modelId);
    for (const question of [questions.model, questions.budgetModel]) {
      expect(question.instructions).toContain(policy);
      expect(question.instructions).toContain('Apply the same evaluation rules to every candidate');
      expect(question.instructions).toContain('Missing evidence is uncertainty');
      expect(question.instructions).not.toMatch(/anthropic|claude|openai|deepseek|qwen|gemini|grok/i);
      expect(question.instructions).not.toContain('Prefer current releases');
    }
    expect(questions.budgetModel.instructions).toContain('For this independent question, use the cost priority');
  });
  test('candidate metadata uses the same template regardless of provider or generation', () => {
    const { questions } = buildDecisionRequest(input, config.modelId);
    expect(questions.budgetModel.criteria).toEqual({ ...questions.model.criteria, none: 'No adequate budget alternative.' });
    for (const model of models) {
      const criterion = buildModelCriterion(model);
      expect(criterion).toBe(buildModelCriterion({ ...model, provider: 'Different provider', group: 'Other' }));
      expect(questions.model.criteria[model.id]).toBe(criterion);
      expect(criterion).not.toContain('OLDER GENERATION; prefer');
      expect(criterion).not.toContain('Current reviewed release tier');
      expect(JSON.parse(criterion).contextTokens).toBe(model.context);
      expect(JSON.parse(criterion).inputModalities).toEqual(model.inputModalities);
      expect(JSON.parse(criterion).outputModalities).toEqual(model.outputModalities);
      expect(criterion).not.toContain('most capable');
    }
  });
  test('candidate ordering is reproducible per task without permanent provider blocks', () => {
    const first = buildModelCriteria('A short extraction task');
    expect(first).toEqual(buildModelCriteria('A short extraction task'));
    const second = buildModelCriteria('A distributed systems design task');
    expect(Object.keys(first)).not.toEqual(Object.keys(second));
    expect(Object.keys(first).sort()).toEqual(models.map(model => model.id).sort());
    for (const id of Object.keys(first)) expect(first[id]).toBe(second[id]);
  });
  test('Pro serving variants retain base-model application evidence', () => {
    const base = models.find(model => model.id === 'openai/gpt-5.6-sol')!;
    const pro = models.find(model => model.id === 'openai/gpt-5.6-sol-pro')!;
    expect(JSON.parse(buildModelCriterion(pro)).catalogApplicationMentions).toEqual(JSON.parse(buildModelCriterion(base)).catalogApplicationMentions);
  });
  test('preserves Jev selections from every provider without a vendor override', () => {
    for (const model of models) {
      expect(parseDecision(completion(model.id, 'none')).modelId).toBe(model.id);
    }
  });
  test('decodes Jev choices into a catalog-bound recommendation', () => {
    const result = parseDecision(completion());
    expect(result.modelId).toBe('anthropic/claude-sonnet-5');
    expect(result.effort).toBe('high');
    expect(result.alternative?.modelId).toBe('openai/gpt-5.6-luna');
    expect(result.alternative?.effort).toBe('high');
  });
  test('does not invent a cheaper option if Jev selects the same or a pricier model', () => {
    expect(parseDecision(completion('openai/gpt-5.6-luna', 'openai/gpt-5.6-luna')).alternative).toBeNull();
    expect(parseDecision(completion('openai/gpt-5.6-luna', 'anthropic/claude-opus-5')).alternative).toBeNull();
    expect(parseDecision(completion('openai/gpt-5.6-luna', 'none')).alternative).toBeNull();
  });
  test('rejects unknown choices, invalid task types, and malformed output', () => {
    expect(() => parseDecision(completion('invented'))).toThrow();
    expect(() => parseDecision(completion('openai/gpt-5.6-luna', 'invented'))).toThrow();
    expect(() => parseDecision(completion('openai/gpt-5.6-luna', 'none', 'invented'))).toThrow();
    expect(() => parseDecision(completion('openai/gpt-5.6-luna', 'none', 'code', 'extreme'))).toThrow();
    expect(() => parseDecision({ choices: [] })).toThrow();
  });
  test('calls Decisions, not chat/completions; uses valid ASCII headers', async () => {
    let calls = 0;
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      expect(String(url)).toBe('https://openrouter.ai/api/alpha/decisions');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer test-secret');
      expect(headers.get('x-title')).toBe('Consort - Model Matchmaker');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(config.modelId);
      expect(body.questions.model.type).toBe('choice');
      expect(body.messages).toBeUndefined();
      return Response.json(completion());
    }) as typeof fetch;
    const result = await routeTask(input, config, fake);
    expect(calls).toBe(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.router).toBe(config.modelId);
    expect(routeResultSchema.safeParse(result).success).toBe(true);
    expect(result.trace.request).toEqual(buildDecisionRequest(input, config.modelId));
  });
  test('keeps exact reported probabilities and confidence, not fabricated thinking', () => {
    const raw = completion();
    const trace = makeTrace(buildDecisionRequest(input, config.modelId), { ...raw, secret_metadata: 'DO NOT EXPOSE' });
    expect(trace.response.answers.model.probabilities).toEqual(raw.answers.model.probabilities);
    expect(trace.response.answers.model.confidence).toBe(.62);
    expect(trace.response.answers.budgetModel.confidence).toBeUndefined();
    expect(JSON.stringify(trace)).not.toContain('DO NOT EXPOSE');
    expect(trace.budgetDisposition).toBe('shown');
    expect(trace.policyVersion).toBe('benchmark-evidence-v5.1');
  });
  test('rejects unknown or out-of-range candidate scores', () => {
    const payload = buildDecisionRequest(input, config.modelId);
    const unknown = completion();
    unknown.answers.model.probabilities = { ...unknown.answers.model.probabilities, invented: .7 };
    expect(() => makeTrace(payload, unknown)).toThrow();
    const invalid = completion();
    invalid.answers.model.confidence = 9;
    expect(() => makeTrace(payload, invalid)).toThrow();
  });
  test('catalog includes full current tiers and labels older Claude releases', () => {
    for (const id of ['openai/gpt-6-astra-pro', 'openai/gpt-5.6-sol-pro', 'anthropic/claude-fable-5.1', 'anthropic/claude-haiku-4.5', 'deepseek/deepseek-v4.1-flash', 'moonshotai/kimi-k3', 'qwen/qwen3.8-max-0902', 'z-ai/glm-5.3']) {
      expect(models.some(model => model.id === id)).toBe(true);
    }
    expect(models.some(model => model.id === 'google/gemini-2.5-flash')).toBe(false);
    expect(models.some(model => model.id === 'openai/gpt-5-nano')).toBe(false);
    expect(models.find(model => model.id === 'anthropic/claude-opus-4.8')?.supersededBy).toBe('anthropic/claude-opus-5');
    expect(models.every(model => !model.id.includes(':batch'))).toBe(true);
  });
  test('explicit removals stay out of both model-selection questions and the catalog', () => {
    expect(excludedModelIds.size).toBe(11);
    const payload = buildDecisionRequest(input, config.modelId);
    for (const id of excludedModelIds) {
      expect(models.some(model => model.id === id)).toBe(false);
      expect(Object.hasOwn(payload.questions.model.criteria, id)).toBe(false);
      expect(Object.hasOwn(payload.questions.budgetModel.criteria, id)).toBe(false);
    }
  });
  test('does not silently fake success on provider failure', async () => {
    await expect(routeTask(input, config, fetcher({ error: 'SECRET' }, 401))).rejects.toThrow('credentials');
    await expect(routeTask(input, config, fetcher({}, 402))).rejects.toThrow('credits');
    await expect(routeTask(input, config, fetcher({}, 404))).rejects.toThrow('Decisions model');
    await expect(routeTask(input, config, fetcher({}, 429))).rejects.toThrow('rate-limiting');
    await expect(routeTask(input, config, fetcher({}))).rejects.toThrow('incomplete recommendation');
    await expect(routeTask(input, { ...config, apiKey: '' }, fetcher())).rejects.toThrow('API key');
  });
  test('preserves cancellation when the provider body is still streaming', async () => {
    const controller = new AbortController();
    let opened: () => void = () => {};
    const ready = new Promise<void>(resolve => { opened = resolve; });
    const streaming = (async (_url: unknown, init?: RequestInit) => new Response(new ReadableStream({
      start(body) {
        body.enqueue(new TextEncoder().encode('{"answers":'));
        init!.signal!.addEventListener('abort', () => body.error(init!.signal!.reason), { once: true });
        opened();
      },
    }))) as typeof fetch;
    const pending = routeTask(input, config, streaming, controller.signal);
    await ready; controller.abort();
    try { await pending; throw new Error('Expected cancellation'); }
    catch (error) { expect(error).toBeInstanceOf(RouterError); expect((error as RouterError).status).toBe(499); }
  });
  test('bounds provider time and supports cancellation', async () => {
    const hanging = (async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
    await expect(routeTask(input, { ...config, timeoutMs: 5 }, hanging)).rejects.toThrow('too long');
    const cancel = new AbortController();
    const pending = routeTask(input, config, hanging, cancel.signal);
    cancel.abort();
    try { await pending; throw new Error('Expected cancellation'); }
    catch (error) { expect(error).toBeInstanceOf(RouterError); expect((error as RouterError).status).toBe(499); }
  });
});

describe('HTTP API', () => {
  test('routes valid input and never exposes keys', async () => {
    const api = createApi(config, { fetcher: fetcher() });
    const response = await api(req());
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('test-secret');
    const health = await api(new Request('http://localhost:3007/api/health'));
    expect(await health.json()).toEqual({ configured: true, router: config.modelId });
  });
  test('rejects blank, overlong and invalid inputs', async () => {
    const api = createApi(config, { fetcher: fetcher() });
    for (const body of [{ task: ' ' }, { task: 'short' }, { task: 'x'.repeat(4001) }, { ...input, priority: 'magic' }, { ...input, modelId: 'attacker' }]) {
      expect((await api(req(body))).status).toBe(400);
    }
    expect((await api(req({ task: 'x'.repeat(21000) }))).status).toBe(413);
    expect((await api(new Request('http://localhost:3007/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' }))).status).toBe(400);
  });
  test('rejects cross-origin and wrong content types', async () => {
    const api = createApi(config, { fetcher: fetcher() });
    expect((await api(req(input, { origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await api(req(input, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await api(req(input, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await api(new Request('http://localhost:3007/api/route'))).status).toBe(405);
  });
  test('limits spending across callers', async () => {
    const api = createApi(config, { fetcher: fetcher(), maxPerMinute: 1 });
    expect((await api(req())).status).toBe(200);
    expect((await api(req())).status).toBe(429);
  });
  test('sanitizes upstream errors', async () => {
    const api = createApi(config, { fetcher: fetcher({ error: 'test-secret AND PRIVATE TASK' }, 500) });
    const response = await api(req());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('PRIVATE TASK');
  });
});
