import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const WORKER_VERSION = '1.0.4';

export async function launchBrowser(): Promise<{ browser: Browser; version: string }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chromiumPack = require('@sparticuz/chromium');

  const executablePath = await chromiumPack.executablePath();

  // Vercel Lambda requires these flags
  const args = [
    ...chromiumPack.args,
    '--autoplay-policy=user-gesture-required',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-features=AudioServiceOutOfProcess',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-notifications',
    '--disable-offer-store-unmasked-wallet-cards',
    '--disable-popup-blocking',
    '--disable-print-preview',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-setuid-sandbox',
    '--disable-speech-api',
    '--disable-sync',
    '--hide-scrollbars',
    '--ignore-gpu-blacklist',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-pings',
    '--no-sandbox',
    '--no-zygote',
    '--password-store=basic',
    '--use-gl=swiftshader',
    '--use-mock-keychain',
    '--single-process',
  ];

  const browser = await chromium.launch({
    args,
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
