import path from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const script = process.argv[2];
if (!script) throw new Error('usage: node scripts/run-module-test.mjs <test-module>');

const modulePath = realpathSync(path.resolve(process.cwd(), script));
// Preserve direct-entrypoint guards and script arguments, including nested
// suites. Import completion alone does not mean their async tests have settled.
process.argv = [process.argv[0], modulePath, ...process.argv.slice(3)];
await import(pathToFileURL(modulePath).href);
// Let Node drain pending work and retain exitCode, uncaught failures and signals.
// The parent owns the bounded timeout; tests must dispose their own resources.
