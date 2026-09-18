import { excludedModelIds } from '../shared/catalog-exclusions';

// Review these release families when vendors ship successors; never guess model IDs.
// Discover Anthropic's non-batch lineup, respecting explicit user exclusions.
const openai = [
  'gpt-6-astra', 'gpt-6-astra-pro',
  'gpt-5.6-sol', 'gpt-5.6-sol-pro', 'gpt-5.6-terra', 'gpt-5.6-terra-pro', 'gpt-5.6-luna', 'gpt-5.6-luna-pro',
  'gpt-5.4-mini', 'gpt-5.4-nano',
].map(id => `openai/${id}`);
const chinese = [
  'deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4-pro-0813',
  'qwen/qwen3.8-max-0902', 'qwen/qwen3.8-flash', 'qwen/qwen3.8-27b', 'qwen/qwen3.8-2.4t-a95b',
  'z-ai/glm-5.3', 'z-ai/glm-5.3-flash', 'moonshotai/kimi-k3', 'minimax/minimax-m3',
  'xiaomi/mimo-v2.5', 'xiaomi/mimo-v2.5-pro',
  'inclusionai/ling-3.0-flash', 'inclusionai/ling-3.0-flash-vl', 'inclusionai/ling-3.0-flash-fin',
];
const other = ['google/gemini-3.8-flash', 'x-ai/grok-4.6'];

type Entry = { id: string; name: string; description: string; created: number; context_length: number; pricing: { prompt: string; completion: string }; architecture: { input_modalities: string[]; output_modalities: string[] }; supported_parameters: string[] };
const source = 'https://openrouter.ai/api/v1/models';
const response = await fetch(source, { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Catalog fetch failed (${response.status}); existing snapshot unchanged.`);
const { data } = await response.json() as { data: Entry[] };
const anthropic = data.filter(model => model.id.startsWith('anthropic/') && !model.id.includes(':') && !excludedModelIds.has(model.id) && model.architecture.output_modalities.includes('text')).sort((a, b) => b.created - a.created);
if (!anthropic.length) throw new Error('Missing Anthropic lineup; snapshot unchanged.');
const ids = [...openai, ...anthropic.map(model => model.id), ...chinese, ...other].filter(id => !excludedModelIds.has(id));
const latestClaude = Object.fromEntries(['fable', 'opus', 'sonnet', 'haiku'].map(family => [family, anthropic.find(model => model.id.includes(family))?.id]));
const catalog = ids.map(id => {
  const entry = data.find(model => model.id === id);
  if (!entry || !entry.architecture.output_modalities.includes('text')) throw new Error(`Reviewed model unavailable: ${id}. Snapshot unchanged.`);
  const inputPerMillion = Number((Number(entry.pricing.prompt) * 1e6).toFixed(6));
  const outputPerMillion = Number((Number(entry.pricing.completion) * 1e6).toFixed(6));
  if (![inputPerMillion, outputPerMillion].every(n => Number.isFinite(n) && n >= 0)) throw new Error(`Invalid pricing: ${id}`);
  const family = Object.keys(latestClaude).find(family => id.includes(family));
  const successor = id.startsWith('anthropic/') && family ? latestClaude[family] : null;
  const description = entry.description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const strengths = description.length > 340 ? description.slice(0, 337).replace(/\s+\S*$/, '') + '…' : description;
  return {
    id, name: entry.name.replace(/^[^:]+:\s*/, ''), provider: entry.name.split(':')[0],
    group: openai.includes(id) ? 'OpenAI' : id.startsWith('anthropic/') ? 'Anthropic' : chinese.includes(id) ? 'Chinese' : 'Other',
    tagline: `${entry.name.replace(/^[^:]+:\s*/, '')} at lower token rates.`, strengths,
    context: entry.context_length, inputPerMillion, outputPerMillion,
    inputModalities: entry.architecture.input_modalities,
    outputModalities: entry.architecture.output_modalities,
    supportedParameters: entry.supported_parameters,
    released: new Date(entry.created * 1000).toISOString().slice(0, 10),
    supersededBy: successor && successor !== id ? successor : null,
    preview: /preview|experimental|\bexp\b/.test(id),
  };
});
await Bun.write(new URL('../shared/catalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
await Bun.write(new URL('../shared/catalog-meta.json', import.meta.url), JSON.stringify({
  verifiedAt: new Date().toISOString(), source,
  policy: 'Reviewed catalog with explicit user exclusions applied on every refresh. Listing dates, successor and preview labels are metadata, not performance rankings. All candidates are evaluated using the same task-specific criteria.',
}, null, 2) + '\n');
console.log(`Verified ${catalog.length} models: ${openai.length} OpenAI, ${anthropic.length} Anthropic, ${chinese.length} Chinese, ${other.length} others. Rebuild and restart to publish.`);
