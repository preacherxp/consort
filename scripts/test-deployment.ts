import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { completion } from '../tests/fixtures';

// Local containers only: fake provider key, loopback ephemeral port, no ACME or paid requests.
const root = resolve(import.meta.dir, '..');
const temporary = mkdtempSync(join(tmpdir(), 'consort-deployment-'));
const project = `consort-smoke-${process.pid}`;
const image = 'consort-deployment-test:local';
const env = { ...process.env, OPENROUTER_API_KEY: 'smoke-test-not-a-real-key',
  POSTGRES_PASSWORD: 'synthetic-app-pw-@#$', POSTGRES_ADMIN_PASSWORD: 'synthetic-admin-only-password', JEV_IMAGE: image };
function docker(args: string[]) {
  const result = Bun.spawnSync(['docker', ...args], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`Docker command failed (${args[0]}):\n${result.stderr.toString()}\n${result.stdout.toString()}`);
  return result.stdout.toString().trim();
}
const composeArgs = ['compose', '--env-file', '/dev/null', '-p', project, '-f', join(root, 'compose.yaml'), '-f', join(temporary, 'override.yaml')];
const compose = (...args: string[]) => docker([...composeArgs, ...args]);
let started = false;
try {
  console.log('Building production image (includes typecheck and unit tests)…');
  docker(['build', '-t', image, '.']);
  const samePassword = Bun.spawnSync(['sh', join(root, 'deploy/postgres-init.sh')], {
    env: { POSTGRES_PASSWORD: 'same-test-password', CONSORT_DB_PASSWORD: 'same-test-password' }, stdout: 'pipe', stderr: 'pipe',
  });
  assert.notEqual(samePassword.exitCode, 0);
  assert(samePassword.stderr.toString().includes('different application and bootstrap'));
  console.log('Validating the production Caddyfile…');
  docker(['run', '--rm', '-v', `${join(root, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`, 'caddy:2-alpine', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);

  const site = readFileSync(join(root, 'Caddyfile'), 'utf8');
  assert(site.startsWith('jev.purecode.sh {'));
  writeFileSync(join(temporary, 'Caddyfile'), site.replace('jev.purecode.sh {', ':80 {'));
  writeFileSync(join(temporary, 'provider.ts'), `Bun.serve({ hostname: '127.0.0.1', port: 3009, async fetch(request) {
    if (request.method === 'GET') return Response.json({ ready: true });
    const body = await request.json();
    if (body.state.task.includes('HTTP cancellation')) await Bun.sleep(30000);
    return Response.json(${JSON.stringify(completion())});
  }});`);
  writeFileSync(join(temporary, 'override.yaml'), `services:\n  caddy:\n    ports: !override\n      - "127.0.0.1::80"\n    volumes:\n      - ${JSON.stringify(join(temporary, 'Caddyfile') + ':/etc/caddy/Caddyfile:ro')}\n  jev:\n    environment:\n      OPENROUTER_BASE_URL: http://127.0.0.1:3009/api/v1\n    volumes:\n      - ${JSON.stringify(join(root, 'server/request-log.integration.ts') + ':/app/server/request-log.integration.ts:ro')}\n      - ${JSON.stringify(join(temporary, 'provider.ts') + ':/app/provider-test.ts:ro')}\n`);
  const config = JSON.parse(compose('config', '--format', 'json'));
  assert.equal(config.services.jev.ports, undefined, 'App must not publish a host port');
  assert.equal(config.services.jev.read_only, true);
  assert.equal(config.services['jev-db'].ports, undefined, 'Database must not publish a host port');
  assert.equal(config.networks.jev_storage.internal, true);
  assert.deepEqual(Object.keys(config.services['jev-db'].networks), ['jev_storage']);
  assert(!JSON.stringify(config.services.jev.environment).includes(env.POSTGRES_ADMIN_PASSWORD));
  assert.equal(config.services.jev.environment.APP_ORIGIN, 'https://jev.purecode.sh');
  // Compose must fail closed even if the developer has a real .env locally.
  for (const key of ['OPENROUTER_API_KEY', 'POSTGRES_PASSWORD', 'POSTGRES_ADMIN_PASSWORD']) {
    const missing = Bun.spawnSync(['docker', ...composeArgs, 'config', '-q'], { cwd: root, env: { ...env, [key]: '' }, stdout: 'pipe', stderr: 'pipe' });
    assert.notEqual(missing.exitCode, 0, `Missing ${key} must prevent startup`);
  }

  // Check the overlay merges with, rather than replacing, the existing Caddy stack.
  writeFileSync(join(temporary, 'base.json'), JSON.stringify({
    services: {
      caddy: { image: 'caddy:latest', ports: ['443:443', '80:80'], networks: ['web', 'purecode'], depends_on: ['purecode'] },
      purecode: { image: 'ghcr.io/preacherxp/purecode-website:latest', networks: ['purecode'] },
    }, networks: { web: { driver: 'bridge' }, purecode: { driver: 'bridge' } },
  }));
  const merged = JSON.parse(docker(['compose', '--env-file', '/dev/null', '-p', project, '-f', join(temporary, 'base.json'), '-f', join(root, 'deploy/compose.jev.yaml'), 'config', '--format', 'json']));
  assert(merged.services.caddy.depends_on.purecode);
  assert(merged.services.caddy.depends_on.jev);
  assert(Object.hasOwn(merged.services.caddy.networks, 'web'));
  assert(Object.hasOwn(merged.services.caddy.networks, 'purecode'));
  assert.equal(merged.services.jev.ports, undefined);
  assert.deepEqual(merged.services.jev.environment, { ...config.services.jev.environment, OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1' });
  assert.equal(merged.services['jev-db'].ports, undefined);
  assert.equal(merged.networks.jev_storage.internal, true);
  assert(merged.services.jev.depends_on['jev-db']);

  console.log('Starting isolated smoke stack…');
  started = true;
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '90');
  const base = `http://${compose('port', 'caddy', '80')}`;
  const request = (path: string, init?: RequestInit) => fetch(base + path, { ...init, signal: AbortSignal.any([AbortSignal.timeout(5000), ...(init?.signal ? [init.signal] : [])]) });
  const home = await request('/');
  assert.equal(home.status, 200, 'Public visitors must not need a login');
  assert.equal(home.headers.get('www-authenticate'), null);
  assert((await home.text()).includes('Consort'));
  assert(home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  assert.equal((await request('/.env')).status, 404);
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { configured: true, router: 'typesafe/jev-1.13', storage: 'ready' });
  const post = (origin: string) => request('/api/route', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ task: '' }) });
  assert.equal((await post('https://jev.purecode.sh')).status, 400, 'Public origin passes origin check then fails input validation');
  assert.equal((await post('https://other.example')).status, 403);
  assert.notEqual(compose('exec', '-T', 'jev', 'id', '-u'), '0');
  compose('exec', '-T', 'jev', 'sh', '-c', 'test ! -e /app/.env && test ! -e /app/.env.production && test ! -e /app/.env.local && test ! -d /app/tests');
  for (const path of ['/api/logs', '/api/requests', '/api/admin/requests']) assert.equal((await request(path)).status, 404);
  console.log('Testing durable logging against real PostgreSQL…');
  console.log(compose('exec', '-T', '-e', 'CONSORT_DATABASE_TEST=1', 'jev', 'bun', 'server/request-log.integration.ts'));
  compose('exec', '-d', 'jev', 'bun', '/app/provider-test.ts');
  compose('exec', '-T', 'jev', 'bun', '-e', 'for (let n = 0; n < 30; n++) { try { if ((await fetch("http://127.0.0.1:3009/")).ok) process.exit(0); } catch {} await Bun.sleep(100); } process.exit(1);');
  const query = (sql: string) => compose('exec', '-T', 'jev-db', 'psql', '-U', 'postgres', '-d', 'consort', '-tAc', sql);
  const count = () => Number(query('SELECT count(*) FROM routing_requests'));
  const headers = { origin: 'https://jev.purecode.sh', 'content-type': 'application/json' };
  const routed = await request('/api/route', { method: 'POST', headers, body: JSON.stringify({ task: 'Complete HTTP logging round trip' }) });
  assert.equal(routed.status, 200);
  const requestId = routed.headers.get('x-request-id')!;
  assert(/^[0-9a-f-]{36}$/.test(requestId));
  assert.deepEqual(JSON.parse(query(`SELECT response FROM routing_requests WHERE id = '${requestId}'`)), await routed.json());
  const controller = new AbortController();
  const cancelled = request('/api/route', { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ task: 'HTTP cancellation in the live Bun server' }) }).catch(() => null);
  let pending = false;
  for (let n = 0; n < 20; n++) {
    if (query("SELECT status FROM routing_requests WHERE task = 'HTTP cancellation in the live Bun server'") === 'pending') { pending = true; break; }
    await Bun.sleep(100);
  }
  assert(pending, 'HTTP request must be recorded before cancellation');
  controller.abort(); await cancelled;
  let cancelledStatus = '';
  for (let n = 0; n < 30; n++) {
    cancelledStatus = query("SELECT status FROM routing_requests WHERE task = 'HTTP cancellation in the live Bun server'");
    if (cancelledStatus === 'cancelled') break;
    await Bun.sleep(100);
  }
  assert.equal(cancelledStatus, 'cancelled', 'Client abort must propagate through Caddy/Bun and persist as cancellation');
  const saved = count();
  assert(saved >= 13);
  compose('stop', 'jev-db');
  await Bun.sleep(5200); // The public health endpoint coalesces checks for five seconds.
  const unavailable = await request('/api/health');
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).storage, 'unavailable');
  const blocked = await request('/api/route', { method: 'POST', headers: { origin: 'https://jev.purecode.sh', 'content-type': 'application/json' }, body: JSON.stringify({ task: 'Do not route without durable storage' }) });
  assert.equal(blocked.status, 503);
  assert((await blocked.json()).error.includes('storage'));
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'jev-db');
  compose('restart', 'jev');
  compose('up', '-d', '--no-deps', '--no-build', '--wait', '--wait-timeout', '90', 'jev');
  assert.equal(count(), saved, 'Requests must survive app and database restarts');
  assert.equal((await request('/api/health')).status, 200);
  console.log('PASS: image, Caddy, Compose overlay, PostgreSQL logging and restart persistence, fail-closed outage behavior, public access, origin checks, non-root runtime, and no credential files. No paid API calls made.');
} finally {
  if (started) compose('down', '--volumes', '--remove-orphans');
  rmSync(temporary, { recursive: true, force: true });
}
