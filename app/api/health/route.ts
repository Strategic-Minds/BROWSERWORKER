import { WORKER_VERSION } from '@/lib/version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let playwrightOk = false;
  let chromiumOk = false;

  try {
    await import('playwright-core');
    playwrightOk = true;
  } catch {}

  try {
    await import('@sparticuz/chromium');
    chromiumOk = true;
  } catch {}

  return Response.json({
    ok: true,
    status: playwrightOk && chromiumOk ? 'online' : 'degraded',
    worker_version: WORKER_VERSION,
    configured: !!process.env.BROWSER_WORKER_SECRET,
    provider: 'self_hosted',
    browserbase_dependency: false,
    packages: {
      playwright_core: playwrightOk,
      chromium: chromiumOk,
    },
    timestamp: new Date().toISOString(),
  });
}
