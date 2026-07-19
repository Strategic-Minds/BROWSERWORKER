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

function isVercelPreviewNoise(error: string) {
  return error.includes('/.well-known/vercel/jwe') ||
    error.startsWith(`OPTIONS ${TARGET}`) ||
    error.startsWith(`HEAD ${TARGET}`);
}

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
    page.on('requestfailed', (failedRequest) => {
      networkErrors.push(`${failedRequest.method()} ${failedRequest.url()} — ${failedRequest.failure()?.errorText || 'failed'}`.slice(0, 500));
    });

    const response = await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('h1', { timeout: 15000 });

    const title = await page.title();
    const finalUrl = page.url();
    const h1 = (await page.locator('h1').first().textContent())?.replace(/\s+/g, ' ').trim() || '';
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    const selectorChecks = await page.evaluate(() => {
      const selectors = ['header', '#services', '#work', '#process', '#reviews', '#quote', 'form'];
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

    const responsiveNavigation = {
      desktopNavVisible: false,
      mobileMenuTested: false,
      mobileMenuOpened: false,
      mobileQuoteVisible: false,
    };

    if (device === 'mobile') {
      responsiveNavigation.mobileMenuTested = await page.locator('.menuButton').isVisible().catch(() => false);
      responsiveNavigation.mobileQuoteVisible = await page.locator('.mobileQuote').isVisible().catch(() => false);
      if (responsiveNavigation.mobileMenuTested) {
        await page.locator('.menuButton').click();
        responsiveNavigation.mobileMenuOpened = await page.locator('nav.open').isVisible().catch(() => false);
        await page.locator('.menuButton').click();
      }
    } else {
      responsiveNavigation.desktopNavVisible = await page.locator('nav.nav').isVisible().catch(() => false);
    }

    await page.locator('a[href="#services"]').first().click();
    await page.waitForTimeout(150);
    const servicesHashPassed = (await page.evaluate(() => window.location.hash)) === '#services';
    const quoteLink = device === 'mobile' ? page.locator('.mobileQuote') : page.locator('.headerActions a[href="#quote"]');
    await quoteLink.click();
    await page.waitForTimeout(150);
    const quoteHashPassed = (await page.evaluate(() => window.location.hash)) === '#quote';

    const quoteForm = {
      present: await page.locator('#quote form').count() > 0,
      requiredName: await page.locator('input[name="name"][required]').count() > 0,
      requiredPhone: await page.locator('input[name="phone"][required]').count() > 0,
      requiredEmail: await page.locator('input[name="email"][required]').count() > 0,
      requiredProject: await page.locator('select[name="project"][required]').count() > 0,
      clientSideSubmitPassed: false,
    };

    await page.locator('input[name="name"]').fill('BrowserWorker Validation');
    await page.locator('input[name="phone"]').fill('6235550100');
    await page.locator('input[name="email"]').fill('validation@example.com');
    await page.locator('select[name="project"]').selectOption({ label: 'Garage Floor' });
    await page.locator('button[type="submit"]').click();
    quoteForm.clientSideSubmitPassed = await page.locator('.formSuccess.show').isVisible().catch(() => false);

    const anchors = await page.locator('a[href^="#"]').evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.getAttribute('href'),
        text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
      })).slice(0, 30),
    );

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
    const ignoredNetworkErrors = networkErrors.filter(isVercelPreviewNoise);
    const materialNetworkErrors = networkErrors.filter((error) => !isVercelPreviewNoise(error));
    const ignoredConsoleErrors = consoleErrors.filter((error) => error.includes('ERR_INVALID_URL') && materialNetworkErrors.length === 0);
    const materialConsoleErrors = consoleErrors.filter((error) => !ignoredConsoleErrors.includes(error));
    const navigationPassed = device === 'mobile'
      ? responsiveNavigation.mobileMenuTested && responsiveNavigation.mobileMenuOpened && responsiveNavigation.mobileQuoteVisible
      : responsiveNavigation.desktopNavVisible;
    const countsPassed = counts.serviceCards === 3 && counts.projectCards === 3 && counts.reviewCards === 3 && counts.formControls >= 8;
    const passed = status >= 200 && status < 400 && h1.includes('Stronger Floors') &&
      Object.values(selectorChecks).every(Boolean) && Object.values(copyChecks).every(Boolean) && countsPassed &&
      navigationPassed && servicesHashPassed && quoteHashPassed && quoteForm.present && quoteForm.requiredName &&
      quoteForm.requiredPhone && quoteForm.requiredEmail && quoteForm.requiredProject && quoteForm.clientSideSubmitPassed &&
      materialConsoleErrors.length === 0 && materialNetworkErrors.length === 0;

    return Response.json({
      ok: passed,
      status: passed ? 'pass' : 'fail',
      worker_version: WORKER_VERSION,
      browser_version: launched.version,
      target: TARGET,
      device,
      viewport,
      navigation: {
        http_status: status,
        final_url: finalUrl,
        services_anchor: servicesHashPassed,
        quote_anchor: quoteHashPassed,
        responsive: responsiveNavigation,
      },
      title,
      h1,
      selector_checks: selectorChecks,
      copy_checks: copyChecks,
      counts,
      quote_form: quoteForm,
      anchors,
      console_errors: materialConsoleErrors,
      network_errors: materialNetworkErrors,
      ignored_infrastructure_noise: {
        console: ignoredConsoleErrors,
        network: ignoredNetworkErrors,
      },
      screenshot_url: `/api/desert-shield-screenshot?device=${device}`,
      timing_ms: Date.now() - started,
      constraints: {
        hardcoded_target_only: true,
        external_messages: false,
        form_submission: 'client-side simulation only',
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
