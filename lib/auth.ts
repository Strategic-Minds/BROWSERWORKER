import { timingSafeEqual } from 'node:crypto';

function configuredSecret(): string {
  return process.env.BROWSER_WORKER_SECRET?.trim() || '';
}

function safeEquals(candidate: string, expected: string): boolean {
  const size = Math.max(Buffer.byteLength(candidate), Buffer.byteLength(expected), 1);
  const candidateBuffer = Buffer.alloc(size);
  const expectedBuffer = Buffer.alloc(size);
  Buffer.from(candidate).copy(candidateBuffer);
  Buffer.from(expected).copy(expectedBuffer);
  return timingSafeEqual(candidateBuffer, expectedBuffer)
    && Buffer.byteLength(candidate) === Buffer.byteLength(expected);
}

export function verifyAuth(request: Request): { ok: boolean; error?: string; code?: string } {
  const secret = configuredSecret();
  if (!secret) {
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
    if (!safeEquals(candidate, secret)) {
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
