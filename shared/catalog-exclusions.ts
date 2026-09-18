// Explicit user exclusions. Keep these out of refreshes and routing candidates.
export const excludedModelIds = new Set([
  'openai/gpt-5.3-codex',
  'openai/gpt-chat-latest',
  'anthropic/claude-opus-4.1',
  'anthropic/claude-opus-4',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3-haiku',
  'bytedance-seed/seed-2-1-turbo',
  'bytedance-seed/seed-2.0-code',
  'stepfun/step-3.7-flash',
  'tencent/hy4-preview',
  'meituan/longcat-2.0',
]);
