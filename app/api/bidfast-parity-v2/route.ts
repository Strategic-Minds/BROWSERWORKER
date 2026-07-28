import { createHash } from 'node:crypto'
import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const REFERENCES = {
  '/dashboard': {
    fileId: '1_GbJt7os0BTg6_9eLBp-Zltd1lk-FHGr',
    title: '01_BIDFAST_MOBILE_EXECUTIVE_DASHBOARD.png',
    theme: 'light',
    viewport: 'mobile',
    crop: { x: 178, y: 150, width: 570, height: 1387 },
  },
} as const

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const route = requestUrl.searchParams.get('route') || '/dashboard'
  const reference = REFERENCES[route as keyof typeof REFERENCES]
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null

  if (!reference) {
    return Response.json({ ok: false, error: 'No approved Drive reference is registered.', registered_routes: Object.keys(REFERENCES) }, { status: 400 })
  }

  try {
    const proofUrl = new URL('/api/bidfast-proof', requestUrl.origin)
    proofUrl.searchParams.set('route', route)
    proofUrl.searchParams.set('theme', reference.theme)
    proofUrl.searchParams.set('viewport', reference.viewport)

    const [proofResponse, referenceResponse] = await Promise.all([
      fetch(proofUrl, { cache: 'no-store' }),
      fetch(`https://drive.google.com/uc?export=download&id=${reference.fileId}`, {
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'User-Agent': 'BIDFAST-Parity-Worker/2.0' },
      }),
    ])

    if (!proofResponse.ok) throw new Error(`Browser proof failed with HTTP ${proofResponse.status}.`)
    if (!referenceResponse.ok) throw new Error(`Drive reference failed with HTTP ${referenceResponse.status}.`)

    const proof = await proofResponse.json() as {
      evidence_pass: boolean
      screenshot?: { data?: string; mime_type?: string; bytes?: number }
      console_errors?: string[]
      app_network_errors?: string[]
      http_errors?: string[]
      viewport?: { width: number; height: number }
      page_height?: number
      target?: string
      main_document_status?: number
      browser_version?: string
    }

    if (!proof.screenshot?.data) throw new Error('Browser proof did not return screenshot bytes.')
    const referenceType = referenceResponse.headers.get('content-type') || ''
    if (!referenceType.startsWith('image/')) throw new Error(`Drive reference returned ${referenceType || 'an invalid media type'}.`)

    const liveBytes = new Uint8Array(Buffer.from(proof.screenshot.data, 'base64'))
    const referenceBytes = new Uint8Array(await referenceResponse.arrayBuffer())
    const launched = await launchBrowser()
    browser = launched.browser
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.setContent('<!doctype html><html><body></body></html>')

    const metrics = await page.evaluate(async ({ liveDataUrl, referenceDataUrl, crop }) => {
      const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('Image decode failed.'))
        image.src = src
      })

      const [liveImage, referenceImage] = await Promise.all([load(liveDataUrl), load(referenceDataUrl)])
      const width = 195
      const height = Math.round(width * liveImage.height / liveImage.width)
      const makeCanvas = () => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        return canvas
      }
      const liveCanvas = makeCanvas()
      const referenceCanvas = makeCanvas()
      const liveContext = liveCanvas.getContext('2d', { willReadFrequently: true })!
      const referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true })!
      liveContext.drawImage(liveImage, 0, 0, liveImage.width, liveImage.height, 0, 0, width, height)
      referenceContext.drawImage(referenceImage, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)

      const live = liveContext.getImageData(0, 0, width, height).data
      const approved = referenceContext.getImageData(0, 0, width, height).data
      const pixels = width * height
      const luma = (data: Uint8ClampedArray, pixel: number) => {
        const index = pixel * 4
        return .2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]
      }

      let pixelTotal = 0
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
      let blockDifference = 0
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
              liveMean += luma(live, pixel)
              approvedMean += luma(approved, pixel)
              count += 1
            }
          }
          blockDifference += Math.abs(liveMean / count - approvedMean / count) / 255
        }
      }

      let edgeDifference = 0
      let edgeMagnitude = 0
      for (let y = 0; y < height - 1; y += 1) {
        for (let x = 0; x < width - 1; x += 1) {
          const pixel = y * width + x
          const liveGradient = Math.abs(luma(live, pixel + 1) - luma(live, pixel)) + Math.abs(luma(live, pixel + width) - luma(live, pixel))
          const approvedGradient = Math.abs(luma(approved, pixel + 1) - luma(approved, pixel)) + Math.abs(luma(approved, pixel + width) - luma(approved, pixel))
          edgeDifference += Math.abs(liveGradient - approvedGradient)
          edgeMagnitude += Math.max(16, approvedGradient)
        }
      }

      let histogramOverlap = 0
      for (let index = 0; index < liveHistogram.length; index += 1) histogramOverlap += Math.min(liveHistogram[index], approvedHistogram[index])

      const pixelSimilarity = pixelTotal / pixels
      const structureSimilarity = 1 - blockDifference / (blocksX * blocksY)
      const edgeSimilarity = 1 - Math.min(1, edgeDifference / edgeMagnitude)
      const colorSimilarity = histogramOverlap / (pixels * 3)
      const composite = .30 * pixelSimilarity + .35 * structureSimilarity + .20 * edgeSimilarity + .15 * colorSimilarity

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
        composite_score: Number(composite.toFixed(6)),
      }
    }, {
      liveDataUrl: `data:${proof.screenshot.mime_type || 'image/jpeg'};base64,${proof.screenshot.data}`,
      referenceDataUrl: `data:${referenceType};base64,${Buffer.from(referenceBytes).toString('base64')}`,
      crop: reference.crop,
    })

    await context.close()
    const visualPass = metrics.composite_score >= .99

    return Response.json({
      ok: true,
      evidence_pass: proof.evidence_pass && visualPass,
      technical_pass: proof.evidence_pass,
      visual_pass: visualPass,
      visual_threshold: .99,
      route,
      theme: reference.theme,
      viewport: proof.viewport,
      page_height: proof.page_height,
      reference: {
        drive_file_id: reference.fileId,
        title: reference.title,
        crop: reference.crop,
        sha256: sha256(referenceBytes),
        bytes: referenceBytes.byteLength,
      },
      live: {
        target: proof.target,
        http_status: proof.main_document_status,
        sha256: sha256(liveBytes),
        bytes: liveBytes.byteLength,
      },
      metrics,
      console_errors: proof.console_errors || [],
      app_network_errors: proof.app_network_errors || [],
      http_errors: proof.http_errors || [],
      browser_version: proof.browser_version || launched.version,
      timestamp: new Date().toISOString(),
    }, { status: proof.evidence_pass ? 200 : 422, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ ok: false, evidence_pass: false, route, error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await closeBrowser(browser)
  }
}
