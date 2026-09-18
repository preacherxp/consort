import { buildBenchmarkEvidence } from '../benchmarks/evidence';

// Offline only: validate/re-score saved observations, never call a provider.
const raw = await Bun.file(new URL('../benchmarks/results/model-probes.json', import.meta.url)).text();
const evidence = buildBenchmarkEvidence(raw);
await Bun.write(new URL('../shared/benchmark-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(`Prepared ${evidence.models.length} models / ${evidence.models.reduce((sum, model) => sum + model.attempted, 0)} observations for Jev. Study: ${evidence.studyId}. Rebuild and restart to publish.`);
