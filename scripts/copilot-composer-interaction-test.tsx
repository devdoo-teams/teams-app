import assert from 'node:assert/strict';
import React from 'react';
import { registerHooks } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCoreConversationController, submitCoreConversation } from '../src/client/copilot-conversation-controller.js';
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('.css')) return { format: 'module', shortCircuit: true, url: 'data:text/javascript,export default {}' };
  return next(specifier, context);
} });
try {
  const { CopilotChatInput, CopilotKit } = await import('@copilotkit/react-core/v2');
  const { CopilotConversationTranscript } = await import('../src/client/CopilotConversation.js');
  const job = { id: 'synthetic-composer', provider: 'codex' as const, mode: 'read-only' as const,
    status: 'completed' as const, prompt: 'Synthetic previous request', result: 'Synthetic response', progress: [], createdAt: '2026-10-10T00:00:00Z' };
  for (const status of [400, 403, 'transport', 'timeout', 'success', 'disposed'] as const) {
    let state: any; let input = 'SYNTHETIC_REJECTED_DRAFT'; let flight: Promise<void> | undefined;
    let calls = 0;
    const controller = createCoreConversationController({ jobId: job.id, timeoutMs: 15, onChange: value => { state = value; }, client: {
      getJob: async () => job,
      continueJob: async () => {
        calls++;
        if (status === 'success') return { job: { ...job, id: 'synthetic-composer-child', parentJobId: job.id, status: 'queued' as const } };
        if (status === 'transport') throw new TypeError('Synthetic transport failure');
        if (status === 'timeout' || status === 'disposed') return new Promise<never>(() => {});
        throw Object.assign(new Error('Synthetic rejection'), { status });
      },
    } });
    await controller.load();
    let click: (() => void) | undefined;
    // Capture the installed SDK's public button slot, then invoke its real send
    // handler. This is an event/SSR fixture, not a browser or visual review.
    const Button = (props: any) => { click = props.onClick; return <button disabled={props.disabled}>Synthetic send</button>; };
    renderToStaticMarkup(<CopilotChatInput value={input} onChange={value => { input = value; }} mode="input" isRunning={false}
      onSubmitMessage={value => { flight = submitCoreConversation(controller, value, { setInput: value => { input = value; }, setValidation: () => {}, isCurrent: () => true }); }}
      sendButton={Button} />);
    assert.ok(click); click(); if (status === 'disposed') controller.dispose(); await flight;
    assert.equal(calls, 1, 'installed SDK submit triggers one continuation only');
    if (typeof status === 'number') {
      assert.equal(input, 'SYNTHETIC_REJECTED_DRAFT', `SDK composer preserves a confirmed ${status} rejection`);
      assert.equal(state.conversation, undefined, 'owner-scoped history remains cleared on failure');
    } else {
      assert.equal(input, '', 'acknowledged, uncertain or disposed submission never restores a sendable draft');
      if (status === 'transport' || status === 'timeout') {
        assert.equal(state.uncertain, true);
        const html = renderToStaticMarkup(<CopilotKit runtimeUrl="/api/copilot-ui" agent="execution-projection" enableInspector={false} showDevConsole={false}>
          <CopilotConversationTranscript state={state} input={input} setInput={() => {}} send={() => { throw new Error('No replay'); }} />
        </CopilotKit>);
        assert.match(html, /전송 결과 확인이 필요한 요청/); assert.match(html, /SYNTHETIC_REJECTED_DRAFT/);
        await controller.load(); assert.equal(controller.getState().submittedPrompt, 'SYNTHETIC_REJECTED_DRAFT');
        assert.equal(await controller.send('No replay'), 'invalid'); assert.equal(calls, 1);
      }
    }
    controller.dispose();
  }
  console.log('PASS: installed SDK composer submission retains confirmed-rejected draft without executing or replaying another job');
} finally { hooks.deregister(); }
