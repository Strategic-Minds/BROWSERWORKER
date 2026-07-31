import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { verifyAuth, authResponse } from '@/lib/auth';
import { validatePublicUrl } from '@/lib/ssrf';
import { acquireBrowserValidationLease } from '@/lib/durable-lease';
import {
  buildPromotionDecision,
  immutableEvidenceDigest,
  summarizeWorkerEvidence,
} from '@/lib/evidence';
import { POST as executeRunRequest } from '../run/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000, deviceScaleFactor: 1 },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 1 },
} as const;

const RouteSchema = z.string().min(1).max(240).refine(
  (value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('..'),
  'Route must be a same-origin absolute path',
);

const GlobalValidationSchema = z.object({
  url: z.string().url(),
  project_id: z.string().min(1).max(120),
  artifact_id: z.string().min(1).max(160).optional(),
  correlation_id: z.string().min(1).max(160).optional(),
  surface: z.enum(['website', 'dashboard', 'app', 'system']).default('system'),
  routes: z.array(RouteSchema).min(1).max(3).default(['/']),
  exact_reference_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).max(9).default([]),
  required_scenarios: z.array(z.string().min(1).max(160)).max(20).default([]),
  proven_scenarios: z.array(z.string().min(1).max(160)).max(20).default([]),
});

type WorkerPayload = Record<string, unknown>;

function targetUrl(baseUrl: string, route: string): string {
  const base = new URL(baseUrl);
  const target = new URL(route, base);
  if (target.origin !== base.origin) throw new Error('CROSS_ORIGIN_ROUTE_BLOCKED');
  return target.toString();
}

function workerSteps(url: string) {
  return [
    { action: 'goto' as const, url },
    { action: 'wait_for_selector' as const, selector: 'body', timeout_ms: 15_000 },
    { action: 'get_title' as const },
    { action: 'get_url' as const },
    { action: 'get_viewport' as const },
    { action: 'validate_status' as const },
    { action: 'capture_accessibility_snapshot' as const },
    { action: 'evaluate_safe' as const, operation: 'performance' as const },
    { action: 'screenshot' as const, fullPage: true },
    { action: 'extract_links' as const },
    { action: 'capture_console' as const },
    { action: 'capture_network_errors' as const },
  ];
}

async function readWorkerPayload(response: Response): Promise<WorkerPayload> {
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as WorkerPayload
      : { ok: false, code: 'INVALID_WORKER_RESPONSE' };
  } catch {
    return { ok: false, code: 'INVALID_WORKER_RESPONSE' };
  }
}

export async function POST(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.ok) return authResponse();

  const contentLength = Number.parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 262_144) {
    return Response.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = GlobalValidationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({
      ok: false,
      code: 'INVALID_GLOBAL_VALIDATION_REQUEST',
      details: parsed.error.flatten(),
    }, { status: 400 });
  }

  const body = parsed.data;
  const baseUrlCheck = await validatePublicUrl(body.url);
  if (!baseUrlCheck.ok) {
    return Response.json({ ok: false, code: baseUrlCheck.code, error: baseUrlCheck.error }, { status: 400 });
  }

  const validationId = `browser-validation-${immutableEvidenceDigest({
    project_id: body.project_id,
    artifact_id: body.artifact_id || null,
    url: body.url,
    routes: body.routes,
  }).slice(0, 24)}`;
  const correlationId = body.correlation_id || randomUUID();
  const lease = await acquireBrowserValidationLease({ holderId: validationId, ttlSeconds: 300 });

  if (!lease.acquired) {
    const status = lease.code === 'DURABLE_LEASE_CAPACITY_EXHAUSTED' ? 429 : 503;
    return Response.json({
      ok: false,
      status: 'blocked',
      code: lease.code,
      validation_id: validationId,
      correlation_id: correlationId,
      lease: {
        durable: lease.durable,
        mode: lease.mode,
        warning: lease.warning || null,
      },
      promotion_eligible: false,
      production_mutation: false,
    }, { status });
  }

  const authorization = request.headers.get('authorization') || '';
  const workerSecret = request.headers.get('x-browser-worker-secret') || '';
  const results: Record<string, unknown> = {};
  const summaries = [];
  const errors: string[] = [];
  let leaseReleased = false;

  try {
    for (const route of body.routes) {
      const url = targetUrl(body.url, route);
      const urlCheck = await validatePublicUrl(url);
      if (!urlCheck.ok) {
        errors.push(`UNSAFE_TARGET:${route}:${urlCheck.code}`);
        continue;
      }

      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        if (lease.durable && !(await lease.renew())) {
          errors.push('DURABLE_LEASE_RENEWAL_FAILED');
          break;
        }

        const requestBody = {
          version: '1.0',
          job_id: `${validationId}:${route}:${viewportName}`,
          correlation_id: correlationId,
          objective: `Validate ${body.surface} ${route} on ${viewportName}`,
          url,
          viewport,
          timeout_ms: 120_000,
          capture: {
            screenshot: true,
            console: true,
            network_errors: true,
            html: false,
          },
          steps: workerSteps(url),
        };
        const runRequest = new Request(new URL('/api/run', request.url), {
          method: 'POST',
          headers: {
            authorization,
            ...(workerSecret ? { 'x-browser-worker-secret': workerSecret } : {}),
            'content-type': 'application/json',
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify(requestBody),
        });
        const response = await executeRunRequest(runRequest);
        const payload = await readWorkerPayload(response);
        const summary = summarizeWorkerEvidence(payload);
        summaries.push(summary);
        results[`${route}:${viewportName}`] = {
          http_status: response.status,
          viewport,
          payload,
          summary,
        };
      }

      if (errors.includes('DURABLE_LEASE_RENEWAL_FAILED')) break;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    leaseReleased = await lease.release().catch(() => false);
  }

  const provenScenarioSet = new Set(body.proven_scenarios);
  const provenScenarioCount = body.required_scenarios.filter((scenario) => provenScenarioSet.has(scenario)).length;
  const promotion = buildPromotionDecision({
    summaries,
    durableLease: lease.durable && leaseReleased,
    exactReferenceHashes: body.exact_reference_hashes,
    requiredScenarioCount: body.required_scenarios.length,
    provenScenarioCount,
  });
  const browserValidationPassed = errors.length === 0
    && summaries.length === body.routes.length * Object.keys(VIEWPORTS).length
    && summaries.every((summary) => summary.ok);
  const evidenceDigest = immutableEvidenceDigest({
    validation_id: validationId,
    correlation_id: correlationId,
    project_id: body.project_id,
    artifact_id: body.artifact_id || null,
    url: body.url,
    routes: body.routes,
    summaries,
    errors,
    promotion,
  });

  return Response.json({
    ok: browserValidationPassed,
    status: browserValidationPassed ? 'pass' : 'fail',
    validation_id: validationId,
    correlation_id: correlationId,
    project_id: body.project_id,
    artifact_id: body.artifact_id || null,
    surface: body.surface,
    url: body.url,
    routes: body.routes,
    viewports: results,
    lease: {
      durable: lease.durable,
      mode: lease.mode,
      code: lease.code,
      released: leaseReleased,
      warning: lease.warning || null,
    },
    evidence: {
      digest_algorithm: 'sha256',
      digest: evidenceDigest,
      screenshot_count: summaries.reduce((total, summary) => total + summary.screenshot_count, 0),
      persistence_owner: 'AUTOBUILDER-V2',
      durable_artifact_persistence_proven: false,
    },
    promotion: {
      ...promotion,
      promotion_eligible: promotion.promotion_eligible && browserValidationPassed,
    },
    errors,
    production_mutation: false,
    completed_at: new Date().toISOString(),
  }, { status: browserValidationPassed ? 200 : 422 });
}
