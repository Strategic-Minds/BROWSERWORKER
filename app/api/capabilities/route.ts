import { WORKER_VERSION } from '@/lib/browser';
export const dynamic = 'force-dynamic';

const SUPPORTED_ACTIONS = [
  'goto','reload','click','double_click','hover','fill','type','press',
  'select_option','check','uncheck','scroll','wait','wait_for_selector',
  'wait_for_url','extract_text','extract_html','extract_links','extract_attribute',
  'screenshot','evaluate_safe','get_title','get_url','get_viewport',
  'validate_element','validate_text','validate_status',
  'capture_accessibility_snapshot','capture_console','capture_network_errors',
];

export async function GET() {
  return Response.json({
    ok: true,
    worker_version: WORKER_VERSION,
    supported_actions: SUPPORTED_ACTIONS,
    job_types: ['launch-check', 'website-generator-proof', 'generated-site-validation'],
    limits: {
      max_steps: parseInt(process.env.BROWSER_MAX_STEPS || '25', 10),
      max_runtime_ms: parseInt(process.env.BROWSER_MAX_RUNTIME_MS || '120000', 10),
      max_screenshots: parseInt(process.env.BROWSER_MAX_SCREENSHOTS || '6', 10),
      max_concurrent_jobs: parseInt(process.env.BROWSER_MAX_CONCURRENT_JOBS || '2', 10),
      max_payload_bytes: 262144,
    },
    viewports: {
      desktop: { width: 1440, height: 1200 },
      tablet: { width: 1024, height: 1366 },
      mobile: { width: 390, height: 844 },
    },
  });
}
