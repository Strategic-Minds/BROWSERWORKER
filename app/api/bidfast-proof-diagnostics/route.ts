export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const APPROVED_ROUTES = new Set([
  '/dashboard',
  '/analytics',
  '/approvals',
  '/opportunities',
  '/estimates/new',
  '/proposals',
  '/projects/demo-riverside',
  '/takeoffs/demo-riverside',
  '/settings/company',
  '/assistant',
])

function boundedString(value: unknown, limit = 2000): string | null {
  return typeof value === 'string' ? value.slice(0, limit) : null
}

function boundedStrings(value: unknown, limit = 50): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, limit)
    .map(item => item.slice(0, 1500))
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const route = requestUrl.searchParams.get('route') || '/dashboard'

  if (!APPROVED_ROUTES.has(route)) {
    return Response.json({
      ok: false,
      error: 'Route is not registered for BIDFAST proof diagnostics.',
      registered_routes: [...APPROVED_ROUTES],
    }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const proofUrl = new URL('/api/bidfast-proof', requestUrl.origin)
  proofUrl.searchParams.set('route', route)
  proofUrl.searchParams.set('theme', 'light')
  proofUrl.searchParams.set('viewport', 'mobile')
  proofUrl.searchParams.set('format', 'json')

  try {
    const proofResponse = await fetch(proofUrl, { cache: 'no-store' })
    const rawBody = await proofResponse.text()
    let proof: Record<string, unknown> = {}

    try {
      proof = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      proof = { error: `Proof endpoint returned non-JSON content (${rawBody.length} bytes).` }
    }

    const result = {
      ok: proofResponse.ok && proof.ok === true,
      route,
      proof_http_status: proofResponse.status,
      evidence_pass: proof.evidence_pass === true,
      error: boundedString(proof.error),
      target: boundedString(proof.target),
      final_url: boundedString(proof.final_url),
      route_match: proof.route_match === true,
      auth_redirect_detected: proof.auth_redirect_detected === true,
      main_document_status: typeof proof.main_document_status === 'number' ? proof.main_document_status : null,
      document_theme: boundedString(proof.document_theme, 100),
      page_height: typeof proof.page_height === 'number' ? proof.page_height : null,
      links_count: typeof proof.links_count === 'number' ? proof.links_count : null,
      console_errors: boundedStrings(proof.console_errors),
      app_network_errors: boundedStrings(proof.app_network_errors),
      http_errors: boundedStrings(proof.http_errors),
      ignored_network_events: boundedStrings(proof.ignored_network_events),
      browser_version: boundedString(proof.browser_version, 200),
      timestamp: new Date().toISOString(),
    }

    return Response.json(result, {
      status: proofResponse.ok ? 200 : 502,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return Response.json({
      ok: false,
      route,
      error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      timestamp: new Date().toISOString(),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
