import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ORIGIN = 'https://bidfast-69k7i0rwf-strategic-minds-advisory.vercel.app'
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

type CaptureResult = {
  ok: boolean
  target: string
  route: string
  theme: 'light' | 'dark'
  viewport: { name: ViewportName; width: number; height: number }
  title?: string
  final_url?: string
  screenshot?: { mime_type: 'image/jpeg'; encoding: 'base64'; bytes: number; data: string }
  console_errors: string[]
  network_errors: string[]
  browser_version?: string
  timestamp: string
  error?: string
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const route = requestUrl.searchParams.get('route') || '/dashboard'
  const theme = requestUrl.searchParams.get('theme') === 'dark' ? 'dark' : 'light'
  const requestedViewport = requestUrl.searchParams.get('viewport') || 'desktop'
  const viewportName: ViewportName = requestedViewport in VIEWPORTS ? requestedViewport as ViewportName : 'desktop'
  const viewport = VIEWPORTS[viewportName]

  if (!ROUTES.has(route)) {
    return Response.json({ ok: false, error: 'Route is not allowlisted.' }, { status: 400 })
  }

  const target = new URL(route, ORIGIN).toString()
  const consoleErrors: string[] = []
  const networkErrors: string[] = []
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
      networkErrors.push(`${failed.method()} ${failed.url()} — ${failure}`.slice(0, 1500))
    })

    await page.addInitScript((nextTheme: string) => {
      localStorage.setItem('bidfast-theme', nextTheme)
      document.documentElement.dataset.theme = nextTheme
    }, theme)

    await page.goto(target, { waitUntil: 'networkidle', timeout: 90000 })
    await page.waitForTimeout(1200)

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: true })
    const result: CaptureResult = {
      ok: true,
      target,
      route,
      theme,
      viewport: { name: viewportName, ...viewport },
      title: await page.title(),
      final_url: page.url(),
      screenshot: {
        mime_type: 'image/jpeg',
        encoding: 'base64',
        bytes: screenshot.byteLength,
        data: Buffer.from(screenshot).toString('base64'),
      },
      console_errors: consoleErrors,
      network_errors: networkErrors,
      browser_version: launched.version,
      timestamp: new Date().toISOString(),
    }

    await page.close()
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result: CaptureResult = {
      ok: false,
      target,
      route,
      theme,
      viewport: { name: viewportName, ...viewport },
      console_errors: consoleErrors,
      network_errors: networkErrors,
      timestamp: new Date().toISOString(),
      error: message.slice(0, 2000),
    }
    return Response.json(result, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await closeBrowser(browser)
  }
}
