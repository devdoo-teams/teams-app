import assert from 'node:assert/strict';
import React from 'react';
import { registerHooks } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCoreConversationController } from '../src/client/copilot-conversation-controller.js';
import { createCoreOrchestrationClient } from '../src/client/core-orchestration-client.js';

const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier.endsWith('.css'))return {format:'module',shortCircuit:true,url:'data:text/javascript,export default {}'};
  return next(specifier,context);
}});
try {
  const { CopilotChatInput }=await import('@copilotkit/react-core/v2');
  const job={id:'synthetic-sdk-stop',provider:'codex' as const,mode:'read-only' as const,status:'running' as const,
    prompt:'Synthetic request',progress:[],createdAt:'2026-10-10T00:00:00Z'};
  const requests:Array<{url:string;init:RequestInit}>=[];
  const client=createCoreOrchestrationClient(async(input,init={})=>{
    const url=String(input);requests.push({url,init});
    return Response.json({job:init.method==='POST'?{...job,status:'cancelled'}:job});
  });
  const controller=createCoreConversationController({client,jobId:job.id,onChange:()=>{}});
  try {
    await controller.load();let click:(()=>void)|undefined;let confirming=false;let flight:Promise<unknown>|undefined;let sends=0;
    const Button=(props:any)=>{click=props.onClick;return <button disabled={props.disabled}>Synthetic Stop</button>;};
    renderToStaticMarkup(<CopilotChatInput value="" onChange={()=>{}} isRunning={true} mode="input"
      onStop={()=>{confirming=true;}} onSubmitMessage={()=>{sends++;}} sendButton={Button} />);
    assert.ok(click);click();assert.equal(confirming,true);
    assert.equal(requests.filter(value=>value.init.method==='POST').length,0,'SDK Stop first asks for in-app confirmation');
    assert.equal(sends,0,'SDK Stop does not invoke send or projection execution');
    assert.equal(typeof (controller as any).stop,'function');
    // The explicit second click invokes the existing owner-only Core mutation.
    const confirm=()=>{flight=(controller as any).stop();};confirm();await flight;
    const mutations=requests.filter(value=>value.init.method==='POST');assert.equal(mutations.length,1);
    assert.equal(mutations[0].url,`/api/core-orchestration/jobs/${job.id}/cancel`);
    assert.equal(mutations[0].init.body,'{}','no caller-supplied owner, thread, provider or mode');
    assert.equal(controller.getState().job?.status,'cancelled');
    assert.equal(await (controller as any).stop(),'invalid');
    assert.equal(requests.filter(value=>value.init.method==='POST').length,1);
    console.log('PASS: installed SDK Stop requires confirmation and cancels only through the existing owner Core API');
  } finally {controller.dispose();}
} finally {hooks.deregister();}
