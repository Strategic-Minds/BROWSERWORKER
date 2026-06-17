import { chromium } from 'playwright-core';
import chromiumPack from '@sparticuz/chromium';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function launchChromiumReceipt() {
  const executablePath = await chromiumPack.executablePath();
  const browser = await chromium.launch({
    args: chromiumPack.args,
    executablePath,
    headless: true,
  });

  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.close();
  const version = browser.version();
  await browser.close();

  return {
    ok: true,
    status: 'pass',
    launched: true,
    browser: 'chromium',
    version,
    executablePath,
  };
}

export async function GET() {
  try {
    const receipt = await launchChromiumReceipt();
    return Response.json(receipt, { status: 200 });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        status: 'fail',
        launched: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
