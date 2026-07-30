import { getPlanSource } from '@/config/bidfast-plan-sources'
import { discoverPlanSource } from '@/lib/bidfast/planDiscovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === 'production') {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const sourceId = new URL(request.url).searchParams.get('source_id') || ''
  if (!getPlanSource(sourceId)) {
    return Response.json({ ok: false, error: 'Unknown source_id' }, { status: 400 })
  }

  try {
    const receipt = await discoverPlanSource(sourceId, 40)
    return Response.json(receipt, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
    })
  } catch (error) {
    return Response.json({
      ok: false,
      source_id: sourceId,
      error: error instanceof Error ? error.message : 'Plan source probe failed',
    }, { status: 500 })
  }
}
