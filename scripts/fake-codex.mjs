import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Test-only CLI contract. No real login, auth file or external provider is used.
export const FAKE_CODEX_MODEL_CATALOG = { models: [{
  slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list',
  default_reasoning_level: 'xhigh', supported_reasoning_levels: [{ effort: 'xhigh' }],
}] };

export async function createFakeCodexRuntime(directory, { nodeExecutable = process.execPath } = {}) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const home = path.join(directory, 'codex-home');
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const executable = path.join(directory, 'codex-fixture');
  const source = await fs.readFile(fileURLToPath(import.meta.url), 'utf8');
  const content = `#!${nodeExecutable}\n${source.replace(/^#![^\n]*\n/u, '')}`;
  for (const [file, value, mode] of [[executable, content, 0o700], [`${executable}.executions`, '', 0o600]]) {
    try { await fs.writeFile(file, value, { flag: 'wx', mode }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (file === executable && await fs.readFile(file, 'utf8') !== content) throw new Error('Synthetic executable identity changed.');
    }
  }
  return {
    CODEX_BIN: executable,
    CODEX_BIN_SHA256: crypto.createHash('sha256').update(content).digest('hex'),
    AGENT_CODEX_HOME: home,
    CODEX_SCRIPT: undefined,
  };
}

async function runFakeCodex() {
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('codex-cli 0.162.0-alpha.2 (synthetic Teams fixture)');
  return;
}
if (args[0] === '--help' || (args[0] === 'exec' && args[1] === '--help')) {
  console.log('SYNTHETIC ONLY: codex exec --json --model MODEL --config KEY=VALUE -- PROMPT; codex debug models; codex login status');
  return;
}
if (args[0] === 'debug' && args[1] === 'models') {
  console.log(JSON.stringify(FAKE_CODEX_MODEL_CATALOG));
  return;
}
if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using ChatGPT'); // Synthetic status, never reads auth.
  return;
}
if (args[0] !== 'exec' || args[args.indexOf('--model') + 1] !== 'gpt-6-luna'
  || !args.includes('model_reasoning_effort="xhigh"') || !args.includes('model_provider="openai"')) {
  throw new Error('Synthetic CLI refused unsupported command or conflicting Teams policy.');
}
await fs.appendFile(`${fileURLToPath(import.meta.url)}.executions`, 'execution\n');

const prompt = process.argv.at(-1) ?? '';
const promptDelayMs = Number(prompt.match(/\[FAKE_CODEX_DELAY_MS=(\d{1,5})\]/)?.[1] ?? 0);
const configuredDelayMs = promptDelayMs || Number(process.env.FAKE_CODEX_DELAY_MS ?? 0);

if (Number.isFinite(configuredDelayMs) && configuredDelayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, Math.min(configuredDelayMs, 10_000)));
}

if (prompt.includes('MUTATE')) {
  await fs.writeFile('runtime-agent-change.txt', 'created by runtime fake codex\n', 'utf8');
}

console.log(JSON.stringify({ type: 'thread.started', thread_id: '00000000-0000-4000-8000-0000000000aa' }));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: '중간 분석 업데이트: 작업 범위를 확인했습니다.' },
}));
console.log(JSON.stringify({
  type: 'item.started',
  item: { type: 'command_execution', command: `inspect: ${prompt.slice(0, 60)}` },
}));

if (prompt.includes('SLOW')) {
  await new Promise(() => setInterval(() => {}, 1_000));
}

console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: `FAKE_CODEX_OK\n요청: ${prompt}` },
}));
console.log(JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 4 } }));
}

if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  await runFakeCodex();
}
