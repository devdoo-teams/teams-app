import assert from 'node:assert/strict';
import * as teamsSdk from '@microsoft/teams-js';
import * as settings from '../src/client/ExecutionPresentationSettings.js';

const jobId = 'synthetic-dialog-job:7';
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const navigations: string[] = [];
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  location: { origin: 'https://synthetic.example.test', assign: (url: string) => navigations.push(url) },
} });
const launch = (requested = jobId) => {
  const restored: string[] = [];
  let handler: teamsSdk.dialog.DialogSubmitHandler | undefined;
  let information: teamsSdk.UrlDialogInfo | undefined;
  settings.openCopilotConversation('dialog', requested, value => restored.push(value), {
    isSupported: () => true,
    open: (info, submitHandler) => { information = info; handler = submitHandler; },
  });
  assert.equal(typeof handler, 'function', 'the actual settings launcher must wire the installed SDK single-response submit handler');
  assert.equal(new URL(information!.url).origin, 'https://synthetic.example.test');
  assert.equal(new URL(information!.url).pathname, '/tabs/copilot-ui/');
  assert.equal(new URL(information!.url).searchParams.get('jobId'), requested);
  return { restored, handler: handler! };
};

try {
  for (const result of [{ jobId }, JSON.stringify({ jobId })]) {
    const { restored, handler } = launch();
    handler({ result });
    assert.deepEqual(restored, [jobId], 'object or serialized SDK results restore only the original requested job');
    handler({ result });
    assert.deepEqual(restored, [jobId], 'duplicate host callbacks do not restore focus twice');
  }
  const responses: unknown[] = [undefined, null, [], true, { result: undefined }, { jobId },
    { err: 'User canceled or closed the dialog.', result: { jobId } }, { err: true, result: { jobId } },
    { result: 'bad JSON' }, { result: 'x'.repeat(513) }, { result: jobId }, { result: {} }, { result: [jobId] },
    { tenantId: 'foreign-tenant', result: { jobId } },
    { result: { jobId: 'synthetic-other-job' } }, { result: { jobId: '../foreign' } },
    { result: { jobId, tenantId: 'foreign-tenant' } }, { result: { jobId, requesterId: 'foreign-user' } },
    { result: { jobId, mode: 'workspace-write' } }, { result: JSON.stringify({ jobId, conversationId: 'foreign-conversation' }) },
  ];
  for (const response of responses) {
    const { restored, handler } = launch();
    handler(response as teamsSdk.dialog.ISdkResponse);
    assert.deepEqual(restored, [], 'cancelled, malformed, different-job, or scope-bearing results cannot restore selection');
    handler({ result: { jobId } });
    assert.deepEqual(restored, [], 'a closed or rejected dialog cannot later revive its callback');
  }
  for (const err of [undefined, null, '']) {
    const { restored, handler } = launch();
    handler({ err, result: { jobId } } as teamsSdk.dialog.ISdkResponse);
    assert.deepEqual(restored, [jobId], 'installed runtime and documented no-error response shapes are accepted');
  }
  const withoutRequest: string[] = [];
  let noRequestHandler: teamsSdk.dialog.DialogSubmitHandler | undefined;
  settings.openCopilotConversation('dialog', undefined, value => withoutRequest.push(value), {
    isSupported: () => true, open: (_info, handler) => { noRequestHandler = handler; },
  });
  assert.equal(typeof noRequestHandler, 'function');
  noRequestHandler!({ result: { jobId } });
  assert.deepEqual(withoutRequest, [], 'a generic toolbar dialog has no requested job authority to restore');

  const focus = (settings as Record<string, unknown>).restorePersonalJobFocus as
    (id: string, root: unknown) => boolean;
  assert.equal(typeof focus, 'function');
  const focusCalls: unknown[] = [];
  let selectedValue = jobId;
  const root = {
    querySelector: (selector: string) => {
      assert.equal(selector, '[aria-label="표시할 개인 작업"]'); return { value: selectedValue };
    },
    getElementById: (id: string) => {
      assert.equal(id, 'orchestration-job-detail'); return { focus: (options: unknown) => focusCalls.push(options) };
    },
  };
  assert.equal(focus(jobId, root), true);
  assert.deepEqual(focusCalls, [{ preventScroll: true }], 'return focuses the existing detail without changing its reading position');
  assert.equal(selectedValue, jobId, 'focus restoration preserves the existing owner-confirmed selection');
  selectedValue = 'synthetic-new-selection';
  assert.equal(focus(jobId, root), false);
  assert.equal(focusCalls.length, 1, 'a changed parent selection cannot be overwritten by an old dialog');
  assert.equal(focus('../invalid', root), false);

  let dialogOpens = 0;
  const launcher = { isSupported: () => false, open: () => { dialogOpens++; } };
  assert.throws(() => settings.openCopilotConversation('dialog', jobId, undefined, launcher), /Dialog/);
  assert.equal(dialogOpens, 0, 'unsupported hosts do not open a new surface');
  assert.throws(() => settings.openCopilotConversation('dialog', '../invalid', undefined, launcher));
  settings.openCopilotConversation('tab', jobId, undefined, launcher);
  assert.equal(new URL(navigations.at(-1)!).searchParams.get('jobId'), jobId);
  assert.equal(dialogOpens, 0, 'tab navigation remains an explicit same-origin view operation');
  console.log('PASS: actual Teams dialog launcher restores only its same requested job through the SDK single-response callback; cancellation, duplicate, stale selection, and scope injection stay closed');
} finally {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
}
