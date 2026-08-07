import type { Page } from 'playwright-core';
import { validatePublicUrl } from './ssrf';
import type { VisualParitySpec } from './schemas';

const MAX_REFERENCE_BYTES = parseInt(process.env.BROWSER_MAX_REFERENCE_BYTES || String(8 * 1024 * 1024), 10);
const MAX_REDIRECTS = 3;

export type ResolvedVisualRegion = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  threshold_percent: number;
  critical: boolean;
};

export type VisualParityResult = {
  reference_id: string;
  reference_url: string;
  mode: 'exact' | 'scale-reference';
  pass: boolean;
  dimension_match: boolean;
  actual_width: number;
  actual_height: number;
  reference_width: number;
  reference_height: number;
  mismatch_percent: number;
  threshold_percent: number;
  mean_absolute_error: number;
  compared_pixels: number;
  regions: Array<{
    name: string;
    mismatch_percent: number;
    threshold_percent: number;
    critical: boolean;
    pass: boolean;
  }>;
  actual_screenshot: string;
  diff_image: string;
};

async function fetchReferenceImage(referenceUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  let current = referenceUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const check = await validatePublicUrl(current);
    if (!check.ok) throw new Error(`Unsafe reference URL: ${check.error}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(current, { redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Reference redirect missing Location header');
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) throw new Error(`Reference image returned HTTP ${response.status}`);
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
      throw new Error(`Reference URL must return png/jpeg/webp, received ${contentType || 'unknown'}`);
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_REFERENCE_BYTES) throw new Error('Reference image exceeds maximum size');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_REFERENCE_BYTES) throw new Error('Reference image exceeds maximum size');
    return { buffer: bytes, contentType };
  }
  throw new Error('Reference image redirected too many times');
}

async function resolveRegions(page: Page, spec: VisualParitySpec): Promise<ResolvedVisualRegion[]> {
  const viewport = page.viewportSize();
  if (!viewport) return [];
  const resolved: ResolvedVisualRegion[] = [];
  for (const region of spec.regions || []) {
    let box: { x: number; y: number; width: number; height: number } | null = null;
    if (region.selector) {
      box = await page.locator(region.selector).first().boundingBox().catch(() => null);
      if (!box) throw new Error(`Critical visual region selector not found: ${region.name} (${region.selector})`);
    } else if (
      region.x !== undefined && region.y !== undefined &&
      region.width !== undefined && region.height !== undefined
    ) {
      box = region.normalized
        ? {
            x: region.x * viewport.width,
            y: region.y * viewport.height,
            width: region.width * viewport.width,
            height: region.height * viewport.height,
          }
        : { x: region.x, y: region.y, width: region.width, height: region.height };
    }
    if (!box) continue;
    resolved.push({
      name: region.name,
      x: Math.max(0, Math.round(box.x)),
      y: Math.max(0, Math.round(box.y)),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height)),
      threshold_percent: region.threshold_percent,
      critical: region.critical,
    });
  }
  return resolved;
}

export async function runVisualParity(page: Page, spec: VisualParitySpec): Promise<VisualParityResult> {
  if (spec.disable_animations) {
    await page.addStyleTag({ content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        animation-iteration-count: 1 !important;
        transition: none !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
    ` }).catch(() => {});
  }

  if (spec.mask_selectors.length) {
    const selectors = spec.mask_selectors.join(',');
    await page.addStyleTag({ content: `${selectors}{visibility:hidden !important;}` }).catch(() => {});
  }

  if (spec.wait_for_fonts) {
    await page.evaluate(async () => {
      if ('fonts' in document) await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    }).catch(() => {});
  }
  if (spec.wait_ms > 0) await page.waitForTimeout(spec.wait_ms);

  const regions = await resolveRegions(page, spec);
  const actual = await page.screenshot({ type: 'png', fullPage: spec.full_page });
  const reference = await fetchReferenceImage(spec.reference_url);
  const actualData = `data:image/png;base64,${actual.toString('base64')}`;
  const referenceData = `data:${reference.contentType};base64,${reference.buffer.toString('base64')}`;

  const comparePage = await page.context().newPage();
  try {
    const result = await comparePage.evaluate(async ({ actualData, referenceData, pixelThreshold, mismatchThresholdPercent, mode, regions }) => {
      type R = { name: string; x: number; y: number; width: number; height: number; threshold_percent: number; critical: boolean };
      const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not decode comparison image'));
        image.src = src;
      });
      const actualImage = await loadImage(actualData);
      const referenceImage = await loadImage(referenceData);
      const width = actualImage.naturalWidth;
      const height = actualImage.naturalHeight;
      const dimensionMatch = width === referenceImage.naturalWidth && height === referenceImage.naturalHeight;

      const actualCanvas = document.createElement('canvas');
      actualCanvas.width = width; actualCanvas.height = height;
      const referenceCanvas = document.createElement('canvas');
      referenceCanvas.width = width; referenceCanvas.height = height;
      const diffCanvas = document.createElement('canvas');
      diffCanvas.width = width; diffCanvas.height = height;
      const ac = actualCanvas.getContext('2d', { willReadFrequently: true })!;
      const rc = referenceCanvas.getContext('2d', { willReadFrequently: true })!;
      const dc = diffCanvas.getContext('2d')!;
      ac.drawImage(actualImage, 0, 0, width, height);
      rc.drawImage(referenceImage, 0, 0, width, height);
      const a = ac.getImageData(0, 0, width, height);
      const r = rc.getImageData(0, 0, width, height);
      const diff = dc.createImageData(width, height);

      const maxComparePixels = 2500000;
      const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxComparePixels)));
      let mismatched = 0;
      let compared = 0;
      let absError = 0;
      const regionCounters = (regions as R[]).map(region => ({ region, compared: 0, mismatched: 0 }));
      const inRegion = (x: number, y: number, region: R) => x >= region.x && y >= region.y && x < region.x + region.width && y < region.y + region.height;

      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const i = (y * width + x) * 4;
          const dr = Math.abs(a.data[i] - r.data[i]);
          const dg = Math.abs(a.data[i + 1] - r.data[i + 1]);
          const db = Math.abs(a.data[i + 2] - r.data[i + 2]);
          const da = Math.abs(a.data[i + 3] - r.data[i + 3]);
          const mismatch = Math.max(dr, dg, db, da) > pixelThreshold;
          compared++;
          absError += (dr + dg + db) / 3;
          if (mismatch) mismatched++;
          for (const counter of regionCounters) {
            if (inRegion(x, y, counter.region)) {
              counter.compared++;
              if (mismatch) counter.mismatched++;
            }
          }
        }
      }

      for (let i = 0; i < a.data.length; i += 4) {
        const dr = Math.abs(a.data[i] - r.data[i]);
        const dg = Math.abs(a.data[i + 1] - r.data[i + 1]);
        const db = Math.abs(a.data[i + 2] - r.data[i + 2]);
        const mismatch = Math.max(dr, dg, db) > pixelThreshold;
        if (mismatch) {
          diff.data[i] = 255; diff.data[i + 1] = 30; diff.data[i + 2] = 30; diff.data[i + 3] = 220;
        } else {
          const gray = Math.round((a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3 * 0.35);
          diff.data[i] = gray; diff.data[i + 1] = gray; diff.data[i + 2] = gray; diff.data[i + 3] = 170;
        }
      }
      dc.putImageData(diff, 0, 0);

      const mismatchPercent = compared ? (mismatched / compared) * 100 : 100;
      const regionResults = regionCounters.map(({ region, compared: c, mismatched: m }) => {
        const percent = c ? (m / c) * 100 : 100;
        return {
          name: region.name,
          mismatch_percent: Number(percent.toFixed(4)),
          threshold_percent: region.threshold_percent,
          critical: region.critical,
          pass: percent <= region.threshold_percent,
        };
      });
      const criticalRegionsPass = regionResults.every(x => !x.critical || x.pass);
      const dimensionPass = mode === 'scale-reference' || dimensionMatch;
      const pass = dimensionPass && mismatchPercent <= mismatchThresholdPercent && criticalRegionsPass;

      const evidenceDataUrl = (canvas: HTMLCanvasElement, quality: number) => {
        const maxWidth = 1280;
        if (canvas.width <= maxWidth) return canvas.toDataURL('image/jpeg', quality);
        const scale = maxWidth / canvas.width;
        const out = document.createElement('canvas');
        out.width = maxWidth;
        out.height = Math.max(1, Math.round(canvas.height * scale));
        out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
        return out.toDataURL('image/jpeg', quality);
      };

      return {
        pass,
        dimension_match: dimensionMatch,
        actual_width: width,
        actual_height: height,
        reference_width: referenceImage.naturalWidth,
        reference_height: referenceImage.naturalHeight,
        mismatch_percent: Number(mismatchPercent.toFixed(4)),
        threshold_percent: mismatchThresholdPercent,
        mean_absolute_error: Number((compared ? absError / compared : 255).toFixed(4)),
        compared_pixels: compared,
        regions: regionResults,
        actual_screenshot: evidenceDataUrl(actualCanvas, 0.62),
        diff_image: evidenceDataUrl(diffCanvas, 0.68),
      };
    }, {
      actualData,
      referenceData,
      pixelThreshold: spec.pixel_threshold,
      mismatchThresholdPercent: spec.mismatch_threshold_percent,
      mode: spec.mode,
      regions,
    });

    return { reference_id: spec.reference_id, reference_url: spec.reference_url, mode: spec.mode, ...result };
  } finally {
    await comparePage.close().catch(() => {});
  }
}
