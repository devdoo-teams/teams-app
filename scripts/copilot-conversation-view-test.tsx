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
  const imageState={...state,conversation:{...conversation,turns:[{...conversation.turns[0],response:'합성 설명\n![SDK 합성 이미지](/assets/wide.png)\n결과'}]}};
  const imageHtml=render(<CopilotConversationTranscript state={imageState} input="" setInput={()=>{}} send={()=>{sends++;}} />);
  assert.match(imageHtml,/<img[^>]+src="\/assets\/wide.png"/,'installed SDK uses the shared safe image renderer');
  assert.equal(sends,0,'image rendering never submits a job');
  const blocked=render(<CopilotConversationTranscript state={{jobId:job.id,phase:'blocked',uncertain:false,error:'SYNTHETIC_FORBIDDEN'}} input="" setInput={()=>{}} send={()=>{sends++;}} />);
  assert.match(blocked,/SYNTHETIC_FORBIDDEN/);assert.doesNotMatch(blocked,/SYNTHETIC_USER_REQUEST|SYNTHETIC_ASSISTANT_RESPONSE/);
  assert.match(blocked,/<textarea[^>]+disabled/);
  for (const status of ['queued', 'running', 'awaiting_approval', 'failed', 'cancelled'] as const) {
    const statusHtml=render(<CopilotConversationTranscript state={{...state,job:{...job,status}}} input="" setInput={()=>{}} send={()=>{sends++;}} />);
    assert.match(statusHtml,/role="status"/,`the current ${status} state has an accessible status`);
    if(status==='queued'||status==='running') assert.match(statusHtml,/aria-label="작업 중지"/,'installed SDK exposes Stop for an active Core job');
    if(status==='awaiting_approval') assert.match(statusHtml,/승인/);
  }
  const staleHtml=render(<CopilotConversationTranscript state={{...state,phase:'blocked',stale:true,recovery:'network',error:'Synthetic offline'}} input="" setInput={()=>{}} send={()=>{sends++;}} />);
  assert.match(staleHtml,/마지막으로 확인한/,'saved transcript is explicitly stale during an outage');
  assert.match(staleHtml,/SYNTHETIC_ASSISTANT_RESPONSE/);
  const unknownHtml=render(<CopilotConversationTranscript state={{...state,uncertain:true,submittedPrompt:'Synthetic unknown delivery'}} input="" setInput={()=>{}} send={()=>{sends++;}} />);
  assert.match(unknownHtml,/다시 보내지/,'GET replay keeps uncertain-delivery warning visible');
  const confirmHtml=render(<CopilotConversationTranscript state={{...state,job:{...job,status:'running'}}} input="" setInput={()=>{}}
    send={()=>{sends++;}} stop={()=>{}} confirmingStop={true} confirmStop={()=>{}} dismissStop={()=>{}} />);
  assert.match(confirmHtml,/중지 확인/);assert.match(confirmHtml,/계속 실행/,'Stop is confirmed inside the WebView');
  const pageHtml=render(<CopilotConversationTranscript state={{...state,conversation:{...conversation,complete:false,
    unavailableReason:'turn-limit',earlierBeforeJobId:job.id}}} input="" setInput={()=>{}} send={()=>{sends++;}} loadEarlier={()=>{}} />);
  assert.match(pageHtml,/이전 대화 더 보기/,'actual SDK surface exposes deliberate earlier-page reads');
  const longHtml=render(<CopilotConversationTranscript state={{...state,conversation:{...conversation,turns:Array.from({length:125},(_,i)=>({
    ...conversation.turns[0],jobId:`synthetic-long-sdk-${i}`,request:`Synthetic older request ${i}`,response:`Synthetic older response ${i}`,
  }))}}} input="" setInput={()=>{}} send={()=>{sends++;}} />);
  assert.match(longHtml,/role="log"[^>]+aria-label="대화 이력"/,'100+ transcript uses accessible chronological SDK message layout');
  assert.equal((longHtml.match(/data-message-id="synthetic-long-sdk-/g)??[]).length,250,'every explicitly loaded SDK turn stays represented once');
  assert.deepEqual(projectCopilotConversationMessages().length,0);
  const workspace=renderToStaticMarkup(<CopilotConversationWorkspace />);
  assert.match(workspace,/기존 대화 선택/);assert.doesNotMatch(workspace,/작업 ID가 없습니다/);
  console.log('PASS: installed real CopilotKit renders user/assistant/controlled composer; blocked state clears transcript and top entry offers owner job selection');
} finally { hooks.deregister(); }
