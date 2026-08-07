import { JobRequestSchema } from '../lib/schemas';

describe('visual parity job schema', () => {
  it('accepts a fail-closed visual parity contract', () => {
    const parsed = JobRequestSchema.safeParse({
      type: 'visual-parity',
      url: 'https://example.com/',
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      capture: { screenshot: true, console: true, network_errors: true },
      visual: {
        reference_id: 'XAI-WP-0040-V1:home:desktop',
        reference_url: 'https://example.com/golden/home-desktop.png',
        mismatch_threshold_percent: 0.5,
        pixel_threshold: 24,
        regions: [
          { name: 'header', x: 0, y: 0, width: 1, height: 0.1, normalized: true, threshold_percent: 0.25, critical: true },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an operational parity contract', () => {
    const parsed = JobRequestSchema.safeParse({
      type: 'operational-parity',
      url: 'https://example.com/',
      operational: {
        contract_id: 'XAI-WP-0040-V1',
        case_id: 'home-primary-cta',
        require_console_zero: true,
        require_network_zero: true,
      },
      steps: [
        { action: 'goto', url: 'https://example.com/' },
        { action: 'validate_element', selector: 'body' },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
