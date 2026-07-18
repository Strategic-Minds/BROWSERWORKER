import { randomUUID } from 'node:crypto';
import { verifyAuth, authResponse } from '@/lib/auth';
import { validatePublicUrl } from '@/lib/ssrf';
import { launchBrowser, closeBrowser, WORKER_VERSION } from '@/lib/browser';
import { executeStep } from '@/lib/actions';
import type { Captures } from '@/lib/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

type Surface