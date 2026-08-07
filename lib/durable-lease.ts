import { randomUUID } from 'node:crypto';

type FetchLike = typeof fetch;

export type BrowserLease = {
  acquired: boolean;
  durable: boolean;
  mode: 'supabase' | 'preview-local' | 'blocked';
  code: string;
  leaseKey: string | null;
  holderId: string;
  warning?: string;
  renew: () => Promise<boolean>;
  release: () => Promise<boolean>;
};

type LeaseOptions = {
  holderId?: string;
  ttlSeconds?: number;
  slots?: number;
  fetchImpl?: FetchLike;
};

const ACQUIRE_RPC = 'xai_acquire_factory_lease';
const RENEW_RPC = 'xai_renew_factory_lease';
const RELEASE_RPC = 'xai_release_factory_lease';

function positiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function supabaseConfig() {
  const url = clean(process.env.SUPABASE_URL) || clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRole = clean(process.env.SUPABASE_SERVICE_ROLE_KEY) || clean(process.env.SUPABASE_SERVICE_KEY);
  return { url, serviceRole };
}

function requiresDurableLease(): boolean {
  if (process.env.BROWSER_DURABLE_LEASE_REQUIRED === 'false') return false;
  if (process.env.BROWSER_DURABLE_LEASE_REQUIRED === 'true') return true;
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

async function rpcBoolean(
  fetchImpl: FetchLike,
  baseUrl: string,
  serviceRole: string,
  functionName: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
      'content-type': 'application/json',
      'x-client-info': 'strategic-minds-browserworker/4.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });

  if (!response.ok) return false;
  const text = await response.text();
  if (!text) return false;
  try {
    return JSON.parse(text) === true;
  } catch {
    return text.trim() === 'true';
  }
}

export async function acquireBrowserValidationLease(options: LeaseOptions = {}): Promise<BrowserLease> {
  const fetchImpl = options.fetchImpl || fetch;
  const holderId = clean(options.holderId) || `browserworker-${randomUUID()}`;
  const ttlSeconds = positiveInteger(options.ttlSeconds, 180, 30, 900);
  const slots = positiveInteger(options.slots ?? process.env.BROWSER_MAX_CONCURRENT_JOBS, 2, 1, 20);
  const { url, serviceRole } = supabaseConfig();

  if (!url || !serviceRole) {
    if (requiresDurableLease()) {
      return {
        acquired: false,
        durable: false,
        mode: 'blocked',
        code: 'DURABLE_LEASE_NOT_CONFIGURED',
        leaseKey: null,
        holderId,
        warning: 'Supabase service-role lease configuration is required in production.',
        renew: async () => false,
        release: async () => false,
      };
    }

    return {
      acquired: true,
      durable: false,
      mode: 'preview-local',
      code: 'PREVIEW_LOCAL_LEASE_ONLY',
      leaseKey: null,
      holderId,
      warning: 'Cross-instance concurrency is not proven; this preview cannot be promoted.',
      renew: async () => true,
      release: async () => true,
    };
  }

  for (let slot = 1; slot <= slots; slot += 1) {
    const leaseKey = `browserworker:global-validation:${slot}`;
    const acquired = await rpcBoolean(fetchImpl, url, serviceRole, ACQUIRE_RPC, {
      p_lease_key: leaseKey,
      p_holder_id: holderId,
      p_ttl_seconds: ttlSeconds,
    });
    if (!acquired) continue;

    return {
      acquired: true,
      durable: true,
      mode: 'supabase',
      code: 'DURABLE_LEASE_ACQUIRED',
      leaseKey,
      holderId,
      renew: async () => rpcBoolean(fetchImpl, url, serviceRole, RENEW_RPC, {
        p_lease_key: leaseKey,
        p_holder_id: holderId,
        p_ttl_seconds: ttlSeconds,
      }),
      release: async () => rpcBoolean(fetchImpl, url, serviceRole, RELEASE_RPC, {
        p_lease_key: leaseKey,
        p_holder_id: holderId,
      }),
    };
  }

  return {
    acquired: false,
    durable: true,
    mode: 'supabase',
    code: 'DURABLE_LEASE_CAPACITY_EXHAUSTED',
    leaseKey: null,
    holderId,
    renew: async () => false,
    release: async () => false,
  };
}
