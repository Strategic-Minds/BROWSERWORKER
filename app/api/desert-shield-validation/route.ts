import { launchBrowser, closeBrowser, WORKER_VERSION } from '@/lib/browser';

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
  const started = Date.now();
  const deviceParam = new URL(request.url).searchParams.get('device') || 'desktop';
  const device: Device = deviceParam in VIEWPORTS ? deviceParam as Device : 'desktop';
  const viewport = VIEWPORTS[device];
  let browser = null;
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500));
    });
    page.on('requestfailed', (request) => {
      networkErrors.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText || 'failed'}`.slice(0, 500));
    });

    const response = await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('h1', { timeout: 15000 });

    const title = await page.title();
    const finalUrl = page.url();
    const h1 = (await page.locator('h1').first().textContent())?.replace(/\s+/g, ' ').trim() || '';
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    const selectorChecks = await page.evaluate(() => {
      const selectors = ['header', 'nav', '#services', '#work', '#process', '#reviews', '#quote', 'form', 'a[href="#quote"]'];
      return Object.fromEntries(selectors.map((selector) => {
        const element = document.querySelector(selector) as HTMLElement | null;
        return [selector, Boolean(element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)];
      }));
    });

    const counts = await page.evaluate(() => ({
      headings: document.querySelectorAll('h1,h2,h3').length,
      links: document.querySelectorAll('a').length,
      buttons: document.querySelectorAll('button').length,
      serviceCards: document.querySelectorAll('.serviceCard').length,
      projectCards: document.querySelectorAll('.projectCard').length,
      reviewCards: document.querySelectorAll('.reviewCard').length,
      formControls: document.querySelectorAll('input,select,textarea,button[type="submit"]').length,
    }));

    let mobileMenu = { tested: false, opened: false };
    if (device === 'mobile') {
      const menu = page.locator('.menuButton');
      if (await menu.count()) {
        await menu.click();
        mobileMenu = {
          tested: true,
          opened: await page.locator('nav.open').isVisible().catch(() => false),
        };
      }
    }

    const anchors = await page.locator('a[href^="#"]').evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.getAttribute('href'),
        text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
      })).slice(0, 30),
    );

    const quoteForm = {
      present: await page.locator('#quote form').count() > 0,
      requiredName: await page.locator('input[name="name"][required]').count() > 0,
      requiredPhone: await page.locator('input[name="phone"][required]').count() > 0,
      requiredEmail: await page.locator('input[name="email"][required]').count() > 0,
      requiredProject: await page.locator('select[name="project"][required]').count() > 0,
    };

    await page.close();
    await context.close();

    const requiredCopy = [
      'Stronger Floors',
      'Better Every Day',
      'Our Flooring Solutions',
      'Our 3-Step Process',
      'What Our Customers Are Saying',
      'Get a Free Quote',
    ];
    const copyChecks = Object.fromEntries(requiredCopy.map((copy) => [copy, bodyText.toLowerCase().includes(copy.toLowerCase())]));
    const status = response?.status() || 0;
    const passed = status >= 200 && status < 400 && h1.includes('Stronger Floors') &&
      Object.values(selectorChecks).every(Boolean) && Object.values(copyChecks).every(Boolean) &&
      quoteForm.present && quoteForm.requiredName && quoteForm.requiredPhone && quoteForm.requiredEmail &&
      consoleErrors.length === 0 && networkErrors.length === 0 && (!mobileMenu.tested || mobileMenu.opened);

    return Response.json({
      ok: passed,
      status: passed ? 'pass' : 'fail',
      worker_version: WORKER_VERSION,
      browser_version: launched.version,
      target: TARGET,
      device,
      viewport,
      navigation: { http_status: status, final_url: finalUrl },
      title,
      h1,
      selector_checks: selectorChecks,
      copy_checks: copyChecks,
      counts,
      mobile_menu: mobileMenu,
      quote_form: quoteForm,
      anchors,
      console_errors: consoleErrors,
      network_errors: networkErrors,
      screenshot_url: `/api/desert-shield-screenshot?device=${device}`,
      timing_ms: Date.now() - started,
      constraints: {
        hardcoded_target_only: true,
        external_messages: false,
        form_submission: false,
        production_mutation: false,
      },
    }, { status: passed ? 200 : 422 });
  } catch (error) {
    return Response.json({
      ok: false,
      status: 'fail',
      worker_version: WORKER_VERSION,
      target: TARGET,
      device,
      viewport,
      error: error instanceof Error ? error.message : 'Unknown validation error',
      console_errors: consoleErrors,
      network_errors: networkErrors,
      timing_ms: Date.now() - started,
    }, { status: 500 });
  } finally {
    await closeBrowser(browser);
  }
}
