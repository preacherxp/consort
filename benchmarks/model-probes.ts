export const probeModels = [
  'anthropic/claude-sonnet-5', 'anthropic/claude-opus-5',
  'openai/gpt-5.6-sol', 'openai/gpt-5.6-luna',
  'qwen/qwen3.8-flash', 'z-ai/glm-5.3',
  'deepseek/deepseek-v4.1-flash', 'xiaomi/mimo-v2.5-pro',
  'inclusionai/ling-3.0-flash', 'z-ai/glm-5.3-flash', 'anthropic/claude-haiku-4.5',
];

// Objective microtasks, not a comprehensive coding/writing/model leaderboard.
// Model-generated code is never executed. Answers are parsed as data only.
export const modelProbes = [
  {
    id: 'locale-invoice',
    task: 'A German invoice lists 3 items at "1.234,50 EUR" each, then a 10% discount on the items only, then shipping of "12,00 EUR". VAT is already included; do not add tax. Return only JSON with subtotal_cents, discount_cents, shipping_cents and total_cents as integer euro cents.',
    expected: { subtotal_cents: 370350, discount_cents: 37035, shipping_cents: 1200, total_cents: 334515 },
  },
  {
    id: 'microtask-order',
    task: 'Predict the output in a standard JavaScript runtime. Return only the printed JSON array, not code or explanation.\nconst out = [];\nPromise.resolve().then(() => { out.push("A"); queueMicrotask(() => out.push("C")); }).then(() => out.push("D"));\nqueueMicrotask(() => { out.push("B"); queueMicrotask(() => out.push("E")); });\nsetTimeout(() => console.log(JSON.stringify(out)), 0);',
    expected: ['A', 'B', 'C', 'D', 'E'],
  },
  {
    id: 'sql-null-aggregation',
    task: 'Use PostgreSQL SQL semantics. Table t has rows (team,score): (A,10),(A,NULL),(A,10),(B,NULL),(B,NULL),(C,0). For SELECT team, COUNT(*) AS rows, COUNT(score) AS nonnull, COUNT(DISTINCT score) AS distinct_scores, SUM(score) AS total FROM t GROUP BY team ORDER BY team; return only a JSON array of objects using these column names. Represent SQL NULL as JSON null.',
    expected: [
      { team: 'A', rows: 3, nonnull: 2, distinct_scores: 1, total: 20 },
      { team: 'B', rows: 2, nonnull: 0, distinct_scores: 0, total: null },
      { team: 'C', rows: 1, nonnull: 1, distinct_scores: 1, total: 0 },
    ],
  },
  {
    id: 'retry-idempotency',
    task: 'A ledger starts at 100. For each event, if its id has never been successfully applied, add its delta and remember the id; otherwise do nothing. Failed attempts do not change the balance and do not remember the id. Events in order: (id=a, delta=-30, success=false), (id=b, delta=20, success=true), (id=a, delta=-30, success=true), (id=b, delta=20, success=true), (id=c, delta=-15, success=false), (id=c, delta=-15, success=true), (id=a, delta=-30, success=true), (id=d, delta=5, success=true). Return only JSON with balance and applied_ids (in order of successful first application).',
    expected: { balance: 80, applied_ids: ['b', 'a', 'c', 'd'] },
  },
];
