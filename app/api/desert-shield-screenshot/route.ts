import { launchBrowser, closeBrowser } from '@/lib/browser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const TARGET = 'https://epoxy-contractor-website-git-au-a1440a-strategic-minds-advisory.vercel.app';
const VIEWPORTS = {
  desktop: { width: 1440, height: 1200 },
  tablet: { width: 1024, height: 1366 },
  mobile: { width: 390, height: 844 },
} as const;

type Device = keyof typeof VIEWPORTS;

export async function GET(request: Request) {
  const deviceParam = new URL(request.url).searchParams.get('device') || 'desktop';
  const device: Device = deviceParam in VIEWPORTS ? deviceParam as Device : 'desktop';
  let browser = null;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    const context = await browser.newContext({ viewport: VIEWPORTS[device], deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('h1', { timeout: 15000 });
    const image = await page.screenshot({
      type: 'jpeg',
      quality: 76,
      fullPage: true,
    });
    await page.close();
    await context.close();

    return new Response(new Uint8Array(image), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="desert-shield-${device}.jpg"`,
        'X-Validation-Target': TARGET,
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown screenshot error',
      device,
    }, { status: 500 });
  } finally {
    await closeBrowser(browser);
  }
}
