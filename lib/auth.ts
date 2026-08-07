import { timingSafeEqual } from 'node:crypto';

function authorizedSecrets() {
  return [
    process.env.BROWSER_WORKER_SECRET,
    process.env.AUTO_BUILDER_OPERATOR_TOKEN,
  ].filter((value): value is string => Boolean(value));
}

function safeEqual(candidate: string, expected: string) {
  try {
    const length = Math.max(candidate.length, expected.length);
    const a = Buffer.alloc(length, 0);
    const b = Buffer.alloc(length, 0);
    Buffer.from(candidate).copy(a);
    Buffer.from(expected).copy(b);
    return timingSafeEqual(a, b) && candidate.length === expected.length;
  } catch {
    return false;
  }
}

export function verifyAuth(request: Request): { ok: boolean; error?: string; code?: string } {
  const secrets = authorizedSecrets();
  if (!secrets.length) {
    return { ok: false, error: 'Worker authorization is not configured', code: 'AUTHENTICATION_FAILED' };
  }

  const authHeader = request.headers.get('Authorization') || '';
  const secretHeader = request.headers.get('X-Browser-Worker-Secret') || '';
  const controlPlaneHeader = request.headers.get('X-Auto-Builder-Token') || '';

  let candidate = '';
  if (authHeader.startsWith('Bearer ')) candidate = authHeader.slice(7);
  else if (secretHeader) candidate = secretHeader;
  else if (controlPlaneHeader) candidate = controlPlaneHeader;

  if (!candidate) return { ok: false, error: 'Missing authorization', code: 'AUTHENTICATION_FAILED' };
  if (!secrets.some((secret) => safeEqual(candidate, secret))) return { ok: false, error: 'Invalid credentials', code: 'AUTHENTICATION_FAILED' };
  return { ok: true };
}

export function authResponse(): Response {
  return Response.json({ ok: false, error: 'Unauthorized', code: 'AUTHENTICATION_FAILED' }, { status: 401 });
}
