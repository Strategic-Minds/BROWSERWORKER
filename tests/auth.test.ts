import { verifyAuth } from '../lib/auth';

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://browserworker.vercel.app/api/run', {
    method: 'POST',
    headers,
  });
}

describe('Authentication', () => {
  const originalSecret = process.env.BROWSER_WORKER_SECRET;

  beforeAll(() => {
    process.env.BROWSER_WORKER_SECRET = 'test-secret-value';
  });

  afterAll(() => {
    process.env.BROWSER_WORKER_SECRET = originalSecret;
  });

  test('accepts valid Bearer token', () => {
    const req = makeRequest({ Authorization: 'Bearer test-secret-value' });
    expect(verifyAuth(req).ok).toBe(true);
  });

  test('accepts valid X-Browser-Worker-Secret header', () => {
    const req = makeRequest({ 'X-Browser-Worker-Secret': 'test-secret-value' });
    expect(verifyAuth(req).ok).toBe(true);
  });

  test('rejects wrong secret', () => {
    const req = makeRequest({ Authorization: 'Bearer wrong-secret' });
    const result = verifyAuth(req);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AUTHENTICATION_FAILED');
  });

  test('rejects missing auth', () => {
    const req = makeRequest({});
    expect(verifyAuth(req).ok).toBe(false);
  });

  test('rejects empty bearer', () => {
    const req = makeRequest({ Authorization: 'Bearer ' });
    expect(verifyAuth(req).ok).toBe(false);
  });
});
