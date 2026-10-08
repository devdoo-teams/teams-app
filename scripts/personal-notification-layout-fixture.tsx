import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OrchestrationPanelView } from '../src/client/OrchestrationPanel.js';
import '../src/client/styles.css';

// Synthetic, network-free rendering of the real view; never a Teams runtime receipt.
function Fixture() {
  const [notifyPersonal, setNotifyPersonal] = useState(true);
  const [changes, setChanges] = useState(0);
  const [submits, setSubmits] = useState(0);
  const query = new URLSearchParams(location.search);
  const width = Number(query.get('width') ?? 760);
  const zoom = Number(query.get('zoom') ?? 1);
  const disabled = query.get('disabled') === 'true';
  const noop = () => undefined;
  return <main className="shell" style={{ width, maxWidth: '100%', zoom }}>
    <h1>MP-349 synthetic layout regression</h1>
    <OrchestrationPanelView
      phase={disabled ? 'loading' : 'ready'} jobs={[]} pendingJobs={[]} selectedJob={null}
      providers={[{ provider: 'codex', availability: 'available', capabilities: ['submit'],
        observedAt: '2026-10-08T00:00:00.000Z', source: 'runtime-probe' }]}
      providerId="codex" mode="read-only" prompt="" modelId="" reasoningEffort=""
      inputValue="" busyAction="" error="" notice="" validationError="" mobile={false}
      notifyPersonal={notifyPersonal}
      onNotifyPersonalChange={value => { setNotifyPersonal(value); setChanges(count => count + 1); }}
      onPromptChange={noop} onProviderChange={noop} onModeChange={noop} onModelChange={noop}
      onReasoningEffortChange={noop} onInputChange={noop} onSelectTask={noop}
      onCancel={noop} onApprove={noop} onProvideInput={noop} onRetryTask={noop} onReload={noop}
      onSubmit={() => setSubmits(count => count + 1)}
    />
    <output id="fixture-state" data-checked={notifyPersonal} data-changes={changes} data-submits={submits}>
      checked={String(notifyPersonal)}; changes={changes}; submits={submits}
    </output>
  </main>;
}

// Assert geometry and native semantics, independent of CSS class names or layout technique.
Object.assign(window, { measureNotificationLayout: () => {
  const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const label = checkbox.labels?.[0];
  if (!label) throw new Error('Checkbox has no native associated label');
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  let text: Node | null;
  do { text = walker.nextNode(); } while (text && !text.textContent?.trim());
  if (!text) throw new Error('Associated label has no visible text');
  const range = document.createRange();
  range.selectNodeContents(text);
  const firstText = Array.from(range.getClientRects()).find(rect => rect.width > 0)!;
  const control = checkbox.getBoundingClientRect();
  const option = label.getBoundingClientRect();
  const scale = Number(new URLSearchParams(location.search).get('zoom') ?? 1);
  const errors: string[] = [];
  if (control.width > 24 * scale) errors.push('Checkbox stretches wider than a native control');
  if (firstText.left < control.right || firstText.left - control.right > 16 * scale)
    errors.push('Checkbox is not immediately before its label text');
  if (control.top >= firstText.bottom || control.bottom <= firstText.top)
    errors.push('Checkbox does not align with the first label line');
  if (label.scrollWidth > label.clientWidth + 1) errors.push('Option overflows horizontally');
  if (label.control !== checkbox) errors.push('Native label association was lost');
  const rect = (value: DOMRect) => ({ left: value.left, top: value.top, right: value.right,
    bottom: value.bottom, width: value.width, height: value.height });
  return { result: errors.length ? 'FAIL' : 'PASS', errors, control: rect(control),
    firstText: rect(firstText), option: rect(option), labelText: label.textContent?.trim(),
    checked: checkbox.checked, disabled: checkbox.disabled, focused: document.activeElement === checkbox,
    viewport: { width: innerWidth, height: innerHeight }, requestedWidth: new URLSearchParams(location.search).get('width'),
    scale, fixtureState: { ...document.querySelector<HTMLOutputElement>('#fixture-state')!.dataset } };
} });

createRoot(document.getElementById('root')!).render(<Fixture />);
