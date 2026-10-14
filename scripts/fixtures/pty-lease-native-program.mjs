import { spawn } from 'node:child_process';

// Executed only as a pinned synthetic Codex executable, with the real
// provider's exact argument grammar. It is not Codex or an isolation proof.
const { nonce, mode } = JSON.parse(process.argv.at(-1));
if (!/^[a-f0-9]{32}$/.test(nonce ?? '') || !['wait', 'natural'].includes(mode)) process.exit(64);
if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) process.exit(65);
const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});process.on("SIGHUP",()=>{});process.stdout.write("ready\\n");setTimeout(()=>process.exit(0),6000);'], {
  env: { LANG: 'en_US.UTF-8' }, stdio: ['ignore', 'pipe', 'ignore'],
});
child.stdout.once('data', () => {
  process.stdout.write(JSON.stringify({ nonce, ttyIn: true, ttyOut: true, pid: process.pid, childPid: child.pid }) + '\n');
  process.stdout.write('lease-output token=synthetic-private-value\n');
  if (mode === 'natural') setTimeout(() => process.exit(7), 180);
});
// Both levels are bounded even if the external smoke harness fails.
setTimeout(() => process.exit(66), 6000);
