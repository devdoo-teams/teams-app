import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { observeCodexToolUsage, mergeObservedToolUsage } from '../src/server/agent-tool-observation.js';
import { AgentJobStore } from '../src/server/agent-job-store.js';
import { createCoreOrchestrationJobActivity } from '../src/server/genui-response.js';
import { loadJobConversation } from '../src/client/job-conversation.js';
import { agentToolOutcomeText } from '../src/shared/agent-tool-presentation.js';
import type { CoreAgentToolUsage, CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

const at='2026-10-09T01:43:00.000Z';
const end='2026-10-09T01:43:01.000Z';
const source='codex.exec.jsonl.command_execution';
const start:any={type:'item.started',item:{id:'item_1',type:'command_execution',command:'/bin/zsh -lc "cat src/fixture.txt"',status:'in_progress',aggregated_output:'',exit_code:null}};
const done:any={type:'item.completed',item:{...start.item,status:'completed',exit_code:0,aggregated_output:'values: 17, 25\nexpected sum: 42\n'}};
const expectedStart:any={category:'cli',name:'cat',observedAt:at,execution:{source,itemId:'item_1',status:'in_progress'}};
const expectedDone:any={...expectedStart,execution:{...expectedStart.execution,status:'completed',observedAt:end,exitCode:0,output:'values: 17, 25\nexpected sum: 42\n',outputTruncated:false}};
const scope={tenantId:'synthetic-tenant',requesterId:'synthetic-owner',conversationId:'synthetic-chat'};

if (!process.env.TERMINAL_TEST_CASE || process.env.TERMINAL_TEST_CASE==='observation') {
 assert.deepEqual(observeCodexToolUsage(start,at),[expectedStart],'structured command start carries an invocation identity');
 const observed=observeCodexToolUsage(done,end);
 assert.equal((observed[0] as any)?.execution?.exitCode,0,'actual terminal exit survives projection');
 assert.deepEqual(mergeObservedToolUsage([expectedStart],observed),[expectedDone],'terminal replaces its matching start while preserving start time');
 const failed:any={...done,item:{...done.item,id:'item_2',status:'failed',exit_code:17,aggregated_output:'synthetic failure'}};
 const second=observeCodexToolUsage({...start,item:{...start.item,id:'item_2'}},at);
 const merged=mergeObservedToolUsage([expectedDone],second);
 assert.equal(merged.length,2,'two cat invocations stay distinct');
 assert.equal((mergeObservedToolUsage(merged,observeCodexToolUsage(failed,end))[1] as any).execution.exitCode,17,'a second command failure cannot overwrite first success');
 assert.deepEqual(mergeObservedToolUsage([expectedDone],observeCodexToolUsage(start,end)),[expectedDone],'late starts cannot regress a completed observation');
 assert.deepEqual(mergeObservedToolUsage([expectedDone],observeCodexToolUsage({...done,item:{...done.item,exit_code:22}},end)),[expectedDone],'duplicate or conflicting terminal events do not rewrite first terminal');
 const cap=Array.from({length:32},(_,i)=>({...expectedStart,execution:{...expectedStart.execution,itemId:`item_${i+1}`}}));
 assert.equal((mergeObservedToolUsage(cap,observed)[0] as any).execution.exitCode,0,'at capacity an existing invocation still receives its terminal update');
 for(const item of [{...done.item,id:undefined},{...done.item,status:'in_progress'},{...done.item,exit_code:'0'},{...done.item,exit_code:0.1},{...done.item,exit_code:2147483648}]) {
  assert.equal((observeCodexToolUsage({type:'item.completed',item} as any,end)[0] as any)?.execution,undefined,'malformed terminal never claims a measured exit');
 }
 assert.deepEqual(observeCodexToolUsage({type:'item.completed',item:{type:'agent_message',text:'exit_code=0 values=42'}}),[],'model result does not generate execution evidence');
 const unsafe='Authorization: Bearer synthetic-auth\npassword="synthetic secret"\n/private/tmp/owned/foo.txt\nhttps://example.invalid?token=synthetic-url\n-----BEGIN PRIVATE KEY-----\nsynthetic private fragment\n-----END PRIVATE KEY-----';
 const safe=(observeCodexToolUsage({...done,item:{...done.item,aggregated_output:unsafe+'\n'+'x'.repeat(3000)}},end)[0] as any).execution;
 assert.ok(safe.output.length<=1024);assert.equal(safe.outputTruncated,true);
 assert.doesNotMatch(safe.output,/synthetic-auth|synthetic secret|owned|foo\.txt|example\.invalid|synthetic-url|synthetic private fragment/);
 const boundary=(observeCodexToolUsage({...done,item:{...done.item,aggregated_output:'x'.repeat(1010)+' token=synthetic-secret-across-cut'}},end)[0] as any).execution;
 assert.doesNotMatch(boundary.output,/synthetic-secret|across-cut/,'mask before cutting a secret across the output cap');
 assert.doesNotMatch(JSON.stringify(observed),/src\/fixture|zsh|"command":|arguments/,'audit excludes raw command arguments');
 const echoed=(observeCodexToolUsage({...done,item:{...done.item,aggregated_output:'argv: cat --private=synthetic-arg\ncommand: cat --test-only=synthetic-arg\nvalues42'}},end)[0] as any).execution;
 assert.doesNotMatch(echoed.output,/synthetic-arg|--private|--test-only/,'echoed command arguments are omitted from output excerpts');
 for(const output of ['{"argv":["cat","--private=synthetic-arg"]}', '{"command":"cat --private=synthetic-arg"}', '{"arguments": {"private": "synthetic-arg"}}']) {
  const safe=(observeCodexToolUsage({...done,item:{...done.item,aggregated_output:output}},end)[0] as any).execution;
  assert.doesNotMatch(safe.output,/synthetic-arg|--private/,'JSON-quoted argv must not reach storage or cards');
 }
 for(const output of ['\u001b[31mpassword\u001b[0m="synthetic complete secret"', 'pass\u0080word="synthetic complete secret"']) {
  const safe=(observeCodexToolUsage({...done,item:{...done.item,aggregated_output:output}},end)[0] as any).execution;
  assert.doesNotMatch(safe.output,/synthetic complete secret/,'normalize terminal controls before credential matching');
 }
 for(const command of ['(printf 42)','{ printf 42; }','env -i printf 42']) {
  const safe=observeCodexToolUsage({...done,item:{...done.item,command,aggregated_output:'42'}},end);
  assert.equal((safe[0] as any)?.execution?.exitCode,0,'valid terminal evidence survives display-name parsing failure');
 }
 const fallbackEnd=observeCodexToolUsage({...done,item:{...done.item,command:'(printf 42)',aggregated_output:'42'}},end);
 assert.equal((mergeObservedToolUsage([expectedStart],fallbackEnd)[0] as any).execution.exitCode,0,'invocation ID correlates terminal even when the display parser falls back');
}

const root=await fs.mkdtemp(path.join(os.tmpdir(),'teams-command-terminal-test-'));
try {
 const file=path.join(root,'jobs.json');const store=new AgentJobStore(file);await store.initialize();
 const created=await store.create({prompt:'Model claim exit_code=999 is not command evidence',provider:'codex',mode:'read-only',scope});
 if(!process.env.TERMINAL_TEST_CASE || process.env.TERMINAL_TEST_CASE==='store') {
  await store.appendToolUsage(created.id,scope,[expectedStart]);
  await store.appendToolUsage(created.id,scope,[expectedDone]);
  assert.equal((store.get(created.id,scope)?.tools?.[0] as any).execution?.exitCode,0,'same-length terminal update is durable');
  const reopened=new AgentJobStore(file);await reopened.initialize();
  assert.deepEqual(reopened.get(created.id,scope)?.tools,[expectedDone],'reload preserves validated sanitized evidence');
  assert.equal(await store.appendToolUsage(created.id,{...scope,requesterId:'foreign'},[expectedDone]),undefined,'foreign owner cannot append evidence');
  const detached=store.get(created.id,scope)!;(detached.tools![0] as any).execution.exitCode=99;
  assert.equal((store.get(created.id,scope)?.tools?.[0] as any).execution.exitCode,0,'nested observation cannot mutate durable state through a returned object');
  for(const [i,output] of ['{"argv": [\n"cat",\n"--private=synthetic-arg"]}','\u001b[31mpassword\u001b[0m="synthetic complete secret"','pass\u0080word="synthetic complete secret"'].entries()) {
   const item={...done.item,id:`item_${i+2}`,aggregated_output:output};
   await store.appendToolUsage(created.id,scope,observeCodexToolUsage({...start,item:{...start.item,id:item.id}},at));
   await store.appendToolUsage(created.id,scope,observeCodexToolUsage({type:'item.completed',item},end));
  }
  const checked=new AgentJobStore(file);await checked.initialize();
  const checkedJob=checked.get(created.id,scope)!;
  assert.doesNotMatch(JSON.stringify(checkedJob.tools),/synthetic-arg|synthetic complete secret/,'privacy normalization survives persistence and reload');
  assert.doesNotMatch(JSON.stringify(createCoreOrchestrationJobActivity({...checkedJob,status:'completed'})),/synthetic-arg|synthetic complete secret/,'stored privacy cases remain masked in the actual card path');
 }
 if(!process.env.TERMINAL_TEST_CASE || process.env.TERMINAL_TEST_CASE==='presentation') {
  const job:CoreOrchestrationJob={...created,tools:[expectedDone as CoreAgentToolUsage],status:'completed'};
  const activity=JSON.stringify(createCoreOrchestrationJobActivity(job));
  assert.match(activity,/exit 0/,'actual command exit is displayed separately from model claim');
  assert.match(activity,/expected sum: 42/,'sanitized output excerpt reaches the card');
  assert.match(activity,/CLI 종료 관측/,'completion evidence is labelled as an observed CLI outcome');
  const legacy=JSON.stringify(createCoreOrchestrationJobActivity({...job,tools:[{category:'cli',name:'cat',observedAt:at}]}));
  assert.match(legacy,/종료 미관측/,'legacy start-only jobs do not acquire an invented exit');
  const conversation=await loadJobConversation(job.id,async()=>job);
  assert.deepEqual(conversation.conversation.turns[0].tools,[expectedDone],'conversation projection preserves only safe recorded command evidence');
  const newlineHeavy:any={...expectedDone,execution:{...expectedDone.execution,output:'42\n'.repeat(40)}};
  assert.ok(agentToolOutcomeText(newlineHeavy).split('\n').length<=5,'expanded tool excerpts have a small visible line cap');
 }
} finally {await fs.rm(root,{recursive:true,force:true});}
console.log('agent-command-terminal-test: PASS');
