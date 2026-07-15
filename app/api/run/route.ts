import { randomUUID } from 'node:crypto';
import { verifyAuth, authResponse } from '@/lib/auth';
import { validateUrl } from '@/lib/ssrf';
import { JobRequestSchema } from '@/lib/schemas';
import { launchBrowser, closeBrowser, WORKER_VERSION } from '@/lib/browser';
import { executeStep } from '@/lib/actions';
import { acquireSlot, releaseSlot } from '@/lib/concurrency';
import type { Captures } from '@/lib/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_SCREENSHOTS = parseInt(process.env.BROWSER_MAX_SCREENSHOTS || '6', 10);

// Predefined steps for website-generator-proof
function buildGeneratorProofSteps(url: string) {
  return [
    { action: 'goto' as const, url },
    { action: 'wait_for_selector' as const, selector: 'body', timeout_ms: 10000 },
    { action: 'get_title' as const },
    { action: 'screenshot' as const, fullPage: false },
    { action: 'evaluate_safe' as const, operation: 'elementCount' as const, selector: 'h1' },
    { action: 'capture_console' as const },
    { action: 'capture_network_errors' as const },
  ];
}

// Predefined steps for generated-site-validation
function buildSiteValidationSteps(url: string) {
  return [
    { action: 'goto' as const, url },
    { action: 'wait_for_selector' as const, selector: 'body', timeout_ms: 10000 },
    { action: 'get_title' as const },
    { action: 'evaluate_safe' as const, operation: 'elementCount' as const, selector: 'h1' },
    { action: 'evaluate_safe' as const, operation: 'elementCount' as const, selector: 'nav, header' },
    { action: 'evaluate_safe' as const, operation: 'elementCount' as const, selector: 'a' },
    { action: 'evaluate_safe' as const, operation: 'performance' as const },
    { action: 'screenshot' as const, fullPage: false },
    { action: 'extract_links' as const },
    { action: 'capture_console' as const },
    { action: 'capture_network_errors' as const },
  ];
}

export async function POST(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.ok) return authResponse();

  // Payload size check (~256KB)
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 262144) {
    return Response.json({ ok: false, error: 'Payload too large', code: 'INVALID_PAYLOAD' }, { status: 413 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON', code: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  const parsed = JobRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({
      ok: false,
      error: 'Validation failed',
      code: 'INVALID_PAYLOAD',
      details: parsed.error.flatten(),
    }, { status: 400 });
  }

  const job = parsed.data;
  const jobId = job.job_id ?? randomUUID();
  const correlationId = job.correlation_id ?? randomUUID();
  const receiptId = randomUUID();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // Concurrency check
  if (!acquireSlot()) {
    return Response.json({
      ok: false,
      error: 'Too many concurrent jobs',
      code: 'RATE_LIMITED',
    }, { status: 429 });
  }

  let browser = null;
  const stepResults: Array<{
    index: number; action: string; status: 'pass' | 'fail' | 'skip'; duration_ms: number; result?: unknown; error?: string;
  }> = [];
  const captures: Captures = { consoleErrors: [], networkErrors: [], screenshots: [] };
  const errors: string[] = [];
  const warnings: string[] = [];
  let browserVersion = 'unknown';
  let finalUrl = job.url ?? '';
  type JobStatus = 'pass' | 'warn' | 'fail' | 'blocked';
  let overallStatus: JobStatus = 'pass';

  try {
    // Handle launch-check without URL validation
    if (job.type === 'launch-check') {
      const { browser: b, version } = await launchBrowser();
      browser = b;
      browserVersion = version;
      const ctx = await browser.newContext();
      const pg = await ctx.newPage();
      await pg.goto('about:blank');
      await pg.close();
      await ctx.close();

      return Response.json({
        ok: true,
        status: 'pass',
        job_id: jobId,
        correlation_id: correlationId,
        worker_version: WORKER_VERSION,
        browser: { name: 'chromium', version: browserVersion },
        timing: {
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startMs,
        },
        steps: [{ index: 1, action: 'launch-check', status: 'pass', duration_ms: Date.now() - startMs }],
        artifacts: { screenshots: [], console_errors: [], network_errors: [] },
        errors: [],
        warnings: [],
        receipt_id: receiptId,
      });
    }

    // URL validation required for all other types
    if (job.url) {
      const urlCheck = validateUrl(job.url);
      if (!urlCheck.ok) {
        return Response.json({
          ok: false,
          error: urlCheck.error,
          code: urlCheck.code,
        }, { status: 400 });
      }
    }

    // Resolve steps
    let steps = job.steps ?? [];
    if (job.type === 'website-generator-proof' && job.url) {
      steps = buildGeneratorProofSteps(job.url) as typeof steps;
    } else if (job.type === 'generated-site-validation' && job.url) {
      steps = buildSiteValidationSteps(job.url) as typeof steps;
    }

    // Launch browser
    const { browser: b, version } = await launchBrowser();
    browser = b;
    browserVersion = version;

    const context = await browser.newContext({
      viewport: {
        width: job.viewport?.width ?? 1440,
        height: job.viewport?.height ?? 1200,
      },
      deviceScaleFactor: job.viewport?.deviceScaleFactor ?? 1,
    });

    // Block downloads
    await context.route('**', async (route) => {
      const resourceType = route.request().resourceType();
      if (['eventsource', 'websocket'].includes(resourceType)) {
        route.continue();
        return;
      }
      route.continue();
    });

    const page = await context.newPage();

    // Console capture
    if (job.capture?.console) {
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          captures.consoleErrors.push(`[${msg.type()}] ${msg.text()}`.slice(0, 500));
        }
      });
    }

    // Network error capture
    if (job.capture?.network_errors) {
      page.on('requestfailed', (req) => {
        captures.networkErrors.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`.slice(0, 500));
      });
    }

    // Execute steps
    let stepFailed = false;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (captures.screenshots.length >= MAX_SCREENSHOTS && step.action === 'screenshot') {
        stepResults.push({ index: i + 1, action: step.action, status: 'skip', duration_ms: 0 });
        warnings.push(`Screenshot limit (${MAX_SCREENSHOTS}) reached — skipped step ${i + 1}`);
        continue;
      }

      const result = await executeStep(page, step, captures);
      stepResults.push({ index: i + 1, action: step.action, ...result });

      if (result.status === 'fail') {
        stepFailed = true;
        errors.push(`Step ${i + 1} (${step.action}) failed: ${result.error}`);
        // Continue unless it's a critical step
        if (['goto', 'wait_for_selector'].includes(step.action) && i < 2) break;
      }
    }

    // Top-level screenshot if capture requested and no explicit screenshot step
    if (job.capture?.screenshot && captures.screenshots.length === 0) {
      try {
        const buf = await page.screenshot({ fullPage: false, type: 'png' });
        if (buf.length < 102400) {
          captures.screenshots.push(`data:image/png;base64,${buf.toString('base64')}`);
        }
      } catch { /* best-effort */ }
    }

    finalUrl = page.url();
    await page.close();
    await context.close();

    overallStatus = stepFailed ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';

  } catch (err) {
    const msg = (err as Error).message || 'Unknown error';
    errors.push(msg);
    overallStatus = 'fail';
  } finally {
    await closeBrowser(browser);
    releaseSlot();
  }

  return Response.json({
    ok: (overallStatus === 'pass' || overallStatus === 'warn'),
    status: overallStatus,
    job_id: jobId,
    correlation_id: correlationId,
    worker_version: WORKER_VERSION,
    browser: { name: 'chromium', version: browserVersion },
    timing: {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startMs,
    },
    navigation: {
      requested_url: job.url ?? '',
      final_url: finalUrl,
      redirects: [],
    },
    steps: stepResults,
    artifacts: {
      screenshots: captures.screenshots,
      console_errors: captures.consoleErrors,
      network_errors: captures.networkErrors,
    },
    errors,
    warnings,
    rollback: [],
    receipt_id: receiptId,
  });
}
