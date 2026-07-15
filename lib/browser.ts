import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const WORKER_VERSION = '3.1.0';

const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY || '';
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || '';

/**
 * Launches a browser session via Browserbase cloud CDP.
 * Browserbase provides managed Chromium — no local binary or system libs required.
 * This is the production solution for Vercel Lambda (Amazon Linux 2023).
 */
export async function launchBrowser(): Promise<{ browser: Browser; version: string }> {
  if (!BROWSERBASE_API_KEY) {
    throw new Error('BROWSERBASE_API_KEY environment variable is required');
  }

  // Step 1: Create a Browserbase session
  const sessionResp = await fetch('https://www.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bb-api-key': BROWSERBASE_API_KEY,
    },
    body: JSON.stringify({
      projectId: BROWSERBASE_PROJECT_ID || undefined,
      browserSettings: {
        viewport: { width: 1440, height: 900 },
      },
    }),
  });

  if (!sessionResp.ok) {
    const err = await sessionResp.text();
    throw new Error(`Browserbase session failed: ${sessionResp.status} ${err.slice(0, 200)}`);
  }

  const session = await sessionResp.json() as { id: string; connectUrl?: string };
  const sessionId = session.id;

  // Step 2: Connect via CDP WebSocket
  const connectUrl = session.connectUrl ||
    `wss://connect.browserbase.com?apiKey=${BROWSERBASE_API_KEY}&sessionId=${sessionId}`;

  const browser = await chromium.connectOverCDP(connectUrl);
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
