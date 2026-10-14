import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexRunner } from '../src/server/codex-runner.js';
import { AgentIsolationProvider, type AgentIsolationAcquireInput } from '../src/server/agent-execution-policy.js';
import { PtyOutputLines } from '../src/server/pty-output-lines.js';

// Synthetic Node child only; no installed Codex, auth, native addon or model call.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-stream-'));
const workspace = path.join(directory, 'projection'); const serviceSource = path.join(directory, 'source');
const home = path.join(workspace, '.isolated-home'); const executable = path.join(directory, 'synthetic-codex.mjs');
await fs.mkdir(path.join(home, '.codex'), { recursive: true, mode: 0o700 }); await fs.mkdir(serviceSource, { mode: 0o700 });
let launches = 0;
class FixtureProvider extends AgentIsolationProvider {
  constructor() { super('synthetic-protocol-preflight-only'); }
  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({ ...input, spawn(command, args, options) {
      assert.equal(command, executable, 'only the owned synthetic executable may run'); launches++;
      const child = spawnChild(command, [...args], options as never);
      if (args.at(-1)?.endsWith(':merged-port')) child.stderr = child.stdout;
      return child;
    } });
  }
}
const fixture = String.raw`#!NODE_EXECUTABLE
if (process.argv.at(-1) === '--version') { console.log('codex-cli 99.0.0-fixture'); process.exit(0); }
const kind = process.argv.at(-1).split(':').at(-1);
const msg = text => ({ type: 'item.completed', item: { type: 'agent_message', text } });
let records = [{type:'thread.started',thread_id:'019fd700-51cd-7862-a4ef-74ccae0f2b4e'},{type:'turn.started'},msg('한글😀 SAFE_FINAL'),{type:'turn.completed'}];
if (kind === 'merged-valid-json') records.splice(3, 0, msg('SYNTHETIC_STDERR_ORIGIN_CANNOT_BE_KNOWN'));
if (kind === 'stderr-separated') console.error(JSON.stringify(msg('SYNTHETIC_STDERR_MUST_NOT_BE_RESULT')));
if (kind === 'stderr-nonzero') { console.error('token=synthetic-private-diagnostic'); process.exit(9); }
const lf=String.fromCharCode(10), crlf=String.fromCharCode(13,10);
const delimiter = kind === 'crlf-byte-chunks' ? crlf : lf;
let wire = records.map(JSON.stringify).join(delimiter) + (kind === 'no-final-newline' ? '' : delimiter);
if (kind === 'merged-plain-stderr') wire = wire.replace(delimiter, delimiter + 'SYNTHETIC_STDERR_DIAGNOSTIC' + delimiter);
if (kind === 'ansi-prefixed-json') wire = String.fromCharCode(27)+'[31m'+wire;
if (kind === 'crlf-byte-chunks') {
  const bytes = Buffer.from(wire); for (let n=0;n<bytes.length;n++) { process.stdout.write(bytes.subarray(n,n+1)); await new Promise(resolve=>setImmediate(resolve)); }
} else process.stdout.write(wire);
`.replace('NODE_EXECUTABLE', process.execPath);
// Convert only the fixture's deliberately escaped string literals to ordinary JS escapes.
await fs.writeFile(executable, fixture, { mode: 0o700 });
const provider = new FixtureProvider(); let checks=0;
async function run(kind: string) {
 const subject={tenantId:'synthetic',requesterId:'synthetic',conversationId:'synthetic',jobId:kind};
 const environmentOverrides={HOME:home,USERPROFILE:home,CODEX_HOME:path.join(home,'.codex')};
 const lease=await provider.acquire({subject,sourceWorkspace:serviceSource,workspace,protectedRoots:[serviceSource],environmentOverrides,prompt:'CASE:'+kind});
 const runner=new CodexRunner({ command:{executable}, processControllerOptions:{graceMs:20,cleanupWaitMs:500} });
 try { return await runner.run({jobId:kind,prompt:'CASE:'+kind,workspace,mode:'read-only',subject,isolationLease:lease,environmentOverrides,signal:new AbortController().signal,timeoutMs:2000}); }
 finally { await lease.dispose(); }
}
async function check(label: string, operation:()=>Promise<void>|void) {await operation();checks++;console.log('PASS '+label);}
try {
 await check('a merged PTY-shaped output port cannot be accepted as a structured result', async()=>{await assert.rejects(()=>run('merged-port'),/separate|stream|pipe/i);});
 for (const kind of ['lf','crlf-byte-chunks','no-final-newline','stderr-separated']) await check(kind+' preserves only the stdout JSONL final message',async()=>{assert.equal((await run(kind)).finalMessage,'한글😀 SAFE_FINAL');});
 await check('nonzero stderr diagnostics are masked and never success',async()=>{await assert.rejects(()=>run('stderr-nonzero'),(e:Error)=>/REDACTED/i.test(e.message)&&!e.message.includes('synthetic-private-diagnostic'));});
 for(const kind of ['merged-plain-stderr','ansi-prefixed-json']) await check(kind+' fails closed as malformed JSONL',async()=>{await assert.rejects(()=>run(kind),/malformed JSONL|protocol/i);});
 await check('characterization: once merged, valid JSON diagnostics cannot carry original stderr provenance',async()=>{assert.equal((await run('merged-valid-json')).finalMessage,'SYNTHETIC_STDERR_ORIGIN_CANNOT_BE_KNOWN');});
 await check('lossy display projection removes CRs, masks complete secret lines and omits ANSI',()=>{const lines:string[]=[];const projection=new PtyOutputLines(16384,line=>lines.push(line));const crlf=String.fromCharCode(13,10),lf=String.fromCharCode(10);projection.push('한글😀'+crlf+'token=synthetic-');projection.push('secret'+crlf+String.fromCharCode(27)+'[31mcolor'+crlf);projection.finish();assert.equal(lines[0],'한글😀'+lf);assert.match(lines[1]!,/REDACTED/);assert.equal(lines[2],'[PTY control output omitted]'+lf);});
 console.log(JSON.stringify({result:'PASS',checks,syntheticWorkloadLaunches:launches,nativeCodexLaunches:0,nativePtyLaunches:0,modelCalls:0,limitation:'JSONL parsing does not recover stderr provenance from a merged PTY stream'}));
} finally { await fs.rm(directory,{recursive:true,force:true}); }
