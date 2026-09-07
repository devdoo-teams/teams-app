import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const MAX_INPUT_BYTES = 64 * 1024;
const PROBE_VERSION = '1';

const PROBE_FIELDS = new Set([
  'probe_version',
  'observed_at',
  'service_enabled',
  'service_active',
  'service_substate',
  'service_main_pid',
  'service_exec_main_status',
  'current_release_commit',
  'release_commit',
  'manifest_commit',
  'codex_bin',
  'codex_bin_type',
  'codex_bin_executable',
  'codex_sha256',
  'codex_actual_sha256',
  'auth_file',
  'auth_type',
  'auth_mode',
  'auth_nlink',
  'auth_owner',
  'codex_login',
  'overall',
]);

function fail(message) {
  throw new Error('Invalid Azure worker runtime probe: ' + message);
}

function requireCommit(value, label) {
  if (!COMMIT.test(String(value ?? ''))) fail(label + ' must be a full lowercase Git commit OID');
  return value;
}

function requireSha256(value, label) {
  if (!SHA256.test(String(value ?? ''))) fail(label + ' must be a lowercase SHA-256');
  return value;
}

function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

export function renderWorkerRuntimeProbeScript({ commit, codexBinSha256 }) {
  requireCommit(commit, 'expected commit');
  requireSha256(codexBinSha256, 'expected Codex executable SHA-256');
  return [
    '#!/usr/bin/env bash',
    'set -u',
    '',
    'expected_commit=' + shellQuote(commit),
    'expected_codex_sha256=' + shellQuote(codexBinSha256),
    'root="$(printenv TEAMSAPP_WORKER_PROBE_ROOT 2>/dev/null || printf \'/\')"',
    'status=0',
    '',
    'emit() {',
    '  printf \'%s=%s\\n\' "$1" "$2"',
    '}',
    '',
    'read_env() {',
    '  local key="$1"',
    '  local file="$2"',
    '  if [ -f "$file" ] && [ ! -L "$file" ]; then',
    '    awk -F= -v key="$key" \'$1 == key { sub(/^[^=]*=/, ""); print; exit }\' "$file"',
    '  fi',
    '}',
    '',
    'probe_version=1',
    'observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf \'1970-01-01T00:00:00Z\')"',
    'service_enabled="$(systemctl is-enabled teamsapp-worker.service 2>/dev/null || true)"',
    'service_active="$(systemctl is-active teamsapp-worker.service 2>/dev/null || true)"',
    'service_substate="$(systemctl show teamsapp-worker.service --property=SubState --value 2>/dev/null || true)"',
    'service_main_pid="$(systemctl show teamsapp-worker.service --property=MainPID --value 2>/dev/null || true)"',
    'service_exec_main_status="$(systemctl show teamsapp-worker.service --property=ExecMainStatus --value 2>/dev/null || true)"',
    '',
    'env_file="$root/etc/teamsapp/worker.env"',
    'release_commit="$(read_env TEAMS_SOURCE_COMMIT "$env_file")"',
    'agent_home="$(read_env AGENT_CODEX_HOME "$env_file")"',
    'codex_bin="$(read_env CODEX_BIN "$env_file")"',
    'codex_sha256="$(read_env CODEX_BIN_SHA256 "$env_file")"',
    'current_target="$(readlink -f "$root/opt/teamsapp/current" 2>/dev/null || true)"',
    'current_release_commit="$(basename "$current_target" 2>/dev/null || true)"',
    'manifest_commit=""',
    'node_bin="$current_target/node/bin/node"',
    'manifest_path="$current_target/manifest.json"',
    'if [ -x "$node_bin" ] && [ -f "$manifest_path" ] && [ ! -L "$manifest_path" ]; then',
    '  manifest_commit="$("$node_bin" -e \'const fs = require("node:fs"); const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(typeof value.commit === "string" ? value.commit : "");\' "$manifest_path" 2>/dev/null || true)"',
    'fi',
    '',
    'codex_bin_type=missing',
    'codex_bin_executable=0',
    'codex_actual_sha256=""',
    'if [ -f "$codex_bin" ] && [ ! -L "$codex_bin" ]; then',
    '  codex_bin_type=regular',
    '  if [ -x "$codex_bin" ]; then codex_bin_executable=1; fi',
    '  codex_actual_sha256="$(sha256sum "$codex_bin" 2>/dev/null | awk \'{print $1}\' || true)"',
    'fi',
    '',
    'auth_file=missing',
    'auth_type=missing',
    'auth_mode=""',
    'auth_nlink=""',
    'auth_owner=""',
    'auth_path="$agent_home/auth.json"',
    'if [ -f "$auth_path" ] && [ ! -L "$auth_path" ]; then',
    '  auth_file=present',
    '  auth_type=regular',
    '  auth_mode="$(stat -c \'%a\' "$auth_path" 2>/dev/null || true)"',
    '  auth_nlink="$(stat -c \'%h\' "$auth_path" 2>/dev/null || true)"',
    '  auth_owner="$(stat -c \'%U\' "$auth_path" 2>/dev/null || true)"',
    'fi',
    '',
    'codex_login=unavailable',
    'if [ "$auth_file" = present ] && [ "$codex_bin_executable" = 1 ] && command -v runuser >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then',
    '  if timeout 15s runuser -u teamsworker -- env CODEX_HOME="$agent_home" "$codex_bin" login status >/dev/null 2>&1; then',
    '    codex_login=authenticated',
    '  fi',
    'fi',
    '',
    'if [ "$service_enabled" != enabled ] ||',
    '   [ "$service_active" != active ] ||',
    '   [ "$service_substate" != running ] ||',
    '   [ -z "$service_main_pid" ] ||',
    '   [ "$service_main_pid" = 0 ] ||',
    '   printf "%s" "$service_main_pid" | grep -Eq \'[^0-9]\' ||',
    '   [ "$service_exec_main_status" != 0 ] ||',
    '   [ "$current_release_commit" != "$expected_commit" ] ||',
    '   [ "$release_commit" != "$expected_commit" ] ||',
    '   [ "$manifest_commit" != "$expected_commit" ] ||',
    '   [ "$codex_bin" != /opt/teamsapp/current/codex-runtime/bin/codex ] ||',
    '   [ "$codex_bin_type" != regular ] ||',
    '   [ "$codex_bin_executable" != 1 ] ||',
    '   [ "$codex_sha256" != "$expected_codex_sha256" ] ||',
    '   [ "$codex_actual_sha256" != "$expected_codex_sha256" ] ||',
    '   [ "$auth_file" != present ] ||',
    '   [ "$auth_type" != regular ] ||',
    '   [ "$auth_mode" != 600 ] ||',
    '   [ "$auth_nlink" != 1 ] ||',
    '   [ "$auth_owner" != teamsworker ] ||',
    '   [ "$codex_login" != authenticated ]; then',
    '  status=1',
    'fi',
    '',
    'emit probe_version "$probe_version"',
    'emit observed_at "$observed_at"',
    'emit service_enabled "$service_enabled"',
    'emit service_active "$service_active"',
    'emit service_substate "$service_substate"',
    'emit service_main_pid "$service_main_pid"',
    'emit service_exec_main_status "$service_exec_main_status"',
    'emit current_release_commit "$current_release_commit"',
    'emit release_commit "$release_commit"',
    'emit manifest_commit "$manifest_commit"',
    'emit codex_bin "$codex_bin"',
    'emit codex_bin_type "$codex_bin_type"',
    'emit codex_bin_executable "$codex_bin_executable"',
    'emit codex_sha256 "$codex_sha256"',
    'emit codex_actual_sha256 "$codex_actual_sha256"',
    'emit auth_file "$auth_file"',
    'emit auth_type "$auth_type"',
    'emit auth_mode "$auth_mode"',
    'emit auth_nlink "$auth_nlink"',
    'emit auth_owner "$auth_owner"',
    'emit codex_login "$codex_login"',
    'if [ "$status" = 0 ]; then',
    '  emit overall ready',
    'else',
    '  emit overall blocked',
    'fi',
    'exit "$status"',
    '',
  ].join('\n');
}

function parseProbeOutput(output) {
  if (typeof output !== 'string' || output.length === 0 || output.length > MAX_INPUT_BYTES) {
    fail('probe stdout is missing or too large');
  }
  const fields = {};
  for (const line of output.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) fail('probe stdout contains a malformed line');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!PROBE_FIELDS.has(key)) fail('probe stdout contains an unexpected field: ' + key);
    if (Object.hasOwn(fields, key)) fail('probe stdout contains a duplicate field: ' + key);
    if (/[\r\n]/u.test(value) || value.length > 512) fail('probe field is unsafe: ' + key);
    fields[key] = value;
  }
  for (const key of PROBE_FIELDS) {
    if (!Object.hasOwn(fields, key)) fail('probe stdout is missing ' + key);
  }
  if (fields.probe_version !== PROBE_VERSION) fail('probe version is unsupported');
  if (!ISO_UTC.test(fields.observed_at)) fail('probe timestamp is invalid');
  return Object.freeze(fields);
}

export function parseRunCommandResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.value)) {
    fail('Run Command response must contain a value array');
  }
  const messages = payload.value
    .map((entry) => (entry && typeof entry.message === 'string' ? entry.message : ''))
    .filter(Boolean);
  const combined = messages.join('\n');
  const stdoutMarker = combined.indexOf('[stdout]');
  if (stdoutMarker < 0) fail('Run Command response does not contain stdout');
  const stdoutStart = stdoutMarker + '[stdout]'.length;
  const stderrMarker = combined.indexOf('[stderr]', stdoutStart);
  const stdout = combined.slice(stdoutStart, stderrMarker >= 0 ? stderrMarker : undefined).trim();
  return parseProbeOutput(stdout);
}

function parseProbeInput(input) {
  if (input && typeof input === 'object' && !Array.isArray(input) && Array.isArray(input.value)) {
    return parseRunCommandResponse(input);
  }
  return parseProbeOutput(input);
}

export function verifyWorkerRuntimeProbe(input, { expectedCommit, expectedCodexBinSha256 }) {
  requireCommit(expectedCommit, 'expected commit');
  requireSha256(expectedCodexBinSha256, 'expected Codex executable SHA-256');
  const fields = parseProbeInput(input);
  const expectedFields = new Map([
    ['service_enabled', 'enabled'],
    ['service_active', 'active'],
    ['service_substate', 'running'],
    ['service_exec_main_status', '0'],
    ['current_release_commit', expectedCommit],
    ['release_commit', expectedCommit],
    ['manifest_commit', expectedCommit],
    ['codex_bin', '/opt/teamsapp/current/codex-runtime/bin/codex'],
    ['codex_bin_type', 'regular'],
    ['codex_bin_executable', '1'],
    ['codex_sha256', expectedCodexBinSha256],
    ['codex_actual_sha256', expectedCodexBinSha256],
    ['auth_file', 'present'],
    ['auth_type', 'regular'],
    ['auth_mode', '600'],
    ['auth_nlink', '1'],
    ['auth_owner', 'teamsworker'],
    ['codex_login', 'authenticated'],
    ['overall', 'ready'],
  ]);
  for (const [key, expected] of expectedFields) {
    if (fields[key] !== expected) {
      fail(key + ' was ' + JSON.stringify(fields[key]) + '; expected ' + JSON.stringify(expected));
    }
  }
  const mainPid = Number(fields.service_main_pid);
  const authNlink = Number(fields.auth_nlink);
  if (!Number.isSafeInteger(mainPid) || mainPid < 1) fail('service_main_pid is invalid');
  if (!Number.isSafeInteger(authNlink) || authNlink !== 1) fail('auth_nlink is invalid');
  return Object.freeze({
    schemaVersion: 1,
    kind: 'azure-worker-runtime-probe',
    status: 'READY',
    sourceCommit: expectedCommit,
    observedAt: fields.observed_at,
    service: Object.freeze({
      enabled: fields.service_enabled,
      active: fields.service_active,
      substate: fields.service_substate,
      mainPid,
      execMainStatus: Number(fields.service_exec_main_status),
    }),
    worker: Object.freeze({
      currentReleaseCommit: fields.current_release_commit,
      manifestCommit: fields.manifest_commit,
      codexBinSha256: fields.codex_actual_sha256,
    }),
    authentication: Object.freeze({
      file: fields.auth_file,
      type: fields.auth_type,
      mode: fields.auth_mode,
      nlink: authNlink,
      owner: fields.auth_owner,
      login: fields.codex_login,
    }),
  });
}

function readRegularJson(filePath) {
  const absolutePath = path.resolve(filePath);
  const stat = fs.lstatSync(absolutePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail('input must be a regular file');
  if (stat.size === 0 || stat.size > MAX_INPUT_BYTES) fail('input must be non-empty and smaller than 64 KiB');
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    fail('input must contain valid JSON');
  }
}

function writeExclusive(outputPath, value) {
  const absolutePath = path.resolve(outputPath);
  const parent = path.dirname(absolutePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) fail('output parent must be a real directory');
  fs.writeFileSync(absolutePath, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const handle = fs.openSync(absolutePath, 'r');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function parsePairs(argv, allowed) {
  if (argv.length % 2 !== 0) fail('arguments must be --name value pairs');
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) fail('unknown argument: ' + (name ?? '<missing>'));
    if (values.has(name)) fail('duplicate argument: ' + name);
    if (!value?.trim()) fail(name + ' must not be empty');
    values.set(name, value);
  }
  for (const name of allowed) {
    if (!values.has(name)) fail(name + ' is required');
  }
  return values;
}

function runCli() {
  const [command, ...argv] = process.argv.slice(2);
  if (command === 'script') {
    const values = parsePairs(argv, new Set(['--expected-commit', '--expected-codex-bin-sha256']));
    process.stdout.write(renderWorkerRuntimeProbeScript({
      commit: values.get('--expected-commit'),
      codexBinSha256: values.get('--expected-codex-bin-sha256'),
    }));
    return;
  }
  if (command === 'verify') {
    const values = parsePairs(argv, new Set([
      '--input', '--expected-commit', '--expected-codex-bin-sha256', '--output',
    ]));
    const receipt = verifyWorkerRuntimeProbe(readRegularJson(values.get('--input')), {
      expectedCommit: values.get('--expected-commit'),
      expectedCodexBinSha256: values.get('--expected-codex-bin-sha256'),
    });
    writeExclusive(values.get('--output'), receipt);
    process.stdout.write('Azure worker runtime probe verified: ' + receipt.sourceCommit + '\n');
    return;
  }
  fail('usage: azure-worker-runtime-probe.mjs <script|verify> [--name value ...]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
