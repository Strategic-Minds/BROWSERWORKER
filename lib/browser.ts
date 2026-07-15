import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const WORKER_VERSION = '1.0.5';

// Find playwright's installed chromium binary
function findChromiumPath(): string | undefined {
  // Let playwright find its own binary (installed via postinstall)
  return undefined; // undefined = let playwright use its own downloaded binary
}

export async function launchBrowser(): Promise<{ browser: Browser; version: string }> {
  const executablePath = findChromiumPath();

  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--mute-audio',
      '--hide-scrollbars',
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
