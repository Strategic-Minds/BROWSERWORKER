export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const BIDFAST_ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'
const EXPECTED_REF = 'auto-builder/bidfast-complete-visual-system'

type SourceRevision = {
  commit_sha: string | null
  commit_ref: string | null
  deployment_id: string | null
  deployment_url: string | null
}

type BuildInfo = {
  ok?: boolean
  source_revision?: SourceRevision
  timestamp?: string
}

function isCommitSha(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value))
}

async function readBuildInfo(): Promise<{ status: number; body: BuildInfo }> {
  const response = await fetch(`${BIDFAST_ORIGIN}/api/build-info`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'BIDFAST-Governed-Parity/3.0' },
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
  const route = requestUrl.searchParams.get('route') || '/dashboard'
  const expectedCommit = requestUrl.searchParams.get('expected_commit')

  if (!isCommitSha(expectedCommit)) {
    return Response.json({
      ok: false,
      evidence_pass: false,
      provenance_pass: false,
      route,
      error: 'A valid 40-character expected_commit is required.',
    }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const before = await readBuildInfo()
    if (before.status !== 200 || before.body.ok !== true || !before.body.source_revision) {
      return Response.json({
        ok: false,
        evidence_pass: false,
        provenance_pass: false,
        route,
        error: 'BIDFAST preview revision evidence was unavailable before capture.',
        build_info_status: before.status,
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }

    const parityUrl = new URL('/api/bidfast-parity-v2', requestUrl.origin)
    parityUrl.searchParams.set('route', route)
    const parityResponse = await fetch(parityUrl, { cache: 'no-store' })
    const parityBody = await parityResponse.json() as Record<string, unknown>

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

    const provenancePass = failures.length === 0
    const underlyingEvidencePass = parityBody.evidence_pass === true
    const underlyingTechnicalPass = parityBody.technical_pass === true
    const status = parityResponse.ok && provenancePass ? parityResponse.status : 409

    return Response.json({
      ...parityBody,
      evidence_pass: underlyingEvidencePass && provenancePass,
      technical_pass: underlyingTechnicalPass && provenancePass,
      provenance_pass: provenancePass,
      source_revision: afterRevision || beforeRevision,
      provenance: {
        expected_commit: expectedCommit,
        expected_ref: EXPECTED_REF,
        before: beforeRevision,
        after: afterRevision || null,
        failures,
      },
    }, { status, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({
      ok: false,
      evidence_pass: false,
      provenance_pass: false,
      route,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
