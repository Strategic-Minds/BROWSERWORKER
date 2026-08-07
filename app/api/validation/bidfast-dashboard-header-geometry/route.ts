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
    headers: { 'User-Agent': 'BIDFAST-Header-Geometry/1.0' },
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
        error: 'BIDFAST preview revision evidence was unavailable before geometry capture.',
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

    const geometry = await page.evaluate(() => {
      const readRect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) return null
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          selector,
          x: Number(rect.x.toFixed(3)),
          y: Number(rect.y.toFixed(3)),
          width: Number(rect.width.toFixed(3)),
          height: Number(rect.height.toFixed(3)),
          right: Number(rect.right.toFixed(3)),
          bottom: Number(rect.bottom.toFixed(3)),
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          transform: style.transform,
          position: style.position,
        }
      }

      const logoElement = document.querySelector<HTMLImageElement>('.bfm-logo')
      const logoRect = readRect('.bfm-logo')
      return {
        viewport: {
          inner_width: window.innerWidth,
          inner_height: window.innerHeight,
          device_pixel_ratio: window.devicePixelRatio,
        },
        document: {
          scroll_width: document.documentElement.scrollWidth,
          scroll_height: document.documentElement.scrollHeight,
        },
        dashboard: readRect('.bf-mobile-dashboard'),
        header: readRect('.bfm-header'),
        logo: logoElement && logoRect ? {
          ...logoRect,
          natural_width: logoElement.naturalWidth,
          natural_height: logoElement.naturalHeight,
          complete: logoElement.complete,
          current_src_path: new URL(logoElement.currentSrc || logoElement.src, window.location.href).pathname,
        } : null,
        header_actions: readRect('.bfm-header-actions'),
        notification_button: readRect('.bfm-icon-button'),
        avatar: readRect('.bfm-avatar'),
        search: readRect('.bfm-search'),
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

    const requiredRects = [
      ['dashboard', geometry.dashboard],
      ['header', geometry.header],
      ['logo', geometry.logo],
      ['header_actions', geometry.header_actions],
      ['notification_button', geometry.notification_button],
      ['avatar', geometry.avatar],
      ['search', geometry.search],
    ] as const

    for (const [name, rect] of requiredRects) {
      if (!rect) {
        failures.push(`${name}=missing`)
        continue
      }
      if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
        failures.push(`${name}=non_finite_geometry`)
      }
      if (rect.width <= 0 || rect.height <= 0) failures.push(`${name}=non_positive_geometry`)
      if (rect.display === 'none' || rect.visibility === 'hidden' || Number(rect.opacity) <= 0) failures.push(`${name}=not_visible`)
    }

    if (!geometry.logo?.complete || geometry.logo.natural_width <= 0 || geometry.logo.natural_height <= 0) {
      failures.push('logo_asset_not_loaded')
    }

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
      geometry,
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
