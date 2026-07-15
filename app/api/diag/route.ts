export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const chromiumMin = require('@sparticuz/chromium-min');
  
  const PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';
  
  let executablePath = 'unknown';
  let error = null;
  let chromiumMinVersion = 'unknown';
  
  try {
    chromiumMinVersion = require('@sparticuz/chromium-min/package.json').version;
  } catch {}
  
  try {
    executablePath = await chromiumMin.executablePath(PACK_URL);
  } catch (e) {
    error = String(e);
  }
  
  // Check if file exists at that path
  let fileExists = false;
  try {
    const { existsSync } = require('node:fs');
    fileExists = existsSync(executablePath);
  } catch {}
  
  // List /tmp
  let tmpFiles: string[] = [];
  try {
    const { readdirSync } = require('node:fs');
    tmpFiles = readdirSync('/tmp');
  } catch {}
  
  return Response.json({
    executablePath,
    fileExists,
    error,
    chromiumMinVersion,
    tmpFiles,
    platform: process.platform,
    arch: process.arch,
  });
}
