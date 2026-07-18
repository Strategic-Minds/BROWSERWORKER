import { randomUUID } from 'node:crypto';
import { verifyAuth, authResponse } from '@/lib/auth';
import { validatePublicUrl } from '@/lib/ssrf';
import { launchBrowser, closeBrowser, WORKER_VERSION } from '@/lib/browser';
import { executeStep } from '@/lib/actions';
import type { Captures } from '@/lib/actions