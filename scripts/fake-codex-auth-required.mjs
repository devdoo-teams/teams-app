import fs from 'node:fs/promises';
import path from 'node:path';

const codexHome = process.env.CODEX_HOME;
if (!codexHome) throw new Error('CODEX_HOME is required');

const authPath = path.join(codexHome, 'auth.json');
const auth = JSON.parse(await fs.readFile(authPath, 'utf8'));
if (auth.fixture !== 'teams-core-chat') throw new Error('staged Codex auth fixture is unavailable');

const prompt = process.argv.at(-1) ?? '';
console.log(JSON.stringify({ type: 'thread.started', thread_id: '00000000-0000-4000-8000-0000000000ac' }));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: '격리 인증과 Teams 요청 범위를 확인했습니다.' },
}));
console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: `FAKE_CODEX_OK\n요청: ${prompt}` },
}));
console.log(JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 4 } }));
