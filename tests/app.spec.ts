import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resultFixture } from './fixtures';

const result = resultFixture();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } });
  });
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, router: result.router } }));
});

test('meets a model, matches, copies, exports and restores introductions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/route', async route => {
    expect(route.request().postDataJSON().priority).toBe('balanced');
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('model match.');
  await expect(page.getByRole('button', { name: /Find my match/ })).toBeDisabled();
  await page.getByRole('button', { name: /A tricky bug/ }).click();
  await page.getByRole('button', { name: /Find my match/ }).click();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Sonnet 5');
  const card = await page.locator('.recommendation-panel').boundingBox();
  const input = await page.locator('.task-panel').boundingBox();
  expect(card && input && card.y + card.height <= input.y).toBe(true);
  expect(await page.locator('.recommendation-panel').evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('.task-panel')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByText('0.48s to match')).toBeVisible();
  const profileNode = await page.locator('.model-profile').elementHandle();
  await page.getByRole('button', { name: 'Match', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.match-celebration')).toHaveText('it’s a match!');
  expect(await profileNode!.evaluate(node => node.isConnected && node.classList.contains('is-matched'))).toBe(true);
  await page.getByRole('button', { name: 'Copy my match' }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain('Suggested effort: high');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save match card' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('consort-claude-sonnet-5.png');
  await download.saveAs(test.info().outputPath('share-card.png'));
  await expect(page.locator('.profile-wrap')).toHaveCSS('opacity', '1');
  await page.locator('.match-deck').screenshot({ path: test.info().outputPath('matched.png') });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.locator('#task').fill('A new task to be routed');
  await expect(page.locator('.model-profile')).not.toBeVisible();
  await page.getByText('Recent introductions', { exact: true }).click();
  await page.getByRole('region', { name: 'Recent recommendations' }).getByRole('button').click();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Sonnet 5');
  await expect(page.locator('.result-content')).toHaveCSS('opacity', '1');
  await expect(page.locator('.profile-wrap')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: test.info().outputPath('result.png'), fullPage: true });
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('passes to a real runner-up without changing Jev’s answer or making extra API calls', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/route', route => { calls++; return route.fulfill({ json: result }); });
  await page.goto('/');
  await page.getByRole('button', { name: /A tricky bug/ }).click();
  await page.getByRole('button', { name: /Find my match/ }).click();
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Opus 5');
  await page.getByRole('button', { name: 'Match', exact: true }).click();
  await expect(page.locator('.match-celebration')).toBeVisible();
  await page.getByRole('button', { name: 'Copy my match' }).click();
  const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(copied).toContain('My pick: Claude Opus 5');
  expect(copied).toContain('From Jev’s shortlist');
  expect(copied).toContain('Chosen by me, not executed');
  await page.getByText('Why did Jev introduce us?', { exact: true }).click();
  await expect(page.locator('.trace-tabs').getByRole('button', { name: /Model selection/ })).toContainText('Claude Sonnet 5');
  await page.getByRole('button', { name: 'Keep browsing' }).click();
  await page.getByRole('button', { name: 'Previous model' }).click();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Sonnet 5');
  expect(calls).toBe(1);
});

test('horizontal drag passes a profile; vertical scrolling is preserved', async ({ page }) => {
  await page.route('**/api/route', route => route.fulfill({ json: result }));
  await page.goto('/');
  await page.getByRole('button', { name: /A tricky bug/ }).click();
  await page.getByRole('button', { name: /Find my match/ }).click();
  const profile = page.locator('.model-profile');
  await expect(profile).toHaveCSS('touch-action', 'pan-y');
  await profile.scrollIntoViewIfNeeded();
  await expect(page.locator('.profile-wrap')).toHaveCSS('opacity', '1');
  const rect = await profile.boundingBox();
  if (!rect) throw new Error('Missing profile');
  await page.mouse.move(rect.x + rect.width * .65, rect.y + 120);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .65 - 160, rect.y + 122, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Opus 5');
  await expect(page.locator('.profile-wrap')).toHaveCSS('opacity', '1');
  await page.locator('.model-profile').scrollIntoViewIfNeeded();
  const next = await page.locator('.model-profile').boundingBox();
  if (!next) throw new Error('Missing next profile');
  await page.mouse.move(next.x + next.width * .35, next.y + 120);
  await page.mouse.down();
  await page.mouse.move(next.x + next.width * .35 + 160, next.y + 122, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.match-celebration')).toBeVisible();
  await expect(page.locator('.swipe-help')).toContainText('Claude Opus 5 is your pick');
  await expect(page.locator('.model-profile')).toHaveCSS('transform', 'none');
});

test('shortlist ends honestly and can be replayed, including with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/route', route => route.fulfill({ json: result }));
  await page.goto('/');
  await page.getByRole('button', { name: /A tricky bug/ }).click();
  await page.getByRole('button', { name: /Find my match/ }).click();
  for (const name of ['Claude Sonnet 5', 'Claude Opus 5', 'GPT-5.6 Luna']) {
    await expect(page.locator('.model-profile h2')).toHaveText(name);
    await page.getByRole('button', { name: 'Pass', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'No more introductions.' })).toBeVisible();
  await page.getByRole('button', { name: 'Meet them again' }).click();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Sonnet 5');
});

test('exposes actual decisions, criteria, scores and request without invented reasoning', async ({ page }) => {
  await page.route('**/api/route', route => route.fulfill({ json: result }));
  await page.goto('/');
  await page.getByRole('button', { name: /A tricky bug/ }).click();
  await page.getByRole('button', { name: /Find my match/ }).click();
  await expect(page.locator('.decision-drawer')).not.toHaveAttribute('open', '');
  await page.getByText('Why did Jev introduce us?', { exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Why Jev introduced you.' });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText('62%', { exact: true })).toBeVisible();
  await expect(inspector.getByText('70%', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: /Thinking effort/ }).click();
  await expect(inspector.getByText('90%', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: /Budget option/ }).click();
  await expect(inspector.getByText(/No scores have been invented/)).toBeVisible();
  await inspector.getByText('Inspect the request & response', { exact: true }).click();
  const payload = JSON.parse(await inspector.getByLabel('Exact Jev request body').inputValue());
  expect(JSON.parse(payload.questions.model.criteria['openai/gpt-6-astra-pro']).localBenchmark.status).toBe('not-evaluated');
  const measured = JSON.parse(payload.questions.model.criteria['anthropic/claude-sonnet-5']).localBenchmark.results;
  expect(measured.strictCorrect).toBe(2);
  expect(measured.contentCorrectIncludingMarkdown).toBe(3);
  await expect(inspector.getByText(/Local benchmark observations are included/)).toBeVisible();
  expect(payload.state.task).toBe(result.trace.request.state.task);
  expect(await inspector.getByLabel('Validated Jev response').inputValue()).not.toContain('Authorization');
  await inspector.getByRole('button', { name: /Model selection/ }).click();
  await inspector.getByRole('button', { name: /See all/ }).click();
  await expect(inspector.locator('.candidate-list li')).toHaveCount(Object.keys(result.trace.request.questions.model.criteria).length);
  // Contrast must be measured after the profile entrance opacity animation settles.
  await expect(page.locator('.workspace')).toHaveCSS('opacity', '1');
  await expect(page.locator('.result-content')).toHaveCSS('opacity', '1');
  await expect(page.locator('.profile-wrap')).toHaveCSS('opacity', '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('task presets cover varied work without routing or changing the selected priority', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/route', route => { calls++; return route.fulfill({ json: result }); });
  await page.goto('/');
  await page.getByText('Best quality', { exact: true }).click();
  const presets = page.getByRole('group', { name: 'Task presets' });
  await expect(presets.getByRole('button')).toHaveCount(10);
  for (const [label, opening] of [
    ['Polish an email', 'Rewrite a short customer email'],
    ['Summarize a report', 'Summarize a supplied 20-page research report'],
    ['Translate UI', 'Translate 30 English checkout labels'],
    ['Extract data', 'Extract vendor names'],
    ['Write a story', 'Write a 900-word literary short story'],
    ['Analyze finances', 'Compare supplied financial statements'],
    ['Check a proof', 'Review a proposed mathematical proof'],
  ]) {
    await presets.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('#task')).toHaveValue(new RegExp(`^${opening}`));
    await expect(page.locator('#task')).toBeFocused();
  }
  await expect(page.getByRole('radio', { name: 'Best quality' })).toBeChecked();
  expect(calls).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const reduced of [false, true]) test(`match search animates only while routing (reduced motion: ${reduced})`, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/route', async route => { calls++; await gate; await route.fulfill({ json: result }); });
  try {
    await page.goto('/');
    const stage = await page.locator('.match-stage').elementHandle();
    await expect(page.locator('.match-stage')).toHaveAttribute('data-state', 'idle');
    await page.getByRole('button', { name: 'A quick fix', exact: true }).click();
    await page.getByRole('button', { name: /Find my match/ }).click();
    await expect(page.locator('.match-search')).toBeInViewport();
    expect(await stage!.evaluate(node => node.isConnected && node.getAttribute('data-state') === 'searching')).toBe(true);
    await expect(page.locator('.recommendation-panel')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.search-card-front')).toHaveCSS('animation-name', reduced ? 'none' : 'search-front');
    await expect(page.getByRole('button', { name: /Introducing/ })).toBeDisabled();
    await expect(page.getByRole('group', { name: 'Task presets' }).getByRole('button').first()).toBeDisabled();
    await expect(page.getByRole('button', { name: /Cancel request/ })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (!reduced) await page.locator('.recommendation-panel').screenshot({ path: testInfo.outputPath('searching.png') });
    release();
    await expect(page.locator('.model-profile h2')).toHaveText('Claude Sonnet 5');
    await expect(page.locator('.match-search')).toHaveCount(0);
    expect(await stage!.evaluate(node => node.isConnected && node.getAttribute('data-state') === 'result')).toBe(true);
    await expect(page.locator('.recommendation-panel')).toHaveAttribute('aria-busy', 'false');
    expect(calls).toBe(1);
  } finally { release(); }
});

test('segmented priority selector supports keyboard navigation and sends the chosen preference', async ({ page }) => {
  await page.route('**/api/route', route => {
    expect(route.request().postDataJSON().priority).toBe('quality');
    return route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /A tricky bug/ }).click();
  const priorities = page.getByRole('group', { name: 'Routing priority' });
  await expect(priorities.getByRole('radio')).toHaveCount(3);
  await expect(priorities.getByRole('radio', { name: 'Cheaper' })).toHaveCount(0);
  await expect(priorities.getByRole('radio', { name: 'Task fit' })).toBeChecked();
  await priorities.getByRole('radio', { name: 'Task fit' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(priorities.getByRole('radio', { name: 'Faster' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(priorities.getByRole('radio', { name: 'Best quality' })).toBeChecked();
  await priorities.getByText('Best quality', { exact: true }).click();
  await expect(priorities.getByRole('radio', { name: 'Best quality' })).toBeChecked();
  await expect(priorities.locator('.priority-highlight')).toHaveCount(1);
  await expect.poll(async () => {
    const highlight = await priorities.locator('.priority-highlight').boundingBox();
    const selected = await priorities.getByRole('radio', { name: 'Best quality' }).locator('..').boundingBox();
    return Boolean(highlight && selected && Math.abs(highlight.x - selected.x) < 1 && Math.abs(highlight.width - selected.width) < 1);
  }).toBe(true);
  await page.getByRole('button', { name: /Find my match/ }).click();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Sonnet 5');
});

test('small screens keep the full profile visible without scaling its text or overflowing', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route('**/api/route', route => route.fulfill({ json: result }));
  await page.goto('/');
  await page.getByRole('button', { name: 'A tricky bug', exact: true }).click();
  await page.getByRole('button', { name: /Find my match/ }).click();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Sonnet 5');
  await expect.poll(async () => {
    return page.locator('.match-stage').evaluate(node => Math.abs(node.getBoundingClientRect().height - (node.firstElementChild as HTMLElement).offsetHeight - 2) < 1);
  }).toBe(true);
  await expect(page.locator('.match-stage')).toHaveCSS('transform', 'none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('handles provider errors honestly and retries', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/route', route => {
    calls++;
    return route.fulfill(calls === 1 ? { status: 502, json: { error: 'OpenRouter is temporarily unavailable. Please try again.' } } : { json: result });
  });
  await page.goto('/');
  await page.locator('#task').fill('Debug a broken payments service');
  await page.getByRole('button', { name: /Find my match/ }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Sonnet 5');
});

for (const failure of [
  { name: 'HTML gateway error', status: 502, contentType: 'text/html', body: '<!DOCTYPE html><h1>PRIVATE PROXY DIAGNOSTIC</h1>', message: 'API is unavailable (HTTP 502)' },
  { name: 'SPA fallback', status: 200, contentType: 'text/html', body: '<!DOCTYPE html><h1>PRIVATE PROXY DIAGNOSTIC</h1>', message: 'Check that /api routes to the Consort server' },
  { name: 'proxy access block', status: 403, contentType: 'text/html', body: '<!DOCTYPE html><h1>PRIVATE PROXY DIAGNOSTIC</h1>', message: 'request was blocked (HTTP 403)' },
  { name: 'malformed JSON', status: 200, contentType: 'application/json', body: '{broken', message: 'did not return a valid API response' },
  { name: 'incomplete JSON', status: 200, contentType: 'application/json', body: '{}', message: 'incomplete recommendation' },
]) test(`handles ${failure.name} without leaking raw parsing errors and can retry`, async ({ page }) => {
  let calls = 0;
  await page.route('**/api/route', route => {
    calls++;
    return route.fulfill(calls === 1 ? { status: failure.status, contentType: failure.contentType, body: failure.body } : { json: result });
  });
  await page.goto('/');
  await page.locator('#task').fill('Debug a broken payments service');
  await page.getByRole('button', { name: /Find my match/ }).click();
  await expect(page.getByRole('alert')).toContainText(failure.message);
  await expect(page.getByRole('alert')).not.toContainText('PRIVATE PROXY DIAGNOSTIC');
  await expect(page.getByRole('alert')).not.toContainText('Unexpected token');
  expect(calls).toBe(1); // Never automatically retry a potentially paid request.
  await expect(page.locator('#task')).toHaveValue('Debug a broken payments service');
  await expect(page.locator('.model-profile')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.model-profile h2')).toHaveText('Claude Sonnet 5');
  expect(calls).toBe(2);
});

test('cancels in-flight routing without displaying a stale result', async ({ page }) => {
  let release: () => void = () => {};
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/route', async route => { await delayed; await route.fulfill({ json: result }).catch(() => {}); });
  await page.goto('/');
  await page.getByRole('button', { name: /A big idea/ }).click();
  await page.getByRole('button', { name: /Find my match/ }).click();
  await page.getByRole('button', { name: 'Cancel request' }).click();
  release();
  await expect(page.getByRole('button', { name: /Find my match/ })).toBeEnabled();
  await expect(page.locator('.model-profile')).not.toBeVisible();
});

test('explains recommendations, supports reduced motion, and fits the viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByText('Debug a race condition in my payment service…')).toBeVisible();
  await expect(page.locator('.workspace')).toHaveCSS('opacity', '1');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.empty-state')).toHaveCSS('opacity', '1');
  await expect(page.locator('#task-help')).toContainText('Submitted tasks and responses are saved on our server');
  await page.screenshot({ path: test.info().outputPath('initial.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.route-button').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);
  expect(await page.locator('#task').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(22);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await expect(page.locator('footer')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('LESS MODEL HOPPING.');
  await expect(page.locator('body')).not.toContainText('A WINGMAN FOR YOUR WORK.');
  await expect(page.locator('body')).not.toContainText('POWERED BY');
  await page.getByRole('button', { name: 'Meet the models' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('not executed');
  await expect(page.getByRole('dialog')).toContainText('in PostgreSQL until the operator deletes them');
  await expect(page.getByRole('dialog')).toContainText('Unsubmitted text, keystrokes, IP addresses, cookies, and API keys are not collected');
  await expect(page.getByRole('dialog')).not.toContainText('no database');
  const dialogAccessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(dialogAccessibility.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
