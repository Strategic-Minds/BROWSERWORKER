import { timingSafeEqual } from 'node:crypto';

function configuredSecrets(): string[] {
  return [
    process.env.BROWSER_WORKER_SECRET,
    process.env.AUTO_BUILDER_OPERATOR_TOKEN,
  ]
    .map((value) => value?.trim() || '')
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
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
  const secrets = configuredSecrets();
  if (secrets.length === 0) {
    return { ok: false, error: 'Worker authorization is not configured', code: 'AUTHENTICATION_FAILED' };
  }

  const authHeader = request.headers.get('Authorization') || '';
  const secretHeader = request.headers.get('X-Browser-Worker-Secret') || '';
  const controlPlaneHeader = request.headers.get('X-Auto-Builder-Token') || '';

  let candidate = '';
  if (authHeader.startsWith('Bearer ')) {
    candidate = authHeader.slice(7);
  } else if (secretHeader) {
    candidate = secretHeader;
  } else if (controlPlaneHeader) {
    candidate = controlPlaneHeader;
  }

  if (!candidate) {
    return { ok: false, error: 'Missing authorization', code: 'AUTHENTICATION_FAILED' };
  }

  try {
    if (!secrets.some((secret) => safeEquals(candidate, secret))) {
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
    { status: 401 },
  );
}
