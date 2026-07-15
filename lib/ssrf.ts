import { lookup } from 'node:dns/promises';

const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.18\./,
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

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIp(hostname: string): boolean {
  const host = normalizedHost(hostname);
  if (PRIVATE_IPV4_RANGES.some(range => range.test(host))) return true;
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  if (host.startsWith('::ffff:')) return PRIVATE_IPV4_RANGES.some(range => range.test(host.slice(7)));
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const host = normalizedHost(hostname);
  return BLOCKED_HOSTS.some(blocked => host === blocked || host.endsWith('.' + blocked));
}

function hasEmbeddedCredentials(url: URL): boolean {
  return !!(url.username || url.password);
}

function enforceAllowlist(hostname: string): { ok: boolean; error?: string; code?: string } {
  if (process.env.BROWSER_STRICT_ALLOWLIST !== 'true') return { ok: true };
  const allowed = (process.env.BROWSER_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  const host = normalizedHost(hostname);
  if (allowed.length === 0 || !allowed.some(item => host === item || host.endsWith('.' + item))) {
    return { ok: false, error: `Host "${host}" is not in the allowlist`, code: 'URL_NOT_ALLOWED' };
  }
  return { ok: true };
}

export function validateUrl(rawUrl: string): { ok: boolean; error?: string; code?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Invalid URL format', code: 'URL_NOT_ALLOWED' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    if (BLOCKED_SCHEMES.includes(parsed.protocol)) {
      return { ok: false, error: `Scheme "${parsed.protocol}" is not allowed`, code: 'SSRF_BLOCKED' };
    }
    return { ok: false, error: 'Only http and https are allowed', code: 'URL_NOT_ALLOWED' };
  }

  if (hasEmbeddedCredentials(parsed)) {
    return { ok: false, error: 'URLs with embedded credentials are not allowed', code: 'SSRF_BLOCKED' };
  }

  const hostname = normalizedHost(parsed.hostname);
  if (isBlockedHost(hostname)) {
    return { ok: false, error: `Host "${hostname}" is blocked`, code: 'SSRF_BLOCKED' };
  }
  if (isPrivateIp(hostname)) {
    return { ok: false, error: 'Private IP ranges are not allowed', code: 'SSRF_BLOCKED' };
  }

  return enforceAllowlist(hostname);
}

export async function validatePublicUrl(rawUrl: string): Promise<{ ok: boolean; error?: string; code?: string }> {
  const basic = validateUrl(rawUrl);
  if (!basic.ok) return basic;

  const hostname = normalizedHost(new URL(rawUrl).hostname);
  if (/^[0-9.]+$/.test(hostname) || hostname.includes(':')) return basic;

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
      return { ok: false, error: 'Host resolves to a private or unavailable address', code: 'SSRF_BLOCKED' };
    }
  } catch {
    return { ok: false, error: 'Host could not be safely resolved', code: 'URL_NOT_ALLOWED' };
  }

  return basic;
}
