import { WORKER_VERSION } from '@/lib/browser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Lightweight — does NOT launch Chromium
  let playwrightOk = false;
  let chromiumOk = false;

  try {
    require('playwright-core');
    playwrightOk = true;
  } catch {}

  try {
    require('@sparticuz/chromium-min');
    chromiumOk = true;
  } catch {}

  const configured = !!process.env.BROWSER_WORKER_SECRET;

  return Response.json({
    ok: true,
    status: 'online',
    worker_version: WORKER_VERSION,
    configured,
    packages: {
      playwright_core: playwrightOk,
      chromium: chromiumOk,
    },
    timestamp: new Date().toISOString(),
  });
}
