import { verifyAuth, authResponse } from '@/lib/auth';
import { launchBrowser, closeBrowser, WORKER_VERSION } from '@/lib/browser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.ok) return authResponse();

  const start = Date.now();
  let browser = null;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('about:blank');
    const version = launched.version;
    await page.close();
    await context.close();

    return Response.json({
      ok: true,
      launched: true,
      browser: 'chromium',
      version,
      worker_version: WORKER_VERSION,
      duration_ms: Date.now() - start,
    });
  } catch (err) {
    return Response.json({
      ok: false,
      launched: false,
      error: (err as Error).message,
      code: 'CHROMIUM_LAUNCH_FAILED',
      duration_ms: Date.now() - start,
    }, { status: 500 });
  } finally {
    await closeBrowser(browser);
  }
}
