import { createHash } from 'node:crypto'
import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const BIDFAST_ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'
const EXPECTED_REF = 'auto-builder/bidfast-complete-visual-system'
const REFERENCE = {
  fileId: '1jhUC4Zzwi6JBRWD51jwZWutJhUJIDETH',
  title: '05_BIDFAST_MOBILE_ESTIMATE_BUILDER.png',
  expectedSha256: '3b50c10978f4e4ba111eba5cdd5dc15bf76c73a653920955cca894ee07e5854b',
  crop: { x: 178, y: 150, width: 570, height: 1387 },
}

const REGIONS = [
  { name: 'workspace_header', y0: 0, y1: .16 },
  { name: 'estimate_metrics', y0: .16, y1: .34 },
  { name: 'builder_header_fields', y0: .34, y1: .53 },
  { name: 'line_items', y0: .53, y1: .70 },
  { name: 'totals_actions', y0: .70, y1: .84 },
  { name: 'lower_workspace', y0: .84, y1: .96 },
  { name: 'bottom_navigation', y0: .96, y1: 1 },
]

type SourceRevision = {
  commit_sha: string | null
  commit_ref: string | null
  deployment_id: string | null
  deployment_url: string | null
}

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function validCommit(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value))
}

async function readBuildInfo(): Promise<{ status: number; source_revision: SourceRevision | null }> {
  const response = await fetch(`${BIDFAST_ORIGIN}/api/build-info`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'BIDFAST-Estimate-Region-Diagnostic/1.0' },
  })
  let body: { source_revision?: SourceRevision } = {}
  try {
    body = await response.json() as { source_revision?: SourceRevision }
  } catch {
    body = {}
  }
  return { status: response.status, source_revision: body.source_revision || null }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const expectedCommit = requestUrl.searchParams.get('expected_commit')
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null

  if (!validCommit(expectedCommit)) {
    return Response.json({ ok: false, diagnostic_pass: false, error: 'A valid 40-character expected_commit is required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const before = await readBuildInfo()
    const proofUrl = new URL('/api/bidfast-proof', requestUrl.origin)
    proofUrl.searchParams.set('route', '/estimates/new')
    proofUrl.searchParams.set('theme', 'light')
    proofUrl.searchParams.set('viewport', 'mobile')

    const [proofResponse, referenceResponse] = await Promise.all([
      fetch(proofUrl, { cache: 'no-store' }),
      fetch(`https://drive.google.com/uc?export=download&id=${REFERENCE.fileId}`, {
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'User-Agent': 'BIDFAST-Estimate-Region-Diagnostic/1.0' },
      }),
    ])

    if (!proofResponse.ok) throw new Error(`Browser proof failed with HTTP ${proofResponse.status}.`)
    if (!referenceResponse.ok) throw new Error(`Drive reference failed with HTTP ${referenceResponse.status}.`)

    const proof = await proofResponse.json() as {
      evidence_pass?: boolean
      screenshot?: { data?: string; mime_type?: string }
      console_errors?: string[]
      app_network_errors?: string[]
      http_errors?: string[]
      page_height?: number
      main_document_status?: number
      target?: string
      browser_version?: string
    }
    if (!proof.screenshot?.data) throw new Error('Browser proof did not return screenshot bytes.')
    const screenshotData = proof.screenshot.data

    const referenceType = referenceResponse.headers.get('content-type') || ''
    if (!referenceType.startsWith('image/')) throw new Error(`Drive reference returned ${referenceType || 'an invalid media type'}.`)
    const referenceBytes = new Uint8Array(await referenceResponse.arrayBuffer())
    const referenceSha = sha256(referenceBytes)
    if (referenceSha !== REFERENCE.expectedSha256) {
      return Response.json({
        ok: false,
        diagnostic_pass: false,
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
    const analysisPage = await context.newPage()
    await analysisPage.setContent('<!doctype html><html><body></body></html>')

    const analysis = await analysisPage.evaluate(async ({ liveDataUrl, referenceDataUrl, crop, regions }) => {
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

      const score = (yStart: number, yEnd: number) => {
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
        overall: score(0, height),
        regions: regions.map(region => {
          const yStart = Math.max(0, Math.floor(region.y0 * height))
          const yEnd = Math.min(height, Math.ceil(region.y1 * height))
          return { name: region.name, y_start: yStart, y_end: yEnd, ...score(yStart, yEnd) }
        }).sort((a, b) => a.diagnostic_score - b.diagnostic_score),
      }
    }, {
      liveDataUrl: `data:${proof.screenshot.mime_type || 'image/png'};base64,${screenshotData}`,
      referenceDataUrl: `data:${referenceType};base64,${Buffer.from(referenceBytes).toString('base64')}`,
      crop: REFERENCE.crop,
      regions: REGIONS,
    })

    const geometryPage = await context.newPage()
    await geometryPage.addInitScript(() => localStorage.setItem('bidfast-theme', 'light'))
    await geometryPage.goto(`${BIDFAST_ORIGIN}/estimates/new`, { waitUntil: 'networkidle', timeout: 90000 })
    await geometryPage.waitForTimeout(800)
    const geometry = await geometryPage.evaluate(() => {
      const rect = (selector: string, index = 0) => {
        const element = document.querySelectorAll(selector)[index] as HTMLElement | undefined
        if (!element) return null
        const box = element.getBoundingClientRect()
        return {
          x: Number(box.x.toFixed(2)),
          y: Number(box.y.toFixed(2)),
          width: Number(box.width.toFixed(2)),
          height: Number(box.height.toFixed(2)),
          right: Number(box.right.toFixed(2)),
          bottom: Number(box.bottom.toFixed(2)),
        }
      }
      return {
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        workspace: rect('.bf-workspace-content'),
        header: rect('.bf-workspace-header'),
        metrics: rect('.bf-metric-grid'),
        metric_1: rect('.bf-stat', 0),
        builder_card: rect('form.bf-card'),
        builder_header: rect('form.bf-card .bf-workspace-table-header'),
        project_select: rect('#estimate-project'),
        takeoff_select: rect('#estimate-takeoff'),
        overhead_input: rect('#estimate-overhead'),
        profit_input: rect('#estimate-profit'),
        tax_input: rect('#estimate-tax'),
        line_items_table: rect('table[aria-label="Estimate line items"]'),
        first_description: rect('input[aria-label="Line 1 description"]'),
        first_quantity: rect('input[aria-label="Line 1 quantity"]'),
        save_estimate: rect('#save-estimate'),
      }
    })

    await context.close()
    const after = await readBuildInfo()
    const provenanceFailures: string[] = []
    for (const [name, snapshot] of [['before', before], ['after', after]] as const) {
      if (snapshot.status !== 200 || !snapshot.source_revision) provenanceFailures.push(`${name}_build_info_unavailable`)
      else {
        if (snapshot.source_revision.commit_sha !== expectedCommit) provenanceFailures.push(`${name}_commit=${String(snapshot.source_revision.commit_sha)}`)
        if (snapshot.source_revision.commit_ref !== EXPECTED_REF) provenanceFailures.push(`${name}_ref=${String(snapshot.source_revision.commit_ref)}`)
      }
    }
    if (before.source_revision?.deployment_id && after.source_revision?.deployment_id && before.source_revision.deployment_id !== after.source_revision.deployment_id) {
      provenanceFailures.push('deployment_changed_during_diagnostic')
    }

    const technicalPass = proof.evidence_pass === true
      && (proof.console_errors || []).length === 0
      && (proof.app_network_errors || []).length === 0
      && (proof.http_errors || []).length === 0
      && proof.main_document_status === 200
    const provenancePass = provenanceFailures.length === 0

    return Response.json({
      ok: true,
      diagnostic_pass: technicalPass && provenancePass,
      diagnostic_only: true,
      release_authorized: false,
      validator_version: 'estimate-regions-v1',
      route: '/estimates/new',
      theme: 'light',
      viewport: { name: 'mobile', width: 390, height: 844 },
      page_height: proof.page_height,
      reference: {
        drive_file_id: REFERENCE.fileId,
        title: REFERENCE.title,
        crop: REFERENCE.crop,
        sha256: referenceSha,
      },
      live: {
        target: proof.target,
        http_status: proof.main_document_status,
        sha256: sha256(new Uint8Array(Buffer.from(screenshotData, 'base64'))),
      },
      analysis,
      geometry,
      technical_pass: technicalPass,
      provenance_pass: provenancePass,
      source_revision: after.source_revision || before.source_revision,
      provenance: { expected_commit: expectedCommit, expected_ref: EXPECTED_REF, before, after, failures: provenanceFailures },
      console_errors: proof.console_errors || [],
      app_network_errors: proof.app_network_errors || [],
      http_errors: proof.http_errors || [],
      browser_version: proof.browser_version || launched.version,
      timestamp: new Date().toISOString(),
    }, { status: technicalPass && provenancePass ? 200 : 409, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ ok: false, diagnostic_pass: false, diagnostic_only: true, release_authorized: false, error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await closeBrowser(browser)
  }
}
