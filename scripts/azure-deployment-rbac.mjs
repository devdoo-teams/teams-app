import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_AZURE_DEPLOYMENT_ACTIONS = Object.freeze([
  'Microsoft.Authorization/roleAssignments/write',
  'Microsoft.Authorization/roleDefinitions/write',
]);

function fail(message, receipt) {
  const error = new Error(`Invalid Azure deployment RBAC preflight: ${message}`);
  if (receipt) error.receipt = receipt;
  throw error;
}

function normalizeAction(value) {
  return String(value ?? '').trim().toLowerCase();
}

function validateActionList(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    fail(`${label} must be an array of non-empty action strings`);
  }
  return value.map(normalizeAction);
}

function actionPatternMatches(pattern, action) {
  const escaped = normalizeAction(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'u').test(normalizeAction(action));
}

function permissionSetGrants(permissionSet, action) {
  const actions = validateActionList(permissionSet?.actions, 'permission actions');
  const notActions = validateActionList(permissionSet?.notActions ?? [], 'permission notActions');
  return actions.some((pattern) => actionPatternMatches(pattern, action))
    && !notActions.some((pattern) => actionPatternMatches(pattern, action));
}

export function inspectAzureDeploymentPermissions(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('caller-permissions response must be an object');
  }
  if (typeof payload.nextLink === 'string' && payload.nextLink.trim().length > 0) {
    fail('caller-permissions response is paginated; follow nextLink before validation');
  }
  if (!Array.isArray(payload.value) || payload.value.length === 0) {
    fail('permission set is empty');
  }

  const missingActions = REQUIRED_AZURE_DEPLOYMENT_ACTIONS.filter((action) => (
    !payload.value.some((permissionSet) => permissionSetGrants(permissionSet, action))
  ));

  return {
    schemaVersion: 1,
    kind: 'azure-deployment-rbac-preflight',
    status: missingActions.length === 0 ? 'READY' : 'BLOCKED',
    requiredActions: [...REQUIRED_AZURE_DEPLOYMENT_ACTIONS],
    missingActions,
    permissionSetCount: payload.value.length,
  };
}

export function validateAzureDeploymentPermissions(payload) {
  const receipt = inspectAzureDeploymentPermissions(payload);
  if (receipt.missingActions.length > 0) {
    fail(`missing effective actions: ${receipt.missingActions.join(', ')}`, receipt);
  }
  return receipt;
}

function writeReceipt(outputPath, receipt) {
  const absoluteOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true, mode: 0o700 });
  const temporary = `${absoluteOutput}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, absoluteOutput);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function runCli() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath || process.argv.length !== 4) {
    fail('usage: node scripts/azure-deployment-rbac.mjs <permissions.json> <receipt.json>');
  }
  let receipt;
  try {
    const payload = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
    receipt = validateAzureDeploymentPermissions(payload);
  } catch (error) {
    if (error?.receipt) {
      writeReceipt(outputPath, error.receipt);
    }
    throw error;
  }
  writeReceipt(outputPath, receipt);
  process.stdout.write(`Azure deployment RBAC preflight: ${receipt.status}\n`);
}

const isMain = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
);
if (isMain) runCli();
