import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VM_RESOURCE_ID = /^\/subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/resourceGroups\/([^/\r\n]+)\/providers\/Microsoft\.Compute\/virtualMachines\/([^/\r\n]+)$/iu;
const VM_RESOURCE_TYPE = 'microsoft.compute/virtualmachines';

function fail(message) {
  throw new Error(`Invalid Azure worker VM state: ${message}`);
}

function parseVmResourceId(value, label) {
  if (typeof value !== 'string') fail(`${label} resource ID must be a string`);
  const match = value.match(VM_RESOURCE_ID);
  if (!match) fail(`${label} resource ID is invalid`);
  return {
    normalized: value.toLowerCase(),
    name: match[3],
  };
}

export function resolveAzureWorkerVmState(inventory, expectedResourceId) {
  if (!Array.isArray(inventory)) fail('resource inventory must be an array');
  if (inventory.length > 1) fail('resource inventory must contain exactly zero or one worker VM');
  const expected = parseVmResourceId(expectedResourceId, 'expected worker VM');
  if (inventory.length === 0) {
    return {
      schemaVersion: 1,
      kind: 'azure-worker-vm-state',
      expectedResourceId,
      observedResourceId: null,
      initializeWorkerVm: true,
    };
  }

  const observed = inventory[0];
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) {
    fail('resource inventory entry must be an object');
  }
  if (typeof observed.type !== 'string' || observed.type.toLowerCase() !== VM_RESOURCE_TYPE) {
    fail('observed resource type is not Microsoft.Compute/virtualMachines');
  }
  const observedId = parseVmResourceId(observed.id, 'observed worker VM');
  if (typeof observed.name !== 'string' || observed.name.toLowerCase() !== observedId.name.toLowerCase()) {
    fail('observed worker VM name does not match its resource ID');
  }
  if (observedId.normalized !== expected.normalized) {
    fail('observed worker VM resource ID does not match the expected resource ID');
  }
  return {
    schemaVersion: 1,
    kind: 'azure-worker-vm-state',
    expectedResourceId,
    observedResourceId: observed.id,
    initializeWorkerVm: false,
  };
}

function parseArguments(args) {
  const allowed = new Set(['--inventory', '--expected-resource-id', '--output']);
  if (args.length !== 6) fail('arguments must be --inventory <path> --expected-resource-id <id> --output <path>');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name)) fail(`unknown argument: ${name ?? '<missing>'}`);
    if (values.has(name)) fail(`duplicate argument: ${name}`);
    if (!value?.trim()) fail(`${name} must not be empty`);
    values.set(name, value);
  }
  for (const name of allowed) {
    if (!values.has(name)) fail(`${name} is required`);
  }
  return values;
}

function readRegularJson(filePath) {
  const absolutePath = path.resolve(filePath);
  const stat = fs.lstatSync(absolutePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail('inventory must be a regular file');
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    fail('inventory must contain valid JSON');
  }
}

function writeExclusive(outputPath, value) {
  const absolutePath = path.resolve(outputPath);
  const parent = path.dirname(absolutePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) fail('output parent must be a real directory');
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const handle = fs.openSync(absolutePath, 'r');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function runCli() {
  const values = parseArguments(process.argv.slice(2));
  const state = resolveAzureWorkerVmState(
    readRegularJson(values.get('--inventory')),
    values.get('--expected-resource-id'),
  );
  writeExclusive(values.get('--output'), state);
  process.stdout.write(`Azure worker VM state: initialize=${state.initializeWorkerVm}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
