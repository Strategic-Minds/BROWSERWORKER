import { createHash } from 'node:crypto'
import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const BIDFAST_ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'
const EXPECTED_REF = 'auto-builder/bidfast-complete-visual-system'
const REFERENCE = {
  fileId: '1haXSs0QuoSMACLXzo-sVaSGPc1roz0jR',
  title: '04_BIDFAST_MOBILE_OPPORTUNITIES_LIST.png',
  expectedSha256: 'c3cd0b2ed394491128784384e19561457bfe800f4b0182a391b78b888db389ef',
  crop: { x: 178, y: 150, width: 570, height: 1387 },
}

const REGIONS = [
  { name: 'header_logo', y0: 0, y1: .079 },
  { name: 'search', y0: .079, y1: .124 },
  { name: 'stage_tabs', y0: .124, y1: .179 },
  { name: 'list_toolbar', y0: .179, y1: .234 },
  { name: 'opportunity_1', y0: .234, y1: .357 },
  { name: 'opportunity_2', y0: .357, y1: .480 },
  { name: 'opportunity_3', y0: .480, y1: .603 },
  { name: 'opportunity_4', y0: .603, y1: .726 },
  { name: 'opportunity_5', y0: .726, y1: .849 },
  { name: 'opportunity_6', y0: .849, y1: .955 },
  { name: 'bottom_navigation', y0: .955, y1: 1 },
]

type SourceRevision = {
  commit_sha: string | null
  commit_ref: string | null
  deployment_id: string | null
  deployment_url: string | null
}

type BuildInfo = {
  ok?: boolean
  source_revision?: SourceRevision
}

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function isCommitSha(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value))
}

async function readBuildInfo(): Promise<{ status: number; body: BuildInfo }> {
  const response = await fetch(`${BIDFAST_ORIGIN}/api/build-info`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'BIDFAST-Opportunities-Single-Capture/1.0' },
  })
  let body: BuildInfo = {}
  try {
    body = await response.json() as BuildInfo
  } catch {
    body = {}
  }
  return { status: response.status, body }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const expectedCommit = requestUrl.searchParams.get('expected_commit')
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null

  if (!isCommitSha(expectedCommit)) {
    return Response.json({
      ok: false,
      evidence_pass: false,
      provenance_pass: false,
      error: 'A valid 40-character expected_commit is required.',
    }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const before = await readBuildInfo()
    const beforeRevision = before.body.source_revision
    if (before.status !== 200 || before.body.ok !== true || !beforeRevision) {
      return Response.json({
        ok: false,
        evidence_pass: false,
        provenance_pass: false,
        error: 'BIDFAST preview revision evidence was unavailable before capture.',
        build_info_status: before.status,
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }

    const proofUrl = new URL('/api/bidfast-proof', requestUrl.origin)
    proofUrl.searchParams.set('route', '/opportunities')
    proofUrl.searchParams.set('theme', 'light')
    proofUrl.searchParams.set('viewport', 'mobile')

    const [proofResponse, referenceResponse] = await Promise.all([
      fetch(proofUrl, { cache: 'no-store' }),
      fetch(`https://drive.google.com/uc?export=download&id=${REFERENCE.fileId}`, {
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'User-Agent': 'BIDFAST-Opportunities-Single-Capture/1.0' },
      }),
    ])

    if (!proofResponse.ok) throw new Error(`Browser proof failed with HTTP ${proofResponse.status}.`)
    if (!referenceResponse.ok) throw new Error(`Drive reference failed with HTTP ${referenceResponse.status}.`)

    const proof = await proofResponse.json() as {
      evidence_pass?: boolean
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
    const referenceSha = sha256(referenceBytes)
    if (referenceSha !== REFERENCE.expectedSha256) {
      return Response.json({
        ok: false,
        evidence_pass: false,
        integrity_pass: false,
        error: 'Approved Drive reference hash changed.',
        reference: {
          drive_file_id: REFERENCE.fileId,
          title: REFERENCE.title,
          expected_sha256: REFERENCE.expectedSha256,
          actual_sha256: referenceSha,
        },
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
    }

    const launched = await launchBrowser()
    browser = launched.browser
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.setContent('<!doctype html><html><body></body></html>')

    const analysis = await page.evaluate(async ({ liveDataUrl, referenceDataUrl, crop, regions }) => {
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
      const approvedCanvas = makeCanvas()
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

      const official = () => {
        const pixels = width * height
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
          pixel_similarity: Number(pixelSimilarity.toFixed(6)),
          structure_similarity: Number(structureSimilarity.toFixed(6)),
          edge_similarity: Number(edgeSimilarity.toFixed(6)),
          color_similarity: Number(colorSimilarity.toFixed(6)),
          composite_score: Number(composite.toFixed(6)),
        }
      }

      const regionalScore = (yStart: number, yEnd: number) => {
        let pixels = 0
        let pixelTotal = 0
        let lumaDifference = 0
        let edgeDifference = 0
        let edgeMagnitude = 0
        const liveHistogram = new Array(48).fill(0)
        const approvedHistogram = new Array(48).fill(0)

        for (let y = yStart; y < yEnd; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const pixel = y * width + x
            const index = pixel * 4
            let channelDifference = 0
            for (let channel = 0; channel < 3; channel += 1) {
              channelDifference += Math.max(0, Math.abs(live[index + channel] - approved[index + channel]) - 6) / 249
              liveHistogram[channel * 16 + Math.min(15, Math.floor(live[index + channel] / 16))] += 1
              approvedHistogram[channel * 16 + Math.min(15, Math.floor(approved[index + channel] / 16))] += 1
            }
            pixelTotal += 1 - channelDifference / 3
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
        const diagnosticScore = .30 * pixelSimilarity + .25 * lumaSimilarity + .30 * edgeSimilarity + .15 * colorSimilarity
        return {
          pixel_similarity: Number(pixelSimilarity.toFixed(6)),
          luma_similarity: Number(lumaSimilarity.toFixed(6)),
          edge_similarity: Number(edgeSimilarity.toFixed(6)),
          color_similarity: Number(colorSimilarity.toFixed(6)),
          diagnostic_score: Number(diagnosticScore.toFixed(6)),
        }
      }

      return {
        normalized_width: width,
        normalized_height: height,
        live_source_width: liveImage.width,
        live_source_height: liveImage.height,
        reference_source_width: referenceImage.width,
        reference_source_height: referenceImage.height,
        official_metrics: official(),
        regional: {
          overall: regionalScore(0, height),
          regions: regions.map(region => {
            const yStart = Math.max(0, Math.floor(region.y0 * height))
            const yEnd = Math.min(height, Math.ceil(region.y1 * height))
            return { name: region.name, y_start: yStart, y_end: yEnd, ...regionalScore(yStart, yEnd) }
          }).sort((a, b) => a.diagnostic_score - b.diagnostic_score),
        },
      }
    }, {
      liveDataUrl: `data:${proof.screenshot.mime_type || 'image/jpeg'};base64,${proof.screenshot.data}`,
      referenceDataUrl: `data:${referenceType};base64,${Buffer.from(referenceBytes).toString('base64')}`,
      crop: REFERENCE.crop,
      regions: REGIONS,
    })

    await context.close()
    const after = await readBuildInfo()
    const afterRevision = after.body.source_revision
    const provenanceFailures: string[] = []
    if (beforeRevision.commit_sha !== expectedCommit) provenanceFailures.push(`before_commit=${String(beforeRevision.commit_sha)}`)
    if (beforeRevision.commit_ref !== EXPECTED_REF) provenanceFailures.push(`before_ref=${String(beforeRevision.commit_ref)}`)
    if (after.status !== 200 || after.body.ok !== true || !afterRevision) {
      provenanceFailures.push(`post_capture_build_info_status=${after.status}`)
    } else {
      if (afterRevision.commit_sha !== expectedCommit) provenanceFailures.push(`after_commit=${String(afterRevision.commit_sha)}`)
      if (afterRevision.commit_ref !== EXPECTED_REF) provenanceFailures.push(`after_ref=${String(afterRevision.commit_ref)}`)
      if (beforeRevision.commit_sha !== afterRevision.commit_sha) provenanceFailures.push('commit_changed_during_capture')
      if (beforeRevision.deployment_id && afterRevision.deployment_id && beforeRevision.deployment_id !== afterRevision.deployment_id) provenanceFailures.push('deployment_changed_during_capture')
      if (beforeRevision.deployment_url && afterRevision.deployment_url && beforeRevision.deployment_url !== afterRevision.deployment_url) provenanceFailures.push('deployment_url_changed_during_capture')
    }

    const consoleErrors = proof.console_errors || []
    const appNetworkErrors = proof.app_network_errors || []
    const httpErrors = proof.http_errors || []
    const technicalPass = proof.evidence_pass === true
      && proof.main_document_status === 200
      && consoleErrors.length === 0
      && appNetworkErrors.length === 0
      && httpErrors.length === 0
    const provenancePass = provenanceFailures.length === 0
    const visualPass = analysis.official_metrics.composite_score >= .99
    const liveSha = sha256(liveBytes)

    return Response.json({
      ok: true,
      evidence_pass: technicalPass && provenancePass && visualPass,
      technical_pass: technicalPass,
      provenance_pass: provenancePass,
      integrity_pass: true,
      screenshot_coherence_pass: true,
      visual_pass: visualPass,
      release_authorized: false,
      validator_version: 'opportunities-single-capture-v1',
      route: '/opportunities',
      theme: 'light',
      viewport: proof.viewport || { width: 390, height: 844 },
      page_height: proof.page_height,
      reference: {
        drive_file_id: REFERENCE.fileId,
        title: REFERENCE.title,
        crop: REFERENCE.crop,
        expected_sha256: REFERENCE.expectedSha256,
        sha256: referenceSha,
        bytes: referenceBytes.byteLength,
      },
      live: {
        target: proof.target,
        http_status: proof.main_document_status,
        sha256: liveSha,
        bytes: liveBytes.byteLength,
      },
      official_metrics: analysis.official_metrics,
      regional: analysis.regional,
      source_revision: afterRevision || beforeRevision,
      provenance: {
        expected_commit: expectedCommit,
        expected_ref: EXPECTED_REF,
        before: beforeRevision,
        after: afterRevision || null,
        failures: provenanceFailures,
      },
      console_errors: consoleErrors,
      app_network_errors: appNetworkErrors,
      http_errors: httpErrors,
      browser_version: proof.browser_version || launched.version,
      timestamp: new Date().toISOString(),
    }, { status: technicalPass && provenancePass ? 200 : 409, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({
      ok: false,
      evidence_pass: false,
      provenance_pass: false,
      screenshot_coherence_pass: false,
      release_authorized: false,
      route: '/opportunities',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await closeBrowser(browser)
  }
}
