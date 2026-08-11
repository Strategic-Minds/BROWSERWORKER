import { createHash } from 'node:crypto'
import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const BIDFAST_ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'
const EXPECTED_REF = 'auto-builder/bidfast-complete-visual-system'
const DASHBOARD_PATH = '/dashboard'
const DRIVE_FILE_ID = '1_GbJt7os0BTg6_9eLBp-Zltd1lk-FHGr'
const DRIVE_TITLE = '01_BIDFAST_MOBILE_EXECUTIVE_DASHBOARD.png'
const EXPECTED_REFERENCE_SHA256 = 'f856235d88dae3b9eabf8f49816abb36a982f2054cc7002b52bdbdac60f207cb'
const APPROVED_PHONE_CROP = { x: 178, y: 150, width: 570, height: 1387 }

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

type ProofBody = {
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

function isCommitSha(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value))
}

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

async function readBuildInfo(): Promise<{ status: number; body: BuildInfo }> {
  const response = await fetch(`${BIDFAST_ORIGIN}/api/build-info`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'BIDFAST-Header-Edge-Diagnostic/1.0' },
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
      provenance_pass: false,
      route: DASHBOARD_PATH,
      error: 'A valid 40-character expected_commit is required.',
    }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const before = await readBuildInfo()
    if (before.status !== 200 || before.body.ok !== true || !before.body.source_revision) {
      return Response.json({
        ok: false,
        provenance_pass: false,
        route: DASHBOARD_PATH,
        error: 'BIDFAST preview revision evidence was unavailable before edge analysis.',
        build_info_status: before.status,
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }

    const proofUrl = new URL('/api/bidfast-proof', requestUrl.origin)
    proofUrl.searchParams.set('route', DASHBOARD_PATH)
    proofUrl.searchParams.set('theme', 'light')
    proofUrl.searchParams.set('viewport', 'mobile')

    const [proofResponse, referenceResponse] = await Promise.all([
      fetch(proofUrl, { cache: 'no-store' }),
      fetch(`https://drive.google.com/uc?export=download&id=${DRIVE_FILE_ID}`, {
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'User-Agent': 'BIDFAST-Header-Edge-Diagnostic/1.0' },
      }),
    ])

    if (!proofResponse.ok) throw new Error(`Browser proof failed with HTTP ${proofResponse.status}.`)
    if (!referenceResponse.ok) throw new Error(`Drive reference failed with HTTP ${referenceResponse.status}.`)

    const proof = await proofResponse.json() as ProofBody
    if (!proof.screenshot?.data) throw new Error('Browser proof did not return screenshot bytes.')

    const referenceType = referenceResponse.headers.get('content-type') || ''
    if (!referenceType.startsWith('image/')) throw new Error(`Drive reference returned ${referenceType || 'an invalid media type'}.`)

    const liveBytes = new Uint8Array(Buffer.from(proof.screenshot.data, 'base64'))
    const referenceBytes = new Uint8Array(await referenceResponse.arrayBuffer())
    const referenceSha256 = sha256(referenceBytes)

    if (referenceSha256 !== EXPECTED_REFERENCE_SHA256) {
      return Response.json({
        ok: false,
        provenance_pass: false,
        integrity_pass: false,
        route: DASHBOARD_PATH,
        error: 'Approved Drive reference bytes do not match the pinned checkpoint hash.',
        reference: {
          drive_file_id: DRIVE_FILE_ID,
          title: DRIVE_TITLE,
          expected_sha256: EXPECTED_REFERENCE_SHA256,
          actual_sha256: referenceSha256,
          bytes: referenceBytes.byteLength,
        },
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
    }

    const launched = await launchBrowser()
    browser = launched.browser
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.setContent('<!doctype html><html><body></body></html>')

    const analysis: any = await page.evaluate(async ({ liveDataUrl, referenceDataUrl, crop }) => {
      type Region = { x: number; y: number; width: number; height: number }
      type RegionScore = {
        pixel_similarity: number
        structure_similarity: number
        edge_similarity: number
        color_similarity: number
        composite_score: number
        compared_pixels: number
      }

      const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('Image decode failed.'))
        image.src = src
      })

      const [liveImage, referenceImage] = await Promise.all([load(liveDataUrl), load(referenceDataUrl)])
      const width = 390
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
      const luma = (data: Uint8ClampedArray, x: number, y: number) => {
        const index = (y * width + x) * 4
        return .2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]
      }

      const clampRegion = (region: Region): Region => ({
        x: Math.max(0, Math.min(width - 1, Math.round(region.x))),
        y: Math.max(0, Math.min(height - 1, Math.round(region.y))),
        width: Math.max(1, Math.min(width - Math.max(0, Math.round(region.x)), Math.round(region.width))),
        height: Math.max(1, Math.min(height - Math.max(0, Math.round(region.y)), Math.round(region.height))),
      })

      const scoreRegion = (inputRegion: Region, referenceDx = 0, referenceDy = 0): RegionScore => {
        const region = clampRegion(inputRegion)
        let pixelTotal = 0
        let comparedPixels = 0
        const liveHistogram = new Array(48).fill(0)
        const approvedHistogram = new Array(48).fill(0)

        for (let y = region.y; y < region.y + region.height; y += 1) {
          for (let x = region.x; x < region.x + region.width; x += 1) {
            const approvedX = x + referenceDx
            const approvedY = y + referenceDy
            if (approvedX < 0 || approvedY < 0 || approvedX >= width || approvedY >= height) continue
            const liveIndex = (y * width + x) * 4
            const approvedIndex = (approvedY * width + approvedX) * 4
            let difference = 0
            for (let channel = 0; channel < 3; channel += 1) {
              difference += Math.max(0, Math.abs(live[liveIndex + channel] - approved[approvedIndex + channel]) - 6) / 249
              liveHistogram[channel * 16 + Math.min(15, Math.floor(live[liveIndex + channel] / 16))] += 1
              approvedHistogram[channel * 16 + Math.min(15, Math.floor(approved[approvedIndex + channel] / 16))] += 1
            }
            pixelTotal += 1 - difference / 3
            comparedPixels += 1
          }
        }

        const blocksX = Math.max(2, Math.min(8, Math.round(region.width / 24)))
        const blocksY = Math.max(2, Math.min(8, Math.round(region.height / 18)))
        let blockDifference = 0
        let blockCount = 0

        for (let by = 0; by < blocksY; by += 1) {
          for (let bx = 0; bx < blocksX; bx += 1) {
            const x0 = region.x + Math.floor(bx * region.width / blocksX)
            const x1 = region.x + Math.floor((bx + 1) * region.width / blocksX)
            const y0 = region.y + Math.floor(by * region.height / blocksY)
            const y1 = region.y + Math.floor((by + 1) * region.height / blocksY)
            let liveMean = 0
            let approvedMean = 0
            let count = 0
            for (let y = y0; y < y1; y += 1) {
              for (let x = x0; x < x1; x += 1) {
                const approvedX = x + referenceDx
                const approvedY = y + referenceDy
                if (approvedX < 0 || approvedY < 0 || approvedX >= width || approvedY >= height) continue
                liveMean += luma(live, x, y)
                approvedMean += luma(approved, approvedX, approvedY)
                count += 1
              }
            }
            if (count > 0) {
              blockDifference += Math.abs(liveMean / count - approvedMean / count) / 255
              blockCount += 1
            }
          }
        }

        let edgeDifference = 0
        let edgeMagnitude = 0
        for (let y = region.y; y < region.y + region.height - 1; y += 1) {
          for (let x = region.x; x < region.x + region.width - 1; x += 1) {
            const approvedX = x + referenceDx
            const approvedY = y + referenceDy
            if (approvedX < 0 || approvedY < 0 || approvedX + 1 >= width || approvedY + 1 >= height) continue
            const liveGradient = Math.abs(luma(live, x + 1, y) - luma(live, x, y)) + Math.abs(luma(live, x, y + 1) - luma(live, x, y))
            const approvedGradient = Math.abs(luma(approved, approvedX + 1, approvedY) - luma(approved, approvedX, approvedY)) + Math.abs(luma(approved, approvedX, approvedY + 1) - luma(approved, approvedX, approvedY))
            edgeDifference += Math.abs(liveGradient - approvedGradient)
            edgeMagnitude += Math.max(16, approvedGradient)
          }
        }

        let histogramOverlap = 0
        for (let index = 0; index < liveHistogram.length; index += 1) histogramOverlap += Math.min(liveHistogram[index], approvedHistogram[index])

        const pixelSimilarity = comparedPixels > 0 ? pixelTotal / comparedPixels : 0
        const structureSimilarity = blockCount > 0 ? 1 - blockDifference / blockCount : 0
        const edgeSimilarity = edgeMagnitude > 0 ? 1 - Math.min(1, edgeDifference / edgeMagnitude) : 0
        const colorSimilarity = comparedPixels > 0 ? histogramOverlap / (comparedPixels * 3) : 0
        const composite = .30 * pixelSimilarity + .35 * structureSimilarity + .20 * edgeSimilarity + .15 * colorSimilarity

        return {
          pixel_similarity: Number(pixelSimilarity.toFixed(6)),
          structure_similarity: Number(structureSimilarity.toFixed(6)),
          edge_similarity: Number(edgeSimilarity.toFixed(6)),
          color_similarity: Number(colorSimilarity.toFixed(6)),
          composite_score: Number(composite.toFixed(6)),
          compared_pixels: comparedPixels,
        }
      }

      const edgeCentroid = (data: Uint8ClampedArray, inputRegion: Region) => {
        const region = clampRegion(inputRegion)
        let total = 0
        let weightedX = 0
        let weightedY = 0
        let peak = 0
        for (let y = region.y; y < region.y + region.height - 1; y += 1) {
          for (let x = region.x; x < region.x + region.width - 1; x += 1) {
            const magnitude = Math.abs(luma(data, x + 1, y) - luma(data, x, y)) + Math.abs(luma(data, x, y + 1) - luma(data, x, y))
            total += magnitude
            weightedX += magnitude * x
            weightedY += magnitude * y
            peak = Math.max(peak, magnitude)
          }
        }
        return {
          x: total > 0 ? Number((weightedX / total).toFixed(3)) : null,
          y: total > 0 ? Number((weightedY / total).toFixed(3)) : null,
          total_magnitude: Number(total.toFixed(3)),
          peak_magnitude: Number(peak.toFixed(3)),
        }
      }

      const sweep = (region: Region, maxDx: number, maxDy: number) => {
        const baseline = scoreRegion(region, 0, 0)
        let best = { dx: 0, dy: 0, metrics: baseline }
        for (let dy = -maxDy; dy <= maxDy; dy += 1) {
          for (let dx = -maxDx; dx <= maxDx; dx += 1) {
            const metrics = scoreRegion(region, dx, dy)
            if (metrics.composite_score > best.metrics.composite_score) best = { dx, dy, metrics }
          }
        }
        return {
          region: clampRegion(region),
          baseline,
          best_reference_offset: best,
          predicted_composite_gain: Number((best.metrics.composite_score - baseline.composite_score).toFixed(6)),
          live_edge_centroid: edgeCentroid(live, region),
          reference_edge_centroid: edgeCentroid(approved, region),
        }
      }

      const regions = {
        header: { x: 0, y: 0, width: 390, height: 132 },
        logo: { x: 0, y: 10, width: 215, height: 58 },
        actions: { x: 285, y: 10, width: 105, height: 58 },
        search: { x: 0, y: 64, width: 390, height: 70 },
      }

      return {
        normalized: {
          width,
          height,
          live_source_width: liveImage.width,
          live_source_height: liveImage.height,
          reference_source_width: referenceImage.width,
          reference_source_height: referenceImage.height,
          reference_crop: crop,
        },
        regions: {
          header: sweep(regions.header, 8, 8),
          logo: sweep(regions.logo, 14, 10),
          actions: sweep(regions.actions, 12, 10),
          search: sweep(regions.search, 8, 10),
        },
      }
    }, {
      liveDataUrl: `data:${proof.screenshot.mime_type || 'image/jpeg'};base64,${proof.screenshot.data}`,
      referenceDataUrl: `data:${referenceType};base64,${Buffer.from(referenceBytes).toString('base64')}`,
      crop: APPROVED_PHONE_CROP,
    })

    await context.close()

    const after = await readBuildInfo()
    const beforeRevision = before.body.source_revision
    const afterRevision = after.body.source_revision
    const failures: string[] = []

    if (after.status !== 200 || after.body.ok !== true || !afterRevision) {
      failures.push(`post_capture_build_info_status=${after.status}`)
    } else {
      if (beforeRevision.commit_sha !== expectedCommit) failures.push(`before_commit=${String(beforeRevision.commit_sha)}`)
      if (afterRevision.commit_sha !== expectedCommit) failures.push(`after_commit=${String(afterRevision.commit_sha)}`)
      if (beforeRevision.commit_ref !== EXPECTED_REF) failures.push(`before_ref=${String(beforeRevision.commit_ref)}`)
      if (afterRevision.commit_ref !== EXPECTED_REF) failures.push(`after_ref=${String(afterRevision.commit_ref)}`)
      if (beforeRevision.commit_sha !== afterRevision.commit_sha) failures.push('commit_changed_during_capture')
      if (beforeRevision.deployment_id && afterRevision.deployment_id && beforeRevision.deployment_id !== afterRevision.deployment_id) failures.push('deployment_changed_during_capture')
      if (beforeRevision.deployment_url && afterRevision.deployment_url && beforeRevision.deployment_url !== afterRevision.deployment_url) failures.push('deployment_url_changed_during_capture')
    }

    if (proof.evidence_pass !== true) failures.push(`proof_evidence_pass=${String(proof.evidence_pass)}`)
    if (proof.main_document_status !== 200) failures.push(`main_document_status=${String(proof.main_document_status)}`)
    if ((proof.console_errors || []).length !== 0) failures.push(`console_errors=${JSON.stringify(proof.console_errors)}`)
    if ((proof.app_network_errors || []).length !== 0) failures.push(`app_network_errors=${JSON.stringify(proof.app_network_errors)}`)
    if ((proof.http_errors || []).length !== 0) failures.push(`http_errors=${JSON.stringify(proof.http_errors)}`)

    for (const name of ['header', 'logo', 'actions', 'search']) {
      const region = analysis?.regions?.[name]
      if (!region) {
        failures.push(`region_missing=${name}`)
        continue
      }
      if (!Number.isFinite(Number(region.baseline?.composite_score))) failures.push(`region_score_missing=${name}`)
      if (!Number.isFinite(Number(region.best_reference_offset?.dx)) || !Number.isFinite(Number(region.best_reference_offset?.dy))) failures.push(`region_offset_missing=${name}`)
      if (!Number.isFinite(Number(region.predicted_composite_gain))) failures.push(`region_gain_missing=${name}`)
    }

    const provenancePass = failures.filter(failure => failure.includes('commit') || failure.includes('ref') || failure.includes('deployment') || failure.includes('build_info')).length === 0
    const technicalPass = failures.length === 0

    return Response.json({
      ok: technicalPass,
      provenance_pass: provenancePass,
      integrity_pass: true,
      technical_pass: technicalPass,
      route: DASHBOARD_PATH,
      theme: 'light',
      viewport: 'mobile',
      source_revision: afterRevision || beforeRevision,
      reference: {
        drive_file_id: DRIVE_FILE_ID,
        title: DRIVE_TITLE,
        crop: APPROVED_PHONE_CROP,
        expected_sha256: EXPECTED_REFERENCE_SHA256,
        sha256: referenceSha256,
        bytes: referenceBytes.byteLength,
      },
      live: {
        target: proof.target,
        http_status: proof.main_document_status,
        sha256: sha256(liveBytes),
        bytes: liveBytes.byteLength,
        viewport: proof.viewport,
        page_height: proof.page_height,
      },
      analysis,
      console_errors: proof.console_errors || [],
      app_network_errors: proof.app_network_errors || [],
      http_errors: proof.http_errors || [],
      failures,
      browser_version: proof.browser_version || launched.version,
      timestamp: new Date().toISOString(),
    }, { status: technicalPass ? 200 : 409, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({
      ok: false,
      provenance_pass: false,
      integrity_pass: false,
      technical_pass: false,
      route: DASHBOARD_PATH,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await closeBrowser(browser)
  }
}
