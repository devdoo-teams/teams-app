import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit private fixture, existing Playwright package, evidence directory, browser executable.
// This does not attach to a user's browser or run a local/public server.
const [file, playwrightRoot, evidenceDirectory, executablePath] = process.argv.slice(2);
assert.ok(file && playwrightRoot && evidenceDirectory && executablePath,
  'usage: node scripts/pty-output-view-browser-test.mjs /fixture/index.html /existing/playwright /evidence /existing/chrome');
const fixture = JSON.parse(await fs.readFile(path.join(path.dirname(file), 'fixture-receipt.json'), 'utf8'));
assert.equal(path.resolve(file), fixture.file);
assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'), fixture.htmlSha256);
const { chromium } = await import(pathToFileURL(path.join(playwrightRoot, 'index.mjs')).href);
const playwrightVersion = JSON.parse(await fs.readFile(path.join(playwrightRoot, 'package.json'), 'utf8')).version;
const startedAt = new Date().toISOString();
const errors = [];
const networkRequests = [];
const dialogs = [];
const screenshots = [];
const checks = [];
await fs.mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
let browser;
let context;
const receipt = { startedAt, fixture, playwrightVersion, browserVersion: undefined,
  headless: true, nativeForegroundVerified: false, actualTeamsHost: false,
  networkRequests, errors, dialogs, screenshots, checks, result: 'RUNNING' };
try {
  browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, timeout: 20_000,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  receipt.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1280, height: 960 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (/^https?:|^wss?:/i.test(url)) { networkRequests.push(url); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) errors.push({ type: message.type(), text: message.text() }); });
  page.on('pageerror', error => errors.push({ type: 'pageerror', text: error.message }));
  page.on('dialog', dialog => { dialogs.push({ type: dialog.type(), message: dialog.message() }); });
  const capture = async name => {
    const capturedAt = new Date().toISOString();
    const target = path.join(evidenceDirectory, name + '.png');
    await page.screenshot({ path: target, fullPage: true, timeout: 10_000 });
    screenshots.push({ path: target, capturedAt, viewport: page.viewportSize(), reviewedAt: null,
      reviewer: null, nativeForegroundVerified: false, result: 'UNREVIEWED_HEADLESS_PIXELS' });
  };
  const remember = name => checks.push({ name, result: 'PASS', observedAt: new Date().toISOString() });
  const refresh = () => page.getByRole('button', { name: '출력 새로고침', exact: true });
  const output = () => page.getByRole('region', { name: '마스킹된 PTY 출력', exact: true });
  const state = () => page.locator('section').getByRole('status');
  const load = async () => {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 10_000 });
    await refresh().waitFor();
    assert.match(await page.title(), /합성 PTY 출력 보기/);
    assert.equal(page.url(), pathToFileURL(file).href);
    assert.match(await page.locator('body').innerText(), /운영 서버·인증정보·작업과 연결되지 않은/);
  };
  await load();
  await fs.writeFile(path.join(evidenceDirectory, 'initial-accessibility.txt'), await page.locator('body').ariaSnapshot());
  remember('isolated file page identity, nonblank initial state'); await capture('01-initial');
  // Two DOM clicks before React commits the busy state also exercise the reader reservation.
  await refresh().evaluate(element => { element.click(); element.click(); });
  await page.waitForFunction(() => document.querySelector('[data-pty-output]')?.textContent?.includes('token=[REDACTED]'));
  assert.equal(await page.evaluate(() => window.__ptyFixtureAudit.reads.length), 1);
  assert.match(await state().innerText(), /마지막 조회 출력/);
  const firstText = await output().innerText();
  assert.match(firstText, /한글 합성 출력 😀/);
  assert.match(firstText, /<img src=x onerror=/);
  assert.match(firstText, /control output omitted/);
  assert.doesNotMatch(firstText, /synthetic-private-value|c2VjcmV0|\x1b/);
  assert.equal(await output().locator('img,a,script,iframe').count(), 0);
  assert.equal(await page.locator('input,textarea,[contenteditable=true]').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.fixtureCompromised)), false);
  remember('real DOM text rendering, literal HTML, masked controls/secrets and duplicate click reservation');
  await capture('02-desktop-output');
  const firstSize = await output().boundingBox();
  const firstAudit = await page.evaluate(() => structuredClone(window.__ptyFixtureAudit));
  await page.getByRole('button', { name: '40×12', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-pty-output]')?.getAttribute('data-columns') === '40');
  const resized = await output().boundingBox();
  assert.ok(resized.width < firstSize.width && resized.height < firstSize.height);
  assert.deepEqual(await page.evaluate(() => structuredClone(window.__ptyFixtureAudit)), firstAudit);
  assert.equal(await output().innerText(), firstText);
  remember('display resize changes bounds without a read, input, native resize or process request');
  await page.getByRole('button', { name: '조회 연결 끊기', exact: true }).click();
  assert.match(await state().innerText(), /연결이 끊겼습니다/);
  assert.equal(await output().innerText(), firstText);
  await capture('03-disconnected');
  await page.getByText('합성 시험 상태 전환', { exact: true }).click();
  await page.getByRole('button', { name: '합성 출력 추가', exact: true }).click();
  await page.getByRole('button', { name: '같은 세션 재접속', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-pty-output]')?.textContent?.includes('복원-새줄-081'));
  const reconnected = await page.evaluate(() => structuredClone(window.__ptyFixtureAudit.reads));
  assert.equal(reconnected.length, 2); assert.equal(reconnected[1].after, fixture.firstCursor);
  assert.equal(reconnected[1].sessionId, reconnected[0].sessionId);
  assert.equal(reconnected[1].generation, reconnected[0].generation);
  assert.equal((await output().innerText()).split('복원-새줄-081').length, 2);
  await refresh().click(); await page.waitForFunction(() => document.querySelector('section')?.getAttribute('aria-busy') === 'false');
  assert.equal((await output().innerText()).split('복원-새줄-081').length, 2);
  remember('disconnect/reconnect uses the same generation and cursor without duplicated output');
  await output().evaluate(element => { element.scrollTop = element.scrollHeight; });
  await capture('04-reconnected');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await output().evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
    documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, text: element.textContent }));
  assert.ok(mobile.scrollWidth <= mobile.clientWidth + 1);
  assert.ok(mobile.documentWidth <= mobile.viewportWidth + 1);
  assert.match(mobile.text, /한글|이력/);
  remember('390px browser viewport wraps long Korean/emoji lines without horizontal overflow');
  await capture('05-mobile-viewport');
  await page.getByRole('button', { name: '합성 출력 추가', exact: true }).click(); await refresh().click();
  await page.waitForFunction(() => document.querySelector('section')?.textContent?.includes('프로세스 종료 · 코드 7'));
  assert.match(await output().innerText(), /password=\[REDACTED\]/);
  remember('synthetic native-exit snapshot and final partial-line masking remain distinct from connection state');
  await output().evaluate(element => { element.scrollTop = element.scrollHeight; });
  await capture('06-observed-exit');
  await page.getByRole('button', { name: '연결 오류 시험', exact: true }).click(); await refresh().click();
  await page.waitForFunction(() => document.querySelector('section [role=alert]')?.textContent?.includes('조회에 실패'));
  assert.match(await output().innerText(), /password=\[REDACTED\]/);
  remember('read error retains stale safe output with explicit reconnect status'); await capture('07-read-error');
  await page.getByRole('button', { name: '원시 VT 거부 시험', exact: true }).click();
  await page.getByRole('button', { name: '같은 세션 재접속', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('section [role=alert]')?.textContent?.includes('안전한 줄 형식'));
  assert.equal(await output().count(), 0); assert.equal(await refresh().isDisabled(), true);
  remember('raw VT response fails closed and clears prior private output'); await capture('08-invalid-mode');
  await load(); await refresh().click();
  await page.waitForFunction(() => document.querySelector('[data-pty-output]')?.textContent?.includes('token=[REDACTED]'));
  await page.getByText('합성 시험 상태 전환', { exact: true }).click();
  await page.getByRole('button', { name: '권한 차단 시험', exact: true }).click(); await refresh().click();
  await page.waitForFunction(() => document.querySelector('section [role=alert]')?.textContent?.includes('접근 권한'));
  assert.equal(await output().count(), 0); assert.doesNotMatch(await page.locator('section').innerText(), /token=|task-/);
  remember('authorization denial clears output and identity in the rendered DOM'); await capture('09-access-denied');
  await page.getByRole('button', { name: '출력 보기 닫기', exact: true }).click();
  assert.match(await state().innerText(), /닫았습니다/); assert.equal(await page.locator('section button').count(), 0);
  remember('close ends the observer view without hidden process controls'); await capture('10-closed');
  assert.equal(networkRequests.length, 0); assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  remember('no external requests, console/page errors or dialogs; fixture has no input/process capability');
  receipt.result = 'PASS';
} catch (error) {
  receipt.result = 'FAIL'; receipt.failure = { name: error.name, message: error.message };
  throw error;
} finally {
  await context?.close(); await browser?.close();
  receipt.completedAt = new Date().toISOString();
  await fs.writeFile(path.join(evidenceDirectory, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ result: receipt.result, checks: checks.length,
    receipt: path.join(evidenceDirectory, 'browser-receipt.json'), screenshots: screenshots.length }));
}
