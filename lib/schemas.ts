import { z } from 'zod';

export const ViewportSchema = z.object({
  width: z.number().int().min(320).max(3840).default(1440),
  height: z.number().int().min(240).max(2160).default(1200),
  deviceScaleFactor: z.number().min(0.5).max(3).default(1),
}).optional().default({ width: 1440, height: 1200, deviceScaleFactor: 1 });

export const CaptureSchema = z.object({
  screenshot: z.boolean().default(false),
  console: z.boolean().default(false),
  network_errors: z.boolean().default(false),
  html: z.boolean().default(false),
}).optional().default({});

const BaseStep = z.object({
  timeout_ms: z.number().int().min(100).max(60000).optional(),
});

export const StepSchema = z.discriminatedUnion('action', [
  BaseStep.extend({ action: z.literal('goto'), url: z.string().url() }),
  BaseStep.extend({ action: z.literal('reload') }),
  BaseStep.extend({ action: z.literal('click'), selector: z.string().min(1) }),
  BaseStep.extend({ action: z.literal('double_click'), selector: z.string().min(1) }),
  BaseStep.extend({ action: z.literal('hover'), selector: z.string().min(1) }),
  BaseStep.extend({ action: z.literal('fill'), selector: z.string().min(1), value: z.string() }),
  BaseStep.extend({ action: z.literal('type'), selector: z.string().min(1), value: z.string() }),
  BaseStep.extend({ action: z.literal('press'), selector: z.string().min(1), key: z.string() }),
  BaseStep.extend({ action: z.literal('select_option'), selector: z.string().min(1), value: z.string() }),
  BaseStep.extend({ action: z.literal('check'), selector: z.string().min(1) }),
  BaseStep.extend({ action: z.literal('uncheck'), selector: z.string().min(1) }),
  BaseStep.extend({ action: z.literal('scroll'), x: z.number().optional(), y: z.number().optional(), selector: z.string().optional() }),
  BaseStep.extend({ action: z.literal('wait'), milliseconds: z.number().int().min(0).max(30000) }),
  BaseStep.extend({ action: z.literal('wait_for_selector'), selector: z.string().min(1) }),
  BaseStep.extend({ action: z.literal('wait_for_url'), url: z.string() }),
  BaseStep.extend({ action: z.literal('extract_text'), selector: z.string().min(1).optional() }),
  BaseStep.extend({ action: z.literal('extract_html'), selector: z.string().min(1).optional() }),
  BaseStep.extend({ action: z.literal('extract_links') }),
  BaseStep.extend({ action: z.literal('extract_attribute'), selector: z.string().min(1), attribute: z.string().min(1) }),
  BaseStep.extend({ action: z.literal('screenshot'), fullPage: z.boolean().optional(), selector: z.string().optional() }),
  BaseStep.extend({ action: z.literal('evaluate_safe'), operation: z.enum(['title', 'bodyHeight', 'elementCount', 'performance', 'visibility']), selector: z.string().optional() }),
  BaseStep.extend({ action: z.literal('get_title') }),
  BaseStep.extend({ action: z.literal('get_url') }),
  BaseStep.extend({ action: z.literal('get_viewport') }),
  BaseStep.extend({ action: z.literal('validate_element'), selector: z.string().min(1) }),
  BaseStep.extend({ action: z.literal('validate_text'), selector: z.string().min(1), expected: z.string() }),
  BaseStep.extend({ action: z.literal('validate_status') }),
  BaseStep.extend({ action: z.literal('capture_accessibility_snapshot') }),
  BaseStep.extend({ action: z.literal('capture_console') }),
  BaseStep.extend({ action: z.literal('capture_network_errors') }),
]);

export type Step = z.infer<typeof StepSchema>;

export const VisualRegionSchema = z.object({
  name: z.string().min(1).max(80),
  selector: z.string().min(1).max(500).optional(),
  x: z.number().min(0).optional(),
  y: z.number().min(0).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  normalized: z.boolean().default(false),
  threshold_percent: z.number().min(0).max(100).default(0.5),
  critical: z.boolean().default(true),
}).superRefine((value, ctx) => {
  const hasBox = value.x !== undefined && value.y !== undefined && value.width !== undefined && value.height !== undefined;
  if (!value.selector && !hasBox) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Visual region requires selector or complete x/y/width/height box' });
  if (value.normalized && hasBox && ((value.x ?? 0) > 1 || (value.y ?? 0) > 1 || (value.width ?? 0) > 1 || (value.height ?? 0) > 1)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Normalized region coordinates must be between 0 and 1' });
  }
});

export const VisualParitySchema = z.object({
  reference_id: z.string().min(1).max(200),
  reference_url: z.string().url(),
  mode: z.enum(['exact', 'scale-reference']).default('exact'),
  mismatch_threshold_percent: z.number().min(0).max(100).default(0.5),
  pixel_threshold: z.number().int().min(0).max(255).default(24),
  full_page: z.boolean().default(false),
  wait_ms: z.number().int().min(0).max(10000).default(500),
  wait_for_fonts: z.boolean().default(true),
  disable_animations: z.boolean().default(true),
  mask_selectors: z.array(z.string().min(1).max(500)).max(20).default([]),
  regions: z.array(VisualRegionSchema).max(20).default([]),
});

export type VisualParitySpec = z.infer<typeof VisualParitySchema>;

export const OperationalParitySchema = z.object({
  contract_id: z.string().min(1).max(200),
  case_id: z.string().min(1).max(200),
  require_console_zero: z.boolean().default(true),
  require_network_zero: z.boolean().default(true),
}).optional();

const MAX_STEPS = parseInt(process.env.BROWSER_MAX_STEPS || '25', 10);
const MAX_RUNTIME_MS = parseInt(process.env.BROWSER_MAX_RUNTIME_MS || '120000', 10);

export const JobRequestSchema = z.object({
  version: z.string().default('1.0'),
  job_id: z.string().min(1).optional(),
  correlation_id: z.string().optional(),
  objective: z.string().max(500).optional(),
  url: z.string().url().optional(),
  viewport: ViewportSchema,
  timeout_ms: z.number().int().min(1000).max(MAX_RUNTIME_MS).default(60000),
  capture: CaptureSchema,
  steps: z.array(StepSchema).max(MAX_STEPS).optional().default([]),
  type: z.enum(['launch-check', 'website-generator-proof', 'generated-site-validation', 'visual-parity', 'operational-parity']).optional(),
  visual: VisualParitySchema.optional(),
  operational: OperationalParitySchema,
}).superRefine((job, ctx) => {
  if (job.type === 'visual-parity' && !job.visual) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['visual'], message: 'visual-parity job requires visual contract' });
  }
  if (job.type === 'operational-parity' && !job.operational) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operational'], message: 'operational-parity job requires operational contract' });
  }
  if (job.type !== 'launch-check' && !job.url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'url is required for this job type' });
  }
});

export type JobRequest = z.infer<typeof JobRequestSchema>;

export const ReceiptSchema = z.object({
  ok: z.boolean(),
  status: z.enum(['pass', 'warn', 'fail', 'blocked']),
  job_id: z.string(),
  correlation_id: z.string(),
  worker_version: z.string(),
  browser: z.object({ name: z.string(), version: z.string() }),
  timing: z.object({
    started_at: z.string(),
    completed_at: z.string(),
    duration_ms: z.number(),
  }),
  navigation: z.object({
    requested_url: z.string(),
    final_url: z.string(),
    redirects: z.array(z.string()),
  }).optional(),
  steps: z.array(z.object({
    index: z.number(),
    action: z.string(),
    status: z.enum(['pass', 'fail', 'skip']),
    duration_ms: z.number(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  })),
  artifacts: z.object({
    screenshots: z.array(z.string()),
    console_errors: z.array(z.string()),
    network_errors: z.array(z.string()),
    diff_images: z.array(z.string()).optional(),
  }),
  visual: z.unknown().optional(),
  operational: z.unknown().optional(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  receipt_id: z.string(),
});
