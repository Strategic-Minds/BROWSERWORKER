import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireBrowserValidationLease } from '../lib/durable-lease.ts';

const ENV_NAMES = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'BROWSER_DURABLE_LEASE_REQUIRED',
  'BROWSER_MAX_CONCURRENT_JOBS',
  'VERCEL_ENV',
] as const;

function preserveEnvironment() {
  const values = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
  return () => {
    for (const [name, value] of values) {
      if (value === undefined) delete process.env[name];
      else Reflect.set(process.env, name, value);
    }
  };
}

function clearEnvironment() {
  for (const name of ENV_NAMES) delete process.env[name];
  Reflect.set(process.env, 'VERCEL_ENV', 'preview');
}

test('allows an explicitly non-promotable local preview lease', async () => {
  const restore = preserveEnvironment();
  clearEnvironment();
  try {
    const lease = await acquireBrowserValidationLease({ holderId: 'preview-1' });
    assert.equal(lease.acquired, true);
    assert.equal(lease.durable, false);
    assert.equal(lease.mode, 'preview-local');
    assert.equal(lease.code, 'PREVIEW_LOCAL_LEASE_ONLY');
    assert.equal(await lease.release(), true);
  } finally {
    restore();
  }
});

test('fails closed in production when durable lease configuration is absent', async () => {
  const restore = preserveEnvironment();
  clearEnvironment();
  Reflect.set(process.env, 'BROWSER_DURABLE_LEASE_REQUIRED', 'true');
  try {
    const lease = await acquireBrowserValidationLease({ holderId: 'production-1' });
    assert.equal(lease.acquired, false);
    assert.equal(lease.mode, 'blocked');
    assert.equal(lease.code, 'DURABLE_LEASE_NOT_CONFIGURED');
  } finally {
    restore();
  }
});

test('acquires, renews, and releases a service-role Supabase slot', async () => {
  const restore = preserveEnvironment();
  clearEnvironment();
  Reflect.set(process.env, 'SUPABASE_URL', 'https://example.supabase.co');
  Reflect.set(process.env, 'SUPABASE_SERVICE_ROLE_KEY', 'server-only-secret');
  Reflect.set(process.env, 'BROWSER_MAX_CONCURRENT_JOBS', '2');
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
    assert.equal(lease.acquired, true);
    assert.equal(lease.durable, true);
    assert.equal(lease.leaseKey, 'browserworker:global-validation:2');
    assert.equal(await lease.renew(), true);
    assert.equal(await lease.release(), true);
    assert.deepEqual(calls.map((call) => call.url), [
      'https://example.supabase.co/rest/v1/rpc/xai_acquire_factory_lease',
      'https://example.supabase.co/rest/v1/rpc/xai_acquire_factory_lease',
      'https://example.supabase.co/rest/v1/rpc/xai_renew_factory_lease',
      'https://example.supabase.co/rest/v1/rpc/xai_release_factory_lease',
    ]);
    assert.equal(JSON.stringify({ lease }).includes('server-only-secret'), false);
  } finally {
    restore();
  }
});

test('returns rate limiting when every durable slot is leased', async () => {
  const restore = preserveEnvironment();
  clearEnvironment();
  Reflect.set(process.env, 'SUPABASE_URL', 'https://example.supabase.co');
  Reflect.set(process.env, 'SUPABASE_SERVICE_ROLE_KEY', 'server-only-secret');
  const fetchImpl = async () => new Response('false', { status: 200 });

  try {
    const lease = await acquireBrowserValidationLease({
      holderId: 'worker-2',
      slots: 3,
      fetchImpl: fetchImpl as typeof fetch,
    });
    assert.equal(lease.acquired, false);
    assert.equal(lease.durable, true);
    assert.equal(lease.code, 'DURABLE_LEASE_CAPACITY_EXHAUSTED');
  } finally {
    restore();
  }
});
