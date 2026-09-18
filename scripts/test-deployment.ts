import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

// Local containers only: fake provider key, loopback ephemeral port, no ACME or paid requests.
const root = resolve(import.meta.dir, '..');
const temporary = mkdtempSync(join(tmpdir(), 'consort-deployment-'));
const project = `consort-smoke-${process.pid}`;
const image = 'consort-deployment-test:local';
const env = { ...process.env, OPENROUTER_API_KEY: 'smoke-test-not-a-real-key', JEV_IMAGE: image };
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
  console.log('Validating the production Caddyfile…');
  docker(['run', '--rm', '-v', `${join(root, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`, 'caddy:2-alpine', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);

  const site = readFileSync(join(root, 'Caddyfile'), 'utf8');
  assert(site.startsWith('jev.purecode.sh {'));
  writeFileSync(join(temporary, 'Caddyfile'), site.replace('jev.purecode.sh {', ':80 {'));
  writeFileSync(join(temporary, 'override.yaml'), `services:\n  caddy:\n    ports: !override\n      - "127.0.0.1::80"\n    volumes:\n      - ${JSON.stringify(join(temporary, 'Caddyfile') + ':/etc/caddy/Caddyfile:ro')}\n`);
  const config = JSON.parse(compose('config', '--format', 'json'));
  assert.equal(config.services.jev.ports, undefined, 'App must not publish a host port');
  assert.equal(config.services.jev.read_only, true);
  assert.equal(config.services.jev.environment.APP_ORIGIN, 'https://jev.purecode.sh');
  // Compose must fail closed even if the developer has a real .env locally.
  const missing = Bun.spawnSync(['docker', ...composeArgs, 'config', '-q'], { cwd: root, env: { ...env, OPENROUTER_API_KEY: '' }, stdout: 'pipe', stderr: 'pipe' });
  assert.notEqual(missing.exitCode, 0, 'Missing provider key must prevent startup');

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
  assert.deepEqual(merged.services.jev.environment, config.services.jev.environment);

  console.log('Starting isolated smoke stack…');
  started = true;
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '90');
  const base = `http://${compose('port', 'caddy', '80')}`;
  const request = (path: string, init?: RequestInit) => fetch(base + path, { ...init, signal: AbortSignal.timeout(5000) });
  const home = await request('/');
  assert.equal(home.status, 200, 'Public visitors must not need a login');
  assert.equal(home.headers.get('www-authenticate'), null);
  assert((await home.text()).includes('Consort'));
  assert(home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  assert.equal((await request('/.env')).status, 404);
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).configured, true);
  const post = (origin: string) => request('/api/route', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ task: '' }) });
  assert.equal((await post('https://jev.purecode.sh')).status, 400, 'Public origin passes origin check then fails input validation');
  assert.equal((await post('https://other.example')).status, 403);
  assert.notEqual(compose('exec', '-T', 'jev', 'id', '-u'), '0');
  compose('exec', '-T', 'jev', 'sh', '-c', 'test ! -e /app/.env && test ! -e /app/.env.production && test ! -d /app/tests');
  console.log('PASS: image, Caddy, Compose overlay, healthcheck, anonymous public access, origin checks, non-root runtime, and no credential files. No paid API calls made.');
} finally {
  if (started) compose('down', '--volumes', '--remove-orphans');
  rmSync(temporary, { recursive: true, force: true });
}
