import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPromotionDecision,
  immutableEvidenceDigest,
  sha256,
  summarizeWorkerEvidence,
} from '../lib/evidence.ts';

function passingWorkerPayload(screenshot = 'data:image/png;base64,proof') {
  return {
    ok: true,
    status: 'pass',
    receipt_id: 'receipt-1',
    steps: [
      { index: 1, action: 'goto', status: 'pass', duration_ms: 10 },
      { index: 2, action: 'screenshot', status: 'pass', duration_ms: 10 },
    ],
    artifacts: {
      screenshots: [screenshot],
      console_errors: [],
      network_errors: [],
    },
    warnings: [],
  };
}

test('produces a stable digest independent of object key order', () => {
  assert.equal(immutableEvidenceDigest({ b: 2, a: 1 }), immutableEvidenceDigest({ a: 1, b: 2 }));
});

test('requires screenshot, clean browser telemetry, and passing steps', () => {
  const pass = summarizeWorkerEvidence(passingWorkerPayload());
  assert.equal(pass.ok, true);
  assert.equal(pass.screenshot_count, 1);

  const consoleFailure = summarizeWorkerEvidence({
    ...passingWorkerPayload(),
    artifacts: {
      screenshots: ['proof'],
      console_errors: ['ReferenceError'],
      network_errors: [],
    },
  });
  assert.equal(consoleFailure.ok, false);

  const noScreenshot = summarizeWorkerEvidence({
    ...passingWorkerPayload(),
    artifacts: { screenshots: [], console_errors: [], network_errors: [] },
  });
  assert.equal(noScreenshot.ok, false);
});

test('blocks promotion until durable, exact visual, and operational proof all exist', () => {
  const summary = summarizeWorkerEvidence(passingWorkerPayload('visual-proof'));
  const incomplete = buildPromotionDecision({
    summaries: [summary],
    durableLease: false,
    requiredScenarioCount: 2,
    provenScenarioCount: 1,
  });
  assert.equal(incomplete.promotion_eligible, false);
  assert.equal(incomplete.blockers.includes('DURABLE_LEASE_NOT_PROVEN'), true);
  assert.equal(incomplete.blockers.includes('APPROVED_REFERENCE_PARITY_NOT_PROVEN'), true);
  assert.equal(incomplete.blockers.includes('OPERATIONAL_SCENARIOS_NOT_PROVEN'), true);

  const complete = buildPromotionDecision({
    summaries: [summary],
    durableLease: true,
    exactReferenceHashes: [sha256('visual-proof')],
    requiredScenarioCount: 2,
    provenScenarioCount: 2,
  });
  assert.equal(complete.promotion_eligible, true);
  assert.deepEqual(complete.blockers, []);
});

test('rejects worker receipts with failed steps even when top-level ok is true', () => {
  const summary = summarizeWorkerEvidence({
    ...passingWorkerPayload(),
    steps: [{ index: 1, action: 'goto', status: 'fail', error: 'timeout' }],
  });
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.failed_steps, ['1:goto:timeout']);
});
