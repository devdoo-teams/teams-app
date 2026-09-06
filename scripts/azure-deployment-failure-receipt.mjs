import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const BOUNDARY = /^[a-z0-9][a-z0-9._-]{1,79}$/u;

function fail(message) {
  throw new Error(`Invalid Azure deployment failure receipt: ${message}`);
}

function requiredString(value, label, pattern = SAFE_IDENTIFIER) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function optionalIdentity(value, label, pattern) {
  if (value === undefined || value === null || value === '' || value === 'unknown') return 'unknown';
  return requiredString(value, label, pattern);
}

function parseExitCode(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 255) return value;
  if (typeof value === 'string' && /^[1-9]\d{0,2}$/u.test(value)) {
    const parsed = Number(value);
    if (parsed >= 1 && parsed <= 255) return parsed;
  }
  fail('exit code must be an integer between 1 and 255');
}

export function createAzureDeploymentFailureReceipt({
  stage = 'DeployCanary',
  job = 'DeployCanaryRevision',
  boundary,
  exitCode,
  sourceCommit,
  releaseVersion,
  pipelineRunId,
  checkedAt = new Date().toISOString(),
} = {}) {
  requiredString(stage, 'stage');
  requiredString(job, 'job');
  requiredString(boundary, 'boundary', BOUNDARY);
  const parsedCheckedAt = new Date(checkedAt);
  if (Number.isNaN(parsedCheckedAt.valueOf()) || parsedCheckedAt.toISOString() !== checkedAt) {
    fail('checkedAt must be an ISO timestamp');
  }
  return {
    schemaVersion: 1,
    status: 'FAIL',
    stage,
    job,
    boundary,
    exitCode: parseExitCode(exitCode),
    sourceCommit: optionalIdentity(sourceCommit, 'source commit', COMMIT),
    releaseVersion: optionalIdentity(releaseVersion, 'release version', VERSION),
    pipelineRunId: optionalIdentity(pipelineRunId, 'pipeline run ID', /^[0-9]+$/u),
    checkedAt,
    diagnostics: {
      rawErrorPersisted: false,
      nextAction: 'Inspect the failed pipeline task stderr and the named boundary before retrying.',
    },
  };
}

export function writeAzureDeploymentFailureReceipt(outputPath, input) {
  if (typeof outputPath !== 'string' || outputPath.length === 0) fail('output path is required');
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(createAzureDeploymentFailureReceipt(input), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return resolvedOutput;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length || key === '--') fail('arguments must use --key value pairs');
    if (Object.hasOwn(args, key.slice(2))) fail(`duplicate argument: ${key}`);
    args[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['output', 'boundary', 'exit-code'];
  for (const name of required) if (!args[name]) fail(`--${name} is required`);
  const output = writeAzureDeploymentFailureReceipt(args.output, {
    stage: args.stage,
    job: args.job,
    boundary: args.boundary,
    exitCode: args['exit-code'],
    sourceCommit: args['source-commit'],
    releaseVersion: args['release-version'],
    pipelineRunId: args['pipeline-run-id'],
  });
  console.log(`Azure deployment failure receipt written: ${output}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
