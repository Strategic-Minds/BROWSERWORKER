import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const WORKER_VERSION = '1.0.0';

export async function launchBrowser(): Promise<{ browser: Browser; version: string }> {
  // Dynamic import to avoid bundler issues
  const chromiumPack = await import('@sparticuz/chromium').then(m => m.default || m);
  const executablePath = await chromiumPack.executablePath();

  const browser = await chromium.launch({
    args: chromiumPack.args,
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
    // Best-effort close — log but don't throw
    console.error('[browser] Failed to close browser gracefully');
  }
}
