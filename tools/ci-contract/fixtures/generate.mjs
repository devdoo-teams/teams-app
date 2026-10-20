import { writeFileSync } from 'node:fs';
import { complete, historicalRerun, reused } from './factory.mjs';
for (const [name, value] of Object.entries({ 'teams-complete': complete(), 'iphone-rerun-unavailable': historicalRerun(), 'teams-reused': reused() })) {
  writeFileSync(new URL(`./${name}.json`, import.meta.url), `${JSON.stringify(value, null, 2)}\n`);
}
