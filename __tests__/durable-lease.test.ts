import { acquireBrowserValidationLease } from '@/lib/durable-lease';

const ENV_NAMES = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'BROWSER_DURABLE_LEASE_REQUIRED',
  'BROWSER_MAX_CONCURRENT_JOBS',
  'VERCEL_ENV',
  'NODE_ENV',
] as const;

function preserveEnvironment() {
  const values = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
  return () => {
    for (const [name, value] of values) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

function clearEnvironment() {
  for (const name of ENV_NAMES) delete process.env[name];
  process.env.NODE_ENV = 'test';
  process.env.VERCEL_ENV = 'preview';
}

describe('durable BrowserWorker lease', () => {
  test('allows an explicitly non-promotable local preview lease', async () => {
    const restore = preserveEnvironment();
    clearEnvironment();
    try {
      const lease = await acquireBrowserValidationLease({ holderId: 'preview-1' });
      expect(lease.acquired).toBe(true);
      expect(lease.durable).toBe(false);
      expect(lease.mode).toBe('preview-local');
      expect(lease.code).toBe('PREVIEW_LOCAL_LEASE_ONLY');
      expect(await lease.release()).toBe(true);
    } finally {
      restore();
    }
  });

  test('fails closed in production when durable lease configuration is absent', async () => {
    const restore = preserveEnvironment();
    clearEnvironment();
    process.env.VERCEL_ENV = 'production';
    try {
      const lease = await acquireBrowserValidationLease({ holderId: 'production-1' });
      expect(lease.acquired).toBe(false);
      expect(lease.mode).toBe('blocked');
      expect(lease.code).toBe('DURABLE_LEASE_NOT_CONFIGURED');
    } finally {
      restore();
    }
  });

  test('acquires, renews, and releases a service-role Supabase slot', async () => {
    const restore = preserveEnvironment();
    clearEnvironment();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-secret';
    process.env.BROWSER_MAX_CONCURRENT_JOBS = '2';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const replies = [false, true, true, true];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    };

    try {
      const lease = await acquireBrowserValidationLease({
        holderId: 'worker-1',
        fetchImpl: fetchImpl as typeof fetch,
      });
      expect(lease.acquired).toBe(true);
      expect(lease.durable).toBe(true);
      expect(lease.leaseKey).toBe('browserworker:global-validation:2');
      expect(await lease.renew()).toBe(true);
      expect(await lease.release()).toBe(true);
      expect(calls.map((call) => call.url)).toEqual([
        'https://example.supabase.co/rest/v1/rpc/xai_acquire_factory_lease',
        'https://example.supabase.co/rest/v1/rpc/xai_acquire_factory_lease',
        'https://example.supabase.co/rest/v1/rpc/xai_renew_factory_lease',
        'https://example.supabase.co/rest/v1/rpc/xai_release_factory_lease',
      ]);
      expect(JSON.stringify({ lease })).not.toContain('server-only-secret');
    } finally {
      restore();
    }
  });

  test('returns rate limiting when every durable slot is leased', async () => {
    const restore = preserveEnvironment();
    clearEnvironment();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-secret';
    const fetchImpl = async () => new Response('false', { status: 200 });

    try {
      const lease = await acquireBrowserValidationLease({
        holderId: 'worker-2',
        slots: 3,
        fetchImpl: fetchImpl as typeof fetch,
      });
      expect(lease.acquired).toBe(false);
      expect(lease.durable).toBe(true);
      expect(lease.code).toBe('DURABLE_LEASE_CAPACITY_EXHAUSTED');
    } finally {
      restore();
    }
  });
});
