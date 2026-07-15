import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const WORKER_VERSION = '1.0.3';

export async function launchBrowser(): Promise<{ browser: Browser; version: string }> {
  // Use require for CommonJS compat with @sparticuz/chromium
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chromiumPack = require('@sparticuz/chromium');
  
  const executablePath = await chromiumPack.executablePath();

  const browser = await chromium.launch({
    args: [
      ...chromiumPack.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
    ],
    executablePath,
    headless: true,
  });

  const version = browser.version();
  return { browser, version };
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    console.error('[browser] Failed to close browser gracefully');
  }
}
