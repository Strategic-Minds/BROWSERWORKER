export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const APPROVED_CROP = {
  name: 'content_with_margins',
  x: 165,
  y: 150,
  width: 611,
  height: 1398,
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  const [calibrationResponse, evidenceResponse] = await Promise.all([
    fetch(`${origin}/api/bidfast-parity-calibrate`, { cache: 'no-store' }),
    fetch(`${origin}/api/bidfast-parity-v2?route=%2Fdashboard`, { cache: 'no-store' }),
  ])

  if (!calibrationResponse.ok || !evidenceResponse.ok) {
    return Response.json({
      ok: false,
      evidence_pass: false,
      error: 'A required parity evidence source failed.',
      calibration_status: calibrationResponse.status,
      evidence_status: evidenceResponse.status,
      timestamp: new Date().toISOString(),
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }

  const calibration = await calibrationResponse.json() as {
    technical_pass?: boolean
    live_page_height?: number
    candidates?: Array<{
      name: string
      x: number
      y: number
      width: number
      height: number
      expected_height_at_390: number
      pixel_similarity: number
      structure_similarity: number
      edge_similarity: number
      color_similarity: number
      composite_score: number
    }>
  }
  const evidence = await evidenceResponse.json() as {
    technical_pass?: boolean
    route?: string
    theme?: string
    viewport?: unknown
    reference?: unknown
    live?: unknown
    console_errors?: string[]
    app_network_errors?: string[]
    http_errors?: unknown[]
    browser_version?: string
  }

  const score = calibration.candidates?.find(candidate =>
    candidate.x === APPROVED_CROP.x &&
    candidate.y === APPROVED_CROP.y &&
    candidate.width === APPROVED_CROP.width &&
    candidate.height === APPROVED_CROP.height
  )

  if (!score) {
    return Response.json({
      ok: false,
      evidence_pass: false,
      error: 'The approved Drive crop was not returned by the calibrator.',
      approved_crop: APPROVED_CROP,
      timestamp: new Date().toISOString(),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }

  const technicalPass = calibration.technical_pass === true && evidence.technical_pass === true
  const visualPass = score.composite_score >= .99

  return Response.json({
    ok: true,
    evidence_pass: technicalPass && visualPass,
    technical_pass: technicalPass,
    visual_pass: visualPass,
    visual_threshold: .99,
    route: evidence.route || '/dashboard',
    theme: evidence.theme || 'light',
    viewport: evidence.viewport,
    live_page_height: calibration.live_page_height,
    approved_crop: APPROVED_CROP,
    metrics: score,
    reference: evidence.reference,
    live: evidence.live,
    console_errors: evidence.console_errors || [],
    app_network_errors: evidence.app_network_errors || [],
    http_errors: evidence.http_errors || [],
    browser_version: evidence.browser_version,
    timestamp: new Date().toISOString(),
  }, { status: technicalPass ? 200 : 422, headers: { 'Cache-Control': 'no-store' } })
}
