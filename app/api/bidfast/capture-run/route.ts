import { z } from 'zod';
import referenceConfig from '../../../../config/bidfast-approved-references.json';
import { closeBrowser, launchBrowser } from '../../../../lib/browser';
import { scenarioById } from '../../../../lib/bidfast-parity';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const TOKEN = 'bf-parity-20260730-9c6f4d7a2e1b8f035ab4c1d0e7f29163';
const Query = z.object({ token: z.string(), scenario: z.string().min(1).max(80) });

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = Query.parse({ token: url.searchParams.get('token'), scenario: url.searchParams.get('scenario') });
  if (query.token !== TOKEN) return new Response('Not found', { status: 404 });

  const scenario = scenarioById(query.scenario);
  const previewUrl = new URL(scenario.route, referenceConfig.preview_origin).toString();
  let browser = null;
  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    const context = await browser.newContext({
      viewport: referenceConfig.viewport,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'en-US',
    });
    const page = await context.newPage();
    await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    await page.evaluate(async () => {
      if ('fonts' in document) await document.fonts.ready;
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false });
    await context.close();
    return new Response(screenshot, {
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'no-store',
        'content-disposition': `inline; filename="bidfast-${scenario.id}.jpg"`,
      },
    });
  } finally {
    await closeBrowser(browser);
  }
}
