import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const WORKER_VERSION = '1.0.6';

export async function launchBrowser(): Promise<{ browser: Browser; version: string }> {
  // @sparticuz/chromium downloads a pre-built binary to /tmp at runtime
  // and sets LD_LIBRARY_PATH so NSS and other libs resolve correctly
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chromiumPack = require('@sparticuz/chromium');

  // This call downloads + extracts the chromium binary to /tmp if not cached
  const executablePath = await chromiumPack.executablePath();

  const browser = await chromium.launch({
    args: chromiumPack.args,
    executablePath,
    headless: true,
    timeout: 30000,
  });

  const version = browser.version();
  return { browser, version };
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // ignore
  }
}
