import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [file, playwrightRoot, evidenceDirectory, executablePath] = process.argv.slice(2);
assert.ok(file && playwrightRoot && evidenceDirectory && executablePath,
  'Usage: work-output-pty-browser-test.mjs /fixture/index.html /existing/playwright /evidence /existing/chrome');
const fixture = JSON.parse(await fs.readFile(path.join(path.dirname(file), 'fixture-receipt.json'), 'utf8'));
assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'), fixture.htmlSha256);
const { chromium } = await import(pathToFileURL(path.join(playwrightRoot, 'index.mjs')).href);
const receipt = { startedAt: new Date().toISOString(), fixture, headless: true, foregroundManipulated: false, actualTeamsHost: false,
  errors: [], dialogs: [], network: [], checks: [], screenshots: [], result: 'RUNNING' };
await fs.mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
let browser; let context;
try {
  browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, timeout: 20000,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (/^https?:|^wss?:/i.test(route.request().url())) { receipt.network.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => receipt.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') receipt.errors.push(message.text()); });
  page.on('dialog', dialog => receipt.dialogs.push(dialog.message()));
  const first = () => page.locator('[data-output-monitor-slot="0"]');
  const observation = () => first().getByRole('complementary', { name: '첫 패널 PTY 관찰' });
  const output = () => observation().getByRole('region', { name: '마스킹된 PTY 출력', exact: true });
  const capture = async name => {
    const target = path.join(evidenceDirectory, name + '.png'); const capturedAt = new Date().toISOString();
    await page.screenshot({ path: target, fullPage: true, timeout: 10000 });
    receipt.screenshots.push({ path: target, capturedAt, viewport: page.viewportSize(),
      sha256: createHash('sha256').update(await fs.readFile(target)).digest('hex'), reviewedAt: null, reviewer: null, result: 'UNREVIEWED' });
  };
  const load = async () => { await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 10000 }); await first().getByText('CORE_SAVED_RESULT', { exact: false }).waitFor(); };
  const open = () => observation().getByRole('button', { name: '기존 PTY 관찰 보기', exact: true });
  const coreUnchanged = async () => {
    assert.equal(await first().locator('[data-job-status="running"]').count(), 1);
    assert.match(await first().locator('.output-monitor-output').innerText(), /CORE_SAVED_RESULT/);
    assert.doesNotMatch(await first().locator('.output-monitor-output').innerText(), /FAKE_STDERR_COMPLETE|999999/);
    assert.equal(await page.evaluate(() => window.__hubPtyAudit.sourceExecutions + window.__hubPtyAudit.mutations), 0);
  };
  await load(); assert.equal(await page.evaluate(() => window.__hubPtyAudit.descriptions.length), 0, 'mount cannot discover or start a session');
  await open().evaluate(button => { button.click(); button.click(); }); await output().waitFor();
  assert.match(await output().innerText(), /FAKE_STDOUT_COMPLETE/); assert.match(await output().innerText(), /FAKE_STDERR_COMPLETE/);
  assert.equal(await page.evaluate(() => window.__hubPtyAudit.descriptions.length), 1);
  assert.equal(await page.locator('[aria-label="첫 패널 PTY 관찰"]').count(), 1);
  await coreUnchanged(); receipt.checks.push('one injected PTY view shares the first real monitor slot without changing Core result/status'); await capture('01-core-and-pty');
  await observation().getByRole('button', { name: '조회 연결 끊기', exact: true }).click();
  await page.getByRole('button', { name: '다음 저장 프레임', exact: true }).click();
  await observation().getByRole('button', { name: '같은 세션 재접속', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-pty-output]')?.textContent?.includes('SAME_SESSION_CONTINUED'));
  const audit = await page.evaluate(() => structuredClone(window.__hubPtyAudit));
  assert.equal(audit.descriptions.length, 1); assert(audit.reads[1].after > 0);
  await output().evaluate(element => { element.scrollTop = element.scrollHeight; }); await coreUnchanged(); await capture('02-same-session-reconnect');
  await observation().getByRole('button', { name: '출력 보기 닫기', exact: true }).click();
  assert.equal(await output().count(), 0); assert.match(await observation().innerText(), /작업은 계속됩니다/); await coreUnchanged(); await capture('03-observer-closed');
  await open().click(); await output().waitFor(); await page.setViewportSize({ width: 390, height: 844 });
  const widths = await first().evaluate(element => ({ elementWidth: element.clientWidth, elementScroll: element.scrollWidth,
    documentWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert(widths.documentWidth <= widths.viewport + 1); assert(widths.elementScroll <= widths.elementWidth + 1);
  await output().evaluate(element => { element.scrollTop = element.scrollHeight; }); await coreUnchanged(); await capture('04-mobile-core-and-pty');
  await first().getByRole('combobox', { name: '패널 1 작업', exact: true }).selectOption('task-no-pty-session'); await open().click();
  await observation().getByText('기존 PTY 세션을 확인할 수 없습니다.', { exact: false }).waitFor(); assert.equal(await output().count(), 0);
  assert.match(await first().locator('.output-monitor-output').innerText(), /NO_SESSION_CORE_RESULT/); await capture('05-no-session');
  await page.getByRole('button', { name: '인증 세대 변경', exact: true }).click();
  await page.getByRole('alert').waitFor(); assert.equal(await page.locator('[data-output-monitor-slot]').count(), 0); assert.equal(await page.locator('[data-pty-output]').count(), 0); await capture('06-access-cleared');
  await load(); await page.getByRole('button', { name: '메타데이터 지연', exact: true }).click(); await open().click();
  await page.waitForFunction(() => window.__hubPtyAudit.descriptions.length === 1);
  await first().getByRole('combobox', { name: '패널 1 작업', exact: true }).selectOption('task-no-pty-session');
  await page.getByRole('button', { name: '늦은 응답 전달', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__hubPtyAudit.metadataAborts), 1);
  assert.equal(await output().count(), 0); assert.equal(await page.evaluate(() => window.__hubPtyAudit.reads.length), 0);
  receipt.checks.push('reconnect/close/no-session/selection/parent-generation transitions create no execution and suppress late metadata');
  assert.equal(receipt.errors.length, 0); assert.equal(receipt.dialogs.length, 0); assert.equal(receipt.network.length, 0);
  receipt.result = 'PASS';
} catch (error) { receipt.result = 'FAIL'; receipt.failure = { name: error.name, message: error.message }; throw error; }
finally {
  await context?.close(); await browser?.close(); receipt.completedAt = new Date().toISOString();
  await fs.writeFile(path.join(evidenceDirectory, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ result: receipt.result, screenshots: receipt.screenshots.length, failure: receipt.failure, errors: receipt.errors, dialogs: receipt.dialogs }));
}
