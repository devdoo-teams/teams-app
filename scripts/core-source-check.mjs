import { runCoreSourceCheck } from './core-source-check-lib.mjs';

const result = runCoreSourceCheck();

console.log(`PASS: core source compile check covered ${result.checkedFileCount} Teams/CLI files`);
