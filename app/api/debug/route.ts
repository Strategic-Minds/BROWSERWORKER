export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const chromiumPack = require('@sparticuz/chromium');
  let executablePath = 'unknown';
  let pathError = null;
  
  try {
    executablePath = await chromiumPack.executablePath();
  } catch (e: unknown) {
    pathError = (e as Error).message;
  }

  return Response.json({
    executablePath,
    pathError,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    env: {
      AWS_EXECUTION_ENV: process.env.AWS_EXECUTION_ENV,
      AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
      LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT,
    }
  });
}
