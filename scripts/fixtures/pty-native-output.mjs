// Bounded synthetic program; invoked directly by Node in a real PTY. No shell,
// credentials, network, production jobs or filesystem mutation.
const [nonce, mode] = process.argv.slice(2);
if (!/^[a-f0-9]{32}$/.test(nonce ?? '') || !['natural', 'wait'].includes(mode)) process.exit(64);
const tty = { nonce, ttyIn: process.stdin.isTTY === true, ttyOut: process.stdout.isTTY === true, pid: process.pid };
if (!tty.ttyIn || !tty.ttyOut) process.exit(65);
setTimeout(() => process.stdout.write(`${JSON.stringify(tty)}\n`), 20);
setTimeout(() => process.stdout.write('한글 😀 token=synthetic-'), 80);
setTimeout(() => process.stdout.write('private-value\nsecond-output\n'), 250);
if (mode === 'natural') setTimeout(() => { process.stdout.write('final-without-newline'); process.exit(7); }, 600);
else {
  process.on('SIGHUP', () => setTimeout(() => process.exit(0), 50));
  setTimeout(() => process.exit(66), 7000); // Always reap a failed smoke fixture.
}
