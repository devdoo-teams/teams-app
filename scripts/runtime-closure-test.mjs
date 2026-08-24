import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  captureRuntimeClosure,
  createRuntimeDependencyStagingPlan,
  prepareRuntimeDependencyStaging,
  verifyRuntimeClosure,
} from './runtime-closure.mjs';

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-runtime-closure-test-'));
const limits = {
  maxEntries: 32,
  maxFileBytes: 1_024,
  maxTotalBytes: 4_096,
  maxPathBytes: 256,
};

function canonicalMetadata(absolutePath, type) {
  const metadata = fs.lstatSync(absolutePath, { bigint: true });
  return {
    type,
    mode: Number(metadata.mode & 0o7777n),
    mtimeNs: metadata.mtimeNs.toString(10),
    ctimeNs: metadata.ctimeNs.toString(10),
    dev: metadata.dev.toString(10),
    ino: metadata.ino.toString(10),
  };
}

function expectCanonicalMetadata(metadata, type) {
  assert.deepEqual(Object.keys(metadata), ['type', 'mode', 'mtimeNs', 'ctimeNs', 'dev', 'ino']);
  assert.equal(metadata.type, type);
  assert.ok(Number.isSafeInteger(metadata.mode));
  assert.ok(metadata.mode >= 0 && metadata.mode <= 0o7777);
  for (const field of ['mtimeNs', 'ctimeNs']) {
    assert.match(metadata[field], /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/);
  }
  for (const field of ['dev', 'ino']) {
    assert.match(metadata[field], /^(?:0|[1-9][0-9]*)$/);
  }
  assert.equal('atimeNs' in metadata, false);
  assert.equal('birthtimeNs' in metadata, false);
  assert.equal('uid' in metadata, false);
  assert.equal('gid' in metadata, false);
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function swapWhenPresent(targetPath, replacementPath, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let observed = false;
  while (Date.now() < deadline) {
    if (fs.existsSync(targetPath)) {
      if (!observed) {
        observed = true;
        await delay(2);
        continue;
      }
      const parkedPath = `${targetPath}.replacement-source`;
      fs.renameSync(replacementPath, parkedPath);
      fs.renameSync(targetPath, replacementPath);
      fs.renameSync(parkedPath, targetPath);
      return;
    }
    await delay(1);
  }
  throw new Error(`timed out waiting to replace ${targetPath}`);
}

async function swapSourceAfterDestinationAppears({ destination, source, replacementPath, timeoutMs = 2_000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(destination)) {
      const parkedPath = `${source}.replacement-source`;
      fs.renameSync(replacementPath, parkedPath);
      fs.renameSync(source, replacementPath);
      fs.renameSync(parkedPath, source);
      return;
    }
    await delay(1);
  }
  throw new Error(`timed out waiting for staging destination ${destination}`);
}

function writeFixturePackage(root, packageJson = '{"name":"fixture","version":"1.0.0"}\n') {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), packageJson);
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{}}\n',
  );
}

function writeRuntimeFixture(root, source = 'export default 1;\n') {
  fs.mkdirSync(path.join(root, 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fixture', 'index.js'), source);
}

async function capture(root, overrides = {}) {
  return captureRuntimeClosure({
    root,
    limits: { ...limits, ...overrides.limits },
    approvedNativeAddons: overrides.approvedNativeAddons ?? [],
    testHooks: overrides.testHooks,
  });
}

async function verify(root, expected, overrides = {}) {
  return verifyRuntimeClosure({
    root,
    expected,
    limits: { ...limits, ...overrides.limits },
    approvedNativeAddons: overrides.approvedNativeAddons ?? [],
  });
}

try {
  const pinnedSourceRoot = path.join(fixtureRoot, 'pinned-source');
  const stagingRoot = path.join(fixtureRoot, 'runtime-stage');
  writeFixturePackage(pinnedSourceRoot);

  const plan = await createRuntimeDependencyStagingPlan({
    pinnedSourceRoot,
    stagingRoot,
  });
  assert.deepEqual(plan.command, {
    executable: 'npm',
    args: ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    cwd: stagingRoot,
  });
  assert.deepEqual(plan.inputs, [
    {
      source: path.join(pinnedSourceRoot, 'package.json'),
      destination: path.join(stagingRoot, 'package.json'),
    },
    {
      source: path.join(pinnedSourceRoot, 'package-lock.json'),
      destination: path.join(stagingRoot, 'package-lock.json'),
    },
  ]);

  const commandCalls = [];
  const prepared = await prepareRuntimeDependencyStaging({
    pinnedSourceRoot,
    stagingRoot,
    runCommandSync(executable, args, options) {
      commandCalls.push({ executable, args, options });
      fs.mkdirSync(path.join(stagingRoot, 'node_modules', 'fixture'), { recursive: true });
      fs.writeFileSync(path.join(stagingRoot, 'node_modules', 'fixture', 'index.js'), 'export default 1;\n');
    },
  });
  assert.deepEqual(commandCalls, [{
    executable: 'npm',
    args: ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    options: { cwd: stagingRoot, stdio: 'inherit' },
  }]);
  assert.equal(
    fs.readFileSync(path.join(stagingRoot, 'package-lock.json'), 'utf8'),
    fs.readFileSync(path.join(pinnedSourceRoot, 'package-lock.json'), 'utf8'),
  );
  assert.equal(prepared.nodeModulesRoot, path.join(stagingRoot, 'node_modules'));
  assert.deepEqual(prepared.inputAttestations, [
    {
      path: 'package-lock.json',
      bytes: 71,
      contentSha256: '91f52ba889daecd037b01839f8db0a4cf906ccf77664c859dae245515d699fda',
    },
    {
      path: 'package.json',
      bytes: 37,
      contentSha256: '8812280c0ddd054048a24ca505da8848a0c0dd053d4fd858a536a7917a648a36',
    },
  ]);

  const replacedDestinationSource = path.join(fixtureRoot, 'replaced-destination-source');
  const replacedDestinationStage = path.join(fixtureRoot, 'replaced-destination-stage');
  writeFixturePackage(replacedDestinationSource, ' '.repeat(8 * 1_024 * 1_024));
  const destinationReplacement = path.join(fixtureRoot, 'replacement-package.json');
  fs.writeFileSync(destinationReplacement, '{"replaced":true}\n');
  const destinationSwap = swapWhenPresent(
    path.join(replacedDestinationStage, 'package.json'),
    destinationReplacement,
  );
  await assert.rejects(
    prepareRuntimeDependencyStaging({
      pinnedSourceRoot: replacedDestinationSource,
      stagingRoot: replacedDestinationStage,
      runCommandSync() {
        assert.fail('npm must not run after a staged input is replaced');
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /staging input|destination|changed|replaced/i.test(error.message),
  );
  await destinationSwap;

  const replacedSourceRoot = path.join(fixtureRoot, 'replaced-source-root');
  const replacedSourceStage = path.join(fixtureRoot, 'replaced-source-stage');
  writeFixturePackage(replacedSourceRoot, ' '.repeat(8 * 1_024 * 1_024));
  const sourceReplacement = path.join(fixtureRoot, 'replacement-source-package.json');
  fs.writeFileSync(sourceReplacement, '{"sourceReplaced":true}\n');
  const sourceSwap = swapSourceAfterDestinationAppears({
    destination: path.join(replacedSourceStage, 'package.json'),
    source: path.join(replacedSourceRoot, 'package.json'),
    replacementPath: sourceReplacement,
  });
  await assert.rejects(
    prepareRuntimeDependencyStaging({
      pinnedSourceRoot: replacedSourceRoot,
      stagingRoot: replacedSourceStage,
      runCommandSync() {
        assert.fail('npm must not run after a pinned source input changes');
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /source.*changed|staging input/i.test(error.message),
  );
  await sourceSwap;

  const symlinkInputRoot = path.join(fixtureRoot, 'symlink-input-root');
  const symlinkInputStage = path.join(fixtureRoot, 'symlink-input-stage');
  writeFixturePackage(symlinkInputRoot);
  const externalPackage = path.join(fixtureRoot, 'external-package.json');
  fs.writeFileSync(externalPackage, '{"name":"external"}\n');
  fs.unlinkSync(path.join(symlinkInputRoot, 'package.json'));
  fs.symlinkSync(externalPackage, path.join(symlinkInputRoot, 'package.json'));
  await assert.rejects(
    prepareRuntimeDependencyStaging({
      pinnedSourceRoot: symlinkInputRoot,
      stagingRoot: symlinkInputStage,
      runCommandSync() {
        assert.fail('npm must not run with a symbolic-link source input');
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /staging input|symbolic|without following/i.test(error.message),
  );

  const oversizedInputRoot = path.join(fixtureRoot, 'oversized-input-root');
  const oversizedInputStage = path.join(fixtureRoot, 'oversized-input-stage');
  writeFixturePackage(oversizedInputRoot);
  fs.truncateSync(path.join(oversizedInputRoot, 'package-lock.json'), (16 * 1_024 * 1_024) + 1);
  await assert.rejects(
    prepareRuntimeDependencyStaging({
      pinnedSourceRoot: oversizedInputRoot,
      stagingRoot: oversizedInputStage,
      runCommandSync() {
        assert.fail('npm must not run with an oversized source input');
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_LIMIT_EXCEEDED',
  );

  const replacedRoot = path.join(fixtureRoot, 'replace-root');
  const replacementRoot = path.join(fixtureRoot, 'replace-root-alternate');
  const replacedRootStage = path.join(fixtureRoot, 'replace-root-stage');
  const parkedRoot = path.join(fixtureRoot, 'replace-root-parked');
  writeFixturePackage(replacedRoot);
  writeFixturePackage(replacementRoot);
  await assert.rejects(
    prepareRuntimeDependencyStaging({
      pinnedSourceRoot: replacedRoot,
      stagingRoot: replacedRootStage,
      testHooks: {
        afterInputsStaged() {
          fs.renameSync(replacedRoot, parkedRoot);
          fs.renameSync(replacementRoot, replacedRoot);
        },
      },
      runCommandSync() {
        assert.fail('npm must not run after pinnedSourceRoot is replaced');
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /pinnedSourceRoot|canonical.*root|directory.*changed|replaced/i.test(error.message),
  );

  const changedStagingRoot = path.join(fixtureRoot, 'changed-staging-root');
  const changedStagingStage = path.join(fixtureRoot, 'changed-staging-stage');
  writeFixturePackage(changedStagingRoot);
  let npmRanAfterStagingMutation = false;
  await assert.rejects(
    prepareRuntimeDependencyStaging({
      pinnedSourceRoot: changedStagingRoot,
      stagingRoot: changedStagingStage,
      testHooks: {
        beforeNpmCi({ stagingRoot }) {
          fs.writeFileSync(path.join(stagingRoot, 'unexpected-before-npm-ci'), 'unexpected\n');
        },
      },
      runCommandSync() {
        npmRanAfterStagingMutation = true;
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /stagingRoot.*before npm ci|stagingRoot changed/i.test(error.message),
  );
  assert.equal(npmRanAfterStagingMutation, false);

  const replacedStagingSource = path.join(fixtureRoot, 'replaced-staging-source');
  const replacedStagingStage = path.join(fixtureRoot, 'replaced-staging-stage');
  const parkedStagingStage = path.join(fixtureRoot, 'parked-staging-stage');
  writeFixturePackage(replacedStagingSource);
  let npmRanAfterStagingRootReplacement = false;
  await assert.rejects(
    prepareRuntimeDependencyStaging({
      pinnedSourceRoot: replacedStagingSource,
      stagingRoot: replacedStagingStage,
      testHooks: {
        afterInputsStaged({ stagingRoot }) {
          fs.renameSync(stagingRoot, parkedStagingStage);
          fs.mkdirSync(stagingRoot, { mode: 0o700 });
          for (const fileName of ['package.json', 'package-lock.json']) {
            fs.writeFileSync(
              path.join(stagingRoot, fileName),
              fs.readFileSync(path.join(parkedStagingStage, fileName)),
            );
          }
        },
      },
      runCommandSync() {
        npmRanAfterStagingRootReplacement = true;
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /stagingRoot.*changed|stagingRoot.*replaced/i.test(error.message),
  );
  assert.equal(npmRanAfterStagingRootReplacement, false);

  const symlinkDestinationSource = path.join(fixtureRoot, 'symlink-destination-source');
  const symlinkDestinationStage = path.join(fixtureRoot, 'symlink-destination-stage');
  writeFixturePackage(symlinkDestinationSource, ' '.repeat(8 * 1_024 * 1_024));
  const symlinkTarget = path.join(fixtureRoot, 'symlink-destination-target');
  const symlinkReplacement = path.join(fixtureRoot, 'symlink-destination-replacement');
  fs.writeFileSync(symlinkTarget, '{"unexpected":true}\n');
  fs.symlinkSync(symlinkTarget, symlinkReplacement);
  const symlinkSwap = swapWhenPresent(
    path.join(symlinkDestinationStage, 'package.json'),
    symlinkReplacement,
  );
  await assert.rejects(
    prepareRuntimeDependencyStaging({
      pinnedSourceRoot: symlinkDestinationSource,
      stagingRoot: symlinkDestinationStage,
      runCommandSync() {
        assert.fail('npm must not run after a staged input becomes a symlink');
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /destination|staging input|symbolic/i.test(error.message),
  );
  await symlinkSwap;

  fs.chmodSync(path.join(prepared.nodeModulesRoot, 'fixture'), 0o755);
  fs.chmodSync(path.join(prepared.nodeModulesRoot, 'fixture', 'index.js'), 0o644);
  const closure = await capture(prepared.nodeModulesRoot);
  assert.equal(closure.schema, 'teams-runtime-closure/v1');
  assert.equal(closure.algorithm, 'sha256');
  assert.deepEqual(closure.limits, limits);
  assert.deepEqual(closure.approvedNativeAddons, []);
  assert.deepEqual(closure.entries.map((entry) => entry.path), ['fixture', 'fixture/index.js']);
  assert.deepEqual(
    closure.entries.find((entry) => entry.path === 'fixture')?.metadata,
    canonicalMetadata(path.join(prepared.nodeModulesRoot, 'fixture'), 'directory'),
  );
  assert.deepEqual(
    closure.entries.find((entry) => entry.path === 'fixture/index.js')?.metadata,
    canonicalMetadata(path.join(prepared.nodeModulesRoot, 'fixture', 'index.js'), 'file'),
  );
  for (const entry of closure.entries) {
    expectCanonicalMetadata(entry.metadata, entry.type);
    assert.match(entry.contentSha256, /^[0-9a-f]{64}$/);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(closure.totals, {
    entries: 2,
    files: 1,
    directories: 1,
    symlinks: 0,
    bytes: 18,
  });
  assert.equal((await verify(prepared.nodeModulesRoot, closure)).sha256, closure.sha256);

  const prefixRoot = path.join(fixtureRoot, 'prefix-root');
  fs.mkdirSync(path.join(prefixRoot, 'a'), { recursive: true });
  fs.writeFileSync(path.join(prefixRoot, 'a', 'z.js'), 'child\n');
  fs.writeFileSync(path.join(prefixRoot, 'a-b'), 'sibling\n');
  const prefixClosure = await capture(prefixRoot);
  assert.deepEqual(
    prefixClosure.entries.map((entry) => entry.path),
    ['a', 'a-b', 'a/z.js'],
    'the entire manifest, not each directory listing, is UTF-8 sorted',
  );
  assert.equal((await verify(prefixRoot, prefixClosure)).sha256, prefixClosure.sha256);

  const chmodRoot = path.join(fixtureRoot, 'chmod-root');
  writeRuntimeFixture(chmodRoot);
  const chmodClosure = await capture(chmodRoot);
  const chmodTarget = path.join(chmodRoot, 'fixture', 'index.js');
  fs.chmodSync(chmodTarget, 0o600);
  await assert.rejects(
    verify(chmodRoot, chmodClosure),
    (error) => error?.code === 'RUNTIME_CLOSURE_MISMATCH'
      && error.changes.includes('fixture/index.js'),
  );

  const timestampRoot = path.join(fixtureRoot, 'timestamp-root');
  writeRuntimeFixture(timestampRoot);
  const timestampClosure = await capture(timestampRoot);
  const timestampTarget = path.join(timestampRoot, 'fixture', 'index.js');
  fs.utimesSync(timestampTarget, new Date('2001-01-01T00:00:00.000Z'), new Date('2001-01-01T00:00:00.000Z'));
  await assert.rejects(
    verify(timestampRoot, timestampClosure),
    (error) => error?.code === 'RUNTIME_CLOSURE_MISMATCH'
      && error.changes.includes('fixture/index.js'),
  );

  const internalLink = path.join(prepared.nodeModulesRoot, 'internal-link');
  fs.symlinkSync('fixture/index.js', internalLink);
  const closureWithInternalLink = await capture(prepared.nodeModulesRoot);
  const internalLinkEntry = closureWithInternalLink.entries.find((entry) => entry.path === 'internal-link');
  assert.deepEqual(
    {
      type: internalLinkEntry?.type,
      bytes: internalLinkEntry?.bytes,
      contentSha256: internalLinkEntry?.contentSha256,
    },
    {
      type: 'symlink',
      bytes: 16,
      contentSha256: '7f7d5274510e83ab156c4a8d1fffed3ebe8bbf633965be4aa4b1124fea4e9e94',
    },
  );
  fs.unlinkSync(internalLink);

  const outsideFile = path.join(fixtureRoot, 'outside.js');
  const externalLink = path.join(prepared.nodeModulesRoot, 'external-link');
  fs.writeFileSync(outsideFile, 'outside\n');
  fs.symlinkSync(outsideFile, externalLink);
  await assert.rejects(
    capture(prepared.nodeModulesRoot),
    (error) => error?.code === 'RUNTIME_CLOSURE_POLICY_VIOLATION'
      && /external symbolic link.*external-link/i.test(error.message),
  );
  fs.unlinkSync(externalLink);

  const nativeAddon = path.join(prepared.nodeModulesRoot, 'fixture', 'addon.node');
  fs.writeFileSync(nativeAddon, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  await assert.rejects(
    capture(prepared.nodeModulesRoot),
    (error) => error?.code === 'RUNTIME_CLOSURE_POLICY_VIOLATION'
      && /unapproved native addon.*fixture\/addon\.node/i.test(error.message),
  );
  const closureWithApprovedNativeAddon = await capture(prepared.nodeModulesRoot, {
    approvedNativeAddons: ['fixture/addon.node'],
  });
  assert.equal(
    closureWithApprovedNativeAddon.entries.find((entry) => entry.path === 'fixture/addon.node')?.type,
    'file',
  );
  const nativeAddonLink = path.join(prepared.nodeModulesRoot, 'fixture', 'addon-link.node');
  fs.symlinkSync('index.js', nativeAddonLink);
  await assert.rejects(
    capture(prepared.nodeModulesRoot, {
      approvedNativeAddons: ['fixture/addon-link.node'],
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_POLICY_VIOLATION'
      && /native addon.*regular file|symlink.*native addon/i.test(error.message),
  );
  fs.unlinkSync(nativeAddonLink);
  const nativeAddonAlias = path.join(prepared.nodeModulesRoot, 'fixture', 'addon-alias.js');
  fs.symlinkSync('addon.node', nativeAddonAlias);
  await assert.rejects(
    capture(prepared.nodeModulesRoot, {
      approvedNativeAddons: ['fixture/addon.node'],
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_POLICY_VIOLATION'
      && /native addon.*symbolic link|symbolic link.*native addon/i.test(error.message),
  );
  fs.unlinkSync(nativeAddonAlias);
  const nativeAddonRootAlias = path.join(prepared.nodeModulesRoot, 'native-addon-root-alias');
  fs.symlinkSync('.', nativeAddonRootAlias);
  await assert.rejects(
    capture(prepared.nodeModulesRoot, {
      approvedNativeAddons: ['fixture/addon.node'],
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_POLICY_VIOLATION'
      && /native addon.*symbolic link|symbolic link.*native addon/i.test(error.message),
  );
  fs.unlinkSync(nativeAddonRootAlias);
  const nativeAddonHardlink = path.join(prepared.nodeModulesRoot, 'fixture', 'addon-hardlink.js');
  fs.linkSync(nativeAddon, nativeAddonHardlink);
  await assert.rejects(
    capture(prepared.nodeModulesRoot, {
      approvedNativeAddons: ['fixture/addon.node'],
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_POLICY_VIOLATION'
      && /native addon.*hard link|hard link.*native addon/i.test(error.message),
  );
  fs.unlinkSync(nativeAddonHardlink);
  fs.unlinkSync(nativeAddon);

  const fifoPath = path.join(prepared.nodeModulesRoot, 'fixture.pipe');
  execFileSync('mkfifo', [fifoPath], { timeout: 1_000, stdio: 'ignore' });
  await assert.rejects(
    capture(prepared.nodeModulesRoot),
    (error) => error?.code === 'RUNTIME_CLOSURE_POLICY_VIOLATION'
      && error.entryType === 'fifo'
      && /special file.*fixture\.pipe.*fifo/i.test(error.message),
  );
  fs.unlinkSync(fifoPath);

  const additionsRoot = path.join(fixtureRoot, 'additions-root');
  writeRuntimeFixture(additionsRoot);
  const additionsClosure = await capture(additionsRoot);
  fs.writeFileSync(path.join(additionsRoot, 'added.js'), 'added\n');
  await assert.rejects(
    verify(additionsRoot, additionsClosure),
    (error) => error?.code === 'RUNTIME_CLOSURE_MISMATCH'
      && error.additions.includes('added.js'),
  );

  const deletionsRoot = path.join(fixtureRoot, 'deletions-root');
  writeRuntimeFixture(deletionsRoot);
  const deletionsClosure = await capture(deletionsRoot);
  fs.unlinkSync(path.join(deletionsRoot, 'fixture', 'index.js'));
  await assert.rejects(
    verify(deletionsRoot, deletionsClosure),
    (error) => error?.code === 'RUNTIME_CLOSURE_MISMATCH'
      && error.deletions.includes('fixture/index.js'),
  );

  const bytesRoot = path.join(fixtureRoot, 'bytes-root');
  writeRuntimeFixture(bytesRoot);
  const bytesClosure = await capture(bytesRoot);
  fs.writeFileSync(path.join(bytesRoot, 'fixture', 'index.js'), 'export default 2;\n');
  await assert.rejects(
    verify(bytesRoot, bytesClosure),
    (error) => error?.code === 'RUNTIME_CLOSURE_MISMATCH'
      && error.changes.includes('fixture/index.js'),
  );

  await assert.rejects(
    verify(prepared.nodeModulesRoot, { ...closure, sha256: '0'.repeat(64) }),
    (error) => error?.code === 'RUNTIME_CLOSURE_ATTESTATION_INVALID',
  );
  await assert.rejects(
    verify(prepared.nodeModulesRoot, closure, {
      limits: { maxFileBytes: limits.maxFileBytes + 1 },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_POLICY_MISMATCH',
  );
  await assert.rejects(
    capture(prepared.nodeModulesRoot, { limits: { maxFileBytes: 17 } }),
    (error) => error?.code === 'RUNTIME_CLOSURE_LIMIT_EXCEEDED'
      && /maxFileBytes.*fixture\/index\.js/i.test(error.message),
  );
  await assert.rejects(
    capture(prepared.nodeModulesRoot, { limits: { maxTotalBytes: 17 } }),
    (error) => error?.code === 'RUNTIME_CLOSURE_LIMIT_EXCEEDED'
      && /maxTotalBytes.*fixture\/index\.js/i.test(error.message),
  );

  const directoryRaceRoot = path.join(fixtureRoot, 'directory-race-root');
  fs.mkdirSync(path.join(directoryRaceRoot, 'race'), { recursive: true });
  fs.writeFileSync(path.join(directoryRaceRoot, 'race', 'stable.js'), 'stable\n');
  const transientPath = path.join(directoryRaceRoot, 'race', 'transient.js');
  await assert.rejects(
    capture(directoryRaceRoot, {
      testHooks: {
        afterDirectoryInitialEnumeration({ canonicalPath }) {
          if (canonicalPath === 'race') fs.writeFileSync(transientPath, 'transient\n');
        },
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /directory|entry|traversal|enumeration|snapshot/i.test(error.message),
  );

  const symlinkRaceRoot = path.join(fixtureRoot, 'symlink-race-root');
  writeRuntimeFixture(symlinkRaceRoot);
  fs.writeFileSync(path.join(symlinkRaceRoot, 'fixture', 'alternate.js'), 'export default 2;\n');
  const replacementLink = path.join(symlinkRaceRoot, 'replace-link');
  const alternateLink = path.join(symlinkRaceRoot, 'alternate-link');
  const swapPath = path.join(symlinkRaceRoot, 'link-swap');
  fs.symlinkSync('fixture/index.js', replacementLink);
  fs.symlinkSync('fixture/alternate.js', alternateLink);
  await assert.rejects(
    capture(symlinkRaceRoot, {
      testHooks: {
        afterSymlinkReadlink({ canonicalPath }) {
          if (canonicalPath !== 'replace-link') return;
          fs.renameSync(replacementLink, swapPath);
          fs.renameSync(alternateLink, replacementLink);
          fs.renameSync(swapPath, alternateLink);
        },
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /symbolic link|symlink/i.test(error.message),
  );

  const symlinkTargetRaceRoot = path.join(fixtureRoot, 'symlink-target-race-root');
  writeRuntimeFixture(symlinkTargetRaceRoot);
  const symlinkTargetRaceTarget = path.join(symlinkTargetRaceRoot, 'fixture', 'index.js');
  fs.symlinkSync('fixture/index.js', path.join(symlinkTargetRaceRoot, 'target-race-link'));
  await assert.rejects(
    capture(symlinkTargetRaceRoot, {
      testHooks: {
        afterSymlinkTargetObserved({ canonicalPath }) {
          if (canonicalPath === 'target-race-link') {
            fs.writeFileSync(symlinkTargetRaceTarget, 'export default changed;\n');
          }
        },
      },
    }),
    (error) => error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      && /symbolic link target|symbolic link.*target|symlink.*target/i.test(error.message),
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('PASS: runtime closure staging and attestation contract');
