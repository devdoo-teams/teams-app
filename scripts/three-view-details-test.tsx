import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createExecutionPresentation } from '../src/shared/execution-presentation.js';
import { ExecutionPresentationCard } from '../src/client/ExecutionPresentationCard.js';
import { createExecutionPresentationActivity } from '../src/server/execution-presentation-activity.js';
import { createCoreOrchestrationJobActivity } from '../src/server/genui-response.js';
import { buildTeamsPersonalTabDeepLink } from '../src/server/teams-tab-link.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
const job: CoreOrchestrationJob = {id:'synthetic-detail-job',provider:'codex',prompt:'Synthetic request',mode:'read-only',status:'failed',error:'SYNTHETIC_FAILURE',progress:['SYNTHETIC_STEP'],createdAt:'2026-10-10T00:00:00.000Z',model:'SYNTHETIC_SELECTED_MODEL',tools:[{name:'SYNTHETIC_TOOL',category:'cli',observedAt:'2026-10-10T00:00:00.000Z'}]};
const presentation=createExecutionPresentation(job);
const hidden=renderToStaticMarkup(<ExecutionPresentationCard presentation={presentation} details={[]} />);
assert.ok(hidden.includes('SYNTHETIC_FAILURE'),'failure remains when all details are hidden');
assert.ok(!hidden.includes('SYNTHETIC_TOOL'),'unchecked tool details must be omitted');
assert.ok(!hidden.includes('SYNTHETIC_SELECTED_MODEL'),'unchecked diagnostic details must be omitted');
assert.ok(!hidden.includes('SYNTHETIC_STEP'),'unchecked step details must be omitted');
const selected=renderToStaticMarkup(<ExecutionPresentationCard presentation={presentation} details={['tool']} />);
assert.ok(selected.includes('SYNTHETIC_TOOL'));assert.ok(!selected.includes('SYNTHETIC_SELECTED_MODEL'));
for(const mode of ['text','summary'] as const){
 const card=createExecutionPresentationActivity(job,mode,{richEnabled:true,details:['tool']}).attachments?.[0]?.content as any;
 assert.ok(card,'Teams progressive disclosure requires a supported Adaptive Card');
 assert.equal(card.version,'1.6');
 const expanded=card.actions.find((a:any)=>a.type==='Action.ShowCard');assert.ok(expanded,'chat/card detail must expand without a new job');
 assert.ok(JSON.stringify(expanded).includes('SYNTHETIC_TOOL'));
 assert.ok(!JSON.stringify(expanded).includes('SYNTHETIC_SELECTED_MODEL'));
 assert.ok(JSON.stringify(card.body).includes('SYNTHETIC_FAILURE'));
}
// Every detail combination retains mandatory state and the original Core actions.
for (const status of ['failed','awaiting_approval','cancelled','input_required'] as const) {
  for (let mask=0; mask<8; mask++) {
    const details=(['tool','steps','diagnostics'] as const).filter((_,i)=>Boolean(mask&(1<<i)));
    const variant={...job,status,pendingOperation:status==='awaiting_approval'?{kind:'job-approval' as const,jobId:job.id,revision:'a'.repeat(64)}:undefined};
    const card=createExecutionPresentationActivity(variant,'summary',{richEnabled:true,details}).attachments?.[0]?.content as any;
    assert.ok(JSON.stringify(card.body).includes(status));
    assert.ok(JSON.stringify(card.body).includes('SYNTHETIC_FAILURE'));
    const base=createCoreOrchestrationJobActivity(variant,{richEnabled:true}).attachments?.[0]?.content as any;
    assert.deepEqual(card.actions.slice(1),base.actions??[],'display disclosure preserves original execution controls/payloads');
  }
}
const huge={...job,prompt:'界'.repeat(2000),result:'界'.repeat(4000),error:'界'.repeat(2000),progress:Array(8).fill('界'.repeat(300)),
  tools:Array.from({length:16},(_,i)=>({name:'界'.repeat(100),category:'cli' as const,outcome:'界'.repeat(500),observedAt:'2026-10-10T00:00:00.000Z'}))};
for(const mode of ['text','summary','rich'] as const){
 const activity=createExecutionPresentationActivity(huge,mode,{richEnabled:true,openTabUrl:buildTeamsPersonalTabDeepLink({catalogAppId:'9b20fd94-2ac9-4423-ac1f-ff528ab245c1',tabDomain:'synthetic.example.com'})});
 assert.ok(Buffer.byteLength(JSON.stringify(activity))<28000,'UTF-8 activity fits the Teams delivery bound');
}
const longMarkup=renderToStaticMarkup(<ExecutionPresentationCard presentation={createExecutionPresentation(huge)} details={[]} />);
assert.match(longMarkup,/<details><summary>전체 결과 보기/,'long result is collapsed separately from diagnostic/tool preferences');
console.log('PASS: real card projection follows each detail selection and retains mandatory failed state; Teams ShowCard unfolds existing evidence');
