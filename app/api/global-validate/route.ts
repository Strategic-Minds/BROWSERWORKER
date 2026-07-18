import { verifyAuth, authResponse } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 1 },
} as const;

export async function POST(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.ok) return authResponse();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 });
  }

  const url = typeof body?.url === 'string' ? body.url : '';
  if (!url) {
    return Response.json({ ok: false, code: 'URL_REQUIRED' }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const authorization = request.headers.get('authorization') || '';
  const results: Record<string, unknown> = {};

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const response = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: '1.0',
        job_id: `${body?.project_id || 'global'}-${name}-${Date.now()}`,
        correlation_id: body?.correlation_id,
        objective: `Validate ${body?.surface || 'system'} on ${name}`,
        type: 'generated-site-validation',
        url,
        viewport,
        timeout_ms: 120000,
        capture: {
          screenshot: true,
          console: true,
          network_errors: true,
          html: false,
        },
      }),
    });

    const payload = await response.json().catch(() => ({
      ok: false,
      code: 'INVALID_WORKER_RESPONSE',
    }));

    results[name] = {
      http_status: response.status,
      ...payload,
    };
  }

  const values = Object.values(results) as any[];
  const ok = values.length === 3 && values.every((entry) => entry?.ok === true);

  return Response.json({
    ok,
    status: ok ? 'pass' : 'fail',
    project_id: body?.project_id || null,
    artifact_id: body?.artifact_id || null,
    surface: body?.surface || 'system',
    url,
    viewports: results,
    completed_at: new Date().toISOString(),
  }, { status: ok ? 200 : 422 });
}
