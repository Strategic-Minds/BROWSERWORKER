import { WORKER_VERSION } from '@/lib/browser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Lightweight — does NOT launch Chromium
  let playwrightOk = false;

  try {
    await import('playwright-core');
    playwrightOk = true;
  } catch {}

  const authConfigured = !!process.env.BROWSER_WORKER_SECRET;
  const providerConfigured = !!process.env.BROWSERBASE_API_KEY;

  return Response.json({
    ok: true,
    status: 'online',
    worker_version: WORKER_VERSION,
    configured: authConfigured && providerConfigured,
    auth_configured: authConfigured,
    provider: {
      name: 'browserbase',
      configured: providerConfigured,
    },
    packages: {
      playwright_core: playwrightOk,
    },
    timestamp: new Date().toISOString(),
  });
}
