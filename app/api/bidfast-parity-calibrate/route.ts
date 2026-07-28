import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const FILE_ID = '1_GbJt7os0BTg6_9eLBp-Zltd1lk-FHGr'
const CANDIDATES = [
  { name: 'content_column_original', x: 178, y: 150, width: 570, height: 1387 },
  { name: 'inner_screen_no_status', x: 155, y: 150, width: 631, height: 1398 },
  { name: 'inner_screen_full', x: 155, y: 85, width: 631, height: 1463 },
  { name: 'inner_screen_logo_to_nav', x: 155, y: 145, width: 631, height: 1403 },
  { name: 'screen_safe_area', x: 165, y: 145, width: 611, height: 1403 },
  { name: 'content_with_margins', x: 165, y: 150, width: 611, height: 1398 },
  { name: 'wide_content', x: 170, y: 150, width: 601, height: 1398 },
] as const

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
        headers: { 'User-Agent': 'BIDFAST-Parity-Calibrator/1.0' },
      }),
    ])
    if (!proofResponse.ok || !referenceResponse.ok) throw new Error('Unable to load calibration inputs.')
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
      const width = 195
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
      const luminance = (data: Uint8ClampedArray, pixel: number) => {
        const index = pixel * 4
        return .2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]
      }

      return candidates.map(candidate => {
        const referenceCanvas = createCanvas()
        const referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true })!
        referenceContext.drawImage(referenceImage, candidate.x, candidate.y, candidate.width, candidate.height, 0, 0, width, height)
        const approved = referenceContext.getImageData(0, 0, width, height).data
        let pixelTotal = 0
        let blockDifference = 0
        let edgeDifference = 0
        let edgeMagnitude = 0
        const liveHistogram = new Array(48).fill(0)
        const approvedHistogram = new Array(48).fill(0)

        for (let pixel = 0; pixel < pixels; pixel += 1) {
          const index = pixel * 4
          let difference = 0
          for (let channel = 0; channel < 3; channel += 1) {
            difference += Math.max(0, Math.abs(live[index + channel] - approved[index + channel]) - 6) / 249
            liveHistogram[channel * 16 + Math.min(15, Math.floor(live[index + channel] / 16))] += 1
            approvedHistogram[channel * 16 + Math.min(15, Math.floor(approved[index + channel] / 16))] += 1
          }
          pixelTotal += 1 - difference / 3
        }

        const blocksX = 13
        const blocksY = 28
        for (let by = 0; by < blocksY; by += 1) {
          for (let bx = 0; bx < blocksX; bx += 1) {
            const x0 = Math.floor(bx * width / blocksX)
            const x1 = Math.floor((bx + 1) * width / blocksX)
            const y0 = Math.floor(by * height / blocksY)
            const y1 = Math.floor((by + 1) * height / blocksY)
            let liveMean = 0
            let approvedMean = 0
            let count = 0
            for (let y = y0; y < y1; y += 1) {
              for (let x = x0; x < x1; x += 1) {
                const pixel = y * width + x
                liveMean += luminance(live, pixel)
                approvedMean += luminance(approved, pixel)
                count += 1
              }
            }
            blockDifference += Math.abs(liveMean / count - approvedMean / count) / 255
          }
        }

        for (let y = 0; y < height - 1; y += 1) {
          for (let x = 0; x < width - 1; x += 1) {
            const pixel = y * width + x
            const liveGradient = Math.abs(luminance(live, pixel + 1) - luminance(live, pixel)) + Math.abs(luminance(live, pixel + width) - luminance(live, pixel))
            const approvedGradient = Math.abs(luminance(approved, pixel + 1) - luminance(approved, pixel)) + Math.abs(luminance(approved, pixel + width) - luminance(approved, pixel))
            edgeDifference += Math.abs(liveGradient - approvedGradient)
            edgeMagnitude += Math.max(16, approvedGradient)
          }
        }

        let histogramOverlap = 0
        for (let index = 0; index < liveHistogram.length; index += 1) histogramOverlap += Math.min(liveHistogram[index], approvedHistogram[index])
        const pixel = pixelTotal / pixels
        const structure = 1 - blockDifference / (blocksX * blocksY)
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
      }).sort((a, b) => b.composite_score - a.composite_score)
    }, {
      liveDataUrl: `data:${proof.screenshot.mime_type || 'image/jpeg'};base64,${proof.screenshot.data}`,
      referenceDataUrl: `data:${referenceType};base64,${Buffer.from(referenceBytes).toString('base64')}`,
      candidates: CANDIDATES,
    })

    await context.close()
    return Response.json({
      ok: true,
      technical_pass: proof.evidence_pass === true,
      live_page_height: proof.page_height,
      recommended_crop: scores[0],
      candidates: scores,
      timestamp: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  } finally {
    await closeBrowser(browser)
  }
}
