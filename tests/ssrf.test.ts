import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUrl } from '../lib/ssrf.ts';

function clearAllowlist() {
  delete process.env.BROWSER_ALLOWED_HOSTS;
  delete process.env.BROWSER_STRICT_ALLOWLIST;
}

test('allows public HTTPS URLs', () => {
  assert.equal(validateUrl('https://www.autobuilderos.com').ok, true);
  assert.equal(validateUrl('https://example.com').ok, true);
});

test('blocks localhost', () => {
  assert.equal(validateUrl('http://localhost').ok, false);
  assert.equal(validateUrl('http://localhost:3000').ok, false);
});

test('blocks 127.x.x.x', () => {
  assert.equal(validateUrl('http://127.0.0.1').ok, false);
  assert.equal(validateUrl('http://127.1.2.3:8080/api').ok, false);
});

test('blocks cloud metadata IP', () => {
  assert.equal(validateUrl('http://169.254.169.254').ok, false);
  assert.equal(validateUrl('http://169.254.169.254/latest/meta-data/').ok, false);
});

test('blocks metadata.google.internal', () => {
  assert.equal(validateUrl('http://metadata.google.internal').ok, false);
});

test('blocks private ranges', () => {
  assert.equal(validateUrl('http://10.0.0.1').ok, false);
  assert.equal(validateUrl('http://192.168.1.1').ok, false);
  assert.equal(validateUrl('http://172.16.0.1').ok, false);
});

test('blocks bad schemes', () => {
  assert.equal(validateUrl('file:///etc/passwd').ok, false);
  assert.equal(validateUrl('javascript:alert(1)').ok, false);
  assert.equal(validateUrl('data:text/html,<h1>hi</h1>').ok, false);
});

test('blocks embedded credentials', () => {
  assert.equal(validateUrl('https://user:pass@example.com').ok, false);
});

test('returns SSRF_BLOCKED code for blocked IPs', () => {
  const result = validateUrl('http://127.0.0.1');
  assert.equal(result.code, 'SSRF_BLOCKED');
});

test('rejects invalid URL format', () => {
  assert.equal(validateUrl('not-a-url').ok, false);
  assert.equal(validateUrl('').ok, false);
});

test('ignores a configured allowlist unless strict mode is enabled', () => {
  clearAllowlist();
  Reflect.set(process.env, 'BROWSER_ALLOWED_HOSTS', 'www.autobuilderos.com');
  try {
    assert.equal(validateUrl('https://example.com').ok, true);
  } finally {
    clearAllowlist();
  }
});

test('enforces the allowlist only in explicit strict mode', () => {
  clearAllowlist();
  Reflect.set(process.env, 'BROWSER_ALLOWED_HOSTS', 'www.autobuilderos.com');
  Reflect.set(process.env, 'BROWSER_STRICT_ALLOWLIST', 'true');
  try {
    assert.equal(validateUrl('https://example.com').ok, false);
    assert.equal(validateUrl('https://www.autobuilderos.com').ok, true);
  } finally {
    clearAllowlist();
  }
});
