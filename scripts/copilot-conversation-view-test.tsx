import assert from 'node:assert/strict';
import React from 'react';
import { registerHooks } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('.css')) return { format:'module',shortCircuit:true,url:'data:text/javascript,export default {}' };
  return next(specifier,context);
} });
try {
  const { CopilotKit } = await import('@copilotkit/react-core/v2');
  const { CopilotConversationTranscript, projectCopilotConversationMessages } = await import('../src/client/CopilotConversation.js');
  const { CopilotConversationWorkspace } = await import('../src/client/CopilotConversationWorkspace.js');
  const job = {id:'synthetic-sdk-conversation',provider:'codex' as const,mode:'read-only' as const,status:'completed' as const,
    prompt:'SYNTHETIC_USER_REQUEST',result:'SYNTHETIC_ASSISTANT_RESPONSE',progress:[],createdAt:'2026-10-10T00:00:00.000Z'};
  const conversation={selectedJobId:job.id,complete:true,turns:[{jobId:job.id,request:job.prompt,response:job.result,status:job.status,
    progress:[],tools:[],createdAt:job.createdAt,truncated:false}]};
  const state={jobId:job.id,phase:'ready' as const,job,conversation,uncertain:false};
  let sends=0;
  const render=(value:React.ReactNode)=>renderToStaticMarkup(<CopilotKit runtimeUrl="/api/copilot-ui" agent="execution-projection"
    enableInspector={false} showDevConsole={false}>{value}</CopilotKit>);
  const html=render(<CopilotConversationTranscript state={state} input="SYNTHETIC_DRAFT" setInput={()=>{}} send={()=>{sends++;}} />);
  assert.match(html,/SYNTHETIC_USER_REQUEST/,'actual SDK user message is visible');
  assert.match(html,/SYNTHETIC_ASSISTANT_RESPONSE/,'actual SDK assistant message is visible');
  assert.match(html,/<textarea[^>]+aria-label="같은 대화의 후속 요청"/);
  assert.match(html,/SYNTHETIC_DRAFT/);assert.match(html,/후속 요청 보내기/);
  assert.equal(sends,0,'rendering SDK conversation never submits a job');
  const blocked=render(<CopilotConversationTranscript state={{jobId:job.id,phase:'blocked',uncertain:false,error:'SYNTHETIC_FORBIDDEN'}} input="" setInput={()=>{}} send={()=>{sends++;}} />);
  assert.match(blocked,/SYNTHETIC_FORBIDDEN/);assert.doesNotMatch(blocked,/SYNTHETIC_USER_REQUEST|SYNTHETIC_ASSISTANT_RESPONSE/);
  assert.match(blocked,/<textarea[^>]+disabled/);
  assert.deepEqual(projectCopilotConversationMessages().length,0);
  const workspace=renderToStaticMarkup(<CopilotConversationWorkspace />);
  assert.match(workspace,/기존 대화 선택/);assert.doesNotMatch(workspace,/작업 ID가 없습니다/);
  console.log('PASS: installed real CopilotKit renders user/assistant/controlled composer; blocked state clears transcript and top entry offers owner job selection');
} finally { hooks.deregister(); }
