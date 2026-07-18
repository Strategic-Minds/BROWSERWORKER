import { timingSafeEqual } from 'node:crypto';

export function verifyAuth(request: Request): { ok: boolean; error?: string; code?: string } {
  const BROWSER_WORKER_SECRET = process.env.BROWSER_WORKER_SECRET;
  if (!BROWSER_WORKER_SECRET) {
    return { ok: false, error: 'Worker secret not configured', code: 'AUTHENTICATION_FAILED' };
  }

  const authHeader = request.headers.get('Authorization') || '';
  const secretHeader = request.headers.get('X-Browser-Worker-Secret') || '';

  let candidate = '';
  if (authHeader.startsWith('Bearer ')) {
    candidate = authHeader.slice(7);
  } else if (secretHeader) {
    candidate = secretHeader;
  }

  if (!candidate) {
    return { ok: false, error: 'Missing authorization', code: 'AUTHENTICATION_FAILED' };
  }

  try {
    const a = Buffer.from(candidate.padEnd(BROWSER_WORKER_SECRET.length, '\0'));
    const b = Buffer.from(BROWSER_WORKER_SECRET.padEnd(candidate.length, '\0'));
    const paddedA = Buffer.alloc(Math.max(a.length, b.length), 0);
    const paddedB = Buffer.alloc(Math.max(a.length, b.length), 0);
    a.copy(paddedA);
    b.copy(paddedB);
    const equal = timingSafeEqual(paddedA, paddedB) && candidate.length === BROWSER_WORKER_SECRET.length;
    if (!equal) {
      return { ok: false, error: 'Invalid credentials', code: 'AUTHENTICATION_FAILED' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Auth error', code: 'AUTHENTICATION_FAILED' };
  }
}

export function authResponse(): Response {
  return Response.json(
    { ok: false, error: 'Unauthorized', code: 'AUTHENTICATION_FAILED' },
    { status: 401 }
  );
}
