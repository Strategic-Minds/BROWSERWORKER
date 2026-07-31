import {
  buildPromotionDecision,
  immutableEvidenceDigest,
  sha256,
  summarizeWorkerEvidence,
} from '@/lib/evidence';

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

describe('BrowserWorker evidence', () => {
  test('produces a stable digest independent of object key order', () => {
    expect(immutableEvidenceDigest({ b: 2, a: 1 })).toBe(immutableEvidenceDigest({ a: 1, b: 2 }));
  });

  test('requires screenshot, clean browser telemetry, and passing steps', () => {
    const pass = summarizeWorkerEvidence(passingWorkerPayload());
    expect(pass.ok).toBe(true);
    expect(pass.screenshot_count).toBe(1);

    const consoleFailure = summarizeWorkerEvidence({
      ...passingWorkerPayload(),
      artifacts: {
        screenshots: ['proof'],
        console_errors: ['ReferenceError'],
        network_errors: [],
      },
    });
    expect(consoleFailure.ok).toBe(false);

    const noScreenshot = summarizeWorkerEvidence({
      ...passingWorkerPayload(),
      artifacts: { screenshots: [], console_errors: [], network_errors: [] },
    });
    expect(noScreenshot.ok).toBe(false);
  });

  test('blocks promotion until durable, exact visual, and operational proof all exist', () => {
    const summary = summarizeWorkerEvidence(passingWorkerPayload('visual-proof'));
    const incomplete = buildPromotionDecision({
      summaries: [summary],
      durableLease: false,
      requiredScenarioCount: 2,
      provenScenarioCount: 1,
    });
    expect(incomplete.promotion_eligible).toBe(false);
    expect(incomplete.blockers).toEqual(expect.arrayContaining([
      'DURABLE_LEASE_NOT_PROVEN',
      'APPROVED_REFERENCE_PARITY_NOT_PROVEN',
      'OPERATIONAL_SCENARIOS_NOT_PROVEN',
    ]));

    const complete = buildPromotionDecision({
      summaries: [summary],
      durableLease: true,
      exactReferenceHashes: [sha256('visual-proof')],
      requiredScenarioCount: 2,
      provenScenarioCount: 2,
    });
    expect(complete.promotion_eligible).toBe(true);
    expect(complete.blockers).toEqual([]);
  });

  test('rejects worker receipts with failed steps even when top-level ok is true', () => {
    const summary = summarizeWorkerEvidence({
      ...passingWorkerPayload(),
      steps: [{ index: 1, action: 'goto', status: 'fail', error: 'timeout' }],
    });
    expect(summary.ok).toBe(false);
    expect(summary.failed_steps).toEqual(['1:goto:timeout']);
  });
});
