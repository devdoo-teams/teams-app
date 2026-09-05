import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnoseAzureWhatIf, summarizeAzureWhatIf } from './azure-canary-preflight.mjs';

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/u;
const SUBSCRIPTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RESOURCE_GROUP = /^[A-Za-z0-9._()\-]{1,90}$/u;
const PHASES = new Set(['foundation', 'workload']);
const CHANGE_TYPES = new Set(['Create', 'Ignore', 'NoChange', 'Unsupported']);
const DIAGNOSTIC_CHANGE_TYPES = new Set(['Create', 'Delete', 'Ignore', 'Deploy', 'NoChange', 'Modify', 'Unsupported']);
const PROPERTY_CHANGE_TYPES = new Set(['Create', 'Delete', 'Modify', 'Array', 'NoEffect']);
const PARAMETER_SCHEMA = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#';
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const MAX_DIAGNOSTIC_PROPERTY_CHANGES = 4096;

function fail(message) {
  throw new Error(`Invalid Azure what-if receipt: ${message}`);
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a JSON object`);
  const expectedSet = new Set(expected);
  const unexpected = Object.keys(value).filter((key) => !expectedSet.has(key));
  if (unexpected.length > 0) fail(`${label} has unexpected field(s): ${unexpected.join(', ')}`);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) fail(`${label} is missing field(s): ${missing.join(', ')}`);
}

function regularFile(filePath, label, maximumBytes = MAX_INPUT_BYTES) {
  const absolutePath = path.resolve(filePath);
  const stat = fs.lstatSync(absolutePath, { throwIfNoEntry: false });
  if (!stat) fail(`${label} is missing`);
  if (stat.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
  if (!stat.isFile()) fail(`${label} must be a regular file`);
  if (stat.size === 0 || stat.size > maximumBytes) {
    fail(`${label} must be non-empty and no larger than ${maximumBytes} bytes`);
  }
  return { absolutePath, stat };
}

function readJsonObject(filePath, label, maximumBytes = MAX_INPUT_BYTES) {
  const { absolutePath } = regularFile(filePath, label, maximumBytes);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a JSON object`);
  return value;
}

function sha256File(filePath, label) {
  const { absolutePath } = regularFile(filePath, label);
  return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

function validateParameterFile(parametersPath) {
  const value = readJsonObject(parametersPath, 'deployment parameters');
  assertExactKeys(value, ['$schema', 'contentVersion', 'parameters'], 'deployment parameters');
  if (value.$schema !== PARAMETER_SCHEMA) fail('deployment parameters use an unexpected schema');
  if (value.contentVersion !== '1.0.0.0') fail('deployment parameters contentVersion must be 1.0.0.0');
  if (!value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters)) {
    fail('deployment parameters.parameters must be a JSON object');
  }
  if (Object.keys(value.parameters).length === 0) fail('deployment parameters.parameters must not be empty');
  for (const [name, parameter] of Object.entries(value.parameters)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(name)) fail(`deployment parameter name is invalid: ${name}`);
    assertExactKeys(parameter, ['value'], `deployment parameter ${name}`);
    const parameterType = typeof parameter.value;
    if (!['string', 'boolean', 'number'].includes(parameterType)
      || (parameterType === 'number' && !Number.isFinite(parameter.value))) {
      fail(`deployment parameter ${name} has an unsupported value`);
    }
  }
  return value;
}

function validateIdentity({
  phase,
  sourceCommit,
  releaseVersion,
  subscriptionId,
  resourceGroup,
  templatePath,
  parametersPath,
}) {
  if (!PHASES.has(phase)) fail('phase must be foundation or workload');
  if (!COMMIT.test(String(sourceCommit ?? ''))) fail('source commit must be a full lowercase Git OID');
  if (!VERSION.test(String(releaseVersion ?? ''))) fail('release version is invalid');
  if (!SUBSCRIPTION_ID.test(String(subscriptionId ?? ''))) fail('subscription ID is invalid');
  if (!RESOURCE_GROUP.test(String(resourceGroup ?? ''))) fail('resource group is invalid');
  regularFile(templatePath, 'Bicep template');
  validateParameterFile(parametersPath);
}

function validateCheckedAt(value) {
  if (typeof value !== 'string') fail('checkedAt must be an ISO timestamp');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) fail('checkedAt must be an ISO timestamp');
}

function validateDiagnosticPropertyPath(value) {
  if (typeof value !== 'string' || value.length === 0) fail('diagnostic property path is invalid');
  if (Buffer.byteLength(value, 'utf8') > 2048) fail('diagnostic property path exceeds the 2 KiB limit');
  const containsForbiddenControl = [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
  if (containsForbiddenControl) fail('diagnostic property path contains a forbidden control character');
}

function validateWhatIfSummary(summary) {
  assertExactKeys(summary, [
    'status',
    'changeCounts',
    'unsupportedResources',
    'unsupportedChanges',
    'missingUnsupportedReasonCount',
    'manualReviewRequired',
    'destructiveChangeCount',
  ], 'whatIf summary');
  if (summary.status !== 'Succeeded') fail('whatIf summary status must be Succeeded');
  if (!summary.changeCounts || typeof summary.changeCounts !== 'object' || Array.isArray(summary.changeCounts)) {
    fail('whatIf summary changeCounts must be an object');
  }
  const counts = Object.entries(summary.changeCounts);
  if (counts.length === 0) fail('whatIf summary changeCounts must not be empty');
  for (const [changeType, count] of counts) {
    if (!CHANGE_TYPES.has(changeType)) fail(`whatIf summary contains disallowed ${changeType} changes`);
    if (!Number.isSafeInteger(count) || count < 1) fail(`whatIf summary count for ${changeType} is invalid`);
  }
  if (!Array.isArray(summary.unsupportedResources) || summary.unsupportedResources.some((value) => typeof value !== 'string' || !value)) {
    fail('whatIf summary unsupportedResources is invalid');
  }
  if (!Array.isArray(summary.unsupportedChanges) || summary.unsupportedChanges.length !== summary.unsupportedResources.length) {
    fail('whatIf summary unsupportedChanges is invalid');
  }
  for (let index = 0; index < summary.unsupportedChanges.length; index += 1) {
    const change = summary.unsupportedChanges[index];
    assertExactKeys(change, ['resourceId', 'unsupportedReason'], 'unsupported change');
    if (change.resourceId !== summary.unsupportedResources[index]) fail('unsupported change resource IDs are inconsistent');
    if (change.unsupportedReason !== null && typeof change.unsupportedReason !== 'string') {
      fail('unsupported change reason must be a string or null');
    }
  }
  if ((summary.changeCounts.Unsupported ?? 0) !== summary.unsupportedChanges.length) {
    fail('Unsupported change count is inconsistent');
  }
  const missingReasons = summary.unsupportedChanges.filter(({ unsupportedReason }) => unsupportedReason === null).length;
  if (summary.missingUnsupportedReasonCount !== missingReasons) fail('missing unsupported-reason count is inconsistent');
  if (summary.manualReviewRequired !== (summary.unsupportedResources.length > 0)) {
    fail('manual-review status is inconsistent');
  }
  if (summary.destructiveChangeCount !== 0) fail('destructive change count must be zero');
}

function validateReceiptShape(receipt) {
  assertExactKeys(receipt, [
    'schemaVersion',
    'kind',
    'nonMutating',
    'status',
    'phase',
    'sourceCommit',
    'releaseVersion',
    'target',
    'templateSha256',
    'parametersSha256',
    'contract',
    'whatIf',
    'checkedAt',
  ], 'receipt');
  if (receipt.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (receipt.kind !== 'azure-deployment-what-if') fail('kind is invalid');
  if (receipt.nonMutating !== true) fail('nonMutating must be true');
  if (!PHASES.has(receipt.phase)) fail('phase is invalid');
  if (!COMMIT.test(String(receipt.sourceCommit ?? ''))) fail('sourceCommit is invalid');
  if (!VERSION.test(String(receipt.releaseVersion ?? ''))) fail('releaseVersion is invalid');
  assertExactKeys(receipt.target, ['subscriptionId', 'resourceGroup'], 'target');
  if (!SUBSCRIPTION_ID.test(String(receipt.target.subscriptionId ?? ''))) fail('target subscription ID is invalid');
  if (!RESOURCE_GROUP.test(String(receipt.target.resourceGroup ?? ''))) fail('target resource group is invalid');
  if (!SHA256.test(String(receipt.templateSha256 ?? ''))) fail('template SHA-256 is invalid');
  if (!SHA256.test(String(receipt.parametersSha256 ?? ''))) fail('parameters SHA-256 is invalid');
  assertExactKeys(receipt.contract, ['validationLevel', 'resultFormat', 'noPrettyPrint', 'noPrompt'], 'contract');
  if (receipt.contract.validationLevel !== 'Provider'
    || receipt.contract.resultFormat !== 'FullResourcePayloads'
    || receipt.contract.noPrettyPrint !== true
    || receipt.contract.noPrompt !== true) {
    fail('what-if CLI contract is invalid');
  }
  validateWhatIfSummary(receipt.whatIf);
  const expectedStatus = receipt.whatIf.manualReviewRequired ? 'REVIEW_REQUIRED' : 'READY';
  if (receipt.status !== expectedStatus) fail('receipt status is inconsistent with the what-if result');
  validateCheckedAt(receipt.checkedAt);
  return receipt;
}

function validateDiagnosticShape(diagnostic) {
  assertExactKeys(diagnostic, [
    'schemaVersion',
    'kind',
    'nonMutating',
    'status',
    'phase',
    'sourceCommit',
    'releaseVersion',
    'target',
    'templateSha256',
    'parametersSha256',
    'contract',
    'whatIf',
    'checkedAt',
  ], 'diagnostic');
  if (diagnostic.schemaVersion !== 1) fail('diagnostic schemaVersion must be 1');
  if (diagnostic.kind !== 'azure-deployment-what-if-diagnostic') fail('diagnostic kind is invalid');
  if (diagnostic.nonMutating !== true) fail('diagnostic nonMutating must be true');
  if (!['OBSERVED', 'BLOCKED'].includes(diagnostic.status)) fail('diagnostic status is invalid');
  if (!PHASES.has(diagnostic.phase)) fail('diagnostic phase is invalid');
  if (!COMMIT.test(String(diagnostic.sourceCommit ?? ''))) fail('diagnostic sourceCommit is invalid');
  if (!VERSION.test(String(diagnostic.releaseVersion ?? ''))) fail('diagnostic releaseVersion is invalid');
  assertExactKeys(diagnostic.target, ['subscriptionId', 'resourceGroup'], 'diagnostic target');
  if (!SUBSCRIPTION_ID.test(String(diagnostic.target.subscriptionId ?? ''))) fail('diagnostic target subscription ID is invalid');
  if (!RESOURCE_GROUP.test(String(diagnostic.target.resourceGroup ?? ''))) fail('diagnostic target resource group is invalid');
  if (!SHA256.test(String(diagnostic.templateSha256 ?? ''))) fail('diagnostic template SHA-256 is invalid');
  if (!SHA256.test(String(diagnostic.parametersSha256 ?? ''))) fail('diagnostic parameters SHA-256 is invalid');
  assertExactKeys(diagnostic.contract, ['validationLevel', 'resultFormat', 'noPrettyPrint', 'noPrompt'], 'diagnostic contract');
  if (diagnostic.contract.validationLevel !== 'Provider'
    || diagnostic.contract.resultFormat !== 'FullResourcePayloads'
    || diagnostic.contract.noPrettyPrint !== true
    || diagnostic.contract.noPrompt !== true) {
    fail('diagnostic what-if CLI contract is invalid');
  }
  assertExactKeys(diagnostic.whatIf, ['status', 'changeCounts', 'changes'], 'diagnostic whatIf');
  if (diagnostic.whatIf.status !== 'Succeeded') fail('diagnostic whatIf status must be Succeeded');
  if (!diagnostic.whatIf.changeCounts || typeof diagnostic.whatIf.changeCounts !== 'object'
    || Array.isArray(diagnostic.whatIf.changeCounts)) {
    fail('diagnostic changeCounts must be an object');
  }
  if (!Array.isArray(diagnostic.whatIf.changes) || diagnostic.whatIf.changes.length === 0) {
    fail('diagnostic changes must be a non-empty array');
  }
  const declaredCounts = Object.entries(diagnostic.whatIf.changeCounts);
  if (declaredCounts.length === 0) fail('diagnostic changeCounts must not be empty');
  for (const [changeType, count] of declaredCounts) {
    if (!DIAGNOSTIC_CHANGE_TYPES.has(changeType)) fail('diagnostic changeCounts contain an unknown change type');
    if (!Number.isSafeInteger(count) || count < 1) fail(`diagnostic change count for ${changeType} is invalid`);
  }

  const observedCounts = {};
  let propertyChangeCount = 0;
  for (const change of diagnostic.whatIf.changes) {
    assertExactKeys(change, [
      'resourceId',
      'changeType',
      'propertyChangeDetailsAvailable',
      'propertyChanges',
    ], 'diagnostic change');
    if (typeof change.resourceId !== 'string' || change.resourceId.length === 0) fail('diagnostic resourceId is invalid');
    if (!DIAGNOSTIC_CHANGE_TYPES.has(change.changeType)) fail('diagnostic resource change type is invalid');
    if (typeof change.propertyChangeDetailsAvailable !== 'boolean') fail('diagnostic property detail availability is invalid');
    if (!Array.isArray(change.propertyChanges)) fail('diagnostic propertyChanges must be an array');
    for (const propertyChange of change.propertyChanges) {
      assertExactKeys(propertyChange, ['path', 'propertyChangeType'], 'diagnostic property change');
      validateDiagnosticPropertyPath(propertyChange.path);
      if (!PROPERTY_CHANGE_TYPES.has(propertyChange.propertyChangeType)) fail('diagnostic property change type is invalid');
      propertyChangeCount += 1;
      if (propertyChangeCount > MAX_DIAGNOSTIC_PROPERTY_CHANGES) {
        fail(`diagnostic property changes exceed the ${MAX_DIAGNOSTIC_PROPERTY_CHANGES} entry limit`);
      }
    }
    observedCounts[change.changeType] = (observedCounts[change.changeType] ?? 0) + 1;
  }
  const normalizedObservedCounts = Object.entries(observedCounts).sort(([left], [right]) => left.localeCompare(right));
  const normalizedDeclaredCounts = declaredCounts.sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(normalizedObservedCounts) !== JSON.stringify(normalizedDeclaredCounts)) {
    fail('diagnostic changeCounts are inconsistent');
  }
  const blocked = diagnostic.whatIf.changes.some(({ changeType }) => !CHANGE_TYPES.has(changeType));
  if (diagnostic.status !== (blocked ? 'BLOCKED' : 'OBSERVED')) fail('diagnostic status is inconsistent');
  validateCheckedAt(diagnostic.checkedAt);
  return diagnostic;
}

export function createAzureWhatIfDiagnostic({
  whatIf,
  phase,
  sourceCommit,
  releaseVersion,
  subscriptionId,
  resourceGroup,
  templatePath,
  parametersPath,
  checkedAt = new Date().toISOString(),
}) {
  const identity = {
    phase,
    sourceCommit,
    releaseVersion,
    subscriptionId,
    resourceGroup,
    templatePath,
    parametersPath,
  };
  validateIdentity(identity);
  validateCheckedAt(checkedAt);
  const whatIfDiagnostic = diagnoseAzureWhatIf(whatIf, { subscriptionId, resourceGroup });
  const blocked = whatIfDiagnostic.changes.some(({ changeType }) => !CHANGE_TYPES.has(changeType));
  return validateDiagnosticShape({
    schemaVersion: 1,
    kind: 'azure-deployment-what-if-diagnostic',
    nonMutating: true,
    status: blocked ? 'BLOCKED' : 'OBSERVED',
    phase,
    sourceCommit,
    releaseVersion,
    target: { subscriptionId, resourceGroup },
    templateSha256: sha256File(templatePath, 'Bicep template'),
    parametersSha256: sha256File(parametersPath, 'deployment parameters'),
    contract: {
      validationLevel: 'Provider',
      resultFormat: 'FullResourcePayloads',
      noPrettyPrint: true,
      noPrompt: true,
    },
    whatIf: whatIfDiagnostic,
    checkedAt,
  });
}

export function createAzureWhatIfReceipt({
  whatIf,
  phase,
  sourceCommit,
  releaseVersion,
  subscriptionId,
  resourceGroup,
  templatePath,
  parametersPath,
  checkedAt = new Date().toISOString(),
}) {
  const identity = {
    phase,
    sourceCommit,
    releaseVersion,
    subscriptionId,
    resourceGroup,
    templatePath,
    parametersPath,
  };
  validateIdentity(identity);
  validateCheckedAt(checkedAt);
  const summary = summarizeAzureWhatIf(whatIf, { subscriptionId, resourceGroup });
  return validateReceiptShape({
    schemaVersion: 1,
    kind: 'azure-deployment-what-if',
    nonMutating: true,
    status: summary.manualReviewRequired ? 'REVIEW_REQUIRED' : 'READY',
    phase,
    sourceCommit,
    releaseVersion,
    target: { subscriptionId, resourceGroup },
    templateSha256: sha256File(templatePath, 'Bicep template'),
    parametersSha256: sha256File(parametersPath, 'deployment parameters'),
    contract: {
      validationLevel: 'Provider',
      resultFormat: 'FullResourcePayloads',
      noPrettyPrint: true,
      noPrompt: true,
    },
    whatIf: summary,
    checkedAt,
  });
}

export function verifyAzureWhatIfReceipt(receipt, identity) {
  validateIdentity(identity);
  validateReceiptShape(receipt);
  if (receipt.phase !== identity.phase) fail('phase does not match the expected deployment');
  if (receipt.sourceCommit !== identity.sourceCommit) fail('source commit does not match the expected release');
  if (receipt.releaseVersion !== identity.releaseVersion) fail('release version does not match the expected release');
  if (receipt.target.subscriptionId.toLowerCase() !== identity.subscriptionId.toLowerCase()) {
    fail('subscription does not match the expected target');
  }
  if (receipt.target.resourceGroup.toLowerCase() !== identity.resourceGroup.toLowerCase()) {
    fail('resource group does not match the expected target');
  }
  if (receipt.templateSha256 !== sha256File(identity.templatePath, 'Bicep template')) {
    fail('Bicep template SHA-256 does not match the receipt');
  }
  if (receipt.parametersSha256 !== sha256File(identity.parametersPath, 'deployment parameters')) {
    fail('deployment parameters SHA-256 does not match the receipt');
  }
  return receipt;
}

export function readAzureWhatIfReceipt(receiptPath) {
  return validateReceiptShape(readJsonObject(receiptPath, 'receipt', MAX_RECEIPT_BYTES));
}

export function readAzureWhatIfDiagnostic(diagnosticPath) {
  return validateDiagnosticShape(readJsonObject(diagnosticPath, 'diagnostic', MAX_RECEIPT_BYTES));
}

function parsePairs(args, allowed, required) {
  if (args.length % 2 !== 0) fail('arguments must be --name value pairs');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name)) fail(`unknown argument: ${name ?? '<missing>'}`);
    if (values.has(name)) fail(`duplicate argument: ${name}`);
    if (!value?.trim()) fail(`${name} must not be empty`);
    values.set(name, value);
  }
  for (const name of required) {
    if (!values.has(name)) fail(`${name} is required`);
  }
  return values;
}

function identityFromArguments(values) {
  return {
    phase: values.get('--phase'),
    sourceCommit: values.get('--commit'),
    releaseVersion: values.get('--version'),
    subscriptionId: values.get('--subscription'),
    resourceGroup: values.get('--resource-group'),
    templatePath: path.resolve(values.get('--template')),
    parametersPath: path.resolve(values.get('--parameters')),
  };
}

function writeReceiptExclusive(outputPath, receipt) {
  const absoluteOutput = path.resolve(outputPath);
  const parent = path.dirname(absoluteOutput);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) fail('receipt output parent must be a real directory');
  if (fs.lstatSync(absoluteOutput, { throwIfNoEntry: false })) fail('receipt output already exists');
  const temporary = `${absoluteOutput}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  let handle;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(receipt, null, 2)}\n`);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.linkSync(temporary, absoluteOutput);
    fs.unlinkSync(temporary);
    const directoryHandle = fs.openSync(parent, 'r');
    try {
      fs.fsyncSync(directoryHandle);
    } finally {
      fs.closeSync(directoryHandle);
    }
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    if (fs.lstatSync(temporary, { throwIfNoEntry: false })) fs.unlinkSync(temporary);
  }
}

function runCli() {
  const [command, ...args] = process.argv.slice(2);
  const identityFlags = new Set([
    '--phase',
    '--commit',
    '--version',
    '--subscription',
    '--resource-group',
    '--template',
    '--parameters',
  ]);
  if (command === 'create' || command === 'diagnose') {
    const allowed = new Set([...identityFlags, '--what-if', '--output']);
    const values = parsePairs(args, allowed, allowed);
    const identity = identityFromArguments(values);
    const create = command === 'diagnose' ? createAzureWhatIfDiagnostic : createAzureWhatIfReceipt;
    const receipt = create({
      ...identity,
      whatIf: readJsonObject(values.get('--what-if'), 'what-if result'),
    });
    writeReceiptExclusive(values.get('--output'), receipt);
    process.stdout.write(`Azure ${receipt.phase} what-if ${command === 'diagnose' ? 'diagnostic' : 'receipt'}: ${receipt.status}\n`);
    return;
  }
  if (command === 'verify') {
    const allowed = new Set([...identityFlags, '--receipt']);
    const values = parsePairs(args, allowed, allowed);
    const receipt = verifyAzureWhatIfReceipt(
      readAzureWhatIfReceipt(values.get('--receipt')),
      identityFromArguments(values),
    );
    process.stdout.write(`Azure ${receipt.phase} what-if receipt verified: ${receipt.status}\n`);
    return;
  }
  fail('usage: azure-what-if-receipt.mjs <diagnose|create|verify> --name value ...');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
