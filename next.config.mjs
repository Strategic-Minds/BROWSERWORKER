/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 auto-externalizes Playwright. Force it through the transpile/bundle
  // pipeline so serverless route handlers can resolve it at runtime.
  transpilePackages: ['playwright-core'],
  // Keep only the large Chromium binary package external for Vercel tracing.
  serverExternalPackages: ['@sparticuz/chromium'],
};

export default nextConfig;
