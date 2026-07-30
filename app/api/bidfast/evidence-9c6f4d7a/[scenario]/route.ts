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

function headerSvg(): Buffer {
  const width = PANEL_WIDTH * 3;
  const labels = ['APPROVED REFERENCE', 'LIVE PREVIEW', 'AMPLIFIED DIFFERENCE'];
  const text = labels
    .map((label, index) => `<text x="${index * PANEL_WIDTH + 14}" y="27" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#111111">${label}</text>`)
    .join('');
  return Buffer.from(`<svg width="${width}" height="${HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/>${text}</svg>`);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ scenario: string }> },
): Promise<Response> {
  const { scenario: scenarioId } = await context.params;
  const scenario = scenarioById(scenarioId);
  const previewUrl = new URL(scenario.route, referenceConfig.preview_origin).toString();
  const reference = await referenceImage(scenario.reference);
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

    const [referencePanel, livePanel] = await Promise.all([
      sharp(reference).flatten({ background: '#ffffff' }).resize(PANEL_WIDTH, PANEL_HEIGHT, { fit: 'fill' }).jpeg({ quality: 82 }).toBuffer(),
      sharp(screenshot).flatten({ background: '#ffffff' }).resize(PANEL_WIDTH, PANEL_HEIGHT, { fit: 'fill' }).jpeg({ quality: 82 }).toBuffer(),
    ]);
    const differencePanel = await sharp(referencePanel)
      .composite([{ input: livePanel, blend: 'difference' }])
      .modulate({ brightness: 1.8, saturation: 2.2 })
      .jpeg({ quality: 84 })
      .toBuffer();

    const board = await sharp({
      create: {
        width: PANEL_WIDTH * 3,
        height: PANEL_HEIGHT + HEADER_HEIGHT,
        channels: 3,
        background: '#ffffff',
      },
    })
      .composite([
        { input: headerSvg(), top: 0, left: 0 },
        { input: referencePanel, top: HEADER_HEIGHT, left: 0 },
        { input: livePanel, top: HEADER_HEIGHT, left: PANEL_WIDTH },
        { input: differencePanel, top: HEADER_HEIGHT, left: PANEL_WIDTH * 2 },
      ])
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();

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
