import assert from 'node:assert/strict';
import * as panel from '../src/client/OrchestrationPanel.js';

assert.equal(typeof panel.createLatestDetailRequestController, 'function', 'detail selection must enforce the last click');
const controller = panel.createLatestDetailRequestController();
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
const applied: string[] = [], errors: string[] = [], settled: string[] = [];
const a=deferred<string>(), b=deferred<string>();
let signalA: AbortSignal | undefined;
const first = controller.request(signal => { signalA=signal; return a.promise; }, { success: v => applied.push(v), error: e => errors.push(String(e)), settled: () => settled.push('A') });
const second = controller.request(() => b.promise, { success: v => applied.push(v), error: e => errors.push(String(e)), settled: () => settled.push('B') });
assert.equal(signalA?.aborted, true);
b.resolve('B'); await second; a.resolve('A'); await first;
assert.deepEqual(applied,['B']); assert.deepEqual(settled,['B']);
const stale=deferred<string>(), latest=deferred<string>();
const old = controller.request(() => stale.promise, { success: v => applied.push(v), error: e => errors.push(String(e)) });
const newest = controller.request(() => latest.promise, { success: v => applied.push(v), error: e => errors.push(String(e)) });
latest.resolve('A-again'); await newest; stale.reject(new Error('stale failure')); await old;
assert.deepEqual(applied,['B','A-again']); assert.deepEqual(errors,[]);
const closing=deferred<string>();
const closingRequest=controller.request(() => closing.promise,{success:v=>applied.push(v)});
controller.dispose(); closing.resolve('after-unmount'); await closingRequest;
assert.deepEqual(applied,['B','A-again']);
console.log('PASS: actual panel detail controller honors last click and ignores stale response/error/unmount');
