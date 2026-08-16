import { WORKER_VERSION } from '@/lib/version';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    version: WORKER_VERSION,
    provider: 'self_hosted',
    browserbase_dependency: false,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
    deployment: process.env.VERCEL_DEPLOYMENT_ID || 'local',
    environment: process.env.VERCEL_ENV || 'development',
    region: process.env.VERCEL_REGION || 'unknown',
    timestamp: new Date().toISOString(),
  });
}
