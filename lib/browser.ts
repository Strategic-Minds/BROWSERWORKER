import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const WORKER_VERSION = '2.1.0';

/**
 * Launches Chromium using @sparticuz/chromium-min.
 * chromium-min downloads a binary that bundles its own NSS libraries,
 * solving the libnss3.so missing error on Vercel Lambda (Amazon Linux 2023).
 * The remote URL points to the official Sparticuz S3 release.
 */
export async function launchBrowser(): Promise<{ browser: Browser; version: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const chromiumMin = require('@sparticuz/chromium-min');

  // Remote tar containing Chromium binary + bundled NSS + shared libs
  const CHROMIUM_PACK_URL =
    'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

  const executablePath: string = await chromiumMin.executablePath(CHROMIUM_PACK_URL);

  const launchArgs: string[] = [
    ...(chromiumMin.args as string[]),
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-extensions',
  ];

  const browser = await chromium.launch({
    args: launchArgs,
    executablePath,
    headless: true,
    timeout: 60000,
  });

  const version = browser.version();
  return { browser, version };
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // ignore close errors
  }
}
