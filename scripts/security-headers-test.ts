import assert from 'node:assert/strict';

import { buildSecurityHeaders } from '../src/server/security-headers.js';

const headers = buildSecurityHeaders();

assert.equal(headers['X-Content-Type-Options'], 'nosniff');
assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
assert.equal(headers['X-Frame-Options'], undefined, 'Teams tabs must not receive DENY/SAMEORIGIN framing');
assert.match(headers['Content-Security-Policy'], /frame-ancestors 'self'/);
assert.match(headers['Content-Security-Policy'], /https:\/\/teams\.microsoft\.com/);
assert.match(headers['Content-Security-Policy'], /https:\/\/\*\.teams\.microsoft\.com/);
assert.match(headers['Content-Security-Policy'], /https:\/\/\*\.cloud\.microsoft/);
assert.match(headers['Content-Security-Policy'], /object-src 'none'/);
assert.match(headers['Content-Security-Policy'], /script-src 'self'/);

console.log('PASS: Teams-compatible security headers preserve iframe embedding and disable fingerprinting');
