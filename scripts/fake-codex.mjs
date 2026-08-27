import fs from 'node:fs/promises';

const prompt = process.argv.at(-1) ?? '';
const configuredDelayMs = Number(process.env.FAKE_CODEX_DELAY_MS ?? 0);

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
