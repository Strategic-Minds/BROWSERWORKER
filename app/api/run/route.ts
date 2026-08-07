import { randomUUID } from 'node:crypto';
import { verifyAuth, authResponse } from '@/lib/auth';
import { validatePublicUrl } from '@/lib/ssrf';
import { JobRequestSchema } from '@/lib/schemas';
import { launchBrowser, closeBrowser, WORKER_VERSION } from '@/lib/browser';
import { executeStep } from '@/lib/actions';
import { runVisualParity } from '@/lib/visual';
import { acquireSlot, releaseSlot } from '@/lib/concurrency';
import type { Captures } from '@/lib/actions';
import type { VisualParityResult } from '@/lib/visual';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_SCREENSHOTS = parseInt(process.env.BROWSER_MAX_SCREENSHOTS || '6', 10);

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

function buildVisualParitySteps(url: string) {
  return [
    { action: 'goto' as const, url },
    { action: 'wait_for_selector' as const, selector: 'body', timeout_ms: 15000 },
    { action: 'get_title' as const },
    { action: 'capture_accessibility_snapshot' as const },
  ];
}

export async function POST(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.ok) return authResponse();

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
    return Response.json({ ok: false, error: 'Validation failed', code: 'INVALID_PAYLOAD', details: parsed.error.flatten() }, { status: 400 });
  }

  const job = parsed.data;
  const jobId = job.job_id ?? randomUUID();
  const correlationId = job.correlation_id ?? randomUUID();
  const receiptId = randomUUID();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  if (!acquireSlot()) {
    return Response.json({ ok: false, error: 'Too many concurrent jobs', code: 'RATE_LIMITED' }, { status: 429 });
  }

  let browser = null;
  const stepResults: Array<{ index: number; action: string; status: 'pass' | 'fail' | 'skip'; duration_ms: number; result?: unknown; error?: string }> = [];
  const captures: Captures = { consoleErrors: [], networkErrors: [], screenshots: [] };
  const errors: string[] = [];
  const warnings: string[] = [];
  let browserVersion = 'unknown';
  let finalUrl = job.url ?? '';
  let visualResult: VisualParityResult | undefined;
  let operationalResult: Record<string, unknown> | undefined;
  type JobStatus = 'pass' | 'warn' | 'fail' | 'blocked';
  let overallStatus: JobStatus = 'pass';

  try {
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
        timing: { started_at: startedAt, completed_at: new Date().toISOString(), duration_ms: Date.now() - startMs },
        steps: [{ index: 1, action: 'launch-check', status: 'pass', duration_ms: Date.now() - startMs }],
        artifacts: { screenshots: [], console_errors: [], network_errors: [], diff_images: [] },
        errors: [], warnings: [], receipt_id: receiptId,
      });
    }

    if (job.url) {
      const urlCheck = await validatePublicUrl(job.url);
      if (!urlCheck.ok) return Response.json({ ok: false, error: urlCheck.error, code: urlCheck.code }, { status: 400 });
    }

    let steps = job.steps ?? [];
    if (job.type === 'website-generator-proof' && job.url) steps = buildGeneratorProofSteps(job.url) as typeof steps;
    else if (job.type === 'generated-site-validation' && job.url) steps = buildSiteValidationSteps(job.url) as typeof steps;
    else if (job.type === 'visual-parity' && job.url && steps.length === 0) steps = buildVisualParitySteps(job.url) as typeof steps;

    const { browser: b, version } = await launchBrowser();
    browser = b;
    browserVersion = version;
    const context = await browser.newContext({
      viewport: { width: job.viewport?.width ?? 1440, height: job.viewport?.height ?? 1200 },
      deviceScaleFactor: job.viewport?.deviceScaleFactor ?? 1,
    });

    const validatedHosts = new Map<string, boolean>();
    await context.route('**', async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
        const host = new URL(requestUrl).hostname.toLowerCase();
        let allowed = validatedHosts.get(host);
        if (allowed === undefined) {
          const check = await validatePublicUrl(requestUrl);
          allowed = check.ok;
          validatedHosts.set(host, allowed);
          if (!allowed) warnings.push(`Blocked unsafe browser request to ${host}: ${check.error}`);
        }
        if (!allowed) { await route.abort('blockedbyclient'); return; }
      }
      await route.continue();
    });

    const page = await context.newPage();
    const captureConsole = Boolean(job.capture?.console || job.type === 'visual-parity' || job.type === 'operational-parity');
    const captureNetwork = Boolean(job.capture?.network_errors || job.type === 'visual-parity' || job.type === 'operational-parity');

    if (captureConsole) page.on('console', (msg) => { if (msg.type() === 'error') captures.consoleErrors.push(`[${msg.type()}] ${msg.text()}`.slice(0, 500)); });
    if (captureNetwork) page.on('requestfailed', (req) => captures.networkErrors.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`.slice(0, 500)));

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
        if (['goto', 'wait_for_selector'].includes(step.action) && i < 2) break;
      }
    }

    if (!stepFailed && job.type === 'visual-parity' && job.visual) {
      try {
        visualResult = await runVisualParity(page, job.visual);
        captures.screenshots.push(visualResult.actual_screenshot);
        if (!visualResult.pass) {
          stepFailed = true;
          errors.push(`Visual parity failed: ${visualResult.mismatch_percent}% mismatch exceeds ${visualResult.threshold_percent}% or a critical region failed`);
        }
      } catch (error) {
        stepFailed = true;
        errors.push(`Visual parity engine failed: ${(error as Error).message}`);
      }
    }

    if (job.type === 'operational-parity' && job.operational) {
      const consolePass = !job.operational.require_console_zero || captures.consoleErrors.length === 0;
      const networkPass = !job.operational.require_network_zero || captures.networkErrors.length === 0;
      const pass = !stepFailed && consolePass && networkPass;
      operationalResult = {
        contract_id: job.operational.contract_id,
        case_id: job.operational.case_id,
        steps_pass: !stepFailed,
        console_pass: consolePass,
        network_pass: networkPass,
        console_error_count: captures.consoleErrors.length,
        network_error_count: captures.networkErrors.length,
        pass,
      };
      if (!pass) {
        stepFailed = true;
        if (!consolePass) errors.push(`Operational parity failed: ${captures.consoleErrors.length} console error(s)`);
        if (!networkPass) errors.push(`Operational parity failed: ${captures.networkErrors.length} network error(s)`);
      }
    }

    if (job.capture?.screenshot && captures.screenshots.length === 0) {
      try {
        const buf = await page.screenshot({ fullPage: false, type: 'png' });
        if (buf.length < 102400) captures.screenshots.push(`data:image/png;base64,${buf.toString('base64')}`);
      } catch { /* best effort */ }
    }

    finalUrl = page.url();
    await page.close();
    await context.close();
    overallStatus = stepFailed ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';
  } catch (err) {
    errors.push((err as Error).message || 'Unknown error');
    overallStatus = 'fail';
  } finally {
    await closeBrowser(browser);
    releaseSlot();
  }

  return Response.json({
    ok: overallStatus === 'pass' || overallStatus === 'warn',
    status: overallStatus,
    job_id: jobId,
    correlation_id: correlationId,
    worker_version: WORKER_VERSION,
    browser: { name: 'chromium', version: browserVersion },
    timing: { started_at: startedAt, completed_at: new Date().toISOString(), duration_ms: Date.now() - startMs },
    navigation: { requested_url: job.url ?? '', final_url: finalUrl, redirects: [] },
    steps: stepResults,
    artifacts: {
      screenshots: captures.screenshots,
      console_errors: captures.consoleErrors,
      network_errors: captures.networkErrors,
      diff_images: visualResult?.diff_image ? [visualResult.diff_image] : [],
    },
    visual: visualResult ? {
      reference_id: visualResult.reference_id,
      reference_url: visualResult.reference_url,
      mode: visualResult.mode,
      pass: visualResult.pass,
      dimension_match: visualResult.dimension_match,
      actual_width: visualResult.actual_width,
      actual_height: visualResult.actual_height,
      reference_width: visualResult.reference_width,
      reference_height: visualResult.reference_height,
      mismatch_percent: visualResult.mismatch_percent,
      threshold_percent: visualResult.threshold_percent,
      mean_absolute_error: visualResult.mean_absolute_error,
      compared_pixels: visualResult.compared_pixels,
      regions: visualResult.regions,
    } : undefined,
    operational: operationalResult,
    errors,
    warnings,
    rollback: [],
    receipt_id: receiptId,
  });
}
