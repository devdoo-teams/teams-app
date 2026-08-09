import path from 'node:path';
import { pathToFileURL } from 'node:url';

const script = process.argv[2];
if (!script) throw new Error('usage: node scripts/run-module-test.mjs <test-module>');

try {
  await import(pathToFileURL(path.resolve(process.cwd(), script)).href);
  // A few legacy focused tests leave a non-functional loader handle open after
  // printing their result. The module has completed, so own process lifetime
  // here and let the parent apply the bounded timeout.
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
