import sharp from 'sharp';
import type { Browser } from 'playwright-core';
import referenceConfig from '../../../../../config/bidfast-approved-references.json';
import { closeBrowser, launchBrowser } from '../../../../../lib/browser';
import { readyPage, referenceImage, scenarioById } from '../../../../../lib/bidfast-parity';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const PANEL_WIDTH = 640;
const PANEL_HEIGHT = 456;
const HEADER_HEIGHT = 42;

function headerSvg(panelWidth = PANEL_WIDTH, headerHeight = HEADER_HEIGHT): Buffer {
  const width = panelWidth * 3;
  const labels = ['APPROVED REFERENCE', 'LIVE PREVIEW', 'AMPLIFIED DIFFERENCE'];
  const text = labels
    .map((label, index) => `<text x="${index * panelWidth + 12}" y="${Math.round(headerHeight * 0.66)}" font-family="Arial, sans-serif" font-size="${Math.max(11, Math.round(headerHeight * 0.36))}" font-weight="700" fill="#111111">${label}</text>`)
    .join('');
  return Buffer.from(`<svg width="${width}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/>${text}</svg>`);
}

async function makeBoard(reference: Buffer, screenshot: Buffer, compact = false): Promise<Buffer> {
  const panelWidth = compact ? 420 : PANEL_WIDTH;
  const panelHeight = compact ? 299 : PANEL_HEIGHT;
  const headerHeight = compact ? 32 : HEADER_HEIGHT;
  const quality = compact ? 48 : 84;
  const [referencePanel, livePanel] = await Promise.all([
    sharp(reference).flatten({ background: '#ffffff' }).resize(panelWidth, panelHeight, { fit: 'fill' }).jpeg({ quality }).toBuffer(),
    sharp(screenshot).flatten({ background: '#ffffff' }).resize(panelWidth, panelHeight, { fit: 'fill' }).jpeg({ quality }).toBuffer(),
  ]);
  const differencePanel = await sharp(referencePanel)
    .composite([{ input: livePanel, blend: 'difference' }])
    .modulate({ brightness: 1.8, saturation: 2.2 })
    .jpeg({ quality })
    .toBuffer();

  return sharp({
    create: {
      width: panelWidth * 3,
      height: panelHeight + headerHeight,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite([
      { input: headerSvg(panelWidth, headerHeight), top: 0, left: 0 },
      { input: referencePanel, top: headerHeight, left: 0 },
      { input: livePanel, top: headerHeight, left: panelWidth },
      { input: differencePanel, top: headerHeight, left: panelWidth * 2 },
    ])
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ scenario: string }> },
): Promise<Response> {
  const { scenario: scenarioId } = await context.params;
  const scenario = scenarioById(scenarioId);
  const previewUrl = new URL(scenario.route, referenceConfig.preview_origin).toString();
  const reference = await referenceImage(scenario.reference);
  const wantsJson = new URL(request.url).searchParams.get('format') === 'json';
  let browser: Browser | null = null;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    const browserContext = await browser.newContext({
      viewport: referenceConfig.viewport,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'en-US',
    });
    const page = await browserContext.newPage();
    await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    await readyPage(page);
    const screenshot = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));
    await browserContext.close();

    const board = await makeBoard(reference, screenshot, wantsJson);
    if (wantsJson) {
      return Response.json({
        ok: true,
        scenario: scenario.id,
        mime: 'image/jpeg',
        width: 1260,
        height: 331,
        base64: board.toString('base64'),
      }, { headers: { 'cache-control': 'no-store' } });
    }

    return new Response(new Uint8Array(board), {
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'no-store',
        'content-disposition': `inline; filename="bidfast-${scenario.id}-evidence.jpg"`,
      },
    });
  } finally {
    await closeBrowser(browser);
  }
}
