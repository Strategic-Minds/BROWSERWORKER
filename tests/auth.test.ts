import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuth } from '../lib/auth.ts';

const SECRET_NAMES = ['BROWSER_WORKER_SECRET', 'AUTO_BUILDER_OPERATOR_TOKEN'] as const;

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://browserworker.vercel.app/api/run', {
    method: 'POST',
    headers,
  });
}

function withSecrets<T>(values: Partial<Record<(typeof SECRET_NAMES)[number], string>>, run: () => T): T {
  const original = new Map(SECRET_NAMES.map((name) => [name, process.env[name]]));
  for (const name of SECRET_NAMES) delete process.env[name];
  for (const [name, value] of Object.entries(values)) Reflect.set(process.env, name, value);
  try {
    return run();
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else Reflect.set(process.env, name, value);
    }
  }
}

test('accepts valid Bearer token', () => withSecrets({ BROWSER_WORKER_SECRET: 'test-secret-value' }, () => {
  const req = makeRequest({ Authorization: 'Bearer test-secret-value' });
  assert.equal(verifyAuth(req).ok, true);
}));

test('accepts valid X-Browser-Worker-Secret header', () => withSecrets({ BROWSER_WORKER_SECRET: 'test-secret-value' }, () => {
  const req = makeRequest({ 'X-Browser-Worker-Secret': 'test-secret-value' });
  assert.equal(verifyAuth(req).ok, true);
}));

test('accepts governed AUTO_BUILDER_OPERATOR_TOKEN', () => withSecrets({ AUTO_BUILDER_OPERATOR_TOKEN: 'control-token' }, () => {
  const bearer = makeRequest({ Authorization: 'Bearer control-token' });
  const explicit = makeRequest({ 'X-Auto-Builder-Token': 'control-token' });
  assert.equal(verifyAuth(bearer).ok, true);
  assert.equal(verifyAuth(explicit).ok, true);
}));

test('observes secret rotation without a module restart', () => withSecrets({ BROWSER_WORKER_SECRET: 'old-secret' }, () => {
  assert.equal(verifyAuth(makeRequest({ Authorization: 'Bearer old-secret' })).ok, true);
  Reflect.set(process.env, 'BROWSER_WORKER_SECRET', 'new-secret');
  assert.equal(verifyAuth(makeRequest({ Authorization: 'Bearer old-secret' })).ok, false);
  assert.equal(verifyAuth(makeRequest({ Authorization: 'Bearer new-secret' })).ok, true);
}));

test('rejects wrong secret', () => withSecrets({ BROWSER_WORKER_SECRET: 'test-secret-value' }, () => {
  const req = makeRequest({ Authorization: 'Bearer wrong-secret' });
  const result = verifyAuth(req);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUTHENTICATION_FAILED');
}));

test('rejects missing auth', () => withSecrets({ BROWSER_WORKER_SECRET: 'test-secret-value' }, () => {
  const req = makeRequest({});
  assert.equal(verifyAuth(req).ok, false);
}));

test('rejects empty bearer', () => withSecrets({ BROWSER_WORKER_SECRET: 'test-secret-value' }, () => {
  const req = makeRequest({ Authorization: 'Bearer ' });
  assert.equal(verifyAuth(req).ok, false);
}));

test('fails closed when neither server-side secret is configured', () => withSecrets({}, () => {
  const result = verifyAuth(makeRequest({ Authorization: 'Bearer anything' }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUTHENTICATION_FAILED');
}));
