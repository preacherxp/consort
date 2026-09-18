import { expect, test } from 'bun:test';
import { getIntroductions, matchCopy } from '../shared/matches';
import { resultFixture } from '../tests/fixtures';

test('introduces the actual pick, scored runner-up and budget choice, without duplicates', () => {
  const result = resultFixture();
  expect(getIntroductions(result)).toEqual([
    { modelId: 'anthropic/claude-sonnet-5', source: 'primary' },
    { modelId: 'anthropic/claude-opus-5', source: 'candidate' },
    { modelId: 'openai/gpt-5.6-luna', source: 'budget' },
  ]);
  result.trace.response.answers.model.probabilities!['openai/gpt-5.6-luna'] = .05;
  expect(getIntroductions(result).filter(item => item.modelId === 'openai/gpt-5.6-luna')).toHaveLength(1);
});

test('never fabricates scores or populates an empty shortlist from the catalog', () => {
  const result = resultFixture();
  result.trace.response.answers.model.probabilities = undefined;
  result.alternative = null;
  expect(getIntroductions(result)).toEqual([{ modelId: result.modelId, source: 'primary' }]);
});

test('excludes zero scores but respects a scored older runner-up without an age-based override', () => {
  const result = resultFixture();
  result.trace.response.answers.model.probabilities = { 'anthropic/claude-opus-4.8': .8, 'openai/gpt-6-astra': 0 };
  result.alternative = null;
  expect(getIntroductions(result)).toEqual([
    { modelId: result.modelId, source: 'primary' },
    { modelId: 'anthropic/claude-opus-4.8', source: 'candidate' },
  ]);
});

test('copy distinguishes a user-selected runner-up from Jev’s original pick', () => {
  const result = resultFixture();
  const before = JSON.stringify(result);
  const copy = matchCopy('Fix a race condition', result, getIntroductions(result)[1]);
  expect(copy).toContain('My pick: Claude Opus 5');
  expect(copy).toContain('From Jev’s shortlist');
  expect(copy).toContain('Suggested effort: high');
  expect(copy).toContain('Chosen by me, not executed');
  expect(JSON.stringify(result)).toBe(before);
});
