import { WORKER_VERSION } from '@/lib/browser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Lightweight — Browserbase provides the Chromium runtime over CDP.
  const workerSecretConfigured = !!process.env.BROWSER_WORKER_SECRET;
  const browserbaseConfigured = !!process.env.BROWSERBASE_API_KEY;
  const configured = workerSecretConfigured && browserbaseConfigured;

  return Response.json({
    ok: true,
    status: 'online',
    worker_version: WORKER_VERSION,
    configured,
    packages: {
      playwright_core: true,
      browser_provider: 'browserbase',
      browserbase_configured: browserbaseConfigured,
    },
    timestamp: new Date().toISOString(),
  });
}
