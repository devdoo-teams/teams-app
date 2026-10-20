import { writeFileSync } from 'node:fs';
import { schema } from './lib/schema.mjs';
writeFileSync(new URL('./ci-result.schema.json', import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
