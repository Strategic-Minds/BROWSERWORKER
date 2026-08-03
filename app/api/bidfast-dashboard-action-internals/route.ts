import { createHash } from 'node:crypto'
import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const BIDFAST_ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'
const EXPECTED_REF = 'auto-builder/bidfast-complete-visual-system'
const DASHBOARD_REFERENCE = {
  drive_file_id: '1_GbJt7os0BTg6_9eLBp-Zltd1lk-FHGr',
  title: '01_BIDFAST_MOBILE_EXECUTIVE_DASHBOARD.png',
  sha256: 'f856235d88dae3b9eabf8f49816abb36a982f2054cc7002b52bdbdac60f207cb',
  theme: 'light',
  viewport: '390x844',
}

type SourceRevision = {
  commit_sha: string | null
  commit_ref: string | null
  deployment_id: string | null
  deployment_url: string | null
}

type BuildInfo = {
  source_revision?: SourceRevision
}

function validCommit(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value))
}

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

async function readBuildInfo(): Promise<{ status: number; source_revision: SourceRevision | null }> {
  const response = await fetch(`${BIDFAST_ORIGIN}/api/build-info`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'BIDFAST-Dashboard-Action-Internals/1.0' },
  })
  let body: BuildInfo = {}
  try {
    body = await response.json() as BuildInfo
  } catch {
    body = {}
  }
  return { status: response.status, source_revision: body.source_revision || null }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const expectedCommit = requestUrl.searchParams.get('expected_commit')
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null

  if (!validCommit(expectedCommit)) {
    return Response.json({
      ok: false,
      diagnostic_pass: false,
      error: 'A valid 40-character expected_commit is required.',
    }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const consoleErrors: string[] = []
  const appNetworkErrors: string[] = []
  const httpErrors: string[] = []

  try {
    const before = await readBuildInfo()
    const launched = await launchBrowser()
    browser = launched.browser
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()

    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('requestfailed', requestEvent => {
      const target = requestEvent.url()
      if (target.startsWith(BIDFAST_ORIGIN)) {
        appNetworkErrors.push(`${requestEvent.method()} ${target} ${requestEvent.failure()?.errorText || 'request failed'}`)
      }
    })
    page.on('response', response => {
      if (response.url().startsWith(BIDFAST_ORIGIN) && response.status() >= 400) {
        httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`)
      }
    })

    await page.addInitScript(() => localStorage.setItem('bidfast-theme', 'light'))
    const mainResponse = await page.goto(`${BIDFAST_ORIGIN}/dashboard`, {
      waitUntil: 'networkidle',
      timeout: 90000,
    })
    await page.waitForSelector('.bfm-actions > a', { timeout: 30000 })
    await page.waitForTimeout(800)

    const geometry = await page.evaluate(() => {
      const round = (value: number) => Number(value.toFixed(3))
      const box = (element: Element | null) => {
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return {
          x: round(rect.x),
          y: round(rect.y),
          width: round(rect.width),
          height: round(rect.height),
          top: round(rect.top),
          right: round(rect.right),
          bottom: round(rect.bottom),
          left: round(rect.left),
          center_x: round(rect.left + rect.width / 2),
          center_y: round(rect.top + rect.height / 2),
        }
      }
      const style = (element: Element | null) => {
        if (!element) return null
        const value = getComputedStyle(element)
        return {
          display: value.display,
          position: value.position,
          align_items: value.alignItems,
          justify_items: value.justifyItems,
          align_content: value.alignContent,
          justify_content: value.justifyContent,
          grid_template_columns: value.gridTemplateColumns,
          grid_template_rows: value.gridTemplateRows,
          row_gap: value.rowGap,
          column_gap: value.columnGap,
          gap: value.gap,
          padding_top: value.paddingTop,
          padding_right: value.paddingRight,
          padding_bottom: value.paddingBottom,
          padding_left: value.paddingLeft,
          font_size: value.fontSize,
          line_height: value.lineHeight,
          font_weight: value.fontWeight,
          letter_spacing: value.letterSpacing,
          transform: value.transform,
        }
      }

      const container = document.querySelector('.bfm-actions')
      const cards = [...document.querySelectorAll('.bfm-actions > a')]
      const actions = cards.map((card, index) => {
        const icon = card.querySelector('svg')
        const label = card.querySelector('span')
        const cardBox = box(card)
        const iconBox = box(icon)
        const labelBox = box(label)
        return {
          index,
          label: label?.textContent?.trim() || null,
          href: (card as HTMLAnchorElement).getAttribute('href'),
          card: cardBox,
          icon: iconBox,
          label_box: labelBox,
          card_style: style(card),
          icon_style: style(icon),
          label_style: style(label),
          offsets: cardBox && iconBox && labelBox ? {
            icon_center_x_from_card_center: round(iconBox.center_x - cardBox.center_x),
            icon_top_from_card_top: round(iconBox.top - cardBox.top),
            icon_center_y_from_card_top: round(iconBox.center_y - cardBox.top),
            label_center_x_from_card_center: round(labelBox.center_x - cardBox.center_x),
            label_top_from_icon_bottom: round(labelBox.top - iconBox.bottom),
            label_bottom_from_card_bottom: round(cardBox.bottom - labelBox.bottom),
            content_top: round(Math.min(iconBox.top, labelBox.top) - cardBox.top),
            content_bottom: round(cardBox.bottom - Math.max(iconBox.bottom, labelBox.bottom)),
          } : null,
        }
      })

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight, device_pixel_ratio: window.devicePixelRatio },
        page: {
          scroll_width: document.documentElement.scrollWidth,
          scroll_height: document.documentElement.scrollHeight,
          body_scroll_width: document.body.scrollWidth,
          body_scroll_height: document.body.scrollHeight,
        },
        container: box(container),
        container_style: style(container),
        actions,
      }
    })

    const screenshot = await page.screenshot({ type: 'png', fullPage: true })
    const after = await readBuildInfo()
    const sourceRevision = after.source_revision || before.source_revision
    const provenancePass = before.status === 200
      && after.status === 200
      && sourceRevision?.commit_sha === expectedCommit
      && sourceRevision?.commit_ref === EXPECTED_REF
      && before.source_revision?.commit_sha === expectedCommit
      && before.source_revision?.commit_ref === EXPECTED_REF

    const technicalPass = Boolean(mainResponse && mainResponse.status() < 400)
      && consoleErrors.length === 0
      && appNetworkErrors.length === 0
      && httpErrors.length === 0

    return Response.json({
      ok: provenancePass && technicalPass,
      diagnostic_pass: provenancePass && technicalPass,
      route: '/dashboard',
      target: `${BIDFAST_ORIGIN}/dashboard`,
      expected_commit: expectedCommit,
      expected_ref: EXPECTED_REF,
      source_revision: sourceRevision,
      provenance_before: before,
      provenance_after: after,
      provenance_pass: provenancePass,
      technical_pass: technicalPass,
      main_document_status: mainResponse?.status() || null,
      console_errors: consoleErrors,
      app_network_errors: appNetworkErrors,
      http_errors: httpErrors,
      reference: DASHBOARD_REFERENCE,
      geometry,
      screenshot: {
        mime_type: 'image/png',
        sha256: sha256(screenshot),
        bytes: screenshot.length,
        data: Buffer.from(screenshot).toString('base64'),
      },
      browser_version: launched.version,
      captured_at: new Date().toISOString(),
      release_authorized: false,
    }, { status: provenancePass && technicalPass ? 200 : 409, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({
      ok: false,
      diagnostic_pass: false,
      error: error instanceof Error ? error.message : 'Dashboard action internals diagnostic failed.',
      console_errors: consoleErrors,
      app_network_errors: appNetworkErrors,
      http_errors: httpErrors,
      release_authorized: false,
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    if (browser) await closeBrowser(browser)
  }
}
