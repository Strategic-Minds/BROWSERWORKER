import { z } from 'zod';
import { authResponse, verifyAuth } from '../../../../lib/auth';
import { runBidfastParity } from '../../../../lib/bidfast-parity';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const Body = z.object({
  scenario_id: z.string().min(1).max(80),
});

export async function POST(request: Request): Promise<Response> {
  const auth = verifyAuth(request);
  if (!auth.ok) return authResponse();

  try {
    const body = Body.parse(await request.json());
    const receipt = await runBidfastParity(body.scenario_id);
    return Response.json(receipt, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        pass: false,
        code: 'BIDFAST_PARITY_FAILED',
        error: error instanceof Error ? error.message : String(error),
        created_at: new Date().toISOString(),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    service: 'BIDFAST parity endpoint',
    method: 'POST',
    authentication_required: true,
    production_authorized: false,
  });
}
