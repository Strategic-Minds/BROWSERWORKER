import { createHash } from 'node:crypto';
import { immutableEvidenceDigest } from './evidence';

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

type StoreOptions = {
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
};

export type StoredArtifactRef = {
  bucket: string;
  path: string;
  sha256: string;
  content_type: string;
  bytes: number;
  evidence_digest?: string;
};

const DEFAULT_BUCKET = 'xab-browser-evidence';
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeSegment(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || 'unknown').slice(0, 120);
}

function config(env: Record<string, string | undefined>) {
  const url = clean(env.SUPABASE_URL) || clean(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRole = clean(env.SUPABASE_SERVICE_ROLE_KEY) || clean(env.SUPABASE_SERVICE_KEY);
  const bucket = clean(env.BROWSER_EVIDENCE_BUCKET) || DEFAULT_BUCKET;
  return { url, serviceRole, bucket };
}

function parseDataUrl(value: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(value);
  if (!match) throw new Error('SCREENSHOT_DATA_URL_INVALID');
  const contentType = match[1];
  if (!ALLOWED_TYPES.has(contentType)) throw new Error('SCREENSHOT_CONTENT_TYPE_BLOCKED');
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (bytes.length < 1) throw new Error('SCREENSHOT_EMPTY');
  if (bytes.length > MAX_SCREENSHOT_BYTES) throw new Error('SCREENSHOT_SIZE_EXCEEDED');
  return { contentType, bytes };
}

function extension(contentType: string) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  return 'png';
}

async function uploadObject(
  fetchImpl: FetchLike,
  baseUrl: string,
  serviceRole: string,
  bucket: string,
  path: string,
  body: BodyInit,
  contentType: string,
) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetchImpl(
    `${baseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRole,
        authorization: `Bearer ${serviceRole}`,
        'content-type': contentType,
        'x-upsert': 'true',
        'x-client-info': 'strategic-minds-browserworker/4.0',
      },
      body,
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`ARTIFACT_UPLOAD_HTTP_${response.status}:${detail}`);
  }
}

export async function persistWorkerScreenshots(
  input: {
    payload: JsonRecord;
    projectId: string;
    validationId: string;
    route: string;
    viewport: string;
  },
  options: StoreOptions = {},
) {
  const env = options.env || process.env;
  const { url, serviceRole, bucket } = config(env);
  const artifacts = record(input.payload.artifacts);
  const screenshots = strings(artifacts.screenshots);
  const sanitizedPayload: JsonRecord = {
    ...input.payload,
    artifacts: {
      ...artifacts,
      screenshots: [],
    },
  };

  if (screenshots.length === 0) {
    return {
      ok: false,
      configured: Boolean(url && serviceRole),
      refs: [] as StoredArtifactRef[],
      sanitizedPayload,
      failures: ['SCREENSHOT_REQUIRED'],
    };
  }
  if (!url || !serviceRole) {
    return {
      ok: false,
      configured: false,
      refs: [] as StoredArtifactRef[],
      sanitizedPayload,
      failures: ['BROWSER_ARTIFACT_STORE_NOT_CONFIGURED'],
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const refs: StoredArtifactRef[] = [];
  const failures: string[] = [];
  for (const screenshot of screenshots) {
    try {
      const parsed = parseDataUrl(screenshot);
      const digest = createHash('sha256').update(parsed.bytes).digest('hex');
      const path = [
        safeSegment(input.projectId),
        safeSegment(input.validationId),
        safeSegment(input.route),
        safeSegment(input.viewport),
        `${digest}.${extension(parsed.contentType)}`,
      ].join('/');
      await uploadObject(fetchImpl, url, serviceRole, bucket, path, parsed.bytes, parsed.contentType);
      refs.push({
        bucket,
        path,
        sha256: digest,
        content_type: parsed.contentType,
        bytes: parsed.bytes.length,
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  (sanitizedPayload.artifacts as JsonRecord).screenshot_refs = refs;
  (sanitizedPayload.artifacts as JsonRecord).screenshot_hashes = refs.map((ref) => ref.sha256);
  return {
    ok: failures.length === 0 && refs.length === screenshots.length,
    configured: true,
    refs,
    sanitizedPayload,
    failures,
  };
}

export async function persistValidationManifest(
  input: {
    projectId: string;
    validationId: string;
    digest: string;
    manifest: JsonRecord;
  },
  options: StoreOptions = {},
) {
  const env = options.env || process.env;
  const { url, serviceRole, bucket } = config(env);
  if (!url || !serviceRole) {
    return { ok: false, ref: null, failure: 'BROWSER_ARTIFACT_STORE_NOT_CONFIGURED' };
  }
  const evidenceDigest = immutableEvidenceDigest(input.manifest);
  if (evidenceDigest !== input.digest) {
    return { ok: false, ref: null, failure: 'EVIDENCE_DIGEST_MISMATCH' };
  }
  const bytes = Buffer.from(JSON.stringify(input.manifest), 'utf8');
  const contentDigest = createHash('sha256').update(bytes).digest('hex');
  const path = [
    safeSegment(input.projectId),
    safeSegment(input.validationId),
    `${evidenceDigest}.json`,
  ].join('/');
  try {
    await uploadObject(options.fetchImpl || fetch, url, serviceRole, bucket, path, bytes, 'application/json');
    return {
      ok: true,
      ref: {
        bucket,
        path,
        sha256: contentDigest,
        evidence_digest: evidenceDigest,
        content_type: 'application/json',
        bytes: bytes.length,
      } satisfies StoredArtifactRef,
      failure: null,
    };
  } catch (error) {
    return {
      ok: false,
      ref: null,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
