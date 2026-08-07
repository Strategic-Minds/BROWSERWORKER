import type { Page } from 'playwright-core';

export type AccessibilityAudit = {
  pass: boolean;
  h1_count: number;
  unnamed_interactive_count: number;
  unlabeled_control_count: number;
  duplicate_id_count: number;
  violations: string[];
};

export type ResponsiveAudit = {
  pass: boolean;
  viewport_width: number;
  viewport_height: number;
  horizontal_overflow_px: number;
  small_touch_target_count: number;
  small_touch_targets: Array<{ tag: string; text: string; width: number; height: number }>;
};

export async function runAccessibilityAudit(page: Page): Promise<AccessibilityAudit> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const node = el as HTMLElement;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const accessibleName = (el: Element) => {
      const node = el as HTMLElement;
      const aria = node.getAttribute('aria-label') || node.getAttribute('aria-labelledby') || node.getAttribute('title');
      if (aria) return aria.trim();
      const text = (node.textContent || '').trim();
      if (text) return text;
      const image = node.querySelector('img[alt]') as HTMLImageElement | null;
      return (image?.alt || '').trim();
    };

    const unnamed = Array.from(document.querySelectorAll('button,a[href],[role="button"],[role="link"]'))
      .filter(visible)
      .filter((el) => !accessibleName(el));

    const controls = Array.from(document.querySelectorAll('input:not([type="hidden"]),select,textarea')).filter(visible);
    const unlabeled = controls.filter((el) => {
      const node = el as HTMLInputElement;
      if (node.getAttribute('aria-label') || node.getAttribute('aria-labelledby') || node.getAttribute('title')) return false;
      if (node.id && document.querySelector(`label[for="${CSS.escape(node.id)}"]`)) return false;
      return !node.closest('label');
    });

    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id).filter(Boolean);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    const duplicateIds = [...counts.entries()].filter(([, count]) => count > 1);
    const h1Count = document.querySelectorAll('h1').length;
    const violations: string[] = [];
    if (h1Count !== 1) violations.push(`Expected exactly one h1, found ${h1Count}`);
    if (unnamed.length) violations.push(`${unnamed.length} visible interactive control(s) have no accessible name`);
    if (unlabeled.length) violations.push(`${unlabeled.length} visible form control(s) have no accessible label`);
    if (duplicateIds.length) violations.push(`${duplicateIds.length} duplicate DOM id value(s)`);

    return {
      pass: violations.length === 0,
      h1_count: h1Count,
      unnamed_interactive_count: unnamed.length,
      unlabeled_control_count: unlabeled.length,
      duplicate_id_count: duplicateIds.length,
      violations: violations.slice(0, 25),
    };
  });
}

export async function runResponsiveAudit(page: Page): Promise<ResponsiveAudit> {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const overflow = Math.max(0, document.documentElement.scrollWidth - viewportWidth);
    const shouldCheckTouch = viewportWidth <= 600;
    const small: Array<{ tag: string; text: string; width: number; height: number }> = [];
    if (shouldCheckTouch) {
      const candidates = Array.from(document.querySelectorAll('button,a[href],input,select,textarea,[role="button"]'));
      for (const el of candidates) {
        const node = el as HTMLElement;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) continue;
        if (rect.width < 44 || rect.height < 44) {
          small.push({
            tag: node.tagName.toLowerCase(),
            text: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 80),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
    }
    return {
      pass: overflow <= 2 && small.length === 0,
      viewport_width: viewportWidth,
      viewport_height: viewportHeight,
      horizontal_overflow_px: Math.round(overflow),
      small_touch_target_count: small.length,
      small_touch_targets: small.slice(0, 25),
    };
  });
}
