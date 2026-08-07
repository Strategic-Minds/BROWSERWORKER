import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const REFERENCE = {
  fileId: '1_GbJt7os0BTg6_9eLBp-Zltd1lk-FHGr',
  route: '/dashboard',
  crop: { x: 178, y: 150, width: 570, height: 1387 },
}

const REGIONS = [
  { name: 'header_search', y0: 0, y1: .16 },
  { name: 'overview_metrics', y0: .16, y1: .43 },
  { name: 'quick_actions', y0: .43, y1: .56 },
  { name: 'active_bids', y0: .56, y1: .80 },
  { name: 'proposal_alerts', y0: .80, y1: .94 },
  { name: 'bottom_navigation', y0: .94, y1: 1 },
]

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null

  try {
    const proofUrl = new URL('/api/bidfast-proof', requestUrl.origin)
    proofUrl.searchParams.set('route', REFERENCE.route)
    proofUrl.searchParams.set('theme', 'light')
    proofUrl.searchParams.set('viewport', 'mobile')

    const [proofResponse, referenceResponse] = await Promise.all([
      fetch(proofUrl, { cache: 'no-store' }),
      fetch(`https://drive.google.com/uc?export=download&id=${REFERENCE.fileId}`, {
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'User-Agent': 'BIDFAST-Parity-Regions/1.0' },
      }),
    ])

    if (!proofResponse.ok) throw new Error(`Browser proof failed with HTTP ${proofResponse.status}.`)
    if (!referenceResponse.ok) throw new Error(`Drive reference failed with HTTP ${referenceResponse.status}.`)

    const proof = await proofResponse.json() as { screenshot?: { data?: string; mime_type?: string }; page_height?: number; evidence_pass?: boolean }
    if (!proof.screenshot?.data) throw new Error('Browser proof did not return screenshot bytes.')

    const referenceType = referenceResponse.headers.get('content-type') || 'image/png'
    const referenceBytes = new Uint8Array(await referenceResponse.arrayBuffer())
    const launched = await launchBrowser()
    browser = launched.browser
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.setContent('<!doctype html><html><body></body></html>')

    const result = await page.evaluate(async ({ liveDataUrl, referenceDataUrl, crop, regions }) => {
      const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('Image decode failed.'))
        image.src = src
      })
      const [liveImage, referenceImage] = await Promise.all([load(liveDataUrl), load(referenceDataUrl)])
      const width = 195
      const height = Math.round(width * liveImage.height / liveImage.width)
      const canvas = () => {
        const value = document.createElement('canvas')
        value.width = width
        value.height = height
        return value
      }
      const liveCanvas = canvas()
      const approvedCanvas = canvas()
      const liveContext = liveCanvas.getContext('2d', { willReadFrequently: true })!
      const approvedContext = approvedCanvas.getContext('2d', { willReadFrequently: true })!
      liveContext.drawImage(liveImage, 0, 0, liveImage.width, liveImage.height, 0, 0, width, height)
      approvedContext.drawImage(referenceImage, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
      const live = liveContext.getImageData(0, 0, width, height).data
      const approved = approvedContext.getImageData(0, 0, width, height).data
      const luma = (data: Uint8ClampedArray, pixel: number) => {
        const index = pixel * 4
        return .2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]
      }

      const scoreRegion = (yStart: number, yEnd: number) => {
        let pixels = 0
        let pixelTotal = 0
        let edgeDifference = 0
        let edgeMagnitude = 0
        let lumaDifference = 0
        const liveHistogram = new Array(48).fill(0)
        const approvedHistogram = new Array(48).fill(0)

        for (let y = yStart; y < yEnd; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const pixel = y * width + x
            const index = pixel * 4
            let difference = 0
            for (let channel = 0; channel < 3; channel += 1) {
              difference += Math.max(0, Math.abs(live[index + channel] - approved[index + channel]) - 6) / 249
              liveHistogram[channel * 16 + Math.min(15, Math.floor(live[index + channel] / 16))] += 1
              approvedHistogram[channel * 16 + Math.min(15, Math.floor(approved[index + channel] / 16))] += 1
            }
            pixelTotal += 1 - difference / 3
            lumaDifference += Math.abs(luma(live, pixel) - luma(approved, pixel)) / 255
            pixels += 1
            if (x < width - 1 && y < yEnd - 1) {
              const liveGradient = Math.abs(luma(live, pixel + 1) - luma(live, pixel)) + Math.abs(luma(live, pixel + width) - luma(live, pixel))
              const approvedGradient = Math.abs(luma(approved, pixel + 1) - luma(approved, pixel)) + Math.abs(luma(approved, pixel + width) - luma(approved, pixel))
              edgeDifference += Math.abs(liveGradient - approvedGradient)
              edgeMagnitude += Math.max(16, approvedGradient)
            }
          }
        }

        let histogramOverlap = 0
        for (let index = 0; index < liveHistogram.length; index += 1) histogramOverlap += Math.min(liveHistogram[index], approvedHistogram[index])
        const pixelSimilarity = pixelTotal / pixels
        const lumaSimilarity = 1 - lumaDifference / pixels
        const edgeSimilarity = 1 - Math.min(1, edgeDifference / edgeMagnitude)
        const colorSimilarity = histogramOverlap / (pixels * 3)
        const composite = .30 * pixelSimilarity + .25 * lumaSimilarity + .30 * edgeSimilarity + .15 * colorSimilarity
        return {
          pixel_similarity: Number(pixelSimilarity.toFixed(6)),
          luma_similarity: Number(lumaSimilarity.toFixed(6)),
          edge_similarity: Number(edgeSimilarity.toFixed(6)),
          color_similarity: Number(colorSimilarity.toFixed(6)),
          diagnostic_score: Number(composite.toFixed(6)),
        }
      }

      return {
        normalized_width: width,
        normalized_height: height,
        regions: regions.map(region => {
          const yStart = Math.max(0, Math.floor(region.y0 * height))
          const yEnd = Math.min(height, Math.ceil(region.y1 * height))
          return { name: region.name, y_start: yStart, y_end: yEnd, ...scoreRegion(yStart, yEnd) }
        }),
      }
    }, {
      liveDataUrl: `data:${proof.screenshot.mime_type || 'image/jpeg'};base64,${proof.screenshot.data}`,
      referenceDataUrl: `data:${referenceType};base64,${Buffer.from(referenceBytes).toString('base64')}`,
      crop: REFERENCE.crop,
      regions: REGIONS,
    })

    await context.close()
    return Response.json({
      ok: true,
      technical_pass: proof.evidence_pass === true,
      route: REFERENCE.route,
      page_height: proof.page_height,
      ...result,
      timestamp: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }, { status: 500 })
  } finally {
    await closeBrowser(browser)
  }
}
