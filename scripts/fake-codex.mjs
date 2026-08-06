import fs from 'node:fs/promises';

const prompt = process.argv.at(-1) ?? '';

if (prompt.includes('MUTATE')) {
  await fs.writeFile('runtime-agent-change.txt', 'created by runtime fake codex\n', 'utf8');
}

console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread-runtime' }));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({
  type: 'item.started',
  item: { type: 'command_execution', command: `inspect: ${prompt.slice(0, 60)}` },
}));

if (prompt.includes('SLOW')) {
  await new Promise(() => {});
}

console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: `FAKE_CODEX_OK\n요청: ${prompt}` },
}));
console.log(JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 4 } }));
