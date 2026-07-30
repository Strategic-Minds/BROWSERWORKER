import chromiumBinary from '@sparticuz/chromium';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const WORKER_VERSION = '3.2.0-bidfast-parity';

const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY || '';
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || '';

export type BrowserProvider = 'browserbase' | 'serverless-chromium';

export async function launchBrowser(): Promise<{
  browser: Browser;
  version: string;
  provider: BrowserProvider;
}> {
  if (BROWSERBASE_API_KEY) {
    const sessionResp = await fetch('https://www.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bb-api-key': BROWSERBASE_API_KEY,
      },
      body: JSON.stringify({
        projectId: BROWSERBASE_PROJECT_ID || undefined,
        browserSettings: { viewport: { width: 1487, height: 1058 } },
      }),
    });

    if (!sessionResp.ok) {
      const error = await sessionResp.text();
      throw new Error(`Browserbase session failed: ${sessionResp.status} ${error.slice(0, 200)}`);
    }

    const session = (await sessionResp.json()) as { id: string; connectUrl?: string };
    const connectUrl =
      session.connectUrl ||
      `wss://connect.browserbase.com?apiKey=${BROWSERBASE_API_KEY}&sessionId=${session.id}`;
    const browser = await chromium.connectOverCDP(connectUrl);
    return { browser, version: browser.version(), provider: 'browserbase' };
  }

  const executablePath = await chromiumBinary.executablePath();
  const browser = await chromium.launch({
    executablePath,
    args: chromiumBinary.args,
    headless: true,
  });
  return { browser, version: browser.version(), provider: 'serverless-chromium' };
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // Browser cleanup is best effort and must not mask the parity receipt.
  }
}
