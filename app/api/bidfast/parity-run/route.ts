import { z } from 'zod';
import { runBidfastParity } from '../../../../lib/bidfast-parity';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const TOKEN = 'bf-parity-20260730-9c6f4d7a2e1b8f035ab4c1d0e7f29163';
const Query = z.object({
  token: z.string(),
  scenario: z.string().min(1).max(80),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = Query.parse({
      token: url.searchParams.get('token'),
      scenario: url.searchParams.get('scenario'),
    });
    if (query.token !== TOKEN) {
      return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const receipt = await runBidfastParity(query.scenario);
    return Response.json(receipt, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        pass: false,
        code: 'BIDFAST_PARITY_RUN_FAILED',
        error: error instanceof Error ? error.message : String(error),
        created_at: new Date().toISOString(),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
