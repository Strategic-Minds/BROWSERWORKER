import { chromium } from 'playwright-core';
import chromiumPack from '@sparticuz/chromium';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type JobPayload = {
  type?: string;
  url?: string;
  viewport?: { width?: number; height?: number };
};

async function launchBrowser() {
  const executablePath = await chromiumPack.executablePath();
  return chromium.launch({
    args: chromiumPack.args,
    executablePath,
    headless: true,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as JobPayload;

  if (!body.type) {
    return Response.json({ ok: false, error: 'Missing job type.' }, { status: 400 });
  }

  if (body.type !== 'launch-check' && body.type !== 'visualizer-flow') {
    return Response.json(
      { ok: false, error: `Unsupported job type: ${body.type}` },
      { status: 400 }
    );
  }

  try {
    const browser = await launchBrowser();
    const page = await browser.newPage({
      viewport: {
        width: body.viewport?.width ?? 1440,
        height: body.viewport?.height ?? 1200,
      },
    });

    let flowResult: Record<string, unknown> = {};

    if (body.type === 'launch-check') {
      await page.goto('about:blank');
      flowResult = {
        step: 'launch-check',
        ok: true,
      };
    } else {
      if (!body.url) {
        await browser.close();
        return Response.json(
          { ok: false, error: 'Missing url for visualizer-flow.' },
          { status: 400 }
        );
      }

      await page.goto(body.url, { waitUntil: 'networkidle', timeout: 120000 });
      flowResult = {
        step: 'navigate',
        url: page.url(),
        title: await page.title(),
      };
    }

    await page.close();
    const version = browser.version();
    await browser.close();

    return Response.json(
      {
        ok: true,
        status: 'pass',
        browser: 'chromium',
        version,
        receipt: flowResult,
      },
      { status: 200 }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        status: 'fail',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
