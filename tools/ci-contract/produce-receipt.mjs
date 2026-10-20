import { resolve } from 'node:path';
import { writeProducerPacket } from './lib/producer.mjs';
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--capture-dir' || args[2] !== '--output-dir' || !args[1] || !args[3]) throw new Error('ARGUMENTS');
  console.log(JSON.stringify(writeProducerPacket(resolve(args[1]), resolve(args[3]))));
} catch {
  console.error('CI_PRODUCER_INPUT_OR_OUTPUT_REJECTED'); process.exitCode = 2;
}
