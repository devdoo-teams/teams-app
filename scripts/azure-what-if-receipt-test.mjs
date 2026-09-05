import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAzureWhatIfDiagnostic,
  createAzureWhatIfReceipt,
  readAzureWhatIfDiagnostic,
  readAzureWhatIfReceipt,
  verifyAzureWhatIfReceipt,
} from './azure-what-if-receipt.mjs';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-azure-what-if-receipt-'));

try {
  const subscriptionId = '0e58c3cb-474d-4e70-978a-4939c586f867';
  const resourceGroup = 'rg-teamsapp-canary';
  const sourceCommit = 'a'.repeat(40);
  const releaseVersion = '1.0.102';
  const templatePath = path.join(temporaryDirectory, 'main.bicep');
  const parametersPath = path.join(temporaryDirectory, 'foundation.parameters.json');
  const whatIfPath = path.join(temporaryDirectory, 'foundation.what-if.json');
  const receiptPath = path.join(temporaryDirectory, 'foundation.receipt.json');
  const blockedWhatIfPath = path.join(temporaryDirectory, 'foundation.blocked.what-if.json');
  const diagnosticPath = path.join(temporaryDirectory, 'foundation.diagnostic.json');
  const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;

  fs.writeFileSync(templatePath, "targetScope = 'resourceGroup'\n", { mode: 0o600 });
  fs.writeFileSync(parametersPath, `${JSON.stringify({
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
    contentVersion: '1.0.0.0',
    parameters: { workloadName: { value: 'teamsapp' } },
  })}\n`, { mode: 0o600 });
  const whatIfPayload = {
    status: 'Succeeded',
    changes: [
      { resourceId: `${scope}/providers/Microsoft.Storage/storageAccounts/teamsapp123`, changeType: 'Create' },
      { resourceId: `${scope}/providers/microsoft.insights/actiongroups/Application Insights Smart Detection`, changeType: 'Ignore' },
      { resourceId: `${scope}/providers/Microsoft.Authorization/roleAssignments/${'b'.repeat(32)}`, changeType: 'Unsupported' },
    ],
  };
  fs.writeFileSync(whatIfPath, `${JSON.stringify(whatIfPayload)}\n`, { mode: 0o600 });

  const identity = {
    phase: 'foundation',
    sourceCommit,
    releaseVersion,
    subscriptionId,
    resourceGroup,
    templatePath,
    parametersPath,
  };
  const receipt = createAzureWhatIfReceipt({
    ...identity,
    whatIf: whatIfPayload,
    checkedAt: '2026-09-05T12:00:00.000Z',
  });
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.kind, 'azure-deployment-what-if');
  assert.equal(receipt.nonMutating, true);
  assert.equal(receipt.status, 'REVIEW_REQUIRED');
  assert.equal(receipt.phase, 'foundation');
  assert.equal(receipt.sourceCommit, sourceCommit);
  assert.equal(receipt.releaseVersion, releaseVersion);
  assert.deepEqual(receipt.target, { subscriptionId, resourceGroup });
  assert.match(receipt.templateSha256, /^[0-9a-f]{64}$/);
  assert.match(receipt.parametersSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(receipt.contract, {
    validationLevel: 'Provider',
    resultFormat: 'FullResourcePayloads',
    noPrettyPrint: true,
    noPrompt: true,
  });
  assert.equal(receipt.whatIf.manualReviewRequired, true);
  assert.equal(receipt.whatIf.changeCounts.Ignore, 1);
  assert.deepEqual(receipt.whatIf.approvedProviderNoise, [{
    resourceId: `${scope}/providers/microsoft.insights/actiongroups/Application Insights Smart Detection`,
    changeType: 'Ignore',
    rule: 'incremental-smart-detection-ignore',
    propertyChanges: [],
  }]);
  assert.deepEqual(verifyAzureWhatIfReceipt(receipt, identity), receipt);

  const observedDiagnostic = createAzureWhatIfDiagnostic({
    ...identity,
    whatIf: whatIfPayload,
    checkedAt: '2026-09-05T12:00:30.000Z',
  });
  assert.equal(observedDiagnostic.schemaVersion, 1);
  assert.equal(observedDiagnostic.status, 'OBSERVED');
  assert.deepEqual(observedDiagnostic.whatIf.changeCounts, {
    Create: 1,
    Ignore: 1,
    Unsupported: 1,
  });

  const createResult = spawnSync(process.execPath, [
    path.join(import.meta.dirname, 'azure-what-if-receipt.mjs'),
    'create',
    '--what-if', whatIfPath,
    '--phase', 'foundation',
    '--commit', sourceCommit,
    '--version', releaseVersion,
    '--subscription', subscriptionId,
    '--resource-group', resourceGroup,
    '--template', templatePath,
    '--parameters', parametersPath,
    '--output', receiptPath,
  ], { encoding: 'utf8' });
  assert.equal(createResult.status, 0, createResult.stderr);
  const persisted = readAzureWhatIfReceipt(receiptPath);
  assert.equal(persisted.status, 'REVIEW_REQUIRED');
  assert.deepEqual(verifyAzureWhatIfReceipt(persisted, identity), persisted);

  const verifyResult = spawnSync(process.execPath, [
    path.join(import.meta.dirname, 'azure-what-if-receipt.mjs'),
    'verify',
    '--receipt', receiptPath,
    '--phase', 'foundation',
    '--commit', sourceCommit,
    '--version', releaseVersion,
    '--subscription', subscriptionId,
    '--resource-group', resourceGroup,
    '--template', templatePath,
    '--parameters', parametersPath,
  ], { encoding: 'utf8' });
  assert.equal(verifyResult.status, 0, verifyResult.stderr);

  const blockedWhatIfPayload = {
    status: 'Succeeded',
    changes: [{
      resourceId: `${scope}/providers/Microsoft.App/managedEnvironments/teamsapp-env-goictvxm`,
      changeType: 'Modify',
      before: { properties: { appLogsConfiguration: { logAnalyticsConfiguration: { sharedKey: 'before-secret' } } } },
      after: { properties: { appLogsConfiguration: { logAnalyticsConfiguration: { sharedKey: 'after-secret' } } } },
      delta: [{
        path: 'properties.appLogsConfiguration.logAnalyticsConfiguration.sharedKey',
        propertyChangeType: 'Modify',
        before: 'before-secret',
        after: 'after-secret',
      }, {
        path: 'properties.workloadProfiles',
        propertyChangeType: 'Array',
        children: [{
          path: 'properties.workloadProfiles[0].name',
          propertyChangeType: 'NoEffect',
          before: 'Consumption',
          after: 'Consumption',
        }],
      }],
    }],
  };
  const diagnostic = createAzureWhatIfDiagnostic({
    ...identity,
    whatIf: blockedWhatIfPayload,
    checkedAt: '2026-09-05T12:01:00.000Z',
  });
  assert.equal(diagnostic.kind, 'azure-deployment-what-if-diagnostic');
  assert.equal(diagnostic.status, 'BLOCKED');
  assert.deepEqual(diagnostic.whatIf.changeCounts, { Modify: 1 });
  assert.deepEqual(diagnostic.whatIf.changes, [{
    resourceId: `${scope}/providers/Microsoft.App/managedEnvironments/teamsapp-env-goictvxm`,
    changeType: 'Modify',
    propertyChangeDetailsAvailable: true,
    propertyChanges: [{
      path: 'properties.appLogsConfiguration.logAnalyticsConfiguration.sharedKey',
      propertyChangeType: 'Modify',
    }, {
      path: 'properties.workloadProfiles',
      propertyChangeType: 'Array',
    }, {
      path: 'properties.workloadProfiles[0].name',
      propertyChangeType: 'NoEffect',
    }],
  }]);
  assert.equal(JSON.stringify(diagnostic).includes('before-secret'), false);
  assert.equal(JSON.stringify(diagnostic).includes('after-secret'), false);
  fs.writeFileSync(blockedWhatIfPath, `${JSON.stringify(blockedWhatIfPayload)}\n`, { mode: 0o600 });
  const diagnoseResult = spawnSync(process.execPath, [
    path.join(import.meta.dirname, 'azure-what-if-receipt.mjs'),
    'diagnose',
    '--what-if', blockedWhatIfPath,
    '--phase', 'foundation',
    '--commit', sourceCommit,
    '--version', releaseVersion,
    '--subscription', subscriptionId,
    '--resource-group', resourceGroup,
    '--template', templatePath,
    '--parameters', parametersPath,
    '--output', diagnosticPath,
  ], { encoding: 'utf8' });
  assert.equal(diagnoseResult.status, 0, diagnoseResult.stderr);
  const persistedDiagnostic = readAzureWhatIfDiagnostic(diagnosticPath);
  assert.equal(persistedDiagnostic.kind, diagnostic.kind);
  assert.equal(persistedDiagnostic.status, diagnostic.status);
  assert.equal(persistedDiagnostic.sourceCommit, diagnostic.sourceCommit);
  assert.equal(persistedDiagnostic.releaseVersion, diagnostic.releaseVersion);
  assert.deepEqual(persistedDiagnostic.target, diagnostic.target);
  assert.deepEqual(persistedDiagnostic.contract, diagnostic.contract);
  assert.deepEqual(persistedDiagnostic.whatIf, diagnostic.whatIf);
  assert.equal(JSON.stringify(persistedDiagnostic).includes('before-secret'), false);
  assert.equal(JSON.stringify(persistedDiagnostic).includes('after-secret'), false);
  assert.throws(
    () => createAzureWhatIfReceipt({ ...identity, whatIf: blockedWhatIfPayload }),
    /Modify/i,
    'diagnostic evidence must not weaken the fail-closed deployment receipt gate',
  );

  fs.appendFileSync(parametersPath, ' ');
  assert.throws(() => verifyAzureWhatIfReceipt(persisted, identity), /parameters.*SHA-256/i);
  fs.truncateSync(parametersPath, fs.statSync(parametersPath).size - 1);

  assert.throws(
    () => verifyAzureWhatIfReceipt({ ...persisted, unexpected: true }, identity),
    /unexpected field/i,
  );
  assert.throws(
    () => verifyAzureWhatIfReceipt({
      ...persisted,
      contract: { ...persisted.contract, resultFormat: 'ResourceIdOnly' },
    }, identity),
    /CLI contract/i,
  );
  assert.throws(
    () => verifyAzureWhatIfReceipt({
      ...persisted,
      whatIf: {
        ...persisted.whatIf,
        changeCounts: { ...persisted.whatIf.changeCounts, Unsupported: 2 },
      },
    }, identity),
    /Unsupported.*count/i,
  );
  assert.throws(
    () => verifyAzureWhatIfReceipt({
      ...persisted,
      whatIf: {
        ...persisted.whatIf,
        changeCounts: { ...persisted.whatIf.changeCounts, Modify: 1 },
      },
    }, identity),
    /provider noise|Modify/i,
    'a receipt cannot claim an unaccounted Modify row',
  );
  assert.throws(
    () => verifyAzureWhatIfReceipt({
      ...persisted,
      whatIf: {
        ...persisted.whatIf,
        approvedProviderNoise: [{
          resourceId: `${scope}/providers/Microsoft.Storage/storageAccounts/teamsapp123`,
          changeType: 'Ignore',
          rule: 'incremental-smart-detection-ignore',
          propertyChanges: [],
        }],
      },
    }, identity),
    /provider noise|Ignore/i,
    'a receipt cannot substitute another resource for an approved provider-noise row',
  );

  const symlinkPath = path.join(temporaryDirectory, 'parameters-link.json');
  fs.symlinkSync(parametersPath, symlinkPath);
  assert.throws(
    () => createAzureWhatIfReceipt({ ...identity, parametersPath: symlinkPath, whatIf: whatIfPayload }),
    /symbolic link/i,
  );

  const overwriteResult = spawnSync(process.execPath, [
    path.join(import.meta.dirname, 'azure-what-if-receipt.mjs'),
    'create',
    '--what-if', whatIfPath,
    '--phase', 'foundation',
    '--commit', sourceCommit,
    '--version', releaseVersion,
    '--subscription', subscriptionId,
    '--resource-group', resourceGroup,
    '--template', templatePath,
    '--parameters', parametersPath,
    '--output', receiptPath,
  ], { encoding: 'utf8' });
  assert.notEqual(overwriteResult.status, 0, 'receipt creation must not overwrite an existing current-run receipt');

  console.log('azure-what-if-receipt-test: PASS');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
