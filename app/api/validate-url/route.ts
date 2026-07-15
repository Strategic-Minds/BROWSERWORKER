import { verifyAuth, authResponse } from '@/lib/auth';
import { validatePublicUrl } from '@/lib/ssrf';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.ok) return authResponse();

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON', code: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  if (!body.url) {
    return Response.json({ ok: false, error: 'url is required', code: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  const result = await validatePublicUrl(body.url);
  return Response.json({ ...result, url: body.url });
}
