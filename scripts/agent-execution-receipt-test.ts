import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GenUiActionStore} from '../src/server/genui-action-store.js';
import {AgentJobStore} from '../src/server/agent-job-store.js';
import type {CoreExecutionReceipt} from '../src/shared/core-orchestration.js';
import {GenUiResponseFactory, createCoreOrchestrationJobActivity} from '../src/server/genui-response.js';
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'teams-execution-receipt-')));
const scope={tenantId:'fixture',requesterId:'fixture',conversationId:'fixture'};
const store=new AgentJobStore(path.join(root,'jobs.json'));await store.initialize();
const receipt: CoreExecutionReceipt = {source:'worker-observation',observedAt:'2026-10-06T00:00:00.000Z',platform:'darwin',model:'observed-model',reasoningEffort:'low'};
try{
 const job=await store.create({prompt:'fixture',provider:'codex',mode:'read-only',scope,model:'selected-model',reasoningEffort:'high',catalogRevision:'a'.repeat(64)});
 const saved=await store.update(job.id,scope,{status:'completed',result:'fixture',executionReceipt:receipt});
 assert.deepEqual(saved!.executionReceipt,receipt);
 const restarted=new AgentJobStore(path.join(root,'jobs.json'));await restarted.initialize();assert.deepEqual(restarted.get(job.id,scope)!.executionReceipt,receipt,'receipt survives restart');
 await assert.rejects(store.update(job.id,scope,{executionReceipt:{...receipt,model:'changed-model'}} as any),/immutable/);
 for(const invalid of [{...receipt,model:'--bad'}, {...receipt,source:'selected-config'}, {...receipt,observedAt:'invalid'}, {...receipt,secret:'no'}, {source:'worker-observation',observedAt:receipt.observedAt}]) await assert.rejects(store.update(job.id,scope,{executionReceipt:invalid} as any),/invalid/);
 (saved!.executionReceipt as {model?:string}).model = 'mutated-copy';
 assert.equal(store.get(job.id,scope)!.executionReceipt!.model, 'observed-model', 'returned receipt cannot alias durable state');
 saved!.executionReceipt = receipt;
 await store.update(job.id,scope,{executionReceipt:{...receipt}});
 assert.equal(store.get(job.id,{...scope,requesterId:'other'}),undefined, 'receipt remains scope protected');
 const card=JSON.stringify(createCoreOrchestrationJobActivity({...saved!,progress:[]}));assert.match(card,/selected-model/);assert.match(card,/observed-model/);assert.match(card,/darwin/);
 const actionStore = new GenUiActionStore(path.join(root,'actions.json')); await actionStore.initialize();
 const factory=new GenUiResponseFactory(actionStore);
 for(const envelope of [await factory.jobStatus(saved!),await factory.approval(saved!),factory.approvalAccepted(saved!),factory.cancelled(saved!),factory.continued(saved!),factory.naturalLanguageStarted(saved!),factory.commitResult(saved!),factory.started(saved!),factory.notification({job:saved!,kind:'result',message:'fixture'} as any)]) {const text=JSON.stringify(envelope);assert.match(text,/선택 모델/);assert.match(text,/observed-model/);assert.match(text,/실제 추론 수준/);}
 const noModel=JSON.stringify(createCoreOrchestrationJobActivity({...saved!,executionReceipt:{source:'worker-observation',observedAt:receipt.observedAt,platform:'darwin'}}));assert.doesNotMatch(noModel,/observed-model/);assert.match(noModel,/확인되지 않음/);
 const raw = JSON.parse(await fs.readFile(path.join(root,'jobs.json'),'utf8')); raw[0].executionReceipt.secret = 'rejected';
 await fs.writeFile(path.join(root,'corrupt.json'),JSON.stringify(raw));
 await assert.rejects(new AgentJobStore(path.join(root,'corrupt.json')).initialize(), /invalid/);
 console.log('PASS: observed receipt persists immutably and stays separate from selected model/effort');
}finally{await fs.rm(root,{recursive:true,force:true});}
