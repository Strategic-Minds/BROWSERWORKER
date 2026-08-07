import test from 'node:test';
import assert from 'node:assert/strict';
import {
  persistValidationManifest,
  persistWorkerScreenshots,
} from '../lib/artifact-store.ts';
import { immutableEvidenceDigest, sha256 } from '../lib/evidence.ts';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
  BROWSER_EVIDENCE_BUCKET: 'private-evidence',
};

function workerPayload(image = 'data:image/png;base64,cHJvb2Y=') {
  return {
    ok: true,
    artifacts: {
      screenshots: [image],
      console_errors: [],
      network_errors: [],
    },
  };
}

test('persists screenshots by content hash and strips inline data from the receipt', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ Key: 'ok' }), { status: 200 });
  };
  const result = await persistWorkerScreenshots({
    payload: workerPayload(),
    projectId: 'project-1',
    validationId: 'validation-1',
    route: '/dashboard',
    viewport: 'desktop',
  }, { env: ENV, fetchImpl: fetchImpl as typeof fetch });

  assert.equal(result.ok, true);
  assert.equal(result.refs.length, 1);
  assert.equal(result.refs[0].sha256, sha256('proof'));
  assert.match(result.refs[0].path, /project-1\/validation-1\/dashboard\/desktop\/[a-f0-9]{64}\.png$/);
  assert.equal(JSON.stringify(result.sanitizedPayload).includes('data:image'), false);
  assert.deepEqual((result.sanitizedPayload.artifacts as Record<string, unknown>).screenshots, []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /storage\/v1\/object\/private-evidence\//);
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, 'Bearer server-secret');
  assert.equal(JSON.stringify(result).includes('server-secret'), false);
});

test('fails closed and still removes inline screenshot data when storage is unavailable', async () => {
  const result = await persistWorkerScreenshots({
    payload: workerPayload(),
    projectId: 'project-1',
    validationId: 'validation-1',
    route: '/',
    viewport: 'mobile',
  }, { env: {} });

  assert.equal(result.ok, false);
  assert.equal(result.configured, false);
  assert.deepEqual(result.failures, ['BROWSER_ARTIFACT_STORE_NOT_CONFIGURED']);
  assert.equal(JSON.stringify(result.sanitizedPayload).includes('data:image'), false);
});

test('rejects unsupported screenshot types and oversized-free malformed data', async () => {
  const fetchImpl = async () => new Response('{}', { status: 200 });
  const result = await persistWorkerScreenshots({
    payload: workerPayload('data:image/svg+xml;base64,PHN2Zz4='),
    projectId: 'project-1',
    validationId: 'validation-1',
    route: '/',
    viewport: 'tablet',
  }, { env: ENV, fetchImpl: fetchImpl as typeof fetch });

  assert.equal(result.ok, false);
  assert.equal(result.refs.length, 0);
  assert.deepEqual(result.failures, ['SCREENSHOT_DATA_URL_INVALID']);
});

test('stores a manifest only when its canonical evidence digest matches', async () => {
  const manifest = { b: 2, a: 1, production_mutation: false };
  const digest = immutableEvidenceDigest(manifest);
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response('{}', { status: 200 });
  };

  const stored = await persistValidationManifest({
    projectId: 'project-1',
    validationId: 'validation-1',
    digest,
    manifest,
  }, { env: ENV, fetchImpl: fetchImpl as typeof fetch });
  assert.equal(stored.ok, true);
  assert.equal(stored.ref?.evidence_digest, digest);
  assert.match(stored.ref?.path || '', new RegExp(`${digest}\\.json$`));
  assert.equal(calls.length, 1);

  const mismatch = await persistValidationManifest({
    projectId: 'project-1',
    validationId: 'validation-1',
    digest: '0'.repeat(64),
    manifest,
  }, { env: ENV, fetchImpl: fetchImpl as typeof fetch });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.failure, 'EVIDENCE_DIGEST_MISMATCH');
  assert.equal(calls.length, 1);
});

test('upload errors remain explicit and prevent persistence proof', async () => {
  const fetchImpl = async () => new Response('bucket missing', { status: 404 });
  const result = await persistWorkerScreenshots({
    payload: workerPayload(),
    projectId: 'project-1',
    validationId: 'validation-1',
    route: '/',
    viewport: 'desktop',
  }, { env: ENV, fetchImpl: fetchImpl as typeof fetch });

  assert.equal(result.ok, false);
  assert.equal(result.refs.length, 0);
  assert.match(result.failures[0], /ARTIFACT_UPLOAD_HTTP_404/);
});
