import { chromium, type Locator } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { buildDecisionRequest, makeTrace, parseDecision, policy } from '../server/router';
import { requestSchema, routeResultSchema } from '../shared/contracts';
import study from '../benchmarks/results/benchmark-informed-v5.1-check.json';

// Capture the real local UI, replaying a saved real decision. Never call a paid API.
// Requires: local production preview on :3007, Playwright Chromium, and ffmpeg.
const origin = 'http://127.0.0.1:3007';
const root = resolve(import.meta.dir, '..');
const out = join(root, 'docs/social');
const temporary = await mkdtemp(join(tmpdir(), 'consort-social-'));
await mkdir(out, { recursive: true });
const observation = study.results.find(row => row.id === 'race-condition')!;
const input = requestSchema.parse({ task: observation.task, priority: observation.priority });
const payload = buildDecisionRequest(input, study.model);
assert.equal(policy, observation.policy, 'Update the replay reconstruction after a policy change');
const recordedCriteria = study.candidateCriteria as Record<string, string>;
payload.questions.model.criteria = Object.fromEntries(observation.candidateOrder.map(id => {
  assert.equal(typeof recordedCriteria[id], 'string');
  return [id, recordedCriteria[id]];
}));
payload.questions.budgetModel.criteria = { ...payload.questions.model.criteria, none: payload.questions.budgetModel.criteria.none };
assert.equal(createHash('sha256').update(JSON.stringify(payload.questions.model.criteria)).digest('hex'), observation.criteriaHash);
const raw = { model: study.model, answers: observation.answers, usage: observation.usage };
const result = routeResultSchema.parse({
  ...parseDecision(raw), router: study.model, elapsedMs: observation.elapsedMs,
  trace: makeTrace(payload, raw),
});

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Manrope;src:url('/fonts/manrope.woff2') format('woff2');font-weight:200 800}
*{box-sizing:border-box}body{margin:0;width:1280px;height:960px;overflow:hidden;background:#19151b;color:#f8ebe7;font-family:Manrope,sans-serif}
.brand{position:absolute;left:52px;top:51px;font:46px Georgia,serif;letter-spacing:-2px}.brand b{color:#ffa0b3;font-weight:400}.heart{font:42px Georgia;color:#ffa0b3;margin-right:12px}
.kicker{position:absolute;left:54px;top:150px;font-size:14px;letter-spacing:2px;color:#cbb4c3}
h1{position:absolute;left:48px;top:194px;margin:0;font-size:80px;line-height:1.05;font-weight:500;letter-spacing:-4px}em{font-family:Georgia,serif;font-weight:400;color:#ffa0b3}
.steps{position:absolute;left:54px;top:508px;display:grid;gap:22px}.step{display:flex;align-items:center;gap:14px;font-size:21px;color:#a590a2;transition:color .2s}.step span{display:grid;place-items:center;width:32px;height:32px;border:1px solid #675062;border-radius:50%;font-size:13px}.step.active{color:#fff0f5}.step.active span{background:#ffa0b3;color:#3c1d2b;border-color:#ffa0b3}
.cta{position:absolute;left:54px;bottom:77px;font-size:23px;color:#ffbacb}.byline{position:absolute;left:54px;bottom:45px;font-size:14px;color:#baa5b6}
.browser{position:absolute;left:484px;top:58px;width:744px;height:818px;overflow:hidden;border:1px solid #655060;border-radius:24px;background:#19151b;box-shadow:0 24px 64px #08040d55}
.chrome{height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid #493b48;background:#251e28;font-size:13px;color:#d3bdcc}.dots{display:flex;gap:6px}.dots i{width:6px;height:6px;background:#8d7084;border-radius:50%}iframe{display:block;border:0;width:742px;height:772px;background:#19151b}
.note{position:absolute;left:484px;top:898px;width:744px;text-align:center;color:#baa5b6;font-size:15px}
#cursor{position:absolute;left:0;top:0;width:26px;height:32px;z-index:10;pointer-events:none;filter:drop-shadow(0 2px 3px #0008);transform:translate(1160px,840px)}#cursor.pressed{filter:drop-shadow(0 0 8px #ffadc7)}
</style></head><body>
<div class="brand"><span class="heart">♡</span>consort<b>.</b></div>
<div class="kicker">${Object.keys(payload.questions.model.criteria).length} MODELS. YOUR CALL.</div>
<h1>Tinder.<br>But for<br><em>LLMs.</em></h1>
<div class="steps"><div class="step active"><span>01</span>Describe your task</div><div class="step"><span>02</span>Meet your shortlist</div><div class="step"><span>03</span>Make your match</div><div class="step"><span>04</span>Check the receipts</div></div>
<div class="cta">jev.purecode.sh ↗</div><div class="byline">A model + the right thinking effort.</div>
<div class="browser"><div class="chrome"><span class="dots"><i></i><i></i><i></i></span><span>consort · model matchmaker</span><span>↗</span></div><iframe src="/" title="Consort demo"></iframe></div>
<div class="note">Real UI · recorded Jev decision · edited replay, not a speed test</div>
<svg id="cursor" viewBox="0 0 26 32"><path d="M3 2L22 20L13 21L9 29Z" fill="#fff4ee" stroke="#251521" stroke-width="2" stroke-linejoin="round"/></svg>
</body></html>`;
const browser = await chromium.launch();
let requests = 0;
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1,
    recordVideo: { dir: temporary, size: { width: 1280, height: 960 } },
    serviceWorkers: 'block',
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/__social-demo') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/route') {
      requests++;
      assert.deepEqual(route.request().postDataJSON(), input);
      // Replay the original observed request duration, not a fabricated speed claim.
      await new Promise(resolve => setTimeout(resolve, observation.elapsedMs));
      return route.fulfill({ json: result });
    }
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') return route.abort();
    if (url.pathname === '/' && route.request().resourceType() === 'document') {
      // Allow this local presentation frame only; production keeps its anti-framing headers.
      const response = await route.fetch();
      const headers = response.headers();
      delete headers['x-frame-options'];
      headers['content-security-policy'] = headers['content-security-policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'");
      return route.fulfill({ response, headers });
    }
    return route.continue();
  });
  const videoStart = performance.now();
  const page = await context.newPage();
  await page.goto(`${origin}/__social-demo`);
  const app = page.frameLocator('iframe');
  await app.locator('#task').fill(input.task);
  await app.getByRole('radio', { name: 'Best quality' }).locator('..').click();
  await app.locator('#task').evaluate((node: HTMLTextAreaElement) => { node.blur(); node.scrollTop = 0; });
  await app.locator('.recommendation-panel').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.evaluate(() => document.fonts.ready);
  await app.locator('body').evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(700);
  const trimStart = (performance.now() - videoStart) / 1000;
  await page.screenshot({ path: join(temporary, 'consort-demo-opening.png') });
  let cursor = { x: 1160, y: 840 };
  const pause = (ms: number) => page.waitForTimeout(ms);
  async function phase(index: number) {
    await page.evaluate(index => document.querySelectorAll('.step').forEach((node, i) => node.classList.toggle('active', i === index)), index);
  }
  async function click(target: Locator) {
    const box = await target.boundingBox();
    assert(box);
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (let i = 1; i <= 12; i++) {
      const t = 1 - (1 - i / 12) ** 3;
      const point = { x: cursor.x + (to.x - cursor.x) * t, y: cursor.y + (to.y - cursor.y) * t };
      await page.evaluate(point => { document.querySelector<HTMLElement>('#cursor')!.style.transform = `translate(${point.x}px,${point.y}px)`; }, point);
      await page.mouse.move(point.x, point.y);
      await pause(22);
    }
    cursor = to;
    await page.evaluate(() => document.querySelector('#cursor')!.classList.add('pressed'));
    await page.mouse.down(); await pause(80); await page.mouse.up();
    await page.evaluate(() => document.querySelector('#cursor')!.classList.remove('pressed'));
  }
  await pause(1000);
  await phase(1);
  await click(app.getByRole('button', { name: 'Find my match', exact: true }));
  await app.getByRole('heading', { name: 'Claude Opus 5', exact: true }).waitFor();
  await pause(1200);
  await click(app.getByRole('button', { name: 'Pass', exact: true }));
  await app.getByRole('heading', { name: 'GPT-5.6 Sol', exact: true }).waitFor();
  await pause(900);
  await click(app.getByRole('button', { name: 'Previous model', exact: true }));
  await app.getByRole('heading', { name: 'Claude Opus 5', exact: true }).waitFor();
  await pause(500);
  await phase(2);
  await click(app.getByRole('button', { name: 'Match', exact: true }));
  await app.locator('.match-celebration').waitFor();
  await pause(1200);
  await page.screenshot({ path: join(out, 'consort-demo-poster.png') });
  await phase(3);
  await app.locator('.decision-drawer').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await pause(600);
  await click(app.locator('.decision-drawer > summary'));
  await app.locator('.decision-details').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await pause(2300);
  await page.screenshot({ path: join(temporary, 'consort-demo-receipts.png') });
  await app.locator('.recommendation-panel').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await page.evaluate(() => {
    document.querySelector('h1')!.innerHTML = 'Find your<br><em>model<br>match.</em>';
    document.querySelector<HTMLElement>('#cursor')!.style.opacity = '0';
  });
  await pause(1800);
  assert.equal(requests, 1, 'Browsing must not create additional routing requests');
  const duration = (performance.now() - videoStart) / 1000 - trimStart;
  const video = page.video()!;
  await context.close();
  const source = await video.path();
  const encode = (args: string[]) => {
    const process = Bun.spawnSync(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdout: 'pipe', stderr: 'pipe' });
    assert.equal(process.exitCode, 0, process.stderr.toString());
  };
  const mp4 = join(out, 'consort-demo.mp4');
  encode(['-ss', String(trimStart), '-i', source, '-t', String(duration), '-an', '-r', '24', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  const gif = join(out, 'consort-demo.gif');
  for (const width of [960, 880, 800, 720]) {
    encode(['-ss', String(trimStart), '-i', source, '-t', String(duration), '-filter_complex', `fps=10,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', gif]);
    if (Bun.file(gif).size < 5_000_000) break;
  }
  assert(Bun.file(gif).size < 5_000_000, 'GIF exceeds the conservative 5 MB upload target; reduce capture length');
  console.log(`Created GIF (${(Bun.file(gif).size / 1e6).toFixed(2)} MB), MP4, and poster in docs/social/. No paid requests.`);
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
