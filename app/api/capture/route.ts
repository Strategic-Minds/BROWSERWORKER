import { verifyAuth, authResponse } from '@/lib/auth'
import { validatePublicUrl } from '@/lib/ssrf'
import { launchBrowser, closeBrowser, WORKER_VERSION } from '@/lib/browser'
import { acquireSlot, releaseSlot } from '@/lib/concurrency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

type CaptureRequest = {
  url?: string
  viewport?: {
    width?: number
    height?: number
    deviceScaleFactor?: number
  }
  wait_ms?: number
  full_page?: boolean
}

export async function POST(request: Request) {
  const auth = verifyAuth(request)
  if (!auth.ok) return authResponse()

  let body: CaptureRequest
  try {
    body = await request.json() as CaptureRequest
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.url) {
    return Response.json({ ok: false, error: 'url is required' }, { status: 400 })
  }

  const urlCheck = await validatePublicUrl(body.url)
  if (!urlCheck.ok) {
    return Response.json({ ok: false, error: urlCheck.error, code: urlCheck.code }, { status: 400 })
  }

  const width = Math.min(3840, Math.max(320, Math.floor(body.viewport?.width || 1440)))
  const height = Math.min(2160, Math.max(240, Math.floor(body.viewport?.height || 900)))
  const deviceScaleFactor = Math.min(3, Math.max(0.5, body.viewport?.deviceScaleFactor || 1))
  const waitMs = Math.min(10000, Math.max(0, Math.floor(body.wait_ms || 2500)))

  if (!acquireSlot()) {
    return Response.json({ ok: false, error: 'Too many concurrent jobs', code: 'RATE_LIMITED' }, { status: 429 })
  }

  let browser = null
  const consoleErrors: string[] = []
  const networkErrors: string[] = []
  const startedAt = Date.now()

  try {
    const launched = await launchBrowser()
    browser = launched.browser

    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
    })

    const page = await context.newPage()

    page.on('console', message => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text().slice(0, 500))
      }
    })

    page.on('requestfailed', req => {
      networkErrors.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText || 'failed'}`.slice(0, 500))
    })

    await page.goto(body.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('body', { timeout: 15000 })
    if (waitMs > 0) await page.waitForTimeout(waitMs)

    const title = await page.title()
    const finalUrl = page.url()
    const png = await page.screenshot({
      type: 'png',
      fullPage: Boolean(body.full_page),
    })

    await page.close()
    await context.close()

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Length': String(png.length),
        'X-BrowserWorker-Version': WORKER_VERSION,
        'X-Browser-Version': launched.version,
        'X-Capture-Title': encodeURIComponent(title),
        'X-Capture-Final-Url': encodeURIComponent(finalUrl),
        'X-Capture-Viewport': `${width}x${height}@${deviceScaleFactor}`,
        'X-Capture-Duration-Ms': String(Date.now() - startedAt),
        'X-Console-Errors': String(consoleErrors.length),
        'X-Network-Errors': String(networkErrors.length),
        'X-Console-Error-Sample': encodeURIComponent(consoleErrors.slice(0, 3).join(' | ')),
        'X-Network-Error-Sample': encodeURIComponent(networkErrors.slice(0, 3).join(' | ')),
      },
    })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Capture failed',
      worker_version: WORKER_VERSION,
      duration_ms: Date.now() - startedAt,
      console_errors: consoleErrors,
      network_errors: networkErrors,
    }, { status: 500 })
  } finally {
    await closeBrowser(browser)
    releaseSlot()
  }
}
