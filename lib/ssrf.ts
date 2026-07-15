const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

const BLOCKED_HOSTS = [
  'localhost',
  '169.254.169.254',
  'metadata.google.internal',
  '100.100.100.200',
  'metadata.azure.com',
  'metadata.internal',
];

const BLOCKED_SCHEMES = ['file:', 'ftp:', 'data:', 'javascript:', 'chrome:', 'vbscript:'];

function isPrivateIp(hostname: string): boolean {
  return PRIVATE_IPV4_RANGES.some(r => r.test(hostname));
}

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
}

function hasEmbeddedCredentials(url: URL): boolean {
  return !!(url.username || url.password);
}

export function validateUrl(rawUrl: string): { ok: boolean; error?: string; code?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Invalid URL format', code: 'URL_NOT_ALLOWED' };
  }

  // Scheme check
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    if (BLOCKED_SCHEMES.includes(parsed.protocol)) {
      return { ok: false, error: `Scheme "${parsed.protocol}" is not allowed`, code: 'SSRF_BLOCKED' };
    }
    return { ok: false, error: 'Only http and https are allowed', code: 'URL_NOT_ALLOWED' };
  }

  // Embedded credentials
  if (hasEmbeddedCredentials(parsed)) {
    return { ok: false, error: 'URLs with embedded credentials are not allowed', code: 'SSRF_BLOCKED' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocked hosts
  if (isBlockedHost(hostname)) {
    return { ok: false, error: `Host "${hostname}" is blocked`, code: 'SSRF_BLOCKED' };
  }

  // Private IP ranges
  if (isPrivateIp(hostname)) {
    return { ok: false, error: `Private IP ranges are not allowed`, code: 'SSRF_BLOCKED' };
  }

  // IPv6 private/loopback
  if (hostname === '::1' || hostname === '[::1]') {
    return { ok: false, error: 'IPv6 loopback is not allowed', code: 'SSRF_BLOCKED' };
  }
  if (hostname.startsWith('fd') || hostname.startsWith('fe80')) {
    return { ok: false, error: 'Private IPv6 ranges are not allowed', code: 'SSRF_BLOCKED' };
  }

  // Optional allowlist
  const allowedHosts = process.env.BROWSER_ALLOWED_HOSTS;
  if (allowedHosts) {
    const allowed = allowedHosts.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
    if (allowed.length > 0) {
      const isAllowed = allowed.some(h => hostname === h || hostname.endsWith('.' + h));
      if (!isAllowed) {
        return { ok: false, error: `Host "${hostname}" is not in the allowlist`, code: 'URL_NOT_ALLOWED' };
      }
    }
  }

  return { ok: true };
}
