import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const BIDFAST_ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'
const EXPECTED_REF = 'auto-builder/bidfast-complete-visual-system'
const DASHBOARD_PATH = '/dashboard'
const MOBILE_VIEWPORT = { width: 390, height: 844 }

type SourceRevision = {
  commit_sha: string | null
  commit_ref: string | null
  deployment_id: string | null
  deployment_url: string | null
}

type BuildInfo = {
  ok?: boolean
  source_revision?: SourceRevision
}

function isCommitSha(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value))
}

async function readBuildInfo(): Promise<{ status: number; body: BuildInfo }> {
  const response = await fetch(`${BIDFAST_ORIGIN}/api/build-info`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'BIDFAST-Logo-Content-Bounds/1.0' },
  })
  let body: BuildInfo = {}
  try {
    body = await response.json() as BuildInfo
  } catch {
    body = {}
  }
  return { status: response.status, body }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const expectedCommit = requestUrl.searchParams.get('expected_commit')
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null

  if (!isCommitSha(expectedCommit)) {
    return Response.json({
      ok: false,
      provenance_pass: false,
      route: DASHBOARD_PATH,
      error: 'A valid 40-character expected_commit is required.',
    }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const before = await readBuildInfo()
    if (before.status !== 200 || before.body.ok !== true || !before.body.source_revision) {
      return Response.json({
        ok: false,
        provenance_pass: false,
        route: DASHBOARD_PATH,
        error: 'BIDFAST preview revision evidence was unavailable before logo analysis.',
        build_info_status: before.status,
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }

    const launched = await launchBrowser()
    browser = launched.browser
    const context = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    const target = `${BIDFAST_ORIGIN}${DASHBOARD_PATH}`
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForSelector('.bf-mobile-dashboard', { state: 'visible', timeout: 60_000 })
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('.bfm-logo')
      return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
    }, undefined, { timeout: 60_000 })

    const analysis = await page.evaluate(() => {
      type PixelBounds = {
        left: number
        top: number
        right: number
        bottom: number
        width: number
        height: number
      }

      const logo = document.querySelector<HTMLImageElement>('.bfm-logo')
      if (!logo) return { error: 'logo_missing' }

      const rect = logo.getBoundingClientRect()
      const style = getComputedStyle(logo)
      const canvas = document.createElement('canvas')
      canvas.width = logo.naturalWidth
      canvas.height = logo.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return { error: 'canvas_context_unavailable' }

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(logo, 0, 0, canvas.width, canvas.height)

      let imageData: ImageData
      try {
        imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }

      const createAccumulator = () => ({
        left: canvas.width,
        top: canvas.height,
        right: -1,
        bottom: -1,
        count: 0,
      })
      const alpha = createAccumulator()
      const nonWhite = createAccumulator()

      const include = (accumulator: ReturnType<typeof createAccumulator>, x: number, y: number) => {
        accumulator.left = Math.min(accumulator.left, x)
        accumulator.top = Math.min(accumulator.top, y)
        accumulator.right = Math.max(accumulator.right, x)
        accumulator.bottom = Math.max(accumulator.bottom, y)
        accumulator.count += 1
      }

      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4
          const red = imageData.data[offset]
          const green = imageData.data[offset + 1]
          const blue = imageData.data[offset + 2]
          const pixelAlpha = imageData.data[offset + 3]
          if (pixelAlpha > 8) include(alpha, x, y)
          if (pixelAlpha > 8 && (red < 248 || green < 248 || blue < 248)) include(nonWhite, x, y)
        }
      }

      const finalize = (accumulator: ReturnType<typeof createAccumulator>): PixelBounds | null => {
        if (accumulator.count === 0 || accumulator.right < accumulator.left || accumulator.bottom < accumulator.top) return null
        return {
          left: accumulator.left,
          top: accumulator.top,
          right: accumulator.right + 1,
          bottom: accumulator.bottom + 1,
          width: accumulator.right - accumulator.left + 1,
          height: accumulator.bottom - accumulator.top + 1,
        }
      }

      const toRendered = (bounds: PixelBounds | null) => {
        if (!bounds) return null
        const scaleX = rect.width / logo.naturalWidth
        const scaleY = rect.height / logo.naturalHeight
        return {
          x: Number((rect.x + bounds.left * scaleX).toFixed(3)),
          y: Number((rect.y + bounds.top * scaleY).toFixed(3)),
          right: Number((rect.x + bounds.right * scaleX).toFixed(3)),
          bottom: Number((rect.y + bounds.bottom * scaleY).toFixed(3)),
          width: Number((bounds.width * scaleX).toFixed(3)),
          height: Number((bounds.height * scaleY).toFixed(3)),
        }
      }

      const alphaBounds = finalize(alpha)
      const nonWhiteBounds = finalize(nonWhite)

      return {
        logo: {
          x: Number(rect.x.toFixed(3)),
          y: Number(rect.y.toFixed(3)),
          right: Number(rect.right.toFixed(3)),
          bottom: Number(rect.bottom.toFixed(3)),
          width: Number(rect.width.toFixed(3)),
          height: Number(rect.height.toFixed(3)),
          natural_width: logo.naturalWidth,
          natural_height: logo.naturalHeight,
          complete: logo.complete,
          current_src_path: new URL(logo.currentSrc || logo.src, window.location.href).pathname,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          object_fit: style.objectFit,
          object_position: style.objectPosition,
        },
        pixels: {
          total: canvas.width * canvas.height,
          alpha_visible_count: alpha.count,
          non_white_count: nonWhite.count,
          alpha_visible_ratio: Number((alpha.count / (canvas.width * canvas.height)).toFixed(6)),
          non_white_ratio: Number((nonWhite.count / (canvas.width * canvas.height)).toFixed(6)),
        },
        natural_bounds: {
          alpha_visible: alphaBounds,
          non_white: nonWhiteBounds,
        },
        rendered_bounds: {
          alpha_visible: toRendered(alphaBounds),
          non_white: toRendered(nonWhiteBounds),
        },
        viewport: {
          inner_width: window.innerWidth,
          inner_height: window.innerHeight,
          device_pixel_ratio: window.devicePixelRatio,
        },
      }
    })

    await context.close()

    const after = await readBuildInfo()
    const beforeRevision = before.body.source_revision
    const afterRevision = after.body.source_revision
    const failures: string[] = []

    if (response?.status() !== 200) failures.push(`main_document_status=${String(response?.status())}`)
    if (after.status !== 200 || after.body.ok !== true || !afterRevision) {
      failures.push(`post_capture_build_info_status=${after.status}`)
    } else {
      if (beforeRevision.commit_sha !== expectedCommit) failures.push(`before_commit=${String(beforeRevision.commit_sha)}`)
      if (afterRevision.commit_sha !== expectedCommit) failures.push(`after_commit=${String(afterRevision.commit_sha)}`)
      if (beforeRevision.commit_ref !== EXPECTED_REF) failures.push(`before_ref=${String(beforeRevision.commit_ref)}`)
      if (afterRevision.commit_ref !== EXPECTED_REF) failures.push(`after_ref=${String(afterRevision.commit_ref)}`)
      if (beforeRevision.commit_sha !== afterRevision.commit_sha) failures.push('commit_changed_during_capture')
      if (beforeRevision.deployment_id && afterRevision.deployment_id && beforeRevision.deployment_id !== afterRevision.deployment_id) failures.push('deployment_changed_during_capture')
      if (beforeRevision.deployment_url && afterRevision.deployment_url && beforeRevision.deployment_url !== afterRevision.deployment_url) failures.push('deployment_url_changed_during_capture')
    }

    if ('error' in analysis) failures.push(`analysis=${String(analysis.error)}`)
    if (!('logo' in analysis) || !analysis.logo) failures.push('logo_geometry_missing')
    if ('logo' in analysis && analysis.logo) {
      if (!analysis.logo.complete || analysis.logo.natural_width <= 0 || analysis.logo.natural_height <= 0) failures.push('logo_asset_not_loaded')
      if (analysis.logo.width <= 0 || analysis.logo.height <= 0) failures.push('logo_non_positive_geometry')
      if (analysis.logo.display === 'none' || analysis.logo.visibility === 'hidden' || Number(analysis.logo.opacity) <= 0) failures.push('logo_not_visible')
    }
    if (!('natural_bounds' in analysis) || !analysis.natural_bounds?.alpha_visible) failures.push('alpha_visible_bounds_missing')
    if (!('natural_bounds' in analysis) || !analysis.natural_bounds?.non_white) failures.push('non_white_bounds_missing')
    if (!('pixels' in analysis) || analysis.pixels.alpha_visible_count <= 0) failures.push('alpha_visible_pixels_missing')
    if (!('pixels' in analysis) || analysis.pixels.non_white_count <= 0) failures.push('non_white_pixels_missing')

    const provenancePass = failures.filter(failure => failure.includes('commit') || failure.includes('ref') || failure.includes('deployment') || failure.includes('build_info')).length === 0

    return Response.json({
      ok: failures.length === 0,
      provenance_pass: provenancePass,
      route: DASHBOARD_PATH,
      theme: 'light',
      viewport: 'mobile',
      target,
      main_document_status: response?.status() || null,
      source_revision: afterRevision || beforeRevision,
      provenance: {
        expected_commit: expectedCommit,
        expected_ref: EXPECTED_REF,
        before: beforeRevision,
        after: afterRevision || null,
      },
      analysis,
      failures,
      browser_version: launched.version,
      timestamp: new Date().toISOString(),
    }, { status: failures.length === 0 ? 200 : 409, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({
      ok: false,
      provenance_pass: false,
      route: DASHBOARD_PATH,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await closeBrowser(browser)
  }
}
