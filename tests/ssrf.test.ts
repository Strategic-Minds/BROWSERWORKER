import { validateUrl } from '../lib/ssrf';

describe('SSRF Protection', () => {
  test('allows public HTTPS URLs', () => {
    expect(validateUrl('https://www.autobuilderos.com').ok).toBe(true);
    expect(validateUrl('https://example.com').ok).toBe(true);
  });

  test('blocks localhost', () => {
    expect(validateUrl('http://localhost').ok).toBe(false);
    expect(validateUrl('http://localhost:3000').ok).toBe(false);
  });

  test('blocks 127.x.x.x', () => {
    expect(validateUrl('http://127.0.0.1').ok).toBe(false);
    expect(validateUrl('http://127.1.2.3:8080/api').ok).toBe(false);
  });

  test('blocks cloud metadata IP', () => {
    expect(validateUrl('http://169.254.169.254').ok).toBe(false);
    expect(validateUrl('http://169.254.169.254/latest/meta-data/').ok).toBe(false);
  });

  test('blocks metadata.google.internal', () => {
    expect(validateUrl('http://metadata.google.internal').ok).toBe(false);
  });

  test('blocks private ranges', () => {
    expect(validateUrl('http://10.0.0.1').ok).toBe(false);
    expect(validateUrl('http://192.168.1.1').ok).toBe(false);
    expect(validateUrl('http://172.16.0.1').ok).toBe(false);
  });

  test('blocks bad schemes', () => {
    expect(validateUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateUrl('data:text/html,<h1>hi</h1>').ok).toBe(false);
  });

  test('blocks embedded credentials', () => {
    expect(validateUrl('https://user:pass@example.com').ok).toBe(false);
  });

  test('returns SSRF_BLOCKED code for blocked IPs', () => {
    const result = validateUrl('http://127.0.0.1');
    expect(result.code).toBe('SSRF_BLOCKED');
  });

  test('rejects invalid URL format', () => {
    expect(validateUrl('not-a-url').ok).toBe(false);
    expect(validateUrl('').ok).toBe(false);
  });
  test('ignores a configured allowlist unless strict mode is enabled', () => {
    process.env.BROWSER_ALLOWED_HOSTS = 'www.autobuilderos.com';
    delete process.env.BROWSER_STRICT_ALLOWLIST;
    expect(validateUrl('https://example.com').ok).toBe(true);
    delete process.env.BROWSER_ALLOWED_HOSTS;
  });

  test('enforces the allowlist only in explicit strict mode', () => {
    process.env.BROWSER_ALLOWED_HOSTS = 'www.autobuilderos.com';
    process.env.BROWSER_STRICT_ALLOWLIST = 'true';
    expect(validateUrl('https://example.com').ok).toBe(false);
    expect(validateUrl('https://www.autobuilderos.com').ok).toBe(true);
    delete process.env.BROWSER_ALLOWED_HOSTS;
    delete process.env.BROWSER_STRICT_ALLOWLIST;
  });
});
