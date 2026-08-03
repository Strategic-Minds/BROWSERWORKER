export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BIDFAST_ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'
const EXPECTED_REF = 'auto-builder/bidfast-complete-visual-system'
const EXPECTED_SUPABASE_PROJECT_REF = 'mhaovpyegtysfgualplu'

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

type ConfigHealth = {
  ok?: boolean
  checks?: Record<string, boolean>
  configuration?: {
    project_ref?: string | null
    expected_project_ref?: string | null
  }
  source?: {
    supabase_url?: string
    supabase_publishable_key?: string
  }
}

function isCommitSha(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value))
}

async function readJson<T>(url: string): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'User-Agent': 'BIDFAST-Governed-Config-Provenance/1.0' },
  })
  let body = {} as T
  try {
    body = await response.json() as T
  } catch {
    body = {} as T
  }
  return { status: response.status, body }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const expectedCommit = requestUrl.searchParams.get('expected_commit')

  if (!isCommitSha(expectedCommit)) {
    return Response.json({
      ok: false,
      provenance_pass: false,
      configuration_pass: false,
      error: 'A valid 40-character expected_commit is required.',
    }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const before = await readJson<BuildInfo>(`${BIDFAST_ORIGIN}/api/build-info`)
    const health = await readJson<ConfigHealth>(`${BIDFAST_ORIGIN}/api/health/config`)
    const after = await readJson<BuildInfo>(`${BIDFAST_ORIGIN}/api/build-info`)
    const failures: string[] = []

    const beforeRevision = before.body.source_revision
    const afterRevision = after.body.source_revision

    if (before.status !== 200 || before.body.ok !== true || !beforeRevision) {
      failures.push(`before_build_info_status=${before.status}`)
    }
    if (after.status !== 200 || after.body.ok !== true || !afterRevision) {
      failures.push(`after_build_info_status=${after.status}`)
    }

    if (beforeRevision) {
      if (beforeRevision.commit_sha !== expectedCommit) failures.push(`before_commit=${String(beforeRevision.commit_sha)}`)
      if (beforeRevision.commit_ref !== EXPECTED_REF) failures.push(`before_ref=${String(beforeRevision.commit_ref)}`)
    }
    if (afterRevision) {
      if (afterRevision.commit_sha !== expectedCommit) failures.push(`after_commit=${String(afterRevision.commit_sha)}`)
      if (afterRevision.commit_ref !== EXPECTED_REF) failures.push(`after_ref=${String(afterRevision.commit_ref)}`)
    }
    if (beforeRevision && afterRevision) {
      if (beforeRevision.commit_sha !== afterRevision.commit_sha) failures.push('commit_changed_during_validation')
      if (beforeRevision.deployment_id && afterRevision.deployment_id && beforeRevision.deployment_id !== afterRevision.deployment_id) failures.push('deployment_changed_during_validation')
      if (beforeRevision.deployment_url && afterRevision.deployment_url && beforeRevision.deployment_url !== afterRevision.deployment_url) failures.push('deployment_url_changed_during_validation')
    }

    if (health.status !== 200) failures.push(`health_status=${health.status}`)
    if (health.body.ok !== true) failures.push(`health_ok=${String(health.body.ok)}`)
    if (health.body.checks?.supabase_url_configured !== true) failures.push('supabase_url_not_configured')
    if (health.body.checks?.supabase_publishable_key_configured !== true) failures.push('supabase_publishable_key_not_configured')
    if (health.body.checks?.supabase_project_ref_detected !== true) failures.push('supabase_project_ref_not_detected')
    if (health.body.checks?.supabase_project_ref_matches_expected !== true) failures.push('supabase_project_ref_mismatch')
    if (health.body.configuration?.project_ref !== EXPECTED_SUPABASE_PROJECT_REF) failures.push(`project_ref=${String(health.body.configuration?.project_ref)}`)
    if (health.body.configuration?.expected_project_ref !== EXPECTED_SUPABASE_PROJECT_REF) failures.push(`expected_project_ref=${String(health.body.configuration?.expected_project_ref)}`)
    if (health.body.source?.supabase_url !== 'environment') failures.push(`supabase_url_source=${String(health.body.source?.supabase_url)}`)
    if (health.body.source?.supabase_publishable_key !== 'environment') failures.push(`supabase_publishable_key_source=${String(health.body.source?.supabase_publishable_key)}`)

    const provenancePass = failures.filter(failure => failure.includes('commit') || failure.includes('ref=') || failure.includes('deployment') || failure.includes('build_info')).length === 0
    const configurationPass = failures.length === 0

    return Response.json({
      ok: configurationPass,
      provenance_pass: provenancePass,
      configuration_pass: configurationPass,
      source_revision: afterRevision || beforeRevision || null,
      expected: {
        commit_sha: expectedCommit,
        commit_ref: EXPECTED_REF,
        supabase_project_ref: EXPECTED_SUPABASE_PROJECT_REF,
      },
      health: health.body,
      failures,
      timestamp: new Date().toISOString(),
    }, { status: configurationPass ? 200 : 409, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({
      ok: false,
      provenance_pass: false,
      configuration_pass: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
