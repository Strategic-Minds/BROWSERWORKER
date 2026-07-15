import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const WORKER_VERSION = '2.0.0';

// chromium-min downloads a binary that bundles NSS and other required libs
// This is required for Vercel Lambda (Amazon Linux 2023) which lacks system NSS
export async function launchBrowser(): Promise<{ browser: Browser; version: string }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chromiumMin = require('@sparticuz/chromium-min');
  
  // The remote URL for the chromium binary that includes bundled NSS libs
  // Use the official sparticuz S3 release for v131
  const remoteExecutablePath = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';
  
  const executablePath = await chromiumMin.executablePath(remoteExecutablePath);
  
  const browser = await chromium.launch({
    args: [
      ...chromiumMin.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
    ],
    executablePath,
    headless: chromiumMin.headless as boolean | 'shell' | undefined,
    timeout: 30000,
  });

  const version = browser.version();
  return { browser, version };
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try { await browser.close(); } catch { /* ignore */ }
}
