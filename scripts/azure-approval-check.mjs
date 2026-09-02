import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const approvalTypeId = '8c6f20a7-a545-4486-9777-f762fafe0d4d';

function fail(message) {
  throw new Error(`Invalid Azure DevOps approval configuration: ${message}`);
}

export function validateApprovalConfiguration(payload, { environmentId, environmentName, project }) {
  if (!payload || !Array.isArray(payload.value)) fail('check configuration response is malformed');
  const approvals = payload.value.filter((check) => (
    check?.type?.id === approvalTypeId
    && check?.type?.name === 'Approval'
    && check?.isDisabled !== true
    && check?.resource?.type === 'environment'
    && String(check?.resource?.id) === String(environmentId)
    && check?.resource?.name === environmentName
  ));
  if (approvals.length !== 1) fail(`expected exactly one enabled approval check for environment ${environmentName} (${environmentId}), found ${approvals.length}`);
  const check = approvals[0];
  const approvers = check.settings?.approvers;
  if (!Array.isArray(approvers) || approvers.length < 1 || approvers.some((approver) => typeof approver?.id !== 'string' || !approver.id)) {
    fail('approval check must configure at least one explicit approver');
  }
  return {
    schemaVersion: 1,
    approvalConfigured: true,
    project,
    environmentId: String(environmentId),
    environmentName,
    checkId: check.id,
    checkTypeId: check.type.id,
    approverCount: approvers.length,
    executionOrder: check.settings.executionOrder,
    minRequiredApprovers: check.settings.minRequiredApprovers,
    checkedAt: new Date().toISOString(),
  };
}

export async function queryApprovalConfiguration({ collectionUri, project, environmentId, environmentName, token, fetchImpl = fetch }) {
  if (!token) fail('System.AccessToken is required');
  const collection = new URL(collectionUri);
  if (collection.protocol !== 'https:') fail('collection URI must use HTTPS');
  const url = new URL(`${encodeURIComponent(project)}/_apis/pipelines/checks/configurations`, collection);
  url.searchParams.set('resourceType', 'environment');
  url.searchParams.set('resourceId', environmentId);
  url.searchParams.set('$expand', 'settings');
  url.searchParams.set('api-version', '7.1-preview.1');
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    redirect: 'error',
  });
  if (!response.ok) fail(`check configuration query returned HTTP ${response.status}`);
  return validateApprovalConfiguration(await response.json(), { environmentId, environmentName, project });
}

async function main() {
  const [collectionUri, project, environmentId, environmentName, outputPath] = process.argv.slice(2);
  if (!collectionUri || !project || !environmentId || !environmentName || !outputPath || process.argv.length !== 7) {
    throw new Error('Usage: node scripts/azure-approval-check.mjs <collection-uri> <project> <environment-id> <environment-name> <receipt-path>');
  }
  const receipt = await queryApprovalConfiguration({
    collectionUri,
    project,
    environmentId,
    environmentName,
    token: process.env.SYSTEM_ACCESSTOKEN,
  });
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(`Azure DevOps approval check verified: environment ${receipt.environmentName} (${receipt.environmentId}), check ${receipt.checkId}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
