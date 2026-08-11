import { createHash } from 'node:crypto'
import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'

const REFERENCES = {
  '/dashboard': {
    fileId: '1_GbJt7os0BTg6_9eLBp-Zltd1lk-FHGr',
    title: '01_BIDFAST_MOBILE_EXECUTIVE_DASHBOARD.png',
    theme: 'light',
    viewport: { width: 390, height: 844 },
    crop: { x: 178, y: 150, width: 570, height: 1387 },
  },
} as const

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const route = url.searchParams.get('route') || '/dashboard'
  const reference = REFERENCES[route as keyof typeof REFERENCES]

  if (!reference) {
    return Response.json({
      ok: false,
      error: 'No approved Drive reference is registered for this route.',
      registered_routes: Object.keys(REFERENCES),
    }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const referenceUrl = `https://drive.google.com/uc?export=download&id=${reference.fileId}`
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null

  try {
    const referenceResponse = await fetch(referenceUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'BIDFAST-Parity-Worker/1.0' },
      cache: 'no-store',
    })

    if (!referenceResponse.ok) {
      throw new Error(`Drive reference fetch failed with HTTP ${referenceResponse.status}.`)
    }

    const referenceType = referenceResponse.headers.get('content-type') || ''
    if (!referenceType.startsWith('image/')) {
      throw new Error(`Drive reference returned ${referenceType || 'an unknown media type'} instead of an image.`)
    }

    const referenceBytes = new Uint8Array(await referenceResponse.arrayBuffer())
    const launched = await launchBrowser()
    browser = launched.browser
    const context = browser.contexts()[0] || await browser.newContext({ viewport: reference.viewport })
    const page = await context.newPage()

    const consoleErrors: string[] = []
    const applicationNetworkErrors: string[] = []
    const httpErrors: Array<{ url: string; status: number }> = []

    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 800))
    })
    page.on('pageerror', error => consoleErrors.push(error.message.slice(0, 800)))
    page.on('requestfailed', req => {
      const failedUrl = req.url()
      if (failedUrl.includes('/.well-known/vercel/jwe') || failedUrl.includes('_rsc=') || failedUrl.includes('vercel.live/_next-live/')) return
      if ((req.failure()?.errorText || '').includes('ERR_ABORTED') && ['HEAD', 'OPTIONS'].includes(req.method())) return
      applicationNetworkErrors.push(`${req.method()} ${failedUrl}: ${req.failure()?.errorText || 'failed'}`.slice(0, 1000))
    })
    page.on('response', response => {
      const status = response.status()
      if (status >= 400 && response.url().startsWith(ORIGIN)) httpErrors.push({ url: response.url(), status })
    })

    await page.addInitScript(theme => {
      localStorage.setItem('bidfast-theme', theme)
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme
    }, reference.theme)

    const response = await page.goto(`${ORIGIN}${route}`, { waitUntil: 'networkidle', timeout: 90000 })
    await page.waitForTimeout(800)

    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false })
    const screenshotBytes = new Uint8Array(screenshotBuffer)
    const comparisonPage = await context.newPage()
    await comparisonPage.setContent('<!doctype html><html><body></body></html>')

    const metrics = await comparisonPage.evaluate(async ({ liveDataUrl, referenceDataUrl, crop }) => {
      const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('Image decode failed.'))
        image.src = src
      })

      const [liveImage, referenceImage] = await Promise.all([
        loadImage(liveDataUrl),
        loadImage(referenceDataUrl),
      ])

      const width = 195
      const height = 422
      const liveCanvas = document.createElement('canvas')
      const referenceCanvas = document.createElement('canvas')
      liveCanvas.width = referenceCanvas.width = width
      liveCanvas.height = referenceCanvas.height = height
      const liveContext = liveCanvas.getContext('2d', { willReadFrequently: true })!
      const referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true })!

      liveContext.drawImage(liveImage, 0, 0, liveImage.width, liveImage.height, 0, 0, width, height)
      referenceContext.drawImage(referenceImage, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)

      const live = liveContext.getImageData(0, 0, width, height).data
      const approved = referenceContext.getImageData(0, 0, width, height).data
      const pixels = width * height

      let pixelSimilarityTotal = 0
      let structuralDifference = 0
      let edgeDifference = 0
      let edgeMagnitude = 0
      const liveHistogram = new Array(48).fill(0)
      const referenceHistogram = new Array(48).fill(0)

      const luminance = (data: Uint8ClampedArray, pixel: number) => {
        const index = pixel * 4
        return .2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]
      }

      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const index = pixel * 4
        let channelDifference = 0
        for (let channel = 0; channel < 3; channel += 1) {
          const difference = Math.abs(live[index + channel] - approved[index + channel])
          channelDifference += Math.max(0, difference - 6) / 249
          liveHistogram[channel * 16 + Math.min(15, Math.floor(live[index + channel] / 16))] += 1
          referenceHistogram[channel * 16 + Math.min(15, Math.floor(approved[index + channel] / 16))] += 1
        }
        pixelSimilarityTotal += 1 - channelDifference / 3
      }

      const blocksX = 13
      const blocksY = 28
      for (let blockY = 0; blockY < blocksY; blockY += 1) {
        for (let blockX = 0; blockX < blocksX; blockX += 1) {
          const x0 = Math.floor(blockX * width / blocksX)
          const x1 = Math.floor((blockX + 1) * width / blocksX)
          const y0 = Math.floor(blockY * height / blocksY)
          const y1 = Math.floor((blockY + 1) * height / blocksY)
          let liveLuma = 0
          let referenceLuma = 0
          let count = 0
          for (let y = y0; y < y1; y += 1) {
            for (let x = x0; x < x1; x += 1) {
              const pixel = y * width + x
              liveLuma += luminance(live, pixel)
              referenceLuma += luminance(approved, pixel)
              count += 1
            }
          }
          structuralDifference += Math.abs(liveLuma / count - referenceLuma / count) / 255
        }
      }

      for (let y = 0; y < height - 1; y += 1) {
        for (let x = 0; x < width - 1; x += 1) {
          const pixel = y * width + x
          const liveGradient = Math.abs(luminance(live, pixel + 1) - luminance(live, pixel)) + Math.abs(luminance(live, pixel + width) - luminance(live, pixel))
          const referenceGradient = Math.abs(luminance(approved, pixel + 1) - luminance(approved, pixel)) + Math.abs(luminance(approved, pixel + width) - luminance(approved, pixel))
          edgeDifference += Math.abs(liveGradient - referenceGradient)
          edgeMagnitude += Math.max(16, referenceGradient)
        }
      }

      let histogramOverlap = 0
      for (let index = 0; index < liveHistogram.length; index += 1) {
        histogramOverlap += Math.min(liveHistogram[index], referenceHistogram[index])
      }

      const pixelSimilarity = pixelSimilarityTotal / pixels
      const structureSimilarity = 1 - structuralDifference / (blocksX * blocksY)
      const edgeSimilarity = 1 - Math.min(1, edgeDifference / edgeMagnitude)
      const colorSimilarity = histogramOverlap / (pixels * 3)
      const score = .30 * pixelSimilarity + .35 * structureSimilarity + .20 * edgeSimilarity + .15 * colorSimilarity

      return {
        normalized_width: width,
        normalized_height: height,
        live_source_width: liveImage.width,
        live_source_height: liveImage.height,
        reference_source_width: referenceImage.width,
        reference_source_height: referenceImage.height,
        pixel_similarity: Number(pixelSimilarity.toFixed(6)),
        structure_similarity: Number(structureSimilarity.toFixed(6)),
        edge_similarity: Number(edgeSimilarity.toFixed(6)),
        color_similarity: Number(colorSimilarity.toFixed(6)),
        composite_score: Number(score.toFixed(6)),
      }
    }, {
      liveDataUrl: `data:image/png;base64,${Buffer.from(screenshotBytes).toString('base64')}`,
      referenceDataUrl: `data:${referenceType};base64,${Buffer.from(referenceBytes).toString('base64')}`,
      crop: reference.crop,
    })

    await comparisonPage.close()
    await page.close()

    const technicalPass = Boolean(response && response.status() < 400) && consoleErrors.length === 0 && applicationNetworkErrors.length === 0 && httpErrors.length === 0
    const visualPass = metrics.composite_score >= .99

    return Response.json({
      ok: true,
      evidence_pass: technicalPass && visualPass,
      technical_pass: technicalPass,
      visual_pass: visualPass,
      visual_threshold: .99,
      route,
      theme: reference.theme,
      viewport: reference.viewport,
      reference: {
        drive_file_id: reference.fileId,
        title: reference.title,
        crop: reference.crop,
        sha256: sha256(referenceBytes),
        bytes: referenceBytes.byteLength,
      },
      live: {
        target: `${ORIGIN}${route}`,
        http_status: response?.status() || null,
        sha256: sha256(screenshotBytes),
        bytes: screenshotBytes.byteLength,
      },
      metrics,
      console_errors: consoleErrors,
      app_network_errors: applicationNetworkErrors,
      http_errors: httpErrors,
      browser_version: launched.version,
      timestamp: new Date().toISOString(),
    }, {
      status: technicalPass ? 200 : 422,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return Response.json({
      ok: false,
      evidence_pass: false,
      route,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await closeBrowser(browser)
  }
}
