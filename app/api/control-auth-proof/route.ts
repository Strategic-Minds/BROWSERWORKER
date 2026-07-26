import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PROOF_KEY = 'browserworker-control-auth-20260726';
const TARGET_URL = 'https://xab-universal-gpt-factory-provisioning-proof-2026072-necvvuseo.vercel.app';

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (process.env.VERCEL_ENV === 'production' || url.searchParams.get('proof') !== PROOF_KEY) {
    return NextResponse.json({ ok: false, state: 'NOT_FOUND' }, { status: 404 });
  }

  const token = process.env.AUTO_BUILDER_OPERATOR_TOKEN ?? '';
  if (!token) {
    return NextResponse.json({ ok: false, state: 'CONTROL_TOKEN_MISSING' }, { status: 503 });
  }

  const origin = `${url.protocol}//${url.host}`;
  const unauthenticated = await fetch(`${origin}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: '1.0', type: 'launch-check', job_id: 'unauth-check' }),
    cache: 'no-store',
  });

  const authenticated = await fetch(`${origin}/api/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Auto-Builder-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: '1.0',
      type: 'generated-site-validation',
      job_id: `auth-proof-${crypto.randomUUID()}`,
      correlation_id: 'browserworker-control-auth-proof',
      url: TARGET_URL,
      viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      timeout_ms: 60_000,
      capture: { screenshot: true, console: true, network_errors: true },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(90_000),
  });
  const result = await authenticated.json().catch(() => ({})) as Record<string, unknown>;
  const artifacts = result.artifacts && typeof result.artifacts === 'object' ? result.artifacts as Record<string, unknown> : {};
  const screenshots = Array.isArray(artifacts.screenshots) ? artifacts.screenshots : [];

  return NextResponse.json({
    ok: unauthenticated.status === 401 && authenticated.ok && result.ok === true && screenshots.length > 0,
    state: 'CONTROL_AUTH_PROOF',
    unauthenticated_status: unauthenticated.status,
    authenticated_status: authenticated.status,
    worker_ok: result.ok === true,
    worker_status: result.status || null,
    worker_version: result.worker_version || null,
    screenshot_count: screenshots.length,
    receipt_id: result.receipt_id || null,
    console_errors: Array.isArray(artifacts.console_errors) ? artifacts.console_errors.length : null,
    network_errors: Array.isArray(artifacts.network_errors) ? artifacts.network_errors.length : null,
    secret_exposed: false,
    production_traffic_changed: false,
  });
}
