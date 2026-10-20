import { resolve } from 'node:path';
import { readJsonFile } from './lib/io.mjs';
import { writePacket } from './lib/packet.mjs';

function options(argv) {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--output-dir' || !argv[1] || !argv[3]) throw new Error('ARGUMENTS');
  return { input: resolve(argv[1]), output: resolve(argv[3]) };
}
try {
  const paths = options(process.argv.slice(2));
  console.log(JSON.stringify(writePacket(readJsonFile(paths.input).value, paths.output)));
} catch {
  // Input may be hostile or contain private values; emit a fixed diagnostic.
  console.error('CI_CONTRACT_INPUT_OR_OUTPUT_REJECTED'); process.exitCode = 2;
}
