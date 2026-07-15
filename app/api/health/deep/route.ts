import { launchBrowser, closeBrowser, WORKER_VERSION } from '@/lib/browser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BROWSER_WORKER_SECRET = process.env.BROWSER_WORKER_SECRET || '';

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function validateAuth(request: Request): { ok: boolean } {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!BROWSER_WORKER_SECRET || !constantTimeEqual(token, BROWSER_WORKER_SECRET)) {
    return { ok: false };
  }
  return { ok: true };
}

export async function GET(request: Request) {
  const authResult = validateAuth(request);
  if (!authResult.ok) {
    return Response.json(
      { ok: false, code: 'AUTHENTICATION_FAILED', error: 'Unauthorized' },
      { status: 401 }
    );
  }

  let browser = null;
  try {
    const { browser: b, version } = await launchBrowser();
    browser = b;
    return Response.json({
      ok: true,
      launched: true,
      browser: 'chromium',
      version,
      worker_version: WORKER_VERSION,
      provider: 'browserbase',
      configured: !!process.env.BROWSERBASE_API_KEY,
    });
  } catch (err) {
    return Response.json({
      ok: false,
      launched: false,
      error: err instanceof Error ? err.message.slice(0, 300) : 'Unknown error',
      worker_version: WORKER_VERSION,
      provider: 'browserbase',
      configured: !!process.env.BROWSERBASE_API_KEY,
    }, { status: 500 });
  } finally {
    await closeBrowser(browser);
  }
}
