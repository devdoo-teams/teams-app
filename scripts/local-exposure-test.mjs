import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('./local-exposure.mjs', import.meta.url);
let implementation;
try {
  implementation = await import(moduleUrl.href);
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
assert.ok(implementation, 'local server/tunnel selection has not been implemented');
const { createExposurePlan, checkExposurePlan, parseExposureConfig, probeLocalHealth } = implementation;
let checks = 0;
function check(name, body) {
  body();
  checks += 1;
  console.log(`PASS ${name}`);
}
const localUrl = 'http://127.0.0.1:43978';
const config = (provider, extra = {}, server = {}) => ({
  schema: 1,
  server: { kind: 'existing', localUrl, ...server },
  tunnel: { provider, ...extra },
});

check('default preserves existing server and DevTunnel without starting anything', () => {
  const plan = createExposurePlan({ schema: 1 });
  assert.equal(plan.server.kind, 'existing');
  assert.equal(plan.server.localUrl, 'http://127.0.0.1:3978');
  assert.equal(plan.tunnel.provider, 'devtunnel');
  assert.equal(plan.server.command, null);
  assert.equal(plan.tunnel.command, null);
  assert.equal(plan.sideEffects, 'none');
});
check('local Node uses the existing authenticated entry point', () => {
  const plan = createExposurePlan(config('none', {}, { kind: 'node' }));
  assert.deepEqual(plan.server.command, {
    executable: 'npm', args: ['start'], environment: { PORT: '43978', TEAMS_BIND_HOST: '127.0.0.1' },
  });
  assert.equal(plan.publicOrigin, null);
  assert.equal(plan.tunnel.command, null);
});
check('Docker is an explicit prepared-image plan with no automatic pull', () => {
  const image = `ghcr.io/example/teams-app@sha256:${'a'.repeat(64)}`;
  const plan = createExposurePlan(config('none', {}, { kind: 'docker', image }));
  assert.equal(plan.server.command.executable, 'docker');
  assert.ok(plan.server.command.args.includes('--pull=never'));
  assert.ok(plan.server.command.args.includes('127.0.0.1:43978:3978'));
  assert.ok(plan.server.requirements.includes('review-auth-stores-worker-configuration'));
});
check('existing DevTunnel host plan preserves its ACL and configured ports', () => {
  const plan = createExposurePlan(config('devtunnel', {
    reference: 'fixture-3978.jpe1', publicOrigin: 'https://fixture-3978.jpe1.devtunnels.ms',
  }));
  assert.deepEqual(plan.tunnel.command, {
    executable: 'devtunnel', args: ['host', 'fixture-3978.jpe1'], environment: {},
  });
  assert.equal(plan.tunnel.capabilities.stableHostname, 'configured');
  assert.ok(!JSON.stringify(plan).includes('allow-anonymous'));
});
check('Quick Tunnel is a synthetic-only option with unknown generated origin and no SSE', () => {
  const plan = createExposurePlan(config('cloudflare-quick'));
  assert.deepEqual(plan.tunnel.command.args, ['tunnel', '--url', localUrl]);
  assert.equal(plan.tunnel.capabilities.sse, 'unsupported');
  assert.equal(plan.tunnel.capabilities.stableHostname, 'no');
  assert.equal(plan.teamsRoute, 'synthetic-only');
});
check('named Cloudflare references an existing configuration without login/create/DNS writes', () => {
  const plan = createExposurePlan(config('cloudflare-named', {
    reference: 'fixture-tunnel', configFile: './config/cloudflared.yml',
    publicOrigin: 'https://teams.example.com',
  }));
  assert.deepEqual(plan.tunnel.command.args, [
    'tunnel', '--config', './config/cloudflared.yml', 'run', 'fixture-tunnel',
  ]);
  assert.equal(plan.tunnel.capabilities.sse, 'unverified');
  assert.ok(plan.tunnel.requirements.includes('verify-existing-ingress-target'));
});
check('ngrok uses an explicitly assigned domain and reports the HTML interstitial gate', () => {
  const plan = createExposurePlan(config('ngrok', { publicOrigin: 'https://assigned.ngrok-free.app' }));
  assert.deepEqual(plan.tunnel.command.args, ['http', localUrl, '--url', 'https://assigned.ngrok-free.app']);
  assert.ok(plan.tunnel.requirements.includes('verify-teams-html-without-interstitial'));
  assert.equal(plan.tunnel.capabilities.webSocket, 'documented');
  assert.equal(plan.tunnel.capabilities.sse, 'unverified');
});
check('domain proposal keeps tab/Bot/SSO changes together without changing registrations', () => {
  const plan = createExposurePlan(config('ngrok', { publicOrigin: 'https://assigned.ngrok-free.app' }));
  assert.equal(plan.teamsProposal.tabDomain, 'assigned.ngrok-free.app');
  assert.equal(plan.teamsProposal.contentUrl, 'https://assigned.ngrok-free.app/tabs/home/');
  assert.equal(plan.teamsProposal.botMessagingEndpoint, 'https://assigned.ngrok-free.app/api/messages');
  assert.equal(plan.teamsProposal.applicationIdUriTemplate,
    'api://assigned.ngrok-free.app/botid-{existing-bot-client-id}');
  assert.equal(plan.teamsProposal.status, 'review-required');
  assert.equal(plan.externalVerification, 'unverified');
});
check('unknown keys and inline secrets are rejected without echoing values', () => {
  for (const bad of [
    { schema: 1, token: 'DO-NOT-ECHO' },
    config('ngrok', { publicOrigin: 'https://a.example.com', authtoken: 'DO-NOT-ECHO' }),
    config('none', {}, { env: { PASSWORD: 'DO-NOT-ECHO' } }),
  ]) {
    assert.throws(() => createExposurePlan(bad), (error) =>
      /Unsupported configuration fields/.test(error.message) && !error.message.includes('DO-NOT-ECHO'));
  }
});
check('local checks accept literal loopback origins only, with explicit bounded ports', () => {
  for (const value of [
    'http://localhost:3978', 'http://0.0.0.0:3978', 'http://example.com:3978',
    'http://127.1:3978', 'http://2130706433:3978', 'http://127.0.0.1:0',
    'http://127.0.0.1:65536', 'https://127.0.0.1:3978',
    'http://user:password@127.0.0.1:3978', 'http://127.0.0.1:3978/api',
    'http://127.0.0.1:3978?token=DO-NOT-ECHO',
  ]) assert.throws(() => createExposurePlan(config('none', {}, { localUrl: value })), /localUrl/);
  assert.equal(createExposurePlan(config('none', {}, { localUrl: 'http://[::1]:65535/' })).server.port, 65535);
});
check('public origins reject credentials, private hosts, paths, ports and URL coercion', () => {
  for (const value of [
    'http://a.example.com', 'https://user:pass@a.example.com', 'https://127.0.0.1',
    'https://10.0.0.1', 'https://[::1]', 'https://a.local', 'https://a.localhost',
    'https://a.example.com:443', 'https://a.example.com/path',
    'https://a.example.com?token=DO-NOT-ECHO', 'https://a.example.com#x',
    'https://a_example.com', 'https://A.example.com', ' https://a.example.com',
  ]) assert.throws(() => createExposurePlan(config('ngrok', { publicOrigin: value })), /publicOrigin/);
});
check('unvalidated executable arguments and unsupported configurations fail closed', () => {
  for (const bad of [
    config('unsupported'), { schema: 2 }, { schema: 1, server: null }, { schema: 1, tunnel: null },
    config('none', {}, { kind: null }), config('none', {}, { localUrl: null }),
    config('none', { reference: 'irrelevant' }),
    config('cloudflare-quick', { publicOrigin: 'https://fake.example.com' }),
    config('devtunnel', { reference: '--allow-anonymous' }),
    config('cloudflare-named', { reference: 'x; touch /tmp/never', configFile: './safe.yml', publicOrigin: 'https://a.example.com' }),
    config('cloudflare-named', { reference: 'valid', configFile: '--token=DO-NOT-ECHO', publicOrigin: 'https://a.example.com' }),
    config('docker'), config('none', {}, { kind: 'docker', image: 'node:latest' }),
    config('none', {}, { kind: 'node', image: 'unused' }),
    config('none', {}, { kind: 'node', localUrl: 'http://[::1]:3978' }),
  ]) assert.throws(() => createExposurePlan(bad));
});
check('JSON parser suppresses syntax details and bounds input size', () => {
  assert.deepEqual(parseExposureConfig('{"schema":1}'), { schema: 1 });
  for (const value of ['{"token":"DO-NOT-ECHO', '[]', 'null', ' '.repeat(65537)]) {
    assert.throws(() => parseExposureConfig(value), (error) => !error.message.includes('DO-NOT-ECHO'));
  }
});

const temporary = await mkdtemp(path.join(os.tmpdir(), 'teams-exposure-test-'));
const cli = new URL('./local-exposure-cli.mjs', import.meta.url);
try {
  const file = path.join(temporary, 'profile.json');
  await writeFile(file, JSON.stringify(config('none')));
  const run = (args, env = {}) => spawnSync(process.execPath, [fileURLToPath(cli), ...args], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, ...env },
  });
  check('CLI emits plans only and ignores runtime credentials/environment routing overrides', () => {
    const result = run(['plan', '--config', file], {
      TAB_DOMAIN: 'DO-NOT-ECHO', AUTHTOKEN: 'DO-NOT-ECHO', TEAMS_SKIP_AUTH: 'true',
    });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.tunnel.provider, 'none');
    assert.ok(!result.stdout.includes('DO-NOT-ECHO'));
    assert.equal(plan.sideEffects, 'none');
  });
  check('CLI has no apply/start/login/install or arbitrary argument path', () => {
    for (const args of [['start'], ['apply'], ['plan', '--token', 'DO-NOT-ECHO'], ['check', '--public']]) {
      const result = run(args);
      assert.equal(result.status, 1);
      assert.ok(!`${result.stdout}${result.stderr}`.includes('DO-NOT-ECHO'));
    }
  });
  const result = await checkExposurePlan(createExposurePlan(config('ngrok', {
    publicOrigin: 'https://assigned.ngrok-free.app',
  })), {
    findExecutable: async () => null,
    probeHealth: async () => ({ status: 'unavailable', httpStatus: null }),
  });
  check('missing provider CLI and unavailable local server never become live readiness', () => {
    assert.equal(result.tools.ngrok.status, 'not-installed');
    assert.equal(result.localHealth.status, 'unavailable');
    assert.equal(result.status, 'blocked');
    assert.equal(result.externalVerification, 'unverified');
  });

  const tampered = createExposurePlan(config('ngrok', { publicOrigin: 'https://assigned.ngrok-free.app' }));
  tampered.tunnel.command = { executable: 'sh', args: ['-c', 'DO-NOT-EXECUTE'] };
  const located = [];
  const tamperedResult = await checkExposurePlan(tampered, {
    findExecutable: async (name) => { located.push(name); return null; },
    probeHealth: async () => ({ status: 'checked', httpStatus: 200 }),
  });
  check('check revalidates configuration and ignores tampered command plans', () => {
    assert.deepEqual(located, ['ngrok']);
    assert.equal(tamperedResult.status, 'blocked');
  });
  const versionFixture = path.join(temporary, 'version-fixture.mjs');
  await writeFile(versionFixture, `#!${process.execPath}\nconsole.log('fixture 1.0.1549.2\\nDO-NOT-ECHO');\n`, { mode: 0o700 });
  const versionResult = await checkExposurePlan(createExposurePlan(config('devtunnel')), {
    findExecutable: async () => versionFixture,
    probeHealth: async () => ({ status: 'checked', httpStatus: 200 }),
  });
  check('version probes preserve four-part versions and suppress unrelated stdout', () => {
    assert.equal(versionResult.tools.devtunnel.version, '1.0.1549.2');
    assert.ok(!JSON.stringify(versionResult).includes('DO-NOT-ECHO'));
  });
  const resistantFixture = path.join(temporary, 'resistant-version-fixture.mjs');
  const ownedPids = path.join(temporary, 'owned-version-pids.json');
  await writeFile(resistantFixture, `#!${process.execPath}
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),6000)"], { stdio: 'inherit' });
writeFileSync(${JSON.stringify(ownedPids)}, JSON.stringify([process.pid, child.pid]));
console.log('fixture 9.8.7');
setTimeout(() => process.exit(0), 6000);
`, { mode: 0o700 });
  let pids = [];
  try {
    const started = performance.now();
    const resistant = await checkExposurePlan(createExposurePlan(config('devtunnel')), {
      findExecutable: async () => resistantFixture,
      probeHealth: async () => ({ status: 'checked', httpStatus: 200 }),
    });
    pids = JSON.parse(await readFile(ownedPids, 'utf8'));
    check('SIGTERM-resistant version probes and pipe-holding descendants are bounded', () => {
      assert.ok(performance.now() - started < 4500, 'version probe exceeded timeout and bounded cleanup grace');
      assert.equal(resistant.tools.devtunnel.status, 'version-unverified');
      assert.equal(resistant.tools.devtunnel.version, null);
      assert.equal(resistant.tools.devtunnel.reason, 'ETIMEDOUT');
      assert.equal(resistant.tools.devtunnel.termination.sentKill, true);
      assert.equal(resistant.tools.devtunnel.termination.reaped, true);
    });
    for (const pid of pids) {
      const deadline = performance.now() + 2000;
      let exists = true;
      while (exists && performance.now() < deadline) {
        try { process.kill(pid, 0); await new Promise((resolve) => setTimeout(resolve, 20)); }
        catch (error) { if (error.code !== 'ESRCH') throw error; exists = false; }
      }
      assert.equal(exists, false, 'owned version probe process survived cleanup');
    }
  } finally {
    if (!pids.length) {
      try { pids = JSON.parse(await readFile(ownedPids, 'utf8')); } catch { /* Startup may have failed before recording a child. */ }
    }
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }

  let mode = 'normal';
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    if (request.url !== '/api/health') { response.writeHead(404).end(); return; }
    if (mode === 'redirect') { response.writeHead(302, { Location: 'https://never-follow.example.com' }).end(); return; }
    if (mode === 'timeout') return;
    if (mode === 'oversize') { response.end('x'.repeat(65537)); return; }
    if (mode === 'invalid-json') { response.end('DO-NOT-ECHO'); return; }
    if (mode === 'unrelated-server') { response.end('{"status":"ok"}'); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ version: '1.2.3', sourceCommit: 'b'.repeat(40), privateData: 'DO-NOT-ECHO' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const fixtureUrl = `http://127.0.0.1:${server.address().port}`;
    const health = await checkExposurePlan(createExposurePlan(config('none', {}, { localUrl: fixtureUrl })));
    check('real loopback HTTP check reads a bounded health result without exposing arbitrary body', () => {
      assert.equal(health.status, 'local-check-passed');
      assert.equal(health.localHealth.httpStatus, 200);
      assert.equal(health.localHealth.identity.version, '1.2.3');
      assert.ok(!JSON.stringify(health).includes('DO-NOT-ECHO'));
      assert.equal(health.externalVerification, 'unverified');
    });
    mode = 'redirect';
    const redirected = await probeLocalHealth(fixtureUrl);
    check('loopback health never follows a redirect to an external host', () => {
      assert.equal(redirected.status, 'http-error');
      assert.equal(redirected.httpStatus, 302);
      assert.equal(requests, 2);
    });
    mode = 'timeout';
    const started = performance.now();
    const timeout = await probeLocalHealth(fixtureUrl, { timeoutMs: 100 });
    check('health has a total deadline and closes a silent fixture request', () => {
      assert.equal(timeout.status, 'timeout');
      assert.ok(performance.now() - started < 1500);
    });
    mode = 'oversize';
    const oversized = await probeLocalHealth(fixtureUrl);
    check('health bounds response bytes', () => assert.equal(oversized.status, 'response-too-large'));
    mode = 'invalid-json';
    const invalid = await probeLocalHealth(fixtureUrl);
    check('malformed health responses fail without returning body contents', () => {
      assert.equal(invalid.status, 'invalid-json');
      assert.ok(!JSON.stringify(invalid).includes('DO-NOT-ECHO'));
    });
    mode = 'unrelated-server';
    const unrelated = await probeLocalHealth(fixtureUrl);
    check('HTTP 200 from an unidentified server does not pass the local release identity check', () => {
      assert.equal(unrelated.status, 'identity-unverified');
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Local exposure tests passed: ${checks} scenarios; external providers remain unverified.`);
