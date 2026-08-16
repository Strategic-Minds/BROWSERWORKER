import { chromium as playwrightChromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const WORKER_VERSION = '4.0.0';

/**
 * Launch a Chromium process owned by this BrowserWorker invocation.
 * The large serverless Chromium package is loaded lazily so lightweight
 * health/version routes remain available even if browser packaging fails.
 */
export async function launchBrowser(): Promise<{ browser: Browser; version: string }> {
  const { default: chromiumPack } = await import('@sparticuz/chromium');
  const explicitPath = (process.env.CHROME_EXECUTABLE_PATH || '').trim();
  const executablePath = explicitPath || await chromiumPack.executablePath();

  if (!executablePath) throw new Error('No Chromium executable could be resolved');

  const browser = await playwrightChromium.launch({
    executablePath,
    args: chromiumPack.args,
    headless: true,
    chromiumSandbox: false,
  });

  return { browser, version: browser.version() };
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try { await browser.close(); } catch {}
}
