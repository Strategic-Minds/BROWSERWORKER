import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const FILE_ID = '1_GbJt7os0BTg6_9eLBp-Zltd1lk-FHGr'

const candidates: Array<{ x: number; y: number; width: number; height: number }> = []
for (const x of [150, 155, 160, 165, 170, 175]) {
  for (const y of [135, 140, 145, 150, 155, 160]) {
    for (const width of [596, 601, 606, 611, 616, 621, 626, 631]) {
      for (const height of [1390, 1410, 1430, 1450, 1470, 1490, 1510]) {
        if (x + width <= 941 && y + height <= 1672) candidates.push({ x, y, width, height })
      }
    }
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null
  try {
    const proofUrl = new URL('/api/bidfast-proof', requestUrl.origin)
    proofUrl.searchParams.set('route', '/dashboard')
    proofUrl.searchParams.set('theme', 'light')
    proofUrl.searchParams.set('viewport', 'mobile')

    const [proofResponse, referenceResponse] = await Promise.all([
      fetch(proofUrl, { cache: 'no-store' }),
      fetch(`https://drive.google.com/uc?export=download&id=${FILE_ID}`, {
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'User-Agent': 'BIDFAST-Parity-Optimizer/1.0' },
      }),
    ])
    if (!proofResponse.ok || !referenceResponse.ok) throw new Error('Unable to load optimization inputs.')
    const proof = await proofResponse.json() as { screenshot?: { data?: string; mime_type?: string }; evidence_pass?: boolean; page_height?: number }
    if (!proof.screenshot?.data) throw new Error('Browser proof did not include screenshot bytes.')
    const referenceType = referenceResponse.headers.get('content-type') || 'image/png'
    const referenceBytes = new Uint8Array(await referenceResponse.arrayBuffer())

    const launched = await launchBrowser()
    browser = launched.browser
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.setContent('<!doctype html><html><body></body></html>')

    const scores = await page.evaluate(async ({ liveDataUrl, referenceDataUrl, candidates }) => {
      const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('Image decode failed.'))
        image.src = src
      })
      const [liveImage, referenceImage] = await Promise.all([load(liveDataUrl), load(referenceDataUrl)])
      const width = 98
      const height = Math.round(width * liveImage.height / liveImage.width)
      const createCanvas = () => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        return canvas
      }
      const liveCanvas = createCanvas()
      const liveContext = liveCanvas.getContext('2d', { willReadFrequently: true })!
      liveContext.drawImage(liveImage, 0, 0, liveImage.width, liveImage.height, 0, 0, width, height)
      const live = liveContext.getImageData(0, 0, width, height).data
      const pixels = width * height
      const luma = (data: Uint8ClampedArray, pixel: number) => {
        const index = pixel * 4
        return .2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]
      }

      const results = candidates.map(candidate => {
        const referenceCanvas = createCanvas()
        const referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true })!
        referenceContext.drawImage(referenceImage, candidate.x, candidate.y, candidate.width, candidate.height, 0, 0, width, height)
        const approved = referenceContext.getImageData(0, 0, width, height).data
        let pixelTotal = 0
        let edgeDifference = 0
        let edgeMagnitude = 0
        let lumaDifference = 0
        const liveHistogram = new Array(48).fill(0)
        const approvedHistogram = new Array(48).fill(0)

        for (let pixel = 0; pixel < pixels; pixel += 1) {
          const index = pixel * 4
          let channelDifference = 0
          for (let channel = 0; channel < 3; channel += 1) {
            channelDifference += Math.max(0, Math.abs(live[index + channel] - approved[index + channel]) - 6) / 249
            liveHistogram[channel * 16 + Math.min(15, Math.floor(live[index + channel] / 16))] += 1
            approvedHistogram[channel * 16 + Math.min(15, Math.floor(approved[index + channel] / 16))] += 1
          }
          pixelTotal += 1 - channelDifference / 3
          lumaDifference += Math.abs(luma(live, pixel) - luma(approved, pixel)) / 255
        }

        for (let row = 0; row < height - 1; row += 1) {
          for (let column = 0; column < width - 1; column += 1) {
            const pixel = row * width + column
            const liveGradient = Math.abs(luma(live, pixel + 1) - luma(live, pixel)) + Math.abs(luma(live, pixel + width) - luma(live, pixel))
            const approvedGradient = Math.abs(luma(approved, pixel + 1) - luma(approved, pixel)) + Math.abs(luma(approved, pixel + width) - luma(approved, pixel))
            edgeDifference += Math.abs(liveGradient - approvedGradient)
            edgeMagnitude += Math.max(16, approvedGradient)
          }
        }

        let histogramOverlap = 0
        for (let index = 0; index < liveHistogram.length; index += 1) histogramOverlap += Math.min(liveHistogram[index], approvedHistogram[index])
        const pixel = pixelTotal / pixels
        const structure = 1 - lumaDifference / pixels
        const edge = 1 - Math.min(1, edgeDifference / edgeMagnitude)
        const color = histogramOverlap / (pixels * 3)
        const composite = .30 * pixel + .35 * structure + .20 * edge + .15 * color
        return {
          ...candidate,
          expected_height_at_390: Number((candidate.height * 390 / candidate.width).toFixed(2)),
          pixel_similarity: Number(pixel.toFixed(6)),
          structure_similarity: Number(structure.toFixed(6)),
          edge_similarity: Number(edge.toFixed(6)),
          color_similarity: Number(color.toFixed(6)),
          composite_score: Number(composite.toFixed(6)),
        }
      })

      return results.sort((a, b) => b.composite_score - a.composite_score).slice(0, 20)
    }, {
      liveDataUrl: `data:${proof.screenshot.mime_type || 'image/jpeg'};base64,${proof.screenshot.data}`,
      referenceDataUrl: `data:${referenceType};base64,${Buffer.from(referenceBytes).toString('base64')}`,
      candidates,
    })

    await context.close()
    return Response.json({
      ok: true,
      technical_pass: proof.evidence_pass === true,
      live_page_height: proof.page_height,
      candidate_count: candidates.length,
      best: scores[0],
      top_candidates: scores,
      scoring_weights: { pixel: .30, structure: .35, edge: .20, color: .15 },
      timestamp: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  } finally {
    await closeBrowser(browser)
  }
}
