import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AgentJobStore} from '../src/server/agent-job-store.js';
import {createCoreOrchestrationJobActivity} from '../src/server/genui-response.js';
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teams-job-presentation-')));
const scope={tenantId:'a',requesterId:'a',conversationId:'a'};
const store=new AgentJobStore(root+'/jobs.json');await store.initialize();
try{
 const job=await store.create({prompt:'fixture',provider:'codex',mode:'read-only',scope,executionEnvironment:'local-macos',model:'selected-model',reasoningEffort:'high',catalogRevision:'a'.repeat(64)} as any);
 assert.equal((job as any).executionEnvironment,'local-macos','persist execution environment');
 await store.update(job.id,scope,{status:'completed',result:'fixture result'});
 const restarted=new AgentJobStore(root+'/jobs.json');await restarted.initialize();
 assert.equal((restarted.get(job.id,scope) as any).executionEnvironment,'local-macos','restart environment');
 await assert.rejects(store.update(job.id,scope,{executionEnvironment:'local-windows'} as any),/immutable/);
 for(const status of ['queued','running','awaiting_approval','completed','failed','cancelled'] as const){
  const rendered=JSON.stringify(createCoreOrchestrationJobActivity({...job,status,progress:[]}));
  assert.match(rendered,/선택 모델/);assert.match(rendered,/실제 모델/);assert.match(rendered,/확인되지 않음/);assert.match(rendered,/실행환경/);assert.match(rendered,/local-macos/);assert.match(rendered,RegExp(status));
 }
 for (const environment of ['', 'guessed-host']) await assert.rejects(store.create({prompt:'fixture',provider:'codex',mode:'read-only',scope,executionEnvironment:environment} as any), /invalid/);
 const other={...scope,requesterId:'other'};assert.equal(store.get(job.id,other),undefined);
 console.log('PASS: job presentation persists environment and distinguishes selection from unknown actual model');
}finally{await fs.rm(root,{recursive:true,force:true});}
