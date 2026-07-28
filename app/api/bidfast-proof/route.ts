import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'
const ROUTES = new Set([
  '/', '/pricing', '/login', '/signup', '/dashboard', '/analytics', '/opportunities',
  '/projects', '/documents', '/takeoffs', '/estimates', '/proposals', '/approvals',
  '/mission-control', '/assistant', '/admin', '/settings/company',
])

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  mobile_large: { width: 430, height: 932 },
  tablet: { width: 834, height: 1194 },
  desktop: { width: 1440, height: 1200 },
} as const

type ViewportName = keyof typeof VIEWPORTS
type EvidenceFormat = 'json' | 'summary' | 'image'

type CaptureResult = {
  ok: boolean
  evidence_pass: boolean
  target: string
  route: string
  theme: 'light' | 'dark'
  viewport: { name: ViewportName; width: number; height: number }
  title?: string
  final_url?: string
  main_document_status?: number
  document_theme?: string | null
  root_background?: string
  root_color?: string
  page_height?: number
  links_count?: number
  screenshot?: { mime_type: 'image/jpeg'; encoding?: 'base64'; bytes: number; data?: string }
  console_errors: string[]
  app_network_errors: string[]
  http_errors: string[]
  ignored_network_events: string[]
  browser_version?: string
  timestamp: string
  error?: string
}

function isInfrastructureUrl(url: string): boolean {
  return url.includes('/.well-known/vercel/jwe') ||
    url.includes('vercel.live/_next-live/') ||
    url.includes('/_next-live/')
}

function classifyFailedRequest(method: string, url: string, failure: string, target: string): 'ignored' | 'app' {
  if (isInfrastructureUrl(url)) return 'ignored'
  if (method === 'OPTIONS' && url.replace(/\/$/, '') === ORIGIN) return 'ignored'
  if (method === 'HEAD' && url.split('?')[0] === target.split('?')[0]) return 'ignored'
  if (failure.includes('ERR_ABORTED') && url.includes('_rsc=')) return 'ignored'
  return 'app'
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const route = requestUrl.searchParams.get('route') || '/dashboard'
  const theme = requestUrl.searchParams.get('theme') === 'dark' ? 'dark' : 'light'
  const rawFormat = requestUrl.searchParams.get('format')
  const format: EvidenceFormat = rawFormat === 'image' ? 'image' : rawFormat === 'summary' ? 'summary' : 'json'
  const requestedViewport = requestUrl.searchParams.get('viewport') || 'desktop'
  const viewportName: ViewportName = requestedViewport in VIEWPORTS ? requestedViewport as ViewportName : 'desktop'
  const viewport = VIEWPORTS[viewportName]

  if (!ROUTES.has(route)) {
    return Response.json({ ok: false, error: 'Route is not allowlisted.' }, { status: 400 })
  }

  const target = new URL(route, ORIGIN).toString()
  const consoleErrors: string[] = []
  const appNetworkErrors: string[] = []
  const httpErrors: string[] = []
  const ignoredNetworkEvents: string[] = []
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null

  try {
    const launched = await launchBrowser()
    browser = launched.browser
    const contexts = browser.contexts()
    const context = contexts[0] || await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.setViewportSize(viewport)

    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 1000))
    })
    page.on('pageerror', error => consoleErrors.push(error.message.slice(0, 1000)))
    page.on('requestfailed', failed => {
      const failure = failed.failure()?.errorText || 'request failed'
      const event = `${failed.method()} ${failed.url()} — ${failure}`.slice(0, 1500)
      if (classifyFailedRequest(failed.method(), failed.url(), failure, target) === 'ignored') {
        ignoredNetworkEvents.push(event)
      } else {
        appNetworkErrors.push(event)
      }
    })
    page.on('response', response => {
      if (response.status() < 400 || isInfrastructureUrl(response.url())) return
      httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`.slice(0, 1500))
    })

    await page.addInitScript((nextTheme: string) => {
      localStorage.setItem('bidfast-theme', nextTheme)
    }, theme)

    const mainResponse = await page.goto(target, { waitUntil: 'networkidle', timeout: 90000 })
    await page.waitForTimeout(1200)

    const metrics = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      return {
        documentTheme: document.documentElement.dataset.theme || localStorage.getItem('bidfast-theme'),
        rootBackground: styles.backgroundColor,
        rootColor: styles.color,
        pageHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
        linksCount: document.querySelectorAll('a[href]').length,
      }
    })

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 78, fullPage: true })

    if (format === 'image') {
      await page.close()
      const body = new Uint8Array(screenshot)
      return new Response(body, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(body.byteLength),
          'Cache-Control': 'no-store',
          'X-BIDFAST-Route': route,
          'X-BIDFAST-Theme': theme,
          'X-BIDFAST-Viewport': viewportName,
        },
      })
    }

    const evidencePass = consoleErrors.length === 0 && appNetworkErrors.length === 0 && httpErrors.length === 0 &&
      mainResponse !== null && mainResponse.status() < 400 && metrics.documentTheme === theme

    const result: CaptureResult = {
      ok: true,
      evidence_pass: evidencePass,
      target,
      route,
      theme,
      viewport: { name: viewportName, ...viewport },
      title: await page.title(),
      final_url: page.url(),
      main_document_status: mainResponse?.status(),
      document_theme: metrics.documentTheme,
      root_background: metrics.rootBackground,
      root_color: metrics.rootColor,
      page_height: metrics.pageHeight,
      links_count: metrics.linksCount,
      screenshot: format === 'summary'
        ? { mime_type: 'image/jpeg', bytes: screenshot.byteLength }
        : { mime_type: 'image/jpeg', encoding: 'base64', bytes: screenshot.byteLength, data: Buffer.from(screenshot).toString('base64') },
      console_errors: consoleErrors,
      app_network_errors: appNetworkErrors,
      http_errors: httpErrors,
      ignored_network_events: ignoredNetworkEvents,
      browser_version: launched.version,
      timestamp: new Date().toISOString(),
    }

    await page.close()
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result: CaptureResult = {
      ok: false,
      evidence_pass: false,
      target,
      route,
      theme,
      viewport: { name: viewportName, ...viewport },
      console_errors: consoleErrors,
      app_network_errors: appNetworkErrors,
      http_errors: httpErrors,
      ignored_network_events: ignoredNetworkEvents,
      timestamp: new Date().toISOString(),
      error: message.slice(0, 2000),
    }
    return Response.json(result, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await closeBrowser(browser)
  }
}
