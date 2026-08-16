/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 auto-externalizes Playwright. Keep native resolution, but force
  // the package files into every server trace so Vercel functions can load it.
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/*': ['./node_modules/playwright-core/**/*'],
  },
};

export default nextConfig;
