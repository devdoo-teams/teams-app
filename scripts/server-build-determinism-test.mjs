import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const root = process.cwd();
const execFileAsync = promisify(execFile);

async function resolveHead() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return stdout.trim();
}

function runBuild(checkoutRoot, runtimeDir, sourceCommit, useFileProviderFallback) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TEAMS_RUNTIME_DIST_DIR: runtimeDir,
      TEAMS_SOURCE_COMMIT: sourceCommit,
    };
    if (useFileProviderFallback) env.TEAMS_FILEPROVIDER_SERVER_REUSE = '1';
    else delete env.TEAMS_FILEPROVIDER_SERVER_REUSE;
    const child = spawn(process.execPath, ['scripts/build-server.mjs', '--core'], {
      cwd: checkoutRoot,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        // The process may have exited during timeout cleanup.
      }
      reject(new Error(`server determinism build timed out after 180000ms\n${output.slice(-12_000)}`));
    }, 180_000);
    child.stdout.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
    });
    child.stderr.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`server determinism build exited with code=${code} signal=${signal}\n${output}`));
        return;
      }
      resolve(output);
    });
  });
}

async function createCheckout(checkoutRoot, sourceCommit) {
  await execFileAsync('git', ['clone', '--shared', '--quiet', '--no-checkout', root, checkoutRoot], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
  await execFileAsync('git', ['checkout', '--quiet', '--detach', sourceCommit], {
    cwd: checkoutRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });
  await fs.symlink(path.join(root, 'node_modules'), path.join(checkoutRoot, 'node_modules'), 'junction');
}

async function readServerJavaScriptOutputs(runtimeDir) {
  const serverDirectory = path.join(runtimeDir, 'server');
  const names = (await fs.readdir(serverDirectory))
    .filter((name) => name.endsWith('.js'))
    .sort();
  const outputs = {};
  for (const name of names) {
    outputs[name] = await fs.readFile(path.join(serverDirectory, name), 'utf8');
  }
  return outputs;
}

function serverTreeSha256(outputs) {
  const identity = Object.entries(outputs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, contents]) => `${name}\0${crypto.createHash('sha256').update(contents).digest('hex')}`)
    .join('\n');
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function assertBundleDoesNotEmbedDependencyRoot(outputs, dependencyRoot) {
  const absoluteDependencyRoot = path.resolve(dependencyRoot);
  for (const [name, contents] of Object.entries(outputs)) {
    assert.equal(
      contents.includes(absoluteDependencyRoot),
      false,
      `bundled server output ${name} must not embed the dependency checkout root`,
    );
  }
}

function assertFallbackHasNoNodeModulesPathComments(outputs) {
  for (const [name, contents] of Object.entries(outputs)) {
    assert.doesNotMatch(
      contents,
      /(?:^|\n)\s*\/\/[^\n]*node_modules[\\/]/,
      `FileProvider fallback output ${name} must not embed a node_modules source-path comment`,
    );
  }
}

async function buildAndRead({ checkoutRoot, runtimeDir, sourceCommit, useFileProviderFallback }) {
  await fs.mkdir(path.join(runtimeDir, 'server'), { recursive: true });
  await runBuild(checkoutRoot, runtimeDir, sourceCommit, useFileProviderFallback);
  const entryBytes = await fs.readFile(path.join(runtimeDir, 'server', 'index.js'));
  const marker = JSON.parse(await fs.readFile(path.join(runtimeDir, 'server', '.teams-server-build-commit'), 'utf8'));
  const bundleSha256 = crypto.createHash('sha256').update(entryBytes).digest('hex');
  assert.equal(marker.bundleSha256, bundleSha256, 'server marker must attest the emitted bundle');
  assert.equal(marker.commit, sourceCommit, 'server marker must identify the pinned source commit');
  const javascriptOutputs = await readServerJavaScriptOutputs(runtimeDir);
  return { entryBytes, bundleSha256, marker, javascriptOutputs };
}

const sourceCommit = await resolveHead();
const dependencyRoot = await fs.realpath(path.join(root, 'node_modules'));
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-server-determinism-'));
try {
  const checkoutRoots = [
    path.join(testRoot, 'checkout-a'),
    path.join(testRoot, 'checkout-b'),
  ];
  for (const checkoutRoot of checkoutRoots) await createCheckout(checkoutRoot, sourceCommit);

  const bundleBuilds = [];
  for (const [index, checkoutRoot] of checkoutRoots.entries()) {
    const runtimeDir = path.join(testRoot, `bundle-${index + 1}`);
    const build = await buildAndRead({ checkoutRoot, runtimeDir, sourceCommit, useFileProviderFallback: false });
    assertBundleDoesNotEmbedDependencyRoot(build.javascriptOutputs, dependencyRoot);
    bundleBuilds.push(build);
  }

  assert.deepEqual(
    bundleBuilds[1].javascriptOutputs,
    bundleBuilds[0].javascriptOutputs,
    'normal packages=bundle mode must emit the same complete server JavaScript tree from different checkout roots',
  );
  assert.deepEqual(bundleBuilds[1].marker, bundleBuilds[0].marker, 'normal bundle markers must match across checkout roots');
  assert.equal(bundleBuilds[1].bundleSha256, bundleBuilds[0].bundleSha256, 'normal bundle entry SHA-256 must match across checkout roots');
  const bundleTreeHashes = bundleBuilds.map((build) => serverTreeSha256(build.javascriptOutputs));
  console.log(
    `PASS: normal packages=bundle output is checkout-independent for ${sourceCommit} ` +
      `(files=${Object.keys(bundleBuilds[0].javascriptOutputs).length}, treeSha256=${bundleTreeHashes.join('/')})`,
  );

  const fallbackBuilds = [];
  for (const [index, runtimeDir] of [
    path.join(testRoot, 'fallback-1'),
    path.join(testRoot, 'fallback-2'),
  ].entries()) {
    const build = await buildAndRead({
      checkoutRoot: checkoutRoots[0],
      runtimeDir,
      sourceCommit,
      useFileProviderFallback: true,
    });
    assertFallbackHasNoNodeModulesPathComments(build.javascriptOutputs);
    fallbackBuilds.push(build);
  }

  assert.deepEqual(
    fallbackBuilds[1].javascriptOutputs,
    fallbackBuilds[0].javascriptOutputs,
    'FileProvider fallback external mode must remain deterministic',
  );
  assert.deepEqual(fallbackBuilds[1].marker, fallbackBuilds[0].marker, 'FileProvider fallback markers must match');
  assert.equal(fallbackBuilds[1].bundleSha256, fallbackBuilds[0].bundleSha256, 'FileProvider fallback bundle SHA-256 must match');
  const fallbackTreeHashes = fallbackBuilds.map((build) => serverTreeSha256(build.javascriptOutputs));
  console.log(
    `PASS: FileProvider fallback server build remains deterministic for ${sourceCommit} ` +
      `(files=${Object.keys(fallbackBuilds[0].javascriptOutputs).length}, treeSha256=${fallbackTreeHashes.join('/')})`,
  );
} finally {
  await fs.rm(testRoot, { recursive: true, force: true });
}
