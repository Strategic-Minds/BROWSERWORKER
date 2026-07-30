import { BIDFAST_PLAN_SOURCES, getPlanSource } from '@/config/bidfast-plan-sources'
import { discoverPlanSource } from '@/lib/bidfast/planDiscovery'
import { authResponse, verifyAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: Request) {
  const sourceId = new URL(request.url).searchParams.get('source_id')
  if (sourceId) {
    if (!getPlanSource(sourceId)) {
      return Response.json({ ok: false, error: 'Unknown source_id' }, { status: 400 })
    }
    try {
      const receipt = await discoverPlanSource(sourceId, 60)
      return Response.json(receipt, {
        headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
      })
    } catch (error) {
      return Response.json({
        ok: false,
        source_id: sourceId,
        error: error instanceof Error ? error.message : 'Plan discovery failed',
      }, { status: 500 })
    }
  }

  return Response.json({
    ok: true,
    sources: BIDFAST_PLAN_SOURCES.map(({ probeUrl, ...source }) => ({
      ...source,
      probeConfigured: Boolean(probeUrl),
    })),
    policy: {
      arbitraryUrlsAccepted: false,
      downloadsPerformed: false,
      registrationsPerformed: false,
      restrictedDownloadsBlocked: true,
      publicDiscoveryScope: 'fixed official source registry only',
    },
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
  })
}

export async function POST(request: Request) {
  const auth = verifyAuth(request)
  if (!auth.ok) return authResponse()

  let body: { source_id?: string; max_links?: number }
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 })
  }

  if (!body.source_id) {
    return Response.json({ ok: false, error: 'source_id is required' }, { status: 400 })
  }

  try {
    const receipt = await discoverPlanSource(body.source_id, body.max_links ?? 60)
    return Response.json(receipt, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return Response.json({
      ok: false,
      source_id: body.source_id,
      error: error instanceof Error ? error.message : 'Plan discovery failed',
    }, { status: 500 })
  }
}
