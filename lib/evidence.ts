import { createHash } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type WorkerPayload = Record<string, unknown>;

export type WorkerEvidenceSummary = {
  ok: boolean;
  screenshot_count: number;
  screenshot_hashes: string[];
  console_errors: string[];
  network_errors: string[];
  failed_steps: string[];
  warning_count: number;
  receipt_id: string | null;
};

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return String(value);
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function immutableEvidenceDigest(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function summarizeWorkerEvidence(payload: WorkerPayload): WorkerEvidenceSummary {
  const artifacts = payload.artifacts && typeof payload.artifacts === 'object'
    ? payload.artifacts as Record<string, unknown>
    : {};
  const screenshots = stringArray(artifacts.screenshots);
  const consoleErrors = stringArray(artifacts.console_errors);
  const networkErrors = stringArray(artifacts.network_errors);
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const failedSteps = steps
    .filter((step) => step && typeof step === 'object' && (step as Record<string, unknown>).status === 'fail')
    .map((step) => {
      const record = step as Record<string, unknown>;
      return `${String(record.index ?? '?')}:${String(record.action ?? 'unknown')}:${String(record.error ?? 'failed')}`;
    });
  const warnings = stringArray(payload.warnings);

  return {
    ok: payload.ok === true
      && payload.status !== 'fail'
      && screenshots.length > 0
      && consoleErrors.length === 0
      && networkErrors.length === 0
      && failedSteps.length === 0,
    screenshot_count: screenshots.length,
    screenshot_hashes: screenshots.map((screenshot) => sha256(screenshot)),
    console_errors: consoleErrors,
    network_errors: networkErrors,
    failed_steps: failedSteps,
    warning_count: warnings.length,
    receipt_id: typeof payload.receipt_id === 'string' ? payload.receipt_id : null,
  };
}

export function buildPromotionDecision(input: {
  summaries: WorkerEvidenceSummary[];
  durableLease: boolean;
  exactReferenceHashes?: string[];
  requiredScenarioCount?: number;
  provenScenarioCount?: number;
}) {
  const actualHashes = input.summaries.flatMap((summary) => summary.screenshot_hashes).sort();
  const referenceHashes = [...(input.exactReferenceHashes || [])].sort();
  const browserEvidencePassed = input.summaries.length > 0 && input.summaries.every((summary) => summary.ok);
  const visualParityProven = referenceHashes.length > 0
    && referenceHashes.length === actualHashes.length
    && referenceHashes.every((hash, index) => hash === actualHashes[index]);
  const requiredScenarios = Math.max(0, input.requiredScenarioCount || 0);
  const provenScenarios = Math.max(0, input.provenScenarioCount || 0);
  const operationalParityProven = requiredScenarios > 0 && provenScenarios >= requiredScenarios;
  const blockers: string[] = [];

  if (!browserEvidencePassed) blockers.push('BROWSER_EVIDENCE_FAILED');
  if (!input.durableLease) blockers.push('DURABLE_LEASE_NOT_PROVEN');
  if (!visualParityProven) blockers.push('APPROVED_REFERENCE_PARITY_NOT_PROVEN');
  if (!operationalParityProven) blockers.push('OPERATIONAL_SCENARIOS_NOT_PROVEN');

  return {
    promotion_eligible: blockers.length === 0,
    browser_evidence_passed: browserEvidencePassed,
    durable_lease_proven: input.durableLease,
    visual_parity: {
      proven: visualParityProven,
      mode: referenceHashes.length > 0 ? 'exact_screenshot_sha256' : 'reference_missing',
      actual_hashes: actualHashes,
      reference_hashes: referenceHashes,
    },
    operational_parity: {
      proven: operationalParityProven,
      required_scenarios: requiredScenarios,
      proven_scenarios: provenScenarios,
    },
    blockers,
  };
}
