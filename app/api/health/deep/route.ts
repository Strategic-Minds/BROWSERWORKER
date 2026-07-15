import { launchBrowser, closeBrowser, WORKER_VERSION } from '@/lib/browser';
import { validateAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
      error: err instanceof Error ? err.message.slice(0, 200) : 'Unknown error',
      worker_version: WORKER_VERSION,
      provider: 'browserbase',
      configured: !!process.env.BROWSERBASE_API_KEY,
    }, { status: 500 });
  } finally {
    await closeBrowser(browser);
  }
}
