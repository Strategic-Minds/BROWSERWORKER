import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'

export async function GET() {
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null
  try {
    const launched = await launchBrowser()
    browser = launched.browser
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.addInitScript(() => localStorage.setItem('bidfast-theme', 'light'))
    await page.goto(`${ORIGIN}/dashboard`, { waitUntil: 'networkidle', timeout: 90000 })
    await page.waitForTimeout(800)

    const geometry = await page.evaluate(() => {
      const rect = (selector: string, index = 0) => {
        const element = document.querySelectorAll(selector)[index] as HTMLElement | undefined
        if (!element) return null
        const box = element.getBoundingClientRect()
        return {
          x: Number(box.x.toFixed(2)),
          y: Number(box.y.toFixed(2)),
          width: Number(box.width.toFixed(2)),
          height: Number(box.height.toFixed(2)),
          bottom: Number(box.bottom.toFixed(2)),
        }
      }
      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        },
        logo: rect('.bfm-logo'),
        search: rect('.bfm-search'),
        overview_heading: rect('.bfm-section-heading'),
        metric_1: rect('.bfm-metric', 0),
        metric_2: rect('.bfm-metric', 1),
        metric_3: rect('.bfm-metric', 2),
        metric_4: rect('.bfm-metric', 3),
        quick_heading: rect('.bfm-section .bfm-title-row', 0),
        quick_actions: rect('.bfm-actions'),
        active_heading: rect('.bfm-bids-section .bfm-title-row'),
        active_bids: rect('.bfm-bids'),
        bid_1: rect('.bfm-bid', 0),
        bid_2: rect('.bfm-bid', 1),
        bid_3: rect('.bfm-bid', 2),
        alerts_heading: rect('.bfm-alert-section .bfm-title-row'),
        alerts: rect('.bfm-alerts'),
        bottom_navigation: rect('.bfm-bottom-nav'),
      }
    })

    await context.close()
    return Response.json({
      ok: true,
      route: '/dashboard',
      theme: 'light',
      geometry,
      target_geometry: {
        source: '01_BIDFAST_MOBILE_EXECUTIVE_DASHBOARD.png',
        scale_basis: 'Drive crop 570px wide normalized to 390px',
        search: { x: 0, y: 72, width: 390, height: 40 },
        overview_heading: { y: 136 },
        metric_1: { y: 163, height: 97 },
        metric_3: { y: 272, height: 97 },
        quick_heading: { y: 392 },
        quick_actions: { y: 416, height: 68 },
        active_heading: { y: 506 },
        active_bids: { y: 530, height: 218 },
        alerts_heading: { y: 762 },
        alerts: { y: 782, height: 99 },
        bottom_navigation: { y: 881, height: 64 },
      },
      browser_version: launched.version,
      timestamp: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  } finally {
    await closeBrowser(browser)
  }
}
