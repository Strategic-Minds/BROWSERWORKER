import type { Page } from 'playwright-core';
import type { Step } from './schemas';

export interface StepResult {
  status: 'pass' | 'fail' | 'skip';
  duration_ms: number;
  result?: unknown;
  error?: string;
}

export interface Captures {
  consoleErrors: string[];
  networkErrors: string[];
  screenshots: string[];
}

export async function executeStep(page: Page, step: Step, captures: Captures): Promise<StepResult> {
  const start = Date.now();
  const timeout = step.timeout_ms ?? 30000;

  try {
    let result: unknown;

    switch (step.action) {
      case 'goto':
        await page.goto(step.url, { timeout, waitUntil: 'domcontentloaded' });
        result = { url: page.url() };
        break;

      case 'reload':
        await page.reload({ timeout, waitUntil: 'domcontentloaded' });
        result = { url: page.url() };
        break;

      case 'click':
        await page.click(step.selector, { timeout });
        result = { clicked: step.selector };
        break;

      case 'double_click':
        await page.dblclick(step.selector, { timeout });
        result = { double_clicked: step.selector };
        break;

      case 'hover':
        await page.hover(step.selector, { timeout });
        result = { hovered: step.selector };
        break;

      case 'fill':
        await page.fill(step.selector, step.value, { timeout });
        result = { filled: step.selector, length: step.value.length };
        break;

      case 'type':
        await page.type(step.selector, step.value, { timeout });
        result = { typed: step.selector, length: step.value.length };
        break;

      case 'press':
        await page.press(step.selector, step.key, { timeout });
        result = { pressed: step.key };
        break;

      case 'select_option':
        await page.selectOption(step.selector, step.value, { timeout });
        result = { selected: step.value };
        break;

      case 'check':
        await page.check(step.selector, { timeout });
        result = { checked: step.selector };
        break;

      case 'uncheck':
        await page.uncheck(step.selector, { timeout });
        result = { unchecked: step.selector };
        break;

      case 'scroll':
        if (step.selector) {
          await page.locator(step.selector).scrollIntoViewIfNeeded({ timeout });
        } else {
          await page.evaluate(({ x, y }: { x: number; y: number }) => window.scrollBy(x, y), {
            x: step.x ?? 0,
            y: step.y ?? 500,
          });
        }
        result = { scrolled: true };
        break;

      case 'wait':
        await page.waitForTimeout(step.milliseconds);
        result = { waited_ms: step.milliseconds };
        break;

      case 'wait_for_selector':
        await page.waitForSelector(step.selector, { timeout });
        result = { found: step.selector };
        break;

      case 'wait_for_url':
        await page.waitForURL(step.url, { timeout });
        result = { url: page.url() };
        break;

      case 'extract_text': {
        const selector = step.selector || 'body';
        const text = await page.textContent(selector, { timeout });
        result = { text: (text || '').slice(0, 2000) };
        break;
      }

      case 'extract_html': {
        const selector = step.selector || 'body';
        const html = await page.innerHTML(selector, { timeout });
        result = { html: html.slice(0, 5000) };
        break;
      }

      case 'extract_links': {
        const links = await page.$$eval('a[href]', (els) =>
          els.slice(0, 50).map(el => ({
            href: (el as HTMLAnchorElement).href,
            text: el.textContent?.trim().slice(0, 100) || '',
          }))
        );
        result = { links };
        break;
      }

      case 'extract_attribute': {
        const attr = await page.getAttribute(step.selector, step.attribute, { timeout });
        result = { attribute: step.attribute, value: attr };
        break;
      }

      case 'screenshot': {
        const buffer = await page.screenshot({
          fullPage: step.fullPage ?? false,
          type: 'png',
        });
        const b64 = buffer.toString('base64');
        const sizeKB = buffer.length / 1024;
        if (sizeKB < 100) {
          captures.screenshots.push(`data:image/png;base64,${b64}`);
          result = { size_kb: Math.round(sizeKB), stored: 'inline_base64' };
        } else {
          result = { size_kb: Math.round(sizeKB), stored: 'size_limit_exceeded' };
        }
        break;
      }

      case 'evaluate_safe': {
        // Only predefined safe operations — no raw JS from caller
        switch (step.operation) {
          case 'title':
            result = { title: await page.title() };
            break;
          case 'bodyHeight':
            result = { bodyHeight: await page.evaluate(() => document.body.scrollHeight) };
            break;
          case 'elementCount':
            result = { count: await page.evaluate((sel: string) => document.querySelectorAll(sel).length, step.selector || '*') };
            break;
          case 'performance':
            result = await page.evaluate(() => {
              const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
              return {
                domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
                loadComplete: Math.round(nav?.loadEventEnd || 0),
              };
            });
            break;
          case 'visibility':
            result = { visible: await page.isVisible(step.selector || 'body') };
            break;
        }
        break;
      }

      case 'get_title':
        result = { title: await page.title() };
        break;

      case 'get_url':
        result = { url: page.url() };
        break;

      case 'get_viewport':
        result = { viewport: page.viewportSize() };
        break;

      case 'validate_element': {
        const visible = await page.isVisible(step.selector, { timeout });
        if (!visible) throw new Error(`Element "${step.selector}" not visible`);
        result = { visible: true, selector: step.selector };
        break;
      }

      case 'validate_text': {
        const text = await page.textContent(step.selector, { timeout });
        const found = (text || '').includes(step.expected);
        if (!found) throw new Error(`Expected text "${step.expected}" not found in "${step.selector}"`);
        result = { found: true };
        break;
      }

      case 'validate_status':
        result = { url: page.url(), ok: true };
        break;

      case 'capture_accessibility_snapshot': {
        const snapshot = await page.accessibility.snapshot();
        result = { snapshot: JSON.stringify(snapshot).slice(0, 3000) };
        break;
      }

      case 'capture_console':
        result = { console_errors: captures.consoleErrors.length, entries: captures.consoleErrors.slice(0, 20) };
        break;

      case 'capture_network_errors':
        result = { network_errors: captures.networkErrors.length, entries: captures.networkErrors.slice(0, 20) };
        break;

      default:
        throw new Error(`Unknown action`);
    }

    return { status: 'pass', duration_ms: Date.now() - start, result };
  } catch (err) {
    return {
      status: 'fail',
      duration_ms: Date.now() - start,
      error: (err as Error).message?.slice(0, 500),
    };
  }
}
