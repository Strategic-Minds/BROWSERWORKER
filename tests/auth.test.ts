import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuth } from '../lib/auth.ts';

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://browserworker.vercel.app/api/run', {
    method: 'POST',
    headers,
  });
}

function withSecret<T>(run: () => T): T {
  const originalSecret = process.env.BROWSER_WORKER_SECRET;
  Reflect.set(process.env, 'BROWSER_WORKER_SECRET', 'test-secret-value');
  try {
    return run();
  } finally {
    if (originalSecret === undefined) delete process.env.BROWSER_WORKER_SECRET;
    else Reflect.set(process.env, 'BROWSER_WORKER_SECRET', originalSecret);
  }
}

test('accepts valid Bearer token', () => withSecret(() => {
  const req = makeRequest({ Authorization: 'Bearer test-secret-value' });
  assert.equal(verifyAuth(req).ok, true);
}));

test('accepts valid X-Browser-Worker-Secret header', () => withSecret(() => {
  const req = makeRequest({ 'X-Browser-Worker-Secret': 'test-secret-value' });
  assert.equal(verifyAuth(req).ok, true);
}));

test('rejects wrong secret', () => withSecret(() => {
  const req = makeRequest({ Authorization: 'Bearer wrong-secret' });
  const result = verifyAuth(req);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUTHENTICATION_FAILED');
}));

test('rejects missing auth', () => withSecret(() => {
  const req = makeRequest({});
  assert.equal(verifyAuth(req).ok, false);
}));

test('rejects empty bearer', () => withSecret(() => {
  const req = makeRequest({ Authorization: 'Bearer ' });
  assert.equal(verifyAuth(req).ok, false);
}));
