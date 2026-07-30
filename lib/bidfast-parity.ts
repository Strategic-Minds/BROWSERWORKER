import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { Browser, Page } from 'playwright-core';
import referenceConfig from '../config/bidfast-approved-references.json';
import { closeBrowser, launchBrowser } from './browser';

export type BidfastScenario = (typeof referenceConfig.scenarios)[number];

export type ParityReceipt = {
  ok: boolean;
  pass: boolean;
  job_id: string;
  scenario_id: string;
  route: string;
  preview_url: string;
  reference_filename: string;
  reference_sha256: string;
  screenshot_sha256: string;
  browser_provider: string;
  browser_version: string;
  viewport: { width: number; height: number };
  scores: {
    pixel: number;
    structural: number;
    edge: number;
    color: number;
    geometry: number;
    composite: number;
  };
  threshold: number;
  operational: {
    pass: boolean;
    http_status: number | null;
    selector_found: boolean;
    console_errors: string[];
    page_errors: string[];
    network_failures: string[];
    http_failures: string[];
  };
  diagnosis: string[];
  duration_ms: number;
  created_at: string;
};

const cache = globalThis as typeof globalThis & { __bidfastReferenceZip?: Promise<JSZip> };

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}

async function downloadDriveFile(): Promise<Buffer> {
  const id = referenceConfig.reference_pack.drive_file_id;
  const candidates = [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
    referenceConfig.reference_pack.download_url,
  ];

  let lastError = 'No download attempted';
  for (const url of candidates) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      const contentType = response.headers.get('content-type') || '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.ok && bytes.length > 1024 && !contentType.includes('text/html')) return bytes;

      const html = bytes.toString('utf8');
      const action = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"/i)?.[1];
      if (action) {
        const params = new URLSearchParams();
        for (const match of html.matchAll(/<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi)) {
          params.set(match[1], match[2].replaceAll('&amp;', '&'));
        }
        const confirmed = await fetch(`${action}?${params.toString()}`, {
          redirect: 'follow',
          headers: response.headers.get('set-cookie') ? { cookie: response.headers.get('set-cookie') as string } : {},
          signal: AbortSignal.timeout(60_000),
        });
        const confirmedBytes = Buffer.from(await confirmed.arrayBuffer());
        if (confirmed.ok && confirmedBytes.length > 1024) return confirmedBytes;
      }
      lastError = `Drive response ${response.status}, type ${contentType}, bytes ${bytes.length}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Unable to download BIDFAST reference pack: ${lastError}`);
}

async function referenceZip(): Promise<JSZip> {
  if (!cache.__bidfastReferenceZip) {
    cache.__bidfastReferenceZip = downloadDriveFile().then((bytes) => JSZip.loadAsync(bytes));
  }
  return cache.__bidfastReferenceZip;
}

export async function referenceImage(filename: string): Promise<Buffer> {
  const zip = await referenceZip();
  const direct = zip.file(filename);
  if (direct) return Buffer.from(await direct.async('nodebuffer'));
  const match = Object.values(zip.files).find((entry) => !entry.dir && entry.name.split('/').at(-1) === filename);
  if (!match) throw new Error(`Reference image not found in approved pack: ${filename}`);
  return Buffer.from(await match.async('nodebuffer'));
}

async function rgb(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  const result = await sharp(buffer)
    .flatten({ background: '#ffffff' })
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  return result;
}

function meanColor(data: Buffer): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = data.length / 3;
  for (let index = 0; index < data.length; index += 3) {
    r += data[index];
    g += data[index + 1];
    b += data[index + 2];
  }
  return [r / pixels, g / pixels, b / pixels];
}

function grayscale(data: Buffer): Float32Array {
  const output = new Float32Array(data.length / 3);
  for (let source = 0, target = 0; source < data.length; source += 3, target += 1) {
    output[target] = data[source] * 0.299 + data[source + 1] * 0.587 + data[source + 2] * 0.114;
  }
  return output;
}

function edgeVector(gray: Float32Array, width: number, height: number): Float32Array {
  const output = new Float32Array((width - 1) * (height - 1));
  let target = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const offset = y * width + x;
      output[target] = Math.min(255, Math.abs(gray[offset + 1] - gray[offset]) + Math.abs(gray[offset + width] - gray[offset]));
      target += 1;
    }
  }
  return output;
}

function similarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let difference = 0;
  for (let index = 0; index < length; index += 1) difference += Math.abs(a[index] - b[index]);
  return clampScore(1 - difference / (length * 255));
}

async function compareImages(reference: Buffer, screenshot: Buffer, geometry: number) {
  const width = 744;
  const height = 530;
  const [a, b] = await Promise.all([rgb(reference, width, height), rgb(screenshot, width, height)]);
  const pixel = similarity(a, b);
  const aGray = grayscale(a);
  const bGray = grayscale(b);
  const structural = similarity(aGray, bGray);
  const edge = similarity(edgeVector(aGray, width, height), edgeVector(bGray, width, height));
  const color = similarity(meanColor(a), meanColor(b));
  const composite = clampScore(pixel * 0.42 + structural * 0.25 + edge * 0.16 + color * 0.12 + geometry * 0.05);
  return { pixel, structural, edge, color, geometry: clampScore(geometry), composite };
}

function diagnose(scores: ParityReceipt['scores'], operational: ParityReceipt['operational']): string[] {
  const issues: string[] = [];
  if (!operational.selector_found) issues.push('Required visual anchor is missing or hidden.');
  if (operational.http_status !== 200) issues.push(`Route returned HTTP ${operational.http_status ?? 'unknown'}.`);
  if (operational.console_errors.length) issues.push(`${operational.console_errors.length} console error(s) detected.`);
  if (operational.page_errors.length) issues.push(`${operational.page_errors.length} uncaught page error(s) detected.`);
  if (operational.network_failures.length || operational.http_failures.length) issues.push('Application network failures were detected.');
  if (scores.pixel < 0.99) issues.push('Pixel composition differs from the approved reference.');
  if (scores.edge < 0.99) issues.push('Layout edges, borders, or component geometry differ from the reference.');
  if (scores.color < 0.99) issues.push('Color distribution differs from the approved reference.');
  if (scores.geometry < 0.99) issues.push('Required visual geometry is incomplete.');
  return issues;
}

export async function readyPage(page: Page): Promise<void> {
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.evaluate(async () => {
    if ('fonts' in document) await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
}

export function scenarioById(id: string): BidfastScenario {
  const scenario = referenceConfig.scenarios.find((item) => item.id === id);
  if (!scenario) throw new Error(`Unknown BIDFAST scenario: ${id}`);
  return scenario;
}

export async function runBidfastParity(scenarioId: string): Promise<ParityReceipt> {
  const started = Date.now();
  const scenario = scenarioById(scenarioId);
  const previewUrl = new URL(scenario.route, referenceConfig.preview_origin).toString();
  const reference = await referenceImage(scenario.reference);
  let browser: Browser | null = null;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    const context = await browser.newContext({
      viewport: referenceConfig.viewport,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'en-US',
    });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const networkFailures: string[] = [];
    const httpFailures: string[] = [];
    let httpStatus: number | null = null;

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500));
    });
    page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));
    page.on('requestfailed', (request) => networkFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.slice(0, 500)));
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().includes('favicon')) httpFailures.push(`${response.status()} ${response.url()}`.slice(0, 500));
    });

    const response = await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    httpStatus = response?.status() ?? null;
    await readyPage(page);
    const selectorFound = await page.locator(scenario.selector).first().isVisible().catch(() => false);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    const geometry = selectorFound && dimensions.width >= referenceConfig.viewport.width * 0.95 ? 1 : selectorFound ? 0.85 : 0.35;
    const screenshot = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));
    const scores = await compareImages(reference, screenshot, geometry);
    const instrumentation = (value: string) => value.startsWith('OPTIONS ') || value.startsWith('HEAD ') || value.includes('/.well-known/vercel/jwe') || value.includes('_vercel') || value.includes('vercel.live');
    const filteredNetworkFailures = networkFailures.filter((value) => !instrumentation(value));
    const filteredHttpFailures = httpFailures.filter((value) => !instrumentation(value));
    const operational = {
      pass: httpStatus === 200 && selectorFound && !pageErrors.length && !filteredNetworkFailures.length && !filteredHttpFailures.length,
      http_status: httpStatus,
      selector_found: selectorFound,
      console_errors: consoleErrors,
      page_errors: pageErrors,
      network_failures: filteredNetworkFailures,
      http_failures: filteredHttpFailures,
    };
    const pass = operational.pass && scores.composite >= referenceConfig.thresholds.visual;
    const receipt: ParityReceipt = {
      ok: true,
      pass,
      job_id: referenceConfig.job_id,
      scenario_id: scenario.id,
      route: scenario.route,
      preview_url: previewUrl,
      reference_filename: scenario.reference,
      reference_sha256: sha256(reference),
      screenshot_sha256: sha256(screenshot),
      browser_provider: launched.provider,
      browser_version: launched.version,
      viewport: referenceConfig.viewport,
      scores,
      threshold: referenceConfig.thresholds.visual,
      operational,
      diagnosis: diagnose(scores, operational),
      duration_ms: Date.now() - started,
      created_at: new Date().toISOString(),
    };
    await context.close();
    return receipt;
  } finally {
    await closeBrowser(browser);
  }
}
