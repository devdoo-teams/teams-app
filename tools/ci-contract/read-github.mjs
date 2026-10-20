import { resolve } from 'node:path';
import { readGithubCapture } from './lib/github-reader.mjs';
import { writePacket } from './lib/packet.mjs';
try {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--capture-dir' || args[2] !== '--policy' || args[4] !== '--output-dir' || !args[1] || !args[3] || !args[5]) throw new Error('ARGUMENTS');
  const { result, provenance } = readGithubCapture(resolve(args[1]), resolve(args[3]));
  console.log(JSON.stringify(writePacket(result, resolve(args[5]), provenance)));
} catch {
  console.error('GITHUB_CAPTURE_INPUT_OR_OUTPUT_REJECTED'); process.exitCode = 2;
}
